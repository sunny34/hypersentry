"""
Cross-exchange liquidation WebSocket consumers.
Connects to Binance and Bybit WebSocket APIs to aggregate liquidation data.
Publishes normalized events to the event bus.
"""
import asyncio
import json
import logging
import os
import random
import time
from typing import Dict, Optional

from aiohttp import WSMsgType

from src.services.event_bus import event_bus

logger = logging.getLogger(__name__)

LIQUIDATION_EVENT_TYPE = "liquidation"
MAX_QUEUE_SIZE = 5000


class CrossExchangeLiquidationConsumer:
    """
    Consumes liquidation WebSocket streams from multiple exchanges:
    - Binance Futures: wss://fstream.binance.com/ws/<symbol>@liquidation
    - Bybit: wss://stream.bybit.com/v5/public/linear (liquidations endpoint)
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CrossExchangeLiquidationConsumer, cls).__new__(cls)
            cls._instance._running = False
            cls._instance._tasks: Dict[str, asyncio.Task] = {}
            cls._instance._sessions: Dict[str, any] = {}
            cls._instance._enabled_exchanges = cls._instance._load_enabled_exchanges()
            cls._instance._symbols = cls._instance._load_symbols()
            cls._instance._reconnect_delays: Dict[str, float] = {}
            cls._instance._last_log_ts: Dict[str, float] = {}
        return cls._instance

    def _load_enabled_exchanges(self) -> list:
        env = os.getenv("LIQUIDATION_EXCHANGES", "binance,bybit").lower()
        return [e.strip() for e in env.split(",") if e.strip()]

    def _load_symbols(self) -> list:
        env = os.getenv("LIQUIDATION_SYMBOLS", "BTC,ETH,SOL,BNB,XRP,ADA,DOGE,AVAX,LINK")
        return [s.strip().upper() for s in env.split(",") if s.strip()]

    async def start(self):
        """Start all enabled exchange consumers."""
        if self._running:
            return

        self._running = True
        logger.info("Starting cross-exchange liquidation consumer: exchanges=%s symbols=%s",
                    self._enabled_exchanges, self._symbols)

        for exchange in self._enabled_exchanges:
            if exchange == "binance":
                asyncio.create_task(self._run_binance_consumer())
            elif exchange == "bybit":
                asyncio.create_task(self._run_bybit_consumer())
            else:
                logger.warning("Unknown exchange: %s", exchange)

    async def stop(self):
        """Stop all consumers."""
        self._running = False
        for task in self._tasks.values():
            task.cancel()
        for session in self._sessions.values():
            if session:
                await session.close()
        self._tasks.clear()
        self._sessions.clear()
        logger.info("Cross-exchange liquidation consumer stopped")

    def _get_reconnect_delay(self, exchange: str) -> float:
        """Exponential backoff with jitter."""
        current = self._reconnect_delays.get(exchange, 1.0)
        delay = min(current * 2, 60.0)  # Max 60 seconds
        jitter = random.uniform(0, 1)
        self._reconnect_delays[exchange] = delay
        return delay + jitter

    async def _run_binance_consumer(self):
        """Run Binance futures liquidation WebSocket consumer."""
        exchange = "binance"
        logger.info("Starting Binance liquidation consumer")

        while self._running:
            try:
                session = await self._create_session()
                self._sessions[exchange] = session

                # Connect to combined stream for all symbols
                streams = "/".join([f"{s.lower()}@liquidation" for s in self._symbols])
                ws_url = f"wss://fstream.binance.com/stream?streams={streams}"

                async with session.ws_connect(ws_url) as ws:
                    self._reconnect_delays[exchange] = 1.0
                    logger.info("Binance liquidation WebSocket connected")

                    async for msg in ws:
                        if not self._running:
                            break

                        if msg.type == WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                if "data" in data:
                                    await self._process_binance_liquidation(data["data"])
                            except json.JSONDecodeError:
                                pass
                        elif msg.type == WSMsgType.ERROR:
                            logger.error("Binance WS error: %s", msg.data)
                            break

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Binance liquidation consumer error: %s", e)
                if self._running:
                    delay = self._get_reconnect_delay(exchange)
                    logger.info("Reconnecting to Binance in %.1f seconds", delay)
                    await asyncio.sleep(delay)
            finally:
                if exchange in self._sessions and self._sessions[exchange]:
                    await self._sessions[exchange].close()
                    del self._sessions[exchange]

    async def _process_binance_liquidation(self, data: dict):
        """Process Binance liquidation event."""
        try:
            symbol = data.get("s", "")
            if not symbol:
                return

            # Binance liquidation data structure
            event = {
                "exchange": "binance",
                "symbol": symbol,
                "side": "SELL" if data.get("S") == "SELL" else "BUY",  # SELL = long liquidation, BUY = short
                "price": float(data.get("p", 0)),
                "quantity": float(data.get("q", 0)),
                "notional": float(data.get("q", 0)) * float(data.get("p", 0)),
                "timestamp": int(data.get("T", 0)),
            }

            await self._publish_liquidation(event)

        except Exception as e:
            logger.error("Error processing Binance liquidation: %s", e)

    async def _run_bybit_consumer(self):
        """Run Bybit linear futures liquidation WebSocket consumer."""
        exchange = "bybit"
        logger.info("Starting Bybit liquidation consumer")

        while self._running:
            try:
                session = await self._create_session()
                self._sessions[exchange] = session

                ws_url = "wss://stream.bybit.com/v5/public/linear"
                async with session.ws_connect(ws_url) as ws:
                    self._reconnect_delays[exchange] = 1.0
                    logger.info("Bybit liquidation WebSocket connected")

                    # Subscribe to liquidation events
                    subscribe_msg = {
                        "op": "subscribe",
                        "args": [f"liquidation.{s}" for s in self._symbols]
                    }
                    await ws.send_json(subscribe_msg)

                    async for msg in ws:
                        if not self._running:
                            break

                        if msg.type == WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                if data.get("topic", "").startswith("liquidation."):
                                    await self._process_bybit_liquidation(data)
                            except json.JSONDecodeError:
                                pass
                        elif msg.type == WSMsgType.ERROR:
                            logger.error("Bybit WS error: %s", msg.data)
                            break

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Bybit liquidation consumer error: %s", e)
                if self._running:
                    delay = self._get_reconnect_delay(exchange)
                    logger.info("Reconnecting to Bybit in %.1f seconds", delay)
                    await asyncio.sleep(delay)
            finally:
                if exchange in self._sessions and self._sessions[exchange]:
                    await self._sessions[exchange].close()
                    del self._sessions[exchange]

    async def _process_bybit_liquidation(self, data: dict):
        """Process Bybit liquidation event."""
        try:
            # Bybit sends data in an array under "data"
            data_list = data.get("data", [])
            if not data_list:
                return

            for item in data_list:
                symbol = item.get("symbol", "")
                if not symbol:
                    continue

                # Bybit: side S = Sell (long liq), side B = Buy (short liq)
                side = "SELL" if item.get("side") == "S" else "BUY"

                event = {
                    "exchange": "bybit",
                    "symbol": symbol,
                    "side": side,
                    "price": float(item.get("price", 0)),
                    "quantity": float(item.get("size", 0)),
                    "notional": float(item.get("price", 0)) * float(item.get("size", 0)),
                    "timestamp": int(item.get("createdTime", 0)),
                }

                await self._publish_liquidation(event)

        except Exception as e:
            logger.error("Error processing Bybit liquidation: %s", e)

    async def _publish_liquidation(self, event: dict):
        """Publish liquidation event to event bus."""
        try:
            # Rate limit logging
            now = time.time()
            key = f"{event['exchange']}:{event['symbol']}"
            last_log = self._last_log_ts.get(key, 0)
            should_log = now - last_log > 10  # Log at most every 10 seconds per symbol

            if should_log:
                self._last_log_ts[key] = now
                logger.info("Liquidation event: exchange=%s symbol=%s side=%s price=%.2f qty=%.4f",
                            event["exchange"], event["symbol"], event["side"],
                            event["price"], event["quantity"])

            await event_bus.publish(
                event_type=LIQUIDATION_EVENT_TYPE,
                data=event,
                source=event["exchange"],
                symbol=event["symbol"],
                ts_ms=event["timestamp"],
            )

        except Exception as e:
            logger.error("Error publishing liquidation event: %s", e)

    async def _create_session(self):
        """Create aiohttp session with appropriate timeout."""
        import aiohttp
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
        return aiohttp.ClientSession(timeout=timeout)


# Global singleton
cross_exchange_liquidation = CrossExchangeLiquidationConsumer()
