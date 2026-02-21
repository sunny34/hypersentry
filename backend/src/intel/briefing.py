import asyncio
import datetime
import hashlib
import json
import logging
import math
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from config import config
from src.alpha_engine.models.ai_command_models import AIBriefLevels, AIBriefResponse

logger = logging.getLogger(__name__)

_AI_BRIEF_CACHE_TTL_SEC = max(15, int(os.getenv("AI_BRIEF_CACHE_TTL_SEC", "90")))
_AI_BRIEF_GEMINI_MIN_INTERVAL_SEC = max(30, int(os.getenv("AI_BRIEF_GEMINI_MIN_INTERVAL_SEC", "120")))
_AI_BRIEF_GEMINI_MODEL = os.getenv("AI_BRIEF_GEMINI_MODEL", "gemini-flash-latest")


@dataclass
class _BriefCacheEntry:
    signature: str
    response: AIBriefResponse
    created_at: float


_brief_cache: Dict[str, _BriefCacheEntry] = {}


def _iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _normalize_symbol(symbol: str) -> str:
    return (symbol or "BTC").strip().split("/")[0].split("-")[0].upper()


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _normalize_action(value: Any) -> str:
    text = str(value or "").strip().upper()
    if text in {"LONG", "BUY", "BULLISH", "ACCUMULATE", "STRONG BUY"}:
        return "LONG"
    if text in {"SHORT", "SELL", "BEARISH", "DISTRIBUTE", "STRONG SELL"}:
        return "SHORT"
    return "NEUTRAL"


def _normalize_list(items: Any, limit: int = 6) -> List[str]:
    if not isinstance(items, list):
        return []
    out: List[str] = []
    for item in items:
        text = str(item or "").strip()
        if not text:
            continue
        if text in out:
            continue
        out.append(text)
        if len(out) >= limit:
            break
    return out


def _effective_coinbase_spread_usd(micro_state: Optional[Dict[str, Any]]) -> float:
    state = micro_state or {}
    prices = state.get("raw_prices") if isinstance(state.get("raw_prices"), dict) else {}
    cb = _to_float(prices.get("cb"), 0.0)
    binance = _to_float(prices.get("binance"), 0.0)
    if cb > 0 and binance > 0:
        # Use Coinbase-Binance basis when available for consistency with trader convention.
        return cb - binance
    return _to_float(state.get("cb_spread_usd"), 0.0)


def _normalize_confluence_factors(items: Any) -> List[str]:
    factors = _normalize_list(items, limit=10)
    has_pos_news = "Positive News Sentiment" in factors
    has_neg_news = "Negative News Sentiment" in factors
    has_bull_pred = "Bullish Prediction Bias" in factors
    has_bear_pred = "Bearish Prediction Bias" in factors

    collapsed: List[str] = []
    for factor in factors:
        if factor in {"Positive News Sentiment", "Negative News Sentiment", "Bullish Prediction Bias", "Bearish Prediction Bias"}:
            continue
        collapsed.append(factor)

    if has_pos_news and has_neg_news:
        collapsed.append("Mixed News Sentiment")
    elif has_pos_news:
        collapsed.append("Positive News Sentiment")
    elif has_neg_news:
        collapsed.append("Negative News Sentiment")

    if has_bull_pred and has_bear_pred:
        collapsed.append("Mixed Prediction Bias")
    elif has_bull_pred:
        collapsed.append("Bullish Prediction Bias")
    elif has_bear_pred:
        collapsed.append("Bearish Prediction Bias")

    return _normalize_list(collapsed, limit=8)


def _has_spread_input(micro_state: Optional[Dict[str, Any]]) -> bool:
    state = micro_state or {}
    prices = state.get("raw_prices") if isinstance(state.get("raw_prices"), dict) else {}
    has_cb = _to_float(prices.get("cb"), 0.0) > 0
    has_binance = _to_float(prices.get("binance"), 0.0) > 0
    if has_cb and has_binance:
        return True
    return state.get("cb_spread_usd") is not None


