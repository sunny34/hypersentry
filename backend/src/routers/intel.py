from fastapi import APIRouter, Request, Depends, HTTPException
from typing import List, Dict, Any, Optional
from collections import deque
import logging
import os
import time
from auth import get_current_user, reset_user_credits_if_needed, require_user, require_pro_user
from models import User
from sqlalchemy.orm import Session
from database import get_db
import datetime
import dateutil.parser
from src.alpha_engine.models.ai_command_models import AIBriefResponse
from src.intel.briefing import generate_ai_brief

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/intel", tags=["Intelligence"])
_PROXY_RATE_LIMIT_PER_MIN = max(1, int(os.getenv("INTEL_PROXY_RATE_LIMIT_PER_MIN", "20")))
_PROXY_MAX_RESPONSE_BYTES = max(1024, int(os.getenv("INTEL_PROXY_MAX_RESPONSE_BYTES", str(2 * 1024 * 1024))))
_PROXY_REQUEST_WINDOW = 60
_proxy_request_buckets: Dict[str, deque] = {}


def _enforce_proxy_rate_limit(key: str):
    now = time.time()
    bucket = _proxy_request_buckets.setdefault(key, deque())
    cutoff = now - _PROXY_REQUEST_WINDOW
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _PROXY_RATE_LIMIT_PER_MIN:
        raise HTTPException(status_code=429, detail="Proxy rate limit exceeded")
    bucket.append(now)

@router.get("/ping")
async def ping_intel():
    return {"status": "alive"}

@router.get("/debug")
async def debug_intel(request: Request):
    """
    Debug endpoint to check active token monitoring status.
    """
    engine = getattr(request.app.state, "intel_engine", None)
    if not engine: return {"status": "no engine"}
    
    # Calculate uptime and tracked tokens
    active_providers = [p.name for p in engine.providers]
    
    micro = next((p for p in engine.providers if p.name == "microstructure"), None)
    tracked_count = len(micro.active_symbols) if micro else 0
    sample = list(micro.active_symbols)[:10] if micro else []
    
    return {
        "status": "online",
        "providers": active_providers,
        "microstructure": {
            "tracked_tokens": tracked_count,
            "sample": sample,
            "surge_scan_active": True
        }
    }

@router.get("/pulse")
async def get_intel_pulse(request: Request):
    """
    Get the real-time Global Market Pulse (0-100 score).
    """
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return {"score": 50, "label": "Offline", "breakdown": {}}
    
    return intel_engine.get_global_sentiment()

@router.get("/latest")
async def get_latest_intel(request: Request, limit: int = 20):
    """
    Get the latest aggregated intelligence from all providers.
    Uses the global IntelEngine instance.
    """
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return []
    
    # Get items from engine's providers or its internal cache
    # For simplicity, we'll return what's in the cache if it's been populated
    # The engine already broadcasts via WS, but REST polling is a good fallback
    
    try:
        # Sort cache items by timestamp if possible
        # Cache is a set of IDs, but we can have the engine store the objects too
        # Let's modify IntelEngine to store objects
        if hasattr(intel_engine, "recent_items"):
            return intel_engine.recent_items[:limit]
        
        # Fallback: trigger a quick fetch from all providers
        tasks = [p.fetch_latest() for p in intel_engine.providers]
        import asyncio
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        all_items = []
        for res in results:
            if isinstance(res, list):
                all_items.extend(res)
        
        all_items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return all_items[:limit]
        
    except Exception as e:
        logger.error(f"Failed to fetch intel: {e}")
        return []

@router.get("/ticker")
async def get_intel_ticker(request: Request, limit: int = 12):
    """
    Get a simplified stream of high-signal items for the frontend ticker.
    Mixes Breaking News (RSS/Social) and Prediction Markets.
    """
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return []

    items = []
    # Use recent_items cache
    if hasattr(intel_engine, "recent_items"):
        raw_items = intel_engine.recent_items
        
        # Filter for relevant sources
        relevant = [
            i for i in raw_items 
            if i.get("source") in ["RSS", "Twitter", "Telegram", "Polymarket"] or i.get("is_high_impact")
        ]
        
        # Sort by timestamp descending
        relevant.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        
        # Format for ticker
        for item in relevant[:limit]:
            source = item.get("source", "Unknown")
            is_prediction = source == "Polymarket" or item.get("metadata", {}).get("type") == "prediction"
            
            # Formulate text
            text = item.get("title", "")
            if is_prediction:
                # Clean up title "Prediction: " prefix if present to save space
                text = text.replace("Prediction: ", "")
                # Add probability if available
                prob = item.get("metadata", {}).get("probability")
                if prob:
                    text = f"{text}: {prob:.1f}% YES"
            
            items.append({
                "id": str(item.get("id")),
                "type": "prediction" if is_prediction else "news",
                "text": text,
                "sentiment": item.get("sentiment", "neutral"),
                "url": item.get("url", ""),
                "timestamp": str(item.get("timestamp"))
            })
            
    return items

