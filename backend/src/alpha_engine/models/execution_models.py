from pydantic import BaseModel
from typing import List, Literal, Optional, Dict
from datetime import datetime

class SlippageMetrics(BaseModel):
    """
    Estimated slippage and market impact analysis.
    """
    expected_impact_bps: float
    expected_impact_usd: float
    liquidity_available_usd: float
    depth_processed_levels: int

class UrgencyMetrics(BaseModel):
    """
    Urgency scoring for execution timing.
    """
    urgency_score: float # 0.0 to 1.0
    impulse_factor: float
    conviction_factor: float
    regime_adjustment: float
    decay_rate: float

class OrderAction(BaseModel):
    """
    Individual child order specification (slice).
    """
    order_type: Literal["MARKET", "LIMIT", "IOC", "POST_ONLY"]
    direction: Literal["BUY", "SELL"]
    amount_usd: float
    limit_price: Optional[float] = None
    urgency: Literal["LOW", "MEDIUM", "HIGH"]
    slice_id: int
    delay_ms: int # Relative delay

class ExecutionPlan(BaseModel):
    """
    Comprehensive plan for executing the desired risk allocation.
    """
    symbol: str
    total_size_usd: float
    direction: Literal["BUY", "SELL"]
    strategy: Literal["PASSIVE", "HYBRID", "AGGRESSIVE"]
    slippage_metrics: SlippageMetrics
    urgency_metrics: UrgencyMetrics
    slices: List[OrderAction]
    adverse_selection_checks: Dict[str, bool]
    timestamp: datetime
