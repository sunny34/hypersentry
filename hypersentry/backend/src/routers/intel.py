from fastapi import APIRouter, Request, Depends, HTTPException
from typing import List, Dict, Any, Optional
import logging
from auth import get_current_user, reset_user_credits_if_needed, require_user, require_pro_user
from models import User
from sqlalchemy.orm import Session
from database import get_db
import datetime
import dateutil.parser

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/intel", tags=["Intelligence"])

@router.get("/ping")
async def ping_intel():
    return {"status": "alive"}

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
    
    # 1. Pro / Admin Bypass
    if user and (user.role == "pro" or user.is_admin):
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
        processed_sig["is_obfuscated"] = True
        processed_sig["recommendation"] = "UPGRADE TO VIEW"
        
        if is_fresh:
            processed_sig["recommendation"] = "LOCKED (FRESH)"
        
        # Strip sub-signals to prevent data leakage in nested news/predictions
        if "signals" in processed_sig:
            processed_sig["signals"] = {"status": "locked"}
            
        processed_signals.append(processed_sig)

    return processed_signals

from pydantic import BaseModel
class DeobfuscateRequest(BaseModel):
    token_obfuscated: str

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
    return nexus.get_alpha_confluence()

@router.get("/debate/{symbol}")
async def get_agent_debate(symbol: str, _user: User = Depends(require_pro_user)):
    """
    Trigger a live multi-agent debate for a specific asset.
    Inspired by the TauricResearch/TradingAgents multi-agent setup.
    """
    from src.agents.debate import MultiAgentDebate
    
    engine = MultiAgentDebate()
    # Mock context for now - in production we'd pass recent prices/news
    context = f"Asset {symbol} is experiencing high volatility near local resistance."
    
    try:
        messages = await engine.run_debate(symbol, context)
        return {"symbol": symbol, "messages": messages}
    except Exception as e:
        logger.error(f"Debate failed: {e}")
        return {"error": str(e)}

@router.get("/proxy")
async def proxy_web(url: str):
    """
    Institutional Proxy Tunnel: Bypasses local ISP blocks by routing through the Sentry node.
    Use with caution.
    """
    import httpx
    from fastapi import Response
    
    # Only allow proxying to verified prediction alpha sites
    allowed_domains = ["polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"]
    if not any(domain in url for domain in allowed_domains):
        raise HTTPException(status_code=403, detail="Domain not in allowlist for High-Fidelity Proxy.")

    async with httpx.AsyncClient() as client:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        }
        try:
            resp = await client.get(url, headers=headers, follow_redirects=True, timeout=10.0)
            
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
