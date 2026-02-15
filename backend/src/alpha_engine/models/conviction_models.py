from pydantic import BaseModel
from typing import Dict, List, Literal, Optional

class ConvictionComponent(BaseModel):
    """
    Representation of an individual signal component's contribution.
    """
    score: float # Normalized [-1, 1]
    weight: float
    description: str

class ConvictionResult(BaseModel):
    """
    The final output of the Alpha Engine.
    Synthesizes multiple microstructure indicators into a single actionable bias.
    """
    symbol: str
    bias: Literal["LONG", "SHORT", "NEUTRAL"]
    score: int # 0 to 100
    confidence: float # 0 to 1
    components: Dict[str, ConvictionComponent]
    explanation: List[str]
    timestamp: int