def _get_market_price(signal: Optional[Dict[str, Any]], micro_state: Optional[Dict[str, Any]]) -> float:
    state = micro_state or {}
    prices = state.get("raw_prices") if isinstance(state.get("raw_prices"), dict) else {}
    price = _to_float(prices.get("binance"), 0.0)
    if price <= 0:
        price = _to_float(prices.get("hyperliquid"), 0.0)
    if price <= 0:
        trade_plan = signal.get("trade_plan") if isinstance(signal, dict) else {}
        if isinstance(trade_plan, dict):
            price = _to_float(trade_plan.get("entry"), 0.0)
    return price


def _context_signature(
    symbol: str,
    signal: Optional[Dict[str, Any]],
    whale_summary: Optional[Dict[str, Any]],
    micro_state: Optional[Dict[str, Any]],
) -> str:
    signal = signal or {}
    whale_summary = whale_summary or {}
    micro_state = micro_state or {}
    ta = micro_state.get("ta") if isinstance(micro_state.get("ta"), dict) else {}
    ta_1m = ta.get("1m") if isinstance(ta.get("1m"), dict) else {}
    spread_usd = _effective_coinbase_spread_usd(micro_state)
    payload = {
        "symbol": symbol,
        "alpha_score": round(_to_float(signal.get("alpha_score"), 0.0), 2),
        "recommendation": str(signal.get("recommendation", "")).upper(),
        "factors": _normalize_confluence_factors(signal.get("confluence_factors")),
        "whale_bias": round(_to_float(whale_summary.get("bias"), 0.0), 1),
        "spread": round(spread_usd, 1),
        "rsi_1m": round(_to_float(ta_1m.get("rsi"), 50.0), 1),
        "divergence": str(micro_state.get("divergence", "NONE")).upper(),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:20]


