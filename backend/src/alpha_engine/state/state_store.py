import asyncio
import copy
import time
from typing import Dict, Optional
from .market_state import MarketState

class StateStore:
    """
    Thread-safe, async-accessible in-memory store for MarketState.
    Keyed by symbol.
    """
    def __init__(self):
        self._states: Dict[str, MarketState] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._index_lock = asyncio.Lock()

    async def _ensure_symbol(self, symbol: str):
        async with self._index_lock:
            if symbol not in self._states:
                self._states[symbol] = MarketState(symbol=symbol)
                self._locks[symbol] = asyncio.Lock()
            return self._states[symbol], self._locks[symbol]

    async def update_state(self, symbol: str, updates: Dict):
        symbol = symbol.upper()
        state, symbol_lock = await self._ensure_symbol(symbol)
        async with symbol_lock:
            # Stamp updates at write-time if caller did not provide explicit exchange timestamp.
            if "timestamp" not in updates:
                setattr(state, "timestamp", int(time.time() * 1000))
            for key, value in updates.items():
                if hasattr(state, key):
                    setattr(state, key, value)

    async def get_state(self, symbol: str) -> Optional[MarketState]:
        symbol = symbol.upper()
        async with self._index_lock:
            state = self._states.get(symbol)
            symbol_lock = self._locks.get(symbol)
            if state is None:
                return None
        if symbol_lock is None:
            return None
        async with symbol_lock:
            # Return a defensive copy so callers cannot mutate shared state out-of-lock.
            return copy.deepcopy(state)

    async def get_all_symbols(self):
        async with self._index_lock:
            return list(self._states.keys())

# Singleton instance for global access
global_state_store = StateStore()
