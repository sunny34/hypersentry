from typing import Dict, List, Optional
from src.alpha_engine.models.footprint_models import ImpulseEvent
from src.alpha_engine.state.market_state import MarketState

CVD_IMPULSE_THRESHOLD = 50000.0 # $50k delta in short window
PRICE_IMPULSE_PCT = 0.001 # 0.1%

class ImpulseDetector:
    """
    Detects directional price momentum confirmed by aggressive CVD expansion.
    Signals a high-conviction move in progress.
    """

    @staticmethod
    def detect(state: MarketState, prev_cvd: float, prev_price: float) -> ImpulseEvent:
        if prev_price <= 0:
            return ImpulseEvent()

        cvd_delta = state.cvd_1m - prev_cvd
        px_delta_pct = (state.price - prev_price) / prev_price
        
        event = None
        strength = 0.0
        
        # Bullish Impulse (Price UP, CVD UP)
        if px_delta_pct >= PRICE_IMPULSE_PCT and cvd_delta >= CVD_IMPULSE_THRESHOLD:
            event = "BULLISH_IMPULSE"
            # Strength based on both price move and CVD magnitude
            strength = (px_delta_pct / PRICE_IMPULSE_PCT) * (cvd_delta / CVD_IMPULSE_THRESHOLD)
            
        # Bearish Impulse (Price DOWN, CVD DOWN)
        elif px_delta_pct <= -PRICE_IMPULSE_PCT and cvd_delta <= -CVD_IMPULSE_THRESHOLD:
            event = "BEARISH_IMPULSE"
            strength = (abs(px_delta_pct) / PRICE_IMPULSE_PCT) * (abs(cvd_delta) / CVD_IMPULSE_THRESHOLD)
            
        return ImpulseEvent(
            event=event,
            strength=round(min(strength, 5.0), 2)
        )
