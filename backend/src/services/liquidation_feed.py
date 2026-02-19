"""
Direct Binance WebSocket for liquidations.
"""
import os
import time
import json
import logging
import asyncio
import aiohttp
from typing import Set

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
LIQUIDATION_EVENT_TYPE = "liquidation"

LIQUIDATION_FEED_ENABLED = os.getenv("LIQUIDATION_FEED_ENABLE", "false").lower() in ("1", "true", "yes")

# Log at module load
print(f"LIQUIDATION_FEED_ENABLED = {LIQUIDATION_FEED_ENABLED}")
print(f"LIQUIDATION_SYMBOLS = {os.getenv('LIQUIDATION_SYMBOLS', 'BTC,ETH,SOL')}")

logger.warning(f"LIQUIDATION_FEED_ENABLED = {LIQUIDATION_FEED_ENABLED}")


class LiquidationFeed:
    """Direct WebSocket connection to Binance."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._running = False
            cls._instance._task = None
            cls._instance._enabled = LIQUIDATION_FEED_ENABLED
            cls._instance._symbols = cls._load_symbols()
        return cls._instance

    @staticmethod
    def _load_symbols() -> Set[str]:
        env = os.getenv("LIQUIDATION_SYMBOLS", "BTC,ETH,SOL")
        return {s.strip().upper() for s in env.split(",") if s.strip()}

    async def start(self):
        if self._running or not self._enabled:
            logger.warning("Liquidation feed disabled or running")
            return

        self._running = True
        logger.warning(f"Starting Binance WS for {self._symbols}")

        asyncio.create_task(self._run_ws())

    async def _run_ws(self):
        """Connect to Binance liquidation WebSocket."""
        symbols = [f"{s.lower()}usdt@liquidation" for s in self._symbols]
        streams = "/".join(symbols)
        url = f"wss://fstream.binance.com/stream?streams={streams}"

        logger.warning(f"Connecting to: {url}")

        while self._running:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(url, heartbeat=30) as ws:
                        logger.warning("Connected to Binance liquidation stream")
                        # Send ping every 30 seconds to confirm connection
                        ping_task = asyncio.create_task(self._ping_ws(ws))

                        async for msg in ws:
                            if not self._running:
                                break

                            # Log all message types
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                try:
                                    data = json.loads(msg.data)
                                    logger.warning(f"WS msg: {data.get('stream', 'unknown')} - {data.get('data', {})}")
                                    if "data" in data:
                                        await self._handle_liquidation(data["data"])
                                except Exception as e:
                                    logger.error(f"Parse error: {e}")
                            elif msg.type in (aiohttp.WSMsgType.PONG, aiohttp.WSMsgType.PING):
                                logger.info(f"Received: {msg.type}")
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                logger.error(f"WS error: {msg.data}")

                        ping_task.cancel()
                        try:
                            await ping_task
                        except:
                            pass
            except Exception as e:
                logger.error(f"WS error: {e}")
                await asyncio.sleep(5)

    async def _ping_ws(self, ws):
        """Send periodic pings."""
        while True:
            await asyncio.sleep(30)
            try:
                await ws.ping()
                logger.info("Ping sent")
            except Exception as e:
                logger.error(f"WS ping error: {e}")
                break

    async def _handle_liquidation(self, data: dict):
        """Process liquidation."""
        try:
            symbol = data.get("s", "")  # e.g., "BTCUSDT"
            if not symbol:
                return

            base = symbol.replace("USDT", "")
            if base not in self._symbols:
                return

            price = float(data.get("p", 0))
            qty = float(data.get("q", 0))
            side = data.get("S", "")  # BUY or SELL

            if not price or not qty:
                return

            liq_side = "SHORT" if side == "BUY" else "LONG"
            notional = price * qty

            logger.warning(f"💧 LIQUIDATION: {base} {liq_side} {qty} @ {price} (${notional:,.0f})")

            from src.alpha_engine.models.liquidation_models import LiquidationLevel
            liq_level = LiquidationLevel(
                price=price,
                side=liq_side,
                notional=notional,
                timestamp=int(time.time() * 1000),
                exchange="binance"
            )

            from src.alpha_engine.state.state_store import global_state_store
            await global_state_store.update_state(
                base,
                {"liquidation_levels": [liq_level]}
            )

        except Exception as e:
            logger.error(f"Error: {e}")

    async def stop(self):
        self._running = False
        logger.warning("Liquidation feed stopped")


liquidation_feed = LiquidationFeed()
