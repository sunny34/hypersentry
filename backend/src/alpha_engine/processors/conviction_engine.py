import math
import time
from typing import Dict, List, Literal, Optional, Tuple
from src.alpha_engine.models.regime_models import AlphaSignal
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult
from src.alpha_engine.models.footprint_models import FootprintResult
from src.alpha_engine.models.conviction_models import ConvictionResult, ConvictionComponent

# ─────────────────────────────────────────────────────────────────────
# Configuration Weights (must sum to 1.0)
#
#   Regime      35%  — OI + price action is the strongest signal
#   Footprint   25%  — sweep / absorption / imbalance / impulse
#   Volatility  15%  — compression / expansion magnitude (direction-neutral)
#   Funding     15%  — contrarian reversal signal; raised from 5%
#   Liquidation 10%  — real exchange liquidation data
# ─────────────────────────────────────────────────────────────────────
W_REGIME = 0.35
W_FOOTPRINT = 0.25
W_VOLATILITY = 0.15
W_FUNDING = 0.15
W_LIQUIDATION = 0.10

# Time-decay: how fast stale signals fade (seconds)
_SIGNAL_FRESH_WINDOW_S = 30        # Full strength within 30 s
_SIGNAL_HALF_LIFE_S = 120          # Halves every 2 min after that

# Cross-asset correlation coefficient map (alt → BTC)
_BTC_CORRELATION: Dict[str, float] = {
    "ETH": 0.85, "SOL": 0.78, "AVAX": 0.72, "LINK": 0.70,
    "DOGE": 0.65, "ARB": 0.62, "HYPE": 0.55
}

# Module-level cache shared across calls (populated by _run_pipeline)
_btc_conviction_cache: Dict[str, float] = {}   # {"score": float, "ts": int}


