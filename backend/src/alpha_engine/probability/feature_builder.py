from typing import List, Dict, Any
from src.alpha_engine.models.conviction_models import ConvictionResult
from src.alpha_engine.models.probability_models import FeatureVector

class FeatureBuilder:
    """
    Transforms raw Alpha Engine signals into normalized feature vectors.
    Ensures that values are appropriately scaled for logistic regression.
    """

    @staticmethod
    def build(conviction: ConvictionResult) -> FeatureVector:
        # Extract components safely
        comps = conviction.components
        
        # Conviction score is [0, 100], normalize to [0, 1]
        norm_conviction = conviction.score / 100.0
        
        # Handle footprint sub-components if available in state or synthesized
        # For simplicity, we extract from the score dictionary
        regime_val = comps.get("regime").score if "regime" in comps else 0.0
        liq_val = comps.get("liquidation").score if "liquidation" in comps else 0.0
        foot_val = comps.get("footprint").score if "footprint" in comps else 0.0
        fund_val = comps.get("funding").score if "funding" in comps else 0.0
        vol_val = comps.get("volatility").score if "volatility" in comps else 0.0

        return FeatureVector(
            regime_score=regime_val,
            liquidation_score=liq_val,
            footprint_score=foot_val,
            funding_score=fund_val,
            volatility_score=vol_val,
            conviction_score=norm_conviction,
            # Placeholder values for granular metrics not fully exposed yet
            imbalance_ratio=0.5, # TBD from state
            compression_score=0.5, # TBD from state
            flow_zscore=0.0,
            impulse_strength=0.0
        )
