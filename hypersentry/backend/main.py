from contextlib import asynccontextmanager
import logging
import os
import time
import json
import colorlog
import uvicorn
from fastapi import FastAPI, Depends, Request
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from config import config
from database import init_db, get_db
from models import User, Wallet
from auth import get_current_user
from src.manager import TraderManager
from src.strategies.bridge_monitor import BridgeMonitor
from src.strategies.whale_tracker import WhaleTracker

# Import Routers
from src.routers import auth, wallets, twap, bridges, settings, trading, backtest, market, intel

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
    
    # Initialize Global HTTP Session
    import aiohttp
    app.state.session = aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=10),
        headers={"Content-Type": "application/json"}
    )
    
    # Initialize Bridge Monitor
    from src.notifications import TelegramBot
    telegram_bot = TelegramBot()
    bridge_threshold = float(os.getenv("BRIDGE_ALERT_THRESHOLD", "100000"))
    bridge_monitor = BridgeMonitor(telegram_bot, min_amount_usd=bridge_threshold)
    app.state.bridge_monitor = bridge_monitor  # Store for API access
    
    # Initialize Intel Engine
    from src.intel.engine import engine as intel_engine
    app.state.intel_engine = intel_engine
    
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
    
    # Start Intel Engine in background
    asyncio.create_task(intel_engine.start())
    
    # Initialize Data Aggregator
    from src.services.aggregator import aggregator
    asyncio.create_task(aggregator.start())
    
    # Initialize Whale Tracker
    whale_tracker = WhaleTracker(
        max_whales=int(os.getenv("WHALE_TRACKER_COUNT", "50")),
        poll_interval=int(os.getenv("WHALE_POLL_INTERVAL", "15")),
        min_notional=float(os.getenv("WHALE_MIN_NOTIONAL", "50000")),
        notifier=telegram_bot,
    )
    app.state.whale_tracker = whale_tracker
    asyncio.create_task(whale_tracker.start())
    
    yield
    # Shutdown
    logger.info("🛑 Shutting down manager...")
    bridge_monitor.stop()
    intel_engine.stop()
    whale_tracker.stop()
    await manager.stop_all()
    if hasattr(app.state, "session"):
        await app.state.session.close()

app = FastAPI(
    title="HyperliquidSentry API",
    description="Real-time Hyperliquid trading intelligence platform with user authentication",
    version=VERSION,
    lifespan=lifespan
)

# CORS Configuration
# Note: "allow_origins=['*']" with "allow_credentials=True" can cause browser issues. 
# We explicitly list common development origins here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://0.0.0.0:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info("🌐 CORS Configured for local development regex match.")

manager = TraderManager()

# Include Routers
app.include_router(auth.router)
app.include_router(wallets.router)
app.include_router(twap.router)
app.include_router(bridges.router)
app.include_router(settings.router)
app.include_router(trading.router)
app.include_router(backtest.router)
app.include_router(market.router)
app.include_router(intel.router)

# WebSocket Endpoint
from fastapi import WebSocket, WebSocketDisconnect
from src.ws_manager import manager as ws_manager

@app.get("/aggregator/status")
def get_agg_status():
    from src.services.aggregator import aggregator
    
    # Check health of subscribed symbols
    health = {}
    for s in aggregator.subscriptions:
        cache = aggregator.data_cache.get(s, {})
        health[s] = {
            "has_book": len(cache.get("book", [[], []])[0]) > 0,
            "has_trades": len(cache.get("trades", [])) > 0,
            "price": cache.get("price", 0)
        }
        
    return {
        "is_running": aggregator.is_running,
        "subscriptions": list(aggregator.subscriptions),
        "health": health,
        "cache_symbols_count": len(aggregator.data_cache),
        "last_broadcast": aggregator.last_broadcast_time,
        "timestamp": int(time.time() * 1000)
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    from src.services.aggregator import aggregator
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg.get("type") == "subscribe":
                coin = msg.get("coin")
                if coin:
                    logger.info(f"📡 Backend: Subscription request for {coin}")
                    aggregator.subscribe(coin)
            elif msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"⚠️ WS Endpoint Error: {e}")
        ws_manager.disconnect(websocket)

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
def home(request: Request, user: Optional[User] = Depends(get_current_user), db: Session = Depends(get_db)):
    """Home endpoint - shows status and user-specific wallet count."""
    status = "loading" if manager.is_loading else "running"
    
    # Count user's wallets if authenticated
    wallet_count = 0
    if user:
        wallet_count = db.query(Wallet).filter(Wallet.user_id == user.id).count()
    
    # Get Whale Tracker stats
    whale_stats = {}
    if hasattr(request.app.state, "whale_tracker"):
        whale_stats = request.app.state.whale_tracker.get_stats()

    # Combine user wallets with system whales
    system_whales = whale_stats.get("whale_count", 0)
    system_alerts = whale_stats.get("total_alerts", 0)
    
    return {
        "status": status, 
        "active_wallets": wallet_count + system_whales,
        "total_alerts": system_alerts + manager.alert_count,
        "loading_progress": f"{wallet_count} user / {system_whales} system",
        "version": VERSION,
        "authenticated": user is not None,
        "user": user.to_dict() if user else None
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload = not config.is_production()
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
