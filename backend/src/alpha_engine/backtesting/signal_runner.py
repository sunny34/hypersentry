from typing import List, Dict, Optional
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.models.conviction_models import ConvictionResult
from src.alpha_engine.state.market_state import MarketState
from src.alpha_engine.processors.oi_price_regime import OIRegimeClassifier
from src.alpha_engine.processors.volatility_regime import VolatilityDetector
from src.alpha_engine.processors.liquidation_projection import LiquidationProjector
from src.alpha_engine.processors.sweep_detector import SweepDetector
from src.alpha_engine.processors.absorption_detector import AbsorptionDetector
from src.alpha_engine.processors.flow_imbalance import FlowImbalanceProcessor
from src.alpha_engine.processors.impulse_detector import ImpulseDetector
from src.alpha_engine.processors.conviction_engine import ConvictionEngine
from src.alpha_engine.models.regime_models import AlphaSignal, MarketRegime, VolatilityRegime
from src.alpha_engine.backtesting.state_rebuilder import StateRebuilder

class SignalRunner:
    """
    Executes the full Alpha Engine pipeline on historical data steps.
    Represents the 'inference' phase of the backtest.
    """

    def __init__(self, symbol: str):
        self.symbol = symbol
        # Historical buffers for processors that need history
        self.price_history = []
        self.volume_history = []
        self.funding_history = []
        self.imbalance_history = []
        self.prev_cvd = 0.0
        self.prev_price = 0.0

    async def run_step(self, snapshot: HistoricalMarketSnapshot, weights: Optional[Dict[str, float]] = None) -> ConvictionResult:
        state = StateRebuilder.rebuild(self.symbol, snapshot)
        
        # 1. Update histories
        self.price_history.append(state.price)
        self.volume_history.append(snapshot.volume)
        self.funding_history.append(state.funding_rate)
        
        if len(self.price_history) > 200:
            self.price_history.pop(0)
            self.volume_history.pop(0)
            self.funding_history.pop(0)

        # 2. Run Processors
        # Regime (approx 1m ago = 6 slots if 10s intervals)
        idx_1m = max(0, len(self.price_history) - 6)
        regime_data = OIRegimeClassifier.classify(state, self.price_history[idx_1m])
        vol_data = VolatilityDetector.detect(state, self.price_history, self.volume_history)
        
        regime_sig = AlphaSignal(
            symbol=self.symbol,
            regime=regime_data["regime"],
            regime_confidence=regime_data["confidence"],
            volatility_regime=vol_data["volatility_regime"],
            compression_score=vol_data["compression_score"],
            timestamp=state.timestamp
        )

        # Liquidation
        liq_sig = LiquidationProjector.project(state)

        # Footprint
        sweep_res = SweepDetector.detect(state)
        absorption_res = AbsorptionDetector.detect(state)
        
        current_imb = state.aggressive_buy_volume_1m / max(state.aggressive_sell_volume_1m, 1.0)
        imbalance_res = FlowImbalanceProcessor.compute(state, self.imbalance_history)
        self.imbalance_history.append(current_imb)
        if len(self.imbalance_history) > 200: self.imbalance_history.pop(0)
        
        impulse_res = ImpulseDetector.detect(state, self.prev_cvd, self.prev_price)
        self.prev_cvd = state.cvd_1m
        self.prev_price = state.price
        
        from src.alpha_engine.models.footprint_models import FootprintResult
        footprint_sig = FootprintResult(
            symbol=self.symbol,
            sweep=sweep_res,
            absorption=absorption_res,
            imbalance=imbalance_res,
            impulse=impulse_res,
            timestamp=state.timestamp
        )

        # 3. Final Conviction
        funding_mean = sum(self.funding_history) / len(self.funding_history)
        var = sum((x - funding_mean)**2 for x in self.funding_history) / len(self.funding_history)
        funding_std = var**0.5 if var > 0 else 0.00001
        
        return ConvictionEngine.analyze(
            symbol=self.symbol,
            regime_sig=regime_sig,
            liq_sig=liq_sig,
            footprint_sig=footprint_sig,
            funding_rate=state.funding_rate,
            funding_mean=funding_mean,
            funding_std=funding_std,
            weights=weights
        )
