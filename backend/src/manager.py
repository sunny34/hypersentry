import asyncio
import logging
import json
import os
import time
from typing import Dict, List, Optional
from src.client_wrapper import HyperliquidClient
from src.notifications import TelegramBot
from src.strategies.copy_trader import CopyTrader
from src.strategies.twap_detector import TwapDetector
from src.strategies.passive_wall_detector import PassiveWallDetector

logger = logging.getLogger("TraderManager")

class TraderManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TraderManager, cls).__new__(cls)
            cls._instance.tasks: Dict[str, asyncio.Task] = {}
            cls._instance.traders: Dict[str, CopyTrader] = {}
            cls._instance.is_loading = True
            cls._instance.alert_count = 0 
            cls._instance.client = None # Lazily init
            
            cls._instance.notifier = TelegramBot()
            cls._instance.db_file = "wallets.json"
            cls._instance.twap_db_file = "twaps.json"
            cls._instance.twap_detector = TwapDetector(cls._instance.notifier)
            cls._instance.passive_walls = PassiveWallDetector()
            cls._instance.twap_task = None
            cls._instance.passive_task = None
            cls._instance._client_init_failures = 0
            cls._instance._client_next_retry_ts = 0.0
            cls._instance._client_last_log_ts = 0.0
            cls._instance.load_state()
        return cls._instance

    def initialize_client(self):
        """Rate-limit aware client init with non-blocking cooldown retries."""
        if self.client:
            return self.client

        now = time.time()
        if now < self._client_next_retry_ts:
            # Avoid retry storms while upstream is throttling.
            if now - self._client_last_log_ts > 30:
                wait = max(1, int(self._client_next_retry_ts - now))
                logger.warning("Client init cooling down after rate limit. Next retry in %ss.", wait)
                self._client_last_log_ts = now
            return None

        from hyperliquid.utils.error import ClientError

        try:
            self.client = HyperliquidClient()
            self._client_init_failures = 0
            self._client_next_retry_ts = 0.0
            return self.client
        except ClientError as e:
            if e.status_code == 429:
                self._client_init_failures += 1
                backoff = min(60, max(2, 2 * self._client_init_failures))
                self._client_next_retry_ts = now + backoff
                logger.warning(
                    "Rate limited during client init. Backing off %ss (attempt=%s).",
                    backoff,
                    self._client_init_failures,
                )
            else:
                self._client_next_retry_ts = now + 10
                logger.error(f"Client init failed: {e}")
        except Exception as e:
            self._client_next_retry_ts = now + 10
            logger.error(f"Client init exception: {e}")

        return None

    @property
    def hl_client(self):
        if not self.client:
            self.initialize_client()
        return self.client

    def load_state(self):
        if not os.path.exists(self.db_file):
            return
        try:
            with open(self.db_file, 'r') as f:
                data = json.load(f)
                # We can't start async tasks here easily in __new__, 
                # but we can store the data and let the main loop start them,
                # OR just rely on 'restore_wallets' called from lifespan.
                self._pending_restore = data
        except Exception as e:
            logger.error(f"Failed to load state: {e}")

        # Load TWAPs & Config
        if os.path.exists(self.twap_db_file):
            try:
                with open(self.twap_db_file, 'r') as f:
                    data = json.load(f)
                    # Handle both old list format and new dict format
                    if isinstance(data, list):
                        self.twap_detector.watched_tokens = set(data)
                    elif isinstance(data, dict):
                        self.twap_detector.watched_tokens = set(data.get("tokens", []))
                        self.twap_detector.min_size_usd = data.get("config", {}).get("min_size", 10000.0)
            except Exception as e:
                logger.error(f"Failed to load TWAPs: {e}")

    def save_state(self):
        data = []
        for addr, trader in self.traders.items():
            data.append({
                "address": addr,
                "label": trader.label,
                "active_trading": trader.active_trading
            })
        try:
            with open(self.db_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save state: {e}")
            
        # Save TWaps & Config
        try:
            with open(self.twap_db_file, 'w') as f:
                data = {
                    "tokens": list(self.twap_detector.watched_tokens),
                    "config": {"min_size": self.twap_detector.min_size_usd}
                }
                json.dump(data, f)
        except Exception as e:
            logger.error(f"Failed to save TWAPs: {e}")
            
    async def restore_wallets(self):
        """Restores wallets from local JSON database using Celery workers."""
        self.is_loading = True
        logger.info(f"♻️ Restoring wallets from disk...")
        
        if hasattr(self, '_pending_restore') and self._pending_restore:
            # Dispatch wallet syncs to Celery workers for parallel processing
            from tasks import restore_wallet_task
            
            logger.info(f"📤 Dispatching {len(self._pending_restore)} wallets to Celery workers...")
            
            for w in self._pending_restore:
                addr = w['address']
                if addr in self.traders:
                    continue
                
                # Create local trader reference (for UI listing)
                trader = CopyTrader(
                    self.hl_client, 
                    self.notifier, 
                    addr, 
                    active_trading=w.get('active_trading', False), 
                    silent=True, 
                    label=w.get('label')
                )
                self.traders[addr] = trader
                
                # Dispatch actual monitoring to Celery worker
                restore_wallet_task.delay(addr, w.get('label'), w.get('active_trading', False))
            
            logger.info(f"✅ Dispatched {len(self._pending_restore)} wallets to workers.")
            self._pending_restore = []
            
        # Start TWAP Detector Task (local for UI syncing)
        if not self.twap_task:
            self.twap_task = asyncio.create_task(self.twap_detector.start())
        
        if not self.passive_task:
            self.passive_task = asyncio.create_task(self.passive_walls.start())
        
        self.is_loading = False
        logger.info("✅ Restore complete.")

    def get_active_wallets(self) -> List[Dict[str, Optional[str]]]:
        return [
            {"address": addr, "label": trader.label}
            for addr, trader in self.traders.items()
        ]

    async def start_copy_trader(self, target_address: str, active_trading: bool = False, label: str = None):
        if target_address in self.tasks:
            logger.warning(f"Trader for {target_address} already running.")
            return

        logger.info(f"Starting trader for {target_address} (Trading: {active_trading})")
        
        # Create instance
        trader = CopyTrader(self.hl_client, self.notifier, target_address, active_trading=active_trading, label=label)
        self.traders[target_address] = trader
        
        # Start task
        task = asyncio.create_task(trader.start())
        self.tasks[target_address] = task
        
        try:
            # We can add a flag or just assume individual calls want alerts
            await self.notifier.send_message(f"✅ <b>Added Watcher</b>\nTarget: `{target_address}`\nMode: {'⚔️ Trading' if active_trading else '👀 Observer'}")
            
            self.save_state()
        except:
            pass

    async def start_batch(self, wallet_data: List[tuple]):
        """Efficiently start multiple traders with a single notification."""
        started_count = 0
        for data in wallet_data:
            addr = data[0]
            label = data[1] if len(data) > 1 else None
            
            if addr in self.tasks:
                continue
            
            trader = CopyTrader(self.hl_client, self.notifier, addr, active_trading=False, silent=True, label=label)
            self.traders[addr] = trader
            task = asyncio.create_task(trader.start())
            self.tasks[addr] = task
            started_count += 1
            await asyncio.sleep(0.5) # Throttle to prevent network spike (0.5s prevents 429 burst)
        
        self.save_state()
        
        if started_count > 0:
            await self.notifier.send_message(f"✅ <b>Batch Import Complete</b>\nAdded {started_count} new wallets.")
        return started_count

    async def stop_copy_trader(self, target_address: str):
        if target_address not in self.tasks:
            logger.warning(f"No trader found for {target_address}")
            return

        logger.info(f"Stopping trader for {target_address}")
        
        # Signal stop
        trader = self.traders.get(target_address)
        if trader:
            trader.is_running = False
        
        # Cancel task
        task = self.tasks.get(target_address)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        # Cleanup
        del self.tasks[target_address]
        del self.traders[target_address]

        # No specific notification for stop to avoid spam on batch operations or restart
        self.save_state()

    async def stop_all(self):
        """Called on shutdown. Stops tasks but PRESERVES state in DB."""
        logger.info("Stopping all background tasks...")
        
        # Stop TWAP Detector
        self.twap_detector.is_running = False
        if self.twap_task:
            self.twap_task.cancel()
        
        # Stop Passive Wall Detector
        self.passive_walls.is_running = False
        if self.passive_task:
            self.passive_task.cancel()
        
        targets = list(self.tasks.keys())
        for t in targets:
            # Manually stop task without calling stop_copy_trader (which deletes from DB)
            task = self.tasks.get(t)
            trader = self.traders.get(t)
            
            if trader:
                trader.is_running = False
            
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        
        # Do NOT delete from self.traders here
        # Do NOT call self.save_state() here
        # This ensures wallets.json is preserved for next startup
