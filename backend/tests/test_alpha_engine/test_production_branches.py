import asyncio
import csv
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import numpy as np

from src.alpha_engine.adaptive.weight_optimizer import WeightOptimizer
from src.alpha_engine.backtesting.data_loader import DataLoader
from src.alpha_engine.backtesting.strategy import Strategy
from src.alpha_engine.models.adaptive_models import OptimalWeights
from src.alpha_engine.models.adaptive_models import WalkForwardWindow
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.models.conviction_models import ConvictionComponent, ConvictionResult
from src.alpha_engine.probability.logistic_model import ProbabilisticModel


def _conviction(score: int, bias: str = "LONG") -> ConvictionResult:
    components = {
        "regime": ConvictionComponent(score=0.5, weight=0.2, description="r"),
        "liquidation": ConvictionComponent(score=0.5, weight=0.2, description="l"),
        "footprint": ConvictionComponent(score=0.5, weight=0.2, description="f"),
        "funding": ConvictionComponent(score=0.5, weight=0.2, description="fu"),
        "volatility": ConvictionComponent(score=0.5, weight=0.2, description="v"),
    }
    return ConvictionResult(
        symbol="BTC",
        bias=bias,
        score=score,
        confidence=0.7,
        components=components,
        explanation=["ok"],
        timestamp=1,
    )


def _snapshot(ts: datetime, price: float = 100.0) -> HistoricalMarketSnapshot:
    return HistoricalMarketSnapshot(
        timestamp=ts,
        price=price,
        funding_rate=0.0001,
        open_interest=1000.0,
        volume=250.0,
    )


