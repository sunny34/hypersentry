import asyncio
from src.alpha_engine.models.footprint_models import FootprintResult, SweepEvent, AbsorptionEvent, FlowImbalanceResult, ImpulseEvent
import time

fn = FootprintResult(
    symbol="BTC",
    sweep=SweepEvent(),
    absorption=AbsorptionEvent(),
    imbalance=FlowImbalanceResult(imbalance_ratio=1.0, z_score=0.5, dominance="NEUTRAL"),
    impulse=ImpulseEvent(),
    timestamp=int(time.time()*1000)
)
try:
    print("Trying .dict()")
    print(fn.sweep.dict())
except Exception as e:
    print("Error with .dict():", e)

try:
    print("Trying .model_dump()")
    print(fn.sweep.model_dump())
except Exception as e:
    print("Error with .model_dump():", e)
