from typing import Tuple

class KellySizer:
    """
    Implements a fractional Kelly Criterion for optimal capital allocation.
    Balances growth optimization with ruin prevention.
    """

    def __init__(self, kelly_fraction: float = 0.5):
        """
        kelley_fraction: Multiplier (0.0 - 1.0). Default to Half-Kelly for safety.
        """
        self.fraction = kelly_fraction

    def compute(self, win_prob: float, win_loss_ratio: float) -> float:
        """
        K = W - (1-W)/R
        where:
        W = win probability
        R = win/loss ratio
        """
        if win_loss_ratio <= 0:
            return 0.0

        kelly = win_prob - ((1.0 - win_prob) / win_loss_ratio)
        
        # Guard against hyper-aggression
        if kelly <= 0:
            return 0.0
            
        final_kelly = kelly * self.fraction
        
        # Absolute cap at 20% of account per trade no matter what statistical edge says
        return min(0.20, final_kelly)
