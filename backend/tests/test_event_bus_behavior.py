import asyncio

from src.services.event_bus import event_bus
from src.services.event_relay import event_relay
from src.ws_manager import manager as ws_manager


def _drain_queue(q):
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except asyncio.QueueEmpty:
            break
    return out


def test_event_bus_publish_and_filtering():
    event_bus._reset_for_tests()
    sub_all = event_bus.subscribe()
    sub_alpha = event_bus.subscribe({"alpha_conviction"})

    asyncio.run(event_bus.publish("agg_update", {"BTC": {"price": 100}}, source="aggregator"))
    asyncio.run(event_bus.publish("alpha_conviction", {"symbol": "BTC", "score": 0.4}, source="alpha_engine"))

    all_events = _drain_queue(sub_all.queue)
    alpha_events = _drain_queue(sub_alpha.queue)

    assert [e.event_type for e in all_events] == ["agg_update", "alpha_conviction"]
    assert [e.event_type for e in alpha_events] == ["alpha_conviction"]
    assert all_events[0].seq == 1
    assert all_events[1].seq == 1

    event_bus.unsubscribe(sub_all)
    event_bus.unsubscribe(sub_alpha)


def test_event_relay_forwards_public_and_private(monkeypatch):
    event_bus._reset_for_tests()
    calls = []

    async def _fake_broadcast(message, channel="public", user_id=None):
        calls.append((message, channel, user_id))

    monkeypatch.setattr(ws_manager, "broadcast", _fake_broadcast)

    async def _run():
        await event_relay.stop()
        await event_relay.start()
        await event_bus.publish("agg_update", {"BTC": {"price": 100}}, source="aggregator", channel="public")
        await event_bus.publish(
            "execution_event",
            {"status": "ok", "order_id": "abc"},
            source="execution",
            channel="private",
            user_id="u-1",
        )
        await event_bus.publish("intel_alpha", [{"id": "x1"}], source="intel_engine", channel="public")
        await asyncio.sleep(0.05)
        await event_relay.stop()

    asyncio.run(_run())

    assert len(calls) >= 3
    assert calls[0][0]["type"] == "agg_update"
    assert calls[0][1] == "public"
    assert calls[1][0]["type"] == "execution_event"
    assert calls[1][1] == "private"
    assert calls[1][2] == "u-1"
    assert calls[2][0]["type"] == "intel_alpha"
    assert isinstance(calls[2][0]["data"], list)


def test_event_bus_backend_switch_kafka_with_safe_fallback():
    event_bus._reset_for_tests()

    async def _run():
        await event_relay.stop()
        await event_bus.stop()

        # Kafka backend is optional; startup must not crash even when aiokafka/broker is unavailable.
        await event_bus.use_backend("kafka")
        await event_bus.start()
        await event_bus.publish("alpha_conviction", {"symbol": "BTC", "score": 0.2}, source="alpha_engine")

        stats_kafka = event_bus.stats()
        assert stats_kafka["backend"]["configured"] == "kafka"
        assert stats_kafka["published_count"] >= 1

        await event_bus.stop()
        await event_bus.use_backend("inproc")
        await event_bus.start()
        stats_inproc = event_bus.stats()
        assert stats_inproc["backend"]["configured"] == "inproc"

        await event_bus.stop()

    asyncio.run(_run())
