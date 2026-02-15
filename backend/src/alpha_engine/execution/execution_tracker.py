from datetime import datetime
from typing import Dict, List, Any
import json
import os
import logging

logger = logging.getLogger(__name__)

class ExecutionTracker:
    """
    Logs planned vs realized execution to analyze implementation shortfall.
    Saves JSON reports for post-trade analysis.
    """

    def __init__(self, log_path: str = "logs/execution"):
        self.log_path = log_path
        os.makedirs(log_path, exist_ok=True)
        self.history: List[Dict] = []

    def record_plan(self, plan: Dict[str, Any]):
        """
        Stores the initial execution plan upon generation.
        """
        entry = {
            "type": "PLAN",
            "timestamp": datetime.now().isoformat(),
            "data": plan
        }
        self.history.append(entry)
        if len(self.history) > 5000:
            self.history.pop(0)
        self._flush_to_disk()

    def record_fill(self, fill_event: Dict[str, Any]):
        """
        Stores actual fill details (price, size, fee, slippage).
        """
        # Comparison logic:
        # Realized Slippage = (Fill Price - Plan Mid Price) / Plan Mid Price * 10000
        # Implementation Shortfall = (Fill Price - Decision Price)
        
        entry = {
            "type": "FILL",
            "timestamp": datetime.now().isoformat(),
            "data": fill_event
        }
        self.history.append(entry)
        if len(self.history) > 5000:
            self.history.pop(0)
        self._flush_to_disk()

    def _flush_to_disk(self):
        """
        Async log writing (simulated sync for now).
        """
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            with open(f"{self.log_path}/exec_{today}.jsonl", "a", encoding="utf-8") as f:
                if self.history:
                    f.write(json.dumps(self.history[-1], default=str) + "\n")
        except OSError:
            logger.exception("Failed writing execution tracker logs to disk")
