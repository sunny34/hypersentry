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
        FIXED: More sensitive to small price moves and orderbook imbalance.
        """
        if state.price <= 0:
            return {"regime": MarketRegime.NEUTRAL, "confidence": 0.0}
        
        # Use price_1m_ago if provided, otherwise assume small change
        if price_1m_ago <= 0:
            price_1m_ago = state.price * 0.999  # Assume slight decline if unknown
            
        price_delta = (state.price - price_1m_ago) / price_1m_ago
        oi_delta = state.oi_delta_1m
        
        # FIXED: Much more sensitive to price moves - even tiny moves matter
        # 0.01% (1 bps) move gets partial signal, 0.05% (5 bps) gets full signal
        price_strength = min(abs(price_delta) / 0.0005, 1.0)
        
        # FIXED: More sensitive to OI delta
        if state.open_interest > 0 and oi_delta != 0:
            # Lower threshold for OI sensitivity
            oi_strength = min(abs(oi_delta) / 100.0, 1.0)
        else:
            oi_strength = 0.3  # Default moderate confidence when no OI data
        
        # FIXED: Also consider orderbook imbalance
        book_imbalance = getattr(state, 'orderbook_imbalance', 0.0) or 0.0
        book_strength = min(abs(book_imbalance) * 2, 1.0) if book_imbalance != 0 else 0.0
        
        # Combine price, OI, and orderbook signals
        confidence = (price_strength * 0.5 + oi_strength * 0.3 + book_strength * 0.2)

        # FIXED: Much lower thresholds for regime detection
        # Use 0.2 bps as the threshold for price movement detection
        PRICE_THRESHOLD = 0.00002  # 0.2 bps (very sensitive)
        
        # Determine regime based on price and OI direction
        if price_delta > PRICE_THRESHOLD:  # Price moving up
            if oi_delta > 10:  # OI increasing
                regime = MarketRegime.AGGRESSIVE_LONG_BUILD
            else:
                # Check orderbook for additional confirmation
                if book_imbalance > 0.1:
                    regime = MarketRegime.AGGRESSIVE_LONG_BUILD
                else:
                    regime = MarketRegime.SHORT_COVER
        elif price_delta < -PRICE_THRESHOLD:  # Price moving down
            if oi_delta > 10:
                regime = MarketRegime.AGGRESSIVE_SHORT_BUILD
            else:
                # Check orderbook for additional confirmation
                if book_imbalance < -0.1:
                    regime = MarketRegime.AGGRESSIVE_SHORT_BUILD
                else:
                    regime = MarketRegime.LONG_UNWIND
        else:
            # Price essentially unchanged - FIXED: detect accumulation/distribution from OI
            if oi_delta > 15:
                regime = MarketRegime.STABLE_ACCUMULATION
            elif oi_delta < -15:
                regime = MarketRegime.STABLE_DISTRIBUTION
            elif book_imbalance > 0.15:
                # FIXED: Use orderbook imbalance when OI is flat
                regime = MarketRegime.STABLE_ACCUMULATION
            elif book_imbalance < -0.15:
                regime = MarketRegime.STABLE_DISTRIBUTION
            else:
                regime = MarketRegime.NEUTRAL
            
        # FIXED: Ensure minimum confidence is lower to allow signal through
        confidence = max(confidence, 0.25)
            
        return {
            "regime": regime,
            "confidence": round(float(confidence), 2)
        }
