"""
External liquidation fetcher - estimates liquidation levels from open interest data.
"""
import asyncio
import logging
import os
import time
from typing import Dict, List

import aiohttp

from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.state.state_store import global_state_store

logger = logging.getLogger(__name__)

CACHE_TTL_SEC = 300


class ExternalLiquidationFetcher:
    """Fetches OI data and estimates liquidation levels."""

    _instance = None
    _last_fetch = 0.0
    _cached_levels: Dict[str, List[LiquidationLevel]] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ExternalLiquidationFetcher, cls).__new__(cls)
            cls._instance._enabled = os.getenv("EXTERNAL_LIQUIDATION_FETCH", "true").lower() in ("1", "true", "yes")
        return cls._instance

    async def fetch_and_update(self, symbol: str, force: bool = False) -> List[LiquidationLevel]:
        now = time.time()

        if not force and now - self._last_fetch < CACHE_TTL_SEC:
            return self._cached_levels.get(symbol.upper(), [])

        if not self._enabled:
            return []

        levels = []

        binance_levels = await self._fetch_binance_oi_levels(symbol)
        levels.extend(binance_levels)

        bybit_levels = await self._fetch_bybit_oi_levels(symbol)
        levels.extend(bybit_levels)

        if levels:
            self._cached_levels[symbol.upper()] = levels
            self._last_fetch = now

            current_price = await self._get_binance_price(symbol)

            await global_state_store.update_state(
                symbol.upper(),
                {
                    "liquidation_levels": levels,
                    "price": current_price,
                    "mark_price": current_price,
                }
            )

            logger.info("Estimated %d liquidation levels for %s (Binance: %d, Bybit: %d), price: %.2f",
                       len(levels), symbol.upper(), len(binance_levels), len(bybit_levels), current_price)

        return levels

    async def _get_binance_price(self, symbol: str) -> float:
        """Get current price from Binance."""
        try:
            url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={symbol}USDT"
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return 0.0
                    data = await resp.json()
                    return float(data.get("price", 0))
        except Exception as e:
            logger.warning("Error fetching Binance price: %s", e)
            return 0.0

    async def _fetch_binance_oi_levels(self, symbol: str) -> List[LiquidationLevel]:
        """Fetch Binance OI and estimate liquidation levels."""
        try:
            url = f"https://fapi.binance.com/fapi/v1/ticker/24hr?symbol={symbol}USDT"
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return []

                    data = await resp.json()
                    current_price = float(data.get("lastPrice", 0))
                    oi = float(data.get("openInterest", 0))

                    if not current_price or not oi:
                        return []

                    # Tapered estimation: closer levels have more liquidation density
                    # Real liquidation clusters are denser near-price (high leverage) 
                    # and sparser far-price (low leverage)
                    pct_levels = [0.02, 0.03, 0.05, 0.08, 0.10]
                    # Weight factors: exponential decay with distance
                    weight_factors = [0.35, 0.25, 0.20, 0.12, 0.08]
                    levels = []
                    oi_value_usd = oi * current_price

                    for pct, weight in zip(pct_levels, weight_factors):
                        long_price = current_price * (1 - pct)
                        long_notional = oi_value_usd * weight
                        levels.append(LiquidationLevel(
                            price=round(long_price, 2),
                            side="LONG",
                            notional=round(long_notional, 2),
                            timestamp=int(time.time() * 1000),
                            exchange="binance_est"
                        ))

                        short_price = current_price * (1 + pct)
                        short_notional = oi_value_usd * weight
                        levels.append(LiquidationLevel(
                            price=round(short_price, 2),
                            side="SHORT",
                            notional=round(short_notional, 2),
                            timestamp=int(time.time() * 1000),
                            exchange="binance_est"
                        ))

                    return levels

        except Exception as e:
            logger.warning("Error fetching Binance OI: %s", e)
            return []

    async def _fetch_bybit_oi_levels(self, symbol: str) -> List[LiquidationLevel]:
        """Fetch Bybit OI and estimate liquidation levels."""
        try:
            url = "https://api.bybit.com/v5/market/tickers"
            params = {"category": "linear", "symbol": f"{symbol}USDT"}
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, params=params) as resp:
                    if resp.status != 200:
                        return []

                    result = await resp.json()
                    if result.get("retCode") != 0:
                        return []

                    data = result.get("result", {}).get("list", [])
                    if not data:
                        return []

                    ticker = data[0]
                    current_price = float(ticker.get("lastPrice", 0))
                    oi = float(ticker.get("openInterest", 0))

                    if not current_price or not oi:
                        return []

                    pct_levels = [0.02, 0.03, 0.05, 0.08, 0.10]
                    weight_factors = [0.35, 0.25, 0.20, 0.12, 0.08]
                    levels = []
                    oi_value_usd = oi * current_price

                    for pct, weight in zip(pct_levels, weight_factors):
                        long_price = current_price * (1 - pct)
                        long_notional = oi_value_usd * weight
                        levels.append(LiquidationLevel(
                            price=round(long_price, 2),
                            side="LONG",
                            notional=round(long_notional, 2),
                            timestamp=int(time.time() * 1000),
                            exchange="bybit_est"
                        ))

                        short_price = current_price * (1 + pct)
                        short_notional = oi_value_usd * weight
                        levels.append(LiquidationLevel(
                            price=round(short_price, 2),
                            side="SHORT",
                            notional=round(short_notional, 2),
                            timestamp=int(time.time() * 1000),
                            exchange="bybit_est"
                        ))

                    return levels

        except Exception as e:
            logger.warning("Error fetching Bybit OI: %s", e)
            return []


external_liquidation_fetcher = ExternalLiquidationFetcher()
