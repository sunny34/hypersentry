from typing import Dict, Literal
from datetime import datetime

class PortfolioAllocator:
    """
    Final decision engine for capital allocation.
    Combines Risk/Sizing models and imposes hard portfolio constraints.
    """

    def __init__(self, max_portfolio_leverage: float = 3.0, max_single_risk_pct: float = 0.05):
        self.max_lev = max_portfolio_leverage
        self.max_risk_pct = max_single_risk_pct

    def compute_size_usd(self,
        equity: float,
        kelly_fraction: float,
        vol_scalar: float,
        regime_scalar: float,
        drawdown_scalar: float,
        correlation_penalty: float,
        max_usd_position: float = 500_000 # Example hard cap
    ) -> float:
        
        # 1. Base Sizing
        base_risk_pct = kelly_fraction 
        
        # 2. Adjustments
        adjusted_risk_pct = (
            base_risk_pct
            * vol_scalar 
            * regime_scalar 
            * drawdown_scalar 
            * correlation_penalty
        )
        
        final_risk_pct = min(self.max_risk_pct, adjusted_risk_pct)
        
        usd_allocation = equity * final_risk_pct * self.max_lev # Leverage factor
        
        # Hard cap
        usd_allocation = min(max_usd_position, usd_allocation)
        
        return round(usd_allocation, 2)
