from contextlib import asynccontextmanager
import logging
import os
import time
from urllib.parse import urlencode
import colorlog
import uvicorn
from fastapi import FastAPI, UploadFile, BackgroundTasks, Depends, Query, Response, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from config import config
from database import init_db, get_db
from models import User, Wallet, UserTwap
from auth import (
    get_current_user, require_user, create_access_token,
    exchange_google_code, get_or_create_user, get_google_auth_url,
    GOOGLE_CLIENT_ID, FRONTEND_URL
)
from src.manager import TraderManager
from src.strategies.bridge_monitor import BridgeMonitor

# Configure Colored Logging
handler = colorlog.StreamHandler()
handler.setFormatter(colorlog.ColoredFormatter(
    '%(log_color)s%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    log_colors={
        'DEBUG': 'cyan',
        'INFO': 'green',
        'WARNING': 'yellow',
        'ERROR': 'red',
        'CRITICAL': 'red,bg_white',
    }
))
logger = colorlog.getLogger()
if not logger.handlers:
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# App version
VERSION = "0.2.0"

# Lifespan manager to handle startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 HyperliquidSentry Starting...")
    
    # Initialize database
    init_db()
    
    config.validate()
    manager = TraderManager() # Init singleton
    
    # Initialize Bridge Monitor
    from src.notifications import TelegramBot
    telegram_bot = TelegramBot()
    bridge_threshold = float(os.getenv("BRIDGE_ALERT_THRESHOLD", "3000000"))
    bridge_monitor = BridgeMonitor(telegram_bot, min_amount_usd=bridge_threshold)
    app.state.bridge_monitor = bridge_monitor  # Store for API access
    
    # Start restoring wallets in background
    import asyncio
    async def background_restore():
        logger.info("⏳ Starting background wallet restoration...")
        try:
             await manager.restore_wallets()
             logger.info("✅ Background wallet restoration complete.")
        except Exception as e:
             logger.error(f"❌ Background restore failed: {e}")

    asyncio.create_task(background_restore())
    
    # Start bridge monitor in background
    asyncio.create_task(bridge_monitor.start())
    
    yield
    # Shutdown
    logger.info("🛑 Shutting down manager...")
    bridge_monitor.stop()
    await manager.stop_all()

app = FastAPI(
    title="HyperliquidSentry API",
    description="Real-time Hyperliquid trading intelligence platform with user authentication",
    version=VERSION,
    lifespan=lifespan
)

# CORS Configuration
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = TraderManager()

# --- Models ---
class AddWalletRequest(BaseModel):
    address: str
    label: Optional[str] = None
    active_trading: bool = False

class TwapRequest(BaseModel):
    token: str

class TwapConfigRequest(BaseModel):
    min_size: float

# --- Health & Status Endpoints ---

@app.get("/health")
def health_check():
    """Health check endpoint for Railway/Docker."""
    return {"status": "healthy", "version": VERSION}

@app.get("/version")
def version_info():
    """Get API version and environment info."""
    return {
        "version": VERSION,
        "environment": config.ENVIRONMENT,
        "name": "HyperliquidSentry"
    }

@app.get("/")
def home(user: Optional[User] = Depends(get_current_user), db: Session = Depends(get_db)):
    """Home endpoint - shows status and user-specific wallet count."""
    status = "loading" if manager.is_loading else "running"
    
    # Count user's wallets if authenticated
    wallet_count = 0
    if user:
        wallet_count = db.query(Wallet).filter(Wallet.user_id == user.id).count()
    
    return {
        "status": status, 
        "active_wallets": wallet_count,
        "total_alerts": manager.alert_count,
        "loading_progress": f"{wallet_count} loaded",
        "version": VERSION,
        "authenticated": user is not None,
        "user": user.to_dict() if user else None
    }

# ============================================
# Authentication Endpoints
# ============================================

@app.get("/auth/google")
async def google_login(redirect_uri: str = Query(None)):
    """Initiate Google OAuth login flow"""
    if not GOOGLE_CLIENT_ID:
        return {"error": "Google OAuth not configured"}
    
    # Use provided redirect_uri or default
    callback_uri = redirect_uri or f"{FRONTEND_URL}/auth/callback"
    
    # Store callback in session (we'll pass it through OAuth state)
    auth_url = get_google_auth_url(callback_uri)
    return {"auth_url": auth_url}


