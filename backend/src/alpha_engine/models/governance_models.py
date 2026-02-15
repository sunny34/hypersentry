from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal
from datetime import datetime

class ModelMetadata(BaseModel):
    """
    Governance metadata for a versioned Alpha Model.
    """
    model_id: str
    training_period_start: datetime
    training_period_end: datetime
    feature_set: List[str]
    regime_type: str # e.g., "TRENDING_HIGH_VOL"
    sharpe: float
    auc: float
    brier: float
    calibration_error: float
    deployment_timestamp: datetime
    is_active: bool = False

class DriftMetrics(BaseModel):
    """
    Statistics capturing the shift in feature distributions over time.
    """
    feature_name: str
    rolling_mean: float
    rolling_std: float
    psi_score: float # Population Stability Index
    kl_divergence: Optional[float] = None
    is_drifted: bool

class GovernanceReport(BaseModel):
    """
    Summary of model health and macro regime status.
    """
    symbol: str
    active_regime: str
    active_model_id: str
    feature_drift: Dict[str, DriftMetrics]
    calibration_status: str # "OPTIMAL", "STALE", "DEGRADED"
    shadow_model_active: bool
    last_update: datetime
