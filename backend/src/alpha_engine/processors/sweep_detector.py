from typing import Dict, List, Optional
from datetime import datetime, timedelta
from src.alpha_engine.models.footprint_models import SweepEvent, Trade
from src.alpha_engine.state.market_state import MarketState

SWEEP_SIZE_THRESHOLD = 50000.0 # $50k single trade
SWEEP_TIME_WINDOW_MS = 500
DEPTH_COLLAPSE_THRESHOLD = 0.40 # 40%

class SweepDetector:
    """
    Identifies aggressive liquidity 'clearing' by institutional market orders.
    A sweep is characterized by high volume consuming multiple levels of the 
    orderbook in a very short window.
    """

    @staticmethod
    def detect(state: MarketState) -> SweepEvent:
        if not state.trade_stream_recent:
            return SweepEvent()

        # 1. Analyze recent trades for aggression
        now = state.trade_stream_recent[-1].timestamp
        cutoff = now - timedelta(milliseconds=SWEEP_TIME_WINDOW_MS)
        
        recent_trades = [t for t in state.trade_stream_recent if t.timestamp >= cutoff]
        if not recent_trades:
            return SweepEvent()

        buy_vol = sum(t.size for t in recent_trades if t.side == "BUY")
        sell_vol = sum(t.size for t in recent_trades if t.side == "SELL")
        
        # 2. Check depth collapse (Simplified logic for Phase 3)
        # In a real setup, we'd compare against a 1s-ago snapshot of the book.
        # Here we look for significant size spikes relative to top-of-book levels.
        
        event = None
        strength = 0.0
        levels = 0
        
        # BUY Sweep (consuming ASKS)
        if buy_vol > SWEEP_SIZE_THRESHOLD:
            # Check if volume exceeds top book levels significantly
            top_ask_vol = sum(sz for px, sz in state.orderbook_asks[:3])
            if top_ask_vol > 0 and buy_vol > top_ask_vol * (1 + DEPTH_COLLAPSE_THRESHOLD):
                event = "BUY_SWEEP"
                strength = min(buy_vol / (SWEEP_SIZE_THRESHOLD * 5), 1.0)
                levels = 3 # Simplified
                
        # SELL Sweep (consuming BIDS)
        elif sell_vol > SWEEP_SIZE_THRESHOLD:
            top_bid_vol = sum(sz for px, sz in state.orderbook_bids[:3])
            if top_bid_vol > 0 and sell_vol > top_bid_vol * (1 + DEPTH_COLLAPSE_THRESHOLD):
                event = "SELL_SWEEP"
                strength = min(sell_vol / (SWEEP_SIZE_THRESHOLD * 5), 1.0)
                levels = 3
                
        return SweepEvent(
            event=event,
            strength=round(strength, 2),
            levels_consumed=levels
        )
