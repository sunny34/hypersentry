"""
Market Data Router
Provides real-time market intelligence APIs including liquidations and leaderboard data.
"""

from fastapi import APIRouter, Request
import aiohttp
import logging
import time
from typing import Optional
import asyncio

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/market", tags=["Market Data"])

# Cache for expensive API calls
_leaderboard_cache = {"data": None, "timestamp": 0}
LEADERBOARD_CACHE_TTL = 30  # 30 seconds

_liquidations_cache = {"data": None, "symbol": None, "timestamp": 0}
LIQUIDATIONS_CACHE_TTL = 5  # 5 seconds


@router.get("/liquidations")
async def get_liquidations(
    request: Request,
    coin: Optional[str] = None,
    limit: int = 50
):
    """
    Fetch recent liquidation events from Hyperliquid.
    These are displayed on the chart as markers and in the liquidation firehose.
    """
    global _liquidations_cache
    
    # Check cache
    if (
        _liquidations_cache["data"] and 
        _liquidations_cache["symbol"] == coin and
        (time.time() - _liquidations_cache["timestamp"]) < LIQUIDATIONS_CACHE_TTL
    ):
        return _liquidations_cache["data"][:limit]
    
    aggregator = getattr(request.app.state, "aggregator", None)

    try:
        symbol = coin.upper().split("/")[0] if coin else None
        liquidations = []

        if aggregator is not None:
            if symbol:
                payload = (getattr(aggregator, "data_cache", {}) or {}).get(symbol, {}) or {}
                entries = payload.get("liquidations", []) if isinstance(payload, dict) else []
                for row in entries:
                    if isinstance(row, dict):
                        out = dict(row)
                        out["coin"] = symbol
                        liquidations.append(out)
            else:
                for sym, payload in (getattr(aggregator, "data_cache", {}) or {}).items():
                    entries = payload.get("liquidations", []) if isinstance(payload, dict) else []
                    for row in entries:
                        if isinstance(row, dict):
                            out = dict(row)
                            out["coin"] = str(out.get("coin") or sym).upper()
                            liquidations.append(out)

        if not liquidations:
            return _liquidations_cache["data"][:limit] if _liquidations_cache["data"] else []

        liquidations.sort(key=lambda x: int(x.get("time", 0) or 0), reverse=True)
        limited = liquidations[:limit]

        _liquidations_cache = {
            "data": limited,
            "symbol": coin,
            "timestamp": time.time()
        }
        return limited
    except Exception as e:
        logger.error(f"Failed to fetch liquidations: {e}")
        return _liquidations_cache["data"][:limit] if _liquidations_cache["data"] else []


