from datetime import datetime

class DrawdownManager:
    """
    Capital preservation logic.
    Reduces position sizing aggressively as account drawdown increases.
    """

    def __init__(self, high_water_mark: float = 1.0):
        self.HWM = high_water_mark

    def get_risk_multiplier(self, current_equity: float, threshold_pct: float = 0.05) -> float:
        """
        If drawdown exceeds threshold, start reducing risk.
        multiplier = max(0.3, 1 - (dd_pct * factor))
        """
        if current_equity > self.HWM:
            self.HWM = current_equity
            return 1.0
            
        dd_pct = (self.HWM - current_equity) / self.HWM
        
        if dd_pct < threshold_pct:
            return 1.0
            
        # Drawdown Penalty logic
        # e.g., if dd = 10%, we reduce size by 20%
        penalty = (dd_pct - threshold_pct) * 2.0
        
        multiplier = max(0.3, 1.0 - penalty)
        return multiplier