def _build_heuristic_brief(
    symbol: str,
    signal: Optional[Dict[str, Any]],
    whale_summary: Optional[Dict[str, Any]],
    micro_state: Optional[Dict[str, Any]],
) -> AIBriefResponse:
    signal = signal or {}
    whale_summary = whale_summary or {}
    micro_state = micro_state or {}
    trade_plan = signal.get("trade_plan") if isinstance(signal.get("trade_plan"), dict) else {}
    ta = micro_state.get("ta") if isinstance(micro_state.get("ta"), dict) else {}
    ta_1m = ta.get("1m") if isinstance(ta.get("1m"), dict) else {}

    alpha_score = _to_float(signal.get("alpha_score"), 0.0)
    whale_bias = _to_float(whale_summary.get("bias"), 0.0)
    spread_usd = _effective_coinbase_spread_usd(micro_state)
    rsi_1m = _to_float(ta_1m.get("rsi"), 50.0)
    recommendation = str(signal.get("recommendation", "NEUTRAL")).upper()
    divergence = str(micro_state.get("divergence", "NONE")).upper()
    price = _get_market_price(signal, micro_state)

    bull_points = 0
    bear_points = 0

    if alpha_score >= 3:
        bull_points += 2
    elif alpha_score >= 1:
        bull_points += 1
    if alpha_score <= -3:
        bear_points += 2
    elif alpha_score <= -1:
        bear_points += 1

    if whale_bias >= 20:
        bull_points += 2
    elif whale_bias >= 10:
        bull_points += 1
    if whale_bias <= -20:
        bear_points += 2
    elif whale_bias <= -10:
        bear_points += 1

    if spread_usd >= 20:
        bull_points += 1
    elif spread_usd <= -20:
        bear_points += 1

    if rsi_1m <= 35:
        bull_points += 1
    elif rsi_1m >= 65:
        bear_points += 1

    if "BUY" in recommendation or "ACCUMULATE" in recommendation:
        bull_points += 1
    if "SELL" in recommendation or "DISTRIBUTE" in recommendation:
        bear_points += 1

    if "BULL" in divergence:
        bull_points += 1
    elif "BEAR" in divergence:
        bear_points += 1

    score_delta = bull_points - bear_points
    if score_delta >= 2:
        action = "LONG"
    elif score_delta <= -2:
        action = "SHORT"
    else:
        action = "NEUTRAL"

    confidence = int(_clamp(48 + abs(score_delta) * 9 + min(18, abs(alpha_score) * 3), 38, 92))
    if action == "NEUTRAL":
        confidence = max(42, confidence - 15)

    entry = _to_float(trade_plan.get("entry"), 0.0)
    stop_loss = _to_float(trade_plan.get("stop_loss"), 0.0)
    take_profit = _to_float(trade_plan.get("take_profit_1"), 0.0)

    if entry <= 0:
        entry = price
    if entry > 0 and stop_loss <= 0:
        stop_loss = entry * (0.985 if action != "SHORT" else 1.015)
    if entry > 0 and take_profit <= 0:
        if action == "SHORT":
            take_profit = entry * 0.98
        elif action == "LONG":
            take_profit = entry * 1.02

    levels = AIBriefLevels(
        entry=entry if entry > 0 else None,
        invalidation=stop_loss if stop_loss > 0 else None,
        take_profit=take_profit if take_profit > 0 else None,
    )

    catalysts = _normalize_confluence_factors(signal.get("confluence_factors"))[:4]
    if abs(whale_bias) >= 10:
        bias_label = "long-heavy" if whale_bias > 0 else "short-heavy"
        catalysts.append(f"Whale positioning is {bias_label} ({whale_bias:+.1f}%).")
    if _has_spread_input(micro_state):
        spread_label = "premium" if spread_usd > 0 else "discount"
        catalysts.append(f"Coinbase vs Binance spread is {spread_usd:+.1f} USD ({spread_label}).")
    else:
        catalysts.append("Coinbase vs Binance spread unavailable.")
    catalysts = _normalize_list(catalysts, limit=6)

    risk_flags: List[str] = []
    if action == "LONG" and whale_bias < -10:
        risk_flags.append("Whale flow is net short against the long setup.")
    if action == "SHORT" and whale_bias > 10:
        risk_flags.append("Whale flow is net long against the short setup.")
    if action == "LONG" and rsi_1m >= 70:
        risk_flags.append("RSI is overbought and could mean-revert.")
    if action == "SHORT" and rsi_1m <= 30:
        risk_flags.append("RSI is oversold and could squeeze upward.")
    if abs(alpha_score) < 2:
        risk_flags.append("Signal confluence is weak; sizing should stay conservative.")
    if "NONE" != divergence and "BULL" not in divergence and action == "LONG":
        risk_flags.append(f"Divergence signal is {divergence}.")
    if "NONE" != divergence and "BEAR" not in divergence and action == "SHORT":
        risk_flags.append(f"Divergence signal is {divergence}.")
    risk_flags = _normalize_list(risk_flags, limit=5)

    if action == "LONG":
        thesis = (
            f"{symbol} shows net bullish confluence (alpha {alpha_score:+.1f}, whale bias {whale_bias:+.1f}%). "
            "Momentum can continue if buyers defend intraday pullbacks."
        )
        counter = (
            "Counter-thesis: upside fades if buy-side liquidity fails to hold and sellers absorb at resistance."
        )
    elif action == "SHORT":
        thesis = (
            f"{symbol} shows net bearish confluence (alpha {alpha_score:+.1f}, whale bias {whale_bias:+.1f}%). "
            "Downside continuation is favored while offers stay heavy."
        )
        counter = (
            "Counter-thesis: short setup fails if shorts get squeezed by aggressive spot demand."
        )
    else:
        thesis = (
            f"{symbol} is mixed (alpha {alpha_score:+.1f}, whale bias {whale_bias:+.1f}%). "
            "No strong edge until one side of flow takes control."
        )
        counter = (
            "Counter-thesis: neutral posture underperforms if a breakout starts before confirmation signals update."
        )

    checklist: List[str] = []
    if levels.entry:
        checklist.append(f"Use {symbol} near {levels.entry:,.2f} as the reference entry, not a market chase.")
    if levels.invalidation:
        checklist.append(f"Hard invalidation below/above {levels.invalidation:,.2f}.")
    if levels.take_profit:
        checklist.append(f"Scale partials around {levels.take_profit:,.2f}.")
    checklist.append("Confirm order-book pressure aligns with trade direction before execution.")
    checklist.append("Reduce size if spread widens or liquidity thins out.")
    checklist = _normalize_list(checklist, limit=6)

    return AIBriefResponse(
        symbol=symbol,
        source="heuristic",
        action=action,
        confidence=confidence,
        thesis=thesis,
        counter_thesis=counter,
        catalysts=catalysts,
        risk_flags=risk_flags,
        checklist=checklist,
        levels=levels,
        generated_at=_iso_now(),
    )


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Empty model response")

    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object detected in model response")

    return json.loads(text[start : end + 1])


