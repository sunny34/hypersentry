from datetime import datetime, timedelta
from typing import List
from src.alpha_engine.models.adaptive_models import WalkForwardWindow

class WindowSplitter:
    """
    Generates rolling walk-forward cross-validation windows.
    Prevents lookahead bias by ensuring clear separation between training and test data.
    """

    @staticmethod
    def split(
        start_time: datetime,
        end_time: datetime,
        train_days: int = 14,
        test_days: int = 7,
        step_days: int = 7
    ) -> List[WalkForwardWindow]:
        windows = []
        current_train_start = start_time
        
        while True:
            current_train_end = current_train_start + timedelta(days=train_days)
            current_test_start = current_train_end
            current_test_end = current_test_start + timedelta(days=test_days)
            
            if current_test_end > end_time:
                break
                
            windows.append(WalkForwardWindow(
                train_start=current_train_start,
                train_end=current_train_end,
                test_start=current_test_start,
                test_end=current_test_end
            ))
            
            current_train_start += timedelta(days=step_days)
            
        return windows
