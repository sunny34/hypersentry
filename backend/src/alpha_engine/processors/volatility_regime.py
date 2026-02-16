from typing import Dict, List
import math
from src.alpha_engine.models.regime_models import VolatilityRegime
from src.alpha_engine.state.market_state import MarketState

class VolatilityDetector:
    """
    Analyzes historical price and volume data to identify the lifecycle 
    of market volatility: COMPRESSION, EXPANSION, or TRENDING.
    
    TRADING LOGIC EXPLANATION:
    1. COMPRESSION:
       Characterized by range contraction (price moving in a tightening coil) and 
       declining volume. This indicates a 'coiling' state where market participants 
       are in a standoff. High compression scores often precede violent breakouts.
       
    2. EXPANSION:
       Occurs when price breaks out of a compressed range with high momentum. 
       Volatility is increasing rapidly, offering high-reward setup opportunities.
       
    3. TRENDING:
       The default state where volatility is stable and price moves are consistent 
       with previous ATR (Average True Range) bounds.
    """
    
    @staticmethod
    def detect(state: MarketState, price_history: List[float], volume_history: List[float]) -> Dict:
        """
        Uses a moving window of price and volume to identify contraction/expansion.
        Returns a volatility regime and a compression score (0.0 to 1.0).
        """
        # Even with limited history, try to detect some signal
        if len(price_history) < 5:
            return {
                "volatility_regime": VolatilityRegime.TRENDING,
                "compression_score": 0.3  # Default moderate score
            }
        
        # Use whatever history we have, minimum 5 points
        lookback = min(14, len(price_history))
        use_len = max(5, lookback // 2)
            
        # 1. Range Contraction (Current period range vs previous period range)
        current_range = max(price_history[-use_len:]) - min(price_history[-use_len:])
        prev_range_start = max(0, len(price_history) - lookback)
        prev_range = max(price_history[prev_range_start:-use_len]) - min(price_history[prev_range_start:-use_len]) if prev_range_start < len(price_history) - use_len else current_range
        
        range_ratio = current_range / prev_range if prev_range > 0 else 1.0
        
        # 2. Volume Contraction
        if len(volume_history) >= 5:
            avg_vol = sum(volume_history[-min(14, len(volume_history)):]) / min(14, len(volume_history))
            recent_vol = sum(volume_history[-3:]) / 3
            vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0
        else:
            vol_ratio = 1.0
        
        # Scoring Logic: 
        # Lower range_ratio (< 1) and lower vol_ratio (< 1) = Higher Compression Score.
        comp_score = (max(0, 1 - range_ratio) + max(0, 1 - vol_ratio)) / 2.0
        comp_score = min(max(comp_score, 0.0), 1.0)
        
        # Adjust regime thresholds to be more responsive
        if comp_score > 0.5:
            regime = VolatilityRegime.COMPRESSION
        elif range_ratio > 1.3:
            regime = VolatilityRegime.EXPANSION
        else:
            regime = VolatilityRegime.TRENDING
            
        return {
            "volatility_regime": regime,
            "compression_score": round(float(comp_score), 2)
        }
