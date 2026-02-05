from fastapi import APIRouter, Depends, Response, Request, HTTPException
from fastapi.responses import JSONResponse
import aiohttp
from sqlalchemy.orm import Session
from models import User, ActiveTrade
from database import get_db
from auth import require_user
from schemas import ArbExecutionRequest, CandlesRequest, AnalyzeRequest, OrderRequest
from src.manager import TraderManager
from src.execution import ArbExecutor
import logging
import json
import time

logger = logging.getLogger()
router = APIRouter(prefix="/trading", tags=["Trading"])
manager = TraderManager() # Singleton

# Simple TTL Cache for "lightning speed"
_tokens_cache = {"data": None, "timestamp": 0}
TOKEN_CACHE_TTL = 1.0 # 1 second

@router.get("/tokens")
async def get_trading_tokens(request: Request):
    """
    Fetch all available trading tokens (Perps & Spot) from Hyperliquid.
    Optimized with shared session and TTL caching for lightning speed.
    """
    global _tokens_cache
    
    # Return cached data if valid
    if _tokens_cache["data"] and (time.time() - _tokens_cache["timestamp"] < TOKEN_CACHE_TTL):
        return _tokens_cache["data"]
        
    tokens = []
    session = getattr(request.app.state, "session", None)
    
    try:
        # Fetch perp metadata and context (prices, 24h stats)
        # We reuse the global session for high performance
        if session:
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "metaAndAssetCtxs"}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                else:
                    raise Exception(f"HL API Error: {resp.status}")
        else:
            # Fallback if session is missing
            async with aiohttp.ClientSession() as fallback_session:
                async with fallback_session.post(
                    "https://api.hyperliquid.xyz/info",
                    json={"type": "metaAndAssetCtxs"}
                ) as resp:
                    data = await resp.json()
        
        # data[0] is meta, data[1] is assetCtxs
        meta = data[0]
        asset_ctxs = data[1]
        
        for i, asset in enumerate(meta.get("universe", [])):
            ctx = asset_ctxs[i] if i < len(asset_ctxs) else {}
            current_price = float(ctx.get("markPx", 0))
            prev_day_px = float(ctx.get("prevDayPx", 0))
            
            change_24h = 0
            if prev_day_px > 0:
                change_24h = ((current_price - prev_day_px) / prev_day_px) * 100
            
            volume = float(ctx.get("dayNtlVlm", 0))
            oi = float(ctx.get("openInterest", 0))
            
            if oi <= 0 or volume <= 0:
                continue

            tokens.append({
                "symbol": asset["name"],
                "pair": f"{asset['name']}/USDC",
                "name": asset["name"],
                "type": "perp",
                "price": current_price,
                "prevPrice": prev_day_px,
                "change24h": change_24h,
                "volume24h": volume,
                "openInterest": oi,
                "funding": float(ctx.get("funding", 0)),
                "maxLeverage": asset.get("maxLeverage", 50),
                "index": i
            })
            
        result = {"tokens": tokens}
        _tokens_cache = {"data": result, "timestamp": time.time()}
        return result
            
    except Exception as e:
        logger.error(f"Failed to fetch tokens: {e}")
        # Return fallback if API fails
        return {"tokens": [
             {"symbol": "BTC", "pair": "BTC/USDC", "name": "Bitcoin", "type": "perp", "price": 0, "change24h": 0},
             {"symbol": "ETH", "pair": "ETH/USDC", "name": "Ethereum", "type": "perp", "price": 0, "change24h": 0}
        ]}


async def fetch_binance_funding_rates(request: Request):
    """Fetch current funding rates from Binance Futures using shared session."""
    url = "https://fapi.binance.com/fapi/v1/premiumIndex"
    session = getattr(request.app.state, "session", None)
    
    async def process_resp(resp):
        if resp.status == 200:
            data = await resp.json()
            rates = {item['symbol'].replace('USDT', ''): float(item['lastFundingRate']) for item in data if item['symbol'].endswith('USDT')}
            return rates, None
        elif resp.status == 403:
            logger.error("Binance API 403 Forbidden. Likely Region Block (US IP).")
            return {}, "Binance Region Blocked (403)"
        else:
            logger.error(f"Binance API Error: {resp.status}")
            return {}, f"Binance Error: {resp.status}"

    try:
        if session:
            async with session.get(url) as resp:
                return await process_resp(resp)
        else:
            async with aiohttp.ClientSession() as fallback_session:
                async with fallback_session.get(url) as resp:
                    return await process_resp(resp)
    except Exception as e:
        logger.error(f"Error fetching Binance rates: {e}")
        return {}, str(e)


