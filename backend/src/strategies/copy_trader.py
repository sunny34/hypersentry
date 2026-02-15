import asyncio
import logging
import random
import time
from src.client_wrapper import HyperliquidClient
from src.notifications import TelegramBot
from models import User, Wallet
from database import get_db_session

class CopyTrader:
    def __init__(self, client: HyperliquidClient, notifier: TelegramBot, target_address: str, active_trading: bool = False, silent: bool = False, label: str = None):
        self.client = client
        self.notifier = notifier
        self.target_address = target_address
        self.active_trading = active_trading
        self.silent = silent
        self.label = label
        self.known_positions = {} # {coin: size}
        self.is_running = False
        self.last_twap_alert = 0
        self.last_twap_check = 0
        self.twap_history = [] # List of recent fill timestamps

    async def start(self):
        """
        Main loop for the copy trader.
        """
        self.is_running = True
        logging.info(f"Copy Trader started. Watching: {self.target_address} (Silent: {self.silent})")
        if not self.silent:
            await self.notifier.send_message(f"👀 Copy Trader Started.\nTarget: `{self.target_address}`")
        
        
        # Initial sync (Retry until success to avoid false positives)
        while True:
            if await self.sync_positions():
                break
            logging.warning(f"Initial sync failed for {self.target_address}, retrying in 10s...")
            await asyncio.sleep(10 + random.uniform(0, 5))
        
        while self.is_running:
            try:
                await self.check_updates()
                # Rate Limit Protection: 30s base + random jitter to prevent "thundering herd"
                await asyncio.sleep(30.0 + random.uniform(0, 10)) 
                
                # Check for TWAP/Whale activity (Every 5 mins)
                now = time.time()
                if now - self.last_twap_check > 300:
                    await self.detect_twap()
                    self.last_twap_check = now
            except Exception as e:
                logging.error(f"Error in CopyTrader loop: {e}")
                await asyncio.sleep(5.0)

    async def sync_positions(self) -> bool:
        """
        Fetch initial positions to avoid re-trading existing ones.
        Returns True if successful, False if API failed.
        """
        state = self.client.get_user_state(self.target_address)
        if not state:
            return False

        for pos in state.get('assetPositions', []):
            try:
                p = pos['position']
                coin = p['coin']
                size = float(p['szi'])
                self.known_positions[coin] = size
            except KeyError:
                continue
        logging.info(f"Initial Sync Complete. Tracking {len(self.known_positions)} positions.")
        return True

    async def check_updates(self):
        """
        Poll user state and detect changes.
        """
        state = self.client.get_user_state(self.target_address)
        if not state:
            return

        current_positions = {}
        
        # Parse current state
        for pos in state.get('assetPositions', []):
            try:
                p = pos['position']
                coin = p['coin']
                size = float(p['szi'])
                current_positions[coin] = size
            except KeyError:
                continue
        
        # Detect changes
        all_coins = set(self.known_positions.keys()) | set(current_positions.keys())
        
        for coin in all_coins:
            old_size = self.known_positions.get(coin, 0.0)
            new_size = current_positions.get(coin, 0.0)
            
            if old_size != new_size:
                # meaningful change? often minor dust changes happen
                if abs(new_size - old_size) < 0.0001: 
                    continue
                    
                logging.info(f"Detected Change for {coin}: {old_size} -> {new_size}")
                
                # Calculate trade diff
                diff = new_size - old_size
                is_buy = diff > 0
                abs_diff = abs(diff)
                
                # EXECUTE TRADE
                if self.active_trading:
                    logging.warning(f"⚔️ ACTIVE TRADE: Copying {coin}...")
                    await self.execute_copy_trade(coin, is_buy, abs_diff)
                else:
                    logging.info(f"🔔 ALERT ONLY (Trade Mode OFF): {coin} diff: {diff}")
                    
                    # Formatting
                    side_icon = "🟢" if is_buy else "🔴"
                    side_str = "BUY" if is_buy else "SELL"
                    # Rounding logic: 4 decimals max, strip trailing zeros
                    size_fmt = f"{abs_diff:.4f}".rstrip('0').rstrip('.')
                    
                    # Shorten address
                    short_addr = f"{self.target_address[:6]}...{self.target_address[-4:]}"
                    target_name = f"<b>{self.label}</b>" if self.label else f"<code>{short_addr}</code>"
                    
                    msg = (
                        f"💎 <b>Whale Alert</b>\n\n"
                        f"{side_icon} <b>{side_str} {coin}</b>\n"
                        f"━━━━━━━━━━━━\n"
                        f"📦 <b>Size:</b> <code>{size_fmt}</code>\n"
                        f"👤 <b>Target:</b> {target_name}\n"
                        f"━━━━━━━━━━━━\n"
                        f"<a href='https://app.hyperliquid.xyz/explorer/address/{self.target_address}'>View on Hyperliquid</a>"
                    )
                    
                    try:
                        with get_db_session() as db:
                            # Find all users watching this wallet
                            watchers = db.query(Wallet, User).join(User).filter(
                                Wallet.address == self.target_address
                            ).all()
                            
                            for wallet, user in watchers:
                                if user.telegram_chat_id:
                                    await self.notifier.send_message(msg, chat_id=user.telegram_chat_id)
                                    logging.info(f"Sent alert to {user.email} for {self.target_address}")
                    except Exception as e:
                        logging.error(f"Failed to send wallet alerts: {e}")
                
                # Update known position
                self.known_positions[coin] = new_size

    async def detect_twap(self):
        """
        Analyze recent fills to detect TWAP or High Frequency activity.
        """
        try:
            # Check last 50 fills
            fills = self.client.info.user_fills(self.target_address)
            if not fills:
                return

            import time
            now_ms = time.time() * 1000
            recent_fills = [f for f in fills if (now_ms - f['time']) < 3600 * 1000] # Last 1 hour

            if not recent_fills:
                return

            # Calc volume
            total_vol = sum([float(f['sz']) * float(f['px']) for f in recent_fills])
            count = len(recent_fills)

            # Thresholds: > $50k volume AND > 3 trades (Mini Whale TWAP)
            # Adjust these thresholds as needed
            if total_vol > 50000 and count >= 3:
                # Anti-Spam: Alert max once per hour unless volume doubles
                if (time.time() - self.last_twap_alert) > 3600:
                    
                    coin_set = set([f['coin'] for f in recent_fills])
                    coins_str = ", ".join(coin_set)
                    
                    msg = (
                        f"🐋 <b>Whale TWAP Detected</b>\n\n"
                        f"👤 <b>Target:</b> {self.label or self.target_address[:8]}\n"
                        f"📊 <b>Volume (1h):</b> ${total_vol:,.0f}\n"
                        f"🔢 <b>Trades:</b> {count}\n"
                        f"💰 <b>Assets:</b> {coins_str}\n"
                        f"━━━━━━━━━━━━\n"
                        f"<a href='https://app.hyperliquid.xyz/explorer/address/{self.target_address}'>View History</a>"
                    )
                    await self.notifier.send_message(msg)
                    self.last_twap_alert = time.time()

        except Exception as e:
            logging.error(f"TWAP check failed: {e}")

    async def execute_copy_trade(self, coin: str, is_buy: bool, sz: float):
        """
        Execute the trade on our account.
        """
        # Execute
        # Note: client.market_open is synchronous in our wrapper currently, 
        # but we should wrap it or make it async in a real high-perf scenario.
        # For now, running it directly is acceptable for MVP.
        try:
            # We run the sync method in a thread executor to avoid blocking the loop if it does IO
            # loop = asyncio.get_running_loop()
            # result = await loop.run_in_executor(None, self.client.market_open, coin, is_buy, sz)
            
            # Simple direct call for now (assumes low latency)
            result = self.client.market_open(coin, is_buy, sz)
            
            if result:
                 side_str = "BUY" if is_buy else "SELL"
                 logging.info(f"Copied Trade: {side_str} {sz} {coin}")
                 await self.notifier.send_order_alert(coin, sz, side_str)
            else:
                 logging.warning(f"Failed to copy trade for {coin}")
                 
        except Exception as e:
            logging.error(f"Exception executing trade: {e}")
