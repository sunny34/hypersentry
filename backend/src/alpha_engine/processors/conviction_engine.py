import math
from typing import Dict, List, Literal, Optional, Tuple
from src.alpha_engine.models.regime_models import AlphaSignal
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult
from src.alpha_engine.models.footprint_models import FootprintResult
from src.alpha_engine.models.conviction_models import ConvictionResult, ConvictionComponent

# Configuration Weights
# Regime is the primary signal - it should have strong influence
W_REGIME = 0.35
W_LIQUIDATION = 0.15
W_FOOTPRINT = 0.25
W_FUNDING = 0.10
W_VOLATILITY = 0.15

class ConvictionEngine:
    """
    Deterministic inference engine for market conviction.
    Normalizes and aggregates complex microstructure signals into a single score.
    """

    @staticmethod
    def analyze(
        symbol: str,
        regime_sig: AlphaSignal,
        liq_sig: LiquidationProjectionResult,
        footprint_sig: FootprintResult,
        funding_rate: float,
        funding_mean: float,
        funding_std: float,
        weights: Optional[Dict[str, float]] = None
    ) -> ConvictionResult:
        
        # Use provided weights or defaults
        w_reg = weights.get("w_regime", W_REGIME) if weights else W_REGIME
        w_liq = weights.get("w_liquidation", W_LIQUIDATION) if weights else W_LIQUIDATION
        w_foot = weights.get("w_footprint", W_FOOTPRINT) if weights else W_FOOTPRINT
        w_fund = weights.get("w_funding", W_FUNDING) if weights else W_FUNDING
        w_vol = weights.get("w_volatility", W_VOLATILITY) if weights else W_VOLATILITY

        explanations = []
        components = {}

        # 1. Regime Score
        regime_score, regime_desc = ConvictionEngine._calculate_regime_score(regime_sig)
        components["regime"] = ConvictionComponent(score=regime_score, weight=w_reg, description=regime_desc)
        if regime_desc: explanations.append(regime_desc)

        # 2. Liquidation Score
        liq_score, liq_desc = ConvictionEngine._calculate_liquidation_score(liq_sig)
        components["liquidation"] = ConvictionComponent(score=liq_score, weight=w_liq, description=liq_desc)
        if liq_desc: explanations.append(liq_desc)

        # 3. Footprint Score
        foot_score, foot_desc = ConvictionEngine._calculate_footprint_score(footprint_sig)
        components["footprint"] = ConvictionComponent(score=foot_score, weight=w_foot, description=foot_desc)
        if foot_desc: explanations.append(foot_desc)

        # 4. Funding Score
        funding_score, funding_desc = ConvictionEngine._calculate_funding_score(funding_rate, funding_mean, funding_std)
        components["funding"] = ConvictionComponent(score=funding_score, weight=w_fund, description=funding_desc)
        if funding_desc: explanations.append(funding_desc)

        # 5. Volatility Scaling
        vol_score, vol_desc = ConvictionEngine._calculate_volatility_score(regime_sig)
        components["volatility"] = ConvictionComponent(score=vol_score, weight=w_vol, description=vol_desc)
        if vol_desc: explanations.append(vol_desc)

        # Total Calculation
        raw_score = (
            (regime_score * w_reg) +
            (liq_score * w_liq) +
            (foot_score * w_foot) +
            (funding_score * w_fund) +
            (vol_score * w_vol)
        )
        
        total_weight = w_reg + w_liq + w_foot + w_fund + w_vol
        normalized_score = raw_score / total_weight
        
        # Scaling to 0-100
        final_score = round((normalized_score + 1) * 50)
        
        bias: Literal["LONG", "SHORT", "NEUTRAL"] = "NEUTRAL"
        if final_score > 60:
            bias = "LONG"
        elif final_score < 40:
            bias = "SHORT"

        return ConvictionResult(
            symbol=symbol,
            bias=bias,
            score=final_score,
            confidence=round(abs(normalized_score), 2),
            components=components,
            explanation=explanations,
            timestamp=regime_sig.timestamp
        )

    @staticmethod
    def _calculate_regime_score(sig: AlphaSignal) -> Tuple[float, str]:
        # Convert enum to string for lookup
        regime_str = str(sig.regime) if hasattr(sig.regime, 'value') else str(sig.regime)
        
        mapping = {
            "AGGRESSIVE_LONG_BUILD": 0.7,
            "AGGRESSIVE_SHORT_BUILD": -0.7,
            "SHORT_COVER": 0.4,
            "LONG_UNWIND": -0.4,
            "STABLE_ACCUMULATION": 0.2,
            "STABLE_DISTRIBUTION": -0.2,
            "NEUTRAL": 0.0,
        }
        base = mapping.get(regime_str, 0.0)
        
        # Ensure minimum confidence so regime can influence conviction
        # Even low confidence regimes should have some weight
        effective_confidence = max(sig.regime_confidence, 0.3)
        
        score = base * effective_confidence
        
        desc = f"Market Regime: {sig.regime.replace('_', ' ').title()} (Conf: {sig.regime_confidence:.2f})"
        return score, desc

    @staticmethod
    def _calculate_liquidation_score(sig: LiquidationProjectionResult) -> Tuple[float, str]:
        # Benchmark 1%
        up_1 = sig.upside.get("1.0%", 0.0)
        down_1 = sig.downside.get("1.0%", 0.0)
        
        # If we have liquidation data, use it for signal
        total_liq = up_1 + down_1
        
        if total_liq > 0:
            # Have liquidation data - use ratio
            up_1 = max(up_1, 0.01)  # Avoid division issues
            down_1 = max(down_1, 0.01)
            ratio = up_1 / down_1
            score = math.tanh(ratio - 1)
            desc = f"Liquidation Imbalance: {ratio:.2f}x Upside vs Downside (${total_liq:,.0f} total)"
        else:
            # No liquidation data - return neutral but not zero
            # This allows conviction to still be driven by other factors
            score = 0.0
            desc = "No liquidation data available"
        
        return score, desc

    @staticmethod
    def _calculate_footprint_score(sig: FootprintResult) -> Tuple[float, str]:
        # Internal weights for footprint - increase imbalance weight since it's always available
        W_SWEEP = 0.25
        W_ABSORPTION = 0.20
        W_IMBALANCE = 0.40  # Increased weight - this is always available from state
        W_IMPULSE = 0.15
        
        # Normalize sub-components
        sweep_val = 0.0
        if sig.sweep.event == "BUY_SWEEP": sweep_val = sig.sweep.strength
        elif sig.sweep.event == "SELL_SWEEP": sweep_val = -sig.sweep.strength
        
        abs_val = 0.0
        if sig.absorption.event == "BUY_ABSORPTION": abs_val = sig.absorption.strength / 5.0 # normalized
        elif sig.absorption.event == "SELL_ABSORPTION": abs_val = -sig.absorption.strength / 5.0
            
        # Use imbalance more aggressively - even small z-scores provide signal
        imb_z = sig.imbalance.z_score
        imb_val = math.tanh(imb_z / 2.0)  # More responsive to z-score
        
        imp_val = 0.0
        if sig.impulse.event == "BULLISH_IMPULSE": imp_val = sig.impulse.strength / 3.0
        elif sig.impulse.event == "BEARISH_IMPULSE": imp_val = -sig.impulse.strength / 3.0
            
        score = (sweep_val * W_SWEEP) + (abs_val * W_ABSORPTION) + (imb_val * W_IMBALANCE) + (imp_val * W_IMPULSE)
        score = max(-1.0, min(1.0, score))
        
        reasons = []
        if sig.sweep.event: reasons.append(f"{sig.sweep.event} spotted")
        if sig.absorption.event: reasons.append(f"{sig.absorption.event} detected")
        # Always include imbalance info if there's any meaningful reading
        if abs(imb_z) > 0.3: reasons.append(f"Flow imbalance z-score: {imb_z:.2f}")
        
        desc = ". ".join(reasons) if reasons else "Neutral order flow"
        return score, desc

    @staticmethod
    def _calculate_funding_score(rate: float, mean: float, std: float) -> Tuple[float, str]:
        if std == 0: std = 0.0001
        z = (rate - mean) / std
        # Inverse tanh: Very high funding (over-leverage) is BEARISH
        score = -math.tanh(z)
        
        desc = "Funding Neutral"
        if z > 2.0: desc = "Funding extremely positive (Over-leveraged Longs)"
        elif z < -2.0: desc = "Funding extremely negative (Over-leveraged Shorts)"
            
        return score, desc

    @staticmethod
    def _calculate_volatility_score(sig: AlphaSignal) -> Tuple[float, str]:
        # Volatility acts as a momentum amplifier in directional regimes
        score = 0.0
        if sig.volatility_regime == "COMPRESSION":
            score = 0.3 # Bullish context for compression
            desc = "Volatility Compression: Expansion expected"
        elif sig.volatility_regime == "EXPANSION":
            score = -0.1 # Slight cooling factor
            desc = "Volatility Expansion: Move in progress"
        else:
            desc = "Volatility Stable"
            
        return score, desc
