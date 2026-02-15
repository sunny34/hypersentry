from fastapi import APIRouter, Depends, Response, Request, HTTPException
from fastapi.responses import JSONResponse
import asyncio
import aiohttp
import os
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
from threading import Lock
from typing import Any, Dict, List

logger = logging.getLogger()
router = APIRouter(prefix="/trading", tags=["Trading"])
manager = TraderManager() # Singleton


def _env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


ENABLE_SERVER_SIDE_TRADING = _env_flag("ENABLE_SERVER_SIDE_TRADING", "false")
REQUIRE_ADMIN_FOR_SERVER_TRADING = _env_flag("REQUIRE_ADMIN_FOR_SERVER_TRADING", "true")
PREFER_AGGREGATOR_MARKET_DATA = _env_flag("TRADING_PREFER_AGGREGATOR_MARKET_DATA", "true")

# Simple TTL Cache for "lightning speed"
_tokens_cache = {"data": None, "timestamp": 0}
TOKEN_CACHE_TTL = max(1.0, float(os.getenv("TRADING_TOKENS_CACHE_SEC", "20.0")))
_prices_cache = {"data": None, "timestamp": 0}
PRICES_CACHE_TTL = max(0.5, float(os.getenv("TRADING_PRICES_CACHE_SEC", "2.0")))
_account_cache: Dict[str, Dict[str, Any]] = {}
ACCOUNT_CACHE_TTL = max(1.0, float(os.getenv("TRADING_ACCOUNT_CACHE_SEC", "5.0")))
_open_orders_cache: Dict[str, Dict[str, Any]] = {}
OPEN_ORDERS_CACHE_TTL = max(1.0, float(os.getenv("TRADING_OPEN_ORDERS_CACHE_SEC", "5.0")))
_orderbook_snapshot_cache: Dict[str, Dict[str, Any]] = {}
_orderbook_upstream_last_attempt: Dict[str, float] = {}
ORDERBOOK_CACHE_TTL = max(0.5, float(os.getenv("TRADING_ORDERBOOK_CACHE_SEC", "2.0")))
ORDERBOOK_UPSTREAM_MIN_INTERVAL = max(1.0, float(os.getenv("TRADING_ORDERBOOK_UPSTREAM_MIN_SEC", "5.0")))
ORDERBOOK_AGGREGATOR_FRESH_SEC = max(1.0, float(os.getenv("TRADING_ORDERBOOK_AGG_FRESH_SEC", "3.0")))
ORDERBOOK_AGGREGATOR_RATE_LIMIT_BACKOFF_SEC = max(
    5.0, float(os.getenv("TRADING_ORDERBOOK_AGG_BACKOFF_SEC", "45.0"))
)
_candles_cache: Dict[str, Dict[str, Any]] = {}
CANDLES_CACHE_TTL = max(0.5, float(os.getenv("TRADING_CANDLES_CACHE_SEC", "2.5")))

_singleflight_tasks: Dict[str, asyncio.Task] = {}
_singleflight_guard = Lock()

_hl_rate_limited_until = 0.0
_hl_backoff_sec = 2.0
HL_RATE_LIMIT_BACKOFF_MAX_SEC = 60.0
_warn_throttle_until: Dict[str, float] = {}
WARN_THROTTLE_SEC = max(1.0, float(os.getenv("TRADING_WARN_THROTTLE_SEC", "30.0")))


def _in_hl_cooldown(now: float | None = None) -> bool:
    current = now if now is not None else time.time()
    return current < float(_hl_rate_limited_until)


def _mark_hl_rate_limited(context: str, status: int | None = None):
    global _hl_rate_limited_until, _hl_backoff_sec
    now = time.time()
    _hl_rate_limited_until = max(_hl_rate_limited_until, now + _hl_backoff_sec)
    logger.warning(
        "HL rate limited context=%s status=%s cooldown=%.1fs",
        context,
        status,
        _hl_backoff_sec,
    )
    _hl_backoff_sec = min(HL_RATE_LIMIT_BACKOFF_MAX_SEC, _hl_backoff_sec * 1.7)


def _mark_hl_success():
    global _hl_rate_limited_until, _hl_backoff_sec
    _hl_backoff_sec = 2.0
    if _hl_rate_limited_until and time.time() >= _hl_rate_limited_until:
        _hl_rate_limited_until = 0.0


def _looks_rate_limited(exc: Exception) -> bool:
    text = str(exc).lower()
    return "429" in text or "rate limited" in text


def _warn_throttled(key: str, message: str, *args):
    now = time.time()
    if now < _warn_throttle_until.get(key, 0.0):
        return
    _warn_throttle_until[key] = now + WARN_THROTTLE_SEC
    logger.warning(message, *args)


def _is_aggregator_rate_limited_outage(aggregator: Any, now: float | None = None) -> bool:
    if aggregator is None:
        return False
    if getattr(aggregator, "upstream_connected", False):
        return False
    reason = str(getattr(aggregator, "last_ws_close_reason", "") or "").lower()
    if "429" not in reason and "rate limited" not in reason:
        return False
    current = now if now is not None else time.time()
    close_ts = float(getattr(aggregator, "last_ws_close_ts", 0.0) or 0.0)
    if close_ts <= 0:
        return True
    return (current - close_ts) < ORDERBOOK_AGGREGATOR_RATE_LIMIT_BACKOFF_SEC


