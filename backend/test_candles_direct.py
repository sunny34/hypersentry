
import asyncio
from hyperliquid.info import Info
from hyperliquid.utils import constants

async def test_candles():
    info = Info(constants.MAINNET_API_URL, skip_ws=True)
    
    # Test 1: Standard BTC 1h
    print("Testing BTC 1h...")
    try:
        import time
        end_time = int(time.time() * 1000)
        start_time = end_time - (24 * 60 * 60 * 1000) # 1 day ago
        
        candles = info.candles_snapshot("BTC", "1h", start_time, end_time)
        print(f"BTC 1h Candles: {len(candles)}")
        if candles:
            print(f"Sample: {candles[0]}")
    except Exception as e:
        print(f"BTC 1h Failed: {e}")

    # Test 2: Standard BTC 15m
    print("\nTesting BTC 15m...")
    try:
        candles = info.candles_snapshot("BTC", "15m", start_time, end_time)
        print(f"BTC 15m Candles: {len(candles)}")
    except Exception as e:
        print(f"BTC 15m Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_candles())