@router.get("/leaderboard")
async def get_leaderboard(
    request: Request,
    limit: int = 100
):
    """
    Fetch the Hyperliquid trading leaderboard.
    This shows top traders by PnL, used for cohort sentiment analysis.
    """
    global _leaderboard_cache
    
    # Check cache
    if (
        _leaderboard_cache["data"] and
        (time.time() - _leaderboard_cache["timestamp"]) < LEADERBOARD_CACHE_TTL
    ):
        return _leaderboard_cache["data"][:limit]
    
    session = getattr(request.app.state, "session", None)
    
    try:
        # Hyperliquid leaderboard endpoint
        payload = {"type": "leaderboard", "window": "allTime"}
        
        if session:
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json=payload
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                else:
                    raise Exception(f"API returned {resp.status}")
        else:
            async with aiohttp.ClientSession() as fallback:
                async with fallback.post(
                    "https://api.hyperliquid.xyz/info",
                    json=payload
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                    else:
                        raise Exception(f"API returned {resp.status}")
        
        # Process leaderboard data
        leaderboard = []
        
        if isinstance(data, list):
            for entry in data[:limit]:
                leaderboard.append({
                    "address": entry.get("user", entry.get("address", "0x...")),
                    "pnl": float(entry.get("pnl", entry.get("accountValue", 0))),
                    "volume": float(entry.get("vlm", entry.get("volume", 0))),
                    "winRate": float(entry.get("winRate", 0)) * 100 if entry.get("winRate") else None,
                    "recentSide": "long" if float(entry.get("pnl", 0)) > 0 else "short",
                    "recentVolume": float(entry.get("vlm", 0)) / 10000 if entry.get("vlm") else 0
                })
        elif isinstance(data, dict):
            # Handle different response format
            entries = data.get("leaderboard", data.get("data", []))
            for entry in entries[:limit]:
                leaderboard.append({
                    "address": entry.get("user", entry.get("address", "0x...")),
                    "pnl": float(entry.get("pnl", entry.get("accountValue", 0))),
                    "volume": float(entry.get("vlm", entry.get("volume", 0))),
                    "winRate": None,
                    "recentSide": "long" if float(entry.get("pnl", 0)) > 0 else "short",
                    "recentVolume": float(entry.get("vlm", 0)) / 10000 if entry.get("vlm") else 0
                })
        
        # Cache
        _leaderboard_cache = {
            "data": leaderboard,
            "timestamp": time.time()
        }
        
        return leaderboard[:limit]
        
    except Exception as e:
        logger.error(f"Failed to fetch leaderboard: {e}")
        # Return empty list - frontend will use simulated data
        return []


@router.get("/funding_rates")
async def get_all_funding_rates(request: Request):
    """
    Get current funding rates for all perpetual markets.
    """
    aggregator = getattr(request.app.state, "aggregator", None)
    try:
        if aggregator is not None:
            vol_by_symbol = {
                str(row.get("symbol", "")).upper(): float(row.get("day_ntl_vlm", 0) or 0)
                for row in getattr(aggregator, "available_symbols_cache", []) or []
                if row.get("symbol")
            }
            rates = {}
            for symbol, payload in (getattr(aggregator, "data_cache", {}) or {}).items():
                if not isinstance(payload, dict):
                    continue
                price = float(payload.get("price", 0) or 0)
                oi_raw = float(payload.get("oi", 0) or 0)
                funding = float(payload.get("funding", 0) or 0)
                if price <= 0 and oi_raw <= 0 and funding == 0:
                    continue
                rates[symbol] = {
                    "funding": funding,
                    "openInterest": (oi_raw * price) if price > 0 else oi_raw,
                    "markPx": price,
                    "dayVolume": float(vol_by_symbol.get(symbol, 0) or 0),
                }
            if rates:
                return rates
    except Exception as e:
        logger.warning("Failed to build funding rates from aggregator: %s", e)

    session = getattr(request.app.state, "session", None)
    
    try:
        payload = {"type": "metaAndAssetCtxs"}
        
        if session:
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json=payload
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                else:
                    return {}
        else:
            async with aiohttp.ClientSession() as fallback:
                async with fallback.post(
                    "https://api.hyperliquid.xyz/info",
                    json=payload
                ) as resp:
                    data = await resp.json() if resp.status == 200 else {}
        
        if not data or len(data) < 2:
            return {}
        
        meta = data[0]
        ctxs = data[1]
        
        rates = {}
        for i, asset in enumerate(meta.get("universe", [])):
            ctx = ctxs[i] if i < len(ctxs) else {}
            rates[asset["name"]] = {
                "funding": float(ctx.get("funding", 0)),
                "openInterest": float(ctx.get("openInterest", 0)),
                "markPx": float(ctx.get("markPx", 0)),
                "dayVolume": float(ctx.get("dayNtlVlm", 0))
            }
        
        return rates
        
    except Exception as e:
        logger.error(f"Failed to fetch funding rates: {e}")
        return {}


@router.get("/open_interest_history")
async def get_oi_history(
    request: Request,
    coin: str = "BTC",
    hours: int = 24
):
    """
    Get open interest history for a coin (if available).
    """
    # Hyperliquid doesn't provide historical OI via REST currently
    # Return empty - frontend can use current OI only
    return {"coin": coin, "history": [], "note": "Historical OI not available via REST. Use current OI."}


@router.get("/market_summary")
async def get_market_summary(request: Request):
    """
    Get comprehensive market summary including total volume, OI, and sentiment.
    """
    aggregator = getattr(request.app.state, "aggregator", None)
    if aggregator is not None:
        try:
            vol_by_symbol = {
                str(row.get("symbol", "")).upper(): float(row.get("day_ntl_vlm", 0) or 0)
                for row in getattr(aggregator, "available_symbols_cache", []) or []
                if row.get("symbol")
            }
            total_oi = 0.0
            total_volume = 0.0
            positive_funding_count = 0
            negative_funding_count = 0
            for symbol, payload in (getattr(aggregator, "data_cache", {}) or {}).items():
                if not isinstance(payload, dict):
                    continue
                px = float(payload.get("price", 0) or 0)
                oi = float(payload.get("oi", 0) or 0)
                funding = float(payload.get("funding", 0) or 0)
                if oi > 0:
                    total_oi += (oi * px) if px > 0 else oi
                total_volume += float(vol_by_symbol.get(symbol, 0) or 0)
                if funding > 0.0001:
                    positive_funding_count += 1
                elif funding < -0.0001:
                    negative_funding_count += 1

            if total_oi > 0 or total_volume > 0:
                if positive_funding_count > negative_funding_count * 1.5:
                    sentiment = "bullish"
                elif negative_funding_count > positive_funding_count * 1.5:
                    sentiment = "bearish"
                else:
                    sentiment = "neutral"

                return {
                    "totalOpenInterest": total_oi,
                    "total24hVolume": total_volume,
                    "positiveFundingAssets": positive_funding_count,
                    "negativeFundingAssets": negative_funding_count,
                    "marketSentiment": sentiment,
                    "timestamp": int(time.time() * 1000),
                    "source": "aggregator_cache",
                }
        except Exception as e:
            logger.warning("Failed to build market summary from aggregator: %s", e)

    session = getattr(request.app.state, "session", None)
    
    try:
        payload = {"type": "metaAndAssetCtxs"}
        
        if session:
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json=payload
            ) as resp:
                data = await resp.json() if resp.status == 200 else []
        else:
            async with aiohttp.ClientSession() as fallback:
                async with fallback.post(
                    "https://api.hyperliquid.xyz/info",
                    json=payload
                ) as resp:
                    data = await resp.json() if resp.status == 200 else []
        
        if not data or len(data) < 2:
            return {"error": "No data"}
        
        ctxs = data[1]
        
        total_oi = 0
        total_volume = 0
        positive_funding_count = 0
        negative_funding_count = 0
        
        for ctx in ctxs:
            oi = float(ctx.get("openInterest", 0)) * float(ctx.get("markPx", 0))
            vol = float(ctx.get("dayNtlVlm", 0))
            funding = float(ctx.get("funding", 0))
            
            total_oi += oi
            total_volume += vol
            
            if funding > 0.0001:
                positive_funding_count += 1
            elif funding < -0.0001:
                negative_funding_count += 1
        
        # Determine market sentiment
        if positive_funding_count > negative_funding_count * 1.5:
            sentiment = "bullish"
        elif negative_funding_count > positive_funding_count * 1.5:
            sentiment = "bearish"
        else:
            sentiment = "neutral"
        
        return {
            "totalOpenInterest": total_oi,
            "total24hVolume": total_volume,
            "positiveFundingAssets": positive_funding_count,
            "negativeFundingAssets": negative_funding_count,
            "marketSentiment": sentiment,
            "timestamp": int(time.time() * 1000)
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch market summary: {e}")
        return {"error": str(e)}
