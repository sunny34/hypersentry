from typing import Tuple

class SlippageModel:
    """
    Estimates market impact before submitting orders to the orderbook.
    Based on SQRT Root Law of Impact:
    Impact = k * volatility * (Size / ADV)^0.5
    Simplified for live orderbook impact:
    Impact = spread/2 + k * (Size / Liquidtity)^alpha
    """

    def __init__(self, impact_constant_k: float = 0.5, impact_exponent_alpha: float = 0.6):
        self.k = impact_constant_k
        self.alpha = impact_exponent_alpha

    def estimate(self, 
        order_size_usd: float, 
        available_liquidity_usd: float, 
        spread_bps: float,
        volatility_bps: float
    ) -> Tuple[float, float]:
        """
        Returns (slippage_bps, impact_cost_usd)
        """
        if available_liquidity_usd <= 0:
            return (1000.0, order_size_usd * 0.1) # Extreme penalty if no book

        # Ratio of order to available book depth
        participation_ratio = order_size_usd / available_liquidity_usd
        
        # Volatility adjustment (higher vol = thinner books usually = higher impact)
        vol_scaler = max(1.0, volatility_bps / 10.0) # Normalize around 10bps vol? 
        
        # Impact model
        # Base cost is half spread (crossing the spread)
        crossing_cost_bps = spread_bps / 2.0
        
        # Additional impact from eating into the book
        depth_impact_bps = self.k * vol_scaler * (participation_ratio ** self.alpha) * 10000.0
        
        # Total expected slippage relative to mid price
        total_slippage_bps = crossing_cost_bps + depth_impact_bps
        
        impact_cost_usd = order_size_usd * (total_slippage_bps / 10000.0)
        
        return total_slippage_bps, impact_cost_usd
