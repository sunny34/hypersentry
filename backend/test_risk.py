import asyncio
from src.alpha_engine.risk.risk_service import risk_service

res_long = risk_service.calculate_risk(
    symbol="SOL",
    direction="LONG",
    win_prob=0.6,
    reward_risk_ratio=2.0,
    realized_vol_pct=0.01,
    current_equity=10000.0,
    current_price=82.03,
)
print("LONG:", res_long.stop_loss_price, res_long.take_profit_price)

res_short = risk_service.calculate_risk(
    symbol="SOL",
    direction="SHORT",
    win_prob=0.6,
    reward_risk_ratio=2.0,
    realized_vol_pct=0.01,
    current_equity=10000.0,
    current_price=82.03,
)
print("SHORT:", res_short.stop_loss_price, res_short.take_profit_price)
