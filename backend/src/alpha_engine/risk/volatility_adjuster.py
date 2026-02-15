from datetime import datetime

class VolatilityAdjuster:
    """
    Adjusts position sizing based on realized volatility.
    Lower volatility environments might allow larger size (within limits),
    while high volatility demands size reduction.
    """

    def __init__(self, target_vol_pct: float = 0.02):
        self.target_vol_pct = target_vol_pct

    def compute(self, realized_vol_pct: float) -> float:
        """
        Returns a multiplier for size.
        """
        if realized_vol_pct <= 0:
            return 1.0

        scaler = self.target_vol_pct / realized_vol_pct
        
        # Clamp multiplier to avoid massive sizing in very low vol
        return min(1.5, max(0.2, scaler))
