import numpy as np
from typing import Dict, List, Optional
from src.alpha_engine.models.probability_models import FeatureVector
from src.alpha_engine.models.governance_models import DriftMetrics

class DriftDetector:
    """
    Monitors feature distribution drift in real-time.
    Uses Population Stability Index (PSI) to detect statistical shifts.
    """

    def __init__(self, baseline_samples: List[FeatureVector]):
        self.baseline_data = self._to_array(baseline_samples)
        self.feature_names = [
            "regime_score", "liquidation_score", "footprint_score", 
            "funding_score", "volatility_score", "conviction_score",
            "imbalance_ratio", "compression_score", "flow_zscore", "impulse_strength"
        ]
        self.psi_threshold = 0.2 # Standard PSI threshold for major shift

    def check_drift(self, current_samples: List[FeatureVector]) -> Dict[str, DriftMetrics]:
        current_data = self._to_array(current_samples)
        results = {}

        for i, name in enumerate(self.feature_names):
            baseline_col = self.baseline_data[:, i]
            current_col = current_data[:, i]

            psi = self._calculate_psi(baseline_col, current_col)
            
            results[name] = DriftMetrics(
                feature_name=name,
                rolling_mean=float(np.mean(current_col)),
                rolling_std=float(np.std(current_col)),
                psi_score=float(psi),
                is_drifted=psi > self.psi_threshold
            )
        
        return results

    def _calculate_psi(self, expected: np.ndarray, actual: np.ndarray, buckets: int = 10) -> float:
        """
        Calculates the Population Stability Index.
        """
        breakpoints = np.linspace(min(expected.min(), actual.min()), max(expected.max(), actual.max()), buckets)
        
        expected_percents = np.histogram(expected, bins=breakpoints)[0] / len(expected)
        actual_percents = np.histogram(actual, bins=breakpoints)[0] / len(actual)

        # Optimization: avoid zeros in division or log
        expected_percents = np.clip(expected_percents, 0.0001, 1)
        actual_percents = np.clip(actual_percents, 0.0001, 1)

        psi = np.sum((actual_percents - expected_percents) * np.log(actual_percents / expected_percents))
        return psi

    def _to_array(self, samples: List[FeatureVector]) -> np.ndarray:
        return np.array([[
            s.regime_score, s.liquidation_score, s.footprint_score,
            s.funding_score, s.volatility_score, s.conviction_score,
            s.imbalance_ratio, s.compression_score, s.flow_zscore,
            s.impulse_strength
        ] for s in samples])
