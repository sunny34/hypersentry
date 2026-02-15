from typing import Dict, List, Optional
import math
from src.alpha_engine.models.footprint_models import FlowImbalanceResult
from src.alpha_engine.state.market_state import MarketState

class FlowImbalanceProcessor:
    """
    Analyzes the ratio of aggressive buying vs selling volume.
    High imbalance often precedes short-term directional continuations.
    """

    @staticmethod
    def compute(state: MarketState, history_ratios: List[float]) -> FlowImbalanceResult:
        buy_v = max(state.aggressive_buy_volume_1m, 1.0)
        sell_v = max(state.aggressive_sell_volume_1m, 1.0)
        
        current_ratio = buy_v / sell_v
        
        # Calculate z-score vs history (default to 0 if history is light)
        z_score = 0.0
        if len(history_ratios) >= 10:
            avg = sum(history_ratios) / len(history_ratios)
            variance = sum((x - avg)**2 for x in history_ratios) / len(history_ratios)
            std = math.sqrt(variance) if variance > 0 else 0.1
            z_score = (current_ratio - avg) / std

        dominance = "NEUTRAL"
        if z_score > 2.0 or current_ratio > 2.5:
            dominance = "BUY_DOMINANT"
        elif z_score < -2.0 or current_ratio < 0.4:
            dominance = "SELL_DOMINANT"
            
        return FlowImbalanceResult(
            imbalance_ratio=round(current_ratio, 2),
            z_score=round(z_score, 2),
            dominance=dominance
        )
