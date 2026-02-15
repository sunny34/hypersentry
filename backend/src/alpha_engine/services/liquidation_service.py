from typing import Optional
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.processors.liquidation_projection import LiquidationProjector
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult

class LiquidationService:
    """
    Service layer to provide liquidation impact analysis for derivatives traders.
    This service is stateless and relies on the latest MarketState stored in memory.
    """
    
    async def get_projection(self, symbol: str) -> Optional[LiquidationProjectionResult]:
        """
        Retrieves the current market state and computes the liquidation cascade impact.
        """
        state = await global_state_store.get_state(symbol)
        if not state:
            return None
            
        # Execute projection deterministic logic
        return LiquidationProjector.project(state)

# Global singleton
liquidation_service = LiquidationService()
