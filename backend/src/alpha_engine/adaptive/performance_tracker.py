from typing import List, Dict
from src.alpha_engine.models.adaptive_models import WindowResult

class PerformanceTracker:
    """
    Analyzes the outputs of walk-forward validation to assess model robustness.
    Tracks weight drift and performance consistency across windows.
    """

    @staticmethod
    def analyze_stability(results: List[WindowResult]) -> Dict[str, float]:
        if len(results) < 2:
            return {"weight_drift": 0.0, "performance_decay": 0.0}
            
        # Weight Drift: average standard deviation of each weight across windows
        weights = ["w_regime", "w_liquidation", "w_footprint", "w_funding", "w_volatility"]
        drifts = []
        
        for w in weights:
            vals = [getattr(r.weights, w) for r in results]
            mean = sum(vals) / len(vals)
            var = sum((x - mean)**2 for x in vals) / len(vals)
            drifts.append(var**0.5)
            
        avg_drift = sum(drifts) / len(drifts)
        
        # Performance Decay: Correlation between earlier and later window returns (simplified)
        earlier = results[:len(results)//2]
        later = results[len(results)//2:]
        
        e_ret = sum(r.return_pct for r in earlier) / max(len(earlier), 1)
        l_ret = sum(r.return_pct for r in later) / max(len(later), 1)
        
        decay = (e_ret - l_ret) / abs(e_ret) if e_ret != 0 else 0.0
        
        return {
            "avg_weight_drift": round(avg_drift, 4),
            "performance_decay": round(decay, 4),
            "win_window_ratio": sum(1 for r in results if r.return_pct > 0) / len(results)
        }
