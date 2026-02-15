from typing import Dict, Optional
import logging
from datetime import datetime, timezone
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.live_adaptive.model_registry import ModelRegistry
from src.alpha_engine.models.governance_models import ModelMetadata
from src.alpha_engine.probability.probability_service import ProbabilityService

logger = logging.getLogger(__name__)

class RetrainingPipeline:
    """
    Automated pipeline triggered by drift or performance degradation.
    Initializes training, validation, and promotion logic for new models.
    """

    def __init__(self, registry: ModelRegistry):
        self.registry = registry

    async def execute(self, symbol: str, snapshots: list[HistoricalMarketSnapshot], regime: str):
        """
        Executes a retraining cycle.
        1. Split recent data
        2. Fit new model (Phase 7 logic)
        3. Store in Shadow Mode
        """
        logger.info("Triggering retraining for symbol=%s regime=%s", symbol, regime)
        if len(snapshots) < 20:
            logger.warning("Skipping retraining for symbol=%s due to insufficient snapshots=%s", symbol, len(snapshots))
            return None

        trainer = ProbabilityService()
        await trainer.train_on_window(snapshots)
        now_utc = datetime.now(timezone.utc)
        model_obj = {
            "upside_model": trainer.upside_model.model,
            "downside_model": trainer.downside_model.model,
            "trained_at": now_utc.isoformat(),
        }
        model_id = f"{symbol}_{regime}_{int(now_utc.timestamp())}"
        metadata = ModelMetadata(
            model_id=model_id,
            training_period_start=snapshots[0].timestamp,
            training_period_end=snapshots[-1].timestamp,
            feature_set=["ret_1", "oi_delta", "vol_norm", "funding", "price_from_start", "momentum_5"],
            regime_type=regime,
            sharpe=0.0,
            auc=0.5,
            brier=0.25,
            calibration_error=0.0,
            deployment_timestamp=now_utc,
            is_active=False,
        )
        self.registry.register_model(model_obj, metadata)
        logger.info("Retraining complete symbol=%s model_id=%s", symbol, model_id)
        return model_id

class ShadowValidator:
    """
    Side-by-side performance comparator for candidate vs. active models.
    Prevents deployment of superior training models that underperform in real-time.
    """

    def __init__(self, shadow_model_id: str, active_model_id: str):
        self.shadow_id = shadow_model_id
        self.active_id = active_model_id
        self.shadow_results = []
        self.active_results = []

    def log_comparison(self, y_true: bool, p_shadow: float, p_active: float):
        self.shadow_results.append((y_true, p_shadow))
        self.active_results.append((y_true, p_active))
