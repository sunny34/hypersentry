from dataclasses import dataclass, field
from typing import Optional, List, Tuple
from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.models.footprint_models import Trade

@dataclass
class MarketState:
    """
    In-memory representation of a symbol's current market microstructure.
    Designed for rapid updates from WebSocket streams.
    """
    symbol: str
    price: float = 0.0
    mark_price: float = 0.0
    funding_rate: float = 0.0
    open_interest: float = 0.0
    open_interest_hl: float = 0.0
    open_interest_binance_perp: float = 0.0
    open_interest_source: str = "hl"
    
    # Deltas
    oi_delta_1m: float = 0.0
    oi_delta_5m: float = 0.0
    cvd_1m: float = 0.0
    cvd_5m: float = 0.0
    cvd_hl_1m: float = 0.0
    cvd_hl_5m: float = 0.0
    cvd_spot_binance_1m: float = 0.0
    cvd_spot_binance_5m: float = 0.0
    cvd_spot_coinbase_1m: float = 0.0
    cvd_spot_coinbase_5m: float = 0.0
    cvd_spot_composite_1m: float = 0.0
    cvd_spot_composite_5m: float = 0.0
    cvd_source: str = "hl"
    
    # Volume dynamics
    aggressive_buy_volume_1m: float = 0.0
    aggressive_sell_volume_1m: float = 0.0
    
    # Orderbook
    orderbook_imbalance: float = 0.0 # (Bids - Asks) / (Bids + Asks)
    orderbook_bids: List[Tuple[float, float]] = field(default_factory=list) # (price, size)
    orderbook_asks: List[Tuple[float, float]] = field(default_factory=list) # (price, size)

    # Trade stream
    trade_stream_recent: List[Trade] = field(default_factory=list)

    # Liquidation clusters (Pre-sorted by price)
    liquidation_levels: List[LiquidationLevel] = field(default_factory=list)
    
    # Metadata
    timestamp: int = 0
