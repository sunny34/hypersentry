import feedparser
import datetime
import asyncio
from typing import List, Dict, Any
import logging
from .base import IntelProvider

logger = logging.getLogger(__name__)

class RSSProvider(IntelProvider):
    """
    Sourced intelligence from major crypto RSS feeds.
    """
    FEEDS = [
        ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
        ("CoinTelegraph", "https://cointelegraph.com/rss"),
        ("TheBlock", "https://www.theblock.co/rss.xml"),
        ("CryptoPanic", "https://cryptopanic.com/news/rss/")
    ]

    def __init__(self):
        super().__init__("RSS")

    async def fetch_latest(self) -> List[Dict[str, Any]]:
        loop = asyncio.get_event_loop()
        all_news = []
        
        for source_name, url in self.FEEDS:
            try:
                # Run feedparser in executor because it's blocking
                feed = await loop.run_in_executor(None, feedparser.parse, url)
                
                for entry in feed.entries[:10]:
                    dt = datetime.datetime.now()
                    if hasattr(entry, 'published_parsed'):
                        dt = datetime.datetime(*entry.published_parsed[:6])
                    
                    content = entry.get('summary', '') or entry.get('description', '')
                    title = entry.title
                    
                    # 1. High Impact Detection
                    high_impact_keywords = [
                        "BREAKING", "URGENT", "HACK", "EXPLOIT", "STOLEN", "SEC", "ETF", 
                        "APPROVAL", "BANNED", "LAWSUIT", "CRASH", "HALT", "LIQUIDATION"
                    ]
                    is_high_impact = any(kw in title.upper() or kw in content.upper() for kw in high_impact_keywords)
                    
                    # 2. Basic Sentiment Logic
                    bullish_keywords = ["SURGE", "ATH", "SUPPORT", "INFLOW", "BUY", "ADOPTION", "WHALE BUY"]
                    bearish_keywords = ["DUMP", "OUTFLOW", "SELL", "DIP", "SINK", "INVESTIGATION", "REJECTED"]
                    
                    sentiment = "neutral"
                    if any(kw in title.upper() for kw in bullish_keywords):
                        sentiment = "bullish"
                    elif any(kw in title.upper() for kw in bearish_keywords):
                        sentiment = "bearish"
                    
                    item = self.normalize(
                        raw_id=entry.link,
                        title=f"[{source_name}] {title}",
                        content=content,
                        url=entry.link,
                        timestamp=dt,
                        sentiment=sentiment
                    )
                    
                    item["is_high_impact"] = is_high_impact
                    item["metadata"] = {
                        "source_name": source_name,
                        "author": entry.get('author', 'Unknown'),
                        "tags": [t.get('term') for t in entry.get('tags', [])] if hasattr(entry, 'tags') else []
                    }
                    
                    all_news.append(item)
            except Exception as e:
                logger.warning("Error fetching RSS from source=%s err=%s", source_name, e)
                
        return all_news
