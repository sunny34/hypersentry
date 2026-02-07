import asyncio
import sys
import os

# Add the backend directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.intel.engine import IntelEngine
from src.intel.providers.rss import RSSProvider

async def test_intel():
    print("Testing Intel Engine Logic...")
    provider = RSSProvider()
    print("Fetching RSS...")
    news = await provider.fetch_latest()
    print(f"Found {len(news)} items.")
    for item in news[:3]:
        print(f" - [{item['source']}] {item['title']} ({item['timestamp']})")

if __name__ == "__main__":
    asyncio.run(test_intel())
