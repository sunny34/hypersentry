from typing import List, Dict, Tuple
from src.alpha_engine.models.liquidation_models import LiquidationLevel, LiquidationProjectionResult
from src.alpha_engine.state.market_state import MarketState

DEFAULT_PROJECTION_LEVELS = [0.005, 0.01, 0.02, 0.03]

def _normalize_side(side: str) -> str:
    """
    Normalize side to LONG/SHORT.
    - BUY/SUY = SHORT (shorts getting liquidated -> market buy orders)
    - SELL/SEL = LONG (longs getting liquidated -> market sell orders)
    """
    if not side:
        return "LONG"
    s = side.upper()
    if s in ("BUY", "SUY"):  # Some APIs use SUY for short liquidation
        return "SHORT"
    if s in ("SELL", "SEL"):  # Some APIs use SEL for long liquidation
        return "LONG"
    if s in ("LONG", "SHORT"):
        return s
    return "LONG"  # Default


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
        import logging
        logger = logging.getLogger(__name__)
        
        # Handle case where liquidation_levels might be passed as list in data dict
        levels = state.liquidation_levels if state.liquidation_levels else []

        # Normalize all sides to LONG/SHORT
        normalized_levels = []
        for l in levels:
            normalized_side = _normalize_side(l.side)
            normalized_levels.append(LiquidationLevel(
                price=l.price,
                side=normalized_side,
                notional=l.notional,
                timestamp=getattr(l, 'timestamp', 0),
                exchange=getattr(l, 'exchange', 'hl'),
            ))
        levels = normalized_levels

        logger.info(f"=== LIQUIDATION PROJECTION: {state.symbol} price={state.price}, levels_count={len(levels)} ===")
        
        # Log first few levels for debugging
        if levels:
            for i, l in enumerate(levels[:3]):
                logger.info(f"  Level {i}: price={l.price}, side={l.side}, notional={l.notional}")
        
        curr_px = state.price
        upside_impact: Dict[str, float] = {}
        downside_impact: Dict[str, float] = {}
        
        # Prepare target prices for all levels
        upside_targets = [(pct, curr_px * (1 + pct)) for pct in DEFAULT_PROJECTION_LEVELS]
        downside_targets = [(pct, curr_px * (1 - pct)) for pct in DEFAULT_PROJECTION_LEVELS]
        
        # O(n) calculation
        # We assume liquidation_levels is pre-sorted from lowest price to highest price.
        for pct, target in upside_targets:
            # Trigger SHORT liquidations (Market BUY orders)
            # Level.price <= Target (because shorts sit ABOVE curr_price)
            vol = sum(l.notional for l in levels
                     if _normalize_side(l.side) == "SHORT" and curr_px < l.price <= target)
            upside_impact[f"{pct*100}%"] = round(vol, 2)

        for pct, target in downside_targets:
            # Trigger LONG liquidations (Market SELL orders)
            # Level.price >= Target (because longs sit BELOW curr_price)
            vol = sum(l.notional for l in levels
                     if _normalize_side(l.side) == "LONG" and target <= l.price < curr_px)
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

        # Determine data source: real exchange events vs OI-based estimates
        exchanges_set = set()
        has_real = False
        has_estimated = False
        for l in levels:
            ex = getattr(l, 'exchange', 'hl')
            exchanges_set.add(ex)
            if ex.endswith('_est'):
                has_estimated = True
            else:
                has_real = True

        if has_real and has_estimated:
            data_source = "mixed"
        elif has_real:
            data_source = "real"
        elif has_estimated:
            data_source = "estimated"
        else:
            data_source = "none"

        return LiquidationProjectionResult(
            symbol=state.symbol,
            current_price=curr_px,
            upside=upside_impact,
            downside=downside_impact,
            imbalance_ratio=round(imbalance, 2),
            dominant_side=sentiment,
            data_source=data_source,
            level_count=len(levels),
            exchanges=sorted(exchanges_set),
        )
