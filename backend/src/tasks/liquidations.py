"""
Celery task for cryptofeed liquidations.
Run separately from uvicorn to avoid signal handler issues.
"""
import os
os.environ["CRYPTOFEED_NO_SIGNAL_HANDLERS"] = "1"

import json
import logging
import asyncio
from cryptofeed import FeedHandler
from cryptofeed.exchanges import BinanceFutures
from cryptofeed.defines import LIQUIDATIONS
from cryptofeed.callback import LiquidationCallback

from celery_app import celery_app
from src.services.event_bus import event_bus

logger = logging.getLogger(__name__)


class LiquidationsTask:
    """Hold state for liquidations."""

    _running = False
    _fh = None

    @staticmethod
    def _load_symbols():
        env = os.getenv("LIQUIDATION_SYMBOLS", "BTC,ETH,SOL")
        return {s.strip().upper() for s in env.split(",") if s.strip()}

    @staticmethod
    async def handle_liquidation(liquidation, timestamp):
        """Handle liquidation."""
        try:
            symbol = liquidation.symbol
            if not symbol:
                return

            for suffix in ["-USDT-PERP", "-USDT-SWAP", "USDT"]:
                if symbol.endswith(suffix):
                    symbol = symbol[:-len(suffix)]
                    break

            symbols = LiquidationsTask._load_symbols()
            if symbol.upper() not in symbols:
                return

            price = liquidation.price or 0
            qty = liquidation.quantity or 0
            if not price or not qty:
                return

            side = "SHORT" if liquidation.side.upper() == "BUY" else "LONG"
            notional = liquidation.notional or (price * qty)

            logger.warning(f"💧 {symbol} {side} {qty} @ {price}")

            # Push to Kafka
            await event_bus.publish(
                event_type="liquidation",
                data={
                    "symbol": symbol.upper(),
                    "price": price,
                    "side": side,
                    "notional": notional,
                    "quantity": qty,
                    "exchange": liquidation.exchange.lower(),
                },
                source=f"{liquidation.exchange.lower()}_liquidation",
                symbol=symbol.upper()
            )

        except Exception as e:
            logger.error(f"Error: {e}")

    @staticmethod
    def build_feed():
        symbols = LiquidationsTask._load_symbols()
        feed_symbols = [f"{s}-USDT-PERP" for s in symbols]

        fh = FeedHandler()
        callback = LiquidationsTask.handle_liquidation
        fh.add_feed(BinanceFutures(
            symbols=feed_symbols,
            channels=[LIQUIDATIONS],
            callbacks={LIQUIDATIONS: callback}
        ))
        return fh


@celery_app.task(name="liquidation.start_feed")
def start_liquidation_feed():
    """Start the liquidation feed."""
    logger.info("Starting cryptofeed liquidation task...")
    os.environ["CRYPTOFEED_NO_SIGNAL_HANDLERS"] = "1"

    symbols = LiquidationsTask._load_symbols()
    logger.info(f"Symbols: {symbols}")

    fh = LiquidationsTask.build_feed()

    try:
        logger.info("Running cryptofeed...")
        fh.run()
    except Exception as e:
        logger.error(f"Error: {e}")
        return {"status": "error", "message": str(e)}

    return {"status": "started"}
