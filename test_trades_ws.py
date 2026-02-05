import asyncio
import aiohttp
import json

async def test_trades():
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect("wss://api.hyperliquid.xyz/ws") as ws:
            msg = {
                "method": "subscribe",
                "subscription": {"type": "trades", "coin": "HYPE"}
            }
            await ws.send_json(msg)
            print("Subscribed to HYPE trades...")
            
            counter = 0
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = msg.json()
                    if data.get("channel") == "trades":
                        print(json.dumps(data, indent=2))
                        counter += 1
                        if counter >= 3:
                            break 
                        
asyncio.run(test_trades())
