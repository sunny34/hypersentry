from typing import List, Dict
from src.alpha_engine.models.backtest_models import BacktestReport, HistoricalMarketSnapshot
from src.alpha_engine.backtesting.signal_runner import SignalRunner
from src.alpha_engine.backtesting.strategy import Strategy
from src.alpha_engine.backtesting.portfolio import Portfolio
from src.alpha_engine.backtesting.metrics import MetricsCalculator

class BacktestReportGenerator:
    """
    Main entry point for running a historical backtest.
    Coordinates signal generation, strategy execution, and metric reporting.
    """

    @staticmethod
    async def run(symbol: str, snapshots: List[HistoricalMarketSnapshot]) -> BacktestReport:
        runner = SignalRunner(symbol)
        strategy = Strategy()
        portfolio = Portfolio()
        
        decile_data: Dict[int, List[float]] = {i: [] for i in range(10)}

        for snapshot in snapshots:
            # 1. Run Alpha Intelligence
            conviction = await runner.run_step(snapshot)
            
            # 2. Get Strategy Signal
            signal = strategy.get_signal(
                conviction, 
                portfolio.current_pos, 
                portfolio.entry_price, 
                snapshot.price
            )
            
            # 3. Simulate Portfolio
            portfolio.process_step(
                snapshot.timestamp, 
                snapshot.price, 
                snapshot.funding_rate, 
                signal, 
                symbol
            )
            
            # 4. Global Decile Stats
            decile = (conviction.score // 10) if conviction.score < 100 else 9
            # Follow-on return in next step (simplification)
            # In a real setup we'd lag this.
            decile_data[decile].append(0.0) 

        # Finalize metrics
        metrics = MetricsCalculator.calculate(
            portfolio.trades, 
            10000.0, 
            portfolio.equity, 
            portfolio.equity_curve
        )
        
        return BacktestReport(
            symbol=symbol,
            metrics=metrics,
            equity_curve=portfolio.equity_curve,
            trades=portfolio.trades,
            decile_performance={d: sum(v)/max(len(v),1) for d, v in decile_data.items()}
        )
