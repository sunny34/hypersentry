from enum import Enum
from pydantic import BaseModel
from typing import Optional

class MarketRegime(str, Enum):
    AGGRESSIVE_LONG_BUILD = "AGGRESSIVE_LONG_BUILD"
    AGGRESSIVE_SHORT_BUILD = "AGGRESSIVE_SHORT_BUILD"
    SHORT_COVER = "SHORT_COVER"
    LONG_UNWIND = "LONG_UNWIND"
    NEUTRAL = "NEUTRAL"

class VolatilityRegime(str, Enum):
    TRENDING = "TRENDING"
    COMPRESSION = "COMPRESSION"
    EXPANSION = "EXPANSION"

class AlphaSignal(BaseModel):
    symbol: str
    regime: MarketRegime
    regime_confidence: float
    volatility_regime: VolatilityRegime
    compression_score: float
    timestamp: int
