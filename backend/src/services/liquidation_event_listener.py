"""
Event bus listener for cross-exchange liquidation events.
Consumes liquidation events from Kafka/inproc bus and forwards to alpha service.
"""
import asyncio
import logging
from typing import Optional

from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.services.alpha_service import alpha_service
from src.services.event_bus import event_bus, EventSubscription

logger = logging.getLogger(__name__)

LIQUIDATION_EVENT_TYPE = "liquidation"


class LiquidationEventListener:
    """
    Subscribes to the event bus for liquidation events and forwards them
    to the alpha service for processing.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(LiquidationEventListener, cls).__new__(cls)
            cls._instance._running = False
            cls._instance._subscription: Optional[EventSubscription] = None
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._enabled = True
        return cls._instance

    async def start(self):
        """Start listening for liquidation events."""
        if self._running:
            return

        self._running = True

        # Subscribe to liquidation events
        self._subscription = event_bus.subscribe(
            event_types={LIQUIDATION_EVENT_TYPE},
            max_queue_size=2000
        )

        # Start consumer task
        self._task = asyncio.create_task(self._consume_events())
        logger.info("Liquidation event listener started")

    async def stop(self):
        """Stop listening for events."""
        self._running = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        if self._subscription:
            event_bus.unsubscribe(self._subscription)
            self._subscription = None

        logger.info("Liquidation event listener stopped")

    async def _consume_events(self):
        """Consume events from the subscription queue."""
        if not self._subscription:
            return

        queue = self._subscription.queue

        while self._running:
            try:
                envelope = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            try:
                await self._handle_liquidation_event(envelope)
            except Exception as e:
                logger.error("Error handling liquidation event: %s", e)

    async def _handle_liquidation_event(self, envelope):
        """Process a liquidation event and forward to alpha service."""
        try:
            data = envelope.data

            # Normalize symbol (remove exchange-specific prefixes)
            symbol = self._normalize_symbol(data.get("symbol", ""))
            if not symbol:
                return

            # Convert to LiquidationLevel
            liq_level = LiquidationLevel(
                price=data.get("price", 0),
                side=data.get("side", "UNKNOWN"),
                notional=data.get("notional", 0),
                timestamp=data.get("timestamp", 0),
                exchange=data.get("exchange", "unknown"),
            )

            # Forward to alpha service for processing
            # The alpha service will handle merging into state store
            await alpha_service.update_market_state(
                symbol=symbol,
                data={"liquidation_event": liq_level}
            )

            logger.debug("Forwarded liquidation to alpha: %s %s %s %.2f $%.2f",
                        symbol, data.get("exchange"), liq_level.side,
                        liq_level.price, liq_level.notional)

        except Exception as e:
            logger.error("Error processing liquidation event: %s", e)

    def _normalize_symbol(self, symbol: str) -> Optional[str]:
        """Normalize symbol to standard format (e.g., BTCUSDT -> BTC)."""
        if not symbol:
            return None

        # Remove common suffixes
        for suffix in ["USDT", "USDC", "BUSD", "USD", "PERP"]:
            if symbol.endswith(suffix):
                symbol = symbol[:-len(suffix)]
                break

        return symbol.upper()


# Global singleton
liquidation_event_listener = LiquidationEventListener()
