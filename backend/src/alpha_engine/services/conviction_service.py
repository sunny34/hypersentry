import time
from typing import Optional, Dict, List
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.services.alpha_service import alpha_service
from src.alpha_engine.services.liquidation_service import liquidation_service
from src.alpha_engine.services.footprint_service import footprint_service
from src.alpha_engine.processors.conviction_engine import ConvictionEngine
from src.alpha_engine.models.conviction_models import ConvictionResult

class ConvictionService:
    """
    Coordinates multi-engine data retrieval and final conviction synthesis.
    Maintains historical context for environmental signals like funding.
    """
    
    def __init__(self):
        # Rolling funding history (120 slots = 20 mins if sampled at 10s)
        self.funding_history: Dict[str, List[float]] = {}

    async def get_conviction(self, symbol: str) -> Optional[ConvictionResult]:
        """
        Gathers all microstructure signals and executes the Conviction Engine.
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
        mean = sum(history) / len(history)
        # Calculate standard deviation
        variance = sum((x - mean) ** 2 for x in history) / len(history)
        std = variance ** 0.5 if variance > 0 else 0.00001
        
        # 3. Synthesize Final Result
        return ConvictionEngine.analyze(
            symbol=symbol,
            regime_sig=regime_sig,
            liq_sig=liq_sig,
            footprint_sig=footprint_sig,
            funding_rate=cur_funding,
            funding_mean=mean,
            funding_std=std
        )

# Global singleton
conviction_service = ConvictionService()
