import asyncio
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from src.alpha_engine.models.adaptive_models import OptimalWeights, WindowResult
from src.alpha_engine.models.backtest_models import BacktestTrade, HistoricalMarketSnapshot
from src.alpha_engine.models.conviction_models import ConvictionComponent, ConvictionResult
from src.alpha_engine.models.execution_models import ExecutionPlan
from src.alpha_engine.models.footprint_models import (
    AbsorptionEvent,
    FlowImbalanceResult,
    FootprintResult,
    ImpulseEvent,
    SweepEvent,
    Trade,
)
from src.alpha_engine.models.governance_models import ModelMetadata
from src.alpha_engine.models.liquidation_models import LiquidationLevel, LiquidationProjectionResult
from src.alpha_engine.models.probability_models import FeatureVector
from src.alpha_engine.models.regime_models import AlphaSignal, MarketRegime, VolatilityRegime
from src.alpha_engine.processors.absorption_detector import AbsorptionDetector
from src.alpha_engine.processors.conviction_engine import ConvictionEngine
from src.alpha_engine.processors.flow_imbalance import FlowImbalanceProcessor
from src.alpha_engine.processors.impulse_detector import ImpulseDetector
from src.alpha_engine.processors.liquidation_projection import LiquidationProjector
from src.alpha_engine.processors.oi_price_regime import OIRegimeClassifier
from src.alpha_engine.processors.sweep_detector import SweepDetector
from src.alpha_engine.processors.volatility_regime import VolatilityDetector
from src.alpha_engine.state.market_state import MarketState


def _now():
    return datetime.now(timezone.utc)


def _trade(price: float, size: float, side: str, ms_ago: int = 0) -> Trade:
    ts = _now() - timedelta(milliseconds=ms_ago)
    return Trade(price=price, size=size, side=side, timestamp=ts)


def _conviction(score: int = 70, bias: str = "LONG") -> ConvictionResult:
    comps = {
        "regime": ConvictionComponent(score=0.7, weight=0.2, description="r"),
        "liquidation": ConvictionComponent(score=0.5, weight=0.2, description="l"),
        "footprint": ConvictionComponent(score=0.3, weight=0.2, description="f"),
        "funding": ConvictionComponent(score=0.1, weight=0.2, description="fu"),
        "volatility": ConvictionComponent(score=0.2, weight=0.2, description="v"),
    }
    return ConvictionResult(symbol="BTC", bias=bias, score=score, confidence=0.8, components=comps, explanation=["ok"], timestamp=123)


@pytest.mark.parametrize(
    "price,price_ago,oi_delta,expected",
    [
        (101, 100, 10, MarketRegime.AGGRESSIVE_LONG_BUILD),
        (99, 100, 10, MarketRegime.AGGRESSIVE_SHORT_BUILD),
        (101, 100, -10, MarketRegime.SHORT_COVER),
        (99, 100, -10, MarketRegime.LONG_UNWIND),
    ],
)
def test_oi_regime_classifier_branches(price, price_ago, oi_delta, expected):
    state = MarketState(symbol="BTC", price=price, open_interest=1000, oi_delta_1m=oi_delta)
    out = OIRegimeClassifier.classify(state, price_ago)
    assert out["regime"] == expected
    assert 0.0 <= out["confidence"] <= 1.0


def test_oi_regime_classifier_invalid_price():
    state = MarketState(symbol="BTC", price=100, open_interest=1000, oi_delta_1m=0)
    out = OIRegimeClassifier.classify(state, 0)
    assert out["regime"] == MarketRegime.NEUTRAL


@pytest.mark.parametrize(
    "prices,vols,regime",
    [
        ([100] * 10, [10] * 10, VolatilityRegime.TRENDING),
        ([100, 101, 99, 100, 102, 98, 101, 99, 100, 101, 100, 100.05, 99.95, 100.0], [100] * 11 + [20, 20, 20], VolatilityRegime.COMPRESSION),
        ([100, 100.1, 100.2, 100.3, 100.4, 100.5, 100.6, 100.7, 100.8, 100.9, 90, 95, 105, 110], [50] * 14, VolatilityRegime.EXPANSION),
    ],
)
def test_volatility_detector_regimes(prices, vols, regime):
    out = VolatilityDetector.detect(MarketState(symbol="BTC", price=prices[-1]), prices, vols)
    assert out["volatility_regime"] == regime


def test_liquidation_projector_sentiment():
    levels = [
        LiquidationLevel(price=101.0, side="SHORT", notional=3000),
        LiquidationLevel(price=99.0, side="LONG", notional=500),
    ]
    state = MarketState(symbol="BTC", price=100.0, liquidation_levels=levels)
    out = LiquidationProjector.project(state)
    assert out.symbol == "BTC"
    assert out.dominant_side in {"SHORT_SQUEEZE", "LONG_SQUEEZE", "BALANCED"}


