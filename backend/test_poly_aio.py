import asyncio
import aiohttp
import json
import datetime

async def test_poly():
    base_url = "https://gamma-api.polymarket.com"
    params = {
        "active": "true",
        "closed": "false",
        "limit": 100,
        "q": "Iran"
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{base_url}/events", params=params) as resp:
            if resp.status == 200:
                events = await resp.json()
                print(f"Found {len(events)} Iran related events")
                for event in events:
                    print(f"TITLE: {event.get('title')}")
                    markets = event.get("markets", [])
                    if markets:
                        market = markets[0]
                        print(f"  Outcome Prices: {market.get('outcomePrices')}")
                        print(f"  Volume: {event.get('volume')}")
            else:
                print(f"Error: {resp.status}")

if __name__ == "__main__":
    asyncio.run(test_poly())
