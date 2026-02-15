from pydantic import BaseModel
from typing import Optional, List, Literal, Tuple
from datetime import datetime

class Trade(BaseModel):
    """
    Standardized internal trade model for microstructure analysis.
    """
    price: float
    size: float
    side: Literal["BUY", "SELL"]
    timestamp: datetime

class SweepEvent(BaseModel):
    """
    Result of the Sweep Detector.
    Identify aggressive liquidity 'clearing' by institutional market orders.
    """
    event: Optional[Literal["BUY_SWEEP", "SELL_SWEEP"]] = None
    strength: float = 0.0 # 0.0 to 1.0
    levels_consumed: int = 0

class AbsorptionEvent(BaseModel):
    """
    Result of the Absorption Detector.
    High volume resting orders holding a price level against aggressive flow.
    """
    event: Optional[Literal["BUY_ABSORPTION", "SELL_ABSORPTION"]] = None
    strength: float = 0.0

class FlowImbalanceResult(BaseModel):
    """
    Result of the Flow Imbalance Processor.
    Compares active buy volume vs sell volume with statistical z-scoring.
    """
    imbalance_ratio: float
    z_score: float
    dominance: Literal["BUY_DOMINANT", "SELL_DOMINANT", "NEUTRAL"]

class ImpulseEvent(BaseModel):
    """
    Result of the Impulse Detector.
    Rapid CVD expansion coinciding with directional price momentum.
    """
    event: Optional[Literal["BULLISH_IMPULSE", "BEARISH_IMPULSE"]] = None
    strength: float = 0.0

class FootprintResult(BaseModel):
    """
    Consolidated footprint and aggression analysis for a specific symbol.
    """
    symbol: str
    sweep: SweepEvent
    absorption: AbsorptionEvent
    imbalance: FlowImbalanceResult
    impulse: ImpulseEvent
    timestamp: int
