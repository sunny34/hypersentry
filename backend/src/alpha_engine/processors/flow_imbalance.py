from typing import Dict, List, Optional
import math
from src.alpha_engine.models.footprint_models import FlowImbalanceResult
from src.alpha_engine.state.market_state import MarketState

class FlowImbalanceProcessor:
    """
    Analyzes the ratio of aggressive buying vs selling volume.
    High imbalance often precedes short-term directional continuations.
    FIXED: More sensitive to small imbalances and handles zero volume better.
    """

    @staticmethod
    def compute(state: MarketState, history_ratios: List[float]) -> FlowImbalanceResult:
        buy_v = state.aggressive_buy_volume_1m
        sell_v = state.aggressive_sell_volume_1m
        
        # FIXED: Handle zero volume more intelligently
        # If both are 0, we can't determine imbalance - default to neutral but don't default to ratio 1.0
        if buy_v == 0 and sell_v == 0:
            current_ratio = 1.0
            z_score = 0.0
        elif sell_v == 0:
            # Buy-only volume = strong buy signal
            current_ratio = buy_v / 1.0
            z_score = 2.0  # Strong positive signal
        elif buy_v == 0:
            # Sell-only volume = strong sell signal  
            current_ratio = 1.0 / sell_v
            z_score = -2.0  # Strong negative signal
        else:
            current_ratio = buy_v / sell_v
            # FIXED: Calculate z-score with much lower threshold for sensitivity
            # Even 5 data points can give useful signal
            if len(history_ratios) >= 5:
                avg = sum(history_ratios) / len(history_ratios)
                variance = sum((x - avg)**2 for x in history_ratios) / len(history_ratios)
                std = math.sqrt(variance) if variance > 0 else 0.1
                # FIXED: More sensitive scaling
                z_score = (current_ratio - avg) / std if std > 0.1 else (current_ratio - avg) / 0.1
            else:
                # FIXED: Use small history - derive signal from ratio itself
                # If ratio is significantly different from 1.0, that's a signal
                z_score = math.log(current_ratio) if current_ratio > 0 else 0

        # FIXED: More sensitive dominance thresholds
        dominance = "NEUTRAL"
        if z_score > 1.5 or current_ratio > 2.0:
            dominance = "BUY_DOMINANT"
        elif z_score < -1.5 or current_ratio < 0.5:
            dominance = "SELL_DOMINANT"
            
        return FlowImbalanceResult(
            imbalance_ratio=round(current_ratio, 2),
            z_score=round(z_score, 2),
            dominance=dominance
        )