def test_sweep_detector_buy_and_sell():
    state_buy = MarketState(
        symbol="BTC",
        orderbook_asks=[(101, 1000), (102, 1000), (103, 1000)],
        trade_stream_recent=[_trade(100, 60000, "BUY", 100), _trade(100.1, 60000, "BUY", 10)],
    )
    out_buy = SweepDetector.detect(state_buy)
    assert out_buy.event == "BUY_SWEEP"

    state_sell = MarketState(
        symbol="BTC",
        orderbook_bids=[(99, 1000), (98, 1000), (97, 1000)],
        trade_stream_recent=[_trade(100, 70000, "SELL", 50), _trade(99.8, 70000, "SELL", 5)],
    )
    out_sell = SweepDetector.detect(state_sell)
    assert out_sell.event == "SELL_SWEEP"


def test_absorption_detector_paths():
    buys = [_trade(100.0, 25000, "BUY", i * 1000) for i in range(6)]
    state = MarketState(symbol="BTC", trade_stream_recent=buys)
    out = AbsorptionDetector.detect(state)
    assert out.event == "SELL_ABSORPTION"

    sells = [_trade(100.0, 25000, "SELL", i * 1000) for i in range(6)]
    out2 = AbsorptionDetector.detect(MarketState(symbol="BTC", trade_stream_recent=sells))
    assert out2.event == "BUY_ABSORPTION"


def test_flow_imbalance_and_impulse():
    state = MarketState(symbol="BTC", aggressive_buy_volume_1m=1000, aggressive_sell_volume_1m=100, cvd_1m=100000, price=101)
    imb = FlowImbalanceProcessor.compute(state, [1.0] * 12)
    assert isinstance(imb, FlowImbalanceResult)
    assert imb.dominance in {"BUY_DOMINANT", "SELL_DOMINANT", "NEUTRAL"}

    impulse = ImpulseDetector.detect(state, prev_cvd=0, prev_price=100)
    assert impulse.event == "BULLISH_IMPULSE"


@pytest.mark.parametrize("funding,std", [(0.01, 0.001), (-0.01, 0.001), (0.0, 0.0)])
def test_conviction_engine_behavior(funding, std):
    regime = AlphaSignal(
        symbol="BTC",
        regime=MarketRegime.AGGRESSIVE_LONG_BUILD,
        regime_confidence=0.8,
        volatility_regime=VolatilityRegime.COMPRESSION,
        compression_score=0.7,
        timestamp=123,
    )
    liq = LiquidationProjectionResult(
        symbol="BTC",
        current_price=100,
        upside={"1.0%": 2000},
        downside={"1.0%": 1000},
        imbalance_ratio=2.0,
        dominant_side="SHORT_SQUEEZE",
    )
    fp = FootprintResult(
        symbol="BTC",
        sweep=SweepEvent(event="BUY_SWEEP", strength=0.7, levels_consumed=3),
        absorption=AbsorptionEvent(event="BUY_ABSORPTION", strength=2.0),
        imbalance=FlowImbalanceResult(imbalance_ratio=3.0, z_score=2.0, dominance="BUY_DOMINANT"),
        impulse=ImpulseEvent(event="BULLISH_IMPULSE", strength=1.2),
        timestamp=123,
    )
    out = ConvictionEngine.analyze("BTC", regime, liq, fp, funding, 0.0, std)
    assert out.bias in {"LONG", "SHORT", "NEUTRAL"}
    assert 0 <= out.score <= 100


