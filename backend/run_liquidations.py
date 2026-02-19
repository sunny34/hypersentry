#!/usr/bin/env python3
"""
Standalone liquidation feed using cryptofeed.
Run this as a separate process: python run_liquidations.py

It will push liquidations to Kafka (or inproc event bus).
"""
import os
os.environ["CRYPTOFEED_NO_SIGNAL_HANDLERS"] = "1"

import sys
import asyncio
import logging
from cryptofeed import FeedHandler
from cryptofeed.exchanges import BinanceFutures
from cryptofeed.defines import LIQUIDATIONS

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Setup Django-like environment
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'main')


async def handle_liquidation(liquidation, timestamp):
    """Handle liquidation event."""
    try:
        symbol = liquidation.symbol
        if not symbol:
            return

        # Normalize symbol
        for suffix in ["-USDT-PERP", "-USDT-SWAP", "USDT"]:
            if symbol.endswith(suffix):
                symbol = symbol[:-len(suffix)]
                break

        price = liquidation.price or 0
        qty = liquidation.quantity or 0
        if not price or not qty:
            return

        side = "SHORT" if liquidation.side.upper() == "BUY" else "LONG"
        notional = liquidation.notional or (price * qty)

        logger.warning(f"💧 LIQUIDATION: {symbol} {liquidation.exchange} {side} {qty} @ {price} (${notional:,.0f})")

        # Push to Kafka
        try:
            from src.services.event_bus import event_bus
            await event_bus.start()
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
            logger.error(f"Error publishing to event bus: {e}")

    except Exception as e:
        logger.error(f"Error handling liquidation: {e}")


def main():
    symbols_env = os.getenv("LIQUIDATION_SYMBOLS", "BTC,ETH,SOL")
    symbols = [s.strip().upper() for s in symbols_env.split(",") if s.strip()]

    logger.info(f"Starting liquidation feed for: {symbols}")

    feed_symbols = [f"{s}-USDT-PERP" for s in symbols]
    logger.info(f"Feed symbols: {feed_symbols}")

    fh = FeedHandler()

    from cryptofeed.callback import LiquidationCallback
    callback = LiquidationCallback(handle_liquidation)

    fh.add_feed(BinanceFutures(
        symbols=feed_symbols,
        channels=[LIQUIDATIONS],
        callbacks={LIQUIDATIONS: callback}
    ))

    logger.info("Running cryptofeed...")
    fh.run()


if __name__ == "__main__":
    main()