async def _run_singleflight(task_key: str, factory):
    with _singleflight_guard:
        task = _singleflight_tasks.get(task_key)
        if task is None or task.done():
            task = asyncio.create_task(factory())
            _singleflight_tasks[task_key] = task
    try:
        return await task
    finally:
        if task.done():
            with _singleflight_guard:
                existing = _singleflight_tasks.get(task_key)
                if existing is task:
                    _singleflight_tasks.pop(task_key, None)

@router.get("/tokens")
async def get_trading_tokens(request: Request):
    """
    Fetch all available trading tokens (Perps & Spot) from Hyperliquid.
    Optimized with shared session and TTL caching for lightning speed.
    """
    global _tokens_cache

    now = time.time()
    if _tokens_cache["data"] and (now - _tokens_cache["timestamp"] < TOKEN_CACHE_TTL):
        return _tokens_cache["data"]

    aggregator = getattr(request.app.state, "aggregator", None)

    async def _refresh_tokens():
        global _tokens_cache
        local_now = time.time()
        session = getattr(request.app.state, "session", None)
        tokens: List[Dict[str, Any]] = []

        if PREFER_AGGREGATOR_MARKET_DATA and aggregator is not None:
            try:
                rows = await aggregator.refresh_available_symbols(force=False)
            except Exception:
                rows = []
            if rows:
                for idx, row in enumerate(rows):
                    symbol = str(row.get("symbol", "")).upper()
                    if not symbol:
                        continue
                    cache = (getattr(aggregator, "data_cache", {}) or {}).get(symbol, {}) or {}
                    price = float(cache.get("price", 0) or 0)
                    volume = float(row.get("day_ntl_vlm", 0) or 0)
                    raw_oi = float(cache.get("oi", 0) or 0)
                    oi_notional = raw_oi * price if price > 0 else raw_oi
                    tokens.append(
                        {
                            "symbol": symbol,
                            "pair": f"{symbol}/USDC",
                            "name": symbol,
                            "type": "perp",
                            "price": price,
                            "prevPrice": price,
                            "change24h": 0.0,
                            "volume24h": volume,
                            "openInterest": oi_notional,
                            "funding": float(cache.get("funding", 0) or 0),
                            "maxLeverage": 50,
                            "index": int(row.get("index", idx)),
                        }
                    )
                if tokens:
                    result = {"tokens": tokens}
                    _tokens_cache = {"data": result, "timestamp": local_now}
                    return result

        if _in_hl_cooldown(local_now):
            if _tokens_cache["data"]:
                return _tokens_cache["data"]
            return {"tokens": []}

        async def _fetch_with(sess):
            async with sess.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "metaAndAssetCtxs"},
            ) as resp:
                if resp.status == 429:
                    _mark_hl_rate_limited("tokens", status=429)
                    return None
                if resp.status != 200:
                    raise Exception(f"HL API Error: {resp.status}")
                return await resp.json()

        try:
            if session:
                data = await _fetch_with(session)
            else:
                async with aiohttp.ClientSession() as fallback_session:
                    data = await _fetch_with(fallback_session)

            if not data:
                if _tokens_cache["data"]:
                    return _tokens_cache["data"]
                return {"tokens": []}

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
                raw_oi = float(ctx.get("openInterest", 0))
                oi_notional = raw_oi * current_price
                if raw_oi <= 0 or volume <= 0:
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
                    "openInterest": oi_notional,
                    "funding": float(ctx.get("funding", 0)),
                    "maxLeverage": asset.get("maxLeverage", 50),
                    "index": i
                })

            result = {"tokens": tokens}
            _tokens_cache = {"data": result, "timestamp": local_now}
            _mark_hl_success()
            return result
        except Exception as e:
            if _looks_rate_limited(e):
                _mark_hl_rate_limited("tokens_exception")
            logger.error(f"Failed to fetch tokens: {e}")
            if _tokens_cache["data"]:
                return _tokens_cache["data"]
            return {"tokens": [
                {"symbol": "BTC", "pair": "BTC/USDC", "name": "Bitcoin", "type": "perp", "price": 0, "change24h": 0},
                {"symbol": "ETH", "pair": "ETH/USDC", "name": "Ethereum", "type": "perp", "price": 0, "change24h": 0}
            ]}

    return await _run_singleflight("trading:tokens", _refresh_tokens)


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
    """Fetch active arbitrage trades with live PnL (Admins see all)."""
    query = db.query(ActiveTrade).filter(ActiveTrade.status == "OPEN")
    
    if not user.is_admin:
        query = query.filter(ActiveTrade.user_id == user.id)
        
    trades = query.order_by(ActiveTrade.entry_time.desc()).all()
    
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
    hl_task = get_trading_tokens(request)
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
async def get_candles(req: CandlesRequest, request: Request = None):
    """
    Get candle snapshot via direct API call with Binance Fallback.
    """
    # Normalize token (BTC-USD -> BTC)
    token = req.token.split('-')[0].split('/')[0].upper()
    logger.debug("CANDLES fetch token=%s raw=%s interval=%s", token, req.token, req.interval)

    cache_key = f"{token}:{req.interval}:{int(req.start_time)}:{int(req.end_time)}"
    now = time.time()
    cached = _candles_cache.get(cache_key)
    if cached and (now - cached["timestamp"]) < CANDLES_CACHE_TTL:
        return cached["data"]

    session = None
    if request is not None and getattr(request, "app", None) is not None:
        session = getattr(request.app.state, "session", None)

    async def fetch_hl(http_session):
        if _in_hl_cooldown():
            return []
        try:
            async with http_session.post(
                "https://api.hyperliquid.xyz/info",
                json={
                    "type": "candleSnapshot", 
                    "req": {
                        "coin": token, 
                        "interval": req.interval, 
                        "startTime": int(req.start_time), 
                        "endTime": int(req.end_time)
                    }
                },
                timeout=3
            ) as resp:
                if resp.status == 200:
                    _mark_hl_success()
                    return await resp.json()
                elif resp.status == 429:
                    _mark_hl_rate_limited("candles", status=429)
                    logger.warning("HL rate limited (429) on candles token=%s", token)
        except Exception as exc:
            if _looks_rate_limited(exc):
                _mark_hl_rate_limited("candles_exception")
            logger.debug("HL candles fetch failed token=%s err=%s", token, exc)
        return []

    async def fetch_binance(http_session):
        # Map interval (HL format to Binance format)
        # HL: 1m, 5m, 15m, 1h, 4h, 1d...
        # Binance: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
        
        b_interval = req.interval
        
        # Legacy frontend compatibility
        if req.interval == "60": b_interval = "1h"
        if req.interval == "240": b_interval = "4h" 
        if req.interval == "D": b_interval = "1d"
        
        # Validate binance supports it, else default to 1h
        valid_binance = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
        if b_interval not in valid_binance:
            b_interval = "1h"

        symbol = f"{token}USDT"
        try:
            url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={b_interval}&startTime={int(req.start_time)}&endTime={int(req.end_time)}&limit=1000"
            async with http_session.get(url, timeout=3) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    # Map to HL format: {t, o, h, l, c, v}
                    return [{
                        "t": int(k[0]),
                        "o": k[1],
                        "h": k[2],
                        "l": k[3],
                        "c": k[4],
                        "v": k[5]
                    } for k in data]
        except Exception as e:
            logger.warning("Binance candles fallback failed token=%s err=%s", token, e)
        return []

    async def _load_candles():
        local_cached = _candles_cache.get(cache_key)
        if local_cached and (time.time() - local_cached["timestamp"]) < CANDLES_CACHE_TTL:
            return local_cached["data"]

        async def _fetch_with(http_session):
            candles = await fetch_hl(http_session)
            if not candles and token in ["BTC", "ETH", "SOL", "BNB", "AVAX", "DOGE", "LINK", "ARB"]:
                logger.info("Switching to Binance candles fallback token=%s", token)
                candles = await fetch_binance(http_session)
            return candles

        if session:
            candles = await _fetch_with(session)
        else:
            async with aiohttp.ClientSession() as fallback_session:
                candles = await _fetch_with(fallback_session)

        if candles:
            _candles_cache[cache_key] = {"data": candles, "timestamp": time.time()}
            logger.info("Candles fetched token=%s count=%s", token, len(candles))
            return candles

        logger.warning("Candles fetch failed all sources token=%s", token)
        return local_cached["data"] if local_cached else []

    return await _run_singleflight(f"trading:candles:{cache_key}", _load_candles)

