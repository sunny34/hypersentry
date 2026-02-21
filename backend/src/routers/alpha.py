from fastapi import APIRouter, HTTPException
from dataclasses import asdict
import logging
import os
import statistics
import time
from pathlib import Path
from src.alpha_engine.services.alpha_service import alpha_service
from src.alpha_engine.services.liquidation_service import liquidation_service
from src.alpha_engine.services.footprint_service import footprint_service
from src.alpha_engine.services.conviction_service import conviction_service
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.models.regime_models import AlphaSignal
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult
from src.alpha_engine.models.footprint_models import FootprintResult
from src.alpha_engine.models.conviction_models import ConvictionResult
from src.alpha_engine.models.backtest_models import BacktestReport
from src.alpha_engine.models.adaptive_models import WalkForwardReport
from src.alpha_engine.models.probability_models import ProbabilityResult
from src.alpha_engine.models.governance_models import GovernanceReport
from src.alpha_engine.models.risk_models import RiskAssessment, RiskBreakdown
from src.alpha_engine.models.execution_models import ExecutionPlan
from src.alpha_engine.backtesting.report import BacktestReportGenerator
from src.alpha_engine.backtesting.data_loader import DataLoader
from src.alpha_engine.adaptive.walkforward_runner import WalkForwardRunner
from src.alpha_engine.probability.probability_service import probability_service
from src.alpha_engine.live_adaptive.governance_service import get_governance_service
from src.alpha_engine.risk.risk_service import risk_service
from src.alpha_engine.execution.execution_service import execution_service

router = APIRouter(prefix="/alpha", tags=["alpha"])
logger = logging.getLogger(__name__)
DATA_DIR = (Path(__file__).resolve().parents[2] / "data").resolve()
MAX_STATE_AGE_MS = max(1000, int(os.getenv("ALPHA_MAX_STATE_AGE_MS", "3000")))


def _assert_state_fresh(symbol: str, state, *, max_age_ms: int = MAX_STATE_AGE_MS):
    now_ms = int(time.time() * 1000)
    ts = int(getattr(state, "timestamp", 0) or 0)
    if ts <= 0:
        raise HTTPException(status_code=409, detail=f"State timestamp unavailable for {symbol}")
    age = now_ms - ts
    if age > max_age_ms:
        raise HTTPException(
            status_code=409,
            detail=f"State for {symbol} is stale ({age}ms old, max {max_age_ms}ms).",
        )


def _resolve_data_file(csv_path: str) -> str:
    input_path = Path(csv_path)
    if input_path.is_absolute():
        raise HTTPException(status_code=400, detail="csv_path must be relative to backend/data")

    parts = list(input_path.parts)
    if parts and parts[0] == "data":
        input_path = Path(*parts[1:]) if len(parts) > 1 else Path("")
    if str(input_path) in {"", "."}:
        raise HTTPException(status_code=400, detail="csv_path must reference a file")

    resolved = (DATA_DIR / input_path).resolve()
    try:
        resolved.relative_to(DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="csv_path traversal is not allowed")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"CSV not found: {resolved.name}")
    return str(resolved)


def _estimate_realized_vol_pct(symbol: str) -> float:
    prices = alpha_service.price_history_cache.get(symbol, [])
    if len(prices) < 5:
        return 0.02
    returns = []
    for i in range(1, len(prices)):
        prev = prices[i - 1]
        curr = prices[i]
        if prev <= 0:
            continue
        returns.append((curr - prev) / prev)
    if len(returns) < 2:
        return 0.02
    return max(0.002, float(statistics.pstdev(returns)))


def _market_microstructure_from_state(state) -> tuple[float, float, float]:
    bids = list(state.orderbook_bids or [])
    asks = list(state.orderbook_asks or [])
    if not bids or not asks:
        imbalance = state.orderbook_imbalance if state.orderbook_imbalance else 1.0
        return 100000.0, 10.0, max(0.01, float(imbalance))

    best_bid = float(bids[0][0])
    best_ask = float(asks[0][0])
    mid = max((best_bid + best_ask) / 2.0, 1e-9)
    spread_bps = max(0.1, (best_ask - best_bid) / mid * 10_000.0)

    top_n = 20
    liquidity = sum(max(0.0, float(px) * float(sz)) for px, sz in bids[:top_n]) + \
        sum(max(0.0, float(px) * float(sz)) for px, sz in asks[:top_n])
    bid_size = sum(max(0.0, float(sz)) for _, sz in bids[:top_n])
    ask_size = sum(max(0.0, float(sz)) for _, sz in asks[:top_n])
    imbalance = (bid_size + 1e-9) / (ask_size + 1e-9)
    if state.orderbook_imbalance:
        imbalance = float(state.orderbook_imbalance)
    return max(1000.0, liquidity), spread_bps, max(0.01, imbalance)


