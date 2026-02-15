from datetime import datetime

class UrgencyModel:
    """
    Quantifies the immediate need to fill an order.
    High Urgency -> More aggressive (Market orders)
    Low Urgency -> More passive (Limit/Post-Only)
    """

    def __init__(self, high_conviction_threshold: float = 0.8):
        self.conviction_thresh = high_conviction_threshold

    def compute(self,
        conviction_score: float,
        impulse_strength: float,    # e.g., velocity of recent moves (0.0 - 1.0)
        regime: str,                # TRENDING, CHOP, etc.
        probability_decay_per_min: float # Cost of waiting (alpha decay)
    ) -> float:
        """
        Returns Urgency Score (0.0 - 1.0)
        """
        
        # Base Urgency from Conviction
        score = conviction_score * 0.4
        
        # Impulse Multiplier
        # If market is moving fast, urgency increases
        score += impulse_strength * 0.3
        
        # Regime Factors
        # In a SQUEEZE or TRENDING market, execute fast.
        # In CHOP, execute slow.
        if regime in ["SQUEEZE_ENVIRONMENT", "TRENDING_HIGH_VOL", "CRISIS_MODE"]:
            score += 0.2
        elif regime == "CHOP_LOW_VOL":
            score -= 0.1
            
        # Decay penalty
        # If waiting costs decay alpha rapidly, be urgent.
        if probability_decay_per_min > 0.01: # >1% decay per min (scalping)
            score += 0.2
            
        return max(0.0, min(1.0, score))
