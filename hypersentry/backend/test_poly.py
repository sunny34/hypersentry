import asyncio
import httpx
import json
import datetime
from src.intel.providers.polymarket import PolymarketProvider

async def test_poly():
    p = PolymarketProvider()
    items = await p.fetch_latest()
    print(f"Fetched {len(items)} items")
    for item in items:
        if "Iran" in item['title'] or "Military" in item['title'] or "War" in item['title']:
            print(f"FOUND: {item['title']} - {item['content']}")
            print(f"Prob: {item['metadata']['probability']}%")
            print(f"Volume: {item['metadata']['volume']}")
    
    # Also search directly
    print("\nSearching for 'Iran'...")
    search_results = await p.fetch_markets_by_query("Iran")
    print(json.dumps(search_results, indent=2))

if __name__ == "__main__":
    asyncio.run(test_poly())
