from contextlib import asynccontextmanager
import logging
import os
import colorlog
import uvicorn
from fastapi import FastAPI, UploadFile, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from config import config
from src.manager import TraderManager

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
VERSION = "0.1.0"

# Lifespan manager to handle startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 HyperSentry Starting...")
    config.validate()
    manager = TraderManager() # Init singleton
    
    # Start restoring wallets in background to allow server to boot immediately
    import asyncio
    async def background_restore():
        logger.info("⏳ Starting background wallet restoration...")
        try:
             await manager.restore_wallets()
             logger.info("✅ Background wallet restoration complete.")
        except Exception as e:
             logger.error(f"❌ Background restore failed: {e}")

    asyncio.create_task(background_restore())
    
    yield
    # Shutdown
    logger.info("🛑 Shutting down manager...")
    await manager.stop_all()

app = FastAPI(
    title="HyperSentry API",
    description="Real-time Hyperliquid trading intelligence platform",
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
        "name": "HyperSentry"
    }

@app.get("/")
def home():
    # Check if we are still restoring
    status = "loading" if manager.is_loading else "running"
    return {
        "status": status, 
        "active_wallets": len(manager.get_active_wallets()), 
        "total_alerts": manager.alert_count,
        "loading_progress": f"{len(manager.get_active_wallets())} loaded",
        "version": VERSION
    }

# --- Wallet Endpoints ---

@app.get("/wallets")
def list_wallets():
    """List all active watcher addresses."""
    return {"wallets": manager.get_active_wallets()}

@app.post("/wallets/add")
async def add_wallet(req: AddWalletRequest, background_tasks: BackgroundTasks):
    """Start watching a new wallet."""
    # We use background tasks to avoid blocking the API response
    background_tasks.add_task(manager.start_copy_trader, req.address, req.active_trading, req.label)
    return {"status": "queued", "address": req.address, "label": req.label, "mode": "trading" if req.active_trading else "observer"}

@app.delete("/wallets/{address}")
async def remove_wallet(address: str):
    """Stop watching a wallet."""
    await manager.stop_copy_trader(address)
    return {"status": "stopped", "address": address}

# --- TWAP Endpoints ---

@app.get("/twap")
async def get_twaps():
    return {"tokens": list(manager.twap_detector.watched_tokens)}

@app.get("/twap/active")
async def get_active_twaps():
    """Returns all active TWAPs for UI display"""
    all_twaps = []
    for token, twaps in manager.twap_detector.active_twaps.items():
        for t in twaps:
            # Flatten/Simplify for UI
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
    return {"twaps": all_twaps, "min_size": manager.twap_detector.min_size_usd}


@app.post("/twap/add")
async def add_twap(req: TwapRequest):
    # Support multiple tokens (comma separated)
    tokens = req.token.split(',')
    for t in tokens:
        clean_t = t.strip()
        if clean_t:
            manager.twap_detector.add_token(clean_t)
    
    manager.save_state() # Persist
    return {"status": "added", "tokens": req.token.upper()}

@app.post("/twap/config")
async def update_twap_config(req: TwapConfigRequest):
    manager.twap_detector.set_min_size(req.min_size)
    manager.save_state()
    return {"status": "updated", "min_size": req.min_size}

@app.delete("/twap/{token}")
async def remove_twap(token: str):
    manager.twap_detector.remove_token(token)
    manager.save_state()
    return {"status": "removed", "token": token.upper()}

# --- CSV Import ---

@app.post("/wallets/upload_csv")
async def upload_csv(file: UploadFile, background_tasks: BackgroundTasks):
    """Upload a CSV file of addresses (one per line)."""
    content = await file.read()
    text = content.decode('utf-8')
    lines = text.split('\n')
    
    data_tuples = []
    for line in lines:
        parts = line.strip().split(',')
        addr = parts[0].strip()
        label = parts[1].strip() if len(parts) > 1 else None
        
        if addr.startswith("0x") and len(addr) > 10:
            data_tuples.append((addr, label))
    
    # Use Celery for background processing
    from tasks import batch_import_task
    batch_import_task.delay(data_tuples)
            
    return {"status": "queued_in_celery", "count": len(data_tuples)}

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload = not config.is_production()
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
