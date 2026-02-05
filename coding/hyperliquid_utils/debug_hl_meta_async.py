import aiohttp
import asyncio
import json

async def main():
    url = "https://api.hyperliquid.xyz/info"
    headers = {"Content-Type": "application/json"}
    data = {"type": "metaAndAssetCtxs"}

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=data, headers=headers) as response:
            if response.status == 200:
                res = await response.json()
                meta = res[0]
                universe = meta.get("universe", [])
                
                print(f"Total perps in universe: {len(universe)}")
                
                found = False
                for idx, asset in enumerate(universe):
                    if asset["name"] == "CYBER":
                        print(f"Found CYBER in universe at index {idx}")
                        # Print relevant fields
                        print(f"Name: {asset.get('name')}")
                        print(f"SzDecimals: {asset.get('szDecimals')}")
                        print(f"MaxLeverage: {asset.get('maxLeverage')}")
                        print(f"OnlyIsolated: {asset.get('onlyIsolated')}")
                        found = True
                        break
                
                if not found:
                    print("CYBER NOT found in 'universe'. Checking Spot...")
            else:
                print(f"Failed to fetch info: {response.status}")

asyncio.run(main())
