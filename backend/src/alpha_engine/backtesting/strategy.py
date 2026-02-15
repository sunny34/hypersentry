from typing import Optional, Literal
from src.alpha_engine.models.conviction_models import ConvictionResult

class Strategy:
    """
    Stateful strategy logic for the backtest.
    Determines entry and exit signals based on conviction thresholds.
    """

    def __init__(
        self, 
        long_threshold: int = 65, 
        short_threshold: int = 35,
        stop_loss_r: float = 1.0,
        take_profit_r: float = 1.5
    ):
        self.long_threshold = long_threshold
        self.short_threshold = short_threshold
        self.stop_loss_r = stop_loss_r
        self.take_profit_r = take_profit_r

    def get_signal(
        self, 
        conviction: ConvictionResult, 
        current_pos: Optional[Literal["LONG", "SHORT"]],
        entry_price: float,
        current_price: float
    ) -> Optional[Literal["OPEN_LONG", "OPEN_SHORT", "CLOSE", "HOLD"]]:
        
        # 1. Exit Logic (Take Profit / Stop Loss)
        if current_pos == "LONG":
            risk = entry_price * 0.01 # 1% baseline risk for R calculation
            if current_price <= entry_price - (risk * self.stop_loss_r):
                return "CLOSE" # Stop Loss
            if current_price >= entry_price + (risk * self.take_profit_r):
                return "CLOSE" # Take Profit
            
            # Trend reversal exit
            if conviction.score < 50:
                return "CLOSE"

        elif current_pos == "SHORT":
            risk = entry_price * 0.01
            if current_price >= entry_price + (risk * self.stop_loss_r):
                return "CLOSE"
            if current_price <= entry_price - (risk * self.take_profit_r):
                return "CLOSE"
            
            if conviction.score > 50:
                return "CLOSE"

        # 2. Entry Logic
        if not current_pos:
            if conviction.score >= self.long_threshold:
                return "OPEN_LONG"
            if conviction.score <= self.short_threshold:
                return "OPEN_SHORT"

        return "HOLD"