def _merge_llm_brief(heuristic: AIBriefResponse, llm_data: Dict[str, Any]) -> AIBriefResponse:
    action = _normalize_action(llm_data.get("action") or llm_data.get("direction") or heuristic.action)
    confidence = _to_int(llm_data.get("confidence"), heuristic.confidence)
    confidence = int(_clamp(confidence, 0, 100))

    thesis = str(llm_data.get("thesis") or heuristic.thesis).strip()
    counter = str(llm_data.get("counter_thesis") or heuristic.counter_thesis).strip()
    if not thesis:
        thesis = heuristic.thesis
    if not counter:
        counter = heuristic.counter_thesis

    levels_obj = llm_data.get("levels") if isinstance(llm_data.get("levels"), dict) else {}
    entry = _to_float(levels_obj.get("entry"), heuristic.levels.entry or 0.0)
    invalidation = _to_float(levels_obj.get("invalidation"), heuristic.levels.invalidation or 0.0)
    take_profit = _to_float(levels_obj.get("take_profit"), heuristic.levels.take_profit or 0.0)

    levels = AIBriefLevels(
        entry=entry if entry > 0 else heuristic.levels.entry,
        invalidation=invalidation if invalidation > 0 else heuristic.levels.invalidation,
        take_profit=take_profit if take_profit > 0 else heuristic.levels.take_profit,
    )

    return AIBriefResponse(
        symbol=heuristic.symbol,
        source="gemini",
        action=action,
        confidence=confidence,
        thesis=thesis,
        counter_thesis=counter,
        catalysts=_normalize_list(llm_data.get("catalysts"), limit=6) or heuristic.catalysts,
        risk_flags=_normalize_list(llm_data.get("risk_flags"), limit=5) or heuristic.risk_flags,
        checklist=_normalize_list(llm_data.get("checklist"), limit=6) or heuristic.checklist,
        levels=levels,
        generated_at=_iso_now(),
    )


def _build_llm_prompt(
    symbol: str,
    signal: Optional[Dict[str, Any]],
    whale_summary: Optional[Dict[str, Any]],
    micro_state: Optional[Dict[str, Any]],
    heuristic: AIBriefResponse,
) -> str:
    signal = signal or {}
    whale_summary = whale_summary or {}
    micro_state = micro_state or {}
    trade_plan = signal.get("trade_plan") if isinstance(signal.get("trade_plan"), dict) else {}
    ta = micro_state.get("ta") if isinstance(micro_state.get("ta"), dict) else {}
    ta_1m = ta.get("1m") if isinstance(ta.get("1m"), dict) else {}

    market_context = {
        "symbol": symbol,
        "alpha_score": _to_float(signal.get("alpha_score"), 0.0),
        "recommendation": signal.get("recommendation", "NEUTRAL"),
        "confluence_factors": _normalize_confluence_factors(signal.get("confluence_factors")),
        "whale_bias_percent": _to_float(whale_summary.get("bias"), 0.0),
        "whale_bias_label": whale_summary.get("biasLabel", "BALANCED"),
        "long_notional": _to_float(whale_summary.get("longNotional"), 0.0),
        "short_notional": _to_float(whale_summary.get("shortNotional"), 0.0),
        "price_binance": _to_float((micro_state.get("raw_prices") or {}).get("binance"), 0.0)
        if isinstance(micro_state.get("raw_prices"), dict)
        else 0.0,
        "price_hyperliquid": _to_float((micro_state.get("raw_prices") or {}).get("hyperliquid"), 0.0)
        if isinstance(micro_state.get("raw_prices"), dict)
        else 0.0,
        "coinbase_vs_binance_spread_usd": _effective_coinbase_spread_usd(micro_state),
        "divergence": micro_state.get("divergence", "NONE"),
        "rsi_1m": _to_float(ta_1m.get("rsi"), 50.0),
        "trade_plan": {
            "entry": _to_float(trade_plan.get("entry"), 0.0),
            "stop_loss": _to_float(trade_plan.get("stop_loss"), 0.0),
            "take_profit_1": _to_float(trade_plan.get("take_profit_1"), 0.0),
            "risk_reward": _to_float(trade_plan.get("risk_reward"), 0.0),
        },
    }

    heuristic_json = (
        heuristic.model_dump_json()
        if hasattr(heuristic, "model_dump_json")
        else heuristic.json()
    )

    return (
        "You are a crypto macro + microstructure trading analyst. "
        "Create a practical thesis and counter-thesis for a live terminal panel. "
        "Be concise, specific, and execution-focused.\n\n"
        f"MARKET_CONTEXT_JSON:\n{json.dumps(market_context, separators=(',', ':'))}\n\n"
        f"HEURISTIC_BASELINE_JSON:\n{heuristic_json}\n\n"
        "Return ONLY valid JSON with this exact schema:\n"
        "{"
        "\"action\":\"LONG|SHORT|NEUTRAL\","
        "\"confidence\":0,"
        "\"thesis\":\"...\","
        "\"counter_thesis\":\"...\","
        "\"catalysts\":[\"...\"],"
        "\"risk_flags\":[\"...\"],"
        "\"checklist\":[\"...\"],"
        "\"levels\":{\"entry\":0,\"invalidation\":0,\"take_profit\":0}"
        "}\n"
        "Rules: no markdown, no disclaimers, max 2 sentences per thesis, "
        "only include checklist items that are directly actionable."
    )


