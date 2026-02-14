import asyncio
import logging
import aiohttp
from typing import List, Dict, Optional
import time

logger = logging.getLogger("PassiveWallDetector")

class PassiveWallDetector:
    """
    Background worker that fetches and caches limit order walls.
    Hybrid Strategy: 
    1. Try Binance (Spot) & Coinbase (Spot) for major liquidity depth.
    2. Fallback to Hyperliquid L2 if token is not found on CEX (e.g. HYPE, PURR).
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
        logger.info("📡 Passive Wall Detector Started (Hybrid Mode: CEX + Hyperliquid Fallback)")
        
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

    async def _fetch_deep_walls_external(self, session, token: str):
        """Fetch depth from Binance/Coinbase."""
        token_upper = token.upper()
        # Robust Mapping
        binance_sym = f"{token_upper}USDT"
        if token_upper == "BTC": binance_sym = "BTCUSDT"
        elif token_upper == "ETH": binance_sym = "ETHUSDT"
        coinbase_sym = f"{token_upper}-USD"
        
        walls = []
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

        # 1. Binance Depth (Spot)
        try:
            # Short timeout to fail fast if not found
            async with session.get(f"https://api.binance.com/api/v3/depth?symbol={binance_sym}&limit=50", headers=headers, timeout=2) as resp:
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
        except Exception:
            pass

        # 2. Coinbase Depth (Spot)
        try:
            async with session.get(f"https://api.exchange.coinbase.com/products/{coinbase_sym}/book?level=2", headers=headers, timeout=2) as resp:
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
        except Exception:
            pass
            
        return walls

    async def _fetch_hl_l2(self, session, token: str):
        """Fetch depth from Hyperliquid L2 (Fallback/Native)."""
        walls = []
        try:
            url = "https://api.hyperliquid.xyz/info"
            payload = {"type": "l2Snapshot", "coin": token}
            async with session.post(url, json=payload, timeout=4) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    levels = data.get("levels", [])
                    if levels and len(levels) >= 2:
                        bids = levels[0]
                        asks = levels[1]
                        
                        parsed_bids = [{"px": float(b["px"]), "sz": float(b["sz"])} for b in bids[:50]]
                        parsed_asks = [{"px": float(a["px"]), "sz": float(a["sz"])} for a in asks[:50]]
                        
                        if parsed_bids and parsed_asks:
                            avg_bid_sz = sum(b["sz"] for b in parsed_bids) / len(parsed_bids)
                            avg_ask_sz = sum(a["sz"] for a in parsed_asks) / len(parsed_asks)
                            
                            for b in parsed_bids:
                                if b["sz"] > avg_bid_sz * 3: 
                                    walls.append({"px": b["px"], "sz": b["sz"], "side": "buy", "ex": "Hyperliquid"})
                            for a in parsed_asks:
                                if a["sz"] > avg_ask_sz * 3:
                                    walls.append({"px": a["px"], "sz": a["sz"], "side": "sell", "ex": "Hyperliquid"})
        except Exception:
            pass
        return walls

    async def _fetch_token_walls(self, token: str):
        """Fetch depth with Hybrid Logic: ext -> fallback HL."""
        session = await self._get_session()
        token_upper = token.upper()
        
        # 1. Try External First (Binance/Coinbase)
        walls = await self._fetch_deep_walls_external(session, token_upper)
        
        # 2. If no walls found (likely not listed on CEX), try Hyperliquid
        if not walls:
             # logger.info(f"PassiveWalls: {token} not found on CEX, checking Hyperliquid...")
             walls = await self._fetch_hl_l2(session, token_upper)

        # Compute Intelligence
        buy_notional = sum(w["px"] * w["sz"] for w in walls if w["side"] == "buy")
        sell_notional = sum(w["px"] * w["sz"] for w in walls if w["side"] == "sell")
        
        bias = "neutral"
        if buy_notional > sell_notional * 1.5: bias = "bullish"
        elif sell_notional > buy_notional * 1.5: bias = "bearish"
        
        # Score normalization (Dynamic based on detected volume)
        total_vol = buy_notional + sell_notional
        
        intelligence = {
            "bias": bias,
            "gravity_score": min(total_vol / 2000000, 1.0),
            "institutional_activity": "accumulation" if buy_notional > 1000000 else "distribution" if sell_notional > 1000000 else "organic",
            "summary": f"Detected ${total_vol/1000:.1f}k in passive walls ({'Hyperliquid' if any(w['ex']=='Hyperliquid' for w in walls) else 'CEX'})."
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
