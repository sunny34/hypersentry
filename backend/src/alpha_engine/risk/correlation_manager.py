from datetime import datetime

class CorrelationManager:
    """
    Manages portfolio correlation risk.
    Reduces the position size of a new trade if it's highly correlated
    with existing active positions.
    """

    def __init__(self, high_corr_thresh: float = 0.7):
        self.high_corr_thresh = high_corr_thresh

    def get_penalty(self, new_symbol_corr: float) -> float:
        """
        Returns a reduction factor (0.0 to 1.0).
        1.0 means no penalty.
        0.5 means cut size in half.
        """
        if new_symbol_corr <= 0:
            return 1.0
            
        if new_symbol_corr > self.high_corr_thresh:
            diff = new_symbol_corr - self.high_corr_thresh
            # If corr is 0.9, diff is 0.2
            # penalize by factor of 0.8
            return max(0.5, 1.0 - diff * 2.5)

        return 1.0
