from typing import List
from datetime import datetime
from src.alpha_engine.models.adaptive_models import WalkForwardReport, WindowResult
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.adaptive.window_splitter import WindowSplitter
from src.alpha_engine.adaptive.weight_optimizer import WeightOptimizer
from src.alpha_engine.adaptive.performance_tracker import PerformanceTracker
from src.alpha_engine.backtesting.signal_runner import SignalRunner
from src.alpha_engine.backtesting.strategy import Strategy
from src.alpha_engine.backtesting.portfolio import Portfolio
from src.alpha_engine.backtesting.metrics import MetricsCalculator

class WalkForwardRunner:
    """
    Executes the complete walk-forward validation process.
    Optimizes on training windows and validates on forward test windows to prevent overfitting.
    """

    @staticmethod
    async def run(
        symbol: str, 
        snapshots: List[HistoricalMarketSnapshot]
    ) -> WalkForwardReport:
        
        if not snapshots: return None
        
        # 1. Generate Windows
        start_time = snapshots[0].timestamp
        end_time = snapshots[-1].timestamp
        windows = WindowSplitter.split(start_time, end_time)
        
        window_results = []
        
        for win in windows:
            # Filter data for train and test
            train_data = [s for s in snapshots if win.train_start <= s.timestamp < win.train_end]
            test_data = [s for s in snapshots if win.test_start <= s.timestamp < win.test_end]
            
            if not train_data or not test_data: continue
            
            # 2. Optimize on Train
            opt_weights = await WeightOptimizer.optimize(symbol, train_data)
            
            # 3. Validate on Test
            weights_dict = {
                "w_regime": opt_weights.w_regime,
                "w_liquidation": opt_weights.w_liquidation,
                "w_footprint": opt_weights.w_footprint,
                "w_funding": opt_weights.w_funding,
                "w_volatility": opt_weights.w_volatility
            }
            
            runner = SignalRunner(symbol)
            strategy = Strategy()
            portfolio = Portfolio()
            
            for s in test_data:
                conviction = await runner.run_step(s, weights=weights_dict)
                sig = strategy.get_signal(conviction, portfolio.current_pos, portfolio.entry_price, s.price)
                portfolio.process_step(s.timestamp, s.price, s.funding_rate, sig, symbol)
                
            metrics = MetricsCalculator.calculate(portfolio.trades, 10000.0, portfolio.equity, portfolio.equity_curve)
            
            window_results.append(WindowResult(
                window=win,
                weights=opt_weights,
                return_pct=metrics.total_return,
                sharpe=metrics.sharpe_ratio,
                max_drawdown=metrics.max_drawdown
            ))
            
        # 4. Aggregate Results
        total_ret = sum(wr.return_pct for wr in window_results)
        avg_sharpe = sum(wr.sharpe for wr in window_results) / max(len(window_results), 1)
        worst_dd = max(wr.max_drawdown for wr in window_results) if window_results else 0.0
        
        stability = PerformanceTracker.analyze_stability(window_results)
        
        return WalkForwardReport(
            symbol=symbol,
            aggregated_return=round(total_ret, 4),
            aggregated_sharpe=round(avg_sharpe, 2),
            worst_window_dd=round(worst_dd, 4),
            weight_stability=stability,
            window_results=window_results
        )
