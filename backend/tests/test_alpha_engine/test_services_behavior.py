import asyncio
from datetime import datetime, timedelta, timezone

from src.alpha_engine.models.conviction_models import ConvictionComponent, ConvictionResult
from src.alpha_engine.models.footprint_models import AbsorptionEvent, FlowImbalanceResult, ImpulseEvent, SweepEvent, Trade
from src.alpha_engine.models.governance_models import GovernanceReport
from src.alpha_engine.models.liquidation_models import LiquidationLevel, LiquidationProjectionResult
from src.alpha_engine.models.probability_models import ProbabilityResult
from src.alpha_engine.models.regime_models import AlphaSignal, MarketRegime, VolatilityRegime
from src.alpha_engine.services.alpha_service import AlphaService
from src.alpha_engine.services.conviction_service import ConvictionService
from src.alpha_engine.services.footprint_service import FootprintService
from src.alpha_engine.services.liquidation_service import LiquidationService
from src.alpha_engine.state.market_state import MarketState
from src.alpha_engine.state.state_store import StateStore


def _conviction() -> ConvictionResult:
    comps = {
        "regime": ConvictionComponent(score=0.5, weight=0.2, description="r"),
        "liquidation": ConvictionComponent(score=0.4, weight=0.2, description="l"),
        "footprint": ConvictionComponent(score=0.3, weight=0.2, description="f"),
        "funding": ConvictionComponent(score=0.1, weight=0.2, description="fu"),
        "volatility": ConvictionComponent(score=0.2, weight=0.2, description="v"),
    }
    return ConvictionResult(symbol="BTC", bias="LONG", score=70, confidence=0.8, components=comps, explanation=["ok"], timestamp=123)


def test_state_store_update_get_and_symbols():
    store = StateStore()
    asyncio.run(store.update_state("btc", {"price": 100}))
    state = asyncio.run(store.get_state("BTC"))
    assert state.symbol == "BTC"
    state.price = 999
    state2 = asyncio.run(store.get_state("BTC"))
    assert state2.price == 100
    symbols = asyncio.run(store.get_all_symbols())
    assert symbols == ["BTC"]


def test_footprint_and_liquidation_services(monkeypatch):
    fp = FootprintService()
    liq = LiquidationService()

    async def _get_state(_symbol):
        return MarketState(
            symbol="BTC",
            price=100,
            cvd_1m=100000,
            aggressive_buy_volume_1m=50000,
            aggressive_sell_volume_1m=1000,
            orderbook_bids=[(99, 1000), (98, 1000), (97, 1000)],
            orderbook_asks=[(101, 1000), (102, 1000), (103, 1000)],
            trade_stream_recent=[Trade(price=100, size=60000, side="BUY", timestamp=datetime.now(timezone.utc))],
            liquidation_levels=[LiquidationLevel(price=101, side="SHORT", notional=1000)],
        )

    from src.alpha_engine.state import state_store as ss

    monkeypatch.setattr(ss.global_state_store, "get_state", _get_state)

    fp_out = asyncio.run(fp.generate_footprint("BTC"))
    assert fp_out.symbol == "BTC"

    liq_out = asyncio.run(liq.get_projection("BTC"))
    assert isinstance(liq_out, LiquidationProjectionResult)


def test_conviction_service(monkeypatch):
    svc = ConvictionService()

    async def _state(_symbol):
        return MarketState(symbol="BTC", funding_rate=0.001)

    async def _signal(_symbol):
        return AlphaSignal(
            symbol="BTC",
            regime=MarketRegime.AGGRESSIVE_LONG_BUILD,
            regime_confidence=0.8,
            volatility_regime=VolatilityRegime.COMPRESSION,
            compression_score=0.8,
            timestamp=1,
        )

    async def _liq(_symbol):
        return LiquidationProjectionResult(symbol="BTC", current_price=100, upside={"1.0%": 1000}, downside={"1.0%": 500}, imbalance_ratio=2.0, dominant_side="SHORT_SQUEEZE")

    async def _foot(_symbol):
        return {
            "dummy": "will be replaced"
        }

    from src.alpha_engine.services import conviction_service as module

    monkeypatch.setattr(module.global_state_store, "get_state", _state)
    monkeypatch.setattr(module.alpha_service, "generate_signal", _signal)
    monkeypatch.setattr(module.liquidation_service, "get_projection", _liq)

    async def _fp_obj(_symbol):
        from src.alpha_engine.models.footprint_models import FootprintResult

        return FootprintResult(
            symbol="BTC",
            sweep=SweepEvent(),
            absorption=AbsorptionEvent(),
            imbalance=FlowImbalanceResult(imbalance_ratio=1.0, z_score=0.0, dominance="NEUTRAL"),
            impulse=ImpulseEvent(),
            timestamp=1,
        )

    monkeypatch.setattr(module.footprint_service, "generate_footprint", _fp_obj)

    out = asyncio.run(svc.get_conviction("BTC"))
    assert out is not None
    assert out.symbol == "BTC"


