from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import datetime

class IntelProvider(ABC):
    """
    Abstract base class for all intelligence providers (Twitter, Telegram, RSS, etc.)
    """
    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    async def fetch_latest(self) -> List[Dict[str, Any]]:
        """
        Fetch latest intelligence data from the source.
        Returns a list of dictionaries with normalized schema.
        """
        pass

    def normalize(
        self,
        raw_id: str,
        title: str,
        content: str,
        url: str,
        timestamp: datetime.datetime,
        sentiment: str = "neutral",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Normalize raw data into a common schema.
        """
        return {
            "id": f"{self.name}_{raw_id}",
            "title": title,
            "content": content,
            "url": url,
            "source": self.name,
            "timestamp": timestamp.isoformat(),
            "sentiment": sentiment,
            "reco": "neutral", # To be filled by AI analyzer if needed
            "confidence": 0,
            "is_high_impact": False,
            "metadata": metadata or {},
        }
