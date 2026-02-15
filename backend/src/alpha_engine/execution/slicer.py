from typing import List, Dict, Literal
import math

class OrderSlicer:
    """
    Intelligently splits large orders to minimize market impact.
    Uses strict rules on % of book depth.
    """

    def __init__(self, max_slice_depth_impact: float = 0.05):
        self.max_depth_impact = max_slice_depth_impact # e.g., never take more than 5% of L1-L10

    def slice_order(self, 
        total_size_usd: float,
        available_depth_usd: float,
        strategy: Literal["PASSIVE", "HYBRID", "AGGRESSIVE"],
        urgency: float
    ) -> List[Dict]:
        """
        Returns list of Slice specs {size_usd, order_type}
        """

        slices = []
        
        # Guard: If order is small relative to depth, just one slice
        if total_size_usd < (available_depth_usd * 0.01):
            return [{"size": total_size_usd, "type": "MARKET" if strategy == "AGGRESSIVE" else "LIMIT", "urgency": "HIGH"}]

        # Determine optimal slice size using impact constraint
        optimal_slice_usd = available_depth_usd * self.max_depth_impact
        # If urgency high, allow bigger slices (paying for speed)
        optimal_slice_usd *= (1.0 + urgency)
        
        optimal_slice_usd = max(100.0, optimal_slice_usd) # Min trade size constraint
        
        remaining_usd = total_size_usd
        slice_count = 0
        
        while remaining_usd > 0:
            current_slice_size = min(remaining_usd, optimal_slice_usd)
            
            # For Hybrid, initial slice is Market, rest are Limit
            # For Aggressive, all slices are Market but maybe time-delayed
            # For Passive, all are Limit
            
            o_type = "LIMIT"
            if strategy == "AGGRESSIVE":
                o_type = "MARKET"
            elif strategy == "HYBRID" and slice_count == 0:
                o_type = "MARKET"
                
            slices.append({
                "slice_id": slice_count,
                "size": round(current_slice_size, 2),
                "type": o_type,
                "urgency": "HIGH" if o_type == "MARKET" else "MEDIUM",
                "delay_ms": slice_count * 2000 # 2s spacing placeholder
            })
            
            remaining_usd -= current_slice_size
            slice_count += 1
            
        return slices