def test_alpha_service_pipeline_and_generate_signal(monkeypatch):
    service = AlphaService()
    symbol = "BTC"

    base_state = MarketState(
        symbol=symbol,
        price=100,
        funding_rate=0.0001,
        open_interest=1000,
        oi_delta_1m=10,
        cvd_1m=100000,
        aggressive_buy_volume_1m=100000,
        aggressive_sell_volume_1m=1000,
        orderbook_imbalance=1.2,
        orderbook_bids=[(99, 1000), (98, 1000), (97, 1000)],
        orderbook_asks=[(101, 1000), (102, 1000), (103, 1000)],
        trade_stream_recent=[Trade(price=100, size=60000, side="BUY", timestamp=datetime.now(timezone.utc))],
        liquidation_levels=[LiquidationLevel(price=101, side="SHORT", notional=5000)],
        timestamp=123,
    )

    async def _get_state(_symbol):
        return base_state

    from src.alpha_engine.services import alpha_service as module

    monkeypatch.setattr(module.global_state_store, "get_state", _get_state)

    class _WS:
        def __init__(self):
            self.events = []

        async def broadcast(self, payload):
            self.events.append(payload)

    ws = _WS()
    monkeypatch.setattr(module, "ws_manager", ws)

    class _Gov:
        def get_health_report(self):
            return GovernanceReport(
                symbol=symbol,
                active_regime="NORMAL_MARKET",
                active_model_id="m1",
                feature_drift={},
                calibration_status="OPTIMAL",
                shadow_model_active=False,
                last_update=datetime.now(timezone.utc),
            )

    async def _gov(_symbol):
        return _Gov()

    monkeypatch.setattr(module, "get_governance_service", _gov)
    monkeypatch.setattr(module.probability_service, "calculate_probabilities", lambda _c: ProbabilityResult(symbol=symbol, prob_up_1pct=0.6, prob_down_1pct=0.4, squeeze_intensity=0.2, expected_move=0.01, calibration_quality=0.8, timestamp=123))

    class _RiskOut:
        size_usd = 1000.0

    monkeypatch.setattr(module.risk_service, "calculate_risk", lambda **_kwargs: _RiskOut())

    class _Urg:
        urgency_score = 0.5

    class _Slip:
        expected_impact_bps = 2.0
        expected_impact_usd = 2.0

    class _Slice:
        def model_dump(self):
            return {"order_type": "LIMIT", "direction": "BUY", "amount_usd": 1000.0, "urgency": "HIGH", "slice_id": 0, "delay_ms": 0}

    class _Plan:
        strategy = "PASSIVE"
        total_size_usd = 1000.0
        urgency_metrics = _Urg()
        slippage_metrics = _Slip()
        slices = [_Slice()]

    monkeypatch.setattr(module.execution_service, "generate_plan", lambda **_kwargs: _Plan())

    service.price_history_cache[symbol] = [95, 96, 97, 98, 99, 100]
    service.volume_history_cache[symbol] = [10] * 6
    service.cvd_history_cache[symbol] = [0, 50000, 100000]

    sig = asyncio.run(service.generate_signal(symbol))
    assert sig.symbol == symbol

    asyncio.run(service._run_pipeline(symbol))
    event_types = [e["type"] for e in ws.events]
    assert "alpha_conviction" in event_types
    assert "gov_update" in event_types