def test_execution_components(tmp_path):
    from src.alpha_engine.execution.adverse_selection_guard import AdverseSelectionGuard
    from src.alpha_engine.execution.execution_service import ExecutionService
    from src.alpha_engine.execution.execution_tracker import ExecutionTracker
    from src.alpha_engine.execution.order_selector import OrderSelector
    from src.alpha_engine.execution.slicer import OrderSlicer
    from src.alpha_engine.execution.slippage_model import SlippageModel
    from src.alpha_engine.execution.urgency_model import UrgencyModel

    assert AdverseSelectionGuard().check(1.0, 1.0, False, 5000) is True
    assert AdverseSelectionGuard().check(25.0, 1.0, False, 5000) is False

    sel = OrderSelector()
    assert sel.select(0.1) == "PASSIVE"
    assert sel.select(0.5) == "HYBRID"
    assert sel.select(0.9) == "AGGRESSIVE"
    assert sel.get_market_percentage("PASSIVE") == 0.0

    slices = OrderSlicer().slice_order(10000, 100000, "HYBRID", 0.5)
    assert len(slices) >= 1

    slip_bps, cost = SlippageModel().estimate(1000, 100000, 2, 10)
    assert slip_bps > 0 and cost > 0

    urg = UrgencyModel().compute(0.9, 0.8, "TRENDING_HIGH_VOL", 0.02)
    assert 0 <= urg <= 1

    tracker = ExecutionTracker(log_path=str(tmp_path / "exec"))
    tracker.record_plan({"x": 1})
    tracker.record_fill({"x": 2})

    svc = ExecutionService()
    svc.tracker = tracker
    svc.tracker._flush_to_disk = lambda: None
    plan = svc.generate_plan(
        symbol="BTC",
        direction="BUY",
        size_usd=2000,
        available_liquidity_usd=500000,
        spread_bps=3,
        volatility_bps=12,
        book_imbalance=1.2,
        conviction_score=0.8,
        impulse_strength=0.6,
        regime="TRENDING_HIGH_VOL",
    )
    assert isinstance(plan, ExecutionPlan)
    assert plan.adverse_selection_checks["safe_to_execute"] in {True, False}


def test_risk_components_and_service():
    from src.alpha_engine.risk.correlation_manager import CorrelationManager
    from src.alpha_engine.risk.drawdown_manager import DrawdownManager
    from src.alpha_engine.risk.edge_calculator import EdgeCalculator
    from src.alpha_engine.risk.kelly_sizer import KellySizer
    from src.alpha_engine.risk.portfolio_allocator import PortfolioAllocator
    from src.alpha_engine.risk.regime_risk_scaler import RegimeRiskScaler
    from src.alpha_engine.risk.risk_service import RiskService
    from src.alpha_engine.risk.volatility_adjuster import VolatilityAdjuster

    assert CorrelationManager().get_penalty(0.9) <= 1.0
    ddm = DrawdownManager(high_water_mark=100)
    assert ddm.get_risk_multiplier(120) == 1.0
    assert ddm.get_risk_multiplier(80) <= 1.0
    assert 0 <= EdgeCalculator.compute(0.6) <= 1.0
    assert KellySizer().compute(0.6, 2.0) >= 0
    assert VolatilityAdjuster().compute(0.0) == 1.0
    assert PortfolioAllocator().compute_size_usd(10000, 0.1, 1, 1, 1, 1) > 0
    assert RegimeRiskScaler().get_multiplier("UNKNOWN") == 1.0

    svc = RiskService()
    out = svc.calculate_risk(
        symbol="BTC",
        direction="LONG",
        win_prob=0.65,
        reward_risk_ratio=2.0,
        realized_vol_pct=0.02,
        current_equity=100000,
        current_price=100,
        active_correlations=0.1,
    )
    assert out.size_usd >= 0
    assert out.stop_loss_price > 0


def test_probability_stack(tmp_path, monkeypatch):
    from src.alpha_engine.probability.calibrator import ProbabilityCalibrator
    from src.alpha_engine.probability.feature_builder import FeatureBuilder
    from src.alpha_engine.probability.label_builder import LabelBuilder
    from src.alpha_engine.probability.logistic_model import ProbabilisticModel
    from src.alpha_engine.probability.probability_service import ProbabilityService
    from src.alpha_engine.probability.squeeze_forecaster import SqueezeForecaster

    cal = ProbabilityCalibrator()
    x = np.array([0.1, 0.2, 0.3, 0.4, 0.5])
    y = np.array([0, 0, 0, 1, 1])
    cal.fit(x, y)
    assert np.allclose(cal.calibrate(np.array([0.5])), np.array([0.5]))

    x2 = np.linspace(0.01, 0.99, 20)
    y2 = np.array([0] * 10 + [1] * 10)
    cal.fit(x2, y2)
    assert cal.is_fitted is True
    assert cal.calibrate(np.array([0.5])).shape == (1,)

    fv = FeatureBuilder.build(_conviction(70, "LONG"))
    assert isinstance(fv, FeatureVector)

    t0 = _now()
    snaps = [
        HistoricalMarketSnapshot(timestamp=t0 + timedelta(minutes=i), price=100 + i, funding_rate=0.0, open_interest=1000, volume=100)
        for i in range(3)
    ]
    labels = LabelBuilder.build_labels(snaps, horizon_minutes=2)
    assert len(labels) == 3

    model = ProbabilisticModel("x")
    probs_untrained = model.predict_proba(np.array([[0.1] * 3]))
    assert probs_untrained[0] == 0.5

    X = np.array([[0], [1], [2], [3], [4], [5]], dtype=float)
    y = np.array([0, 0, 0, 1, 1, 1])
    model.train(X, y)
    assert model.is_trained is True
    probs = model.predict_proba(np.array([[2], [3]], dtype=float))
    assert len(probs) == 2
    metrics = ProbabilisticModel.evaluate(np.array([0, 1]), np.array([0.2, 0.8]))
    assert set(metrics.keys()) == {"brier", "auc"}

    pkl = tmp_path / "m.pkl"
    model.save(str(pkl))
    loaded = ProbabilisticModel("y")
    loaded.load(str(pkl))
    assert loaded.is_trained is True

    svc = ProbabilityService()
    out = svc.calculate_probabilities(_conviction(80, "LONG"))
    assert out.symbol == "BTC"

    class BadModel:
        def predict_proba(self, _):
            raise RuntimeError("boom")

    svc.upside_model = BadModel()
    svc.downside_model = BadModel()
    out2 = svc.calculate_probabilities(_conviction(20, "SHORT"))
    assert 0.0 <= out2.prob_up_1pct <= 1.0

    async def _fake_get_conviction(_symbol):
        return _conviction(60, "LONG")

    import src.alpha_engine.services.conviction_service as cs

    monkeypatch.setattr(cs.conviction_service, "get_conviction", _fake_get_conviction)
    out3 = asyncio.run(svc.get_probabilities("BTC"))
    assert out3 is not None
    sf = SqueezeForecaster.forecast("BTC", 0.6, 0.4, timestamp=1)
    assert sf.squeeze_intensity == 0.2


