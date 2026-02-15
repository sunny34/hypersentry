from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.processors.liquidation_projection import LiquidationProjector
from src.alpha_engine.state.market_state import MarketState


def test_liquidation_projection_behavior():
    state = MarketState(symbol="BTC", price=50_000.0)
    state.liquidation_levels = [
        LiquidationLevel(price=50_500.0, side="SHORT", notional=1_000_000.0),
        LiquidationLevel(price=49_500.0, side="LONG", notional=500_000.0),
    ]

    result = LiquidationProjector.project(state)

    assert result.symbol == "BTC"
    assert result.upside["1.0%"] == 1_000_000.0
    assert result.downside["1.0%"] == 500_000.0
    assert result.imbalance_ratio == 2.0
    assert result.dominant_side == "SHORT_SQUEEZE"