from pydantic import BaseModel
from typing import Optional

class AnalyzeRequest(BaseModel):
    token: str
    interval: Optional[str] = "1h"
    position: Optional[dict] = None

@router.get("/external-walls/{coin}")
async def get_external_walls(coin: str):
    """
    Fetch substantial limit order walls from Binance and Coinbase.
    Optimized: Returns background-cached data for O(1) response time.
    """
    data = manager.passive_walls.get_walls(coin)
    return data

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
        except Exception as exc:
            logger.debug("News sentiment fetch failed token=%s err=%s", token, exc)

        # 4. Insider Context (Order Book & Walls)
        insider_signals = {
            "spoofing": "No anomalies detected.",
            "whale_bias": "Neutral order flow."
        }
        try:
            # Fetch L2 Snapshot for Order Book Analysis
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.hyperliquid.xyz/info",
                    json={"type": "l2Snapshot", "coin": token},
                    timeout=3
                ) as resp:
                    if resp.status == 200:
                        l2 = await resp.json()
                        bids = l2.get("levels", [])[0] # List of [px, sz]
                        asks = l2.get("levels", [])[1]
                        
                        if bids and asks:
                            # 1. Whale Walls (Spoofing Heuristic)
                            # Find if any single level has > 3x the average volume of top 10 levels
                            top_10_bid_vol = [float(b['sz']) for b in bids[:10]]
                            top_10_ask_vol = [float(a['sz']) for a in asks[:10]]
                            avg_bid_vol = np.mean(top_10_bid_vol)
                            avg_ask_vol = np.mean(top_10_ask_vol)
                            
                            max_bid = max(top_10_bid_vol)
                            max_ask = max(top_10_ask_vol)
                            
                            if max_bid > avg_bid_vol * 4:
                                insider_signals["spoofing"] = "Large BID wall detected (Potential Accumulation/Spoof Support)."
                            elif max_ask > avg_ask_vol * 4:
                                insider_signals["spoofing"] = "Large ASK wall detected (Potential Suppression/Spoof Resistance)."
                                
                            # 2. Imbalance (Whale Bias)
                            total_bid_depth = sum(top_10_bid_vol)
                            total_ask_depth = sum(top_10_ask_vol)
                            ratio = total_bid_depth / total_ask_depth if total_ask_depth > 0 else 1
                            
                            if ratio > 1.5:
                                insider_signals["whale_bias"] = "Strong Buy Side Depth (Bids > Asks)."
                            elif ratio < 0.66:
                                insider_signals["whale_bias"] = "Heavy Sell Side Pressure (Asks > Bids)."
                            else:
                                insider_signals["whale_bias"] = "Balanced order book liquidity."
        except Exception as e:
            logger.warning(f"L2 Analysis failed: {e}")

        # 5. Global Spot Liquidity Analysis (Binance + Coinbase + Hyperliquid)
        # Using aiohttp to fetch public REST Order Books
        spot_context = {
            "binance": {"bid_vol": 0, "ask_vol": 0, "price": 0, "active": False},
            "coinbase": {"bid_vol": 0, "ask_vol": 0, "price": 0, "active": False}
        }
        
        try:
            # Map symbol to external exchanges
            # Binance: BTCUSDT, ETHUSDT
            # Coinbase: BTC-USD, ETH-USD
            binance_sym = f"{token}USDT"
            coinbase_sym = f"{token}-USD"
            
            async with aiohttp.ClientSession() as session:
                # Binance Depth (REST API v3)
                try:
                    async with session.get(f"https://api.binance.com/api/v3/depth?symbol={binance_sym}&limit=20", timeout=2) as b_resp:
                        if b_resp.status == 200:
                            b_data = await b_resp.json()
                            spot_context["binance"]["bid_vol"] = sum([float(x[1]) for x in b_data.get("bids", [])])
                            spot_context["binance"]["ask_vol"] = sum([float(x[1]) for x in b_data.get("asks", [])])
                            spot_context["binance"]["price"] = float(b_data["bids"][0][0]) if b_data["bids"] else 0
                            spot_context["binance"]["active"] = True
                except Exception as exc:
                    logger.debug("Binance spot depth fetch failed token=%s err=%s", token, exc)

                # Coinbase Depth (REST API Product Book)
                try:
                    async with session.get(f"https://api.exchange.coinbase.com/products/{coinbase_sym}/book?level=2", timeout=2) as c_resp:
                        if c_resp.status == 200:
                            c_data = await c_resp.json()
                            spot_context["coinbase"]["bid_vol"] = sum([float(x[1]) for x in c_data.get("bids", [])[:20]])
                            spot_context["coinbase"]["ask_vol"] = sum([float(x[1]) for x in c_data.get("asks", [])[:20]])
                            spot_context["coinbase"]["price"] = float(c_data["bids"][0][0]) if c_data["bids"] else 0
                            spot_context["coinbase"]["active"] = True
                except Exception as exc:
                    logger.debug("Coinbase spot depth fetch failed token=%s err=%s", token, exc)

            # Cross-Exchange Analysis Logic
            active_spots = [ex for ex, data in spot_context.items() if data["active"]]
            total_spot_bid = sum(data["bid_vol"] for data in spot_context.values())
            total_spot_ask = sum(data["ask_vol"] for data in spot_context.values())
            
            # 1. Spot-Perp Divergence (Lead-Lag)
            if active_spots:
                spot_avg_price = sum(spot_context[ex]["price"] for ex in active_spots) / len(active_spots)
                
                if spot_avg_price > current_price * 1.001: # Spot > Perp by 0.1%
                    insider_signals["whale_bias"] += " | Validated by Spot Premium (Spot > Perp)."
                elif spot_avg_price < current_price * 0.999:
                     insider_signals["whale_bias"] += " | Caution: Spot Discount (Spot < Perp)."

            # 2. Wall Verification (Spoofing Check)
            # Only perform if we have active spot markets to compare against
            if active_spots and "wall detected" in insider_signals["spoofing"].lower():
                is_bid_wall = "BID" in insider_signals["spoofing"]
                spot_side_vol = total_spot_bid if is_bid_wall else total_spot_ask
                opp_side_vol = total_spot_ask if is_bid_wall else total_spot_bid
                
                # If Spot volume is tiny compared to the "wall", it's likely manipulative perp spoofing
                # Threshold: Spot volume < 50% of opposite side volume (heuristic)
                if spot_side_vol > 0 and spot_side_vol < opp_side_vol * 0.5:
                     insider_signals["spoofing"] += f" ⚠️ LIKELY SPOOF: No confirming wall on {', '.join([ex.title() for ex in active_spots])}."
                else:
                     insider_signals["spoofing"] += f" ✅ CONFIRMED: Matching liquidity on {', '.join([ex.title() for ex in active_spots])}."
            elif not active_spots:
                 if "wall detected" in insider_signals["spoofing"].lower():
                     insider_signals["spoofing"] += " (Unverified: No Spot Data)"
                     
        except Exception as e:
            logger.warning(f"Cross-Exchange Analysis failed: {e}")

        # 6. Gemini AI Reasoning
        direction = "neutral"
        confidence = 50
        reasoning = "Standard technical evaluation."
        
        if config.GEMINI_API_KEY:
            try:
                from google import genai
                client = genai.Client(api_key=config.GEMINI_API_KEY)
                
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
                
                INSIDER ORDER BOOK ACITVITY (HYPERLIQUID + BINANCE + COINBASE):
                - Wall Detection: {insider_signals['spoofing']}
                - Liquidity Bias: {insider_signals['whale_bias']}
                - Spot vs Perp Price: {current_price} (HL) vs {spot_context['binance']['price']} (Binance)
                
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
                
                ai_resp = client.models.generate_content(
                    model='gemini-flash-latest',
                    contents=prompt, 
                    config={"response_mime_type": "application/json"}
                )
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
            "insider_signals": insider_signals,
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
    Handles both 'managed' trades (TP/SL) and raw 'relay' signatures from the Agent.
    """
    session = getattr(request.app.state, "session", None)
    # Revenue Capture Configuration
    # This address should be the project's institutional multisig/treasury
    REVENUE_MULTISIG = "0x8186f2bB27352358F6F413988514936dCf80Cc29"
    PROTOCOL_MARKUP_BPS = 1.0 # 0.01% logic
    
    # Audit log for every attempt
    logger.info(f"📥 [ORDER] Incoming request from {user.email}")
    logger.debug(f"Payload: {json.dumps(req, default=str)}")

    async def log_revenue_event(token_symbol, side, size_val, price_val):
        """Helper to track protocol revenue generated by a trade."""
        notional = float(size_val) * float(price_val)
        markup_usd = notional * (PROTOCOL_MARKUP_BPS / 10000.0)
        logger.info(f"💰 [REVENUE] Generated ${markup_usd:.6f} from {token_symbol} {side} order. Transfer pending to {REVENUE_MULTISIG}")
        # In a real Hyperliquid flow, we would trigger a .transfer() here if using a sub-account model

    # 1. Managed Trade Path (Used when 1-Click is OFF or specifically requested)
    if all(k in req for k in ["token", "side", "size"]):
        logger.info(f"📊 [AUDIT] Managed Order Request | Token: {req.get('token')} | Side: {req.get('side')}")

        if not ENABLE_SERVER_SIDE_TRADING:
            return JSONResponse(
                status_code=403,
                content={
                    "status": "err",
                    "error": "Server-side managed trading is disabled. Use signed relay mode with action+signature.",
                },
            )
        if REQUIRE_ADMIN_FOR_SERVER_TRADING and not user.is_admin:
            return JSONResponse(
                status_code=403,
                content={
                    "status": "err",
                    "error": "Server-side managed trading is restricted. Use signed relay mode with action+signature.",
                },
            )
        
        try:
            hl_client = manager.hl_client
            if not hl_client:
                return JSONResponse(status_code=503, content={"status": "err", "error": "Trading client unavailable"})

            can_sign = getattr(hl_client, "can_use_server_signing", lambda: True)()
            if not can_sign:
                return JSONResponse(
                    status_code=403,
                    content={
                        "status": "err",
                        "error": "No valid server signing key configured. Use signed relay mode with action+signature.",
                    },
                )

            coin = req.get("token")
            side = req.get("side")
            size = float(req.get("size", 0))
            is_buy = (side.lower() == "buy")
            
            # Extract TP/SL and TWAP
            tp_sl = req.get("tp_sl")
            tp = float(tp_sl["tp"]) if tp_sl and tp_sl.get("tp") is not None else None
            sl = float(tp_sl["sl"]) if tp_sl and tp_sl.get("sl") is not None else None
            twap = req.get("twap")
            
            if size <= 0:
                return JSONResponse(status_code=400, content={"status": "err", "error": "Invalid size"})
                
            # Execute via Managed Node
            res = await hl_client.managed_trade(coin=coin, is_buy=is_buy, sz=size, tp=tp, sl=sl, twap=twap)
            
            if res.get("status") == "err":
                logger.error(f"❌ [AUDIT] Managed Order Failed: {res.get('message')}")
                return JSONResponse(status_code=400, content=res)
                
            if res.get("status") == "ok":
                # Get current mark price for revenue calc (approximate)
                await log_revenue_event(coin, side, size, 0) # price fallback to 0 if not sent
            return res
            
        except Exception as e:
            logger.error(f"❌ [AUDIT] Managed Order CRITICAL FAILURE: {e}")
            return JSONResponse(status_code=500, content={"status": "err", "error": str(e)})

    # 2. Relay Path (Used for 1-Click / Agent signatures)
    if "action" in req and "signature" in req:
        logger.info(f"⚡ [AUDIT] Relay Execution | User: {user.email}")
        
        try:
            url = "https://api.hyperliquid.xyz/exchange"
            payload = req
            
            # Use shared session for high performance
            if session:
                # Capture metadata for revenue tracking before sending
                action = req.get("action", {})
                if action.get("type") == "order":
                    orders = action.get("orders", [])
                    for o in orders:
                        # Asset mapping needed for relay path
                        await log_revenue_event(str(o.get('a', 'unknown')), 'buy' if o.get('b') else 'sell', o.get('s', 0), o.get('p', 0))

                async with session.post(url, json=payload, timeout=10) as resp:
                    try:
                        data = await resp.json()
                    except Exception:
                        # Fallback for text errors (e.g. cloudflare blocks or HL-specific text responses)
                        text = await resp.text()
                        logger.error(f"❌ [RELAY] Non-JSON Response ({resp.status}): {text[:200]}")
                        data = {"status": "err", "error": f"{resp.status}: {text[:100]}"}
                    
                    logger.info(f"✅ [RELAY] Response: {data.get('status')}")
                    return data
            else:
                async with aiohttp.ClientSession() as fallback_session:
                    async with fallback_session.post(url, json=payload) as resp:
                        try:
                            return await resp.json()
                        except Exception:
                            text = await resp.text()
                            return {"status": "err", "error": f"{resp.status}: {text[:100]}"}
        except Exception as e:
            logger.error(f"❌ [RELAY] Relay Error: {e}")
            return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})

    # 3. Fallback for malformed requests
    logger.warning(f"🚫 [AUDIT] Malformed Request: {list(req.keys())}")
    return JSONResponse(status_code=422, content={
        "status": "error",
        "error": "Invalid payload. Needs either [token, side, size] or [action, signature]."
    })

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
    if not user:
        return {"orders": []}

    key = user.lower()
    now = time.time()
    cached = _open_orders_cache.get(key)
    if cached and (now - cached["timestamp"]) < OPEN_ORDERS_CACHE_TTL:
        return {"orders": cached["data"]}
    if _in_hl_cooldown(now) and cached:
        return {"orders": cached["data"]}

    async def _load_open_orders():
        local_cached = _open_orders_cache.get(key)
        hl_client = manager.hl_client
        if not hl_client:
            _mark_hl_rate_limited("open_orders_client_unavailable")
            _warn_throttled(
                "open_orders_client_unavailable",
                "HL client unavailable for open orders; serving cached/empty user=%s",
                user,
            )
            if local_cached:
                return local_cached["data"]
            return []
        try:
            orders = await asyncio.to_thread(hl_client.get_open_orders, user)
            if orders is None:
                if local_cached:
                    return local_cached["data"]
                return []
            _open_orders_cache[key] = {"data": orders, "timestamp": time.time()}
            _mark_hl_success()
            return orders
        except Exception as e:
            if _looks_rate_limited(e):
                _mark_hl_rate_limited("open_orders_exception")
                _warn_throttled("open_orders_rate_limited", "Open orders fetch rate limited user=%s", user)
            else:
                logger.error("Error fetching open orders user=%s err=%s", user, e)
            if local_cached:
                return local_cached["data"]
            return []

    try:
        orders = await _run_singleflight(f"trading:open_orders:{key}", _load_open_orders)
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

        key = user.lower()
        now = time.time()
        cached = _account_cache.get(key)
        if cached and (now - cached["timestamp"]) < ACCOUNT_CACHE_TTL:
            return cached["data"]
        if _in_hl_cooldown(now) and cached:
            return cached["data"]

        async def _load_account_state():
            local_cached = _account_cache.get(key)
            hl_client = manager.hl_client
            if not hl_client:
                _mark_hl_rate_limited("account_client_unavailable")
                _warn_throttled(
                    "account_client_unavailable",
                    "HL client unavailable for account state; serving cached/degraded user=%s",
                    user,
                )
                if local_cached:
                    return local_cached["data"]
                return {"error": "Trading client unavailable"}
            try:
                state = await asyncio.to_thread(hl_client.get_user_state, user)
                if state is None:
                    if local_cached:
                        return local_cached["data"]
                    return {"error": "User not found or API error"}
                _account_cache[key] = {"data": state, "timestamp": time.time()}
                _mark_hl_success()
                return state
            except Exception as e:
                if _looks_rate_limited(e):
                    _mark_hl_rate_limited("account_exception")
                    _warn_throttled("account_rate_limited", "Account fetch rate limited user=%s", user)
                else:
                    logger.error("Error fetching account user=%s err=%s", user, e)
                if local_cached:
                    return local_cached["data"]
                return {"error": str(e)}

        return await _run_singleflight(f"trading:account:{key}", _load_account_state)
    except Exception as e:
        logger.error(f"Error fetching account: {e}")
        cached = _account_cache.get(user.lower())
        if cached:
            return cached["data"]
        return {"error": str(e)}

@router.get("/prices")
async def get_all_prices(request: Request):
    """Proxy for Hyperliquid allMids using global session."""
    global _prices_cache
    now = time.time()
    if _prices_cache["data"] and (now - _prices_cache["timestamp"] < PRICES_CACHE_TTL):
        return _prices_cache["data"]

    aggregator = getattr(request.app.state, "aggregator", None)
    agg_prices = {}
    if aggregator is not None:
        try:
            for sym, payload in getattr(aggregator, "data_cache", {}).items():
                px = float((payload or {}).get("price", 0.0) or 0.0)
                if px > 0:
                    agg_prices[sym] = px
        except Exception:
            agg_prices = {}

    if PREFER_AGGREGATOR_MARKET_DATA and agg_prices:
        merged = dict(_prices_cache["data"] or {})
        merged.update(agg_prices)
        _prices_cache = {"data": merged, "timestamp": now}
        return merged

    if _in_hl_cooldown(now):
        merged = dict(_prices_cache["data"] or {})
        merged.update(agg_prices)
        return merged

    async def _refresh_prices():
        global _prices_cache
        session = getattr(request.app.state, "session", None)

        async def _fetch_with(sess):
            async with sess.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "allMids"},
            ) as resp:
                if resp.status == 429:
                    _mark_hl_rate_limited("prices", status=429)
                    return None
                if resp.status != 200:
                    raise Exception(f"HL prices status={resp.status}")
                return await resp.json()

        try:
            if session:
                data = await _fetch_with(session)
            else:
                async with aiohttp.ClientSession() as fallback_session:
                    data = await _fetch_with(fallback_session)

            if data:
                merged = dict(data)
                if agg_prices:
                    merged.update(agg_prices)
                _prices_cache = {"data": merged, "timestamp": time.time()}
                _mark_hl_success()
                return merged
            merged = dict(_prices_cache["data"] or {})
            merged.update(agg_prices)
            return merged
        except Exception as e:
            if _looks_rate_limited(e):
                _mark_hl_rate_limited("prices_exception")
            logger.error(f"Failed to fetch prices: {e}")
            merged = dict(_prices_cache["data"] or {})
            merged.update(agg_prices)
            return merged

    return await _run_singleflight("trading:prices", _refresh_prices)

@router.get("/orderbook")
async def get_orderbook_snapshot(request: Request, coin: str = "BTC", depth: int = 40):
    """
    Return order book for a symbol with cache-first fallback:
    1) Aggregator in-memory cache (fast path)
    2) Hyperliquid l2Snapshot (repair path)
    """
    symbol = (coin or "BTC").strip().upper().split("/")[0]
    safe_depth = max(5, min(int(depth or 40), 100))
    now = time.time()

    cached_snapshot = _orderbook_snapshot_cache.get(symbol)
    if cached_snapshot and (now - cached_snapshot["timestamp"]) < ORDERBOOK_CACHE_TTL:
        return {
            "coin": symbol,
            "book": cached_snapshot["book"],
            "price": cached_snapshot["price"],
            "source": cached_snapshot["source"],
            "book_ts": int(cached_snapshot.get("book_ts", 0) or 0),
            "timestamp": int(now * 1000),
        }

    aggregator = getattr(request.app.state, "aggregator", None)
    cached = {}
    if aggregator is not None:
        cached = aggregator.data_cache.get(symbol, {}) or {}
        book = cached.get("book", [[], []])
        book_ts_ms = int(cached.get("book_ts", 0) or 0)
        if book_ts_ms <= 0:
            # Backwards compatibility for legacy cache payloads that predate `book_ts`.
            legacy_ts_ms = int(cached.get("updated_at", 0) or 0)
            if legacy_ts_ms > 0:
                book_ts_ms = legacy_ts_ms
            elif cached_snapshot:
                book_ts_ms = int(
                    cached_snapshot.get("book_ts", 0)
                    or int(float(cached_snapshot.get("timestamp", now)) * 1000)
                    or 0
                )
            else:
                # If a non-empty book exists but carries no timestamp, allow one pass.
                book_ts_ms = int(now * 1000)
        book_age_sec = (now - (book_ts_ms / 1000.0)) if book_ts_ms > 0 else float("inf")
        is_fresh_book = book_age_sec <= ORDERBOOK_AGGREGATOR_FRESH_SEC
        if (
            isinstance(book, list)
            and len(book) >= 2
            and isinstance(book[0], list)
            and isinstance(book[1], list)
            and (len(book[0]) > 0 or len(book[1]) > 0)
            and is_fresh_book
        ):
            payload = {
                "coin": symbol,
                "book": [book[0][:safe_depth], book[1][:safe_depth]],
                "price": float(cached.get("price", 0.0) or 0.0),
                "source": "aggregator_cache",
                "book_ts": int(cached.get("book_ts", 0) or int(now * 1000)),
                "timestamp": int(now * 1000),
            }
            _orderbook_snapshot_cache[symbol] = {
                "book": payload["book"],
                "price": payload["price"],
                "source": payload["source"],
                "book_ts": payload["book_ts"],
                "timestamp": now,
                "last_upstream_fetch": cached_snapshot.get("last_upstream_fetch", 0.0) if cached_snapshot else 0.0,
            }
            return payload
        if (
            isinstance(book, list)
            and len(book) >= 2
            and isinstance(book[0], list)
            and isinstance(book[1], list)
            and (len(book[0]) > 0 or len(book[1]) > 0)
            and not is_fresh_book
        ):
            logger.warning(
                "Orderbook aggregator cache stale symbol=%s age=%.2fs; attempting snapshot refresh",
                symbol,
                book_age_sec,
            )

    last_attempt = float(_orderbook_upstream_last_attempt.get(symbol, 0.0) or 0.0)
    if _is_aggregator_rate_limited_outage(aggregator, now):
        if cached_snapshot:
            return {
                "coin": symbol,
                "book": cached_snapshot["book"],
                "price": cached_snapshot["price"],
                "source": "aggregator_backoff",
                "book_ts": int(cached_snapshot.get("book_ts", 0) or 0),
                "timestamp": int(now * 1000),
            }
        cached_book = cached.get("book", None)
        if (
            isinstance(cached_book, list)
            and len(cached_book) >= 2
            and isinstance(cached_book[0], list)
            and isinstance(cached_book[1], list)
        ):
            return {
                "coin": symbol,
                "book": [cached_book[0][:safe_depth], cached_book[1][:safe_depth]],
                "price": float((cached or {}).get("price", 0.0) or 0.0),
                "source": "aggregator_backoff",
                "book_ts": int((cached or {}).get("book_ts", 0) or 0),
                "timestamp": int(now * 1000),
            }
        return {
            "coin": symbol,
            "book": [[], []],
            "price": float((cached or {}).get("price", 0.0) or 0.0),
            "source": "aggregator_backoff",
            "book_ts": int((cached or {}).get("book_ts", 0) or 0),
            "timestamp": int(now * 1000),
        }

    if (now - last_attempt) < ORDERBOOK_UPSTREAM_MIN_INTERVAL:
        if cached_snapshot:
            return {
                "coin": symbol,
                "book": cached_snapshot["book"],
                "price": cached_snapshot["price"],
                "source": "cached_stale",
                "book_ts": int(cached_snapshot.get("book_ts", 0) or 0),
                "timestamp": int(now * 1000),
            }
        return {
            "coin": symbol,
            "book": [[], []],
            "price": float((cached or {}).get("price", 0.0) or 0.0),
            "source": "cooldown",
            "book_ts": int((cached or {}).get("book_ts", 0) or 0),
            "timestamp": int(now * 1000),
        }

    if _in_hl_cooldown(now):
        if cached_snapshot:
            return {
                "coin": symbol,
                "book": cached_snapshot["book"],
                "price": cached_snapshot["price"],
                "source": "cached_stale",
                "book_ts": int(cached_snapshot.get("book_ts", 0) or 0),
                "timestamp": int(now * 1000),
            }
        return {
            "coin": symbol,
            "book": [[], []],
            "price": float((cached or {}).get("price", 0.0) or 0.0),
            "source": "rate_limited",
            "book_ts": int((cached or {}).get("book_ts", 0) or 0),
            "timestamp": int(now * 1000),
        }

    session = getattr(request.app.state, "session", None)
    payload = {"type": "l2Snapshot", "coin": symbol}
    _orderbook_upstream_last_attempt[symbol] = now

    async def _fetch_with(sess):
        async with sess.post("https://api.hyperliquid.xyz/info", json=payload) as resp:
            if resp.status == 429:
                _mark_hl_rate_limited("orderbook", status=429)
                return None
            if resp.status != 200:
                return None
            _mark_hl_success()
            return await resp.json()

    async def _fetch_snapshot():
        try:
            if session:
                return await _fetch_with(session)
            async with aiohttp.ClientSession() as fallback_session:
                return await _fetch_with(fallback_session)
        except Exception as exc:
            if _looks_rate_limited(exc):
                _mark_hl_rate_limited("orderbook_exception")
            logger.warning("Orderbook snapshot fetch failed symbol=%s err=%s", symbol, exc)
            return None

    l2 = await _run_singleflight(f"trading:orderbook:{symbol}", _fetch_snapshot)

    levels = (l2 or {}).get("levels", []) if isinstance(l2, dict) else []
    if not (isinstance(levels, list) and len(levels) >= 2):
        if cached_snapshot:
            return {
                "coin": symbol,
                "book": cached_snapshot["book"],
                "price": cached_snapshot["price"],
                "source": "cached_stale",
                "book_ts": int(cached_snapshot.get("book_ts", 0) or 0),
                "timestamp": int(now * 1000),
            }
        return {
            "coin": symbol,
            "book": [[], []],
            "price": float(cached.get("price", 0.0) or 0.0),
            "source": "empty",
            "book_ts": int(cached.get("book_ts", 0) or 0),
            "timestamp": int(now * 1000),
        }

    # Hydrate aggregator cache so websocket consumers recover on next broadcast.
    if aggregator is not None:
        try:
            aggregator._update_cache(symbol, "book", levels)
            aggregator._update_cache(symbol, "walls", aggregator._detect_walls(levels))
        except Exception as exc:
            logger.warning("Failed to hydrate aggregator cache from snapshot symbol=%s err=%s", symbol, exc)

    top = [levels[0][:safe_depth], levels[1][:safe_depth]]
    response = {
        "coin": symbol,
        "book": top,
        "price": float((cached or {}).get("price", 0.0) or 0.0),
        "source": "hyperliquid_snapshot",
        "book_ts": int(now * 1000),
        "timestamp": int(now * 1000),
    }
    _orderbook_snapshot_cache[symbol] = {
        "book": response["book"],
        "price": response["price"],
        "source": response["source"],
        "book_ts": response["book_ts"],
        "timestamp": now,
        "last_upstream_fetch": now,
    }
    return response


# === Whale Wallet Tracker Endpoints ===

@router.get("/whales/alerts")
async def get_whale_alerts(request: Request, limit: int = 50, coin: str = None):
    """Get recent whale position change alerts."""
    tracker = getattr(request.app.state, "whale_tracker", None)
    if not tracker:
        return {"alerts": [], "error": "Whale tracker not initialized"}
    
    alerts = tracker.get_alerts(limit=limit, coin=coin)
    return {
        "alerts": alerts,
        "count": len(alerts),
        "initialized": tracker._initialized,
    }

@router.get("/whales/positions")
async def get_whale_positions(request: Request, address: str = None, coin: str = None):
    """Get current positions held by tracked whales."""
    tracker = getattr(request.app.state, "whale_tracker", None)
    if not tracker:
        return {"positions": [], "error": "Whale tracker not initialized"}
    
    positions = tracker.get_whale_positions(address=address)
    
    if coin:
        positions = [p for p in positions if p["coin"].upper() == coin.upper()]
    
    return {
        "positions": positions,
        "count": len(positions),
    }

@router.get("/whales/summary")
async def get_whale_summary(request: Request, coin: str = None):
    """Get aggregated whale positioning (long vs short bias)."""
    tracker = getattr(request.app.state, "whale_tracker", None)
    if not tracker:
        return {"error": "Whale tracker not initialized"}
    
    return tracker.get_whale_summary(coin=coin)

@router.get("/whales/leaderboard")
async def get_whale_leaderboard(request: Request):
    """Get whale leaderboard with PnL rankings and performance data."""
    tracker = getattr(request.app.state, "whale_tracker", None)
    if not tracker:
        return {"leaderboard": [], "error": "Whale tracker not initialized"}
    
    leaderboard = tracker.get_leaderboard()
    return {
        "leaderboard": leaderboard,
        "count": len(leaderboard),
        "initialized": tracker._initialized,
    }

@router.get("/whales/stats")
async def get_whale_stats(request: Request):
    """Get whale tracker operational statistics."""
    tracker = getattr(request.app.state, "whale_tracker", None)
    if not tracker:
        return {"error": "Whale tracker not initialized"}
    
    return tracker.get_stats()
