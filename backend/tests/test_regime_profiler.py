from datetime import datetime, timezone
import pytest

from src.alpha_engine.models.backtest_models import BacktestTrade
from src.alpha_engine.models.regime_models import MarketRegime, VolatilityRegime
from src.alpha_engine.adaptive.regime_profiler import RegimeProfiler


def make_trade(ts_iso: str, pnl_perc: float) -> BacktestTrade:
    dt = datetime.fromisoformat(ts_iso).replace(tzinfo=None)
    return BacktestTrade(
        symbol="BTCUSD",
        direction="LONG",
        entry_price=100.0,
        exit_price=101.0,
        size=1.0,
        entry_time=dt,
        exit_time=dt,
        pnl=pnl_perc * 100.0,
        pnl_perc=pnl_perc,
        exit_reason="SIGNAL",
        fees_paid=0.0,
        funding_paid=0.0,
    )


def test_profile_happy_path():
    # regimes
    r1 = {"start": datetime.fromisoformat("2020-01-01T00:00:00"), "end": datetime.fromisoformat("2020-01-01T01:00:00"), "regime": MarketRegime.NEUTRAL, "volatility_regime": VolatilityRegime.COMPRESSION, "regime_confidence": 0.9}
    r2 = {"start": datetime.fromisoformat("2020-01-01T01:00:00"), "end": datetime.fromisoformat("2020-01-01T02:00:00"), "regime": MarketRegime.AGGRESSIVE_LONG_BUILD, "volatility_regime": VolatilityRegime.TRENDING, "regime_confidence": 0.8}
    r3 = {"start": datetime.fromisoformat("2020-01-01T02:00:00"), "end": None, "regime": MarketRegime.AGGRESSIVE_SHORT_BUILD, "volatility_regime": VolatilityRegime.EXPANSION, "regime_confidence": 0.7}

    trades = [
        make_trade("2020-01-01T00:30:00", 0.02),
        make_trade("2020-01-01T01:30:00", -0.01),
        make_trade("2020-01-01T02:30:00", 0.05),
    ]

    out = RegimeProfiler.profile(trades, [r1, r2, r3])

    vol = out["volatility"]
    assert vol[VolatilityRegime.COMPRESSION.value]["count"] == 1
    assert vol[VolatilityRegime.COMPRESSION.value]["mean_return"] == pytest.approx(0.02)
    assert vol[VolatilityRegime.COMPRESSION.value]["win_rate"] == pytest.approx(1.0)

    assert vol[VolatilityRegime.TRENDING.value]["count"] == 1
    assert vol[VolatilityRegime.TRENDING.value]["mean_return"] == pytest.approx(-0.01)
    assert vol[VolatilityRegime.TRENDING.value]["win_rate"] == pytest.approx(0.0)

    assert vol[VolatilityRegime.EXPANSION.value]["count"] == 1
    assert vol[VolatilityRegime.EXPANSION.value]["mean_return"] == pytest.approx(0.05)

    edges = out["edges"]
    assert edges["compression_edge"] == pytest.approx(0.02 - -0.01)
    assert edges["expansion_drawdown"] == pytest.approx(0.0)
    assert edges["unmatched_count"] == 0


def test_profile_outside_range_assigns_earliest():
    # single regime starting at 01:00
    r1 = {"start": datetime.fromisoformat("2020-01-01T01:00:00"), "end": None, "regime": MarketRegime.NEUTRAL, "volatility_regime": VolatilityRegime.COMPRESSION, "regime_confidence": 0.9}
    trade = make_trade("2020-01-01T00:30:00", 0.01)
    out = RegimeProfiler.profile([trade], [r1])
    vol = out["volatility"]
    # trade before start should be assigned to earliest (the only) regime
    assert vol[VolatilityRegime.COMPRESSION.value]["count"] == 1


def test_profile_overlap_chooses_high_confidence():
    # overlapping regimes: one low confidence trending covering wide range, one high confidence compression in middle
    r_low = {"start": datetime.fromisoformat("2020-01-01T00:00:00"), "end": datetime.fromisoformat("2020-01-01T03:00:00"), "regime": MarketRegime.NEUTRAL, "volatility_regime": VolatilityRegime.TRENDING, "regime_confidence": 0.4}
    r_high = {"start": datetime.fromisoformat("2020-01-01T01:00:00"), "end": datetime.fromisoformat("2020-01-01T02:00:00"), "regime": MarketRegime.NEUTRAL, "volatility_regime": VolatilityRegime.COMPRESSION, "regime_confidence": 0.9}
    trade = make_trade("2020-01-01T01:30:00", 0.03)
    out = RegimeProfiler.profile([trade], [r_low, r_high])
    vol = out["volatility"]
    # should map to COMPRESSION due to higher confidence
    assert vol[VolatilityRegime.COMPRESSION.value]["count"] == 1
    assert VolatilityRegime.TRENDING.value not in vol or vol[VolatilityRegime.TRENDING.value]["count"] == 0

