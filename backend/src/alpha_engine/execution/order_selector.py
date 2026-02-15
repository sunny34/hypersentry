from typing import Literal

class OrderSelector:
    """
    Translates urgency score into optimal order type.
    """

    def select(self, urgency_score: float) -> Literal["PASSIVE", "HYBRID", "AGGRESSIVE"]:
        if urgency_score < 0.4:
            return "PASSIVE"
        elif urgency_score < 0.7:
            return "HYBRID"
        else:
            return "AGGRESSIVE"

    def get_market_percentage(self, strategy: str) -> float:
        """
        Returns portion of size to market immediately.
        Passive => 0% (Post-Only)
        Hybrid => 25% (Cross spread) + 75% Passive
        Aggressive => 100% (Market/FOK/IOC)
        """
        if strategy == "PASSIVE":
            return 0.0
        elif strategy == "HYBRID":
            return 0.25 # Sample Logic
        else:
            return 1.0
