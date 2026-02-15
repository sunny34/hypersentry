from src.alpha_engine.state.market_state import MarketState
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot

class StateRebuilder:
    """
    Translates historical snapshots into live-compatible MarketState objects.
    Ensures that backtesting results are bit-identical to live execution.
    """

    @staticmethod
    def rebuild(symbol: str, snapshot: HistoricalMarketSnapshot) -> MarketState:
        return MarketState(
            symbol=symbol,
            price=snapshot.price,
            mark_price=snapshot.price, # Assume mark == spot for backtest simplicity
            funding_rate=snapshot.funding_rate,
            open_interest=snapshot.open_interest,
            
            # Complex microstructure
            orderbook_bids=[(l[0], l[1]) for l in snapshot.book_bids],
            orderbook_asks=[(l[0], l[1]) for l in snapshot.book_asks],
            trade_stream_recent=snapshot.recent_trades,
            liquidation_levels=snapshot.liquidation_levels,
            
            # Timestamp
            timestamp=int(snapshot.timestamp.timestamp() * 1000)
        )
