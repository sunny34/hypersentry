from typing import List, Optional
import json
import csv
from datetime import datetime
from src.alpha_engine.models.backtest_models import HistoricalMarketSnapshot
from src.alpha_engine.models.liquidation_models import LiquidationLevel
from src.alpha_engine.models.footprint_models import Trade

class DataLoader:
    """
    Handles ingestion of historical data from various formats (CSV, JSON).
    Ensures data integrity for deterministic replay.
    """

    @staticmethod
    async def load_from_csv(file_path: str) -> List[HistoricalMarketSnapshot]:
        snapshots = []
        with open(file_path, mode='r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Basic parsing
                snapshot = HistoricalMarketSnapshot(
                    timestamp=datetime.fromisoformat(row['timestamp']),
                    price=float(row['price']),
                    funding_rate=float(row['funding_rate']),
                    open_interest=float(row['open_interest']),
                    volume=float(row.get('volume', 0.0)),
                    # Complex types stored as JSON strings in CSV columns
                    liquidation_levels=[LiquidationLevel(**l) for l in json.loads(row.get('liquidation_levels', '[]'))],
                    recent_trades=[Trade(**t) for t in json.loads(row.get('recent_trades', '[]'))],
                    book_bids=json.loads(row.get('book_bids', '[]')),
                    book_asks=json.loads(row.get('book_asks', '[]'))
                )
                snapshots.append(snapshot)
        return snapshots