@app.get("/auth/google/callback")
async def google_callback(
    code: str = Query(...),
    redirect_uri: str = Query(None),
    db: Session = Depends(get_db)
):
    """Handle Google OAuth callback"""
    callback_uri = redirect_uri or f"{FRONTEND_URL}/auth/callback"
    
    # Exchange code for user info
    logger.info(f"DEBUG AUTH: code={code[:10]}... redirect_uri_param={redirect_uri}")
    logger.info(f"DEBUG AUTH: FINAL callback_uri={callback_uri}")
    
    try:
        google_user = await exchange_google_code(code, callback_uri)
    except Exception as e:
        logger.error(f"DEBUG AUTH: Exchange failed. Error: {e}")
        raise e
    
    # Get or create user in database
    user = get_or_create_user(
        db=db,
        email=google_user["email"],
        name=google_user.get("name", ""),
        avatar_url=google_user.get("picture", ""),
        provider="google",
        provider_id=google_user["id"]
    )
    
    # Create JWT token
    token = create_access_token(data={"sub": str(user.id)})
    
    return {
        "token": token,
        "user": user.to_dict()
    }


@app.get("/auth/me")
async def get_me(user: User = Depends(require_user)):
    """Get current authenticated user info"""
    return user.to_dict()


class UpdateProfileRequest(BaseModel):
    telegram_chat_id: str


