import time
import asyncio
import logging
import statistics
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List, Literal, Set, Tuple, Any
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.processors.oi_price_regime import OIRegimeClassifier
from src.alpha_engine.processors.volatility_regime import VolatilityDetector
from src.alpha_engine.processors.liquidation_projection import LiquidationProjector
from src.alpha_engine.processors.sweep_detector import SweepDetector
from src.alpha_engine.processors.absorption_detector import AbsorptionDetector
from src.alpha_engine.processors.flow_imbalance import FlowImbalanceProcessor
from src.alpha_engine.processors.impulse_detector import ImpulseDetector
from src.alpha_engine.processors.conviction_engine import ConvictionEngine

from src.alpha_engine.models.regime_models import AlphaSignal
from src.alpha_engine.models.footprint_models import FootprintResult, Trade
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult

from src.alpha_engine.probability.probability_service import probability_service
from src.alpha_engine.risk.risk_service import risk_service
from src.alpha_engine.execution.execution_service import execution_service
from src.alpha_engine.live_adaptive.governance_service import get_governance_service
from config import config

from src.services.event_bus import event_bus

logger = logging.getLogger(__name__)
# Backward-compatibility seam for legacy tests/integrations that patch ws_manager.
# Runtime fanout is handled by event_bus + event_relay, so this remains optional.
ws_manager = None

