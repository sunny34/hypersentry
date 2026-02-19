from pydantic import BaseModel, Field
from typing import List, Dict, Literal, Optional

class LiquidationLevel(BaseModel):
    """
    Represents a specific price level where a significant cluster of
    liquidation orders is expected. Derived from orderbook depth and
    open interest distribution.
    """
    price: float
    side: Literal["LONG", "SHORT", "BUY", "SELL"] = "LONG"
    notional: float
    timestamp: int = 0
    exchange: str = "hl"  # Source exchange: hl, binance, binance_est, bybit_est, etc.

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
    data_source: str = Field(default="unknown", description="Where the data comes from: 'real' (exchange events), 'estimated' (OI-based), or 'mixed'")
    level_count: int = Field(default=0, description="Number of raw liquidation levels used in this projection")
    exchanges: List[str] = Field(default_factory=list, description="Which exchanges contributed data")
