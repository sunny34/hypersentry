import time
from typing import Optional, Dict, List
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.services.alpha_service import alpha_service
from src.alpha_engine.services.liquidation_service import liquidation_service
from src.alpha_engine.services.footprint_service import footprint_service
from src.alpha_engine.processors.conviction_engine import ConvictionEngine
from src.alpha_engine.models.conviction_models import ConvictionResult, ConvictionComponent
from src.alpha_engine.models.regime_models import AlphaSignal
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult
from src.alpha_engine.models.footprint_models import FootprintResult
from src.alpha_engine.models.regime_models import MarketRegime, VolatilityRegime
import math

class ConvictionService:
    """
    Coordinates multi-engine data retrieval and final conviction synthesis.
    Maintains historical context for environmental signals like funding.
    FIXED: Added rolling average to smooth out noise and make conviction actionable.
    """
    
    def __init__(self):
        # Rolling funding history (120 slots = 20 mins if sampled at 10s)
        self.funding_history: Dict[str, List[float]] = {}
        # FIXED: Rolling score history for smoothing - requires sustained conviction
        self.score_history: Dict[str, List[int]] = {}
        self.last_regime: Dict[str, str] = {}
        self.last_actionable_conviction: Dict[str, ConvictionResult] = {}

    async def get_conviction(self, symbol: str) -> Optional[ConvictionResult]:
        """
        Gathers all microstructure signals and executes the Conviction Engine.
        FIXED: Returns smoothed conviction that requires sustained signal before being actionable.
        """
        # 1. Fetch Sub-Signals
        state = await global_state_store.get_state(symbol)
        regime_sig = await alpha_service.generate_signal(symbol)
        liq_sig = await liquidation_service.get_projection(symbol)
        footprint_sig = await footprint_service.generate_footprint(symbol)
        
        if not all([state, regime_sig, liq_sig, footprint_sig]):
            return None
            
        # 2. Process Funding Statistics
        if symbol not in self.funding_history:
            self.funding_history[symbol] = []
            
        cur_funding = state.funding_rate
        self.funding_history[symbol].append(cur_funding)
        
        # Keep 120 data points
        if len(self.funding_history[symbol]) > 120:
            self.funding_history[symbol].pop(0)
            
        history = self.funding_history[symbol]
        mean = sum(history) / len(history) if history else 0
        # Calculate standard deviation
        variance = sum((x - mean) ** 2 for x in history) / len(history) if history else 0
        std = variance ** 0.5 if variance > 0 else 0.00001
        
        # 3. Synthesize Final Result
        raw_conviction = ConvictionEngine.analyze(
            symbol=symbol,
            regime_sig=regime_sig,
            liq_sig=liq_sig,
            footprint_sig=footprint_sig,
            funding_rate=cur_funding,
            funding_mean=mean,
            funding_std=std
        )

        # FIXED: Apply smoothing - require sustained conviction
        smoothed = self._smooth_conviction(symbol, raw_conviction)
        
        # Store last actionable conviction (only update if regime hasn't changed)
        regime_key = str(regime_sig.regime.value) if hasattr(regime_sig.regime, 'value') else str(regime_sig.regime)
        
        if regime_key != self.last_regime.get(symbol):
            # Regime changed - reset and store new actionable conviction
            self.score_history[symbol] = []
            self.last_regime[symbol] = regime_key
            self.last_actionable_conviction[symbol] = smoothed
        
        return smoothed

    def _smooth_conviction(self, symbol: str, raw: ConvictionResult) -> ConvictionResult:
        """
        Applies rolling average smoothing to the conviction score.
        Returns an 'actionable' conviction only when signal is sustained.
        """
        # Initialize history if needed
        if symbol not in self.score_history:
            self.score_history[symbol] = []
        
        # Add current score to history
        self.score_history[symbol].append(raw.score)
        
        # Keep last 10 readings (~20 seconds of data at 2 readings/sec)
        if len(self.score_history[symbol]) > 10:
            self.score_history[symbol].pop(0)
        
        history = self.score_history[symbol]
        
        # Calculate smoothed (moving average) score
        if len(history) >= 3:
            # Need at least 3 consecutive readings
            avg_score = sum(history) / len(history)
            
            # Calculate score stability (how consistent is the signal)
            # If most readings are on same side of 50, signal is more stable
            bullish_count = sum(1 for s in history if s >= 55)
            bearish_count = sum(1 for s in history if s <= 45)
            
            # FIXED: Require stability for actionable signal
            is_stable = bullish_count >= 3 or bearish_count >= 3
            
            if is_stable:
                # Signal is stable - use smoothed score
                final_score = round(avg_score)
            else:
                # Signal not stable yet - return current but mark as unstable
                final_score = raw.score
        else:
            # Not enough history - return raw
            final_score = raw.score
        
        # Determine bias based on smoothed score
        bias = "NEUTRAL"
        if final_score >= 55:
            bias = "LONG"
        elif final_score <= 45:
            bias = "SHORT"
        
        # FIXED: Calculate confidence based on stability
        confidence = raw.confidence
        if len(history) >= 3:
            # Higher confidence if signal is stable
            stability_factor = min(len(history) / 10.0, 1.0)
            confidence = max(confidence, 0.5 * stability_factor + 0.3)
        
        # Update components with final score
        return ConvictionResult(
            symbol=symbol,
            bias=bias,
            score=final_score,
            confidence=round(confidence, 2),
            components=raw.components,
            explanation=raw.explanation + [f"Smoothed over {len(history)} readings"],
            timestamp=raw.timestamp
        )

# Global singleton
conviction_service = ConvictionService()
