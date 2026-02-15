from typing import Dict, List, Optional
from datetime import datetime, timedelta
from src.alpha_engine.models.footprint_models import AbsorptionEvent, Trade
from src.alpha_engine.state.market_state import MarketState

ABSORPTION_WINDOW_SEC = 30
MIN_ABSORPTION_VOL = 100000.0 # $100k
PRICE_TOLERANCE_PCT = 0.0002 # 0.02%

class AbsorptionDetector:
    """
    Detects when aggressive market orders are being 'absorbed' by high-volume 
    resting limit orders, preventing price from moving despite high flow.
    """

    @staticmethod
    def detect(state: MarketState) -> AbsorptionEvent:
        if not state.trade_stream_recent:
            return AbsorptionEvent()

        now = state.trade_stream_recent[-1].timestamp
        cutoff = now - timedelta(seconds=ABSORPTION_WINDOW_SEC)
        
        window_trades = [t for t in state.trade_stream_recent if t.timestamp >= cutoff]
        if len(window_trades) < 5:
            return AbsorptionEvent()

        start_px = window_trades[0].price
        end_px = window_trades[-1].price
        px_change_pct = abs(end_px - start_px) / start_px
        
        buy_vol = sum(t.size for t in window_trades if t.side == "BUY")
        sell_vol = sum(t.size for t in window_trades if t.side == "SELL")
        
        event = None
        strength = 0.0
        
        # BUY Absorption (Aggressive SELLS are being absorbed by big BIDS)
        if sell_vol > MIN_ABSORPTION_VOL and px_change_pct < PRICE_TOLERANCE_PCT:
            # High selling pressure but price not dropping
            event = "BUY_ABSORPTION"
            strength = sell_vol / MIN_ABSORPTION_VOL
            
        # SELL Absorption (Aggressive BUYS are being absorbed by big ASKS)
        elif buy_vol > MIN_ABSORPTION_VOL and px_change_pct < PRICE_TOLERANCE_PCT:
            # High buying pressure but price not rising
            event = "SELL_ABSORPTION"
            strength = buy_vol / MIN_ABSORPTION_VOL

        return AbsorptionEvent(
            event=event,
            strength=round(min(strength, 10.0), 2)
        )
