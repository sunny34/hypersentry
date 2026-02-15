from typing import List, Dict, Tuple
from src.alpha_engine.models.liquidation_models import LiquidationLevel, LiquidationProjectionResult
from src.alpha_engine.state.market_state import MarketState

DEFAULT_PROJECTION_LEVELS = [0.005, 0.01, 0.02, 0.03]

class LiquidationProjector:
    """
    Simulates the cascading impact of liquidations in the event of price variance.
    
    TRADING LOGIC EXPLANATION:
    In derivatives, liquidations create 'forced' market orders.
    - If price moves UP: Clusters of SHORT liquidations are triggered, creating market BUY orders, 
      potentially fueling a 'Short Squeeze'.
    - If price moves DOWN: Clusters of LONG liquidations are triggered, creating market SELL orders, 
      potentially fueling a 'Long Squeeze' or 'Long Unwind Waterfall'.
    """

    @staticmethod
    def project(state: MarketState) -> LiquidationProjectionResult:
        """
        Computes potential liquidation volume impact across specified price ranges.
        O(n) complexity: single pass through the liquidation levels.
        """
        curr_px = state.price
        upside_impact: Dict[str, float] = {}
        downside_impact: Dict[str, float] = {}
        
        # Prepare target prices for all levels
        upside_targets = [(pct, curr_px * (1 + pct)) for pct in DEFAULT_PROJECTION_LEVELS]
        downside_targets = [(pct, curr_px * (1 - pct)) for pct in DEFAULT_PROJECTION_LEVELS]
        
        # O(n) calculation
        # We assume state.liquidation_levels is pre-sorted from lowest price to highest price.
        for pct, target in upside_targets:
            # Trigger SHORT liquidations (Market BUY orders)
            # Level.price <= Target (because shorts sit ABOVE curr_price)
            vol = sum(l.notional for l in state.liquidation_levels 
                     if l.side == "SHORT" and curr_px < l.price <= target)
            upside_impact[f"{pct*100}%"] = round(vol, 2)

        for pct, target in downside_targets:
            # Trigger LONG liquidations (Market SELL orders)
            # Level.price >= Target (because longs sit BELOW curr_price)
            vol = sum(l.notional for l in state.liquidation_levels 
                     if l.side == "LONG" and target <= l.price < curr_px)
            downside_impact[f"{pct*100}%"] = round(vol, 2)

        # Imbalance Ratio at 1% benchmark
        val_at_1_up = upside_impact.get("1.0%", 0)
        val_at_1_down = downside_impact.get("1.0%", 0)
        
        # Safe division
        if val_at_1_down > 0:
            imbalance = val_at_1_up / val_at_1_down
        else:
            imbalance = val_at_1_up if val_at_1_up > 0 else 1.0 # Default to 1.0 if both are 0
        
        if imbalance > 1.2:
            sentiment = "SHORT_SQUEEZE"
        elif imbalance < 0.8:
            sentiment = "LONG_SQUEEZE"
        else:
            sentiment = "BALANCED"

        return LiquidationProjectionResult(
            symbol=state.symbol,
            current_price=curr_px,
            upside=upside_impact,
            downside=downside_impact,
            imbalance_ratio=round(imbalance, 2),
            dominant_side=sentiment
        )