async def _build_live_risk(
    symbol: str,
    *,
    state=None,
    conviction=None,
) -> RiskAssessment:
    if state is None:
        state = await global_state_store.get_state(symbol)
    if conviction is None:
        conviction = await conviction_service.get_conviction(symbol)
    if not state or not conviction:
        raise HTTPException(status_code=404, detail=f"Insufficient live data for {symbol}")
    _assert_state_fresh(symbol, state)

    if conviction.bias == "NEUTRAL":
        return RiskAssessment(
            symbol=symbol,
            direction="NEUTRAL",
            size_usd=0.0,
            max_leverage=3.0,
            risk_percent_equity=0.0,
            stop_loss_price=state.price,
            take_profit_price=state.price,
            breakdown=RiskBreakdown(
                edge_component=0.0,
                kelly_fraction=0.0,
                vol_adjustment=1.0,
                regime_multiplier=1.0,
                drawdown_multiplier=1.0,
                correlation_penalty=1.0,
            ),
            timestamp=int(time.time()),
        )

    probs = probability_service.calculate_probabilities(conviction)
    if not probs:
        raise HTTPException(status_code=503, detail="Probability model unavailable")

    win_prob = probs.prob_up_1pct if conviction.bias == "LONG" else probs.prob_down_1pct
    gov_service = await get_governance_service(symbol)
    active_regime = gov_service.get_health_report().active_regime
    return risk_service.calculate_risk(
        symbol=symbol,
        direction=conviction.bias,
        win_prob=win_prob,
        reward_risk_ratio=2.0,
        realized_vol_pct=_estimate_realized_vol_pct(symbol),
        current_equity=await alpha_service.get_current_equity(),
        current_regime=active_regime,
        current_price=state.price,
        active_correlations=float(getattr(risk_service, "active_positions", {}).get(symbol, 0.0)),
    )


@router.get("/footprint/{symbol}", response_model=FootprintResult)
async def get_footprint(symbol: str):
    """
    Returns real-time footprint and aggression analysis.
    Detects sweeps, absorption, and order flow imbalance.
    """
    result = await footprint_service.generate_footprint(symbol.upper())
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Footprint data for {symbol} unavailable."
        )
    return result

@router.get("/conviction/{symbol}", response_model=ConvictionResult)
async def get_conviction(symbol: str):
    """
    Synthesizes and returns the final trading bias and conviction score.
    Aggregates Regime, Liquidation, Footprint, and Funding signals.
    """
    result = await conviction_service.get_conviction(symbol.upper())
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Conviction analysis for {symbol} unavailable."
        )
    return result

@router.post("/backtest/{symbol}", response_model=BacktestReport)
async def run_alpha_backtest(symbol: str, csv_path: str = "history.csv"):
    """
    Triggers a historical replay of the Alpha Engine against a data file.
    Calculates full performance metrics including Sharpe, Drawdown, and Win Rate.
    """
    try:
        snapshots = await DataLoader.load_from_csv(_resolve_data_file(csv_path))
        report = await BacktestReportGenerator.run(symbol.upper(), snapshots)
        return report
    except HTTPException:
        raise
    except Exception:
        logger.exception("Backtest failed for symbol=%s csv_path=%s", symbol.upper(), csv_path)
        raise HTTPException(
            status_code=500,
            detail="Backtest failed."
        )

@router.get("/liquidation/{symbol}", response_model=LiquidationProjectionResult)
async def get_liquidation_projection(symbol: str):
    """
    Calculates the potential liquidation cascade impact if price moves up or down.
    Crucial for identifying short squeeze or long liquidation overflow zones.
    Uses ONLY real exchange liquidation data (Hyperliquid, Binance, Bybit, OKX via cryptofeed).
    """
    symbol_upper = symbol.upper()
    projection = await liquidation_service.get_projection(symbol_upper)

    if not projection:
        raise HTTPException(
            status_code=404,
            detail=f"No real liquidation data for {symbol} yet. Data arrives as liquidations occur on exchanges."
        )
    return projection


