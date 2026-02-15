from pydantic import BaseModel
from typing import List, Dict, Literal

class LiquidationLevel(BaseModel):
    """
    Represents a specific price level where a significant cluster of 
    liquidation orders is expected. Derived from orderbook depth and 
    open interest distribution.
    """
    price: float
    side: Literal["LONG", "SHORT"]
    notional: float

class LiquidationProjectionResult(BaseModel):
    """
    The calculated outcome of the liquidation projection engine.
    Maps out the potential 'explosive' liquidity impact at various price levels.
    """
    symbol: str
    current_price: float
    upside: Dict[str, float]    # e.g., {"0.5%": 1200000.0}
    downside: Dict[str, float]  # e.g., {"0.5%": 850000.0}
    imbalance_ratio: float
    dominant_side: Literal["SHORT_SQUEEZE", "LONG_SQUEEZE", "BALANCED"]
