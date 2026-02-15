import time
from typing import Optional, Dict, List
from src.alpha_engine.state.market_state import MarketState
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.processors.sweep_detector import SweepDetector
from src.alpha_engine.processors.absorption_detector import AbsorptionDetector
from src.alpha_engine.processors.flow_imbalance import FlowImbalanceProcessor
from src.alpha_engine.processors.impulse_detector import ImpulseDetector
from src.alpha_engine.models.footprint_models import FootprintResult

class FootprintService:
    """
    Orchestrates the footprint and aggression analysis.
    Maintains historical state for statistical detectors (z-scores, impulse deltas).
    """
    
    def __init__(self):
        # We store rolling history for z-score calculations (20 mins ~ 120 slots at 10s intervals)
        self.imbalance_history: Dict[str, List[float]] = {}
        # Stores previous snapshots for delta-based detectors
        self.prev_cvd: Dict[str, float] = {}
        self.prev_price: Dict[str, float] = {}

    async def generate_footprint(self, symbol: str) -> Optional[FootprintResult]:
        state = await global_state_store.get_state(symbol)
        if not state:
            return None
            
        # 1. Flow Imbalance (maintain 200 data points of history)
        if symbol not in self.imbalance_history:
            self.imbalance_history[symbol] = []
        
        current_imbalance = state.aggressive_buy_volume_1m / max(state.aggressive_sell_volume_1m, 1.0)
        imbalance_res = FlowImbalanceProcessor.compute(state, self.imbalance_history[symbol])
        
        # Update history
        self.imbalance_history[symbol].append(current_imbalance)
        if len(self.imbalance_history[symbol]) > 200:
            self.imbalance_history[symbol].pop(0)
            
        # 2. Impulse Detection
        prev_cvd = self.prev_cvd.get(symbol, state.cvd_1m)
        prev_px = self.prev_price.get(symbol, state.price)
        
        impulse_res = ImpulseDetector.detect(state, prev_cvd, prev_px)
        
        # Update deltas for next run
        self.prev_cvd[symbol] = state.cvd_1m
        self.prev_price[symbol] = state.price
        
        # 3. Sweep Detection
        sweep_res = SweepDetector.detect(state)
        
        # 4. Absorption Detection
        absorption_res = AbsorptionDetector.detect(state)
        
        return FootprintResult(
            symbol=symbol,
            sweep=sweep_res,
            absorption=absorption_res,
            imbalance=imbalance_res,
            impulse=impulse_res,
            timestamp=int(time.time() * 1000)
        )

# Global singleton
footprint_service = FootprintService()
