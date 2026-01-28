import asyncio
import logging
import aiohttp
from typing import List, Set, Dict
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

    def remove_token(self, token: str):
        self.watched_tokens.discard(token.upper())

    def set_min_size(self, size: float):
        self.min_size_usd = size
        logger.info(f"TWAP Min Size updated to: ${size:,.0f}")
