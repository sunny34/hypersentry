import asyncio
import logging
import aiohttp
from typing import List, Dict, Optional
import time

logger = logging.getLogger("PassiveWallDetector")

class PassiveWallDetector:
    """
    Background worker that fetches and caches external limit order walls 
    from Binance and Coinbase to ensure lightning-fast terminal performance.
    """
    
    def __init__(self):
        self.cached_walls: Dict[str, List[Dict]] = {} # {token: [walls]}
        self.active_tokens: set = set()
        self.is_running = False
        self.session: Optional[aiohttp.ClientSession] = None
        self.POLL_INTERVAL = 15 # seconds
        self.last_update: Dict[str, float] = {}

    async def start(self):
        self.is_running = True
        logger.info("📡 Passive Wall Detector Started (Binance/Coinbase Optimizer)")
        
        while self.is_running:
            try:
                if not self.active_tokens:
                    await asyncio.sleep(5)
                    continue

                # Process tokens in parallel
                tasks = [self._fetch_token_walls(token) for token in list(self.active_tokens)]
                await asyncio.gather(*tasks)
                
                await asyncio.sleep(self.POLL_INTERVAL)
            except Exception as e:
                logger.error(f"Passive Wall polling error: {e}")
                await asyncio.sleep(10)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session

    async def _fetch_token_walls(self, token: str):
        """Fetch depth from external exchanges and compute intelligence summary."""
        token_upper = token.upper()
        
        # Robust Mapping
        binance_sym = f"{token_upper}USDT"
        if token_upper == "BTC": binance_sym = "BTCUSDT"
        elif token_upper == "ETH": binance_sym = "ETHUSDT"
        
        coinbase_sym = f"{token_upper}-USD"
        
        walls = []
        session = await self._get_session()
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

        # 1. Binance Depth (Spot)
        try:
            async with session.get(f"https://api.binance.com/api/v3/depth?symbol={binance_sym}&limit=50", headers=headers, timeout=3) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    bids, asks = data.get("bids", []), data.get("asks", [])
                    if bids and asks:
                        avg_bid = sum(float(b[1]) for b in bids) / len(bids)
                        avg_ask = sum(float(a[1]) for a in asks) / len(asks)
                        for px_str, sz_str in bids:
                            px, sz = float(px_str), float(sz_str)
                            if sz > avg_bid * 5:
                                walls.append({"px": px, "sz": sz, "side": "buy", "ex": "Binance"})
                        for px_str, sz_str in asks:
                            px, sz = float(px_str), float(sz_str)
                            if sz > avg_ask * 5:
                                walls.append({"px": px, "sz": sz, "side": "sell", "ex": "Binance"})
                else:
                    logger.warning(f"Binance error {resp.status} for {token_upper}")
        except Exception as e:
            logger.debug(f"Binance fetch failed for {token}: {e}")

        # 2. Coinbase Depth (Spot)
        try:
            async with session.get(f"https://api.exchange.coinbase.com/products/{coinbase_sym}/book?level=2", headers=headers, timeout=3) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    bids, asks = data.get("bids", []), data.get("asks", [])
                    if bids and asks:
                        avg_bid = sum(float(b[1]) for b in bids[:50]) / 50
                        avg_ask = sum(float(a[1]) for a in asks[:50]) / 50
                        for px_str, sz_str, _ in bids[:50]:
                            px, sz = float(px_str), float(sz_str)
                            if sz > avg_bid * 5:
                                walls.append({"px": px, "sz": sz, "side": "buy", "ex": "Coinbase"})
                        for px_str, sz_str, _ in asks[:50]:
                            px, sz = float(px_str), float(sz_str)
                            if sz > avg_ask * 5:
                                walls.append({"px": px, "sz": sz, "side": "sell", "ex": "Coinbase"})
        except Exception as e:
            logger.debug(f"Coinbase fetch failed for {token}: {e}")

        # Compute Intelligence
        buy_notional = sum(w["px"] * w["sz"] for w in walls if w["side"] == "buy")
        sell_notional = sum(w["px"] * w["sz"] for w in walls if w["side"] == "sell")
        
        intelligence = {
            "bias": "bullish" if buy_notional > sell_notional * 1.5 else "bearish" if sell_notional > buy_notional * 1.5 else "neutral",
            "gravity_score": min((buy_notional + sell_notional) / 5000000, 1.0), # Score based on 5M total wall depth
            "institutional_activity": "accumulation" if buy_notional > 2000000 else "distribution" if sell_notional > 2000000 else "organic",
            "summary": f"Detected ${ (buy_notional+sell_notional)/1e6 :.1f}M in passive walls."
        }

        self.cached_walls[token_upper] = {"walls": walls, "intelligence": intelligence}
        self.last_update[token_upper] = time.time()

    def get_walls(self, token: str) -> Dict:
        token_upper = token.upper()
        self.active_tokens.add(token_upper)
        return self.cached_walls.get(token_upper, {"walls": [], "intelligence": {}})

    def stop(self):
        self.is_running = False
        if self.session:
            asyncio.create_task(self.session.close())