@router.get("/arb")
async def get_arb_opportunities(request: Request):
    """
    Scanner for Basis Arbitrage opportunities between Hyperliquid and Binance.
    """
    import asyncio
    
    # Run fetches in parallel
    binance_task = fetch_binance_funding_rates(request)
    hl_task = get_trading_tokens(request) 
    
    binance_result, hl_data = await asyncio.gather(binance_task, hl_task)
    
    binance_rates, binance_error = binance_result
    
    hl_tokens = hl_data.get('tokens', [])
    
    opportunities = []
    
    for t in hl_tokens:
        symbol = t['symbol']
        hl_rate = t['funding'] # hourly
        
        # Binance rate is usually 8h. Need to normalize?
        # Actually Binance 'lastFundingRate' is the rate for the current 8h interval.
        # Hyperliquid 'funding' is the current hourly premium.
        # To compare:
        # HL APR = hl_rate * 24 * 365
        # Bin APR = binance_rate * 3 * 365 (since 8h * 3 = 24h)
        
        # Filter out inactive/zombie markets
        if t['openInterest'] <= 0 or t['volume24h'] <= 0:
            continue
            
        if symbol in binance_rates:
            bin_rate_8h = binance_rates[symbol]
            
            # Annualized %
            hl_apr = hl_rate * 24 * 365 * 100
            bin_apr = bin_rate_8h * 3 * 365 * 100
            
            diff = hl_apr - bin_apr
            
            # Direction Logic
            # If HL > Binance: Short HL (collect pay), Long Binance (pay less/receive)
            # If HL < Binance: Long HL (pay less/receive), Short Binance (collect pay)
            
            direction = "Short HL / Long Binance" if diff > 0 else "Long HL / Short Binance"
            
            opportunities.append({
                "symbol": symbol,
                "hlFunding": hl_rate, # raw hourly
                "binanceFunding": bin_rate_8h, # raw 8h
                "hlApr": hl_apr,
                "binApr": bin_apr,
                "spread": abs(diff),
                "direction": direction
            })
            
    # Sort by absolute spread size
    opportunities.sort(key=lambda x: x['spread'], reverse=True)
    
    return {
        "opportunities": opportunities[:20], 
        "count": len(opportunities),
        "binance_status": binance_error,
        "hl_status": "ok" if hl_tokens else "error/empty"
    }


