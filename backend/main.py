from contextlib import asynccontextmanager
import logging
import os
import time
import json
import colorlog
import uvicorn
from fastapi import FastAPI, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from config import config
from database import init_db, get_db
from models import User, Wallet
from auth import get_current_user
from auth import verify_token
from src.manager import TraderManager
from src.strategies.bridge_monitor import BridgeMonitor
from src.strategies.whale_tracker import WhaleTracker

# Import Routers
from src.routers import auth, wallets, twap, bridges, settings, trading, backtest, market, intel, alpha

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

    # Start event bus backend (inproc by default, kafka optional via env)
    from src.services.event_bus import event_bus
    app.state.event_bus = event_bus
    await event_bus.start()

    # Start internal event relay (decouples producers from direct WS fanout)
    from src.services.event_relay import event_relay
    app.state.event_relay = event_relay
    await event_relay.start()
    
    # Initialize Data Aggregator
    from src.services.aggregator import aggregator
    app.state.aggregator = aggregator
    asyncio.create_task(aggregator.start())
    
    # Initialize Whale Tracker
    whale_tracker = WhaleTracker(
        max_whales=int(os.getenv("WHALE_TRACKER_COUNT", "20")),
        poll_interval=int(os.getenv("WHALE_POLL_INTERVAL", "60")),
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
    if hasattr(app.state, "aggregator"):
        await app.state.aggregator.stop()
    if hasattr(app.state, "event_relay"):
        await app.state.event_relay.stop()
    if hasattr(app.state, "event_bus"):
        await app.state.event_bus.stop()
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
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
]
env_origins = os.getenv("ALLOWED_ORIGINS")
if env_origins:
    allowed_origins.extend([o.strip() for o in env_origins.split(",")])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
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
app.include_router(alpha.router)

# WebSocket Endpoint
from fastapi import WebSocket, WebSocketDisconnect
from src.ws_manager import manager as ws_manager

@app.get("/aggregator/status")
def get_agg_status():
    from src.services.aggregator import aggregator
    from src.services.event_bus import event_bus
    
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
        "alpha_queue_depth": aggregator.alpha_update_queue.qsize(),
        "alpha_drop_count": aggregator.alpha_drop_count,
        "alpha_worker_count": aggregator.alpha_worker_count,
        "last_broadcast": aggregator.last_broadcast_time,
        "upstream_connected": getattr(aggregator, "upstream_connected", False),
        "last_ws_close_code": getattr(aggregator, "last_ws_close_code", None),
        "last_ws_close_reason": getattr(aggregator, "last_ws_close_reason", None),
        "last_ws_close_ts": getattr(aggregator, "last_ws_close_ts", 0.0),
        "event_bus": event_bus.stats(),
        "timestamp": int(time.time() * 1000)
    }


@app.get("/aggregator/symbols")
async def get_agg_symbols(mode: str = "overview", limit: int = 50):
    from src.services.aggregator import aggregator

    safe_limit = max(1, min(limit, 200))
    if mode == "available":
        rows = await aggregator.refresh_available_symbols(force=False)
        return {
            "mode": "available",
            "symbols": [row["symbol"] for row in rows[:safe_limit]],
            "count": len(rows),
        }
    if mode == "default":
        rows = await aggregator.refresh_available_symbols(force=False)
        defaults = sorted(aggregator.system_symbols)
        symbols = defaults if defaults else [row["symbol"] for row in rows[:safe_limit]]
        return {
            "mode": "default",
            "symbols": symbols[:safe_limit],
            "count": len(symbols),
        }
    if mode == "overview":
        return aggregator.get_symbol_overview(limit=safe_limit)
    raise HTTPException(status_code=400, detail="mode must be one of: overview, available, default")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    from src.services.aggregator import aggregator
    # Optional auth at connect time for private channel usage.
    token = websocket.query_params.get("token")
    if token:
        payload = verify_token(token)
        if payload and payload.get("sub"):
            ws_manager.set_user(websocket, str(payload["sub"]))
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "detail": "Invalid JSON payload"}))
                continue
            
            if msg.get("type") == "subscribe":
                coin = msg.get("coin")
                if coin:
                    if ws_manager.is_symbol_subscribed(websocket, coin):
                        continue
                    logger.info(f"📡 Backend: Subscription request for {coin}")
                    if aggregator.subscribe(coin, source="client"):
                        ws_manager.subscribe_symbol(websocket, coin)
                        await websocket.send_text(json.dumps({"type": "subscribed", "coin": coin.upper()}))
                    else:
                        await websocket.send_text(
                            json.dumps({"type": "error", "detail": f"Subscription rejected for symbol: {coin}"})
                        )
            elif msg.get("type") == "unsubscribe":
                coin = msg.get("coin")
                if coin:
                    if ws_manager.is_symbol_subscribed(websocket, coin):
                        ws_manager.unsubscribe_symbol(websocket, coin)
                        aggregator.unsubscribe(coin, source="client")
                        await websocket.send_text(json.dumps({"type": "unsubscribed", "coin": coin.upper()}))
            elif msg.get("type") == "auth":
                msg_token = msg.get("token")
                payload = verify_token(msg_token) if msg_token else None
                if payload and payload.get("sub"):
                    ws_manager.set_user(websocket, str(payload["sub"]))
                    await websocket.send_text(json.dumps({"type": "auth_ok"}))
                else:
                    await websocket.send_text(json.dumps({"type": "auth_failed"}))
            elif msg.get("type") == "subscribe_private":
                if not ws_manager.has_private_access(websocket):
                    await websocket.send_text(json.dumps({"type": "error", "detail": "Private channel requires auth"}))
                else:
                    await websocket.send_text(json.dumps({"type": "private_ready"}))
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
