from typing import Literal
from src.alpha_engine.state.market_state import MarketState

class MacroRegimeClassifier:
    """
    Deterministic classifier for high-level macro market regimes.
    Drives model switching logic for the adaptive engine.
    """

    @staticmethod
    def classify(state: MarketState, vol_24h_percentile: float) -> str:
        # 1. CRISIS_MODE: Extreme liquidation intensity or funding blowouts
        liq_intensity = sum(l.notional for l in state.liquidation_levels)
        if liq_intensity > 5_000_000 or abs(state.funding_rate) > 0.001:
            return "CRISIS_MODE"

        # 2. SQUEEZE_ENVIRONMENT: High imbalance and compression
        if abs(state.aggressive_buy_volume_1m - state.aggressive_sell_volume_1m) > 100_000:
             # Placeholder for specific squeeze triggers
             pass

        # 3. Volatility-based classification
        if vol_24h_percentile > 0.8:
            return "TRENDING_HIGH_VOL"
        elif vol_24h_percentile < 0.2:
            return "CHOP_LOW_VOL"
            
        return "NORMAL_MARKET"
