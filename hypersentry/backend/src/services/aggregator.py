import asyncio
import json
import logging
import time
from typing import Dict, List, Any, Set
import websockets
from src.ws_manager import manager as ws_manager

logger = logging.getLogger(__name__)

class DataAggregator:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataAggregator, cls).__new__(cls)
            cls._instance.is_running = False
            cls._instance.subscriptions: Set[str] = set()
            cls._instance.active_subs: Set[str] = set()
            cls._instance.data_cache: Dict[str, Any] = {}
            cls._instance.cvd_data: Dict[str, float] = {}
            cls._instance.last_broadcast_time = 0
            cls._instance.broadcast_interval = 0.1
        return cls._instance

    async def start(self):
        print("DEBUG: DataAggregator.start() called!")
        if self.is_running: return
        self.is_running = True
        logger.info("🚀 Data Aggregator: Online")
        asyncio.create_task(self._ws_loop())
        asyncio.create_task(self._broadcast_loop())

    async def _ws_loop(self):
        url = "wss://api.hyperliquid.xyz/ws"
        while self.is_running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                    self._ws = ws
                    logger.info("✅ Aggregator: Connected to HL")
                    self.active_subs = set() # Reset on new connection
                    
                    # Core global mids
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "allMids"}}))
                    
                    while self.is_running:
                        try:
                            # Process pending subs (handle new ones rapidly)
                            current_targets = list(self.subscriptions)
                            for coin in current_targets:
                                if coin not in self.active_subs:
                                    logger.info(f"📡 Aggregator: Requesting data for {coin}")
                                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "l2Book", "coin": coin}}))
                                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "trades", "coin": coin}}))
                                    self.active_subs.add(coin)

                            # Recv with timeout to allow loop maintenance
                            try:
                                msg = await asyncio.wait_for(ws.recv(), timeout=0.5)
                                if not msg: continue
                                data = json.loads(msg)
                                # logger.debug(f"Aggregator received message from {data.get('channel')}")
                                self._handle_message(data)
                            except asyncio.TimeoutError:
                                continue
                            except json.JSONDecodeError:
                                continue
                        except Exception as e:
                            logger.error(f"⚠️ Aggregator Inner Loop Error: {e}")
                            break
            except Exception as e:
                logger.error(f"❌ Aggregator Connection Failed: {e}. Reconnect in 5s.")
                await asyncio.sleep(5)

    def _handle_message(self, msg: Dict[str, Any]):
        channel = msg.get("channel")
        data = msg.get("data")
        if not channel or not data: return
        
        coin = data.get("coin") if isinstance(data, dict) else None
        
        if channel == "allMids":
            mids = data.get("mids", {}) if isinstance(data, dict) else {}
            for c, px in mids.items():
                self._update_cache(c, "price", float(px))
        
        elif channel == "l2Book" and coin:
            levels = data.get("levels")
            if levels and len(levels) >= 2:
                self._update_cache(coin, "book", levels)
                self._update_cache(coin, "walls", self._detect_walls(levels))
                
        elif channel == "trades" and isinstance(data, list) and data:
            for t in data:
                c = t.get("coin")
                if c:
                    px, sz, side = float(t.get("px", 0)), float(t.get("sz", 0)), t.get("side")
                    self.cvd_data[c] = self.cvd_data.get(c, 0) + (sz if side == "B" else -sz)
                    if c not in self.data_cache: self._update_cache(c, "price", px)
                    hist = self.data_cache[c].get("trades", [])
                    hist.insert(0, t)
                    self.data_cache[c]["trades"] = hist[:100]
                    self.data_cache[c]["price"] = px

    def _update_cache(self, coin: str, key: str, value: Any):
        if coin not in self.data_cache:
            self.data_cache[coin] = {"price": 0, "book": [[], []], "trades": [], "walls": []}
        self.data_cache[coin][key] = value

    def _detect_walls(self, levels: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        walls = []
        try:
            bids, asks = levels[0][:20], levels[1][:20]
            avg = sum(float(l["sz"]) for l in (bids + asks)) / len(bids + asks)
            for i, side_l in enumerate([bids, asks]):
                side = "bid" if i == 0 else "ask"
                for l in side_l:
                    sz = float(l["sz"])
                    if sz > avg * 15:
                        walls.append({"px": l["px"], "sz": l["sz"], "side": side, "strength": "massive"})
                    elif sz > avg * 8:
                        walls.append({"px": l["px"], "sz": l["sz"], "side": side, "strength": "major"})
        except: pass
        return walls[:8]

    async def _broadcast_loop(self):
        while self.is_running:
            try:
                start = time.time()
                packet = {"type": "agg_update", "data": {}}
                for c in list(self.subscriptions):
                    if c in self.data_cache:
                        packet["data"][c] = {**self.data_cache[c], "cvd": round(self.cvd_data.get(c, 0), 2)}
                if packet["data"]:
                    # logger.debug(f"📡 Aggregator: Broadcasting update for {list(packet['data'].keys())}")
                    await ws_manager.broadcast(packet)
                    self.last_broadcast_time = time.time()
                
                # Maintain ~10Hz frequency
                await asyncio.sleep(max(0.01, self.broadcast_interval - (time.time() - start)))
            except Exception as e:
                logger.error(f"⚠️ Broadcast Loop Error: {e}")
                await asyncio.sleep(1)

    def subscribe(self, coin: str):
        self.subscriptions.add(coin.upper())

aggregator = DataAggregator()
