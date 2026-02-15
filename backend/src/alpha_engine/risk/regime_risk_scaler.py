from typing import Dict

class RegimeRiskScaler:
    """
    Applies aggressive/defensive position sizing multipliers 
    based on the governance system's designated macro regime.
    """

    MULTIPLIERS = {
        "TRENDING_HIGH_VOL": 0.8,
        "CHOP_LOW_VOL": 1.2,
        "CRISIS_MODE": 0.4,
        "SQUEEZE_ENVIRONMENT": 1.5,
        "NORMAL_MARKET": 1.0
    }

    def get_multiplier(self, regime: str) -> float:
        return self.MULTIPLIERS.get(regime, 1.0)
