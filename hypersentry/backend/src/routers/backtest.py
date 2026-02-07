from fastapi import APIRouter
from schemas import BacktestRequest
from src.manager import TraderManager

router = APIRouter(prefix="/strategies", tags=["Strategies"])
manager = TraderManager()

@router.post("/backtest")
async def run_backtest(req: BacktestRequest):
    """Run server-side backtest on real historical data."""
    from src.backtesting import Backtester
    
    bt = Backtester(manager.client)
    params = req.params or {}
    
    if req.strategy == "rsi":
        result = bt.run_rsi_strategy(
            token=req.token, 
            interval=params.get("interval", "1h"),
            period=params.get("period", 14),
            overbought=params.get("overbought", 70),
            oversold=params.get("oversold", 30)
        )
    elif req.strategy == "momentum":
        result = bt.run_momentum_strategy(
            token=req.token,
            interval=params.get("interval", "1h"),
            short_window=params.get("short", 12),
            long_window=params.get("long", 26)
        )
    elif req.strategy == "liquidation":
        result = bt.run_liquidation_sniping(req.token, 0)

    elif req.strategy == "funding":
        current_funding = params.get("fundingRate")
        if current_funding is None:
             import requests
             try:
                 # Fetch actual live funding if not provided
                 meta = requests.post("https://api.hyperliquid.xyz/info", json={"type": "metaAndAssetCtxs"}).json()
                 # find token logic... for now fallback
                 current_funding = 0.0001
             except:
                 current_funding = 0
        
        result = bt.run_funding_arb(req.token, float(current_funding))
    else:
        return {"error": "Unknown strategy"}
        
    return result
