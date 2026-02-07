from fastapi import APIRouter, Request
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/intel", tags=["Intelligence"])

@router.get("/latest")
async def get_latest_intel(request: Request, limit: int = 20):
    """
    Get the latest aggregated intelligence from all providers.
    Uses the global IntelEngine instance.
    """
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return []
    
    # Get items from engine's providers or its internal cache
    # For simplicity, we'll return what's in the cache if it's been populated
    # The engine already broadcasts via WS, but REST polling is a good fallback
    
    try:
        # Sort cache items by timestamp if possible
        # Cache is a set of IDs, but we can have the engine store the objects too
        # Let's modify IntelEngine to store objects
        if hasattr(intel_engine, "recent_items"):
            return intel_engine.recent_items[:limit]
        
        # Fallback: trigger a quick fetch from all providers
        tasks = [p.fetch_latest() for p in intel_engine.providers]
        import asyncio
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        all_items = []
        for res in results:
            if isinstance(res, list):
                all_items.extend(res)
        
        all_items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return all_items[:limit]
        
    except Exception as e:
        logger.error(f"Failed to fetch intel: {e}")
        return []

@router.get("/sources")
async def get_intel_sources(request: Request):
    """List available intelligence sources."""
    intel_engine = getattr(request.app.state, "intel_engine", None)
    if not intel_engine:
        return []
    
    return [p.name for p in intel_engine.providers]

@router.get("/debate/{symbol}")
async def get_agent_debate(symbol: str):
    """
    Trigger a live multi-agent debate for a specific asset.
    Inspired by the TauricResearch/TradingAgents multi-agent setup.
    """
    from src.agents.debate import MultiAgentDebate
    
    engine = MultiAgentDebate()
    # Mock context for now - in production we'd pass recent prices/news
    context = f"Asset {symbol} is experiencing high volatility near local resistance."
    
    try:
        messages = await engine.run_debate(symbol, context)
        return {"symbol": symbol, "messages": messages}
    except Exception as e:
        logger.error(f"Debate failed: {e}")
        return {"error": str(e)}
