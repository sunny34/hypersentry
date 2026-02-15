import requests
import json

url = "https://api.hyperliquid.xyz/info"
headers = {"Content-Type": "application/json"}
data = {"type": "metaAndAssetCtxs"}

response = requests.post(url, json=data, headers=headers)
if response.status_code == 200:
    res = response.json()
    meta = res[0]
    universe = meta.get("universe", [])
    
    print(f"Total perps in universe: {len(universe)}")
    
    found = False
    for idx, asset in enumerate(universe):
        if asset["name"] == "CYBER":
            print(f"Found CYBER in universe at index {idx}")
            print(json.dumps(asset, indent=2))
            found = True
            break
    
    if not found:
        print("CYBER not found in 'universe' (Perps). Checking Spot...")
        # Spot is handled differently, usually not in 'universe' of perps response directly or needs different payload?
        # Actually in metaAndAssetCtxs, [0] is meta. 
        # structure is usually { "universe": [...], "spot": [...] } or similar?
        print("Meta keys:", meta.keys())

else:
    print("Failed to fetch info")
