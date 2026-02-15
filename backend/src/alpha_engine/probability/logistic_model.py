import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from typing import List, Tuple, Optional
import pickle
import os
import logging
import hashlib
import hmac

logger = logging.getLogger(__name__)

class ProbabilisticModel:
    """
    Wrapper for Logistic Regression models used for directional forecasting.
    Supports training, serialization, and calibrated probability estimates.
    """

    def __init__(self, name: str):
        self.name = name
        self.model = LogisticRegression(C=1.0, solver='lbfgs', max_iter=1000)
        self.is_trained = False

    def train(self, X: np.ndarray, y: np.ndarray):
        """
        Trains the model on a feature matrix and binary label vector.
        """
        if len(np.unique(y)) < 2:
            # Cannot train on a single class
            return
            
        self.model.fit(X, y)
        self.is_trained = True

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        Returns the probability of the positive class.
        """
        if not self.is_trained:
            return np.array([0.5] * len(X))
        
        # sklearn returns [P(0), P(1)]
        return self.model.predict_proba(X)[:, 1]

    def save(self, path: str):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, 'wb') as f:
            pickle.dump(self.model, f)
        signing_key = os.getenv("MODEL_REGISTRY_SIGNING_KEY", "")
        if signing_key:
            with open(path, "rb") as f:
                blob = f.read()
            sig = hmac.new(signing_key.encode("utf-8"), blob, hashlib.sha256).hexdigest()
            with open(f"{path}.sig", "w", encoding="utf-8") as sigf:
                sigf.write(sig)

    def load(self, path: str):
        if os.path.exists(path):
            signing_key = os.getenv("MODEL_REGISTRY_SIGNING_KEY", "")
            if signing_key and os.path.exists(f"{path}.sig"):
                with open(path, "rb") as f:
                    blob = f.read()
                with open(f"{path}.sig", "r", encoding="utf-8") as sigf:
                    stored = sigf.read().strip()
                actual = hmac.new(signing_key.encode("utf-8"), blob, hashlib.sha256).hexdigest()
                if stored != actual:
                    logger.error("Refusing to load model due to invalid signature path=%s", path)
                    return
            with open(path, 'rb') as f:
                self.model = pickle.load(f)
            self.is_trained = True
            logger.info("Loaded probabilistic model name=%s path=%s", self.name, path)
            
    @staticmethod
    def evaluate(y_true: np.ndarray, y_prob: np.ndarray) -> dict:
        return {
            "brier": brier_score_loss(y_true, y_prob),
            "auc": roc_auc_score(y_true, y_prob) if len(np.unique(y_true)) > 1 else 0.5
        }
