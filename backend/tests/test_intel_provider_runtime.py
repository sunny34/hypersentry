import asyncio

from src.intel.providers.microstructure import MicrostructureProvider


def test_microstructure_init_without_running_loop():
    provider = MicrostructureProvider()
    assert provider._init_task is None


def test_fetch_latest_handles_symbol_missing_state(monkeypatch):
    provider = MicrostructureProvider()
    provider.active_symbols = {"BTC", "LINK"}
    provider.states = {"BTC": provider._create_empty_state()}

    async def _fake_meta(_session):
        return {
            "BTC": {"price": 100.0, "oi": 1.0},
            "LINK": {"price": 20.0, "oi": 2.0},
        }

    seen = []

    async def _fake_update(_session, symbol, market_data, _use_ext):
        seen.append((symbol, market_data is not None))
        return []

    monkeypatch.setattr(provider, "_fetch_hl_meta", _fake_meta)
    monkeypatch.setattr(provider, "_update_symbol_state", _fake_update)

    out = asyncio.run(provider.fetch_latest())

    assert out == []
    assert "LINK" in provider.states
    assert sorted(seen) == [("BTC", True), ("LINK", True)]
