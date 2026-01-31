import asyncio
import aiohttp
import json

async def test_ctx():
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect("wss://api.hyperliquid.xyz/ws") as ws:
            # Subscribe to HYPE context
            msg = {
                "method": "subscribe",
                "subscription": {"type": "activeAssetCtx", "coin": "HYPE"}
            }
            await ws.send_json(msg)
            print("Subscribed to HYPE activeAssetCtx...")
            
            counter = 0
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = msg.json()
                    if data.get("channel") == "activeAssetCtx":
                        print(json.dumps(data, indent=2))
                        counter += 1
                        if counter >= 2:
                            break 
                        
asyncio.run(test_ctx())