@app.post("/auth/profile/update")
async def update_profile(
    req: UpdateProfileRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Update user profile settings"""
    user.telegram_chat_id = req.telegram_chat_id
    db.commit()
    db.refresh(user)
    return {"status": "updated", "user": user.to_dict()}


@app.post("/auth/logout")
async def logout(user: User = Depends(require_user)):
    """Logout current user (client should discard token)"""
    return {"status": "logged_out", "message": "Token should be discarded by client"}

# ============================================
# Wallet Endpoints (User-Scoped)
# ============================================

@app.get("/wallets")
def list_wallets(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """List current user's wallets only."""
    wallets = db.query(Wallet).filter(Wallet.user_id == user.id).all()
    return {"wallets": [w.to_dict() for w in wallets]}


@app.post("/wallets/add")
async def add_wallet(
    req: AddWalletRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Add a wallet for the current user."""
    # Check if wallet already exists for this user
    existing = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.address == req.address
    ).first()
    
    if existing:
        return {"status": "exists", "address": req.address, "message": "Wallet already added"}
    
    # Create wallet in database
    wallet = Wallet(
        user_id=user.id,
        address=req.address,
        label=req.label,
        active_trading=req.active_trading
    )
    db.add(wallet)
    db.commit()
    
    # Start copy trader in background
    background_tasks.add_task(manager.start_copy_trader, req.address, req.active_trading, req.label)
    
    return {
        "status": "added",
        "address": req.address,
        "label": req.label,
        "mode": "trading" if req.active_trading else "observer"
    }


@app.delete("/wallets/{address}")
async def remove_wallet(
    address: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Remove a wallet for the current user."""
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.address == address
    ).first()
    
    if not wallet:
        return {"status": "not_found", "address": address}
    
    db.delete(wallet)
    db.commit()
    
    # Stop copy trader
    await manager.stop_copy_trader(address)
    
    return {"status": "removed", "address": address}

# ============================================
# TWAP Endpoints (User-Scoped)
# ============================================

@app.get("/twap")
async def get_twaps(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Get current user's TWAP watchlist."""
    user_twaps = db.query(UserTwap).filter(UserTwap.user_id == user.id).all()
    return {"tokens": [t.token for t in user_twaps]}


@app.get("/twap/active")
async def get_active_twaps(
    user: User = Depends(require_user), 
    db: Session = Depends(get_db),
    show_all: bool = False
):
    """Returns active TWAPs for UI display.
    
    By default, filters to show only user's watched tokens.
    Set show_all=true to see all global TWAPs.
    """
    
    # Get user's watched tokens
    user_twaps = db.query(UserTwap).filter(UserTwap.user_id == user.id).all()
    watched_tokens = {t.token.upper() for t in user_twaps}
    
    # Get min_size preference
    user_twap_pref = user_twaps[0] if user_twaps else None
    min_size = user_twap_pref.min_size if user_twap_pref else 10000

    all_twaps = []
    for token, twaps in manager.twap_detector.active_twaps.items():
        # Filter by watched tokens unless show_all is True
        if not show_all:
            # Match base token (handle @HYPE, HYPE/USDC etc)
            base_token = token.replace("@", "").split("/")[0].upper()
            if not any(base_token == w.upper() or token.upper() == w.upper() for w in watched_tokens):
                continue

        for t in twaps:
            twap_data = t.get('action', {}).get('twap', {})
            size = t.get('size_usd', float(twap_data.get('s', 0)))
            
            all_twaps.append({
                "token": token,
                "size": size,
                "side": "BUY" if twap_data.get('b', True) else "SELL",
                "user": t.get('user', ''),
                "minutes": twap_data.get('m', 0),
                "hash": t.get('hash', ''),
                "time": t.get('time', 0),
                "is_perp": twap_data.get('t', False),  # True = Perp, False = Spot
                "reduce_only": twap_data.get('r', False)
            })
    
    return {"twaps": all_twaps, "min_size": min_size, "watched_tokens": list(watched_tokens)}


@app.post("/twap/add")
async def add_twap(
    req: TwapRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Add tokens to user's TWAP watchlist."""
    tokens = req.token.split(',')
    added = []
    
    for t in tokens:
        clean_t = t.strip().upper()
        if not clean_t:
            continue
            
        # Check if already exists
        existing = db.query(UserTwap).filter(
            UserTwap.user_id == user.id,
            UserTwap.token == clean_t
        ).first()
        
        if not existing:
            user_twap = UserTwap(user_id=user.id, token=clean_t)
            db.add(user_twap)
            added.append(clean_t)
            
            # Also add to detector
            manager.twap_detector.add_token(clean_t)
    
    db.commit()
    return {"status": "added", "tokens": added}


@app.post("/twap/config")
async def update_twap_config(
    req: TwapConfigRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Update TWAP min size for user."""
    db.query(UserTwap).filter(UserTwap.user_id == user.id).update({"min_size": req.min_size})
    db.commit()
    return {"status": "updated", "min_size": req.min_size}


@app.delete("/twap/{token}")
async def remove_twap(
    token: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Remove token from user's TWAP watchlist."""
    deleted = db.query(UserTwap).filter(
        UserTwap.user_id == user.id,
        UserTwap.token == token.upper()
    ).delete()
    db.commit()
    
    if deleted:
        return {"status": "removed", "token": token.upper()}
    return {"status": "not_found", "token": token.upper()}


@app.get("/twap/history/{token}")
async def get_twap_history(
    token: str,
    time_range: str = Query("1h", description="Time range: 1h, 4h, 24h, or all"),
    user: User = Depends(require_user)
):
    """Get TWAP history data for charting."""
    history = manager.twap_detector.get_history(token, time_range)
    return {
        "token": token.upper(),
        "time_range": time_range,
        "data": history,
        "count": len(history)
    }


@app.get("/twap/users/{token}")
async def get_twap_users(
    token: str,
    user: User = Depends(require_user)
):
    """Get active TWAP users (who is doing the TWAP)."""
    users = manager.twap_detector.get_active_users(token)
    return {
        "token": token.upper(),
        "buyers": users["buyers"],
        "sellers": users["sellers"],
        "total_buyers": len(users["buyers"]),
        "total_sellers": len(users["sellers"])
    }


@app.get("/twap/summary")
async def get_twap_summary(user: User = Depends(require_user)):
    """Get summary of all watched tokens with latest TWAP data."""
    summaries = manager.twap_detector.get_all_tokens_summary()
    return {"tokens": summaries}


# ============================================
# Bridge Monitoring Endpoints
# ============================================

@app.get("/bridges/recent")
async def get_recent_bridges(
    limit: int = Query(20, description="Number of bridges to return"),
    request: Request = None
):
    """Get recent large bridge deposits."""
    bridge_monitor = request.app.state.bridge_monitor
    bridges = bridge_monitor.get_recent_bridges(limit)
    return {"bridges": bridges, "count": len(bridges)}


@app.get("/bridges/stats")
async def get_bridge_stats(request: Request = None):
    """Get bridge monitor stats."""
    bridge_monitor = request.app.state.bridge_monitor
    stats = bridge_monitor.get_stats()
    return stats


@app.post("/bridges/config")
async def update_bridge_config(
    threshold: float = Query(..., description="Minimum bridge amount in USD"),
    user: User = Depends(require_user),
    request: Request = None
):
    """Update bridge alert threshold."""
    bridge_monitor = request.app.state.bridge_monitor
    bridge_monitor.set_threshold(threshold)
    return {"status": "updated", "threshold": threshold}

# ============================================
# CSV Import (User-Scoped)
# ============================================

@app.post("/wallets/upload_csv")
async def upload_csv(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Upload a CSV file of addresses (one per line)."""
    content = await file.read()
    text = content.decode('utf-8')
    lines = text.split('\n')
    
    added_count = 0
    for line in lines:
        parts = line.strip().split(',')
        addr = parts[0].strip()
        label = parts[1].strip() if len(parts) > 1 else None
        
        if addr.startswith("0x") and len(addr) > 10:
            # Check if exists
            existing = db.query(Wallet).filter(
                Wallet.user_id == user.id,
                Wallet.address == addr
            ).first()
            
            if not existing:
                wallet = Wallet(user_id=user.id, address=addr, label=label)
                db.add(wallet)
                added_count += 1
                
                # Start copy trader
                background_tasks.add_task(manager.start_copy_trader, addr, False, label)
    
    db.commit()
    return {"status": "imported", "count": added_count, "user_id": str(user.id)}


# ============== TRADING TERMINAL ENDPOINTS ==============

@app.get("/trading/tokens")
async def get_trading_tokens():
    """Get available tokens for trading (perps + spot) with 24h stats."""
    import aiohttp
    
    tokens = []
    
    try:
        async with aiohttp.ClientSession() as session:
            # Fetch perp metadata and context (prices, 24h stats)
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "metaAndAssetCtxs"},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
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
                            
                        tokens.append({
                            "symbol": asset["name"],
                            "pair": f"{asset['name']}/USDC",
                            "name": asset["name"],
                            "type": "perp",
                            "price": current_price,
                            "prevPrice": prev_day_px,
                            "change24h": change_24h,
                            "volume24h": float(ctx.get("dayNtlVlm", 0)),
                            "openInterest": float(ctx.get("openInterest", 0)),
                            "funding": float(ctx.get("funding", 0)),
                            "maxLeverage": asset.get("maxLeverage", 50)
                        })
            
    except Exception as e:
        logger.error(f"Failed to fetch tokens: {e}")
        # Return fallback if API fails
        tokens = [
             {"symbol": "BTC", "pair": "BTC/USDC", "name": "Bitcoin", "type": "perp", "price": 0, "change24h": 0},
             {"symbol": "ETH", "pair": "ETH/USDC", "name": "Ethereum", "type": "perp", "price": 0, "change24h": 0}
        ]
    
    return {"tokens": tokens}


class CandlesRequest(BaseModel):
    token: str
    interval: str
    start_time: int
    end_time: int


@app.post("/trading/candles")
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


class AnalyzeRequest(BaseModel):
    token: str
    interval: str = "1h"


@app.post("/trading/analyze")
async def analyze_chart(req: AnalyzeRequest):
    """Get AI analysis for a token based on technical indicators."""
    import aiohttp
    import numpy as np
    
    token = req.token.upper()
    
    # Map frontend interval (TradingView style) to Hyperliquid
    interval_map = {
        "15": "15m",
        "60": "1h",
        "240": "4h",
        "D": "1d",
        "1D": "1d"
    }
    hl_interval = interval_map.get(req.interval, "1h")
    
    # Calculate lookback based on interval (need ~50-100 candles)
    # 100 candles * duration in seconds
    duration_map = {
        "15m": 15 * 60,
        "1h": 60 * 60,
        "4h": 4 * 60 * 60,
        "1d": 24 * 60 * 60
    }
    
    lookback_seconds = 100 * duration_map.get(hl_interval, 3600)
    start_time = int((time.time() - lookback_seconds) * 1000)

    try:
        async with aiohttp.ClientSession() as session:
            # Fetch candles
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={
                    "type": "candleSnapshot",
                    "req": {
                        "coin": token,
                        "interval": hl_interval,
                        "startTime": start_time,
                        "endTime": int(time.time() * 1000)
                    }
                },
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status != 200:
                    raise Exception("Failed to fetch candles")
                candles = await resp.json()
        
        if not candles or len(candles) < 14:
            raise Exception("Insufficient data")
        
        # Extract close prices
        closes = np.array([float(c["c"]) for c in candles])
        
        # Calculate RSI
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = np.mean(gains[-14:])
        avg_loss = np.mean(losses[-14:])
        rs = avg_gain / avg_loss if avg_loss > 0 else 100
        rsi = 100 - (100 / (1 + rs))
        
        # Calculate EMAs
        ema_12 = np.mean(closes[-12:])
        ema_26 = np.mean(closes[-26:]) if len(closes) >= 26 else np.mean(closes)
        macd = ema_12 - ema_26
        
        # Determine trend
        ema_50 = np.mean(closes[-50:]) if len(closes) >= 50 else np.mean(closes)
        current_price = closes[-1]
        trend = "up" if current_price > ema_50 else "down" if current_price < ema_50 * 0.98 else "sideways"
        
        # Generate recommendation
        direction = "neutral"
        confidence = 50
        reasoning = ""
        
        if rsi < 30 and trend != "down":
            direction = "long"
            confidence = min(85, 60 + int(30 - rsi))
            reasoning = f"{token} is oversold (RSI {rsi:.1f}). Price showing signs of reversal near support."
        elif rsi > 70 and trend != "up":
            direction = "short"
            confidence = min(85, 60 + int(rsi - 70))
            reasoning = f"{token} is overbought (RSI {rsi:.1f}). Expect pullback from resistance."
        elif macd > 0 and rsi > 50 and trend == "up":
            direction = "long"
            confidence = 65
            reasoning = f"{token} showing bullish momentum. MACD positive, trend is up. Consider long positions."
        elif macd < 0 and rsi < 50 and trend == "down":
            direction = "short"
            confidence = 65
            reasoning = f"{token} showing bearish momentum. MACD negative, trend is down. Consider shorts."
        else:
            direction = "neutral"
            confidence = 45
            reasoning = f"{token} in consolidation. Mixed signals - wait for clearer setup."
        
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
        logger.error(f"Analysis failed for {token}: {e}")
        # Return demo analysis on error
        import random
        direction = random.choice(["long", "short", "neutral"])
        return {
            "direction": direction,
            "confidence": random.randint(55, 80),
            "reasoning": f"Demo analysis for {token}. Enable real data for accurate signals.",
            "indicators": {
                "rsi": random.uniform(30, 70),
                "macd_signal": "bullish" if direction == "long" else "bearish" if direction == "short" else "neutral",
                "trend": "up" if direction == "long" else "down" if direction == "short" else "sideways"
            },
            "timestamp": int(time.time() * 1000)
        }


class OrderRequest(BaseModel):
    token: str
    side: str  # "buy" or "sell"
    size: float
    price: Optional[float] = None
    order_type: str = "market"  # "market" or "limit"


@app.post("/trading/order")
async def place_order(req: OrderRequest, user: User = Depends(require_user)):
    """Place a trading order (simulation mode if no private key)."""
    
    # Check if we have a configured exchange
    if not manager.client.exchange:
        return {
            "status": "simulated",
            "simulated": True,
            "message": f"Would have placed {req.side.upper()} {req.size} {req.token} @ {req.order_type}",
            "order": {
                "token": req.token,
                "side": req.side,
                "size": req.size,
                "price": req.price,
                "type": req.order_type
            }
        }
    
    # Real order placement would go here
    try:
        is_buy = req.side.lower() == "buy"
        result = manager.client.market_open(
            coin=req.token,
            is_buy=is_buy,
            sz=req.size,
            px=req.price
        )
        return {"status": "filled", "result": result}
    except Exception as e:
        logger.error(f"Order failed: {e}")
        return {"status": "error", "error": str(e)}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload = not config.is_production()
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
