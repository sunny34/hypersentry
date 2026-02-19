from pydantic import BaseModel
from typing import Literal, Optional

class SimplifiedSignal(BaseModel):
    """
    Actionable trading signal with clear entry/stop/target.
    Designed for systematic/automated trading.
    """
    symbol: str
    signal: Literal["BUY", "SELL", "WAIT"]
    
    # Price levels
    entry_price: float
    stop_loss: float
    target_price: float
    
    # Metrics
    risk_reward_ratio: float  # e.g., 2.0 = 2:1
    confidence: float  # 0-100%
    timeframe: Literal["scalp", "intraday", "swing"] = "intraday"
    
    # Reasoning for traders who want to understand
    reasoning: str
    
    # Source
    source: Literal["simplified", "conviction"] = "simplified"
    timestamp: int


class SignalStrength(BaseModel):
    """Historical signal strength for a symbol"""
    symbol: str
    total_signals: int = 0
    winning_signals: int = 0
    win_rate: float = 0.0
    avg_rr: float = 0.0
    last_signal_timestamp: Optional[int] = None
