from src.client_wrapper import HyperliquidClient
import time

try:
    print("Initializing Client...")
    client = HyperliquidClient()
    
    end_time = int(time.time() * 1000)
    start_time = end_time - 24 * 60 * 60 * 1000
    
    print("Fetching Candles for BTC...")
    candles = client.get_candles("BTC", "1h", start_time, end_time)
    
    print(f"Candles Count: {len(candles)}")
    if len(candles) > 0:
        print(f"First Candle: {candles[0]}")
    else:
        print("Received empty list.")

except Exception as e:
    print(f"CRITICAL ERROR: {e}")
    import traceback
    traceback.print_exc()
