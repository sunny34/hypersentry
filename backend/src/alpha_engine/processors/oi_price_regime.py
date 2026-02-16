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
        if state.price <= 0:
            return {"regime": MarketRegime.NEUTRAL, "confidence": 0.0}
        
        # Use price_1m_ago if provided, otherwise assume small change
        if price_1m_ago <= 0:
            price_1m_ago = state.price * 0.999  # Assume slight decline if unknown
            
        price_delta = (state.price - price_1m_ago) / price_1m_ago
        oi_delta = state.oi_delta_1m
        
        # Scaling confidence: More sensitive to price moves
        # Even small price changes should generate some signal
        price_strength = min(abs(price_delta) / 0.0005, 1.0)  # 0.05% move = full weight
        
        # OI delta sensitivity - if no OI delta data, use neutral
        if state.open_interest > 0 and oi_delta != 0:
            oi_strength = min(abs(oi_delta) / 500.0, 1.0)  # More sensitive
        else:
            oi_strength = 0.3  # Default moderate confidence when no OI data
        
        confidence = (price_strength + oi_strength) / 2.0

        # Determine regime based on price and OI direction
        if price_delta > 0.0001:  # Price moving up
            if oi_delta > 0:
                regime = MarketRegime.AGGRESSIVE_LONG_BUILD
            else:
                regime = MarketRegime.SHORT_COVER
        elif price_delta < -0.0001:  # Price moving down
            if oi_delta > 0:
                regime = MarketRegime.AGGRESSIVE_SHORT_BUILD
            else:
                regime = MarketRegime.LONG_UNWIND
        else:
            # Price essentially unchanged - check if we have meaningful OI movement
            if oi_delta > 50:
                regime = MarketRegime.STABLE_ACCUMULATION
            elif oi_delta < -50:
                regime = MarketRegime.STABLE_DISTRIBUTION
            else:
                regime = MarketRegime.NEUTRAL
            
        # Ensure minimum confidence
        confidence = max(confidence, 0.3)
            
        return {
            "regime": regime,
            "confidence": round(float(confidence), 2)
        }
