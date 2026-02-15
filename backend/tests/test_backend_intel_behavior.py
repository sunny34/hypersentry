import asyncio
import datetime
from types import SimpleNamespace

from src.intel.filter import IntelFilter
from src.intel.sentiment import SentimentAnalyzer
from src.intel.providers.rss import RSSProvider
from src.intel.providers.twitter import TwitterProvider
from src.intel.providers.telegram import TelegramProvider
from src.intel.providers.polymarket import PolymarketProvider
from src.intel.providers.base import IntelProvider
from src.intel.engine import IntelEngine
from src.intel.nexus import NexusEngine


class _AttrDict(dict):
    __getattr__ = dict.get


def test_intel_filter_spam_and_duplicates():
    f = IntelFilter()
    recent = [{"title": "Bitcoin ETF approved"}]
    items = [
        {"title": "How to buy BTC now", "content": "sponsored"},
        {"title": "Bitcoin ETF approved", "content": "same"},
        {"title": "Fed surprises market", "content": "macro shift"},
    ]
    out = f.filter(items, recent)
    assert len(out) == 1
    assert out[0]["title"] == "Fed surprises market"


def test_base_provider_normalize_shape():
    class _P(IntelProvider):
        async def fetch_latest(self):
            return []

    p = _P("X")
    out = p.normalize("id", "title", "content", "url", datetime.datetime.now())
    assert out["id"].startswith("X_")
    assert out["source"] == "X"


def test_sentiment_keyword_and_batch_short_circuit(monkeypatch):
    sa = SentimentAnalyzer()
    sa.client = None
    items = [{"id": "1", "title": "Partnership announced", "content": "major launch", "sentiment": "neutral"}]
    out = asyncio.run(sa.analyze_batch(items))
    assert out is items

    sa._keyword_fallback(items[0])
    assert items[0]["sentiment"] in {"bullish", "neutral", "bearish"}


def test_sentiment_single_fallback(monkeypatch):
    sa = SentimentAnalyzer()

    class _FailModels:
        def generate_content(self, **_kwargs):
            raise RuntimeError("boom")

    class _FailClient:
        models = _FailModels()

    sa.client = _FailClient()
    sa.model_id = "x"
    item = {"title": "Hack reported", "content": "major exploit"}
    asyncio.run(sa._analyze_single(item))
    assert item["sentiment"] == "bearish"


def test_rss_provider_fetch(monkeypatch):
    provider = RSSProvider()

    class _Loop:
        async def run_in_executor(self, _exec, fn, arg):
            return fn(arg)

    feed = SimpleNamespace(
        entries=[
            _AttrDict(
                {
                    "link": "https://x",
                    "title": "Headline",
                    "summary": "Summary",
                    "published_parsed": (2026, 1, 1, 0, 0, 0, 0, 0, 0),
                }
            )
        ]
    )

    monkeypatch.setattr("src.intel.providers.rss.asyncio.get_event_loop", lambda: _Loop())
    monkeypatch.setattr("src.intel.providers.rss.feedparser.parse", lambda _url: feed)

    out = asyncio.run(provider.fetch_latest())
    assert out
    assert out[0]["source"] == "RSS"


def test_twitter_provider_no_key(monkeypatch):
    monkeypatch.delenv("TWITTER_API_KEY", raising=False)
    provider = TwitterProvider()
    out = asyncio.run(provider.fetch_latest())
    assert out == []


def test_telegram_provider_fetch(monkeypatch):
    provider = TelegramProvider()
    provider.bot_token = "token"

    class _Resp:
        status = 200

        async def json(self):
            return {
                "result": [
                    {
                        "update_id": 1,
                        "message": {
                            "text": "$BTC listing rumor",
                            "date": int(datetime.datetime.now().timestamp()),
                            "chat": {"id": -100123},
                            "message_id": 7,
                        },
                    }
                ]
            }

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

    class _Session:
        def get(self, *_args, **_kwargs):
            return _Resp()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

    monkeypatch.setattr("src.intel.providers.telegram.aiohttp.ClientSession", lambda: _Session())

    out = asyncio.run(provider.fetch_latest())
    assert len(out) == 1
    assert out[0]["is_high_impact"] is True


def test_polymarket_provider_fetch_and_query(monkeypatch):
    provider = PolymarketProvider()

    class _Resp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class _Client:
        async def get(self, _url, params=None):
            if params and params.get("q"):
                return _Resp([{"id": "q1"}])
            return _Resp(
                [
                    {
                        "id": "1",
                        "slug": "btc-up",
                        "title": "Will Bitcoin rally?",
                        "summary": "macro",
                        "volume": 1000,
                        "markets": [
                            {
                                "id": "m1",
                                "outcomes": '["Yes", "No"]',
                                "outcomePrices": '["0.82", "0.18"]',
                            }
                        ],
                    }
                ]
            )

    provider.client = _Client()
    out = asyncio.run(provider.fetch_latest())
    assert out and out[0]["metadata"]["type"] == "prediction"

    q = asyncio.run(provider.fetch_markets_by_query("btc"))
    assert q and q[0]["id"] == "q1"


def test_intel_engine_global_sentiment_flow():
    eng = IntelEngine()
    eng.recent_items = [
        {"sentiment_score": 1, "metadata": {"type": "prediction"}, "sentiment": "bullish"},
        {"sentiment_score": -1, "metadata": {}, "sentiment": "bearish"},
    ]
    micro = SimpleNamespace(name="microstructure", states={"BTC": {"cb_spread_usd": 35, "cvd": 2000}})
    eng.providers = [micro]
    pulse = eng.get_global_sentiment()
    assert 0 <= pulse["score"] <= 100
    assert "flow" in pulse["breakdown"]


def test_nexus_trade_plan_and_perf(monkeypatch):
    nx = NexusEngine()

    signal = {"recommendation": "STRONG BUY", "alpha_score": 5}
    micro = {"raw_prices": {"binance": 100}, "depth_walls": {"bid": [98], "ask": [103]}}
    plan = nx.calculate_trade_plan(signal, micro)
    assert plan["entry"] == 100
    assert plan["take_profit_1"] > plan["entry"]

    # perf query path
    class _Q:
        def __init__(self, rows, count_val=0):
            self._rows = rows
            self._count = count_val

        def filter(self, *_a, **_k):
            return self

        def order_by(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def all(self):
            return self._rows

        def count(self):
            return self._count

    closed = [SimpleNamespace(result="WIN", closed_at=datetime.datetime.now(datetime.timezone.utc))]

    class _DB:
        def query(self, _model):
            # First call: last_5; second/third calls: wins/total
            if not hasattr(self, "i"):
                self.i = 0
            self.i += 1
            if self.i == 1:
                return _Q(closed)
            if self.i == 2:
                return _Q([], 1)
            return _Q([], 2)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr("database.get_db_session", lambda: _DB())
    perf = nx.get_token_performance("BTC")
    assert perf["accuracy_24h"] in {"50%", "N/A"}
