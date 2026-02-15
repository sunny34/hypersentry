from typing import Dict, Literal
from datetime import datetime

from src.alpha_engine.models.execution_models import ExecutionPlan, SlippageMetrics, UrgencyMetrics, OrderAction
from src.alpha_engine.execution.slippage_model import SlippageModel
from src.alpha_engine.execution.urgency_model import UrgencyModel
from src.alpha_engine.execution.order_selector import OrderSelector
from src.alpha_engine.execution.slicer import OrderSlicer
from src.alpha_engine.execution.adverse_selection_guard import AdverseSelectionGuard
from src.alpha_engine.execution.execution_tracker import ExecutionTracker

class ExecutionService:
    """
    Coordination Layer for Execution.
    Takes RiskService-sized orders and optimally executes them.
    Orchestrates slippage estimation, urgency calculation, order slicing, and adverse selection checks.
    """

    def __init__(self):
        self.slip_model = SlippageModel()
        self.urgency_model = UrgencyModel()
        self.order_selector = OrderSelector()
        self.slicer = OrderSlicer()
        self.guard = AdverseSelectionGuard()
        self.tracker = ExecutionTracker()

    def generate_plan(self, 
        symbol: str, 
        direction: Literal["BUY", "SELL"],
        size_usd: float,
        # Market State (from Intel Engine)
        available_liquidity_usd: float,
        spread_bps: float,
        volatility_bps: float,
        book_imbalance: float,
        # Alpha State (from Conviction Engine)
        conviction_score: float,
        impulse_strength: float,
        regime: str,
        probability_decay_per_min: float = 0.0,
        recent_sweep_detected: bool = False,
    ) -> ExecutionPlan:
        
        # 1. Estimate Slippage
        slip_bps, cost_usd = self.slip_model.estimate(
            size_usd, available_liquidity_usd, spread_bps, volatility_bps
        )
        
        slip_metrics = SlippageMetrics(
            expected_impact_bps=slip_bps,
            expected_impact_usd=cost_usd,
            liquidity_available_usd=available_liquidity_usd,
            depth_processed_levels=20 # Placeholder
        )
        
        # 2. Determine Urgency
        urgency_score = self.urgency_model.compute(
            conviction_score,
            impulse_strength,
            regime,
            probability_decay_per_min=max(0.0, probability_decay_per_min),
        )
        
        urg_metrics = UrgencyMetrics(
            urgency_score=urgency_score,
            impulse_factor=impulse_strength,
            conviction_factor=conviction_score,
            regime_adjustment=0.0,
            decay_rate=0.0
        )
        
        # 3. Select Strategy
        strategy = self.order_selector.select(urgency_score)
        
        # 4. Slice Order
        # Slicer needs to know max safe impact per slice.
        # We can pass available depth and urgency to slicer.
        # If urgency high -> slices can be bigger.
        raw_slices = self.slicer.slice_order(
            size_usd, available_liquidity_usd, strategy, urgency_score
        )
        
        final_slices = []
        for s in raw_slices:
            action = OrderAction(
                order_type=s["type"],
                direction=direction,
                amount_usd=s["size"],
                urgency=s["urgency"],
                slice_id=s.get("slice_id", 0),
                delay_ms=s.get("delay_ms", 0)
            )
            final_slices.append(action)
            
        # 5. Adverse Selection Safety Check
        is_safe = self.guard.check(
            current_spread_bps=spread_bps,
            book_imbalance_ratio=book_imbalance,
            recent_sweep_detected=recent_sweep_detected,
            liquidity_available_usd=available_liquidity_usd
        )
        
        checks = {"safe_to_execute": is_safe, "spread_ok": spread_bps < 20, "liquidity_ok": available_liquidity_usd > 1000}
        
        # 6. Construct Plan
        plan = ExecutionPlan(
            symbol=symbol,
            total_size_usd=size_usd,
            direction=direction,
            strategy=strategy,
            slippage_metrics=slip_metrics,
            urgency_metrics=urg_metrics,
            slices=final_slices,
            adverse_selection_checks=checks,
            timestamp=datetime.now()
        )
        
        # 7. Log Plan
        self.tracker.record_plan(plan.model_dump())
        
        return plan

# Global Service
execution_service = ExecutionService()
