import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException, Response
from eth_account import Account
from eth_account.messages import encode_defunct

from schemas import (
    AddWalletRequest,
    BacktestRequest,
    KeyInput,
    TwapConfigRequest,
    TwapRequest,
    UpdateProfileRequest,
    WalletChallengeRequest,
    WalletVerifyRequest,
)

import src.routers.auth as r_auth
import src.routers.backtest as r_backtest
import src.routers.bridges as r_bridges
import src.routers.settings as r_settings
import src.routers.wallets as r_wallets
import src.routers.twap as r_twap
import src.routers.market as r_market
import src.routers.intel as r_intel
import src.routers.trading as r_trading
from src.intel.providers.polymarket import PolymarketProvider
from src.intel.providers.microstructure import MicrostructureProvider


class _BG:
    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *args):
        self.tasks.append((fn, args))


class _Q:
    def __init__(self, items=None, first=None, count=0):
        self._items = items if items is not None else []
        self._first = first
        self._count = count

    def filter(self, *_a, **_k):
        return self

    def join(self, *_a, **_k):
        return self

    def all(self):
        return self._items

    def first(self):
        return self._first

    def delete(self, *_a, **_k):
        return 1 if self._first is not None else 0

    def update(self, *_a, **_k):
        return 1

    def order_by(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def count(self):
        return self._count


class _DB:
    def __init__(self, query_map=None):
        self.query_map = query_map if query_map is not None else []
        self.added = []
        self.deleted = []
        self.commits = 0

    def query(self, *_args, **_kwargs):
        if self.query_map:
            return self.query_map.pop(0)
        return _Q([])

    def add(self, obj):
        self.added.append(obj)

    def delete(self, obj):
        self.deleted.append(obj)

    def commit(self):
        self.commits += 1

    def refresh(self, _obj):
        return None


class _Resp:
    def __init__(self, status=200, payload=None):
        self.status = status
        self.status_code = status
        self._payload = payload if payload is not None else {}
        self.headers = {"content-type": "application/json"}

    async def json(self):
        return self._payload

    async def text(self):
        return json.dumps(self._payload)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


def _req(state):
    return SimpleNamespace(app=SimpleNamespace(state=state))


def test_auth_router_flows(monkeypatch):
    monkeypatch.setattr(r_auth, "GOOGLE_CLIENT_ID", "")
    assert asyncio.run(r_auth.google_login()) == {"error": "Google OAuth not configured"}

    monkeypatch.setattr(r_auth, "GOOGLE_CLIENT_ID", "x")
    monkeypatch.setattr(r_auth, "get_google_auth_url", lambda cb: f"https://oauth/{cb}")
    out = asyncio.run(r_auth.google_login("http://cb"))
    assert "auth_url" in out

    user = SimpleNamespace(id="u1", telegram_chat_id=None, to_dict=lambda: {"id": "u1"})
    db = _DB()

    async def _exchange(_code, _uri):
        return {"email": "e", "name": "n", "picture": "p", "id": "gid"}

    monkeypatch.setattr(r_auth, "exchange_google_code", _exchange)
    monkeypatch.setattr(r_auth, "get_or_create_user", lambda **_k: user)
    monkeypatch.setattr(r_auth, "create_access_token", lambda data: "tok")

    cb = asyncio.run(r_auth.google_callback(code="abc", redirect_uri=None, db=db))
    assert cb["token"] == "tok"

    # Wallet challenge + verify flow
    acct = Account.create()
    wallet_addr = acct.address

    challenge_db = _DB(query_map=[_Q()])
    challenge = asyncio.run(
        r_auth.wallet_challenge(
            WalletChallengeRequest(address=wallet_addr, chain_id=42161),
            db=challenge_db,
        )
    )
    assert challenge["auth_type"] == "wallet"
    assert challenge["nonce"]
    stored_challenge = challenge_db.added[-1]
    assert stored_challenge.address == wallet_addr.lower()
    assert stored_challenge.used is False

    sign_msg = r_auth._build_wallet_signin_message(
        address=wallet_addr.lower(),
        nonce=stored_challenge.nonce,
        chain_id=stored_challenge.chain_id,
        issued_at=stored_challenge.issued_at,
        expires_at=stored_challenge.expires_at,
    )
    signature = Account.sign_message(encode_defunct(text=sign_msg), acct.key).signature.hex()

    verify_db = _DB(query_map=[_Q(first=stored_challenge), _Q(first=None)])
    monkeypatch.setattr(r_auth, "create_access_token", lambda data: "wallet_tok")
    wallet_user = SimpleNamespace(
        id="wu1",
        to_dict=lambda: {"id": "wu1", "provider": "wallet"},
    )
    monkeypatch.setattr(r_auth, "_get_or_create_wallet_user", lambda _db, _a: wallet_user)

    verified = asyncio.run(
        r_auth.wallet_verify(
            WalletVerifyRequest(
                address=wallet_addr,
                nonce=stored_challenge.nonce,
                signature=signature,
            ),
            db=verify_db,
        )
    )
    assert verified["token"] == "wallet_tok"
    assert stored_challenge.used is True

    upd = asyncio.run(r_auth.update_profile(UpdateProfileRequest(telegram_chat_id="123"), user=user, db=db))
    assert upd["status"] == "updated"
    assert asyncio.run(r_auth.logout(user=user))["status"] == "logged_out"


def test_backtest_router_dispatch(monkeypatch):
    class _BT:
        def __init__(self, _c):
            pass

        def run_rsi_strategy(self, **_k):
            return {"kind": "rsi"}

        def run_momentum_strategy(self, **_k):
            return {"kind": "momentum"}

        def run_liquidation_sniping(self, *_a, **_k):
            return {"kind": "liq"}

        def run_funding_arb(self, *_a, **_k):
            return {"kind": "fund"}

    monkeypatch.setattr("src.backtesting.Backtester", _BT)
    r_backtest.manager.client = object()

    assert asyncio.run(r_backtest.run_backtest(BacktestRequest(strategy="rsi", token="BTC", params={})))["kind"] == "rsi"
    assert asyncio.run(r_backtest.run_backtest(BacktestRequest(strategy="momentum", token="BTC", params={})))["kind"] == "momentum"
    assert asyncio.run(r_backtest.run_backtest(BacktestRequest(strategy="liquidation", token="BTC", params={})))["kind"] == "liq"
    assert asyncio.run(r_backtest.run_backtest(BacktestRequest(strategy="funding", token="BTC", params={"fundingRate": 0.001})))["kind"] == "fund"
    assert asyncio.run(r_backtest.run_backtest(BacktestRequest(strategy="unknown", token="BTC", params={}))) == {"error": "Unknown strategy"}


def test_bridges_router(monkeypatch):
    bm = SimpleNamespace(
        get_recent_bridges=lambda limit: [{"hash": "h"}][:limit],
        get_stats=lambda: {"ok": True},
        set_threshold=lambda _x: None,
    )
    req = _req(SimpleNamespace(bridge_monitor=bm))
    user = SimpleNamespace()
    assert asyncio.run(r_bridges.get_recent_bridges(req, limit=1))["count"] == 1
    assert asyncio.run(r_bridges.get_bridge_stats(req))["ok"] is True
    assert asyncio.run(r_bridges.update_bridge_config(req, threshold=1000, user=user))["status"] == "updated"


def test_settings_router(monkeypatch):
    user = SimpleNamespace(id="u1")

    # Invalid HL key validation path
    bad = asyncio.run(
        r_settings.add_api_key(
            KeyInput(exchange="hyperliquid", api_key="k", api_secret="bad", label="x"),
            user=user,
            db=_DB(),
        )
    )
    assert isinstance(bad, Response)
    assert bad.status_code == 400

    # Create path
    db = _DB(query_map=[_Q(first=None)])
    monkeypatch.setattr(r_settings, "encrypt_secret", lambda s: f"enc:{s}")
    out = asyncio.run(
        r_settings.add_api_key(
            KeyInput(exchange="binance", api_key="k", api_secret="s", label="lab"),
            user=user,
            db=db,
        )
    )
    assert out["status"] == "created"

    # List keys path
    key = SimpleNamespace(id="k1", exchange="binance", key_name="main", api_key_enc="x", created_at=None)
    db2 = _DB(query_map=[_Q(items=[key])])
    monkeypatch.setattr(r_settings, "decrypt_secret", lambda _x: "ABCD1234")
    keys = asyncio.run(r_settings.get_api_keys(user=user, db=db2))
    assert keys["keys"][0]["api_key_masked"].endswith("1234")

    # Delete path
    db3 = _DB(query_map=[_Q(first=None)])
    nf = asyncio.run(r_settings.delete_api_key("id1", user=user, db=db3))
    assert isinstance(nf, Response) and nf.status_code == 404


def test_wallets_router(monkeypatch):
    user = SimpleNamespace(id="u1", is_admin=False)
    admin = SimpleNamespace(id="u2", is_admin=True)

    wallet = SimpleNamespace(to_dict=lambda: {"address": "0x1"})
    db_user = _DB(query_map=[_Q(items=[wallet])])
    db_admin = _DB(query_map=[_Q(items=[wallet])])
    assert r_wallets.list_wallets(user=user, db=db_user)["wallets"][0]["address"] == "0x1"
    assert r_wallets.list_wallets(user=admin, db=db_admin)["wallets"][0]["address"] == "0x1"

    # add existing
    db_exists = _DB(query_map=[_Q(first=SimpleNamespace())])
    bg = _BG()
    out_exists = asyncio.run(r_wallets.add_wallet(AddWalletRequest(address="0xabc", label="L", active_trading=False), bg, user, db_exists))
    assert out_exists["status"] == "exists"

    # add new
    db_new = _DB(query_map=[_Q(first=None)])
    fake_mgr = SimpleNamespace(start_copy_trader=lambda *_a: None)
    monkeypatch.setattr(r_wallets, "TraderManager", lambda: fake_mgr)
    bg2 = _BG()
    out_new = asyncio.run(r_wallets.add_wallet(AddWalletRequest(address="0xabc", label="L", active_trading=True), bg2, user, db_new))
    assert out_new["status"] == "added"
    assert len(bg2.tasks) == 1

    # remove
    db_rm_nf = _DB(query_map=[_Q(first=None)])
    assert asyncio.run(r_wallets.remove_wallet("0xabc", user=user, db=db_rm_nf))["status"] == "not_found"

    wobj = SimpleNamespace(address="0xabc")
    db_rm = _DB(query_map=[_Q(first=wobj)])

    class _Mgr:
        async def stop_copy_trader(self, _addr):
            return None

    monkeypatch.setattr(r_wallets, "TraderManager", lambda: _Mgr())
    assert asyncio.run(r_wallets.remove_wallet("0xabc", user=user, db=db_rm))["status"] == "removed"

    # csv upload
    class _UF:
        async def read(self):
            return b"0x11111111111111111111,label1\n0x22222222222222222222,label2"

    db_csv = _DB(query_map=[_Q(first=None), _Q(first=None)])
    bg_csv = _BG()
    monkeypatch.setattr(r_wallets, "TraderManager", lambda: fake_mgr)
    csv_out = asyncio.run(r_wallets.upload_csv(_UF(), bg_csv, user, db_csv))
    assert csv_out["status"] == "imported"


def test_twap_router(monkeypatch):
    fake_detector = SimpleNamespace(
        active_twaps={"BTC": [{"action": {"twap": {"s": 1000, "b": True, "m": 30, "t": True, "r": False}}, "size_usd": 1000, "user": "0x", "hash": "h", "time": 1}]},
        all_active_twaps=[{"token": "BTC"}],
        add_token=lambda _t: None,
        get_history=lambda _t: [{"x": 1}],
        get_active_users=lambda _t: {"buyers": [{"size": 10}], "sellers": []},
        get_all_tokens_summary=lambda: [{"token": "BTC", "buy_volume": 10, "sell_volume": 1}],
        scan_once=lambda: asyncio.sleep(0, result={"BTC": [{"x": 1}]})
    )
    monkeypatch.setattr(r_twap, "manager", SimpleNamespace(twap_detector=fake_detector))

    user = SimpleNamespace(id="u1", is_admin=False)
    db = _DB(query_map=[_Q(items=[SimpleNamespace(token="BTC", min_size=5000)]), _Q(items=[SimpleNamespace(token="BTC", min_size=5000)])])

    assert asyncio.run(r_twap.get_twaps(user=user, db=db))["tokens"] == ["BTC"]
    active = asyncio.run(r_twap.get_active_twaps(user=user, db=_DB(query_map=[_Q(items=[SimpleNamespace(token="BTC", min_size=5000)])]), show_all=False))
    assert active["twaps"]

    add_db = _DB(query_map=[_Q(first=None)])
    assert asyncio.run(r_twap.add_twap(TwapRequest(token="BTC"), user=user, db=add_db))["status"] == "added"
    assert asyncio.run(r_twap.update_twap_config(TwapConfigRequest(min_size=1234), user=user, db=_DB()))["status"] == "updated"
    assert asyncio.run(r_twap.remove_twap("BTC", user=user, db=_DB(query_map=[_Q(first=SimpleNamespace())])))["status"] == "removed"

    assert asyncio.run(r_twap.get_twap_history("BTC", user=user))["count"] == 1
    assert asyncio.run(r_twap.get_twap_users("BTC", user=user))["total_buyers"] == 1
    assert asyncio.run(r_twap.get_twap_summary(user=user))["tokens"]
    assert asyncio.run(r_twap.get_public_twap_data("BTC"))["summary"]["active_count"] >= 1
    assert asyncio.run(r_twap.get_all_twaps())["total_count"] >= 1
    assert asyncio.run(r_twap.trigger_scan())["status"] == "scanned"


def test_market_router(monkeypatch):
    # cache fast paths
    r_market._liquidations_cache = {"data": [{"coin": "BTC", "time": 1}], "symbol": "BTC", "timestamp": 9999999999}
    out = asyncio.run(r_market.get_liquidations(_req(SimpleNamespace(session=None)), coin="BTC", limit=1))
    assert len(out) == 1

    # aggregator-backed liquidation path (no synthetic placeholder data)
    r_market._liquidations_cache = {"data": None, "symbol": None, "timestamp": 0}
    agg = SimpleNamespace(
        data_cache={
            "BTC": {
                "liquidations": [{"coin": "BTC", "px": "100", "sz": "2", "side": "long", "time": 111}],
                "price": 100.0,
                "oi": 1200.0,
                "funding": 0.0002,
            },
            "ETH": {"liquidations": [{"coin": "ETH", "px": "2000", "sz": "1", "side": "short", "time": 110}]},
        },
        available_symbols_cache=[{"symbol": "BTC", "day_ntl_vlm": 10000}],
    )
    out_live = asyncio.run(r_market.get_liquidations(_req(SimpleNamespace(session=None, aggregator=agg)), coin="BTC", limit=5))
    assert out_live[0]["coin"] == "BTC"

    r_market._leaderboard_cache = {"data": [{"address": "0x1"}], "timestamp": 9999999999}
    lb = asyncio.run(r_market.get_leaderboard(_req(SimpleNamespace(session=None)), limit=1))
    assert lb[0]["address"] == "0x1"

    # dynamic session paths
    class _Sess:
        def post(self, _url, json=None):
            if json.get("type") == "metaAndAssetCtxs":
                payload = [
                    {"universe": [{"name": "BTC"}]},
                    [{"funding": 0.0002, "openInterest": 1000, "markPx": 100, "dayNtlVlm": 10000, "prevDayPx": 99}],
                ]
                return _Resp(200, payload)
            return _Resp(200, [])

    req = _req(SimpleNamespace(session=_Sess()))
    rates = asyncio.run(r_market.get_all_funding_rates(req))
    assert "BTC" in rates
    summary = asyncio.run(r_market.get_market_summary(req))
    assert "totalOpenInterest" in summary
    oi = asyncio.run(r_market.get_oi_history(req, coin="BTC", hours=1))
    assert oi["coin"] == "BTC"

    # aggregator-first funding + summary paths
    req_agg = _req(SimpleNamespace(session=None, aggregator=agg))
    rates_agg = asyncio.run(r_market.get_all_funding_rates(req_agg))
    assert "BTC" in rates_agg
    summary_agg = asyncio.run(r_market.get_market_summary(req_agg))
    assert summary_agg.get("source") == "aggregator_cache"


def test_intel_router(monkeypatch):
    assert asyncio.run(r_intel.ping_intel())["status"] == "alive"

    poly = PolymarketProvider()
    poly.fetch_markets_by_query = lambda _q: asyncio.sleep(0, result=[{"id": "q"}])  # type: ignore[method-assign]

    micro = MicrostructureProvider()
    micro.active_symbols = {"BTC"}
    micro.states = {
        "BTC": {
            "history": [],
            "cb_spread_usd": 0,
            "cvd": 0,
            "depth_walls": {"bid": [], "ask": []},
            "raw_prices": {},
            "open_interest": 0,
            "sentiment_score": 0.5,
            "divergence": "NONE",
            "ta": {},
        }
    }
    micro.get_symbol_state = lambda _s: asyncio.sleep(0, result=micro.states["BTC"])  # type: ignore[method-assign]
    engine = SimpleNamespace(
        providers=[micro, poly, SimpleNamespace(name="RSS")],
        recent_items=[
            {"id": "1", "source": "RSS", "title": "BTC news", "timestamp": "2026-01-01", "sentiment": "neutral", "url": "u", "metadata": {}},
            {"id": "2", "source": "Polymarket", "title": "Prediction: BTC", "timestamp": "2026-01-01", "sentiment": "bullish", "url": "u", "metadata": {"type": "prediction", "probability": 80}},
        ],
        get_global_sentiment=lambda: {"score": 60, "label": "Greed", "breakdown": {}},
    )
    req = _req(SimpleNamespace(intel_engine=engine))

    assert asyncio.run(r_intel.debug_intel(req))["status"] == "online"
    assert asyncio.run(r_intel.get_intel_pulse(req))["score"] == 60
    assert asyncio.run(r_intel.get_latest_intel(req, limit=1))[0]["id"] == "1"
    assert asyncio.run(r_intel.get_intel_ticker(req, limit=2))
    assert asyncio.run(r_intel.get_intel_sources(req))[0] == "microstructure"

    user_free = SimpleNamespace(role="user", is_admin=False, email="free@example.com")
    preds = asyncio.run(r_intel.get_prediction_markets(req, user=user_free))
    assert preds[0]["metadata"]["is_locked"] is True

    # nexus and deobfuscate
    fake_nexus = SimpleNamespace(get_alpha_confluence=lambda: asyncio.sleep(0, result=[{"token": "BTC", "timestamp": "2026-01-01T00:00:00+00:00", "recommendation": "BUY", "signals": {}}]))
    monkeypatch.setattr("src.intel.nexus.nexus", fake_nexus)
    out_nexus = asyncio.run(r_intel.get_intel_nexus(user=user_free, db=_DB()))
    assert out_nexus[0]["is_obfuscated"] is True

    user_paid = SimpleNamespace(
        role="pro",
        is_admin=False,
        trial_credits=1,
        email="pro@example.com",
        last_credit_reset=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )
    db = _DB()
    deob = asyncio.run(r_intel.deobfuscate_signal(r_intel.DeobfuscateRequest(token_obfuscated="B**"), user=user_paid, db=db))
    assert deob

    micro_out = asyncio.run(r_intel.get_microstructure_data(req, symbol="BTC", user=user_free))
    assert micro_out["ticker"] == "BTC"


def test_trading_router(monkeypatch):
    # Tokens API fallback path
    class _FailSession:
        def post(self, *_a, **_k):
            return _Resp(status=500, payload={})

    req = _req(SimpleNamespace(session=_FailSession()))
    out = asyncio.run(r_trading.get_trading_tokens(req))
    assert out["tokens"]

    # Funding fetch path with 403
    class _Sess403:
        def get(self, *_a, **_k):
            return _Resp(status=403, payload={})

    rates, err = asyncio.run(r_trading.fetch_binance_funding_rates(_req(SimpleNamespace(session=_Sess403()))))
    assert rates == {}
    assert "403" in err

    async def _fake_bin(_request):
        return ({"BTC": 0.001}, None)

    async def _fake_tokens(_request):
        return {"tokens": [{"symbol": "BTC", "funding": 0.0001, "openInterest": 1, "volume24h": 1}]}

    monkeypatch.setattr(r_trading, "fetch_binance_funding_rates", _fake_bin)
    monkeypatch.setattr(r_trading, "get_trading_tokens", _fake_tokens)
    arb = asyncio.run(r_trading.get_arb_opportunities(_req(SimpleNamespace(session=None))))
    assert arb["count"] == 1

    # execute arb endpoint missing keys
    class _Exec:
        def __init__(self, _db):
            pass

        async def get_user_keys(self, _uid):
            return None, None

    monkeypatch.setattr(r_trading, "ArbExecutor", _Exec)
    user = SimpleNamespace(id="u1", is_admin=False, email="u@x")
    miss = asyncio.run(r_trading.execute_arb_endpoint(SimpleNamespace(symbol="BTC", size_usd=1000, direction="Long HL / Short Binance"), user=user, db=_DB()))
    assert isinstance(miss, Response) and miss.status_code == 400

    # active trades empty
    empty_db = _DB(query_map=[_Q(items=[])])
    active = asyncio.run(r_trading.get_active_trades(user=user, db=empty_db))
    assert active["trades"] == []

    # external walls + malformed order
    monkeypatch.setattr(r_trading, "manager", SimpleNamespace(passive_walls=SimpleNamespace(get_walls=lambda _c: {"walls": []}), hl_client=SimpleNamespace(get_open_orders=lambda _u: [], get_user_state=lambda _u: {"ok": True}, managed_trade=lambda **_k: asyncio.sleep(0, result={"status": "ok"}))))
    assert asyncio.run(r_trading.get_external_walls("BTC"))["walls"] == []

    malformed = asyncio.run(r_trading.place_order({"bad": 1}, _req(SimpleNamespace(session=None)), user=user))
    assert malformed.status_code == 422

    # managed order gating paths
    r_trading.ENABLE_SERVER_SIDE_TRADING = False
    disabled = asyncio.run(
        r_trading.place_order({"token": "BTC", "side": "buy", "size": 1}, _req(SimpleNamespace(session=None)), user=user)
    )
    assert disabled.status_code == 403

    r_trading.ENABLE_SERVER_SIDE_TRADING = True
    r_trading.REQUIRE_ADMIN_FOR_SERVER_TRADING = True
    restricted = asyncio.run(
        r_trading.place_order({"token": "BTC", "side": "buy", "size": 1}, _req(SimpleNamespace(session=None)), user=user)
    )
    assert restricted.status_code == 403

    r_trading.REQUIRE_ADMIN_FOR_SERVER_TRADING = False
    r_trading.manager = SimpleNamespace(
        passive_walls=SimpleNamespace(get_walls=lambda _c: {"walls": []}),
        hl_client=SimpleNamespace(can_use_server_signing=lambda: False),
    )
    no_key = asyncio.run(
        r_trading.place_order({"token": "BTC", "side": "buy", "size": 1}, _req(SimpleNamespace(session=None)), user=user)
    )
    assert no_key.status_code == 403

    r_trading.manager = SimpleNamespace(
        passive_walls=SimpleNamespace(get_walls=lambda _c: {"walls": []}),
        hl_client=SimpleNamespace(
            can_use_server_signing=lambda: True,
            managed_trade=lambda **_k: asyncio.sleep(0, result={"status": "ok"}),
            get_open_orders=lambda _u: [],
            get_user_state=lambda _u: {"ok": True},
        ),
    )
    ok_managed = asyncio.run(
        r_trading.place_order({"token": "BTC", "side": "buy", "size": 1}, _req(SimpleNamespace(session=None)), user=user)
    )
    assert ok_managed["status"] == "ok"

    # prices endpoint
    class _SessPrices:
        def post(self, *_a, **_k):
            return _Resp(status=200, payload={"BTC": "50000"})

    prices = asyncio.run(r_trading.get_all_prices(_req(SimpleNamespace(session=_SessPrices()))))
    assert "BTC" in prices

    class _Agg:
        def __init__(self, data_cache=None):
            self.data_cache = data_cache if data_cache is not None else {}
            self.cache_updates = []

        def _update_cache(self, coin, key, value):
            self.cache_updates.append((coin, key, value))
            self.data_cache.setdefault(coin, {})
            self.data_cache[coin][key] = value

        def _detect_walls(self, _levels):
            return [{"px": "100", "sz": "10", "side": "bid", "strength": "major"}]

    # orderbook endpoint: cache hit path
    agg_cached = _Agg(
        {
            "BTC": {
                "book": [
                    [{"px": "100", "sz": "1.5"}],
                    [{"px": "101", "sz": "2.0"}],
                ],
                "price": 100.5,
            }
        }
    )
    ob_cached = asyncio.run(
        r_trading.get_orderbook_snapshot(
            _req(SimpleNamespace(aggregator=agg_cached, session=None)),
            coin="btc",
            depth=20,
        )
    )
    assert ob_cached["source"] == "aggregator_cache"
    assert ob_cached["book"][0][0]["px"] == "100"

    # orderbook endpoint: snapshot repair path + cache hydration
    class _SessSnapshot:
        def post(self, *_a, **_k):
            return _Resp(
                status=200,
                payload={
                    "levels": [
                        [{"px": "200", "sz": "3.0"}],
                        [{"px": "201", "sz": "4.0"}],
                    ]
                },
            )

    agg_empty = _Agg({"ETH": {"book": [[], []], "price": 0}})
    ob_repaired = asyncio.run(
        r_trading.get_orderbook_snapshot(
            _req(SimpleNamespace(aggregator=agg_empty, session=_SessSnapshot())),
            coin="ETH",
            depth=10,
        )
    )
    assert ob_repaired["source"] == "hyperliquid_snapshot"
    assert agg_empty.data_cache["ETH"]["book"][0][0]["px"] == "200"
    assert any(key == "walls" for _, key, _ in agg_empty.cache_updates)

    # orderbook fallback suppression while aggregator upstream is rate-limited
    r_trading._orderbook_snapshot_cache.clear()
    r_trading._orderbook_upstream_last_attempt.clear()
    agg_backoff = _Agg({"BTC": {"book": [[], []], "price": 100.0, "book_ts": 0}})
    agg_backoff.upstream_connected = False
    agg_backoff.last_ws_close_reason = "WSServerHandshakeError: 429 invalid response status"
    agg_backoff.last_ws_close_ts = __import__("time").time()

    class _NoPost:
        def post(self, *_a, **_k):
            raise AssertionError("upstream snapshot should not be called during aggregator backoff")

    ob_backoff = asyncio.run(
        r_trading.get_orderbook_snapshot(
            _req(SimpleNamespace(aggregator=agg_backoff, session=_NoPost())),
            coin="BTC",
            depth=10,
        )
    )
    assert ob_backoff["source"] == "aggregator_backoff"

    assert asyncio.run(r_trading.get_open_orders(user="0x1"))["orders"] == []
    assert asyncio.run(r_trading.get_account(user="0x1"))["ok"] is True

    # degraded paths when HL client is unavailable during init cooldown
    r_trading.manager = SimpleNamespace(
        passive_walls=SimpleNamespace(get_walls=lambda _c: {"walls": []}),
        hl_client=None,
    )
    r_trading._open_orders_cache.clear()
    r_trading._account_cache.clear()
    r_trading._hl_rate_limited_until = 0.0
    r_trading._hl_backoff_sec = 2.0

    assert asyncio.run(r_trading.get_open_orders(user="0x2"))["orders"] == []
    degraded_account = asyncio.run(r_trading.get_account(user="0x2"))
    assert degraded_account["error"] == "Trading client unavailable"

    # whale endpoints
    tracker = SimpleNamespace(
        _initialized=True,
        get_alerts=lambda **_k: [{"id": "1"}],
        get_whale_positions=lambda **_k: [{"coin": "BTC"}],
        get_whale_summary=lambda **_k: {"bias": 0},
        get_leaderboard=lambda: [{"address": "0x1"}],
        get_stats=lambda: {"is_running": True},
    )
    wreq = _req(SimpleNamespace(whale_tracker=tracker))
    assert asyncio.run(r_trading.get_whale_alerts(wreq))["count"] == 1
    assert asyncio.run(r_trading.get_whale_positions(wreq))["count"] == 1
    assert "bias" in asyncio.run(r_trading.get_whale_summary(wreq))
    assert asyncio.run(r_trading.get_whale_leaderboard(wreq))["count"] == 1
    assert asyncio.run(r_trading.get_whale_stats(wreq))["is_running"] is True


def test_intel_proxy_guardrails(monkeypatch):
    import httpx

    class _ProxyResp:
        status_code = 200
        content = b"ok"
        headers = {"content-type": "text/plain"}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def get(self, *_args, **_kwargs):
            return _ProxyResp()

    monkeypatch.setattr(httpx, "AsyncClient", lambda: _Client())
    monkeypatch.setattr(r_intel, "_PROXY_RATE_LIMIT_PER_MIN", 1)
    monkeypatch.setattr(r_intel, "_PROXY_MAX_RESPONSE_BYTES", 10)
    r_intel._proxy_request_buckets.clear()

    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    user = SimpleNamespace(id="u1", role="pro", is_admin=False)

    ok = asyncio.run(r_intel.proxy_web("https://polymarket.com", request=request, user=user))
    assert ok.status_code == 200

    try:
        asyncio.run(r_intel.proxy_web("https://polymarket.com", request=request, user=user))
        assert False, "expected rate limit exception"
    except HTTPException as exc:
        assert exc.status_code == 429

    try:
        asyncio.run(r_intel.proxy_web("http://polymarket.com", request=request, user=user))
        assert False, "expected scheme validation exception"
    except HTTPException as exc:
        assert exc.status_code == 400
