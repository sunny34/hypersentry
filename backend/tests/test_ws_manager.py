import asyncio
import json

from src.ws_manager import manager


class FakeWebSocket:
    def __init__(self, fail_send=False):
        self.accepted = False
        self.messages = []
        self.fail_send = fail_send

    async def accept(self):
        self.accepted = True

    async def send_text(self, payload: str):
        if self.fail_send:
            raise RuntimeError("send failed")
        self.messages.append(payload)


def _reset_manager():
    manager.active_connections.clear()


def test_public_broadcast_reaches_all():
    _reset_manager()
    ws1 = FakeWebSocket()
    ws2 = FakeWebSocket()

    asyncio.run(manager.connect(ws1))
    asyncio.run(manager.connect(ws2))

    asyncio.run(manager.broadcast({"type": "alpha_conviction", "data": {"x": 1}}))

    assert len(ws1.messages) == 1
    assert len(ws2.messages) == 1


def test_private_broadcast_filtered_by_user():
    _reset_manager()
    ws1 = FakeWebSocket()
    ws2 = FakeWebSocket()

    asyncio.run(manager.connect(ws1))
    asyncio.run(manager.connect(ws2))
    manager.set_user(ws1, "u1")
    manager.set_user(ws2, "u2")

    asyncio.run(manager.broadcast({"type": "private_event", "data": {"a": 1}}, channel="private", user_id="u1"))

    assert len(ws1.messages) == 1
    assert len(ws2.messages) == 0


def test_agg_update_symbol_filtering():
    _reset_manager()
    ws1 = FakeWebSocket()
    ws2 = FakeWebSocket()

    asyncio.run(manager.connect(ws1))
    asyncio.run(manager.connect(ws2))
    manager.subscribe_symbol(ws1, "BTC")
    manager.subscribe_symbol(ws2, "ETH")

    packet = {"type": "agg_update", "data": {"BTC": {"p": 1}, "ETH": {"p": 2}}}
    asyncio.run(manager.broadcast(packet))

    msg1 = json.loads(ws1.messages[0])
    msg2 = json.loads(ws2.messages[0])
    assert set(msg1["data"].keys()) == {"BTC"}
    assert set(msg2["data"].keys()) == {"ETH"}


def test_symbol_helpers_track_membership():
    _reset_manager()
    ws = FakeWebSocket()

    asyncio.run(manager.connect(ws))
    manager.subscribe_symbol(ws, "btc")

    assert manager.is_symbol_subscribed(ws, "BTC") is True
    assert manager.get_symbols(ws) == {"BTC"}


def test_dead_connections_are_removed_on_broadcast_failure():
    _reset_manager()
    ws_ok = FakeWebSocket()
    ws_bad = FakeWebSocket(fail_send=True)

    asyncio.run(manager.connect(ws_ok))
    asyncio.run(manager.connect(ws_bad))

    asyncio.run(manager.broadcast({"type": "alpha_conviction", "data": {"x": 1}}))

    assert ws_bad not in manager.active_connections
    assert ws_ok in manager.active_connections


def test_disconnect_releases_symbol_subscriptions(monkeypatch):
    _reset_manager()
    ws = FakeWebSocket()
    asyncio.run(manager.connect(ws))
    manager.subscribe_symbol(ws, "BTC")
    manager.subscribe_symbol(ws, "ETH")

    released = []

    class _Agg:
        def unsubscribe(self, symbol, source="client"):
            released.append((symbol, source))
            return True

    monkeypatch.setattr("src.services.aggregator.aggregator", _Agg())
    manager.disconnect(ws)

    assert ws not in manager.active_connections
    assert sorted(sym for sym, _ in released) == ["BTC", "ETH"]