@router.post("/execute_arb")
async def execute_arb_endpoint(
    req: ArbExecutionRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Execute arbitrage trade using stored keys."""
    executor = ArbExecutor(db)
    
    # 1. Check keys exist
    hl_key, bin_key = await executor.get_user_keys(user.id)
    if not hl_key or not bin_key:
        return Response(content=json.dumps({"error": "Missing keys. Please connect exchanges in Settings."}), status_code=400, media_type="application/json")
        
    # 2. Execute
    result = await executor.execute_arb(user.id, req.symbol, req.size_usd, req.direction)
    return result


@router.get("/active")
async def get_active_trades(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Fetch active arbitrage trades with live PnL."""
    trades = db.query(ActiveTrade).filter(
        ActiveTrade.user_id == user.id,
        ActiveTrade.status == "OPEN"
    ).order_by(ActiveTrade.entry_time.desc()).all()
    
    if not trades:
        return {"trades": []}

    # 1. Fetch Live Prices
    import aiohttp
    import asyncio
    
    async def fetch_binance_prices():
        url = "https://fapi.binance.com/fapi/v1/ticker/price"
        try:
            async with aiohttp.ClientSession(trust_env=True) as session:
                async with session.get(url, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Map symbol -> price
                        return {item['symbol'].replace('USDT', ''): float(item['price']) for item in data if item['symbol'].endswith('USDT')}
        except Exception as e:
            logger.error(f"Binance Price Fetch Error: {e}")
        return {}

    # Run fetches
    # Reuse get_trading_tokens for HL prices
    # Note: efficient way would be to only fetch specific symbols, but HL api is unified usually.
    hl_task = get_trading_tokens() 
    bin_task = fetch_binance_prices()
    
    hl_res, bin_prices = await asyncio.gather(hl_task, bin_task)
    
    # Map HL symbols
    hl_prices = {}
    if 'tokens' in hl_res:
        for t in hl_res['tokens']:
            hl_prices[t['symbol']] = t['price']

    # 2. Calculate PnL
    enriched_trades = []
    
    for t in trades:
        current_hl = hl_prices.get(t.symbol)
        current_bin = bin_prices.get(t.symbol)
        
        pnl = 0.0
        pnl_percent = 0.0
        
        if current_hl and current_bin and t.entry_price_hl and t.entry_price_bin:
             # Logic is roughly:
             # Size is in USD, so Amount = Size / EntryPrice
             
             amt_hl = t.size_usd / t.entry_price_hl
             amt_bin = t.size_usd / t.entry_price_bin
             
             if "Long HL" in t.direction:
                 # Long HL (Profit if Price Up)
                 val_hl = (current_hl - t.entry_price_hl) * amt_hl
                 # Short Binance (Profit if Price Down)
                 val_bin = (t.entry_price_bin - current_bin) * amt_bin
             else:
                 # Short HL (Profit if Price Down)
                 val_hl = (t.entry_price_hl - current_hl) * amt_hl
                 # Long Binance (Profit if Price Up)
                 val_bin = (current_bin - t.entry_price_bin) * amt_bin
                 
             pnl = val_hl + val_bin
             # ROI on total margin used (approx 2 * size_usd)
             pnl_percent = (pnl / (2 * t.size_usd)) * 100
             
        enriched_trades.append({
            "id": str(t.id),
            "symbol": t.symbol,
            "direction": t.direction,
            "size_usd": t.size_usd,
            "entry_time": t.entry_time,
            "entry_price_hl": t.entry_price_hl,
            "entry_price_bin": t.entry_price_bin,
            "current_price_hl": current_hl,
            "current_price_bin": current_bin,
            "pnl": round(pnl, 2),
            "pnl_percent": round(pnl_percent, 2),
            "status": t.status
        })
    
    return {"trades": enriched_trades}


@router.post("/candles")
async def get_candles(req: CandlesRequest):
    """Get candle snapshot via backend proxy."""
    try:
        # Fetch candles using the SDK wrapper
        candles = manager.client.get_candles(
            coin=req.token,
            interval=req.interval,
            start_time=req.start_time,
            end_time=req.end_time
        )
        return candles
    except Exception as e:
        logger.error(f"Failed to fetch candles via proxy: {e}")
        return []

from pydantic import BaseModel
from typing import Optional

class AnalyzeRequest(BaseModel):
    token: str
    interval: Optional[str] = "1h"
    position: Optional[dict] = None

@router.post("/analyze")
async def analyze_chart(req: AnalyzeRequest):
    """
    Get AI analysis for a token based on technical indicators and LLM reasoning.
    """
    import aiohttp
    import numpy as np
    import time
    from config import config
    
    token = req.token.upper()
    
    # Map frontend interval to Hyperliquid
    interval_map = {
        "15": "15m",
        "60": "1h",
        "240": "4h",
        "D": "1d",
        "1D": "1d"
    }
    hl_interval = interval_map.get(req.interval, "1h") if req.interval else "1h"
    
    # Calculate lookback (fetch 150 candles to be safe for EMA50)
    now_ms = int(time.time() * 1000)
    lookback_secs = 150 * (15*60 if hl_interval == "15m" else 3600 if hl_interval == "1h" else 14400 if hl_interval == "4h" else 86400)
    start_ms = now_ms - (lookback_secs * 1000)
    
    try:
        # 1. Fetch Price Candles
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "candleSnapshot", "req": {"coin": token, "interval": hl_interval, "startTime": start_ms, "endTime": now_ms}},
                timeout=5
            ) as resp:
                if resp.status != 200:
                    raise Exception("HL API Error")
                candles = await resp.json()
        
        if not candles or len(candles) < 20:
            # Fallback for new tokens: Try shorter interval if 1h fails
            if hl_interval == "1h":
                 # Redo with 15m
                 return await analyze_chart(AnalyzeRequest(token=token, interval="15", position=req.position))
            raise Exception("Insufficient history")

        closes = np.array([float(c["c"]) for c in candles])
        current_price = closes[-1]
        
        # 2. Technical Calcs
        # RSI 14
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = np.mean(gains[-14:]) if len(gains) >= 14 else np.mean(gains)
        avg_loss = np.mean(losses[-14:]) if len(losses) >= 14 else np.mean(losses)
        rs = avg_gain / avg_loss if avg_loss > 0 else 100
        rsi = 100 - (100 / (1 + rs))
        
        # MACD (12, 26)
        ema_12 = np.mean(closes[-12:])
        ema_26 = np.mean(closes[-26:]) if len(closes) >= 26 else np.mean(closes)
        macd = ema_12 - ema_26
        
        # EMA 50 for trend
        ema_50 = np.mean(closes[-50:]) if len(closes) >= 50 else np.mean(closes)
        trend = "up" if current_price > ema_50 else "down" if current_price < ema_50 * 0.99 else "sideways"

        # 3. Fetch News Sentiment
        news_summaries = []
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"https://min-api.cryptocompare.com/data/v2/news/?categories={token}&limit=3") as n_resp:
                    if n_resp.status == 200:
                        n_data = await n_resp.json()
                        for art in n_data.get("Data", []):
                            news_summaries.append(art.get("title"))
        except: pass

        # 4. Gemini AI Reasoning
        direction = "neutral"
        confidence = 50
        reasoning = "Standard technical evaluation."
        
        if config.GEMINI_API_KEY:
            try:
                import google.generativeai as genai
                genai.configure(api_key=config.GEMINI_API_KEY)
                model = genai.GenerativeModel('gemini-1.5-flash')
                
                # Format Data for AI
                price_brief = [round(float(c['c']), 4) for c in candles[-15:]]
                pos_str = f"Current Position Context: {json.dumps(req.position)}" if req.position else "No current open position."
                news_str = " | ".join(news_summaries[:3]) if news_summaries else "No recent macro news found."
                
                prompt = f"""
                Act as a quantitative institutional trader at a Tier-1 fund. 
                Analyze {token} on the {hl_interval} timeframe.
                
                HISTORICAL CONTEXT:
                - Recent Close Prices (Latest Last): {price_brief}
                - Spot Price: {current_price}
                
                TECHNICAL INDICATORS:
                - RSI (14): {rsi:.1f}
                - MACD Signal: {macd:.4f}
                - EMA 50 Trend: {ema_50:.4f} ({trend})
                
                EXTERNAL ALPHA (NEWS/SENTIMENT):
                {news_str}
                
                USER CONTEXT:
                {pos_str}
                
                GOAL:
                Provide a structured trading recommendation. If a position is open and pnl is deteriorating, consider 'close'.
                
                OUTPUT FORMAT (JSON ONLY):
                {{
                    "direction": "long" | "short" | "neutral" | "close",
                    "confidence": number (0-100),
                    "reasoning": "one concise sentence explaining the alpha"
                }}
                """
                
                ai_resp = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
                data = json.loads(ai_resp.text.strip())
                
                direction = data.get("direction", "neutral").lower()
                confidence = int(data.get("confidence", 50))
                reasoning = data.get("reasoning", "Analysis based on quantitative convergence.")
                
            except Exception as e:
                logger.error(f"Gemini Intelligence Node Error: {e}")
                # Fallback to deterministic Quant Heuristic
                if rsi < 30: 
                    direction, confidence, reasoning = "long", 70, f"RSI Oversold ({rsi:.1f}) on {token}."
                elif rsi > 70: 
                    direction, confidence, reasoning = "short", 70, f"RSI Overbought ({rsi:.1f}) on {token}."
                else:
                    direction, confidence, reasoning = "neutral", 50, "Technical signals showing significant variance."
        else:
            # Heuristic Logic
            if rsi < 30: direction, confidence, reasoning = "long", 65, f"Heuristic: RSI oversold."
            elif rsi > 70: direction, confidence, reasoning = "short", 65, f"Heuristic: RSI overbought."
            
        # Post-process reasoning to include position context if not from AI
        if req.position and "position" not in reasoning.lower():
             pnl = float(req.position.get('pnl', 0))
             if pnl < 0: reasoning += f" | Position in drawdown (-${abs(pnl):.1f}). Watch stops."

        return {
            "direction": direction,
            "confidence": confidence,
            "reasoning": reasoning,
            "indicators": {
                "rsi": float(rsi),
                "macd_signal": "bullish" if macd > 0 else "bearish" if macd < 0 else "neutral",
                "trend": trend
            },
            "timestamp": int(time.time() * 1000)
        }

    except Exception as e:
        logger.error(f"Analysis Failed: {e}")
        return {
            "direction": "neutral",
            "confidence": 0,
            "reasoning": f"Analysis offline ({str(e)}). Check market status.",
            "indicators": {"rsi": 50, "macd_signal": "neutral", "trend": "sideways"},
            "timestamp": int(time.time() * 1000)
        }