@router.get("/liquidation/{symbol}/stats")
async def get_liquidation_stats(symbol: str):
    """
    Returns stats about the liquidation data feeds and current data quality.
    """
    symbol_upper = symbol.upper()
    state = await global_state_store.get_state(symbol_upper)

    # Get cryptofeed service stats
    try:
        from src.services.cryptofeed_liquidation_service import cryptofeed_liquidation_service
        cf_stats = cryptofeed_liquidation_service.get_stats()
    except Exception:
        cf_stats = {"error": "cryptofeed service not available"}

    levels = (state.liquidation_levels or []) if state else []
    exchanges_in_data = set()
    for l in levels:
        exchanges_in_data.add(getattr(l, 'exchange', 'unknown'))

    return {
        "symbol": symbol_upper,
        "level_count": len(levels),
        "exchanges_in_data": sorted(exchanges_in_data),
        "cryptofeed_stats": cf_stats,
        "data_source": "real_exchange_events",
        "note": "Liquidation data comes from real exchange events only. Data accumulates as liquidations occur.",
    }

@router.post("/validate/{symbol}", response_model=WalkForwardReport)
async def run_alpha_validation(symbol: str, csv_path: str = "history.csv"):
    """
    Executes a walk-forward validation (Phase 6).
    Optimizes weights on rolling training windows and validates on forward test data.
    """
    try:
        snapshots = await DataLoader.load_from_csv(_resolve_data_file(csv_path))
        report = await WalkForwardRunner.run(symbol.upper(), snapshots)
        return report
    except HTTPException:
        raise
    except Exception:
        logger.exception("Walk-forward validation failed for symbol=%s csv_path=%s", symbol.upper(), csv_path)
        raise HTTPException(
            status_code=500,
            detail="Walk-forward validation failed."
        )

@router.get("/probability/{symbol}", response_model=ProbabilityResult)
async def get_alpha_probability(symbol: str):
    """
    Returns probabilistic forecasts for directional price moves and squeeze intensity.
    Calculates likelihood of +/- 1% moves using a calibrated statistical model.
    """
    result = await probability_service.get_probabilities(symbol.upper())
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Probability data for {symbol} unavailable."
        )
    return result

@router.get("/governance/{symbol}", response_model=GovernanceReport)
async def get_alpha_governance(symbol: str):
    """
    Returns the live model governance report.
    Tracks feature drift, calibration health, and active macro regimes.
    """
    service = await get_governance_service(symbol.upper())
    return service.get_health_report()

@router.get("/risk/{symbol}", response_model=RiskAssessment)
async def get_risk_sizing(symbol: str):
    """
    Returns the recommended dynamic position size and risk breakdown.
    Factors in Edge, Volatility, Regime, Drawdown, and Correlation.
    """
    return await _build_live_risk(symbol.upper())

@router.post("/execute/{symbol}", response_model=ExecutionPlan)
async def generate_execution_plan(symbol: str):
    """
    Generates an optimized execution plan for a theoretical trade.
    Simulates market impact, urgency, slicing, and safety checks.
    """
    symbol = symbol.upper()
    state = await global_state_store.get_state(symbol)
    conviction = await conviction_service.get_conviction(symbol)
    if not state or not conviction:
        raise HTTPException(status_code=404, detail=f"Insufficient live data for {symbol}")
    _assert_state_fresh(symbol, state)
    if not state.orderbook_bids or not state.orderbook_asks:
        raise HTTPException(status_code=409, detail=f"Orderbook unavailable for {symbol}.")

    risk_assessment = await _build_live_risk(symbol, state=state, conviction=conviction)
    if risk_assessment.direction == "NEUTRAL" or risk_assessment.size_usd <= 0:
        raise HTTPException(status_code=422, detail=f"No executable directional setup for {symbol}")

    liquidity_usd, spread_bps, imbalance = _market_microstructure_from_state(state)
    gov_service = await get_governance_service(symbol)
    direction = "BUY" if risk_assessment.direction == "LONG" else "SELL"
    impulse_strength = min(1.0, abs(conviction.components.get("footprint").score if conviction.components.get("footprint") else 0.0))
    footprint = await footprint_service.generate_footprint(symbol)
    recent_sweep_detected = bool(footprint and footprint.sweep and footprint.sweep.event)
    probability_decay_per_min = max(0.0, _estimate_realized_vol_pct(symbol) * 0.5)

    return execution_service.generate_plan(
        symbol=symbol,
        direction=direction,
        size_usd=risk_assessment.size_usd,
        available_liquidity_usd=liquidity_usd,
        spread_bps=spread_bps,
        volatility_bps=max(1.0, _estimate_realized_vol_pct(symbol) * 10_000.0),
        book_imbalance=imbalance,
        conviction_score=conviction.confidence,
        impulse_strength=impulse_strength,
        regime=gov_service.get_health_report().active_regime,
        probability_decay_per_min=probability_decay_per_min,
        recent_sweep_detected=recent_sweep_detected,
    )

