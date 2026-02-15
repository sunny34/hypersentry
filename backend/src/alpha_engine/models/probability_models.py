from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime

class FeatureVector(BaseModel):
    """
    Structured feature vector for probabilistic forecasting.
    Normalizes alpha signals for statistical modeling.
    """
    regime_score: float
    liquidation_score: float
    footprint_score: float
    funding_score: float
    volatility_score: float
    conviction_score: float
    imbalance_ratio: float
    compression_score: float
    flow_zscore: float
    impulse_strength: float

class ProbabilityResult(BaseModel):
    """
    Output of the probabilistic forecasting engine.
    Estimates the likelihood of directional moves and squeeze intensity.
    """
    symbol: str
    prob_up_1pct: float
    prob_down_1pct: float
    squeeze_intensity: float # P_up - P_down
    expected_move: float     # Combined expected value
    calibration_quality: float # Brier Score or similar
    timestamp: int

class TrainingMetrics(BaseModel):
    """
    Performance metrics for a trained probability model.
    """
    auc: float
    brier_score: float
    calibration_error: float
