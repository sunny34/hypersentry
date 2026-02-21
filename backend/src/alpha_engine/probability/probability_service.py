import numpy as np
import time
import logging
from typing import Optional, Dict, List
from src.alpha_engine.models.probability_models import ProbabilityResult, FeatureVector
# from src.alpha_engine.services.conviction_service import conviction_service Removed to break circular dep
from src.alpha_engine.probability.feature_builder import FeatureBuilder
from src.alpha_engine.probability.logistic_model import ProbabilisticModel
from src.alpha_engine.probability.calibrator import ProbabilityCalibrator
from src.alpha_engine.probability.squeeze_forecaster import SqueezeForecaster

from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.probability.label_builder import LabelBuilder

logger = logging.getLogger(__name__)

class ProbabilityService:
    """
    Orchestrates the probabilistic forecasting lifecycle.
    Manages model state, feature extraction, and real-time inference.
    """

    def __init__(self):
        self.upside_model = ProbabilisticModel("upside")
        self.downside_model = ProbabilisticModel("downside")
        self.upside_calibrator = ProbabilityCalibrator()
        self.downside_calibrator = ProbabilityCalibrator()
        self.training_metrics: Dict[str, float] = {
            "up_brier": 0.25,
            "down_brier": 0.25,
            "up_auc": 0.5,
            "down_auc": 0.5,
            "samples": 0.0,
        }
        self.last_trained_at_ms: int = 0

    @staticmethod
    def _to_model_features(fv: FeatureVector) -> List[float]:
        # Keep a strict, stable feature order for both training and inference.
        return [
            float(fv.regime_score),
            float(fv.liquidation_score),
            float(fv.footprint_score),
            float(fv.funding_score),
            float(fv.volatility_score),
            float(fv.conviction_score),
        ]

    async def _extract_training_features(self, snapshots: List[HistoricalMarketSnapshot]) -> np.ndarray:
        # Best effort: generate training features from the same conviction feature stack used in live inference.
        try:
            from src.alpha_engine.backtesting.signal_runner import SignalRunner

            runner = SignalRunner(symbol="TRAINING")
            rows: List[List[float]] = []
            for snapshot in snapshots:
                conviction = await runner.run_step(snapshot)
                fv = FeatureBuilder.build(conviction)
                rows.append(self._to_model_features(fv))
            if len(rows) == len(snapshots):
                return np.array(rows, dtype=float)
        except Exception as exc:
            logger.warning("probability_training_feature_fallback reason=%s", exc)

        # Fallback if signal reconstruction fails; keeps training operational.
        rows = []
        prev_price = snapshots[0].price
        prev_oi = snapshots[0].open_interest
        for i, s in enumerate(snapshots):
            ret_1 = (s.price - prev_price) / prev_price if prev_price > 0 else 0.0
            oi_delta = (s.open_interest - prev_oi) / max(abs(prev_oi), 1.0)
            vol_norm = s.volume / max(s.open_interest, 1.0)
            funding = s.funding_rate
            lookback_idx = max(0, i - 5)
            px_lb = snapshots[lookback_idx].price
            momentum_5 = (s.price - px_lb) / max(px_lb, 1.0)
            conviction_proxy = max(0.0, min(1.0, 0.5 + 0.5 * ret_1))
            rows.append([ret_1, oi_delta, vol_norm, funding, momentum_5, conviction_proxy])
            prev_price = s.price
            prev_oi = s.open_interest
        return np.array(rows, dtype=float)

    def _estimate_quality(self, p_up: float, p_down: float) -> float:
        up_brier = float(self.training_metrics.get("up_brier", 0.25))
        down_brier = float(self.training_metrics.get("down_brier", 0.25))
        up_auc = float(self.training_metrics.get("up_auc", 0.5))
        down_auc = float(self.training_metrics.get("down_auc", 0.5))
        brier_avg = max(0.0, min(1.0, (up_brier + down_brier) / 2.0))
        auc_avg = max(0.0, min(1.0, (up_auc + down_auc) / 2.0))

        # 0.25 is random baseline brier for balanced binary classification.
        brier_quality = max(0.0, min(1.0, 1.0 - (brier_avg / 0.25)))
        auc_quality = max(0.0, min(1.0, (auc_avg - 0.5) / 0.5))
        directional_quality = max(0.0, min(1.0, abs(float(p_up) - float(p_down)) * 2.0))

        base = 0.35
        if bool(getattr(self.upside_model, "is_trained", False)) and bool(getattr(self.downside_model, "is_trained", False)):
            base = 0.55

        quality = base + (0.25 * brier_quality) + (0.15 * auc_quality) + (0.05 * directional_quality)
        return max(0.0, min(0.99, float(quality)))

    async def train_on_window(self, snapshots: List[HistoricalMarketSnapshot]):
        """
        Trains and calibrates models on a specific historical window.
        Prevents lookahead bias by using structured labels.
        """
        if len(snapshots) < 20:
            logger.warning("Skipping training window: insufficient snapshots=%s", len(snapshots))
            return

        labels = LabelBuilder.build_labels(snapshots)
        if len(labels) != len(snapshots):
            logger.warning("Skipping training window due to label alignment mismatch snapshots=%s labels=%s", len(snapshots), len(labels))
            return

        x_arr = await self._extract_training_features(snapshots)
        y_up = np.array([1 if l[0] else 0 for l in labels], dtype=int)
        y_down = np.array([1 if l[1] else 0 for l in labels], dtype=int)

        self.upside_model.train(x_arr, y_up)
        self.downside_model.train(x_arr, y_down)

        up_probs = self.upside_model.predict_proba(x_arr)
        down_probs = self.downside_model.predict_proba(x_arr)
        self.upside_calibrator.fit(up_probs, y_up)
        self.downside_calibrator.fit(down_probs, y_down)
        up_eval = ProbabilisticModel.evaluate(y_up, up_probs)
        down_eval = ProbabilisticModel.evaluate(y_down, down_probs)
        self.training_metrics = {
            "up_brier": float(up_eval.get("brier", 0.25)),
            "down_brier": float(down_eval.get("brier", 0.25)),
            "up_auc": float(up_eval.get("auc", 0.5)),
            "down_auc": float(down_eval.get("auc", 0.5)),
            "samples": float(len(snapshots)),
        }
        self.last_trained_at_ms = int(time.time() * 1000)
        logger.info(
            "Trained probability models snapshots=%s upside_trained=%s downside_trained=%s up_brier=%.4f down_brier=%.4f up_auc=%.4f down_auc=%.4f",
            len(snapshots),
            self.upside_model.is_trained,
            self.downside_model.is_trained,
            self.training_metrics["up_brier"],
            self.training_metrics["down_brier"],
            self.training_metrics["up_auc"],
            self.training_metrics["down_auc"],
        )

    async def get_probabilities(self, symbol: str, realized_vol: float = 0.012) -> Optional["ProbabilityResult"]:
        # Local import avoids module-level circular dependency.
        from src.alpha_engine.services.conviction_service import conviction_service

        conviction = await conviction_service.get_conviction(symbol)
        if conviction is None:
            return None
        return self.calculate_probabilities(conviction, realized_vol)
        
    def calculate_probabilities(
        self, 
        conviction: 'ConvictionResult', 
        realized_vol: float = 0.012
    ) -> Optional['ProbabilityResult']:
        """
        Calculates directional probabilities based on the provided Conviction signal.
        """
        # 1. Build Feature Vector
        fv = FeatureBuilder.build(conviction)
        # Model expects six core engineered features in the current training implementation.
        X = np.array([self._to_model_features(fv)], dtype=float)
        
        # 2. Inference
        p_up_raw = 0.5
        p_down_raw = 0.5
        
        try:
             p_up_raw = self.upside_model.predict_proba(X)[0]
             p_down_raw = self.downside_model.predict_proba(X)[0]
        except Exception as exc:
             # Fallback if model not trained
             logger.warning("Probability model inference fallback in use: %s", exc)
             p_up_raw = 0.5 + (conviction.score - 50)/200 # rudimentary fallback
             p_down_raw = 0.5 - (conviction.score - 50)/200

        p_up_raw = min(1.0, max(0.0, float(p_up_raw)))
        p_down_raw = min(1.0, max(0.0, float(p_down_raw)))

        # 3. Calibration
        p_up = float(self.upside_calibrator.calibrate(np.array([p_up_raw]))[0])
        p_down = float(self.downside_calibrator.calibrate(np.array([p_down_raw]))[0])
        
        # If calibrated probabilities are flat (often happens with insufficient isotonic regression training)
        # but we have a strong conviction score, blend the conviction back in as a heuristic edge.
        if abs(p_up - p_down) < 0.01 and conviction.score != 50:
            skew = (conviction.score - 50) / 200.0  # e.g. score 60 -> +0.05
            p_up = min(0.99, max(0.01, p_up + skew))
            p_down = min(0.99, max(0.01, p_down - skew))
            
        quality = self._estimate_quality(p_up, p_down)

        # 4. Final Forecast
        return SqueezeForecaster.forecast(
             symbol=conviction.symbol,
             p_up=p_up,
             p_down=p_down,
             realized_vol=realized_vol,
             quality=quality,
             timestamp=conviction.timestamp
        )

# Global singleton
probability_service = ProbabilityService()
