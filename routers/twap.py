from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from models import User, UserTwap
from database import get_db
from auth import require_user
from schemas import TwapRequest, TwapConfigRequest
from src.manager import TraderManager

router = APIRouter(prefix="/twap", tags=["TWAP"])
manager = TraderManager()

@router.get("")
async def get_twaps(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Get current user's TWAP watchlist."""
    user_twaps = db.query(UserTwap).filter(UserTwap.user_id == user.id).all()
    return {"tokens": [t.token for t in user_twaps]}


@router.get("/active")
async def get_active_twaps(
    user: User = Depends(require_user), 
    db: Session = Depends(get_db),
    show_all: bool = False
):
    """Returns active TWAPs for UI display.
    
    By default, filters to show only user's watched tokens.
    Set show_all=true to see all global TWAPs.
    """
    
    # Get user's watched tokens
    user_twaps = db.query(UserTwap).filter(UserTwap.user_id == user.id).all()
    watched_tokens = {t.token.upper() for t in user_twaps}
    
    # Get min_size preference
    user_twap_pref = user_twaps[0] if user_twaps else None
    min_size = user_twap_pref.min_size if user_twap_pref else 10000

    all_twaps = []
    for token, twaps in manager.twap_detector.active_twaps.items():
        # Filter by watched tokens unless show_all is True
        if not show_all:
            # Match base token (handle @HYPE, HYPE/USDC etc)
            base_token = token.replace("@", "").split("/")[0].upper()
            if not any(base_token == w.upper() or token.upper() == w.upper() for w in watched_tokens):
                continue

        for t in twaps:
            twap_data = t.get('action', {}).get('twap', {})
            size = t.get('size_usd', float(twap_data.get('s', 0)))
            
            all_twaps.append({
                "token": token,
                "size": size,
                "side": "BUY" if twap_data.get('b', True) else "SELL",
                "user": t.get('user', ''),
                "minutes": twap_data.get('m', 0),
                "hash": t.get('hash', ''),
                "time": t.get('time', 0),
                "is_perp": twap_data.get('t', False),  # True = Perp, False = Spot
                "reduce_only": twap_data.get('r', False)
            })
    
    return {"twaps": all_twaps, "min_size": min_size, "watched_tokens": list(watched_tokens)}


@router.post("/add")
async def add_twap(
    req: TwapRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Add tokens to user's TWAP watchlist."""
    tokens = req.token.split(',')
    added = []
    
    for t in tokens:
        clean_t = t.strip().upper()
        if not clean_t:
            continue
            
        # Check if already exists
        existing = db.query(UserTwap).filter(
            UserTwap.user_id == user.id,
            UserTwap.token == clean_t
        ).first()
        
        if not existing:
            user_twap = UserTwap(user_id=user.id, token=clean_t)
            db.add(user_twap)
            added.append(clean_t)
            
            # Also add to detector
            manager.twap_detector.add_token(clean_t)
    
    db.commit()
    return {"status": "added", "tokens": added}


@router.post("/config")
async def update_twap_config(
    req: TwapConfigRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Update TWAP min size for user."""
    db.query(UserTwap).filter(UserTwap.user_id == user.id).update({"min_size": req.min_size})
    db.commit()
    return {"status": "updated", "min_size": req.min_size}


@router.delete("/{token}")
async def remove_twap(
    token: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Remove token from user's TWAP watchlist."""
    deleted = db.query(UserTwap).filter(
        UserTwap.user_id == user.id,
        UserTwap.token == token.upper()
    ).delete()
    db.commit()
    
    if deleted:
        return {"status": "removed", "token": token.upper()}
    return {"status": "not_found", "token": token.upper()}


@router.get("/history/{token}")
async def get_twap_history(
    token: str,
    time_range: str = Query("1h", description="Time range: 1h, 4h, 24h, or all"),
    user: User = Depends(require_user)
):
    """Get TWAP history data for charting."""
    history = manager.twap_detector.get_history(token, time_range)
    return {
        "token": token.upper(),
        "time_range": time_range,
        "data": history,
        "count": len(history)
    }


@router.get("/users/{token}")
async def get_twap_users(
    token: str,
    user: User = Depends(require_user)
):
    """Get active TWAP users (who is doing the TWAP)."""
    users = manager.twap_detector.get_active_users(token)
    return {
        "token": token.upper(),
        "buyers": users["buyers"],
        "sellers": users["sellers"],
        "total_buyers": len(users["buyers"]),
        "total_sellers": len(users["sellers"])
    }


@router.get("/summary")
async def get_twap_summary(user: User = Depends(require_user)):
    """Get summary of all watched tokens with latest TWAP data."""
    summaries = manager.twap_detector.get_all_tokens_summary()
    return {"tokens": summaries}