@router.get("/sources")
async def get_intel_sources(request: Request):
    """List available intelligence sources."""
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return []
    
    return [p.name for p in intel_engine.providers]

@router.get("/predictions")
async def get_prediction_markets(
    request: Request, 
    query: str = None, 
    user: Optional[User] = Depends(get_current_user)
):
    """
    Specifically fetch prediction market data from Polymarket.
    Part of the 'Pro' feature set for macro sentiment analysis.
    """
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return []

    # Find the Polymarket provider
    from src.intel.providers.polymarket import PolymarketProvider
    polymarket = next((p for p in intel_engine.providers if isinstance(p, PolymarketProvider)), None)
    
    if not polymarket:
        return []

    is_pro = user and (user.role == "pro" or user.is_admin)

    markets = []
    if query:
        markets = await polymarket.fetch_markets_by_query(query)
    elif hasattr(intel_engine, "recent_items"):
        markets = [item for item in intel_engine.recent_items if item.get("metadata", {}).get("type") == "prediction"]
    
    if not is_pro:
        # Sneak peak logic
        processed = []
        for m in markets:
            p_m = m.copy()
            p_m["content"] = "Institutional sentiment analysis is restricted to Overwatch Pro subscribers."
            if "metadata" in p_m:
                p_m["metadata"] = p_m["metadata"].copy()
                # We can keep the probability if we want a real 'peek', 
                # but maybe we blur it on the frontend if it's 'locked'.
                p_m["metadata"]["is_locked"] = True
            processed.append(p_m)
        return processed

    return markets

