from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime

class WalkForwardWindow(BaseModel):
    """
    Defines a single walk-forward cross-validation window.
    """
    train_start: datetime
    train_end: datetime
    test_start: datetime
    test_end: datetime

class OptimalWeights(BaseModel):
    """
    Set of optimized weights for the conviction engine.
    """
    w_regime: float
    w_liquidation: float
    w_footprint: float
    w_funding: float
    w_volatility: float
    sharpe_attained: float
    timestamp: datetime

class WindowResult(BaseModel):
    """
    Performance result for a single walk-forward window.
    """
    window: WalkForwardWindow
    weights: OptimalWeights
    return_pct: float
    sharpe: float
    max_drawdown: float

class WalkForwardReport(BaseModel):
    """
    Aggregated report for the entire walk-forward validation process.
    """
    symbol: str
    aggregated_return: float
    aggregated_sharpe: float
    worst_window_dd: float
    weight_stability: Dict[str, float] # Metric for how much weights varied
    window_results: List[WindowResult]
