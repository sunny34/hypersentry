"""
Real liquidation data via cryptofeed.
Connects to Binance Futures, Bybit, and OKX for live liquidation events.
No estimates — only real exchange data.

Events are BATCHED to avoid overwhelming the event loop.
Runs inside the main asyncio event loop (CRYPTOFEED_NO_SIGNAL_HANDLERS=1).
"""
import os
os.environ["CRYPTOFEED_NO_SIGNAL_HANDLERS"] = "1"

import asyncio
import logging
import time
from collections import defaultdict
from typing import Set, Dict, List

logger = logging.getLogger(__name__)

# Symbols to track
_DEFAULT_SYMBOLS = os.getenv("LIQUIDATION_SYMBOLS", "BTC,ETH,SOL")
_SYMBOLS: Set[str] = {s.strip().upper() for s in _DEFAULT_SYMBOLS.split(",") if s.strip()}

# Batching config: flush every N seconds
_FLUSH_INTERVAL = float(os.getenv("LIQUIDATION_FLUSH_INTERVAL", "2.0"))


class CryptofeedLiquidationService:
    """
    Multi-exchange real liquidation feed using cryptofeed.
    Supports: Binance Futures, Bybit, OKX.
    
    Events are batched and flushed periodically to avoid
    overwhelming the asyncio event loop.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._running = False
            cls._instance._fh = None
            cls._instance._task = None
            cls._instance._flush_task = None
            cls._instance._event_count = 0
            cls._instance._last_event_ts = 0
            cls._instance._exchanges_connected: Set[str] = set()
            # Batch buffer: symbol -> list of (price, side, notional, exchange)
            cls._instance._batch: Dict[str, List[tuple]] = defaultdict(list)
            cls._instance._batch_lock = None  # Created in async context
        return cls._instance

    async def start(self):
        """Start the cryptofeed liquidation feeds."""
        if self._running:
            logger.info("Cryptofeed liquidation service already running")
            return

        self._batch_lock = asyncio.Lock()
        self._running = True
        self._task = asyncio.create_task(self._run())
        self._flush_task = asyncio.create_task(self._flush_loop())
        logger.warning("🔴 Cryptofeed liquidation service starting for symbols: %s", _SYMBOLS)

    async def _run(self):
        """Main loop — build and run the FeedHandler."""
        while self._running:
            try:
                await self._start_feeds()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Cryptofeed liquidation service error: %s", e, exc_info=True)
                if self._running:
                    logger.info("Restarting cryptofeed in 10s...")
                    await asyncio.sleep(10)

    async def _start_feeds(self):
        """Build cryptofeed FeedHandler and start feeds."""
        from cryptofeed import FeedHandler
        from cryptofeed.defines import LIQUIDATIONS

        fh = FeedHandler()
        self._fh = fh

        # Build symbol lists for each exchange
        symbols = [f"{s}-USDT-PERP" for s in _SYMBOLS]

        # --- Binance Futures ---
        try:
            from cryptofeed.exchanges import BinanceFutures
            fh.add_feed(BinanceFutures(
                symbols=symbols,
                channels=[LIQUIDATIONS],
                callbacks={LIQUIDATIONS: self._handle_liquidation},
            ))
            self._exchanges_connected.add("binance_futures")
            logger.warning("✅ Cryptofeed: Binance Futures liquidation feed added")
        except Exception as e:
            logger.warning("⚠️ Cryptofeed: Could not add Binance Futures: %s", e)

        # --- Bybit ---
        try:
            from cryptofeed.exchanges import Bybit
            fh.add_feed(Bybit(
                symbols=symbols,
                channels=[LIQUIDATIONS],
                callbacks={LIQUIDATIONS: self._handle_liquidation},
            ))
            self._exchanges_connected.add("bybit")
            logger.warning("✅ Cryptofeed: Bybit liquidation feed added")
        except Exception as e:
            logger.warning("⚠️ Cryptofeed: Could not add Bybit: %s", e)

        # --- OKX ---
        try:
            from cryptofeed.exchanges import OKX
            fh.add_feed(OKX(
                symbols=symbols,
                channels=[LIQUIDATIONS],
                callbacks={LIQUIDATIONS: self._handle_liquidation},
            ))
            self._exchanges_connected.add("okx")
            logger.warning("✅ Cryptofeed: OKX liquidation feed added")
        except Exception as e:
            logger.warning("⚠️ Cryptofeed: Could not add OKX: %s", e)

        if not self._exchanges_connected:
            logger.error("❌ Cryptofeed: No exchanges could be added.")
            await asyncio.sleep(30)
            return

        logger.warning("🔴 Cryptofeed: Starting feeds for exchanges: %s", self._exchanges_connected)

        # Run without starting a new event loop
        fh.run(start_loop=False)

        # Keep alive until stopped
        while self._running:
            await asyncio.sleep(10)

    async def _handle_liquidation(self, liquidation, timestamp):
        """
        Callback from cryptofeed — just buffer the event, don't do heavy work.
        The flush loop handles state store + event bus updates in batches.
        """
        try:
            symbol = liquidation.symbol
            if not symbol:
                return

            # Normalize symbol: "BTC-USDT-PERP" -> "BTC"
            base = symbol
            for suffix in ["-USDT-PERP", "-USDT-SWAP", "-USD-PERP", "USDT", "-PERP"]:
                if base.endswith(suffix):
                    base = base[:-len(suffix)]
                    break
            base = base.upper()

            if base not in _SYMBOLS:
                return

            price = float(liquidation.price) if liquidation.price else 0
            qty = float(liquidation.quantity) if liquidation.quantity else 0
            if not price or not qty:
                return

            side_raw = str(getattr(liquidation, 'side', '')).upper()
            liq_side = "SHORT" if side_raw == "BUY" else "LONG"
            notional = float(getattr(liquidation, 'notional', 0)) or (price * qty)
            exchange = str(getattr(liquidation, 'exchange', 'unknown')).lower()

            self._event_count += 1
            self._last_event_ts = time.time()

            # Buffer — no async lock needed, append is thread-safe in CPython
            self._batch[base].append((price, liq_side, notional, exchange, int(time.time() * 1000)))

        except Exception as e:
            logger.error("Error buffering liquidation: %s", e)

    async def _flush_loop(self):
        """Periodically flush batched liquidation events to state store."""
        from src.alpha_engine.models.liquidation_models import LiquidationLevel
        from src.alpha_engine.state.state_store import global_state_store

        while self._running:
            await asyncio.sleep(_FLUSH_INTERVAL)

            try:
                # Snapshot and clear buffer
                snapshot: Dict[str, List[tuple]] = {}
                for sym in list(self._batch.keys()):
                    items = self._batch.pop(sym, [])
                    if items:
                        snapshot[sym] = items

                if not snapshot:
                    continue

                for symbol, events in snapshot.items():
                    # Aggregate into LiquidationLevel objects
                    levels = []
                    total_notional = 0.0
                    long_notional = 0.0
                    short_notional = 0.0

                    for price, side, notional, exchange, ts in events:
                        levels.append(LiquidationLevel(
                            price=price,
                            side=side,
                            notional=notional,
                            timestamp=ts,
                            exchange=exchange,
                        ))
                        total_notional += notional
                        if side == "LONG":
                            long_notional += notional
                        else:
                            short_notional += notional

                    # Push batch to state store (single lock acquisition per symbol)
                    await global_state_store.update_state(
                        symbol,
                        {"liquidation_levels": levels}
                    )

                    # Log only significant batches (>$1M total)
                    if total_notional >= 1_000_000:
                        logger.info(
                            f"💧 LIQUIDATIONS [{symbol}]: {len(events)} events, "
                            f"${total_notional:,.0f} total "
                            f"(L:${long_notional:,.0f} S:${short_notional:,.0f})"
                        )

                    # Publish single aggregated event to event bus
                    try:
                        from src.services.event_bus import event_bus
                        await event_bus.publish(
                            event_type="liquidation_batch",
                            data={
                                "symbol": symbol,
                                "count": len(events),
                                "total_notional": total_notional,
                                "long_notional": long_notional,
                                "short_notional": short_notional,
                                "timestamp": int(time.time() * 1000),
                            },
                            source="cryptofeed_liquidation",
                            symbol=symbol,
                        )
                    except Exception as e:
                        logger.warning("Failed to publish liquidation batch: %s", e)

                    # Yield control to event loop between symbols
                    await asyncio.sleep(0)

            except Exception as e:
                logger.error("Error flushing liquidation batch: %s", e, exc_info=True)

    def get_stats(self) -> dict:
        """Return service stats."""
        pending = sum(len(v) for v in self._batch.values())
        return {
            "running": self._running,
            "event_count": self._event_count,
            "last_event_ts": self._last_event_ts,
            "pending_buffer": pending,
            "exchanges": sorted(self._exchanges_connected),
            "symbols": sorted(_SYMBOLS),
            "flush_interval_sec": _FLUSH_INTERVAL,
        }

    async def stop(self):
        """Stop the service."""
        self._running = False
        # Final flush
        try:
            await self._flush_loop_once()
        except Exception:
            pass
        if self._fh:
            try:
                for feed in self._fh.feeds:
                    try:
                        await feed.stop()
                    except Exception:
                        pass
            except Exception:
                pass
            self._fh = None
        for task in [self._task, self._flush_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.warning("Cryptofeed liquidation service stopped (total events: %d)", self._event_count)


# Global singleton
cryptofeed_liquidation_service = CryptofeedLiquidationService()
