import asyncio
import aiohttp
import json

async def main():
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect("wss://api.hyperliquid.xyz/ws") as ws:
            await ws.send_json({
                "method": "subscribe",
                "subscription": {"type": "trades", "coin": "HYPE"}
            })
            
            print("Listening for trades...")
            count = 0
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = msg.json()
                    if data['channel'] == 'trades':
                        trades = data['data']
                        for t in trades:
                            print(json.dumps(t, indent=2))
                            count += 1
                        if count > 5:
                            break
                            
if __name__ == "__main__":
    asyncio.run(main())