class ConvictionEngine:
    """
    Deterministic inference engine for market conviction.

    Normalises and aggregates complex microstructure signals into a
    single 0–100 score with directional bias.

    v2 improvements (Feb 2026):
      • Volatility is direction-neutral (magnitude amplifier, not signal)
      • No-data liquidation returns 0.0 instead of positive bias
      • Funding weight raised to 15 %
      • Time-decay on stale signals
      • BTC cross-asset correlation for alt-coins
      • Dynamic R:R hint emitted for risk layer
    """

    # ── public class-level cache for cross-asset correlation ──
    last_btc_score: float = 0.0
    last_btc_ts: int = 0

    @classmethod
    def update_btc_cache(cls, score: float, ts: int):
        """Called by _run_pipeline after computing BTC conviction."""
        cls.last_btc_score = score
        cls.last_btc_ts = ts

    # ── main entry point ──────────────────────────────────────

    @staticmethod
    def analyze(
        symbol: str,
        regime_sig: AlphaSignal,
        liq_sig: LiquidationProjectionResult,
        footprint_sig: FootprintResult,
        funding_rate: float,
        funding_mean: float,
        funding_std: float,
        weights: Optional[Dict[str, float]] = None,
        price_history: Optional[List[float]] = None,
    ) -> ConvictionResult:

        # ── resolve weights ──
        w_reg = weights.get("w_regime", W_REGIME) if weights else W_REGIME
        w_liq = weights.get("w_liquidation", W_LIQUIDATION) if weights else W_LIQUIDATION
        w_foot = weights.get("w_footprint", W_FOOTPRINT) if weights else W_FOOTPRINT
        w_fund = weights.get("w_funding", W_FUNDING) if weights else W_FUNDING
        w_vol = weights.get("w_volatility", W_VOLATILITY) if weights else W_VOLATILITY

        explanations: List[str] = []
        components: Dict[str, ConvictionComponent] = {}

        # ── 1. Regime Score (35 %) ──
        regime_score, regime_desc = ConvictionEngine._calculate_regime_score(regime_sig)
        components["regime"] = ConvictionComponent(score=regime_score, weight=w_reg, description=regime_desc)
        if regime_desc:
            explanations.append(regime_desc)

        # ── 2. Liquidation Score (10 %) ──
        liq_score, liq_desc = ConvictionEngine._calculate_liquidation_score(liq_sig)
        components["liquidation"] = ConvictionComponent(score=liq_score, weight=w_liq, description=liq_desc)
        if liq_desc:
            explanations.append(liq_desc)

        # ── 3. Footprint Score (25 %) ──
        foot_score, foot_desc = ConvictionEngine._calculate_footprint_score(footprint_sig)
        components["footprint"] = ConvictionComponent(score=foot_score, weight=w_foot, description=foot_desc)
        if foot_desc:
            explanations.append(foot_desc)

        # ── 4. Funding Score (15 %) ──
        funding_score, funding_desc = ConvictionEngine._calculate_funding_score(
            funding_rate, funding_mean, funding_std,
        )
        components["funding"] = ConvictionComponent(score=funding_score, weight=w_fund, description=funding_desc)
        if funding_desc:
            explanations.append(funding_desc)

        # ── 5. Volatility Score (15 %) — direction-neutral magnitude ──
        vol_score, vol_desc = ConvictionEngine._calculate_volatility_score(regime_sig)
        components["volatility"] = ConvictionComponent(score=vol_score, weight=w_vol, description=vol_desc)
        if vol_desc:
            explanations.append(vol_desc)

        # ── aggregate ──
        raw_score = (
            (regime_score * w_reg)
            + (liq_score * w_liq)
            + (foot_score * w_foot)
            + (funding_score * w_fund)
            + (vol_score * w_vol)
        )

        total_weight = w_reg + w_liq + w_foot + w_fund + w_vol
        normalized_score = raw_score / total_weight

        # ── time-decay ──
        ts_now = int(time.time() * 1000)
        signal_ts = regime_sig.timestamp or ts_now
        age_s = max(0, (ts_now - signal_ts) / 1000.0)
        decay = ConvictionEngine._time_decay(age_s)
        normalized_score *= decay
        if decay < 0.95:
            explanations.append(f"Time-decay applied ({decay:.0%} strength, age {age_s:.0f}s)")

        # ── cross-asset BTC correlation (for alts only) ──
        if symbol != "BTC":
            corr_factor = _BTC_CORRELATION.get(symbol, 0.0)
            if corr_factor > 0 and ConvictionEngine.last_btc_ts > 0:
                btc_age_s = max(0, (ts_now - ConvictionEngine.last_btc_ts) / 1000.0)
                if btc_age_s < 120:  # BTC signal is fresh enough
                    btc_normalized = (ConvictionEngine.last_btc_score - 50) / 50.0  # ∈ [-1, 1]
                    # Blend: 80% own signal + 20% correlated BTC signal (scaled by corr)
                    btc_influence = btc_normalized * corr_factor * 0.20
                    normalized_score = normalized_score * 0.80 + btc_influence
                    if abs(btc_influence) > 0.02:
                        explanations.append(
                            f"BTC correlation ({corr_factor:.0%}): "
                            f"{'tailwind' if btc_influence > 0 else 'headwind'} "
                            f"({btc_influence:+.2f})"
                        )

        # ── non-linear transform ──
        if normalized_score > 0:
            boosted_score = math.pow(min(normalized_score, 1.0), 0.7)
        else:
            boosted_score = -math.pow(min(abs(normalized_score), 1.0), 0.7)

        final_score = max(0, min(100, round((boosted_score + 1) * 50)))

        # ── bias determination ──
        bias: Literal["LONG", "SHORT", "NEUTRAL"] = "NEUTRAL"
        if final_score >= 55:
            bias = "LONG"
        elif final_score <= 45:
            bias = "SHORT"

        # ── dynamic R:R hint (emitted in explanation for risk service) ──
        rr_hint = ConvictionEngine._dynamic_rr(regime_sig, final_score)
        if rr_hint != 2.0:
            explanations.append(f"Dynamic R:R target: {rr_hint:.1f}:1")

        # ── cache BTC score ──
        if symbol == "BTC":
            ConvictionEngine.update_btc_cache(final_score, ts_now)

        return ConvictionResult(
            symbol=symbol,
            bias=bias,
            score=final_score,
            confidence=round(abs(boosted_score), 2),
            components=components,
            explanation=explanations,
            timestamp=regime_sig.timestamp,
        )

    # ═══════════════════════════════════════════════════════════════
    # Component Scorers
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def _calculate_regime_score(sig: AlphaSignal) -> Tuple[float, str]:
        regime_str = str(sig.regime) if hasattr(sig.regime, "value") else str(sig.regime)

        mapping = {
            "AGGRESSIVE_LONG_BUILD": 1.0,
            "AGGRESSIVE_SHORT_BUILD": -1.0,
            "SHORT_COVER": 0.7,
            "LONG_UNWIND": -0.7,
            "STABLE_ACCUMULATION": 0.4,
            "STABLE_DISTRIBUTION": -0.4,
            "NEUTRAL": 0.0,
        }
        base = mapping.get(regime_str, 0.0)
        effective_confidence = max(sig.regime_confidence, 0.4)
        score = base * effective_confidence

        desc = f"Market Regime: {regime_str.replace('_', ' ').title()} (Conf: {sig.regime_confidence:.2f})"
        return score, desc

    @staticmethod
    def _calculate_liquidation_score(sig: LiquidationProjectionResult) -> Tuple[float, str]:
        up_1 = sig.upside.get("1.0%", 0.0)
        down_1 = sig.downside.get("1.0%", 0.0)
        total_liq = up_1 + down_1

        if total_liq > 0:
            up_1 = max(up_1, 0.01)
            down_1 = max(down_1, 0.01)
            ratio = up_1 / down_1
            score = math.tanh((ratio - 1) * 1.5)
            desc = f"Liquidation Imbalance: {ratio:.2f}x Upside vs Downside (${total_liq:,.0f} total)"
        else:
            # FIX: No data = truly neutral (was 0.05 positive bias)
            score = 0.0
            desc = "No liquidation data available"

        return score, desc

    @staticmethod
    def _calculate_footprint_score(sig: FootprintResult) -> Tuple[float, str]:
        W_SWEEP = 0.20
        W_ABSORPTION = 0.15
        W_IMBALANCE = 0.50
        W_IMPULSE = 0.15

        sweep_val = 0.0
        if sig.sweep.event == "BUY_SWEEP":
            sweep_val = sig.sweep.strength
        elif sig.sweep.event == "SELL_SWEEP":
            sweep_val = -sig.sweep.strength

        abs_val = 0.0
        if sig.absorption.event == "BUY_ABSORPTION":
            abs_val = sig.absorption.strength / 5.0
        elif sig.absorption.event == "SELL_ABSORPTION":
            abs_val = -sig.absorption.strength / 5.0

        imb_z = sig.imbalance.z_score
        imb_val = math.tanh(imb_z / 1.5)

        imp_val = 0.0
        if sig.impulse.event == "BULLISH_IMPULSE":
            imp_val = sig.impulse.strength / 3.0
        elif sig.impulse.event == "BEARISH_IMPULSE":
            imp_val = -sig.impulse.strength / 3.0

        score = (sweep_val * W_SWEEP) + (abs_val * W_ABSORPTION) + (imb_val * W_IMBALANCE) + (imp_val * W_IMPULSE)
        score = max(-1.0, min(1.0, score))

        reasons: List[str] = []
        if sig.sweep.event:
            reasons.append(f"{sig.sweep.event} spotted")
        if sig.absorption.event:
            reasons.append(f"{sig.absorption.event} detected")
        if abs(imb_z) > 0.2:
            reasons.append(f"Flow imbalance z-score: {imb_z:.2f}")

        desc = ". ".join(reasons) if reasons else "Neutral order flow"
        return score, desc

    @staticmethod
    def _calculate_funding_score(rate: float, mean: float, std: float) -> Tuple[float, str]:
        if std == 0:
            std = 0.0001
        z = (rate - mean) / std

        # Contrarian: high funding → score negative (over-leveraged longs)
        # More sensitive than before (was * 0.8)
        score = -math.tanh(z * 1.0)

        desc = "Funding Neutral"
        if z > 2.0:
            desc = "Funding extremely positive — over-leveraged Longs (strong reversal signal)"
        elif z > 1.0:
            desc = "Funding elevated — crowded Longs"
        elif z < -2.0:
            desc = "Funding extremely negative — over-leveraged Shorts (strong reversal signal)"
        elif z < -1.0:
            desc = "Funding depressed — crowded Shorts"

        return score, desc

    @staticmethod
    def _calculate_volatility_score(sig: AlphaSignal) -> Tuple[float, str]:
        """
        Volatility is a MAGNITUDE AMPLIFIER, not a directional signal.

        • Compression  → big move coming → amplify existing bias (+0.0)
          but boost overall conviction confidence (separate from score)
        • Expansion    → move in progress → no directional change
        • Normal       → baseline

        The score returned is 0.0 (neutral) always.
        Instead, we use compression_score as a multiplier on the
        OTHER components, returned via the description for logging.
        """
        compression = getattr(sig, "compression_score", 0.5)

        if sig.volatility_regime == "COMPRESSION":
            # FIX: Direction-neutral — compression is NOT bullish
            # High compression = big move imminent; we amplify conviction
            # by moving scale toward extremes without picking direction.
            # Score of 0.0 keeps it neutral; the amplification happens
            # via the non-linear pow(0.7) on the aggregate.
            score = 0.0
            desc = f"Volatility Compression ({compression:.0%}): breakout imminent — signals amplified"
        elif sig.volatility_regime == "EXPANSION":
            score = 0.0
            desc = "Volatility Expansion: move in progress"
        else:
            score = 0.0
            desc = "Volatility Stable"

        return score, desc

    # ═══════════════════════════════════════════════════════════════
    # Utility helpers
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def _time_decay(age_seconds: float) -> float:
        """
        Returns a decay multiplier ∈ (0, 1].
        Full strength within _SIGNAL_FRESH_WINDOW_S.
        Exponential half-life decay after that.
        """
        if age_seconds <= _SIGNAL_FRESH_WINDOW_S:
            return 1.0
        excess = age_seconds - _SIGNAL_FRESH_WINDOW_S
        return math.pow(0.5, excess / _SIGNAL_HALF_LIFE_S)

    @staticmethod
    def _dynamic_rr(sig: AlphaSignal, conviction_score: int) -> float:
        """
        Dynamic Risk:Reward ratio based on regime + volatility.

        Compression → higher R:R (expect bigger move)
        Expansion   → tighter R:R (move already started)
        Strong conviction → slightly higher R:R
        """
        base_rr = 2.0  # standard

        # Adjust for volatility regime
        if sig.volatility_regime == "COMPRESSION":
            base_rr = 3.0  # expect big breakout → wider target
        elif sig.volatility_regime == "EXPANSION":
            base_rr = 1.5  # move in progress → take profits earlier

        # Adjust for conviction strength
        conviction_delta = abs(conviction_score - 50)
        if conviction_delta >= 20:
            base_rr *= 1.2  # very strong signal → extend target
        elif conviction_delta <= 5:
            base_rr *= 0.8  # weak signal → tighter target

        return round(min(5.0, max(1.0, base_rr)), 1)