def test_live_adaptive_stack(tmp_path, monkeypatch):
    from src.alpha_engine.live_adaptive.calibration_monitor import CalibrationMonitor
    from src.alpha_engine.live_adaptive.drift_detector import DriftDetector
    from src.alpha_engine.live_adaptive.governance_service import GovernanceService, get_governance_service, governance_manager
    from src.alpha_engine.live_adaptive.model_registry import ModelRegistry
    from src.alpha_engine.live_adaptive.regime_classifier import MacroRegimeClassifier
    from src.alpha_engine.live_adaptive.retraining_pipeline import RetrainingPipeline, ShadowValidator

    mon = CalibrationMonitor(window_size=60)
    for i in range(60):
        mon.add_prediction(i % 2 == 0, 0.7 if i % 2 == 0 else 0.3)
    m = mon.get_metrics()
    assert "brier" in m and "ece" in m

    base = [FeatureVector(regime_score=0, liquidation_score=0, footprint_score=0, funding_score=0, volatility_score=0, conviction_score=0, imbalance_ratio=1, compression_score=0.2, flow_zscore=0, impulse_strength=0) for _ in range(20)]
    cur = [FeatureVector(regime_score=1, liquidation_score=1, footprint_score=1, funding_score=1, volatility_score=1, conviction_score=1, imbalance_ratio=2, compression_score=0.9, flow_zscore=1, impulse_strength=1) for _ in range(20)]
    drift = DriftDetector(base).check_drift(cur)
    assert "regime_score" in drift

    state = MarketState(symbol="BTC", liquidation_levels=[LiquidationLevel(price=100, side="LONG", notional=6_000_000)], funding_rate=0.0)
    assert MacroRegimeClassifier.classify(state, 0.5) == "CRISIS_MODE"
    state2 = MarketState(symbol="BTC", funding_rate=0.0)
    assert MacroRegimeClassifier.classify(state2, 0.9) == "TRENDING_HIGH_VOL"

    reg = ModelRegistry(base_path=str(tmp_path / "registry"))
    meta = ModelMetadata(
        model_id="m1",
        training_period_start=_now() - timedelta(days=10),
        training_period_end=_now() - timedelta(days=1),
        feature_set=["a"],
        regime_type="NORMAL_MARKET",
        sharpe=1.0,
        auc=0.6,
        brier=0.2,
        calibration_error=0.1,
        deployment_timestamp=_now(),
    )
    reg.register_model({"weights": [1]}, meta)
    model, meta_out = reg.get_active_model("NORMAL_MARKET")
    assert model is not None and meta_out.model_id == "m1"
    with pytest.raises(ValueError):
        reg.register_model({}, meta)

    from src.alpha_engine.state.state_store import global_state_store

    asyncio.run(global_state_store.update_state("BTC", {"price": 100, "funding_rate": 0.0}))
    gov = GovernanceService("BTC")
    gov.drift_detector = DriftDetector(base)
    for i in range(110):
        asyncio.run(gov.update({}, cur[0], y_true_up=bool(i % 2), y_prob_up=0.6 if i % 2 else 0.4))
    rep = gov.get_health_report()
    assert rep.symbol == "BTC"

    governance_manager.clear()
    g1 = asyncio.run(get_governance_service("BTC"))
    g2 = asyncio.run(get_governance_service("BTC"))
    assert g1 is g2

    pipe = RetrainingPipeline(reg)
    assert asyncio.run(pipe.execute("BTC", [], "NORMAL_MARKET")) is None

    sh = ShadowValidator("s", "a")
    sh.log_comparison(True, 0.7, 0.6)
    assert len(sh.shadow_results) == 1


