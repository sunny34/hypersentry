import asyncio
import logging
import datetime
from typing import List, Dict, Any
from src.ws_manager import manager as ws_manager
from .providers.rss import RSSProvider
from .providers.twitter import TwitterProvider
from .providers.telegram import TelegramProvider
from .providers.polymarket import PolymarketProvider
from .providers.microstructure import MicrostructureProvider
from .sentiment import SentimentAnalyzer
from database import get_db_session
from models import IntelItem

logger = logging.getLogger(__name__)

class IntelEngine:
    """
    The main orchestrator for real-time intelligence gathering.
    Polls various sources and broadcasts high-impact events to clients.
    """
    def __init__(self):
        self.providers = [
            RSSProvider(),
            TwitterProvider(),
            TelegramProvider(),
            PolymarketProvider(),
            MicrostructureProvider()
        ]
        self.sentiment_analyzer = SentimentAnalyzer()
        self.cache = set() # To prevent duplicate broadcasts
        self.recent_items = [] # To store actual items for REST access
        self.is_running = False
        self.polling_interval = 10 # 10 seconds polling (can be reduced for Twitter/Telegram)

    async def start(self):
        """Start the background intel gathering loop."""
        if self.is_running:
            return
        
        self.is_running = True
        logger.info("📡 Intel Engine Online. Orchestrating Multi-Source Intelligence...")
        
        # Hydrate cache from DB (Persistence Layer)
        try:
            with get_db_session() as db:
                # Load last 200 items
                db_items = db.query(IntelItem).order_by(IntelItem.timestamp.desc()).limit(200).all()
                for item in db_items:
                    self.recent_items.append(item.to_dict())
                    self.cache.add(item.id)
                logger.info(f"✅ Hydrated {len(db_items)} intel items from database.")
        except Exception as e:
            logger.error(f"Failed to hydrate intel cache: {e}")

        while self.is_running:
            try:
                tasks = [provider.fetch_latest() for provider in self.providers]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                new_items = []
                for res in results:
                    if isinstance(res, list):
                        for item in res:
                            if item["id"] not in self.cache:
                                if item.get("source") == "microstructure":
                                    item["is_high_impact"] = True
                                new_items.append(item)
                                self.cache.add(item["id"])
                    elif isinstance(res, Exception):
                        logger.error(f"Provider failed: {res}")

                # Broadcast new intelligence
                if new_items:
                    # 🚀 Perform Deep Sentiment Analysis (Step 4)
                    logger.info("🧠 Analyzing sentiment with Gemini 1.5 Flash...")
                    await self.sentiment_analyzer.analyze_batch(new_items)
                    
                    # Persist to Database (Persistence Layer)
                    try:
                        import dateutil.parser
                        with get_db_session() as db:
                            for item in new_items:
                                # Convert ISO string back to datetime for SQLite persistence
                                dt_timestamp = item["timestamp"]
                                if isinstance(dt_timestamp, str):
                                    dt_timestamp = dateutil.parser.isoparse(dt_timestamp)
                                
                                db_item = IntelItem(
                                    id=item["id"],
                                    source_type=item.get("source", "unknown"),
                                    title=item.get("title", "")[:5000],
                                    content=item.get("content", ""),
                                    url=item.get("url", ""),
                                    timestamp=dt_timestamp,
                                    sentiment=item.get("sentiment", "neutral"),
                                    sentiment_score=item.get("sentiment_score", 0.0),
                                    is_high_impact=item.get("is_high_impact", False),
                                    metadata_json=item.get("metadata", {})
                                )
                                db.merge(db_item) # Upsert
                    except Exception as e:
                        logger.error(f"Failed to persist intel items: {e}")

                    # Sort by timestamp
                    new_items.sort(key=lambda x: x["timestamp"], reverse=True)
                    
                    # Store in recent_items (prepend)
                    self.recent_items = (new_items + self.recent_items)[:200]
                    
                    logger.info(f"🔥 Found {len(new_items)} new Alpha signals. Broadcasting...")
                    await ws_manager.broadcast({
                        "type": "intel_alpha",
                        "data": new_items
                    })

                # Maintain cache size
                if len(self.cache) > 1000:
                    self.cache = set(list(self.cache)[-500:])
                    
                # Clean up recent items to keep only last 200
                if len(self.recent_items) > 200:
                    self.recent_items = self.recent_items[:200]

            except Exception as e:
                logger.error(f"Intel Engine Error: {e}")

            await asyncio.sleep(self.polling_interval)

    def stop(self):
        self.is_running = False
        logger.info("🛑 Intel Engine Offline.")

# Global instance
engine = IntelEngine()
