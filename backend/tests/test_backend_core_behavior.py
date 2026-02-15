import asyncio
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from telegram.error import NetworkError

import src.agents.debate as debate_module
from src.agents.debate import DebateAgent, MultiAgentDebate
from src.backtesting import Backtester
import src.client_wrapper as client_wrapper
from src.execution import ArbExecutor
from src.notifications import TelegramBot
from src.security import decrypt_secret, encrypt_secret
from src.services.aggregator import DataAggregator


def _candles(n: int = 120):
    base = int(datetime.now(timezone.utc).timestamp() * 1000)
    out = []
    for i in range(n):
        px = 100.0 + (i * 0.2)
        out.append(
            {
                "t": base + (i * 60_000),
                "o": str(px - 0.1),
                "h": str(px + 0.2),
                "l": str(px - 0.3),
                "c": str(px),
                "v": str(1000 + i),
            }
        )
    return out


class _FakeClient:
    def __init__(self, candles=None):
        self._candles = candles if candles is not None else _candles(120)

    def get_candles(self, **_kwargs):
        return self._candles


def test_debate_agent_fallback(monkeypatch):
    monkeypatch.setattr(debate_module.config, "GEMINI_API_KEY", "")
    agent = DebateAgent("Bull", "Analyst", "Persona")
    out = asyncio.run(agent.argue("context"))
    assert "text" in out and "evidence" in out


def test_multi_agent_debate_transcript_structure():
    engine = MultiAgentDebate()

    async def _argue(_context, _opponent_argument=None):
        return {"text": "x", "evidence": "y"}

    engine.bull.argue = _argue
    engine.bear.argue = _argue

    transcript = asyncio.run(engine.run_debate("BTC", "ctx"))
    assert len(transcript) == 3
    assert transcript[0]["agent"] == "bull"
    assert transcript[1]["agent"] == "bear"


def test_backtester_fetch_and_strategies(monkeypatch):
    bt = Backtester(_FakeClient())
    df = bt.fetch_historical_data("BTC", "1h", days=1)
    assert isinstance(df, pd.DataFrame)
    assert not df.empty

    rsi = bt.run_rsi_strategy("BTC", interval="1h")
    mom = bt.run_momentum_strategy("BTC", interval="1h")
    liq = bt.run_liquidation_sniping("BTC", current_price=100)

    assert set(["pnl", "winRate", "trades", "equityCurve", "recommendation"]).issubset(rsi.keys())
    assert set(["pnl", "winRate", "trades", "equityCurve", "recommendation"]).issubset(mom.keys())
    assert set(["pnl", "winRate", "trades", "equityCurve", "recommendation"]).issubset(liq.keys())

    monkeypatch.setattr(np.random, "normal", lambda *_args, **_kwargs: 0.0)
    arb = bt.run_funding_arb("BTC", 0.0003)
    assert arb["recommendation"] == "short"


def test_backtester_empty_data_error_paths():
    bt = Backtester(_FakeClient(candles=[]))
    assert bt.run_rsi_strategy("BTC")["error"] == "No data"
    assert bt.run_momentum_strategy("BTC")["error"] == "No data"
    assert bt.run_liquidation_sniping("BTC", 100)["error"] == "No data"


def test_client_wrapper_read_only_and_mark_price(monkeypatch):
    class _Info:
        def __init__(self, *_args, **_kwargs):
            pass

        def all_mids(self):
            return {"BTC": "50000"}

        def meta_and_asset_ctxs(self):
            return [{"universe": [{"name": "ETH"}]}, [{"markPx": "3000"}]]

        def user_state(self, _addr):
            return {"ok": True}

        def open_orders(self, _addr):
            return []

        def l2_snapshot(self, _coin):
            return {"levels": []}

        def candles_snapshot(self, *_args, **_kwargs):
            return []

    class _Exchange:
        def __init__(self, *_args, **_kwargs):
            pass

        def market_open(self, *_args, **_kwargs):
            return {"status": "ok"}

    monkeypatch.setattr(client_wrapper, "Info", _Info)
    monkeypatch.setattr(client_wrapper, "Exchange", _Exchange)
    monkeypatch.setattr(client_wrapper.constants, "MAINNET_API_URL", "https://example")
    monkeypatch.setattr(client_wrapper.config, "HL_PRIVATE_KEY", "invalid")
    monkeypatch.setattr(client_wrapper.config, "HL_ACCOUNT_ADDRESS", "0xabc")

    c = client_wrapper.HyperliquidClient()
    assert c.exchange is None

    monkeypatch.setattr(client_wrapper.config, "HL_PRIVATE_KEY", "0x" + ("a" * 64))
    monkeypatch.setattr(
        client_wrapper.eth_account.Account,
        "from_key",
        lambda _k: object(),
    )
    c2 = client_wrapper.HyperliquidClient()
    assert c2.exchange is None
    assert c2.market_open("BTC", True, 0.1)["status"] == "ok"
    assert c2.exchange is not None
    assert asyncio.run(c2.get_mark_price("BTC")) == 50000.0
    assert asyncio.run(c2.get_mark_price("ETH")) == 3000.0


