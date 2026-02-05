from pydantic import BaseModel
from typing import Optional

class AddWalletRequest(BaseModel):
    address: str
    label: Optional[str] = None
    active_trading: bool = False

class TwapRequest(BaseModel):
    token: str

class TwapConfigRequest(BaseModel):
    min_size: float

class UpdateProfileRequest(BaseModel):
    telegram_chat_id: str

class KeyInput(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    label: Optional[str] = None

class ArbExecutionRequest(BaseModel):
    symbol: str
    size_usd: float
    direction: str # e.g. "Long HL / Short Binance"

class CandlesRequest(BaseModel):
    token: str
    interval: str
    start_time: int
    end_time: int

class BacktestRequest(BaseModel):
    strategy: str  # "rsi", "funding"
    token: str
    params: Optional[dict] = {}

class AnalyzeRequest(BaseModel):
    token: str
    interval: str = "1h"

class OrderRequest(BaseModel):
    token: str
    side: str  # "buy" or "sell"
    size: float
    price: Optional[float] = None
    order_type: str = "market"  # "market" or "limit"
