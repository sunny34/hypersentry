"""
Authentication module for HyperliquidSentry
Handles OAuth with Google and JWT token management
"""

from datetime import datetime, timedelta
from typing import Optional
import os
import logging
import httpx
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import User

logger = logging.getLogger(__name__)

# Security scheme
security = HTTPBearer(auto_error=False)

# JWT Configuration
_jwt_secret = os.getenv("JWT_SECRET_KEY")
if not _jwt_secret or _jwt_secret.startswith("change-this") or _jwt_secret.startswith("your-secret"):
    if os.getenv("ENVIRONMENT") == "production":
        raise RuntimeError("FATAL: JWT_SECRET_KEY must be set in production. Generate with: openssl rand -hex 32")
    _jwt_secret = "dev-only-insecure-key-do-not-use-in-production"

JWT_SECRET_KEY = _jwt_secret
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("SESSION_EXPIRE_HOURS", "168"))  # 7 days default

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")

# Frontend URL for redirects
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


def _csv_env_set(name: str) -> set[str]:
    raw = os.getenv(name, "")
    return {v.strip().lower() for v in raw.split(",") if v.strip()}


ADMIN_EMAILS = _csv_env_set("ADMIN_EMAILS")
PRO_EMAILS = _csv_env_set("PRO_EMAILS")
ADMIN_ADDRESSES = _csv_env_set("ADMIN_ADDRESSES")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=JWT_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as e:
        logger.warning(f"Token verification failed: {e}")
        return None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """
    FastAPI dependency to get the current authenticated user.
    Returns None if not authenticated (for public endpoints that behave differently when logged in)
    """
    if not credentials:
        return None
    
    token = credentials.credentials
    payload = verify_token(token)
    
    if not payload:
        return None
    
    user_id = payload.get("sub")
    if not user_id:
        return None
        
    try:
        # Cast string to UUID object for SQLAlchemy
        import uuid
        user_uuid = uuid.UUID(user_id)
        user = db.query(User).filter(User.id == user_uuid).first()
        
        if user:
            # Institutional Admin & Pro Bypass (Update status in-memory and DB)
            if not (ADMIN_EMAILS or PRO_EMAILS or ADMIN_ADDRESSES):
                logger.debug("No admin/pro override envs configured (ADMIN_EMAILS/PRO_EMAILS/ADMIN_ADDRESSES)")
            needs_update = False
            
            # 1. Check Admin Status
            is_admin_candidate = False
            if user.email and user.email.lower() in ADMIN_EMAILS:
                is_admin_candidate = True
            elif ADMIN_ADDRESSES:
                from models import Wallet
                wallet_exists = db.query(Wallet).filter(
                    Wallet.user_id == user.id,
                    func.lower(Wallet.address).in_(list(ADMIN_ADDRESSES))
                ).first()
                if wallet_exists:
                    is_admin_candidate = True
            
            if is_admin_candidate and not user.is_admin:
                user.is_admin = True
                needs_update = True
                logger.info(f"🛡️ User {user.email} promoted to ADMIN status.")

            # 2. Check Pro Status (Admins are always PRO)
            is_pro_candidate = is_admin_candidate or (bool(user.email) and user.email.lower() in PRO_EMAILS)
            
            if is_pro_candidate and user.role != "pro":
                user.role = "pro"
                needs_update = True
                logger.info(f"💎 User {user.email} promoted to PRO status.")

            if needs_update:
                db.commit()
                db.refresh(user)
                
        return user
    except (ValueError, TypeError):
        logger.warning(f"Invalid UUID in token: {user_id}")
        return None
    except Exception as e:
        logger.error("Failed to resolve authenticated user: %s", e)
        return None


async def require_user(
    user: Optional[User] = Depends(get_current_user)
) -> User:
    """
    FastAPI dependency that REQUIRES authentication.
    Raises 401 if not authenticated.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_pro_user(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
) -> User:
    """
    FastAPI dependency that REQUIRES 'pro' role.
    Raises 403 if authenticated but not pro.
    Bypasses for admins.
    """
    # 1. Admin Bypass (populated by get_current_user)
    if user.is_admin:
        return user
    
    if user.role != "pro":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PRO Subscription Required for this Access Level."
        )
    return user

def reset_user_credits_if_needed(user: Optional[User], db: Session):
    """Resets daily credits if 24h have passed since last reset."""
    if not user:
        return
    now = datetime.now(user.last_credit_reset.tzinfo)
    if now > user.last_credit_reset + timedelta(days=1):
        user.trial_credits = 5
        user.last_credit_reset = now
        db.commit()


async def exchange_google_code(code: str, redirect_uri: str) -> dict:
    """Exchange Google authorization code for tokens and user info"""
    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            }
        )
        
        if token_response.status_code != 200:
            logger.error(f"Google token exchange failed: {token_response.text}")
            raise HTTPException(status_code=400, detail="Failed to exchange authorization code")
        
        tokens = token_response.json()
        access_token = tokens.get("access_token")
        
        # Get user info
        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
        if userinfo_response.status_code != 200:
            logger.error(f"Google userinfo failed: {userinfo_response.text}")
            raise HTTPException(status_code=400, detail="Failed to get user info")
        
        return userinfo_response.json()


def get_or_create_user(db: Session, email: str, name: str, avatar_url: str, provider: str, provider_id: str) -> User:
    """Get existing user or create new one"""
    # First try to find by provider + provider_id
    user = db.query(User).filter(
        User.provider == provider,
        User.provider_id == provider_id
    ).first()
    
    if user:
        # Update user info in case it changed
        user.name = name
        user.avatar_url = avatar_url
        user.email = email
        db.commit()
        return user
    
    # Try to find by email (user might have logged in with different provider before)
    user = db.query(User).filter(User.email == email).first()
    
    if user:
        # Update to current provider
        user.provider = provider
        user.provider_id = provider_id
        user.name = name
        user.avatar_url = avatar_url
        db.commit()
        return user
    
    # Create new user
    user = User(
        email=email,
        name=name,
        avatar_url=avatar_url,
        provider=provider,
        provider_id=provider_id
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    logger.info(f"✨ New user created: {email}")
    return user


def get_google_auth_url(redirect_uri: str) -> str:
    """Generate Google OAuth authorization URL"""
    from urllib.parse import urlencode
    
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent"
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
