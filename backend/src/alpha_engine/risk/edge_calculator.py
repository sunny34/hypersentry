from datetime import datetime

class EdgeCalculator:
    """
    Computes the raw statistical edge of a potential trade.
    """

    @staticmethod
    def compute(
        win_prob: float, 
        avg_win_pct: float = 0.02, 
        avg_loss_pct: float = 0.01
    ) -> float:
        """
        Calculates the expected value normalized as an 'edge' metric.
        Edge = (P_win * Avg_win) - ((1 - P_win) * Avg_loss)
        """
        
        # Guard against zero denominators or negatives
        avg_win_pct = max(avg_win_pct, 0.001)
        avg_loss_pct = max(avg_loss_pct, 0.001)

        edge = (win_prob * avg_win_pct) - ((1.0 - win_prob) * avg_loss_pct)
        
        # Normalize to a 0-1 confidence-like score for sizing
        # Assuming max reasonable edge is ~2% per trade
        normalized_edge = max(0.0, min(1.0, edge * 50.0))
        return normalized_edge