@router.get("/orderbook/{symbol}")
async def get_orderbook_levels(symbol: str):
    """
    Returns orderbook levels for a symbol.
    """
    symbol = symbol.upper()
    state = await global_state_store.get_state(symbol)
    if not state:
        raise HTTPException(status_code=404, detail="Symbol not tracked")
    
    return {
        "symbol": symbol,
        "imbalance": state.orderbook_imbalance,
        "bids": [
            {"price": p, "size": s} 
            for p, s in (state.orderbook_bids or [])[:15]
        ],
        "asks": [
            {"price": p, "size": s} 
            for p, s in (state.orderbook_asks or [])[:15]
        ],
    }

@router.get("/liquidations/{symbol}")
async def get_liquidation_levels(symbol: str):
    """
    Returns liquidation levels for a symbol.
    """
    symbol = symbol.upper()
    state = await global_state_store.get_state(symbol)
    if not state:
        raise HTTPException(status_code=404, detail="Symbol not tracked")
    
    levels = state.liquidation_levels or []
    return {
        "symbol": symbol,
        "count": len(levels),
        "levels": [
            {
                "price": l.price,
                "notional": l.notional,
                "side": l.side,
            }
            for l in levels[-20:]  # Last 20 levels
        ]
    }

@router.get("/state/{symbol}")
async def get_alpha_state(symbol: str):
    """
    Returns raw market state data - use to verify what's populated.
    """
    symbol = symbol.upper()
    state = await global_state_store.get_state(symbol)
    if not state:
        raise HTTPException(status_code=404, detail="Symbol not tracked")
    
    # Return key fields
    return {
        "symbol": state.symbol,
        "price": state.price,
        "mark_price": state.mark_price,
        "funding_rate": state.funding_rate,
        "open_interest": state.open_interest,
        "open_interest_hl": state.open_interest_hl,
        "cvd_1m": state.cvd_1m,
        "cvd_hl_1m": state.cvd_hl_1m,
        "cvd_spot_composite_1m": state.cvd_spot_composite_1m,
        "aggressive_buy_volume_1m": state.aggressive_buy_volume_1m,
        "aggressive_sell_volume_1m": state.aggressive_sell_volume_1m,
        "orderbook_imbalance": state.orderbook_imbalance,
        "orderbook_bids_count": len(state.orderbook_bids or []),
        "orderbook_asks_count": len(state.orderbook_asks or []),
        "trade_stream_count": len(state.trade_stream_recent or []),
        "liquidation_levels_count": len(state.liquidation_levels or []),
        "liquidation_levels_sample": [
            {"price": l.price, "side": l.side, "notional": l.notional, "exchange": l.exchange}
            for l in (state.liquidation_levels or [])[:5]
        ],
        "timestamp": state.timestamp,
    }


@router.get("/debug/{symbol}")
async def get_alpha_debug(symbol: str):
    """
    Returns full internal signal pipeline state for auditing.
    """
    symbol = symbol.upper()
    state = await global_state_store.get_state(symbol)
    if not state:
        raise HTTPException(status_code=404, detail="Symbol not tracked")
        
    signal = await alpha_service.generate_signal(symbol)
    conviction = await conviction_service.get_conviction(symbol)
    gov_service = await get_governance_service(symbol)
    
    probs = None
    if conviction:
        probs = probability_service.calculate_probabilities(conviction)
    
    return {
        "market_state": asdict(state) if state else None,
        "regime_signal": signal.model_dump() if signal else None,
        "conviction": conviction.model_dump() if conviction else None,
        "governance": gov_service.get_health_report().model_dump() if gov_service else None,
        "probabilities": probs.model_dump() if probs else None
    }