@router.post("/order")
async def place_order(
    req: dict, 
    request: Request,
    user: User = Depends(require_user)
):
    """
    Intelligent Order Gateway.
    """
    session = getattr(request.app.state, "session", None)
    
    # Check if this is an Alpha Terminal internal payload (non-standard HL)
    if "token" in req and "side" in req:
        logger.info(f"📊 [AUDIT] Smart Order Request | User: {user.email} | Token: {req.get('token')} | Side: {req.get('side')}")
        
        try:
            coin = req.get("token")
            side = req.get("side")
            size = float(req.get("size", 0))
            is_buy = (side.lower() == "buy")
            
            # Extract TP/SL from metadata
            tp_sl = req.get("tp_sl")
            tp = float(tp_sl["tp"]) if tp_sl and tp_sl.get("tp") else None
            sl = float(tp_sl["sl"]) if tp_sl and tp_sl.get("sl") else None
            
            if size <= 0:
                logger.warning(f"🚫 [AUDIT] Rejected Order: Size too small | User: {user.email}")
                return JSONResponse(status_code=400, content={"status": "err", "error": "Invalid size"})
                
            # Execute via Managed Node
            res = manager.client.managed_trade(
                coin=coin,
                is_buy=is_buy,
                sz=size,
                tp=tp,
                sl=sl
            )
            
            if res.get("status") == "err":
                logger.error(f"❌ [AUDIT] Smart Order Failed | User: {user.email} | Error: {res.get('message') or res.get('error')}")
                return JSONResponse(status_code=400, content=res)
                
            logger.info(f"✅ [AUDIT] Smart Order Success | User: {user.email} | Result: {res.get('status')}")
            return res
            
        except Exception as e:
            logger.error(f"❌ [AUDIT] Smart Order Execution CRITICAL FAILURE: {e}")
            return JSONResponse(status_code=500, content={"status": "err", "error": str(e)})

    # Standard Hyperliquid Relay (expects action, signature, nonce)
    if "action" not in req or "signature" not in req:
         logger.warning(f"🚫 [AUDIT] Malformed Relay Payload | User: {user.email}")
         return JSONResponse(status_code=400, content={
            "status": "error",
            "error": "Invalid payload format. Missing 'action' or 'token' field."
        })
    
    logger.info(f"⚡ [AUDIT] Relay Execution Initiated | User: {user.email}")

    try:
        url = "https://api.hyperliquid.xyz/exchange"
        if session:
            async with session.post(url, json=req) as resp:
                data = await resp.json()
                return data
        else:
            async with aiohttp.ClientSession() as fallback_session:
                async with fallback_session.post(url, json=req) as resp:
                    data = await resp.json()
                    return data
    except Exception as e:
        logger.error(f"Order Relay Error: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})

@router.post("/cancel")
async def cancel_order(
    req: dict, 
    user: User = Depends(require_user)
):
    """
    Cancel order(s) by relaying signed payload.
    """
    import aiohttp
    try:
        url = "https://api.hyperliquid.xyz/exchange"
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=req, headers={"Content-Type": "application/json"}) as resp:
                data = await resp.json()
                return data
    except Exception as e:
        logger.error(f"Cancel Relay Error: {e}")
        return {"status": "error", "error": str(e)}