class AlphaService:
    """
    Central Intelligence Hub.
    Orchestrates the entire Alpha Engine pipeline:
    Data -> Processors -> Conviction -> Probability -> Risk -> Execution -> Frontend
    """
    
    def __init__(self):
        self.price_history_cache: Dict[str, List[float]] = {}
        self.volume_history_cache: Dict[str, List[float]] = {}
        self.cvd_history_cache: Dict[str, List[float]] = {}
        self.oi_history_cache: Dict[str, List[float]] = {}
        self.oi_time_cache: Dict[str, List[Tuple[int, float]]] = {}
        self.trade_history_cache: Dict[str, List[Trade]] = {}
        self.imbalance_history_cache: Dict[str, List[float]] = {}
        self.funding_history_cache: Dict[str, List[float]] = {}
        self.max_history = 100 
        self._running_symbols: Set[str] = set()
        self._pending_symbols: Set[str] = set()
        self._last_metrics_log_ms: Dict[str, int] = {}
        self._equity_cache_usd = max(float(getattr(risk_service, "fallback_equity", 100000.0)), 1000.0)
        self._equity_cache_ms = 0
        self._equity_refresh_ms = max(1000, int(os.getenv("RISK_EQUITY_REFRESH_MS", "15000")))
        self._equity_stale_grace_ms = max(self._equity_refresh_ms, int(os.getenv("RISK_EQUITY_STALE_GRACE_MS", "300000")))
        self._last_equity_log_ms = 0

    @staticmethod
    def _safe_float(value: object, default: float = 0.0) -> float:
        try:
            parsed = float(value)  # type: ignore[arg-type]
        except Exception:
            return default
        return parsed if parsed == parsed else default

    @staticmethod
    def _masked_addr(addr: str) -> str:
        if len(addr) <= 10:
            return addr
        return f"{addr[:6]}...{addr[-4:]}"

    @staticmethod
    def _resolve_equity_address() -> Optional[str]:
        candidates = [
            os.getenv("RISK_ACCOUNT_ADDRESS"),
            os.getenv("ALPHA_RISK_ACCOUNT_ADDRESS"),
            getattr(config, "HL_ACCOUNT_ADDRESS", None),
        ]
        for raw in candidates:
            addr = str(raw or "").strip()
            if not addr:
                continue
            lowered = addr.lower()
            if lowered in {"0x...", "your_hl_account_address_here", "changeme"}:
                continue
            return addr
        return None

    async def _fetch_hl_account_equity(self, address: str) -> Optional[float]:
        try:
            from src.manager import manager as trader_manager
            hl_client = getattr(trader_manager, "hl_client", None)
            if not hl_client:
                return None
            state = await asyncio.to_thread(hl_client.get_user_state, address)
        except Exception as exc:
            logger.warning("risk_equity_fetch_failed address=%s err=%s", self._masked_addr(address), exc)
            return None

        if not isinstance(state, dict):
            return None

        margin_summary = state.get("marginSummary") or {}
        cross_summary = state.get("crossMarginSummary") or {}
        for candidate in (
            margin_summary.get("accountValue"),
            cross_summary.get("accountValue"),
            margin_summary.get("withdrawable"),
            cross_summary.get("withdrawable"),
            state.get("accountValue"),
        ):
            equity = self._safe_float(candidate, 0.0)
            if equity > 0:
                return equity
        return None

    async def get_current_equity(self) -> float:
        now_ms = int(time.time() * 1000)
        fallback = max(float(getattr(risk_service, "fallback_equity", 100000.0)), 1000.0)

        if (now_ms - self._equity_cache_ms) <= self._equity_refresh_ms and self._equity_cache_usd > 0:
            return self._equity_cache_usd

        address = self._resolve_equity_address()
        if not address:
            return fallback

        equity = await self._fetch_hl_account_equity(address)
        if equity and equity > 0:
            self._equity_cache_usd = equity
            self._equity_cache_ms = now_ms
            risk_service.sync_portfolio_state(current_equity=equity)
            if now_ms - self._last_equity_log_ms > 60_000:
                self._last_equity_log_ms = now_ms
                logger.info(
                    "risk_equity_source source=hyperliquid address=%s equity_usd=%.2f",
                    self._masked_addr(address),
                    equity,
                )
            return equity

        if self._equity_cache_usd > 0 and (now_ms - self._equity_cache_ms) <= self._equity_stale_grace_ms:
            return self._equity_cache_usd

        if now_ms - self._last_equity_log_ms > 60_000:
            self._last_equity_log_ms = now_ms
            logger.warning("risk_equity_source source=fallback equity_usd=%.2f", fallback)
        return fallback

    async def update_market_state(self, symbol: str, data: Dict):
        """
        Main entry point for real-time updates.
        """
        symbol = symbol.upper()
        enriched = dict(data)
        enriched.update(self._build_trade_derived_updates(symbol, data))
        enriched.update(self._build_oi_derived_updates(symbol, enriched))

        # 1. Update State Store
        await global_state_store.update_state(symbol, enriched)
        
        # 2. Maintain Local History (for volatility calculation)
        self._update_history(symbol, enriched)
        
        # 3. Trigger Intelligence Pipeline
        # Trigger on significant events: trades, orderbook shifts, or OI updates
        if any(k in enriched for k in ["trade_update", "orderbook_bids", "open_interest", "liquidation_event"]):
             if symbol in self._running_symbols:
                 self._pending_symbols.add(symbol)
             else:
                 asyncio.create_task(self._safe_run_pipeline(symbol))

    async def _safe_run_pipeline(self, symbol: str):
        if symbol in self._running_symbols:
            return
        self._running_symbols.add(symbol)
        try:
            while True:
                self._pending_symbols.discard(symbol)
                try:
                    started_at = time.perf_counter()
                    await self._run_pipeline(symbol)
                    duration_ms = (time.perf_counter() - started_at) * 1000.0
                    now_ms = int(time.time() * 1000)
                    last_log = self._last_metrics_log_ms.get(symbol, 0)
                    if now_ms - last_log > 10_000:
                        self._last_metrics_log_ms[symbol] = now_ms
                        logger.info(
                            "alpha_pipeline_metrics symbol=%s duration_ms=%.2f pending=%s price_hist=%s",
                            symbol,
                            duration_ms,
                            symbol in self._pending_symbols,
                            len(self.price_history_cache.get(symbol, [])),
                        )
                except Exception:
                    logger.exception("Alpha pipeline failed for symbol=%s", symbol)
                # Throttling: Wait at least 200ms before next run for this symbol
                await asyncio.sleep(0.2)
                if symbol not in self._pending_symbols:
                    break
        finally:
            self._running_symbols.discard(symbol)
            self._pending_symbols.discard(symbol)

    def _update_history(self, symbol: str, data: Dict):
        price = data.get("price")
        if price is not None:
            if symbol not in self.price_history_cache: self.price_history_cache[symbol] = []
            self.price_history_cache[symbol].append(price)
            if len(self.price_history_cache[symbol]) > self.max_history: self.price_history_cache[symbol].pop(0)

        oi = data.get("open_interest")
        if oi is not None:
            if symbol not in self.oi_history_cache: self.oi_history_cache[symbol] = []
            self.oi_history_cache[symbol].append(oi)
            if len(self.oi_history_cache[symbol]) > self.max_history: self.oi_history_cache[symbol].pop(0)

        vol = data.get("volume", 0)
        if vol > 0:
            if symbol not in self.volume_history_cache: self.volume_history_cache[symbol] = []
            self.volume_history_cache[symbol].append(vol)
            if len(self.volume_history_cache[symbol]) > self.max_history: self.volume_history_cache[symbol].pop(0)

        cvd = data.get("cvd_1m")
        if cvd is not None:
            if symbol not in self.cvd_history_cache: self.cvd_history_cache[symbol] = []
            self.cvd_history_cache[symbol].append(cvd)
            if len(self.cvd_history_cache[symbol]) > self.max_history: self.cvd_history_cache[symbol].pop(0)

        funding = data.get("funding_rate")
        if funding is not None:
            if symbol not in self.funding_history_cache:
                self.funding_history_cache[symbol] = []
            self.funding_history_cache[symbol].append(float(funding))
            if len(self.funding_history_cache[symbol]) > self.max_history:
                self.funding_history_cache[symbol].pop(0)

    def _build_oi_derived_updates(self, symbol: str, data: Dict) -> Dict:
        oi = data.get("open_interest")
        if oi is None:
            return {}

        raw_ts = data.get("timestamp")
        ts_ms = int(raw_ts) if raw_ts is not None else int(time.time() * 1000)
        oi_val = float(oi)
        series = self.oi_time_cache.setdefault(symbol, [])
        series.append((ts_ms, oi_val))

        cutoff_keep = ts_ms - 5 * 60 * 1000
        while len(series) > 1 and series[0][0] < cutoff_keep:
            series.pop(0)

        def _baseline(cutoff_ms: int) -> float:
            baseline = series[0][1]
            for s_ts, s_oi in series:
                if s_ts <= cutoff_ms:
                    baseline = s_oi
                else:
                    break
            return baseline

        baseline_1m = _baseline(ts_ms - 60 * 1000)
        baseline_5m = _baseline(ts_ms - 5 * 60 * 1000)
        return {
            "oi_delta_1m": oi_val - baseline_1m,
            "oi_delta_5m": oi_val - baseline_5m,
        }

    def _build_trade_derived_updates(self, symbol: str, data: Dict) -> Dict:
        def _float_opt(value) -> Optional[float]:
            if value is None:
                return None
            try:
                return float(value)
            except Exception:
                return None

        def _spot_fields() -> Dict:
            out: Dict[str, float | str] = {}
            for key in (
                "cvd_spot_binance_1m",
                "cvd_spot_binance_5m",
                "cvd_spot_coinbase_1m",
                "cvd_spot_coinbase_5m",
                "cvd_spot_composite_1m",
                "cvd_spot_composite_5m",
            ):
                val = _float_opt(data.get(key))
                if val is not None:
                    out[key] = val
            return out

        trade_update = data.get("trade_update")
        if trade_update is None:
            spot = _spot_fields()
            comp_1m = _float_opt(data.get("cvd_spot_composite_1m"))
            comp_5m = _float_opt(data.get("cvd_spot_composite_5m"))
            if comp_1m is not None and comp_5m is not None:
                spot["cvd_1m"] = comp_1m
                spot["cvd_5m"] = comp_5m
                spot["cvd_source"] = "spot_composite"
            return spot

        def _to_utc(ts: datetime) -> datetime:
            return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)

        trade: Optional[Trade] = None
        if isinstance(trade_update, Trade):
            trade = Trade(
                price=float(trade_update.price),
                size=float(trade_update.size),
                side=trade_update.side,
                timestamp=_to_utc(trade_update.timestamp),
            )
        elif isinstance(trade_update, dict):
            try:
                raw_ts = trade_update.get("timestamp")
                if isinstance(raw_ts, datetime):
                    ts = _to_utc(raw_ts)
                else:
                    ts = datetime.fromtimestamp(float(raw_ts) / 1000.0, tz=timezone.utc)
                trade = Trade(
                    price=float(trade_update["price"]),
                    size=float(trade_update["size"]),
                    side=str(trade_update["side"]).upper(),
                    timestamp=ts,
                )
            except Exception:
                return {}
        else:
            return {}

        trades = self.trade_history_cache.setdefault(symbol, [])
        trades.append(trade)

        now = trade.timestamp
        cutoff_keep = now - timedelta(minutes=6)
        if trades and (trades[0].timestamp < cutoff_keep or len(trades) > 50000):
            trades[:] = [t for t in trades if t.timestamp >= cutoff_keep]
            if len(trades) > 50000:
                trades[:] = trades[-50000:]

        cutoff_1m = now - timedelta(seconds=60)
        cutoff_5m = now - timedelta(minutes=5)
        buy_1m = sum(t.size for t in trades if t.timestamp >= cutoff_1m and t.side == "BUY")
        sell_1m = sum(t.size for t in trades if t.timestamp >= cutoff_1m and t.side == "SELL")
        hl_cvd_1m = sum(t.size if t.side == "BUY" else -t.size for t in trades if t.timestamp >= cutoff_1m)
        hl_cvd_5m = sum(t.size if t.side == "BUY" else -t.size for t in trades if t.timestamp >= cutoff_5m)

        result: Dict[str, float | str | List[Trade]] = {
            "trade_stream_recent": list(trades),
            "aggressive_buy_volume_1m": buy_1m,
            "aggressive_sell_volume_1m": sell_1m,
            "cvd_hl_1m": hl_cvd_1m,
            "cvd_hl_5m": hl_cvd_5m,
        }

        result.update(_spot_fields())
        comp_1m = _float_opt(data.get("cvd_spot_composite_1m"))
        comp_5m = _float_opt(data.get("cvd_spot_composite_5m"))
        if comp_1m is not None and comp_5m is not None:
            result["cvd_1m"] = comp_1m
            result["cvd_5m"] = comp_5m
            result["cvd_source"] = "spot_composite"
        else:
            result["cvd_1m"] = hl_cvd_1m
            result["cvd_5m"] = hl_cvd_5m
            result["cvd_source"] = "hl"
        return result

    def _estimate_realized_vol_pct(self, symbol: str) -> float:
        prices = self.price_history_cache.get(symbol, [])
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

    @staticmethod
    def _estimate_liquidity_spread_imbalance(state) -> Tuple[float, float, float]:
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
        bid_notional = sum(max(0.0, float(px) * float(sz)) for px, sz in bids[:top_n])
        ask_notional = sum(max(0.0, float(px) * float(sz)) for px, sz in asks[:top_n])
        liquidity_usd = max(1000.0, bid_notional + ask_notional)

        bid_size = sum(max(0.0, float(sz)) for _, sz in bids[:top_n])
        ask_size = sum(max(0.0, float(sz)) for _, sz in asks[:top_n])
        imbalance_ratio = (bid_size + 1e-9) / (ask_size + 1e-9)
        if state.orderbook_imbalance:
            imbalance_ratio = max(0.01, float(state.orderbook_imbalance))

        return liquidity_usd, spread_bps, max(0.01, imbalance_ratio)

    async def generate_signal(self, symbol: str) -> Optional[AlphaSignal]:
        """
        Calculates the current Alpha signal (Regime + Volatility) for a symbol.
        Used by sync/on-demand services.
        """
        state = await global_state_store.get_state(symbol)
        if not state or not self.price_history_cache.get(symbol):
            return None

        p_hist = self.price_history_cache[symbol]
        p_1m_ago = p_hist[max(0, len(p_hist)-60)] # Approx 1m if 1s updates
        
        v_hist = self.volume_history_cache.get(symbol, [])
        oi_res = OIRegimeClassifier.classify(state, p_1m_ago)
        vol_res = VolatilityDetector.detect(state, p_hist, v_hist)
        
        return AlphaSignal(
            symbol=symbol,
            regime=oi_res["regime"],
            regime_confidence=oi_res["confidence"],
            volatility_regime=vol_res["volatility_regime"],
            compression_score=vol_res["compression_score"],
            timestamp=state.timestamp or int(time.time() * 1000)
        )

    async def _run_pipeline(self, symbol: str):
        state = await global_state_store.get_state(symbol)
        if not state: return

        # --- A. Signal Generation (Microstructure) ---
        
        # 1. Regime & Volatility
        p_hist = self.price_history_cache.get(symbol, [state.price]*10)
        v_hist = self.volume_history_cache.get(symbol, [100.0]*10)
        
        # OIRegime needs price comparison
        last_price = p_hist[-5] if len(p_hist) > 5 else state.price
        oi_res = OIRegimeClassifier.classify(state, last_price)
        vol_res = VolatilityDetector.detect(state, p_hist, v_hist)
        
        regime_sig = AlphaSignal(
            symbol=symbol,
            regime=oi_res["regime"],
            regime_confidence=oi_res["confidence"],
            volatility_regime=vol_res["volatility_regime"],
            compression_score=vol_res["compression_score"],
            timestamp=state.timestamp or int(time.time() * 1000)
        )

        # 2. Liquidation Projection
        liq_res = LiquidationProjector.project(state)
        
        # 3. Footprint Analysis
        sweep = SweepDetector.detect(state)
        absorption = AbsorptionDetector.detect(state)
        
        # Maintain Imbalance History
        imb_hist = self.imbalance_history_cache.get(symbol, [])
        imbalance = FlowImbalanceProcessor.compute(state, imb_hist)
        
        # Update imbalance history
        if symbol not in self.imbalance_history_cache: self.imbalance_history_cache[symbol] = []
        self.imbalance_history_cache[symbol].append(imbalance.imbalance_ratio)
        if len(self.imbalance_history_cache[symbol]) > 50: self.imbalance_history_cache[symbol].pop(0)
        
        # Impulse Detection (Requires previous state)
        cvd_hist = self.cvd_history_cache.get(symbol, [state.cvd_1m]*5)
        prev_p = p_hist[-2] if len(p_hist) >= 2 else state.price
        prev_cvd = cvd_hist[-2] if len(cvd_hist) >= 2 else state.cvd_1m
        impulse = ImpulseDetector.detect(state, prev_cvd, prev_p)
        
        footprint_res = FootprintResult(
            symbol=symbol,
            sweep=sweep,
            absorption=absorption,
            imbalance=imbalance,
            impulse=impulse,
            timestamp=state.timestamp or int(time.time() * 1000)
        )

        # --- B. Conviction Synthesis ---
        
        conviction = ConvictionEngine.analyze(
            symbol=symbol,
            regime_sig=regime_sig,
            liq_sig=liq_res,
            footprint_sig=footprint_res,
            funding_rate=state.funding_rate,
            funding_mean=(
                sum(self.funding_history_cache.get(symbol, [state.funding_rate]))
                / max(1, len(self.funding_history_cache.get(symbol, [state.funding_rate])))
            ),
            funding_std=max(
                0.00001,
                statistics.pstdev(self.funding_history_cache.get(symbol, [state.funding_rate]))
                if len(self.funding_history_cache.get(symbol, [])) > 1
                else 0.00001,
            ),
        )
        
        # --- C. Probability & Governance ---
        
        probs = probability_service.calculate_probabilities(conviction)
        
        gov_service = await get_governance_service(symbol)
        gov_report = gov_service.get_health_report()
        
        # --- D. Risk & Execution ---
        
        # Only calc risk/exec if we have a directional view
        risk_data = None
        exec_plan = None
        
        if conviction.bias != "NEUTRAL":
            direction = conviction.bias
            # Map LONG/SHORT to BUY/SELL for execution_service
            exec_direction: Literal["BUY", "SELL"] = "BUY" if direction == "LONG" else "SELL"
            
            history_vol = self._estimate_realized_vol_pct(symbol)
            available_liquidity_usd, spread_bps, book_imbalance = self._estimate_liquidity_spread_imbalance(state)
            current_equity = await self.get_current_equity()
            current_regime = gov_report.active_regime if isinstance(gov_report.active_regime, str) else "NORMAL_MARKET"
            
            risk_data = risk_service.calculate_risk(
                symbol=symbol,
                direction=direction, # risk_service accepts LONG/SHORT
                win_prob=probs.prob_up_1pct if direction == "LONG" else probs.prob_down_1pct,
                reward_risk_ratio=2.0, # Target 2:1
                realized_vol_pct=history_vol,
                current_equity=current_equity,
                current_regime=current_regime,
                current_price=state.price,
                active_correlations=0.0
            )
            logger.info(
                "risk_sizing symbol=%s dir=%s equity=%.2f size_usd=%.2f risk_pct=%.4f max_pos_cap=%.2f max_lev=%.2f",
                symbol,
                direction,
                current_equity,
                float(getattr(risk_data, "size_usd", 0.0)),
                float(getattr(risk_data, "risk_percent_equity", 0.0)),
                float(getattr(risk_service, "max_position_usd", 0.0)),
                float(getattr(risk_service, "max_leverage", 0.0)),
            )
            
            exec_plan = execution_service.generate_plan(
                symbol=symbol,
                direction=exec_direction, # Pass BUY/SELL
                size_usd=risk_data.size_usd,
                available_liquidity_usd=available_liquidity_usd,
                spread_bps=spread_bps,
                volatility_bps=max(1.0, history_vol * 10_000.0),
                book_imbalance=book_imbalance,
                conviction_score=conviction.confidence,
                impulse_strength=min(1.0, abs(footprint_res.impulse.strength)),
                regime=gov_report.active_regime,
                probability_decay_per_min=max(0.0, vol_res.get("realized_vol", history_vol) * 0.5),
                recent_sweep_detected=footprint_res.sweep.event is not None,
            )

        # --- E. Broadcast to Frontend ---

        # 1. Alpha Conviction (Radar)
        await self._publish_event(
            event_type="alpha_conviction",
            symbol=symbol,
            data={
                "symbol": symbol,
                "bias": conviction.bias,
                "score": conviction.score,
                "conviction_score": conviction.confidence * (1 if conviction.bias == "LONG" else -1),
                "regime": gov_report.active_regime,
                "expected_move": probs.expected_move,
                "prob_up_1pct": probs.prob_up_1pct,
                "prob_down_1pct": probs.prob_down_1pct,
                "realized_vol": vol_res.get("realized_vol", 0.02),
                "timestamp": conviction.timestamp,
            },
        )

        # 2. Governance Update
        await self._publish_event(
            event_type="gov_update",
            symbol=symbol,
            data={
                "symbol": symbol,
                "active_regime": gov_report.active_regime,
                "active_model_id": gov_report.active_model_id,
                "calibration_status": gov_report.calibration_status,
                "feature_drift": {},
            },
        )

        # 3. Risk Update (if active)
        if risk_data:
            risk_pct = float(getattr(risk_data, "risk_percent_equity", 0.0))
            if risk_pct <= 1.0:
                risk_pct *= 100.0
            await self._publish_event(
                event_type="risk_update",
                symbol=symbol,
                data={
                    "symbol": symbol,
                    "direction": getattr(risk_data, "direction", "NEUTRAL"),
                    "size_usd": float(getattr(risk_data, "size_usd", 0.0)),
                    "leverage": float(getattr(risk_data, "max_leverage", 0.0)),
                    "risk_percent_equity": round(risk_pct, 4),
                    "breakdown": (
                        risk_data.breakdown.model_dump()
                        if getattr(risk_data, "breakdown", None) is not None and hasattr(risk_data.breakdown, "model_dump")
                        else {
                            "edge_component": 0.0,
                            "kelly_fraction": 0.0,
                            "vol_adjustment": 0.0,
                            "regime_multiplier": 0.0,
                            "drawdown_multiplier": 0.0,
                            "correlation_penalty": 0.0,
                        }
                    ),
                    "equity_used": current_equity if conviction.bias != "NEUTRAL" else 0.0,
                    "max_position_cap_usd": float(getattr(risk_service, "max_position_usd", 0.0)),
                    "timestamp": int(getattr(risk_data, "timestamp", int(time.time()))),
                },
            )

        # 4. Execution Plan (if active)
        if exec_plan and risk_data:
            await self._publish_event(
                event_type="exec_plan",
                symbol=symbol,
                data={
                    "symbol": symbol,
                    "direction": getattr(exec_plan, "direction", "BUY" if conviction.bias == "LONG" else "SELL"),
                    "strategy": getattr(exec_plan, "strategy", "PASSIVE"),
                    "total_size_usd": float(getattr(exec_plan, "total_size_usd", 0.0)),
                    "urgency_score": float(getattr(getattr(exec_plan, "urgency_metrics", None), "urgency_score", 0.0)),
                    "slippage_metrics": {
                       "expected_impact_bps": float(getattr(getattr(exec_plan, "slippage_metrics", None), "expected_impact_bps", 0.0)),
                       "expected_impact_usd": float(getattr(getattr(exec_plan, "slippage_metrics", None), "expected_impact_usd", 0.0)),
                    },
                    "adverse_selection_checks": getattr(exec_plan, "adverse_selection_checks", {}),
                    "timestamp": (
                        int(exec_plan.timestamp.timestamp() * 1000)
                        if getattr(exec_plan, "timestamp", None) is not None and hasattr(exec_plan.timestamp, "timestamp")
                        else int(time.time() * 1000)
                    ),
                    "slices": [
                        s.model_dump() if hasattr(s, "model_dump") else dict(s)
                        for s in list(getattr(exec_plan, "slices", []))
                    ],
                },
            )
        
        # --- F. Data Integrity Audit Log ---
        audit_log = {
            "symbol": symbol,
            "regime_score": conviction.components.get("regime").score if conviction.components.get("regime") else 0,
            "liquidation_score": conviction.components.get("liquidation").score if conviction.components.get("liquidation") else 0,
            "footprint_score": conviction.components.get("footprint").score if conviction.components.get("footprint") else 0,
            "funding_score": conviction.components.get("funding").score if conviction.components.get("funding") else 0,
            "volatility_score": conviction.components.get("volatility").score if conviction.components.get("volatility") else 0,
            "final_conviction_score": conviction.score,
            "probability_up": probs.prob_up_1pct if probs else 0.5,
            "probability_down": probs.prob_down_1pct if probs else 0.5,
            "expected_move": probs.expected_move if probs else 0,
            "recommended_size": risk_data.size_usd if risk_data else 0
        }
        logger.info("alpha_audit %s", audit_log)

    async def _publish_event(
        self,
        *,
        event_type: str,
        symbol: str,
        data: Dict[str, Any],
        channel: str = "public",
    ) -> None:
        await event_bus.publish(
            event_type,
            data,
            source="alpha_engine",
            channel=channel,
            symbol=symbol,
        )

        # Optional bridge for legacy module-level monkeypatching in tests.
        manager = ws_manager
        if manager is None or not hasattr(manager, "broadcast"):
            return
        try:
            await manager.broadcast({"type": event_type, "data": data})
        except Exception:
            logger.debug("legacy_ws_broadcast_failed event_type=%s symbol=%s", event_type, symbol, exc_info=True)
alpha_service = AlphaService()
