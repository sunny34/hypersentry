import numpy as np
from sklearn.isotonic import IsotonicRegression
from typing import Optional

class ProbabilityCalibrator:
    """
    Implements probability calibration to ensure that P=0.7 actually means 
    a 70% historical frequency. Uses Isotonic Regression for non-parametric scaling.
    """

    def __init__(self):
        self.calibrator = IsotonicRegression(out_of_bounds='clip')
        self.is_fitted = False

    def fit(self, y_prob: np.ndarray, y_true: np.ndarray):
        """
        Fits the calibrator to transform uncalibrated scores into probabilities.
        """
        if len(y_prob) < 10: return
        self.calibrator.fit(y_prob, y_true)
        self.is_fitted = True

    def calibrate(self, y_prob: np.ndarray) -> np.ndarray:
        """
        Applies the calibration transformation.
        """
        if not self.is_fitted:
            return y_prob
        return self.calibrator.transform(y_prob)