def test_alpha_service_update_market_state_schedules(monkeypatch):
    service = AlphaService()

    calls = []

    async def _update_state(symbol, data):
        calls.append((symbol, data))

    from src.alpha_engine.services import alpha_service as module

    monkeypatch.setattr(module.global_state_store, "update_state", _update_state)

    scheduled = []

    def _create_task(coro):
        scheduled.append(coro)
        coro.close()
        class _T:
            pass
        return _T()

    monkeypatch.setattr(module.asyncio, "create_task", _create_task)

    asyncio.run(service.update_market_state("btc", {"price": 100, "trade_update": {"x": 1}}))
    assert calls
    assert len(scheduled) >= 1


def test_alpha_service_trade_derived_updates_rolling_windows():
    service = AlphaService()
    symbol = "BTC"
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    service._build_trade_derived_updates(
        symbol,
        {"trade_update": Trade(price=100.0, size=999.0, side="BUY", timestamp=now - timedelta(minutes=7))},
    )
    out_buy = service._build_trade_derived_updates(
        symbol,
        {"trade_update": Trade(price=100.0, size=50.0, side="BUY", timestamp=now - timedelta(seconds=30))},
    )
    out = service._build_trade_derived_updates(
        symbol,
        {"trade_update": Trade(price=100.0, size=20.0, side="SELL", timestamp=now - timedelta(seconds=10))},
    )

    assert len(out["trade_stream_recent"]) == 2
    assert out_buy["aggressive_buy_volume_1m"] == 50.0
    assert out["aggressive_buy_volume_1m"] == 50.0
    assert out["aggressive_sell_volume_1m"] == 20.0
    assert out["cvd_1m"] == 30.0
    assert out["cvd_5m"] == 30.0
    assert out["trade_stream_recent"][-1].timestamp.tzinfo is not None


def test_alpha_service_trade_derived_updates_prefers_spot_composite_when_available():
    service = AlphaService()
    symbol = "BTC"
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    out = service._build_trade_derived_updates(
        symbol,
        {
            "trade_update": Trade(price=100.0, size=20.0, side="BUY", timestamp=now),
            "cvd_spot_binance_1m": 200.0,
            "cvd_spot_binance_5m": 500.0,
            "cvd_spot_coinbase_1m": 50.0,
            "cvd_spot_coinbase_5m": 125.0,
            "cvd_spot_composite_1m": 155.0,
            "cvd_spot_composite_5m": 390.0,
        },
    )

    assert out["cvd_hl_1m"] == 20.0
    assert out["cvd_hl_5m"] == 20.0
    assert out["cvd_spot_binance_1m"] == 200.0
    assert out["cvd_spot_coinbase_1m"] == 50.0
    assert out["cvd_1m"] == 155.0
    assert out["cvd_5m"] == 390.0
    assert out["cvd_source"] == "spot_composite"


def test_alpha_service_trade_derived_updates_accepts_spot_only_payload():
    service = AlphaService()
    out = service._build_trade_derived_updates(
        "BTC",
        {
            "cvd_spot_composite_1m": 120.0,
            "cvd_spot_composite_5m": 240.0,
            "cvd_spot_binance_1m": 140.0,
            "cvd_spot_coinbase_1m": 80.0,
        },
    )
    assert out["cvd_1m"] == 120.0
    assert out["cvd_5m"] == 240.0
    assert out["cvd_source"] == "spot_composite"


def test_alpha_service_oi_derived_updates_time_windows():
    service = AlphaService()
    symbol = "BTC"

    out1 = service._build_oi_derived_updates(symbol, {"open_interest": 1000.0, "timestamp": 0})
    out2 = service._build_oi_derived_updates(symbol, {"open_interest": 1010.0, "timestamp": 30_000})
    out3 = service._build_oi_derived_updates(symbol, {"open_interest": 1025.0, "timestamp": 90_000})

    assert out1["oi_delta_1m"] == 0.0
    assert out2["oi_delta_1m"] == 10.0
    assert out3["oi_delta_1m"] == 15.0
    assert out3["oi_delta_5m"] == 25.0
