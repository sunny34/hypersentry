import logging
from typing import Optional
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.processors.liquidation_projection import LiquidationProjector
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult, LiquidationLevel

logger = logging.getLogger(__name__)


class LiquidationService:
    """
    Service layer to provide liquidation impact analysis for derivatives traders.
    Uses ONLY real liquidation data from exchange feeds (cryptofeed, Hyperliquid WS).
    No estimates.
    """

    async def get_projection(self, symbol: str) -> Optional[LiquidationProjectionResult]:
        """
        Retrieves the current market state and computes the liquidation cascade impact.
        Data comes from real exchange liquidation feeds only.
        """
        state = await global_state_store.get_state(symbol)

        # If no state or no liquidation data, try the aggregator's cached HL liquidations
        if not state or not state.liquidation_levels:
            try:
                from src.services.aggregator import aggregator
                cache = aggregator.data_cache.get(symbol.upper(), {})
                hl_liquidations = cache.get("liquidations", [])
                if hl_liquidations:
                    levels = []
                    for liq in hl_liquidations:
                        price = float(liq.get("px", 0))
                        qty = float(liq.get("sz", 0))
                        side = liq.get("side", "unknown").upper()
                        if side not in ("LONG", "SHORT"):
                            side = "SHORT" if side == "S" else "LONG"
                        if price > 0 and qty > 0:
                            levels.append(LiquidationLevel(
                                price=price,
                                side=side,
                                notional=price * qty,
                                timestamp=liq.get("time", 0),
                                exchange="hl"
                            ))
                    if levels:
                        await global_state_store.update_state(symbol.upper(), {"liquidation_levels": levels})
                        state = await global_state_store.get_state(symbol)
            except Exception as e:
                logger.warning("Failed to get Hyperliquid liquidations: %s", e)

        if not state:
            return None

        # Execute projection on real data only
        return LiquidationProjector.project(state)


# Global singleton
liquidation_service = LiquidationService()
