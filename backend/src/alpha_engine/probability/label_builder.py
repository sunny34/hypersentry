from typing import List, Tuple
from datetime import datetime, timedelta
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot

class LabelBuilder:
    """
    Generates ground-truth labels for historical data training.
    Identifies if a +/- 1% move occurred within a specific time horizon.
    """

    @staticmethod
    def build_labels(
        snapshots: List[HistoricalMarketSnapshot], 
        horizon_minutes: int = 60
    ) -> List[Tuple[bool, bool]]:
        """
        Calculates binary labels for upside and downside moves.
        Returns List[(bool_up, bool_down)]
        """
        labels = []
        n = len(snapshots)
        
        for i in range(n):
            current_px = snapshots[i].price
            current_time = snapshots[i].timestamp
            end_time = current_time + timedelta(minutes=horizon_minutes)
            
            has_up = False
            has_down = False
            
            # Look ahead within horizon
            for j in range(i + 1, n):
                if snapshots[j].timestamp > end_time:
                    break
                    
                future_px = snapshots[j].price
                ret = (future_px - current_px) / current_px
                
                if ret >= 0.01:
                    has_up = True
                if ret <= -0.01:
                    has_down = True
                    
                if has_up and has_down:
                    break
            
            labels.append((has_up, has_down))
            
        return labels