def test_data_loader_csv_parses_nested_columns(tmp_path):
    csv_path = tmp_path / "history.csv"
    fields = [
        "timestamp",
        "price",
        "funding_rate",
        "open_interest",
        "volume",
        "liquidation_levels",
        "recent_trades",
        "book_bids",
        "book_asks",
    ]
    row = {
        "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
        "price": "100.5",
        "funding_rate": "0.0002",
        "open_interest": "1234.5",
        "volume": "987.6",
        "liquidation_levels": json.dumps([{"price": 101.0, "side": "SHORT", "notional": 25000.0}]),
        "recent_trades": json.dumps(
            [{"price": 100.5, "size": 12.0, "side": "BUY", "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat()}]
        ),
        "book_bids": json.dumps([[100.0, 10.0]]),
        "book_asks": json.dumps([[101.0, 8.0]]),
    }
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerow(row)

    snapshots = asyncio.run(DataLoader.load_from_csv(str(csv_path)))
    assert len(snapshots) == 1
    loaded = snapshots[0]
    assert loaded.price == 100.5
    assert loaded.open_interest == 1234.5
    assert loaded.liquidation_levels[0].side == "SHORT"
    assert loaded.recent_trades[0].side == "BUY"
    assert loaded.book_bids[0][0] == 100.0


def test_strategy_short_exit_and_hold_paths():
    strategy = Strategy()

    assert strategy.get_signal(_conviction(45, "SHORT"), "SHORT", 100.0, 101.0) == "CLOSE"
    assert strategy.get_signal(_conviction(30, "SHORT"), "SHORT", 100.0, 98.4) == "CLOSE"
    assert strategy.get_signal(_conviction(60, "LONG"), "SHORT", 100.0, 100.0) == "CLOSE"
    assert strategy.get_signal(_conviction(45, "SHORT"), "SHORT", 100.0, 99.8) == "HOLD"
    assert strategy.get_signal(_conviction(50, "LONG"), None, 0.0, 100.0) == "HOLD"


def test_probabilistic_model_signature_and_single_class_training(tmp_path, monkeypatch, caplog):
    model = ProbabilisticModel("unit")

    X = np.array([[0.0], [1.0], [2.0], [3.0]], dtype=float)
    y_single = np.array([1, 1, 1, 1], dtype=int)
    model.train(X, y_single)
    assert model.is_trained is False

    y_binary = np.array([0, 0, 1, 1], dtype=int)
    model.train(X, y_binary)
    assert model.is_trained is True

    monkeypatch.setenv("MODEL_REGISTRY_SIGNING_KEY", "secret-key")
    path = tmp_path / "prob.pkl"
    sig_path = tmp_path / "prob.pkl.sig"
    model.save(str(path))
    assert path.exists()
    assert sig_path.exists()

    sig_path.write_text("invalid", encoding="utf-8")
    with caplog.at_level("ERROR"):
        loaded = ProbabilisticModel("loaded")
        loaded.load(str(path))
    assert loaded.is_trained is False
    assert "invalid signature" in caplog.text

    blob = path.read_bytes()
    valid_sig = hmac.new(b"secret-key", blob, hashlib.sha256).hexdigest()
    sig_path.write_text(valid_sig, encoding="utf-8")
    loaded_ok = ProbabilisticModel("loaded_ok")
    loaded_ok.load(str(path))
    assert loaded_ok.is_trained is True


def test_weight_optimizer_evaluate_path(monkeypatch):
    from src.alpha_engine.adaptive import weight_optimizer as module

    class DummyRunner:
        def __init__(self, _symbol: str):
            self.rebuilder = type("Rebuilder", (), {"rebuild": staticmethod(lambda _sym, _snap: None)})()

        async def run_step(self, _snapshot):
            return _conviction(70)

    class DummyStrategy:
        def get_signal(self, _conviction_obj, _current_pos, _entry_price, _current_price):
            return "HOLD"

    class FakeMetrics:
        sharpe_ratio = 1.5
        max_drawdown = 0.2

    monkeypatch.setattr(module, "SignalRunner", DummyRunner)
    monkeypatch.setattr(module, "Strategy", DummyStrategy)
    monkeypatch.setattr(module.MetricsCalculator, "calculate", staticmethod(lambda *_args, **_kwargs: FakeMetrics()))

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    snapshots = [_snapshot(now), _snapshot(now + timedelta(minutes=1), price=100.2)]
    objective = asyncio.run(
        WeightOptimizer._evaluate("BTC", snapshots, (0.2, 0.2, 0.2, 0.2, 0.2))
    )
    assert objective == 1.4


def test_walkforward_runner_executes_full_cycle(monkeypatch):
    from src.alpha_engine.adaptive import walkforward_runner as module

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    window = WalkForwardWindow(
        train_start=now,
        train_end=now + timedelta(hours=1),
        test_start=now + timedelta(hours=1),
        test_end=now + timedelta(hours=2),
    )
    monkeypatch.setattr(module.WindowSplitter, "split", staticmethod(lambda *_args, **_kwargs: [window]))

    async def _optimize(_symbol, _train_data):
        return OptimalWeights(
            w_regime=0.2,
            w_liquidation=0.2,
            w_footprint=0.2,
            w_funding=0.2,
            w_volatility=0.2,
            sharpe_attained=1.0,
            timestamp=now,
        )

    class DummyRunner:
        def __init__(self, _symbol: str):
            pass

        async def run_step(self, _snapshot, weights=None):
            assert weights is not None
            return _conviction(80, "LONG")

    class DummyStrategy:
        def __init__(self):
            self._seen = False

        def get_signal(self, _conviction_obj, _current_pos, _entry_price, _current_price):
            if not self._seen:
                self._seen = True
                return "OPEN_LONG"
            return "CLOSE"

    monkeypatch.setattr(module.WeightOptimizer, "optimize", staticmethod(_optimize))
    monkeypatch.setattr(module, "SignalRunner", DummyRunner)
    monkeypatch.setattr(module, "Strategy", DummyStrategy)

    snapshots = [
        _snapshot(now + timedelta(minutes=10), price=100.0),
        _snapshot(now + timedelta(hours=1, minutes=10), price=101.0),
        _snapshot(now + timedelta(hours=1, minutes=30), price=101.5),
    ]
    report = asyncio.run(module.WalkForwardRunner.run("BTC", snapshots))

    assert report.symbol == "BTC"
    assert len(report.window_results) == 1
    assert report.window_results[0].weights.w_regime == 0.2
