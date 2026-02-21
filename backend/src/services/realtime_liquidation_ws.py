"""
Real-time liquidation fetcher via WebSocket.
Connects to Binance public WebSocket for actual liquidation events.
"""
import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Set

import aiohttp
from aiohttp import WSMsgType

from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.state.state_store import global_state_store
from src.services.event_bus import event_bus

logger = logging.getLogger(__name__)

LIQUIDATION_EVENT_TYPE = "liquidation"


class RealTimeLiquidationFetcher:
    """
    Connects to Binance public WebSocket for real liquidation events.
    This provides actual liquidation data, not estimates.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(RealTimeLiquidationFetcher, cls).__new__(cls)
            cls._instance._running = False
            cls._instance._ws = None
            cls._instance._session = None
            cls._instance._task = None
            cls._instance._enabled = os.getenv("LIQUIDATION_WS_ENABLE", "true").lower() in ("1", "true", "yes")
            cls._instance._symbols = cls._load_symbols()
            cls._instance._reconnect_delay = 1.0
        return cls._instance

    @staticmethod
    def _load_symbols() -> Set[str]:
        env = os.getenv("LIQUIDATION_SYMBOLS", "BTC,ETH,SOL,BNB,XRP,ADA,DOGE,AVAX,LINK")
        return {s.strip().upper() for s in env.split(",") if s.strip()}

    async def start(self):
        """Start the WebSocket consumer."""
        if self._running or not self._enabled:
            logger.info("Liquidation WS disabled or already running")
            return

        self._running = True
        self._task = asyncio.create_task(self._run_ws())
        logger.info("Real-time liquidation fetcher started for %s", self._symbols)

    async def stop(self):
        """Stop the WebSocket consumer."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._ws:
            await self._ws.close()
        if self._session:
            await self._session.close()
        logger.info("Real-time liquidation fetcher stopped")

    async def _run_ws(self):
        """Run the WebSocket connection."""
        while self._running:
            try:
                self._session = aiohttp.ClientSession()
                # Connect to combined liquidation stream
                streams = "/".join([f"{s.lower()}usdt@liquidation" for s in self._symbols])
                ws_url = f"wss://fstream.binance.com/stream?streams={streams}"

                logger.info("Connecting to Binance liquidation WebSocket: %s", streams)

                async with self._session.ws_connect(ws_url, heartbeat=30) as ws:
                    self._ws = ws
                    self._reconnect_delay = 1.0  # Reset on successful connect
                    logger.info("Connected to Binance liquidation WebSocket")

                    async for msg in ws:
                        if not self._running:
                            break

                        if msg.type == WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                if "data" in data:
                                    await self._process_liquidation(data["data"])
                            except json.JSONDecodeError:
                                pass
                        elif msg.type == WSMsgType.ERROR:
                            logger.error("WS error: %s", msg)
                            break

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Liquidation WS error: %s", e)
                if self._running:
                    logger.info("Reconnecting in %.1f seconds...", self._reconnect_delay)
                    await asyncio.sleep(self._reconnect_delay)
                    self._reconnect_delay = min(self._reconnect_delay * 2, 60)

            finally:
                if self._ws:
                    await self._ws.close()
                    self._ws = None
                if self._session:
                    await self._session.close()
                    self._session = None

    async def _process_liquidation(self, data: dict):
        """Process a liquidation event from WebSocket."""
        try:
            symbol = data.get("s", "")  # e.g., "BTCUSDT"
            if not symbol:
                return

            # Extract base symbol (remove USDT suffix)
            base_symbol = symbol.replace("USDT", "").replace("USDC", "").upper()
            if base_symbol not in self._symbols:
                return

            price = float(data.get("p", 0))
            quantity = float(data.get("q", 0))
            side = data.get("S", "")  # BUY or SELL

            if not price or not quantity:
                return

            # Binance: S = SELL means long liquidation, S = BUY means short liquidation
            liq_side = "LONG" if side == "SELL" else "SHORT"
            notional = price * quantity

            # Create LiquidationLevel
            liq_level = LiquidationLevel(
                price=price,
                side=liq_side,
                notional=notional,
                timestamp=int(data.get("T", time.time() * 1000)),
                exchange="binance"
            )

            logger.info("Liquidation: %s %s %.4f @ %.2f ($%.2f)",
                       base_symbol, liq_side, quantity, price, notional)

            # Update state store
            await global_state_store.update_state(
                base_symbol,
                {"liquidation_levels": [liq_level]}
            )

            # Also publish to event bus
            await event_bus.publish(
                event_type=LIQUIDATION_EVENT_TYPE,
                data={
                    "symbol": base_symbol,
                    "price": price,
                    "side": liq_side,
                    "notional": notional,
                    "quantity": quantity,
                    "exchange": "binance",
                    "timestamp": liq_level.timestamp
                },
                source="binance_liquidation_ws",
                symbol=base_symbol
            )

        except Exception as e:
            logger.error("Error processing liquidation: %s", e)


# Global singleton
liquidation_ws = RealTimeLiquidationFetcher()
