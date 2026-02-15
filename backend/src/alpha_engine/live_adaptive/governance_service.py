import time
from datetime import datetime
from typing import Dict, List, Optional
from src.alpha_engine.models.governance_models import GovernanceReport, DriftMetrics
from src.alpha_engine.models.probability_models import FeatureVector
from src.alpha_engine.live_adaptive.drift_detector import DriftDetector
from src.alpha_engine.live_adaptive.calibration_monitor import CalibrationMonitor
from src.alpha_engine.live_adaptive.regime_classifier import MacroRegimeClassifier
from src.alpha_engine.live_adaptive.model_registry import ModelRegistry
from src.alpha_engine.state.state_store import global_state_store

class GovernanceService:
    """
    Operational hub for Alpha Engine governance.
    Coordinates macro switches, drift detection, and automated model health checks.
    """

    def __init__(self, symbol: str):
        self.symbol = symbol
        self.registry = ModelRegistry()
        self.calibration_monitor = CalibrationMonitor()
        self.drift_detector: Optional[DriftDetector] = None
        self.current_regime = "NORMAL_MARKET"
        self.active_model_id = "default_model_v1"
        
        # Hist buffers
        self.feature_history: List[FeatureVector] = []

    async def update(self, state_data: Dict, features: FeatureVector, y_true_up: Optional[bool] = None, y_prob_up: Optional[float] = None):
        """
        Main governance loop iteration.
        """
        # 1. Macro Regime Detection
        # (Assuming vol_24h_percentile is passed in state or derived)
        state = await global_state_store.get_state(self.symbol)
        if state:
            new_regime = MacroRegimeClassifier.classify(state, vol_24h_percentile=0.5)
            if new_regime != self.current_regime:
                self.current_regime = new_regime
                # Potential model swap triggered here

        # 2. Calibration Monitoring
        if y_true_up is not None and y_prob_up is not None:
            self.calibration_monitor.add_prediction(y_true_up, y_prob_up)

        # 3. Drift Monitoring
        self.feature_history.append(features)
        if len(self.feature_history) > 1000:
            self.feature_history.pop(0)

    def get_health_report(self) -> GovernanceReport:
        calib_metrics = self.calibration_monitor.get_metrics()
        
        # Determine status
        status = "OPTIMAL"
        if calib_metrics["brier"] > 0.25:
            status = "DEGRADED"
        elif calib_metrics["brier"] > 0.15:
            status = "STALE"

        # Simplified drift check for report
        drift_map = {}
        if self.drift_detector and len(self.feature_history) >= 100:
            drift_map = self.drift_detector.check_drift(self.feature_history[-100:])

        return GovernanceReport(
            symbol=self.symbol,
            active_regime=self.current_regime,
            active_model_id=self.active_model_id,
            feature_drift=drift_map,
            calibration_status=status,
            shadow_model_active=False,
            last_update=datetime.now()
        )

# Global store for gov services (one per symbol)
governance_manager: Dict[str, GovernanceService] = {}

async def get_governance_service(symbol: str) -> GovernanceService:
    if symbol not in governance_manager:
        governance_manager[symbol] = GovernanceService(symbol)
    return governance_manager[symbol]
