from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal
from datetime import datetime
from src.alpha_engine.models.conviction_models import ConvictionResult
from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.models.footprint_models import Trade

class HistoricalMarketSnapshot(BaseModel):
    """
    Input data for the backtest engine for a single time step.
    """
    timestamp: datetime
    price: float
    funding_rate: float
    open_interest: float
    volume: float
    liquidation_levels: List[LiquidationLevel] = Field(default_factory=list)
    recent_trades: List[Trade] = Field(default_factory=list)
    book_bids: List[List[float]] = Field(default_factory=list) # List of [price, size]
    book_asks: List[List[float]] = Field(default_factory=list)

class BacktestTrade(BaseModel):
    """
    Represents a trade executed during a backtest.
    """
    symbol: str
    direction: Literal["LONG", "SHORT"]
    entry_price: float
    exit_price: float
    size: float
    entry_time: datetime
    exit_time: datetime
    pnl: float
    pnl_perc: float
    exit_reason: Literal["SIGNAL", "STOP_LOSS", "TAKE_PROFIT", "END_OF_DATA"]
    fees_paid: float
    funding_paid: float

class BacktestMetrics(BaseModel):
    """
    Performance metrics for a backtest run.
    """
    total_return: float
    cagr: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    win_rate: float
    profit_factor: float
    trade_count: int
    expectancy: float
    avg_r_multiple: float

class BacktestReport(BaseModel):
    """
    Final output of the Backtesting Engine.
    """
    symbol: str
    metrics: BacktestMetrics
    equity_curve: List[Dict[str, float | str]] # list of {"time": ISO timestamp, "equity": value}
    trades: List[BacktestTrade]
    decile_performance: Dict[int, float] # Conviction score decile -> Avg Return
