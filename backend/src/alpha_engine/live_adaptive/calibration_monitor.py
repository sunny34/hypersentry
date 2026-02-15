import numpy as np
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from typing import List, Dict

class CalibrationMonitor:
    """
    Monitors the real-time performance and calibration accuracy of directional models.
    """

    def __init__(self, window_size: int = 500):
        self.window_size = window_size
        self.history = [] # List of (y_true, y_prob)

    def add_prediction(self, y_true: bool, y_prob: float):
        self.history.append((int(y_true), y_prob))
        if len(self.history) > self.window_size:
            self.history.pop(0)

    def get_metrics(self) -> Dict[str, float]:
        if len(self.history) < 50:
            return {"brier": 0.0, "auc": 0.5, "ece": 0.0}

        y_true, y_prob = zip(*self.history)
        y_true = np.array(y_true)
        y_prob = np.array(y_prob)

        return {
            "brier": float(brier_score_loss(y_true, y_prob)),
            "log_loss": float(log_loss(y_true, y_prob)),
            "auc": float(roc_auc_score(y_true, y_prob)) if len(np.unique(y_true)) > 1 else 0.5,
            "ece": float(self._calculate_ece(y_true, y_prob))
        }

    def _calculate_ece(self, y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> float:
        """
        Calculates Expected Calibration Error.
        """
        bin_boundaries = np.linspace(0, 1, n_bins + 1)
        ece = 0.0
        n = len(y_prob)

        for i in range(n_bins):
            bin_idx = (y_prob > bin_boundaries[i]) & (y_prob <= bin_boundaries[i+1])
            if np.sum(bin_idx) > 0:
                bin_acc = np.mean(y_true[bin_idx])
                bin_conf = np.mean(y_prob[bin_idx])
                ece += (np.sum(bin_idx) / n) * np.abs(bin_acc - bin_conf)
        
        return ece
