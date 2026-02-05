from fastapi import APIRouter, Depends, Query, Request
from auth import require_user
from models import User

router = APIRouter(prefix="/bridges", tags=["Bridges"])

@router.get("/recent")
async def get_recent_bridges(
    request: Request,
    limit: int = Query(20, description="Number of bridges to return")
):
    """Get recent large bridge deposits."""
    bridge_monitor = request.app.state.bridge_monitor
    bridges = bridge_monitor.get_recent_bridges(limit)
    return {"bridges": bridges, "count": len(bridges)}


@router.get("/stats")
async def get_bridge_stats(request: Request):
    """Get bridge monitor stats."""
    bridge_monitor = request.app.state.bridge_monitor
    stats = bridge_monitor.get_stats()
    return stats


@router.post("/config")
async def update_bridge_config(
    request: Request,
    threshold: float = Query(..., description="Minimum bridge amount in USD"),
    user: User = Depends(require_user)
):
    """Update bridge alert threshold."""
    bridge_monitor = request.app.state.bridge_monitor
    bridge_monitor.set_threshold(threshold)
    return {"status": "updated", "threshold": threshold}
