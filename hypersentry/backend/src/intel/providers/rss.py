import feedparser
import datetime
import asyncio
from typing import List, Dict, Any
from .base import IntelProvider

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
                    
                    all_news.append(self.normalize(
                        raw_id=entry.link,
                        title=entry.title,
                        content=entry.get('summary', ''),
                        url=entry.link,
                        timestamp=dt,
                        sentiment="neutral"
                    ))
            except Exception as e:
                print(f"Error fetching RSS from {source_name}: {e}")
                
        return all_news
