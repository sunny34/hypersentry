import asyncio
from celery_app import celery_app
from src.client_wrapper import HyperliquidClient
from src.notifications import TelegramBot
from src.strategies.copy_trader import CopyTrader
import logging

# Setup Logging for Workers
logger = logging.getLogger("CeleryWorker")

# Global instances for worker reuse (avoid re-init overhead)
client = None
notifier = None

def get_shared_resources():
    global client, notifier
    if client is None:
        client = HyperliquidClient()
    if notifier is None:
        notifier = TelegramBot()
    return client, notifier

@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def sync_wallet_task(self, address: str, active_trading: bool, label: str = None):
    """
    One-off task to sync a wallet's positions.
    This replaces the infinite loop in CopyTrader for the initial sync.
    For continuous monitoring, we would schedule this periodically.
    """
    try:
        async def _run_async():
            cli, bot = get_shared_resources()
            trader = CopyTrader(cli, bot, address, active_trading=active_trading, label=label, silent=True)
            await trader.sync_positions()
            return f"Synced {address}"

        return asyncio.run(_run_async())
        
    except Exception as e:
        logger.error(f"Error syncing {address}: {e}")
        if "429" in str(e):
             raise self.retry(exc=e)
        raise e

@celery_app.task(bind=True, max_retries=5, default_retry_delay=5)
def restore_wallet_task(self, address: str, label: str = None, active_trading: bool = False):
    """
    Restore a single wallet from disk - runs initial sync in Celery worker.
    This offloads the API calls from the main process.
    """
    import time
    
    try:
        async def _run_restore():
            cli, bot = get_shared_resources()
            trader = CopyTrader(cli, bot, address, active_trading=active_trading, label=label, silent=True)
            
            # Do initial sync
            await trader.sync_positions()
            logger.info(f"✅ Restored wallet: {address[:10]}...")
            return {"address": address, "status": "synced"}

        return asyncio.run(_run_restore())
        
    except Exception as e:
        logger.error(f"Error restoring {address}: {e}")
        # Retry on 429 rate limit
        if "429" in str(e):
            wait_time = (self.request.retries + 1) * 3
            logger.warning(f"Rate limited, retrying in {wait_time}s...")
            time.sleep(wait_time)
            raise self.retry(exc=e)
        raise e

@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def add_wallet_task(self, address: str, label: str = None, active_trading: bool = False):
    """
    Add a single wallet via API. Handled by Celery worker for parallelism.
    Uses 'API_URL' env var or defaults to localhost.
    """
    import requests
    import time
    import os
    
    # Use RAILWAY_PUBLIC_DOMAIN if API_URL isn't set, or default to localhost
    api_url = os.getenv("API_URL", "http://127.0.0.1:8000").rstrip("/")
    if "https://" not in api_url and "http://" not in api_url:
        api_url = f"https://{api_url}"
    
    try:
        res = requests.post(f"{api_url}/wallets/add", json={
            "address": address,
            "label": label,
            "active_trading": active_trading
        }, timeout=10)
        
        if res.status_code == 200:
            return {"address": address, "status": "added"}
        else:
            logger.error(f"API returned {res.status_code}: {res.text}")
            return {"address": address, "status": "failed", "code": res.status_code}
            
    except Exception as e:
        logger.error(f"Failed to add {address} to {api_url}: {e}")
        if "429" in str(e) or "Connection" in str(e):
            time.sleep(2)
            raise self.retry(exc=e)
        raise e

@celery_app.task
def batch_import_task(wallet_tuples: list):
    """
    Import a list of (address, label) tuples.
    Dispatches individual tasks for parallel processing.
    """
    logger.info(f"📦 Batch import: Dispatching {len(wallet_tuples)} wallets to workers...")
    
    dispatched = 0
    for item in wallet_tuples:
        addr = item[0]
        label = item[1] if len(item) > 1 else None
        
        # Simple validation
        if not addr.startswith("0x") or len(addr) < 40:
            continue
        
        # Dispatch each wallet as a separate task for parallel processing
        add_wallet_task.delay(addr, label, False)
        dispatched += 1
    
    logger.info(f"✅ Dispatched {dispatched} wallet tasks to workers.")
    return f"Dispatched {dispatched} wallets"

@celery_app.task
def check_twap_task(tokens: list, min_size: float):
    """
    Offloaded HypurrScan API check.
    Checks for large TWAP orders on the given tokens.
    """
    from src.strategies.twap_detector import TwapDetector
    from src.notifications import TelegramBot
    import asyncio
    
    # We create a transient detector just for this check
    # Note: efficient implementation would be to keep one warm or pass state
    notifier = TelegramBot()
    detector = TwapDetector(notifier)
    detector.watched_tokens = set(tokens)
    detector.min_size_usd = min_size
    
    # Run the check once
    async def _run_check():
        logger.info(f"🔍 Celery: Checking TWAPs for {len(tokens)} tokens...")
        return await detector.scan_once(tokens)

    return asyncio.run(_run_check())