def test_backtesting_and_adaptive(monkeypatch):
    from src.alpha_engine.adaptive.performance_tracker import PerformanceTracker
    from src.alpha_engine.adaptive.walkforward_runner import WalkForwardRunner
    from src.alpha_engine.adaptive.weight_optimizer import WeightOptimizer
    from src.alpha_engine.adaptive.window_splitter import WindowSplitter
    from src.alpha_engine.backtesting.metrics import MetricsCalculator
    from src.alpha_engine.backtesting.portfolio import Portfolio
    from src.alpha_engine.backtesting.report import BacktestReportGenerator
    from src.alpha_engine.backtesting.signal_runner import SignalRunner
    from src.alpha_engine.backtesting.state_rebuilder import StateRebuilder
    from src.alpha_engine.backtesting.strategy import Strategy

    t0 = _now()
    snaps = [
        HistoricalMarketSnapshot(
            timestamp=t0 + timedelta(minutes=i),
            price=100 + i * 0.5,
            funding_rate=0.0001,
            open_interest=1000 + i,
            volume=100 + i,
            liquidation_levels=[LiquidationLevel(price=101 + i, side="SHORT", notional=1000)],
            recent_trades=[_trade(100 + i * 0.5, 10000, "BUY", 0)],
            book_bids=[[99 + i * 0.5, 1000]],
            book_asks=[[101 + i * 0.5, 1000]],
        )
        for i in range(25)
    ]

    st = StateRebuilder.rebuild("BTC", snaps[0])
    assert st.symbol == "BTC"

    strat = Strategy()
    assert strat.get_signal(_conviction(80), None, 0, 100) == "OPEN_LONG"
    assert strat.get_signal(_conviction(20, "SHORT"), None, 0, 100) == "OPEN_SHORT"
    assert strat.get_signal(_conviction(40), "LONG", 100, 98) == "CLOSE"

    p = Portfolio(initial_equity=10000)
    p.process_step(t0, 100, 0.0001, "OPEN_LONG", "BTC")
    p.process_step(t0 + timedelta(minutes=1), 102, 0.0001, "CLOSE", "BTC")
    assert len(p.trades) == 1

    metrics = MetricsCalculator.calculate(p.trades, 10000, p.equity, p.equity_curve)
    assert metrics.trade_count == 1
    metrics_empty = MetricsCalculator.calculate([], 10000, 10000, [])
    assert metrics_empty.trade_count == 0

    runner = SignalRunner("BTC")
    conv = asyncio.run(runner.run_step(snaps[0]))
    assert 0 <= conv.score <= 100

    rep = asyncio.run(BacktestReportGenerator.run("BTC", snaps[:10]))
    assert rep.symbol == "BTC"

    wins = WindowSplitter.split(t0, t0 + timedelta(days=30), train_days=10, test_days=5, step_days=5)
    assert len(wins) >= 1

    wr = WindowResult(
        window=wins[0],
        weights=OptimalWeights(
            w_regime=0.2,
            w_liquidation=0.2,
            w_footprint=0.2,
            w_funding=0.2,
            w_volatility=0.2,
            sharpe_attained=1.0,
            timestamp=_now(),
        ),
        return_pct=0.05,
        sharpe=1.2,
        max_drawdown=0.1,
    )
    stabs = PerformanceTracker.analyze_stability([wr, wr.model_copy(update={"return_pct": 0.03})])
    assert "avg_weight_drift" in stabs

    async def _fake_eval(*_args, **_kwargs):
        return 1.23

    monkeypatch.setattr(WeightOptimizer, "_evaluate", _fake_eval)
    opt = asyncio.run(WeightOptimizer.optimize("BTC", snaps[:8]))
    assert opt.w_regime > 0

    async def _fake_opt(*_args, **_kwargs):
        return opt

    monkeypatch.setattr(WeightOptimizer, "optimize", _fake_opt)
    wf = asyncio.run(WalkForwardRunner.run("BTC", snaps + snaps + snaps))
    assert wf.symbol == "BTC"
