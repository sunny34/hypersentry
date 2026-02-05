from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from models import User
from database import get_db
from auth import (
    get_current_user, require_user, create_access_token,
    exchange_google_code, get_or_create_user, get_google_auth_url,
    GOOGLE_CLIENT_ID, FRONTEND_URL
)
from schemas import UpdateProfileRequest
import colorlog
import logging

logger = colorlog.getLogger()

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.get("/google")
async def google_login(redirect_uri: str = Query(None)):
    """Initiate Google OAuth login flow"""
    if not GOOGLE_CLIENT_ID:
        return {"error": "Google OAuth not configured"}
    
    # Use provided redirect_uri or default
    callback_uri = redirect_uri or f"{FRONTEND_URL}/auth/callback"
    
    # Store callback in session (we'll pass it through OAuth state)
    auth_url = get_google_auth_url(callback_uri)
    return {"auth_url": auth_url}


@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    redirect_uri: str = Query(None),
    db: Session = Depends(get_db)
):
    """Handle Google OAuth callback"""
    callback_uri = redirect_uri or f"{FRONTEND_URL}/auth/callback"
    
    # Exchange code for user info
    logger.info(f"DEBUG AUTH: code={code[:10]}... redirect_uri_param={redirect_uri}")
    logger.info(f"DEBUG AUTH: FINAL callback_uri={callback_uri}")
    
    try:
        google_user = await exchange_google_code(code, callback_uri)
    except Exception as e:
        logger.error(f"DEBUG AUTH: Exchange failed. Error: {e}")
        raise e
    
    # Get or create user in database
    user = get_or_create_user(
        db=db,
        email=google_user["email"],
        name=google_user.get("name", ""),
        avatar_url=google_user.get("picture", ""),
        provider="google",
        provider_id=google_user["id"]
    )
    
    # Create JWT token
    token = create_access_token(data={"sub": str(user.id)})
    
    return {
        "token": token,
        "user": user.to_dict()
    }


@router.get("/me")
async def get_me(user: User = Depends(require_user)):
    """Get current authenticated user info"""
    return user.to_dict()


@router.post("/profile/update")
async def update_profile(
    req: UpdateProfileRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Update user profile settings"""
    user.telegram_chat_id = req.telegram_chat_id
    db.commit()
    db.refresh(user)
    return {"status": "updated", "user": user.to_dict()}


@router.post("/logout")
async def logout(user: User = Depends(require_user)):
    """Logout current user (client should discard token)"""
    return {"status": "logged_out", "message": "Token should be discarded by client"}
