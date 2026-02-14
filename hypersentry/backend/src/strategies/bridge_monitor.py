"""
Bridge Monitor - Alerts for large deposits into Hyperliquid
Uses Hypurrscan API to monitor bridge transactions
"""

import asyncio
import logging
import aiohttp
from typing import List, Dict, Set
from datetime import datetime
from src.notifications import TelegramBot

logger = logging.getLogger("BridgeMonitor")

class BridgeMonitor:
    def __init__(self, notifier: TelegramBot, min_amount_usd: float = 100_000):
        """
        Initialize bridge monitor
        
        Args:
            notifier: TelegramBot instance for alerts
            min_amount_usd: Minimum bridge amount to alert on (default $3M)
        """
        self.notifier = notifier
        self.min_amount_usd = min_amount_usd
        self.seen_hashes: Set[str] = set()
        self.recent_bridges: List[Dict] = []  # Store last 100 large bridges
        self.is_running = False
        self.session = None
        
    async def start(self):
        """Start the bridge monitor loop"""
        self.is_running = True
        logger.info(f"🌉 Bridge Monitor Started (threshold: ${self.min_amount_usd:,.0f})")
        
        async with aiohttp.ClientSession() as session:
            self.session = session
            while self.is_running:
                try:
                    await self.check_bridges()
                except Exception as e:
                    logger.error(f"Error in bridge monitor: {e}")
                
                await asyncio.sleep(60)  # Check every 60 seconds (less aggressive)
    
    async def check_bridges(self, retries: int = 3):
        """Fetch and process recent bridges from Hypurrscan"""
        url = "https://api.hypurrscan.io/bridges"
        
        for attempt in range(retries):
            try:
                headers = {'accept': 'application/json', 'User-Agent': 'HyperSentry/1.0'}
                async with self.session.get(url, headers=headers, timeout=20) as resp:
                    if resp.status == 429:
                        wait_time = (attempt + 1) * 10
                        logger.warning(f"Rate limited, waiting {wait_time}s...")
                        await asyncio.sleep(wait_time)
                        continue
                    
                    if resp.status != 200:
                        logger.warning(f"Bridge API returned {resp.status}")
                        await asyncio.sleep(5)
                        continue
                    
                    data = await resp.json()
                    await self.process_bridges(data)
                    return
                    
            except asyncio.TimeoutError:
                logger.warning(f"Bridge API timeout, attempt {attempt + 1}/{retries}")
                await asyncio.sleep(5)
            except aiohttp.ClientConnectorError as e:
                 logger.warning(f"Bridge connection error: {e}, attempt {attempt + 1}/{retries}")
                 await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Bridge check error: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(5)
    
    async def process_bridges(self, bridges: List[Dict]):
        """Process bridge transactions and alert on large ones"""
        for bridge in bridges:
            try:
                # Skip if already seen
                tx_hash = bridge.get('hash', '')
                if tx_hash in self.seen_hashes:
                    continue
                
                # Parse amount - Hypurrscan returns amount in various formats
                # Check for USDC deposits (most common)
                amount = self._parse_amount(bridge)
                
                if amount is None or amount < self.min_amount_usd:
                    continue
                
                # Mark as seen
                self.seen_hashes.add(tx_hash)
                
                # Get bridge details
                user = bridge.get('user', bridge.get('address', 'Unknown'))
                action_type = bridge.get('action', {}).get('type', 'deposit')
                timestamp = bridge.get('time', 0)
                
                # Only alert on deposits (not withdrawals)
                if 'withdraw' in action_type.lower():
                    continue
                
                # Format time
                time_str = datetime.fromtimestamp(timestamp / 1000).strftime('%H:%M:%S') if timestamp else 'Unknown'
                
                # Store for API/UI
                bridge_record = {
                    'hash': tx_hash,
                    'user': user,
                    'amount': amount,
                    'type': action_type,
                    'timestamp': timestamp,
                    'time_str': time_str
                }
                self.recent_bridges.insert(0, bridge_record)
                
                # Keep only last 100
                if len(self.recent_bridges) > 100:
                    self.recent_bridges = self.recent_bridges[:100]
                
                # Send Telegram alert
                await self._send_alert(bridge_record)
                
            except Exception as e:
                logger.error(f"Error processing bridge: {e}")
    
    def _parse_amount(self, bridge: Dict) -> float:
        """Extract USD amount from bridge transaction"""
        try:
            action = bridge.get('action', {})
            
            # Try different field names Hypurrscan might use
            for field in ['amount', 'sz', 's', 'size', 'value']:
                if field in action:
                    return float(action[field])
            
            # Check nested structures
            if 'usdTransfer' in action:
                return float(action['usdTransfer'].get('amount', 0))
            
            if 'deposit' in action:
                return float(action['deposit'].get('amount', 0))
                
            # Check top-level amount
            if 'amount' in bridge:
                return float(bridge['amount'])
                
            return None
            
        except (ValueError, TypeError):
            return None
    
    async def _send_alert(self, bridge: Dict):
        """Send Telegram alert for large bridge deposit"""
        user = bridge['user']
        amount = bridge['amount']
        tx_hash = bridge['hash']
        
        msg = (
            f"🌉 <b>Large Bridge Deposit</b>\n\n"
            f"💰 <b>Amount:</b> ${amount:,.0f} USDC\n"
            f"👤 <b>Address:</b> <code>{user[:6]}...{user[-4:]}</code>\n"
            f"⏰ <b>Time:</b> {bridge['time_str']}\n"
            f"━━━━━━━━━━━━\n"
            f"<a href='https://hypurrscan.io/tx/{tx_hash}'>View on HypurrScan</a>"
        )
        
        await self.notifier.send_message(msg)
        logger.info(f"🌉 Large bridge alert: ${amount:,.0f} from {user[:10]}...")
    
    def stop(self):
        """Stop the bridge monitor"""
        self.is_running = False
        logger.info("Bridge Monitor stopped")
    
    def set_threshold(self, amount: float):
        """Update the minimum alert threshold"""
        self.min_amount_usd = amount
        logger.info(f"Bridge threshold updated to: ${amount:,.0f}")
    
    def get_recent_bridges(self, limit: int = 20) -> List[Dict]:
        """Get recent large bridges for API/UI"""
        return self.recent_bridges[:limit]
    
    def get_stats(self) -> Dict:
        """Get bridge monitor stats"""
        last_24h = [b for b in self.recent_bridges 
                   if b['timestamp'] > (datetime.now().timestamp() * 1000 - 86400000)]
        
        return {
            'threshold': self.min_amount_usd,
            'total_seen': len(self.seen_hashes),
            'last_24h_count': len(last_24h),
            'last_24h_volume': sum(b['amount'] for b in last_24h),
            'is_running': self.is_running
        }