def test_security_encrypt_decrypt_roundtrip():
    secret = "my-secret"
    enc = encrypt_secret(secret)
    dec = decrypt_secret(enc)
    assert dec == secret


def test_telegram_bot_message_paths(monkeypatch):
    bot = TelegramBot()
    bot.bot = None
    bot.chat_id = ""
    assert asyncio.run(bot.send_message("hello")) is None

    class _FakeTG:
        def __init__(self):
            self.calls = 0

        async def send_message(self, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise NetworkError("timeout")
            return {"ok": True}

    fake = _FakeTG()
    bot.bot = fake
    bot.chat_id = "123"
    asyncio.run(bot.send_message("hello"))
    assert fake.calls >= 2


def test_arb_executor_status_paths(monkeypatch):
    class _DB:
        def __init__(self):
            self.added = []
            self.commits = 0

        def add(self, obj):
            self.added.append(obj)

        def commit(self):
            self.commits += 1

        def query(self, _model):
            return SimpleNamespace(filter=lambda *_a, **_k: SimpleNamespace(all=lambda: []))

    db = _DB()
    ex = ArbExecutor(db)

    # Missing keys path.
    async def _no_keys(_user_id):
        return None, None

    monkeypatch.setattr(ex, "get_user_keys", _no_keys)
    out = asyncio.run(ex.execute_arb("u1", "BTC", 1000, "Long HL / Short Binance"))
    assert out["status"] == "error"

    class _K(SimpleNamespace):
        pass

    async def _keys(_user_id):
        return _K(api_secret_enc="hl", api_key_enc="k"), _K(api_secret_enc="bs", api_key_enc="bk")

    monkeypatch.setattr(ex, "get_user_keys", _keys)
    monkeypatch.setattr("src.execution.decrypt_secret", lambda x: ("a" * 64) if x == "hl" else "k")
    monkeypatch.setattr("src.execution.Account.from_key", lambda _k: object())

    async def _hl(*_args, **_kwargs):
        return {"status": "simulated", "price": 100}

    async def _bin(*_args, **_kwargs):
        return {"status": "simulated", "price": 100}

    monkeypatch.setattr(ex, "_execute_hl", _hl)
    monkeypatch.setattr(ex, "_execute_binance", _bin)

    out2 = asyncio.run(ex.execute_arb("u1", "BTC", 1000, "Long HL / Short Binance"))
    assert out2["status"] == "simulated"
    assert db.added == []

    async def _hl_exec(*_args, **_kwargs):
        return {"status": "executed", "price": 100}

    async def _bin_exec(*_args, **_kwargs):
        return {"status": "executed", "price": 101}

    monkeypatch.setattr(ex, "_execute_hl", _hl_exec)
    monkeypatch.setattr(ex, "_execute_binance", _bin_exec)

    out3 = asyncio.run(ex.execute_arb("u1", "BTC", 1000, "Long HL / Short Binance"))
    assert out3["status"] == "executed"
    assert len(db.added) == 1


def test_aggregator_detect_walls_and_cache(monkeypatch):
    agg = DataAggregator()
    agg.data_cache = {}
    agg.is_running = True
    agg.alpha_update_queue = asyncio.Queue(maxsize=10)

    levels = [
        [{"px": "100", "sz": "1"}, {"px": "99", "sz": "80"}],
        [{"px": "101", "sz": "1"}, {"px": "102", "sz": "90"}],
    ]
    walls = agg._detect_walls(levels)
    assert isinstance(walls, list)
    agg._update_cache("BTC", "price", 100.0)
    assert "BTC" in agg.data_cache
    assert agg.alpha_update_queue.qsize() == 1


def test_aggregator_subscription_lifecycle():
    agg = DataAggregator()
    agg.subscriptions = set()
    agg.active_subs = set()
    agg.system_symbols = set()
    agg.client_refcounts = {}
    agg.data_cache = {}
    agg.cvd_data = {}
    agg.max_subscriptions = 2
    agg._ws = None

    assert agg.subscribe("btc", source="system") is True
    assert agg.subscribe("eth", source="client") is True
    assert agg.client_refcounts["ETH"] == 1

    # Rejected because of max_subscriptions limit.
    assert agg.subscribe("sol", source="client") is False

    # Client unsubscribe should remove ETH entirely (not a system symbol).
    assert agg.unsubscribe("ETH", source="client") is True
    assert "ETH" not in agg.subscriptions

    # System symbol remains even if a client tries to unsubscribe.
    assert agg.unsubscribe("BTC", source="client") is False
    assert "BTC" in agg.subscriptions


def test_aggregator_external_composition_paths():
    agg = DataAggregator()
    agg.external_metrics = {}
    agg.data_cache = {"BTC": {"price": 100.0, "oi": 1000.0}}
    agg.external_source_ttl_ms = 10_000
    agg.cvd_weight_binance = 0.7
    agg.cvd_weight_coinbase = 0.3
    agg.oi_weight_hl = 0.6
    agg.oi_weight_binance = 0.4

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    metrics = agg._ensure_external_symbol("BTC")
    metrics["bin_spot_1m"] = 200.0
    metrics["bin_spot_5m"] = 500.0
    metrics["bin_spot_ts"] = now_ms
    metrics["cb_spot_1m"] = 100.0
    metrics["cb_spot_5m"] = 300.0
    metrics["cb_spot_ts"] = now_ms
    metrics["bin_perp_oi_usd"] = 2500.0
    metrics["bin_perp_oi_ts"] = now_ms

    cvd = agg._build_external_cvd_payload("BTC", now_ms=now_ms)
    assert cvd["cvd_source"] == "spot_composite"
    assert cvd["cvd_spot_composite_1m"] == pytest.approx(170.0)
    assert cvd["cvd_spot_composite_5m"] == pytest.approx(440.0)

    oi = agg._build_external_oi_payload("BTC", hl_oi=1000.0, now_ms=now_ms)
    assert oi["open_interest_source"] == "composite"
    assert oi["open_interest"] == pytest.approx(1600.0)
    assert oi["open_interest_binance_perp"] == 2500.0

    # Stale external data should not override source.
    stale = agg._build_external_oi_payload("BTC", hl_oi=900.0, now_ms=now_ms + 30_000)
    assert stale["open_interest_source"] == "hl"
    assert stale["open_interest"] == 900.0


def test_aggregator_rate_limit_helpers():
    agg = DataAggregator()

    class _RateLimitedExc(Exception):
        status = 429

    assert agg._is_rate_limit_error(_RateLimitedExc("rate limited"))
    assert agg._is_upstream_rate_limited_error(_RateLimitedExc("rate limited"))
    assert agg._is_upstream_rate_limited_error(Exception("WSServerHandshakeError: 429 invalid response status"))


def test_aggregator_symbols_refresh_respects_rate_limit_cooldown():
    agg = DataAggregator()
    agg.available_symbols_cache = [{"symbol": "BTC", "day_ntl_vlm": 123.0}]
    agg._symbols_refresh_retry_after_ts = time.time() + 10
    rows = asyncio.run(agg.refresh_available_symbols(force=True))
    assert rows == [{"symbol": "BTC", "day_ntl_vlm": 123.0}]


def test_aggregator_stop_cleans_up_runtime_tasks():
    class _FakeWs:
        def __init__(self):
            self.closed = False

        async def close(self):
            self.closed = True

    async def _run():
        agg = DataAggregator()
        agg.is_running = True
        agg.alpha_update_queue = asyncio.Queue(maxsize=10)
        agg.alpha_update_queue.put_nowait(("BTC", {"price": 100.0}))
        ws = _FakeWs()
        agg._ws = ws

        # Simulate running background tasks.
        agg.alpha_workers = [asyncio.create_task(asyncio.sleep(60))]
        agg._ws_task = asyncio.create_task(asyncio.sleep(60))
        agg._broadcast_task = asyncio.create_task(asyncio.sleep(60))
        agg._external_task = asyncio.create_task(asyncio.sleep(60))

        await agg.stop()

        assert agg.is_running is False
        assert ws.closed is True
        assert agg._ws is None
        assert agg.alpha_workers == []
        assert agg._ws_task is None
        assert agg._broadcast_task is None
        assert agg._external_task is None
        assert agg.alpha_update_queue.empty() is True

    asyncio.run(_run())
