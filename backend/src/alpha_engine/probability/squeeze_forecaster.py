from src.alpha_engine.models.probability_models import ProbabilityResult

class SqueezeForecaster:
    """
    Synthesizes directional probabilities into high-level indicators.
    Calculates Squeeze Intensity and Expected Move magnitude.
    """

    @staticmethod
    def forecast(
        symbol: str, 
        p_up: float, 
        p_down: float, 
        realized_vol: float = 0.012,
        quality: float = 0.0,
        timestamp: int = 0
    ) -> ProbabilityResult:
        
        # Squeeze Intensity: directional preference of the probability skew
        intensity = p_up - p_down
        
        # Expected Move: Probabilistic expectation of return magnitude
        # We use realized_vol as the base move size for the selected time horizon
        expected_move = intensity * realized_vol

        return ProbabilityResult(
            symbol=symbol,
            prob_up_1pct=round(p_up, 4),
            prob_down_1pct=round(p_down, 4),
            squeeze_intensity=round(intensity, 4),
            expected_move=round(expected_move, 6),
            calibration_quality=round(quality, 4),
            timestamp=timestamp
        )
