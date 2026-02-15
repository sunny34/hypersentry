import math
from typing import Dict
from src.alpha_engine.models.regime_models import MarketRegime
from src.alpha_engine.state.market_state import MarketState

class OIRegimeClassifier:
    """
    Classifies the current market microstructure into one of four primary regimes 
    based on the relationship between Price Action and Open Interest (OI).
    
    TRADING LOGIC EXPLANATION:
    1. AGGRESSIVE_LONG_BUILD (Price ↑, OI ↑): 
       New buyers are entering the market aggressively, opening new long positions. 
       This is typical of a strong bullish trend.
       
    2. AGGRESSIVE_SHORT_BUILD (Price ↓, OI ↑): 
       New sellers are entering the market aggressively, opening new short positions. 
       This is typical of a strong bearish trend.
       
    3. SHORT_COVER (Price ↑, OI ↓): 
       Price is rising because shorts are being forced to buy back (closing positions). 
       This often signals a local bottom or a 'short squeeze' but lacks long-term buyer conviction.
       
    4. LONG_UNWIND (Price ↓, OI ↓): 
       Price is falling because longs are exiting or being liquidated. 
       This signals a 'washout' of weak hands but lacks aggressive new selling pressure.
    """
    
    @staticmethod
    def classify(state: MarketState, price_1m_ago: float) -> Dict:
        """
        Calculates the regime and a confidence score based on the delta magnitudes.
        Confidence is higher when moves in both price and OI are significant.
        """
        if price_1m_ago <= 0:
            return {"regime": MarketRegime.NEUTRAL, "confidence": 0.0}
            
        price_delta = (state.price - price_1m_ago) / price_1m_ago
        oi_delta = state.oi_delta_1m
        
        # Scaling confidence: Magnitude of deltas relative to baseline noise
        price_strength = min(abs(price_delta) / 0.001, 1.0) # 0.1% move = full weight
        oi_strength = min(abs(oi_delta) / 1000.0, 1.0) if state.open_interest > 0 else 0.5
        confidence = (price_strength + oi_strength) / 2.0

        if price_delta > 0 and oi_delta > 0:
            regime = MarketRegime.AGGRESSIVE_LONG_BUILD
        elif price_delta < 0 and oi_delta > 0:
            regime = MarketRegime.AGGRESSIVE_SHORT_BUILD
        elif price_delta > 0 and oi_delta < 0:
            regime = MarketRegime.SHORT_COVER
        elif price_delta < 0 and oi_delta < 0:
            regime = MarketRegime.LONG_UNWIND
        else:
            regime = MarketRegime.NEUTRAL
            confidence = 0.0
            
        return {
            "regime": regime,
            "confidence": round(float(confidence), 2)
        }