@router.get("/nexus")
async def get_intel_nexus(
    user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get the correlated Decision Nexus briefing.
    PRO users get full real-time data.
    Standard/Guest users get blurred tokens and 10m delayed signals.
    """
    from src.intel.nexus import nexus
    
    logger.info(f"Nexus request from user: {user.email if user else 'GUEST'}")
    
    full_signals = await nexus.get_alpha_confluence()
    
    # 1. Pro / Admin / Env Bypass
    pro_bypass = os.getenv("PRO_BYPASS", "false").lower() == "true"
    if pro_bypass or (user and (user.role == "pro" or user.is_admin)):
        return full_signals

    # 2. Apply Partial Transparency for Free Users
    processed_signals = []
    now = datetime.datetime.now(datetime.timezone.utc)
    ten_mins_ago = now - datetime.timedelta(minutes=10)

    import dateutil.parser

    for sig in full_signals:
        sig_time_str = sig.get("timestamp")
        is_fresh = True
        if sig_time_str:
            try:
                sig_time = dateutil.parser.isoparse(sig_time_str)
                # Ensure sig_time is offset-aware
                if sig_time.tzinfo is None:
                    sig_time = sig_time.replace(tzinfo=datetime.timezone.utc)
                if sig_time <= ten_mins_ago:
                    is_fresh = False
            except Exception as e:
                logger.warning(f"Failed to parse signal timestamp {sig_time_str}: {e}")

        # b) Obfuscation Logic
        token = sig.get("token", "UNKNOWN")
        obfuscated_token = token[0] + "*" * (len(token) - 1)
        
        processed_sig = sig.copy()
        processed_sig["token"] = obfuscated_token
        processed_sig["id"] = sig.get("id") # Preserve unique ID for React keys
        processed_sig["is_obfuscated"] = True
        processed_sig["recommendation"] = "UPGRADE TO VIEW"
        
        if is_fresh:
            processed_sig["recommendation"] = "LOCKED (FRESH)"
        
        # Strip sub-signals to prevent data leakage in nested news/predictions
        if "signals" in processed_sig:
            processed_sig["signals"] = {"status": "locked"}
            
        processed_signals.append(processed_sig)

    return processed_signals


@router.get("/ai-brief", response_model=AIBriefResponse)
async def get_ai_brief(
    request: Request,
    symbol: str = "BTC",
    _user: Optional[User] = Depends(get_current_user),
):
    """
    AI Thesis / Counter-Thesis briefing for the AI Command Center.
    Uses Gemini when configured and falls back to deterministic synthesis.
    """
    from src.intel.nexus import nexus
    from src.intel.providers.microstructure import MicrostructureProvider

    symbol = symbol.split("/")[0].split("-")[0].upper()
    signals = await nexus.get_alpha_confluence()
    signal = next((s for s in signals if str(s.get("token", "")).upper() == symbol), None)

    whale_summary: Dict[str, Any] = {}
    tracker = getattr(request.app.state, "whale_tracker", None)
    if tracker:
        try:
            whale_summary = tracker.get_whale_summary(coin=symbol) or {}
        except Exception as exc:
            logger.warning("Whale summary unavailable for ai-brief symbol=%s err=%s", symbol, exc)

    micro_state: Dict[str, Any] = {}
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if intel_engine:
        try:
            provider = next(
                (p for p in intel_engine.providers if isinstance(p, MicrostructureProvider)),
                None,
            )
            if provider:
                micro_state = await provider.get_symbol_state(symbol) or {}
        except Exception as exc:
            logger.warning("Microstructure unavailable for ai-brief symbol=%s err=%s", symbol, exc)

    return await generate_ai_brief(
        symbol=symbol,
        signal=signal,
        whale_summary=whale_summary,
        micro_state=micro_state,
    )

from pydantic import BaseModel
class DeobfuscateRequest(BaseModel):
    id: str

@router.post("/deobfuscate")
async def deobfuscate_signal(
    request: DeobfuscateRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """
    Burn 1 trial credit to reveal a specific signal symbol.
    """
    from auth import reset_user_credits_if_needed
    reset_user_credits_if_needed(user, db)

    if user.trial_credits <= 0 and user.role != "pro" and not user.is_admin:
        raise HTTPException(status_code=403, detail="No Trial Credits Remaining. Upgrade to Pro for unlimited de-obfuscation.")

    # In a real implementation, we'd record WHICH token they de-obfuscated.
    # For now, we'll just return the full nexus and decrement credit.
    
    if not user.is_admin and user.role != "pro":
        user.trial_credits -= 1
        db.commit()

    from src.intel.nexus import nexus
    all_signals = await nexus.get_alpha_confluence()
    
    # Only reveal the specific signal that matches the unique ID
    # This prevents the ambiguity of obfuscated token patterns (e.g., BTC and BNB both being B**)
    signal_id = request.id
    matching = [
        s for s in all_signals 
        if s.get("id") == signal_id
    ]
    
    return matching if matching else all_signals[:1]  # Fallback to first signal if no exact match

@router.get("/debate/{symbol}")
async def get_agent_debate(symbol: str, request: Request, _user: User = Depends(require_pro_user)):
    """
    Trigger a live multi-agent debate for a specific asset.
    Feeds agents REAL market context for production-grade analysis.
    """
    from src.agents.debate import MultiAgentDebate
    
    engine = MultiAgentDebate()
    
    # Build REAL context from live data sources
    # Build REAL context from live data sources
    intel_engine = getattr(request.app.state, "intel_engine", None)
    context_parts = [f"Asset: {symbol.upper()}"]
    
    if intel_engine:
        # 1. Recent news about this symbol
        # Use simple string matching for now
        news_items = []
        if hasattr(intel_engine, "recent_items"):
            news_items = [
                i.get("title", "") for i in intel_engine.recent_items 
                if symbol.upper() in (i.get("title", "") or "").upper()
            ][:3]
        if news_items:
            context_parts.append(f"Recent News: {'; '.join(news_items)}")
        
        # 2. Prediction market data
        predictions = []
        if hasattr(intel_engine, "recent_items"):
            predictions = [
                f"{i.get('title','')}: {i.get('metadata',{}).get('probability',0):.0f}% YES"
                for i in intel_engine.recent_items
                if i.get("metadata", {}).get("type") == "prediction" and symbol.upper() in (i.get("title", "") or "").upper()
            ][:2]
        if predictions:
            context_parts.append(f"Prediction Markets: {'; '.join(predictions)}")
        
        # 3. Microstructure data (price, CVD, premium)
        from src.intel.providers.microstructure import MicrostructureProvider
        micro = next((p for p in intel_engine.providers if isinstance(p, MicrostructureProvider)), None)
        
        if micro and symbol.upper() in micro.states:
            state = micro.states[symbol.upper()]
            prices = state.get("raw_prices", {})
            context_parts.append(f"Current Price: ${prices.get('binance', 'N/A')}")
            context_parts.append(f"CVD (Cumulative Volume Delta): {state.get('cvd', 0):,.0f}")
            context_parts.append(f"Coinbase Premium: {state.get('cb_spread_usd', 0):.2f} USD")
            context_parts.append(f"Open Interest: {state.get('open_interest', 0):,.0f}")
            
            # Order book walls
            walls = state.get("depth_walls", {})
            bids = walls.get("bid", [])
            asks = walls.get("ask", [])
            
            if bids:
                context_parts.append(f"Major Support Wall: ${bids[0].get('price', 'N/A')} ({bids[0].get('size_usd', 0):,.0f} USD)")
            if asks:
                context_parts.append(f"Major Resistance Wall: ${asks[0].get('price', 'N/A')} ({asks[0].get('size_usd', 0):,.0f} USD)")
    
    context = " | ".join(context_parts)
    
    try:
        messages = await engine.run_debate(symbol, context)
        return {"symbol": symbol, "messages": messages}
    except Exception as e:
        logger.error(f"Debate failed: {e}")
        return {"error": str(e)}

@router.get("/proxy")
async def proxy_web(
    url: str,
    request: Request,
    user: User = Depends(require_pro_user),
):
    """
    Institutional Proxy Tunnel: Bypasses local ISP blocks by routing through the Sentry node.
    Use with caution.
    """
    import httpx
    from fastapi import Response
    from urllib.parse import urlparse
    
    # Strict domain validation using URL parsing (prevents SSRF bypass)
    allowed_domains = {"polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"}
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise HTTPException(status_code=400, detail="Only HTTPS proxying is allowed.")
        hostname = (parsed.hostname or "").lower()
        if hostname not in allowed_domains:
            raise HTTPException(status_code=403, detail=f"Domain '{parsed.hostname}' not in allowlist.")
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed URL.")

    client_ip = request.client.host if request.client else "unknown"
    _enforce_proxy_rate_limit(f"{user.id}:{client_ip}")

    async with httpx.AsyncClient() as client:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        }
        try:
            resp = await client.get(url, headers=headers, follow_redirects=True, timeout=10.0)
            if len(resp.content) > _PROXY_MAX_RESPONSE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Proxied response too large (> {_PROXY_MAX_RESPONSE_BYTES} bytes).",
                )
            
            # Simple content injection to fix relative links if it's HTML
            content = resp.content
            if "text/html" in resp.headers.get("content-type", ""):
                content_str = content.decode("utf-8", errors="ignore")
                # Very basic relative link fix
                content_str = content_str.replace('href="/', 'href="https://polymarket.com/')
                content_str = content_str.replace('src="/', 'src="https://polymarket.com/')
                content = content_str.encode("utf-8")

            return Response(
                content=content,
                status_code=resp.status_code,
                media_type=resp.headers.get("content-type")
            )
        except Exception as e:
            logger.error(f"Proxy failed for {url}: {e}")
            raise HTTPException(status_code=500, detail=f"Proxy tunnel failed: {str(e)}")
@router.get("/microstructure")
async def get_microstructure_data(request: Request, symbol: str = "BTC", user: Optional[User] = Depends(get_current_user)):
    """
    Institutional Microstructure Intelligence:
    Returns real-time CB Premium, CVD history, and Lead-Lag indicators.
    Now supports multi-asset retrieval via ?symbol=XYZ.
    """
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return {"error": "Intel Engine Offline"}

    from src.intel.providers.microstructure import MicrostructureProvider
    provider = next((p for p in intel_engine.providers if isinstance(p, MicrostructureProvider)), None)
    
    if not provider:
        return {"error": "Microstructure Provider Inactive"}

    # Dynamic State Retrieval
    try:
        # Normalize symbol in case it comes as BTC/USD
        symbol = symbol.split('/')[0].upper()
        state = await provider.get_symbol_state(symbol)
    except Exception as e:
        logger.error(f"Failed to load state for {symbol}: {e}")
        return {"error": f"Data unavailable for {symbol}"}

    # Basic analytics from scale
    history = state.get("history", [])
    current_premium = state.get("cb_premium_bin", 0) 
    spread_usd = state.get("cb_spread_usd", 0)
    
    # Simple risk/bias calculation
    bias = "neutral"
    # Only relevant for BTC really, but we can generalize logic later
    if spread_usd > 30: bias = "institutional_bid"
    elif spread_usd < -30: bias = "institutional_sell"

    return {
        "current": {
            "premium": current_premium,
            "premium_hl": state.get("cb_premium", 0),
            "spread_usd": spread_usd,
            "cvd": state.get("cvd", 0),
            "cvd_binance": state.get("cvd_binance", state.get("cvd", 0)),
            "cvd_coinbase": state.get("cvd_coinbase", 0),
            "open_interest": state.get("open_interest", 0),
            "depth_walls": state.get("depth_walls", {"bid": [], "ask": []}),
            "divergence": state.get("divergence", "NONE"),
            "bias": bias,
            "sentiment": state.get("sentiment_score", 0.5),
            "prices": state.get("raw_prices", {}),
            "ta": state.get("ta", {})
        },
        "history": history,
        "ticker": symbol
    }
