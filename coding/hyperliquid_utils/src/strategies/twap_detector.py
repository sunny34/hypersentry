import asyncio
import logging
import aiohttp
from typing import List, Set, Dict
from datetime import datetime
from collections import deque
from src.notifications import TelegramBot

logger = logging.getLogger("TwapDetector")

class TwapDetector:
    def __init__(self, notifier: TelegramBot):
        self.notifier = notifier
        self.watched_tokens: Set[str] = set()
        self.seen_hashes: Set[str] = set()
        self.active_twaps: Dict[str, List[Dict]] = {} # {token: [twap_data, ...]}
        self.is_running = False
        self.min_size_usd = 10000.0  # Default threshold, can be configurable
        
        # Time-series history for charts (store up to 24h of data points)
        # Each datapoint: {timestamp, buy_total, sell_total, net_delta, active_count}
        self.twap_history: Dict[str, deque] = {}  # {token: deque of datapoints}
        self.MAX_HISTORY_POINTS = 2880  # ~24h at 30s intervals
        
        # We'll use a session for reuse
        self.session = None

    async def scan_once(self, tokens: List[str] = None):
        """Run a single scan of the provided tokens (or watched_tokens)."""
        tokens_to_check = tokens if tokens else list(self.watched_tokens)
        
        async with aiohttp.ClientSession() as session:
            self.session = session
            logger.info(f"🔍 Scanning {len(tokens_to_check)} tokens for TWAPs...")
            for token in tokens_to_check:
                await self.check_token(token)
                await asyncio.sleep(2)  # Respect HypurrScan rate limits
            return self.active_twaps

    async def start(self):
        self.is_running = True
        logger.info("📡 TWAP Detector Started")
        
        async with aiohttp.ClientSession() as session:
            self.session = session
            while self.is_running:
                if not self.watched_tokens:
                    await asyncio.sleep(5)
                    continue

                # Do LOCAL checks to populate active_twaps for UI
                for token in list(self.watched_tokens):
                    await self.check_token(token)
                    await asyncio.sleep(2)  # Respect rate limits
                
                # Sleep between full cycles
                await asyncio.sleep(30)

    async def check_token(self, token: str, retries: int = 3):
        url = f"https://api.hypurrscan.io/twap/{token}"
        for attempt in range(retries):
            try:
                headers = {'accept': 'application/json'}
                async with self.session.get(url, headers=headers) as resp:
                    if resp.status == 429:
                        wait_time = (attempt + 1) * 5
                        logger.warning(f"Rate limited for {token}, waiting {wait_time}s...")
                        await asyncio.sleep(wait_time)
                        continue
                    if resp.status != 200:
                        logger.warning(f"Failed to fetch TWAPs for {token}: {resp.status}")
                        return
                    
                    data = await resp.json()
                    await self.process_twaps(token, data)
                    return  # Success, exit

            except Exception as e:
                logger.error(f"Error checking TWAPs for {token}: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(2)

    async def process_twaps(self, token: str, data: List[Dict]):
        # Filter active and large TWAPs
        # "Large" logic: list comprehension as requested
        # We need to filter out 'ended' (canceled/error)
        
        active_large_twaps = [
            item for item in data 
            if not item.get('ended')  # Must be active
            and item.get('action', {}).get('type') == 'twapOrder'
            and float(item.get('action', {}).get('twap', {}).get('s', 0)) >= self.min_size_usd
        ]

        # Update in-memory store for UI
        self.active_twaps[token] = active_large_twaps
        
        # Calculate aggregates for history chart
        buy_total = 0.0
        sell_total = 0.0
        users_buy = []
        users_sell = []
        
        for item in active_large_twaps:
            twap = item.get('action', {}).get('twap', {})
            size = float(twap.get('s', 0))
            is_buy = twap.get('b', False)
            user = item.get('user', '')
            
            if is_buy:
                buy_total += size
                users_buy.append({'user': user, 'size': size})
            else:
                sell_total += size
                users_sell.append({'user': user, 'size': size})
        
        net_delta = buy_total - sell_total
        
        # Record history datapoint
        self._record_history(token, buy_total, sell_total, net_delta, 
                           len(active_large_twaps), users_buy, users_sell)
        
        # Alerting Logic (only for new ones)
        for item in active_large_twaps:
            tx_hash = item['hash']
            if tx_hash in self.seen_hashes:
                continue
            twap = item['action']['twap']
            tx_hash = item['hash']
            user = item['user']
            
            is_buy = twap.get('b', False)
            size = float(twap.get('s', 0))
            minutes = twap.get('m', 0)
            
            # Mark seen
            self.seen_hashes.add(tx_hash)
            
            # Format Alert
            side_str = "🟢 BUY" if is_buy else "🔴 SELL"
            
            msg = (
                f"🚨 <b>Large TWAP Detected</b>\n\n"
                f"{side_str} <b>{token}</b>\n"
                f"📦 <b>Size:</b> ${size:,.0f}\n"
                f"⏱️ <b>Duration:</b> {minutes} mins\n"
                f"👤 <b>User:</b> `{user[:6]}...{user[-4:]}`\n"
                f"━━━━━━━━━━━━\n"
                f"<a href='https://hypurrscan.io/tx/{tx_hash}'>View on HypurrScan</a>"
            )
            
            await self.notifier.send_message(msg)
            logger.info(f"Reported TWAP: {token} ${size} ({side_str})")

    def add_token(self, token: str):
        self.watched_tokens.add(token.upper())
        # Initialize history deque if not exists
        if token.upper() not in self.twap_history:
            self.twap_history[token.upper()] = deque(maxlen=self.MAX_HISTORY_POINTS)

    def remove_token(self, token: str):
        self.watched_tokens.discard(token.upper())

    def set_min_size(self, size: float):
        self.min_size_usd = size
        logger.info(f"TWAP Min Size updated to: ${size:,.0f}")

    def _record_history(self, token: str, buy_total: float, sell_total: float, 
                       net_delta: float, active_count: int, 
                       users_buy: list, users_sell: list):
        """Record a history datapoint for the given token"""
        token = token.upper()
        
        # Initialize if needed
        if token not in self.twap_history:
            self.twap_history[token] = deque(maxlen=self.MAX_HISTORY_POINTS)
        
        datapoint = {
            'timestamp': int(datetime.now().timestamp() * 1000),  # ms
            'buy_total': buy_total,
            'sell_total': sell_total,
            'net_delta': net_delta,
            'active_count': active_count,
            'users_buy': users_buy,
            'users_sell': users_sell
        }
        
        self.twap_history[token].append(datapoint)

    def get_history(self, token: str, time_range: str = '1h') -> list:
        """
        Get history data for a token within a time range
        
        Args:
            token: Token symbol
            time_range: '1h', '4h', '24h', or 'all'
        
        Returns:
            List of datapoints for the chart
        """
        token = token.upper()
        
        if token not in self.twap_history:
            return []
        
        now = datetime.now().timestamp() * 1000
        
        # Calculate cutoff time based on range
        range_ms = {
            '1h': 3600 * 1000,
            '4h': 4 * 3600 * 1000,
            '24h': 24 * 3600 * 1000,
            'all': float('inf')
        }
        
        cutoff = now - range_ms.get(time_range, 3600 * 1000)
        
        # Filter and return
        history = list(self.twap_history[token])
        if time_range == 'all':
            return history
        
        return [dp for dp in history if dp['timestamp'] >= cutoff]

    def get_active_users(self, token: str) -> dict:
        """Get current active TWAP users for a token with details"""
        token = token.upper()
        
        if token not in self.active_twaps:
            return {'buyers': [], 'sellers': []}
        
        buyers = []
        sellers = []
        
        for item in self.active_twaps[token]:
            twap = item.get('action', {}).get('twap', {})
            user_info = {
                'address': item.get('user', ''),
                'size': float(twap.get('s', 0)),
                'duration': twap.get('m', 0),
                'hash': item.get('hash', ''),
                'started': item.get('time', 0)
            }
            
            if twap.get('b', False):
                buyers.append(user_info)
            else:
                sellers.append(user_info)
        
        # Sort by size descending
        buyers.sort(key=lambda x: x['size'], reverse=True)
        sellers.sort(key=lambda x: x['size'], reverse=True)
        
        return {'buyers': buyers, 'sellers': sellers}

    def get_all_tokens_summary(self) -> list:
        """Get summary of all watched tokens with latest TWAP data"""
        summaries = []
        
        for token in self.watched_tokens:
            history = self.get_history(token, '1h')
            latest = history[-1] if history else None
            
            summaries.append({
                'token': token,
                'active_count': len(self.active_twaps.get(token, [])),
                'buy_total': latest['buy_total'] if latest else 0,
                'sell_total': latest['sell_total'] if latest else 0,
                'net_delta': latest['net_delta'] if latest else 0,
                'has_history': len(history) > 0
            })
        
        return summaries