@router.get("/orders/open")
async def get_open_orders(user: str):
    """Get open orders for a user."""
    try:
        # Use manager client
        orders = manager.client.info.open_orders(user)
        return {"orders": orders}
    except Exception as e:
        logger.error(f"Error fetching open orders: {e}")
        return {"orders": []}

@router.get("/account")
async def get_account(user: str):
    """
    Get user account state (balances, positions, margin) publicly.
    """
    try:
        if not user:
            return {"error": "User address required"}
            
        state = manager.client.get_user_state(user)
        if state is None:
            return {"error": "User not found or API error"}
            
        # Enrich/Calculate total equity
        # State structure: 
        # {
        #   "marginSummary": { "accountValue": "...", "totalMarginUsed": "...", ... },
        #   "crossMarginSummary": { ... },
        #   "assetPositions": [ ... ]
        # }
        
        return state
    except Exception as e:
        logger.error(f"Error fetching account: {e}")
        return {"error": str(e)}

@router.get("/prices")
async def get_all_prices(request: Request):
    """Proxy for Hyperliquid allMids using global session."""
    session = getattr(request.app.state, "session", None)
    try:
        if session:
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "allMids"}
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
        else:
            async with aiohttp.ClientSession() as fallback_session:
                async with fallback_session.post(
                    "https://api.hyperliquid.xyz/info",
                    json={"type": "allMids"}
                ) as resp:
                    return await resp.json()
        return {}
    except Exception as e:
        logger.error(f"Failed to fetch prices: {e}")
        return {}
