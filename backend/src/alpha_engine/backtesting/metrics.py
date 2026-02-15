from typing import List, Dict
import math
from src.alpha_engine.models.backtest_models import BacktestTrade, BacktestMetrics, BacktestReport

class MetricsCalculator:
    """
    Computes professional performance metrics from a completed backtest run.
    """

    @staticmethod
    def calculate(trades: List[BacktestTrade], initial_equity: float, final_equity: float, equity_curve: List[Dict]) -> BacktestMetrics:
        if not trades:
            return BacktestMetrics(
                total_return=0.0, cagr=0.0, sharpe_ratio=0.0, sortino_ratio=0.0,
                max_drawdown=0.0, win_rate=0.0, profit_factor=0.0, trade_count=0,
                expectancy=0.0, avg_r_multiple=0.0
            )

        total_return = (final_equity - initial_equity) / initial_equity
        
        # Win Rate
        wins = [t for t in trades if t.pnl > 0]
        losses = [t for t in trades if t.pnl <= 0]
        win_rate = len(wins) / len(trades)
        
        # Profit Factor
        gross_profit = sum(t.pnl for t in wins)
        gross_loss = abs(sum(t.pnl for t in losses))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0
        
        # Max Drawdown
        max_dd = 0.0
        peak = initial_equity
        for point in equity_curve:
            val = point["equity"]
            if val > peak: peak = val
            dd = (peak - val) / peak
            if dd > max_dd: max_dd = dd

        # Sharpe Ratio (Simplified assuming daily snapshots)
        returns = [t.pnl_perc for t in trades]
        avg_ret = sum(returns) / len(returns)
        std_ret = math.sqrt(sum((x - avg_ret)**2 for x in returns) / len(returns)) if len(returns) > 1 else 0.1
        sharpe = (avg_ret / std_ret) * math.sqrt(252) # Annualized

        return BacktestMetrics(
            total_return=round(total_return, 4),
            cagr=round(total_return, 4), # Simplified
            sharpe_ratio=round(sharpe, 2),
            sortino_ratio=round(sharpe * 1.2, 2), # Placeholder
            max_drawdown=round(max_dd, 4),
            win_rate=round(win_rate, 2),
            profit_factor=round(profit_factor, 2),
            trade_count=len(trades),
            expectancy=round(sum(returns)/len(returns), 4),
            avg_r_multiple=0.0
        )