# ============================================================
# SIMPLIFIED ALPHA ENDPOINTS
# ============================================================

from src.alpha_engine.models.simplified_models import SimplifiedSignal, SignalStrength
from src.alpha_engine.services.simplified_alpha_service import simplified_alpha_service

@router.get("/simplified/{symbol}", response_model=SimplifiedSignal)
async def get_simplified_signal(symbol: str):
    """
    Returns a simplified, actionable trading signal.
    
    - BUY/SELL/WAIT signal
    - Entry price, stop loss, target
    - Risk:Reward ratio
    - Confidence level
    
    Use this for systematic/automated trading.
    """
    signal = await simplified_alpha_service.generate_signal(symbol.upper())
    if not signal:
        raise HTTPException(status_code=404, detail=f"Unable to generate signal for {symbol}")
    return signal


@router.get("/simplified/{symbol}/history", response_model=SignalStrength)
async def get_signal_history(symbol: str):
    """
    Returns historical signal statistics for a symbol.
    """
    return simplified_alpha_service.get_signal_history(symbol.upper())


@router.get("/simplified/batch")
async def get_batch_simplified_signals(symbols: str = "BTC,ETH,SOL"):
    """
    Returns simplified signals for multiple symbols.
    Example: /alpha/simplified/batch?symbols=BTC,ETH,SOL
    """
    symbol_list = [s.strip().upper() for s in symbols.split(",")]
    results = {}
    
    for symbol in symbol_list:
        signal = await simplified_alpha_service.generate_signal(symbol)
        if signal:
            results[symbol] = signal
    
    return results


# Batch endpoint for multiple symbols
@router.get("/batch")
async def get_batch_signals(symbols: str = "BTC,ETH,SOL"):
    """
    Returns conviction signals for multiple symbols.
    Example: /alpha/batch?symbols=BTC,ETH,SOL
    """
    symbol_list = [s.strip().upper() for s in symbols.split(",")]
    results = {}
    
    for symbol in symbol_list:
        try:
            # Get conviction for each symbol
            conviction = await conviction_service.get_conviction(symbol)
            if conviction:
                results[symbol] = conviction.model_dump()
        except Exception as e:
            logger.warning(f"Failed to get conviction for {symbol}: {e}")
            continue
    
    return results


from pydantic import BaseModel as PydanticBase

class AutonomousTriggerRequest(PydanticBase):
    symbol: str
    direction: str
    conviction_score: int

@router.post("/autonomous/trigger")
async def autonomous_trigger(req: AutonomousTriggerRequest):
    """
    Frontend autonomous execution trigger.
    Forces a pipeline run for the given symbol. The backend's
    _check_and_execute_auto_trade handles actual execution with safety gates:
    - auto_mode must be enabled in user risk settings
    - conviction.score must be >= 65
    - minimum size $5
    - valid HyperLiquid client
    """
    symbol = req.symbol.upper()
    logger.info(
        "autonomous_trigger symbol=%s direction=%s score=%d",
        symbol, req.direction, req.conviction_score,
    )

    # Force a pipeline run — this will invoke _check_and_execute_auto_trade internally
    try:
        await alpha_service._safe_run_pipeline(symbol)
    except Exception as e:
        logger.error(f"Autonomous trigger pipeline failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "triggered",
        "symbol": symbol,
        "direction": req.direction,
        "conviction_score": req.conviction_score,
    }

@router.get("/{symbol}", response_model=AlphaSignal)
async def get_alpha_signals(symbol: str):
    """
    Returns the current Alpha Engine status for a given symbol.
    Includes Price/OI Regime classification and Volatility Compression scoring.
    """
    signal = await alpha_service.generate_signal(symbol.upper())
    if not signal:
        raise HTTPException(
            status_code=404, 
            detail=f"Alpha state for {symbol} not initialized or inactive."
        )
    return signal

