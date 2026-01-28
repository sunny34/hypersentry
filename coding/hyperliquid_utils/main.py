from contextlib import asynccontextmanager
import logging
import os
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
    google_user = await exchange_google_code(code, callback_uri)
    
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
async def get_active_twaps(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Returns all active TWAPs for UI display (filtered by user's tokens)."""
    # Get user's watched tokens
    user_twaps = db.query(UserTwap).filter(UserTwap.user_id == user.id).all()
    watched_tokens = {t.token.upper() for t in user_twaps}
    min_size = user_twaps[0].min_size if user_twaps else 10000
    
    all_twaps = []
    for token, twaps in manager.twap_detector.active_twaps.items():
        if token.upper() not in watched_tokens:
            continue
        for t in twaps:
            twap_data = t['action']['twap']
            all_twaps.append({
                "token": token,
                "size": float(twap_data['s']),
                "side": "BUY" if twap_data['b'] else "SELL",
                "user": t['user'],
                "minutes": twap_data['m'],
                "hash": t['hash'],
                "time": t['time']
            })
    
    return {"twaps": all_twaps, "min_size": min_size}


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


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload = not config.is_production()
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
