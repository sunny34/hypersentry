import asyncio
import time
from types import SimpleNamespace

from src.strategies.hypurrscan import HypurrScan
from src.strategies.passive_wall_detector import PassiveWallDetector
from src.strategies.bridge_monitor import BridgeMonitor
from src.strategies.copy_trader import CopyTrader
from src.strategies.twap_detector import TwapDetector
from src.strategies.whale_tracker import WhaleTracker, WhaleProfile, WhalePosition


class _Notifier:
    def __init__(self):
        self.messages = []

    async def send_message(self, message, chat_id=None):
        self.messages.append((message, chat_id))

    async def send_order_alert(self, symbol, size, side):
        self.messages.append((f"{symbol}:{size}:{side}", None))


def test_hypurrscan_active_twaps(monkeypatch):
    hs = HypurrScan()

    class _Resp:
        status = 200

        async def json(self):
            return [
                {"action": {"type": "twapOrder"}, "ended": None},
                {"action": {"type": "twapOrder"}, "ended": 1},
                {"action": {"type": "other"}, "ended": None},
            ]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

    class _Session:
        closed = False

        def get(self, _url):
            return _Resp()

        async def close(self):
            return None

    hs.session = _Session()
    out = asyncio.run(hs.get_active_twaps("BTC"))
    assert len(out) == 1


def test_passive_wall_detector_fetch_token(monkeypatch):
    d = PassiveWallDetector()

    async def _ext(_session, _token):
        return []

    async def _hl(_session, _token):
        return [{"px": 100.0, "sz": 20_000.0, "side": "buy", "ex": "Hyperliquid"}]

    async def _session():
        return object()

    monkeypatch.setattr(d, "_fetch_deep_walls_external", _ext)
    monkeypatch.setattr(d, "_fetch_hl_l2", _hl)
    monkeypatch.setattr(d, "_get_session", _session)

    asyncio.run(d._fetch_token_walls("btc"))
    out = d.get_walls("BTC")
    assert out["walls"]
    assert out["intelligence"]["bias"] in {"bullish", "neutral", "bearish"}


def test_bridge_monitor_processing(monkeypatch):
    notifier = _Notifier()
    bm = BridgeMonitor(notifier=notifier, min_amount_usd=1000)

    bridges = [
        {
            "hash": "h1",
            "user": "0xabcdef123456",
            "time": int(time.time() * 1000),
            "action": {"type": "deposit", "amount": 5000},
        },
        {
            "hash": "h2",
            "user": "0xabcdef123456",
            "time": int(time.time() * 1000),
            "action": {"type": "withdraw", "amount": 99999},
        },
    ]

    asyncio.run(bm.process_bridges(bridges))
    assert len(bm.get_recent_bridges()) == 1
    assert len(notifier.messages) == 1
    stats = bm.get_stats()
    assert stats["total_seen"] >= 1


def test_copy_trader_sync_and_updates(monkeypatch):
    notifier = _Notifier()

    class _Client:
        def __init__(self):
            self.calls = 0

        def get_user_state(self, _addr):
            self.calls += 1
            if self.calls == 1:
                return {"assetPositions": [{"position": {"coin": "BTC", "szi": "1.0"}}]}
            return {"assetPositions": [{"position": {"coin": "BTC", "szi": "2.0"}}]}

        @property
        def info(self):
            return SimpleNamespace(user_fills=lambda _addr: [])

    class _DB:
        def query(self, *_args, **_kwargs):
            return SimpleNamespace(join=lambda *_a, **_k: SimpleNamespace(filter=lambda *_x, **_y: SimpleNamespace(all=lambda: [(SimpleNamespace(address="0x1"), SimpleNamespace(email="u", telegram_chat_id="1"))])))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr("src.strategies.copy_trader.get_db_session", lambda: _DB())

    trader = CopyTrader(_Client(), notifier, "0xwallet", active_trading=False)
    assert asyncio.run(trader.sync_positions()) is True
    assert trader.known_positions["BTC"] == 1.0

    asyncio.run(trader.check_updates())
    assert trader.known_positions["BTC"] == 2.0
    assert notifier.messages


def test_twap_detector_summary_and_history():
    d = TwapDetector(_Notifier())
    d.active_twaps = {
        "BTC": [
            {"size_usd": 20000, "is_buy": True},
            {"size_usd": 5000, "is_buy": False},
        ]
    }
    d._update_history()

    hist = d.get_history("BTC")
    assert len(hist) == 1

    summary = d.get_all_tokens_summary()
    assert summary and summary[0]["token"] == "BTC"


def test_twap_detector_alert_path(monkeypatch):
    notifier = _Notifier()
    d = TwapDetector(notifier)
    d.watched_tokens = {"BTC"}
    d.min_size_usd = 1000

    class _DB:
        def query(self, *_args, **_kwargs):
            return SimpleNamespace(join=lambda *_a, **_k: SimpleNamespace(filter=lambda *_x, **_y: SimpleNamespace(all=lambda: [(SimpleNamespace(id="u1", email="e", telegram_chat_id="1"), SimpleNamespace())])))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr("src.strategies.twap_detector.get_db_session", lambda: _DB())

    entry = {
        "token": "BTC",
        "hash": "h1",
        "size_usd": 5000,
        "is_buy": True,
        "reduce_only": False,
        "duration_mins": 30,
        "user": "0xabc",
    }
    asyncio.run(d._maybe_alert(entry))
    assert "h1" in d.seen_hashes
    assert notifier.messages


def test_whale_tracker_detect_changes_and_summary(monkeypatch):
    wt = WhaleTracker(min_notional=100)
    whale = WhaleProfile(address="0xabc", rank=1, label="Top")
    whale.positions = {
        "BTC": WhalePosition("BTC", size=1.0, entry_px=100, unrealized_pnl=10, leverage=2, side="long")
    }

    captured = []
    monkeypatch.setattr(wt, "_emit_alert", lambda alert: captured.append(alert.to_dict()))

    current = {
        "BTC": WhalePosition("BTC", size=2.0, entry_px=110, unrealized_pnl=20, leverage=2, side="long"),
        "ETH": WhalePosition("ETH", size=1.0, entry_px=200, unrealized_pnl=0, leverage=1, side="short"),
    }
    wt._detect_changes(whale, current)
    assert captured

    whale.positions = current
    wt.whales[whale.address] = whale
    positions = wt.get_whale_positions()
    assert positions
    summary = wt.get_whale_summary("BTC")
    assert "biasLabel" in summary


def test_whale_tracker_stats_initialized_flag():
    wt = WhaleTracker()
    stats = wt.get_stats()
    assert stats["initialized"] is False
