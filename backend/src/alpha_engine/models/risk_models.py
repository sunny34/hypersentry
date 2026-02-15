from pydantic import BaseModel
from typing import Dict, Optional, Literal

class RiskBreakdown(BaseModel):
    """
    Detailed breakdown of how the final position size was calculated.
    Provides transparency into the risk engine's decision process.
    """
    edge_component: float       # Raw edge magnitude (0.0 - 1.0)
    kelly_fraction: float       # Theoretical optimal fraction
    vol_adjustment: float       # Scaler based on volatility target (0.5 - 1.5)
    regime_multiplier: float    # Macro regime scaler (0.4 - 1.2)
    drawdown_multiplier: float  # Capital preservation scaler (0.3 - 1.0)
    correlation_penalty: float  # Reduction for portfolio correlation (0.0 - 1.0)

class RiskAssessment(BaseModel):
    """
    Final risk assessment and position sizing recommendation.
    """
    symbol: str
    direction: Literal["LONG", "SHORT", "NEUTRAL"]
    size_usd: float             # Recommended position size in USD
    max_leverage: float         # Maximum allowable leverage for this trade
    risk_percent_equity: float  # Percentage of total equity at risk
    stop_loss_price: float      # Recommended invalidation level
    take_profit_price: float    # Recommended target level
    breakdown: RiskBreakdown
    timestamp: int