async def _generate_gemini_brief(
    symbol: str,
    signal: Optional[Dict[str, Any]],
    whale_summary: Optional[Dict[str, Any]],
    micro_state: Optional[Dict[str, Any]],
    heuristic: AIBriefResponse,
) -> Optional[AIBriefResponse]:
    if not config.GEMINI_API_KEY:
        return None

    try:
        from google import genai
    except Exception as exc:
        logger.warning("Gemini SDK unavailable for ai-brief: %s", exc)
        return None

    prompt = _build_llm_prompt(symbol, signal, whale_summary, micro_state, heuristic)

    try:
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        loop = asyncio.get_running_loop()

        def _run():
            return client.models.generate_content(
                model=_AI_BRIEF_GEMINI_MODEL,
                contents=prompt,
                config={"response_mime_type": "application/json"},
            )

        response = await loop.run_in_executor(None, _run)
        parsed = _extract_json_object(getattr(response, "text", ""))
        return _merge_llm_brief(heuristic, parsed)
    except Exception as exc:
        logger.warning("Gemini ai-brief generation failed for %s: %s", symbol, exc)
        return None


def _with_fresh_timestamp(brief: AIBriefResponse) -> AIBriefResponse:
    if hasattr(brief, "model_copy"):
        return brief.model_copy(update={"generated_at": _iso_now()})
    return brief.copy(update={"generated_at": _iso_now()})


def _upsert_cache(symbol: str, signature: str, response: AIBriefResponse) -> None:
    _brief_cache[symbol] = _BriefCacheEntry(signature=signature, response=response, created_at=time.time())


async def generate_ai_brief(
    symbol: str,
    signal: Optional[Dict[str, Any]],
    whale_summary: Optional[Dict[str, Any]],
    micro_state: Optional[Dict[str, Any]],
) -> AIBriefResponse:
    symbol = _normalize_symbol(symbol)
    signature = _context_signature(symbol, signal, whale_summary, micro_state)
    now = time.time()
    cache = _brief_cache.get(symbol)

    if cache and cache.signature == signature:
        age = now - cache.created_at
        if age <= _AI_BRIEF_CACHE_TTL_SEC:
            return _with_fresh_timestamp(cache.response)
        if age < _AI_BRIEF_GEMINI_MIN_INTERVAL_SEC:
            return _with_fresh_timestamp(cache.response)

    heuristic = _build_heuristic_brief(symbol, signal, whale_summary, micro_state)

    if not config.GEMINI_API_KEY:
        _upsert_cache(symbol, signature, heuristic)
        return heuristic

    if cache and (now - cache.created_at) < _AI_BRIEF_GEMINI_MIN_INTERVAL_SEC:
        _upsert_cache(symbol, signature, heuristic)
        return heuristic

    gemini_brief = await _generate_gemini_brief(symbol, signal, whale_summary, micro_state, heuristic)
    if gemini_brief:
        _upsert_cache(symbol, signature, gemini_brief)
        return gemini_brief

    _upsert_cache(symbol, signature, heuristic)
    return heuristic
