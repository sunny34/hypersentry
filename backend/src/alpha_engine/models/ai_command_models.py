from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AIBriefLevels(BaseModel):
    entry: Optional[float] = None
    invalidation: Optional[float] = None
    take_profit: Optional[float] = None


class AIBriefResponse(BaseModel):
    symbol: str
    source: Literal["gemini", "heuristic"]
    action: Literal["LONG", "SHORT", "NEUTRAL"]
    confidence: int = Field(ge=0, le=100)
    thesis: str
    counter_thesis: str
    catalysts: List[str] = Field(default_factory=list)
    risk_flags: List[str] = Field(default_factory=list)
    checklist: List[str] = Field(default_factory=list)
    levels: AIBriefLevels = Field(default_factory=AIBriefLevels)
    generated_at: str
