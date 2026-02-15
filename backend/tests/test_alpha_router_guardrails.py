import asyncio
import time

from fastapi import HTTPException

import src.routers.alpha as r_alpha
from src.alpha_engine.models.conviction_models import ConvictionComponent, ConvictionResult
from src.alpha_engine.state.market_state import MarketState


def _conviction(symbol: str = "BTC") -> ConvictionResult:
    comps = {
        "regime": ConvictionComponent(score=0.1, weight=0.2, description="r"),
        "liquidation": ConvictionComponent(score=0.1, weight=0.2, description="l"),
        "footprint": ConvictionComponent(score=0.1, weight=0.2, description="f"),
        "funding": ConvictionComponent(score=0.0, weight=0.2, description="fu"),
        "volatility": ConvictionComponent(score=0.0, weight=0.2, description="v"),
    }
    return ConvictionResult(
        symbol=symbol,
        bias="LONG",
        score=60,
        confidence=0.6,
        components=comps,
        explanation=["ok"],
        timestamp=int(time.time() * 1000),
    )


def test_assert_state_fresh_rejects_stale():
    stale_state = MarketState(symbol="BTC", price=100.0, timestamp=int(time.time() * 1000) - 60_000)
    try:
        r_alpha._assert_state_fresh("BTC", stale_state, max_age_ms=1000)
        assert False, "expected stale state exception"
    except HTTPException as exc:
        assert exc.status_code == 409


def test_build_live_risk_rejects_stale_state():
    stale_state = MarketState(symbol="BTC", price=100.0, timestamp=int(time.time() * 1000) - 60_000)
    conviction = _conviction()

    try:
        asyncio.run(r_alpha._build_live_risk("BTC", state=stale_state, conviction=conviction))
        assert False, "expected stale state exception"
    except HTTPException as exc:
        assert exc.status_code == 409
