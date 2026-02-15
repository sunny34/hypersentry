import asyncio
from datetime import datetime, timedelta, timezone

from src.alpha_engine.live_adaptive.model_registry import ModelRegistry
from src.alpha_engine.live_adaptive.retraining_pipeline import RetrainingPipeline
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.models.conviction_models import ConvictionComponent, ConvictionResult
from src.alpha_engine.models.governance_models import ModelMetadata
from src.alpha_engine.probability.label_builder import LabelBuilder
from src.alpha_engine.probability.probability_service import ProbabilityService


def _snapshots(n: int) -> list[HistoricalMarketSnapshot]:
    base = datetime.now(timezone.utc)
    out = []
    for i in range(n):
        # Oscillating path creates mixed labels for up/down classifiers.
        px = 100.0 + ((i % 6) - 3) * 0.8 + (i * 0.03)
        out.append(
            HistoricalMarketSnapshot(
                timestamp=base + timedelta(minutes=i),
                price=px,
                funding_rate=0.0001 * ((i % 3) - 1),
                open_interest=1000.0 + (i * 5),
                volume=200.0 + (i * 10),
            )
        )
    return out


def _conviction(score: int = 60) -> ConvictionResult:
    comps = {
        "regime": ConvictionComponent(score=0.4, weight=0.2, description="r"),
        "liquidation": ConvictionComponent(score=0.3, weight=0.2, description="l"),
        "footprint": ConvictionComponent(score=0.2, weight=0.2, description="f"),
        "funding": ConvictionComponent(score=0.1, weight=0.2, description="fu"),
        "volatility": ConvictionComponent(score=0.2, weight=0.2, description="v"),
    }
    return ConvictionResult(
        symbol="BTC",
        bias="LONG" if score >= 50 else "SHORT",
        score=score,
        confidence=0.7,
        components=comps,
        explanation=["ok"],
        timestamp=123,
    )


def test_probability_service_train_window_and_get_probabilities(monkeypatch):
    svc = ProbabilityService()
    snaps = _snapshots(30)

    # Ensure label alignment and class variety for model training.
    monkeypatch.setattr(
        LabelBuilder,
        "build_labels",
        staticmethod(lambda s: [((i % 2) == 0, (i % 3) == 0) for i in range(len(s))]),
    )

    asyncio.run(svc.train_on_window(snaps))
    assert svc.upside_model.is_trained is True
    assert svc.downside_model.is_trained is True

    out = svc.calculate_probabilities(_conviction(75))
    assert out.symbol == "BTC"
    assert 0.0 <= out.prob_up_1pct <= 1.0
    assert 0.0 <= out.prob_down_1pct <= 1.0

    from src.alpha_engine.services import conviction_service as conviction_module

    async def _none(_symbol):
        return None

    async def _ok(_symbol):
        return _conviction(65)

    monkeypatch.setattr(conviction_module.conviction_service, "get_conviction", _none)
    assert asyncio.run(svc.get_probabilities("BTC")) is None

    monkeypatch.setattr(conviction_module.conviction_service, "get_conviction", _ok)
    assert asyncio.run(svc.get_probabilities("BTC")) is not None


def test_probability_service_training_guardrails(monkeypatch):
    svc = ProbabilityService()

    # Insufficient data branch.
    asyncio.run(svc.train_on_window(_snapshots(10)))
    assert svc.upside_model.is_trained is False

    # Label/snapshot mismatch branch.
    monkeypatch.setattr(LabelBuilder, "build_labels", staticmethod(lambda s: [(True, False)] * (len(s) - 1)))
    asyncio.run(svc.train_on_window(_snapshots(25)))
    assert svc.downside_model.is_trained is False


def test_model_registry_signature_and_missing_model(monkeypatch, tmp_path):
    monkeypatch.setenv("MODEL_REGISTRY_SIGNING_KEY", "unit-test-key")
    base = tmp_path / "registry"

    reg = ModelRegistry(base_path=str(base))
    meta = ModelMetadata(
        model_id="m1",
        training_period_start=datetime.now(timezone.utc) - timedelta(days=1),
        training_period_end=datetime.now(timezone.utc),
        feature_set=["f1"],
        regime_type="NORMAL_MARKET",
        sharpe=1.2,
        auc=0.6,
        brier=0.2,
        calibration_error=0.01,
        deployment_timestamp=datetime.now(timezone.utc),
        is_active=True,
    )
    reg.register_model({"weights": [1, 2, 3]}, meta)

    loaded = ModelRegistry(base_path=str(base))
    got = loaded.get_active_model("NORMAL_MARKET")
    assert got is not None
    assert got[1].model_id == "m1"

    # Missing model file branch.
    model_path = base / "m1.pkl"
    model_path.unlink()
    assert loaded.get_active_model("NORMAL_MARKET") is None

    # Signature mismatch branch should clear in-memory registry.
    (base / "registry_meta.sig").write_text("corrupt-signature", encoding="utf-8")
    tampered = ModelRegistry(base_path=str(base))
    assert tampered.models_meta == {}


def test_retraining_pipeline_execute(monkeypatch, tmp_path):
    base = tmp_path / "pipeline_registry"
    registry = ModelRegistry(base_path=str(base))
    pipe = RetrainingPipeline(registry=registry)

    # Insufficient snapshots branch.
    out = asyncio.run(pipe.execute("BTC", _snapshots(5), "NORMAL_MARKET"))
    assert out is None

    async def _train_stub(self, snapshots):
        self.upside_model.is_trained = True
        self.downside_model.is_trained = True

    monkeypatch.setattr(ProbabilityService, "train_on_window", _train_stub)

    model_id = asyncio.run(pipe.execute("BTC", _snapshots(22), "TRENDING_HIGH_VOL"))
    assert model_id is not None
    assert model_id in registry.models_meta
