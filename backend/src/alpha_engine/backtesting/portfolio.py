from datetime import datetime
from typing import List, Optional, Literal
from src.alpha_engine.models.backtest_models import BacktestTrade

class Portfolio:
    """
    Simulates a trading account. 
    Tracks equity, positions, commissions, and funding costs.
    """

    def __init__(self, initial_equity: float = 10000.0, fee_pct: float = 0.0004):
        self.equity = initial_equity
        self.current_pos: Optional[Literal["LONG", "SHORT"]] = None
        self.entry_price = 0.0
        self.entry_time: Optional[datetime] = None
        self.size_usd = 1000.0 # Fixed position size for simplicity
        self.fee_pct = fee_pct # 4bps fee
        
        self.trades: List[BacktestTrade] = []
        self.equity_curve = []

    def process_step(
        self, 
        time: datetime, 
        price: float, 
        funding_rate: float, 
        signal: str, 
        symbol: str
    ):
        # 1. Handle Position Changes
        if signal == "OPEN_LONG" and not self.current_pos:
            self._open_pos("LONG", price, time)
        elif signal == "OPEN_SHORT" and not self.current_pos:
            self._open_pos("SHORT", price, time)
        elif signal == "CLOSE" and self.current_pos:
            self._close_pos(price, time, "SIGNAL", symbol)
            
        # 2. Daily Funding Cost (Simplified: apply every snapshot)
        if self.current_pos:
            cost = self.size_usd * funding_rate
            if self.current_pos == "LONG":
                self.equity -= cost
            else:
                self.equity += cost
        
        # 3. Snapshot equity
        self.equity_curve.append({
            "time": time.isoformat(),
            "equity": round(self.equity + self._get_unrealized_pnl(price), 2)
        })

    def _open_pos(self, direction: Literal["LONG", "SHORT"], price: float, time: datetime):
        self.current_pos = direction
        self.entry_price = price
        self.entry_time = time
        # Pay opening fee
        self.equity -= (self.size_usd * self.fee_pct)

    def _close_pos(self, price: float, time: datetime, reason: str, symbol: str):
        # Calculate PnL
        pnl = self._get_unrealized_pnl(price)
        pnl_perc = pnl / self.size_usd
        
        # Pay closing fee
        fee = self.size_usd * self.fee_pct
        self.equity -= fee
        
        # Realize PnL
        self.equity += pnl
        
        trade = BacktestTrade(
            symbol=symbol,
            direction=self.current_pos,
            entry_price=self.entry_price,
            exit_price=price,
            size=self.size_usd,
            entry_time=self.entry_time,
            exit_time=time,
            pnl=round(pnl, 2),
            pnl_perc=round(pnl_perc, 4),
            exit_reason=reason,
            fees_paid=round(fee * 2, 2), # Entry + Exit
            funding_paid=0.0 # For now
        )
        self.trades.append(trade)
        
        self.current_pos = None
        self.entry_price = 0.0

    def _get_unrealized_pnl(self, current_price: float) -> float:
        if not self.current_pos: return 0.0
        diff = (current_price - self.entry_price) / self.entry_price
        if self.current_pos == "LONG":
            return self.size_usd * diff
        return self.size_usd * -diff
