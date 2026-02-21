import asyncio
import logging
import datetime
from typing import List, Dict, Any
from src.services.event_bus import event_bus
from .providers.rss import RSSProvider
from .providers.twitter import TwitterProvider
from .providers.telegram import TelegramProvider
from .providers.polymarket import PolymarketProvider
from .providers.microstructure import MicrostructureProvider
# from .providers.worldmonitor import WorldMonitorProvider
from .filter import IntelFilter
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
            # WorldMonitorProvider()
        ]
        self.sentiment_analyzer = SentimentAnalyzer()
        self.intel_filter = IntelFilter()
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
                for provider, res in zip(self.providers, results):
                    if isinstance(res, list):
                        for item in res:
                            if not isinstance(item, dict):
                                logger.warning("Provider returned non-dict item provider=%s item=%r", provider.name, item)
                                continue
                            item_id = item.get("id")
                            if not item_id:
                                logger.warning("Provider returned item without id provider=%s item=%r", provider.name, item)
                                continue
                            if item_id not in self.cache:
                                if item.get("source") == "microstructure":
                                    item["is_high_impact"] = True
                                new_items.append(item)
                                self.cache.add(item_id)
                    elif isinstance(res, Exception):
                        logger.error("Provider failed provider=%s err=%s", provider.name, res)
                    else:
                        logger.warning("Provider returned unexpected payload provider=%s type=%s", provider.name, type(res).__name__)
                # Filter Noise & Duplicates
                filtered_items = self.intel_filter.filter(new_items, self.recent_items)
                
                # Broadcast new intelligence
                if filtered_items:
                    # 🚀 Perform Deep Sentiment Analysis (Step 4)
                    logger.info("🧠 Analyzing sentiment with Gemini 1.5 Flash...")
                    await self.sentiment_analyzer.analyze_batch(filtered_items)
                    
                    # Persist to Database (Persistence Layer)
                    try:
                        import dateutil.parser
                        with get_db_session() as db:
                            for item in filtered_items:
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
                    await event_bus.publish(
                        "intel_alpha",
                        new_items,
                        source="intel_engine",
                        channel="public",
                    )

                # Maintain cache size
                if len(self.cache) > 1000:
                    self.cache = set(list(self.cache)[-500:])
                    
                # Clean up recent items to keep only last 200
                if len(self.recent_items) > 200:
                    self.recent_items = self.recent_items[:200]

            except Exception as e:
                logger.error(f"Intel Engine Error: {e}")

            await asyncio.sleep(self.polling_interval)

    def get_global_sentiment(self) -> Dict[str, Any]:
        """
        Calculates a real-time 'Global Pulse' score (0-100).
        Aggregates News, Prediction Markets, and Institutional Order Flow.
        0 = Extreme Fear, 100 = Extreme Greed.
        50 = Neutral.
        """
        score = 50.0
        details = {"news": 0, "prediction": 0, "flow": 0}
        
        # 1. News Sentiment (Last 20 items)
        for item in self.recent_items[:20]:
            s_score = item.get("sentiment_score", 0)
            if s_score > 0: score += 1
            elif s_score < 0: score -= 1
            
        details["news"] = score - 50 # Tracking the delta
        
        # 2. Prediction Markets (Polymarket)
        # Scan for high-probability macro/crypto events
        poly_impact = 0
        for item in self.recent_items[:50]:
            if item.get("metadata", {}).get("type") == "prediction":
                prob = item.get("metadata", {}).get("probability", 50)
                # If prob > 70% and sentiment is bullish -> Add score
                # This is a heuristic: "Prediction: BTC to 100k" with 80% YES is bullish
                # The sentiment field is already set by Polymarket provider based on YES%
                if item.get("sentiment") == "bullish":
                    poly_impact += 2
                elif item.get("sentiment") == "bearish":
                    poly_impact -= 2
        
        score += poly_impact
        details["prediction"] = poly_impact

        # 3. Institutional Flow (BTC Premium/CVD)
        flow_impact = 0
        micro_provider = next((p for p in self.providers if p.name == "microstructure"), None)
        if micro_provider and 'BTC' in micro_provider.states:
            state = micro_provider.states['BTC']
            spread = state.get("cb_spread_usd", 0)
            cvd = state.get("cvd", 0)

            # Coinbase Premium Impact
            if spread > 30:
                flow_impact += 10
            elif spread > 10:
                flow_impact += 5
            elif spread < -30:
                flow_impact -= 10
            elif spread < -10:
                flow_impact -= 5

            # CVD Trend Impact
            if cvd > 1000:
                flow_impact += 5
            elif cvd < -1000:
                flow_impact -= 5
            
        score += flow_impact
        details["flow"] = flow_impact
        
        # Clamp
        score = max(0, min(100, score))
        
        # Determine Label
        label = "Neutral"
        if score >= 80: label = "Extreme Greed"
        elif score >= 60: label = "Greed"
        elif score <= 20: label = "Extreme Fear"
        elif score <= 40: label = "Fear"
        
        return {
            "score": round(score),
            "label": label,
            "breakdown": details,
            "timestamp": datetime.datetime.now().isoformat()
        }

    def stop(self):
        self.is_running = False
        logger.info("🛑 Intel Engine Offline.")

# Global instance
engine = IntelEngine()
