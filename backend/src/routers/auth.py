from datetime import datetime, timedelta, timezone
import os
import re
import secrets
from urllib.parse import urlparse

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from models import User, Wallet, WalletLoginNonce
from database import get_db
from auth import (
    get_current_user, require_user, create_access_token,
    exchange_google_code, get_or_create_user, get_google_auth_url,
    GOOGLE_CLIENT_ID, FRONTEND_URL
)
from schemas import UpdateProfileRequest, WalletChallengeRequest, WalletVerifyRequest
import colorlog
import logging

logger = colorlog.getLogger()

router = APIRouter(prefix="/auth", tags=["Auth"])
WALLET_NONCE_TTL_MINUTES = int(os.getenv("WALLET_NONCE_TTL_MINUTES", "10"))
WALLET_ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def _normalize_wallet_address(address: str) -> str:
    if not address or not WALLET_ADDRESS_RE.match(address):
        raise ValueError("Invalid wallet address format.")
    return address.lower()


def _iso_z(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _build_wallet_signin_message(
    address: str,
    nonce: str,
    chain_id: int,
    issued_at: datetime,
    expires_at: datetime,
) -> str:
    host = urlparse(FRONTEND_URL).netloc or "localhost"
    return (
        f"{host} wants you to sign in with your Ethereum account:\n"
        f"{address}\n\n"
        "Sign in to HyperliquidSentry.\n\n"
        f"URI: {FRONTEND_URL}\n"
        "Version: 1\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {_iso_z(issued_at)}\n"
        f"Expiration Time: {_iso_z(expires_at)}"
    )


def _get_or_create_wallet_user(db: Session, address_lower: str) -> User:
    wallet_user = db.query(User).filter(
        User.provider == "wallet",
        User.provider_id == address_lower
    ).first()
    pseudo_email = f"{address_lower}@wallet.local"
    short_addr = f"{address_lower[:6]}...{address_lower[-4:]}"

    if not wallet_user:
        wallet_user = db.query(User).filter(User.email == pseudo_email).first()

    if wallet_user:
        changed = False
        if wallet_user.provider != "wallet":
            wallet_user.provider = "wallet"
            changed = True
        if wallet_user.provider_id != address_lower:
            wallet_user.provider_id = address_lower
            changed = True
        if not wallet_user.name:
            wallet_user.name = f"Wallet {short_addr}"
            changed = True
        if changed:
            db.flush()
    else:
        wallet_user = User(
            email=pseudo_email,
            name=f"Wallet {short_addr}",
            avatar_url="",
            provider="wallet",
            provider_id=address_lower,
        )
        db.add(wallet_user)
        db.flush()

    existing_wallet = db.query(Wallet).filter(
        Wallet.user_id == wallet_user.id,
        Wallet.address == address_lower,
    ).first()
    if not existing_wallet:
        db.add(
            Wallet(
                user_id=wallet_user.id,
                address=address_lower,
                label="Primary Wallet",
                active_trading=False,
            )
        )
        db.flush()

    return wallet_user

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
    logger.info("OAuth callback received redirect_uri_param=%s", redirect_uri)
    logger.info("OAuth callback_uri=%s", callback_uri)
    
    try:
        google_user = await exchange_google_code(code, callback_uri)
    except Exception as e:
        logger.error("OAuth exchange failed: %s", e)
        raise
    
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


@router.post("/wallet/challenge")
async def wallet_challenge(
    req: WalletChallengeRequest,
    db: Session = Depends(get_db),
):
    """Create a one-time wallet challenge message for SIWE-style login."""
    try:
        address_lower = _normalize_wallet_address(req.address)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    chain_id = int(req.chain_id or 42161)
    if chain_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid chain_id")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=WALLET_NONCE_TTL_MINUTES)
    nonce = secrets.token_urlsafe(18)

    # Best-effort cleanup of expired rows.
    db.query(WalletLoginNonce).filter(WalletLoginNonce.expires_at < now).delete(synchronize_session=False)

    challenge = WalletLoginNonce(
        address=address_lower,
        nonce=nonce,
        chain_id=chain_id,
        issued_at=now,
        expires_at=expires_at,
        used=False,
    )
    db.add(challenge)
    db.commit()

    message = _build_wallet_signin_message(
        address=address_lower,
        nonce=nonce,
        chain_id=chain_id,
        issued_at=now,
        expires_at=expires_at,
    )

    return {
        "address": address_lower,
        "nonce": nonce,
        "chain_id": chain_id,
        "message": message,
        "issued_at": _iso_z(now),
        "expires_at": _iso_z(expires_at),
        "auth_type": "wallet",
    }


@router.post("/wallet/verify")
async def wallet_verify(
    req: WalletVerifyRequest,
    db: Session = Depends(get_db),
):
    """Verify signed challenge and mint JWT for wallet identity."""
    try:
        address_lower = _normalize_wallet_address(req.address)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    now = datetime.now(timezone.utc)
    challenge = db.query(WalletLoginNonce).filter(
        WalletLoginNonce.address == address_lower,
        WalletLoginNonce.nonce == req.nonce,
        WalletLoginNonce.used.is_(False),
    ).first()
    if not challenge:
        raise HTTPException(status_code=400, detail="Invalid or already-used challenge nonce.")

    challenge_expires_at = challenge.expires_at
    if challenge_expires_at.tzinfo is None:
        challenge_expires_at = challenge_expires_at.replace(tzinfo=timezone.utc)
    if challenge_expires_at < now:
        challenge.used = True
        challenge.used_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="Challenge nonce expired. Request a new challenge.")

    challenge_issued_at = challenge.issued_at
    if challenge_issued_at.tzinfo is None:
        challenge_issued_at = challenge_issued_at.replace(tzinfo=timezone.utc)

    expected_message = _build_wallet_signin_message(
        address=address_lower,
        nonce=challenge.nonce,
        chain_id=challenge.chain_id,
        issued_at=challenge_issued_at,
        expires_at=challenge_expires_at,
    )
    encoded = encode_defunct(text=expected_message)

    try:
        recovered = Account.recover_message(encoded, signature=req.signature)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature payload.")

    if not recovered or recovered.lower() != address_lower:
        raise HTTPException(status_code=401, detail="Signature does not match wallet address.")

    challenge.used = True
    challenge.used_at = now
    user = _get_or_create_wallet_user(db, address_lower)
    token = create_access_token(data={"sub": str(user.id)})
    db.commit()
    db.refresh(user)

    # Subscribe to real-time balance updates for this wallet
    try:
        from src.services.user_balance_service import user_balance_ws
        await user_balance_ws.subscribe_user(address_lower, str(user.id))
    except Exception as e:
        # Don't fail login if subscription fails
        pass

    return {
        "token": token,
        "user": user.to_dict(),
        "auth_type": "wallet",
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
async def logout(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Logout current user (client should discard token)"""
    # Unsubscribe from balance updates
    try:
        from src.services.user_balance_service import user_balance_ws
        wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
        if wallet:
            await user_balance_ws.unsubscribe_user(wallet.address)
    except Exception:
        pass
    
    # Clear alpha engine user context
    try:
        from src.alpha_engine.services.alpha_service import alpha_service
        alpha_service.clear_user_context()
    except Exception:
        pass
    
    return {"status": "logged_out", "message": "Token should be discarded by client"}


@router.post("/alpha-context")
async def set_alpha_context(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Set user context for alpha engine after login."""
    # Get user's wallet address
    wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
    if not wallet:
        return {"error": "No wallet connected"}
    
    # Load user's trading settings
    from models import UserTradingSettings
    settings = db.query(UserTradingSettings).filter(
        UserTradingSettings.user_id == user.id
    ).first()
    
    # Set alpha engine user context
    try:
        import logging
        logger = logging.getLogger(__name__)
        
        from src.alpha_engine.services.alpha_service import alpha_service
        from src.alpha_engine.risk.risk_service import risk_service
        
        import sys
        print(f"=== ALPHA CONTEXT CALLED: user={user.id}, wallet={wallet.address[:10]} ===", flush=True)
        logger.info(f"=== ALPHA CONTEXT: user.id={user.id}, wallet={wallet.address[:10]}... ===")
        alpha_service.set_user_context(str(user.id), wallet.address)
        print(f"=== AFTER SET: _active_user_id={alpha_service._active_user_id} ===", flush=True)
        logger.info(f"Alpha service user context set. _active_user_id={alpha_service._active_user_id}")
        
        # Also load user settings into risk service
        if settings:
            logger.info(f"Loading user trading settings: equity={settings.equity_usd}, max_pos={settings.max_position_usd}, max_risk={settings.max_risk_pct}, auto_mode={settings.auto_mode_enabled}")
            risk_service.load_user_settings(str(user.id), db)
            logger.info(f"Risk service settings loaded: {risk_service._user_settings}")
        else:
            logger.warning(f"No trading settings found for user {user.id}")
        
        return {
            "status": "ok",
            "user_id": str(user.id),
            "wallet": wallet.address[:10] + "...",
            "settings_loaded": settings is not None
        }
    except Exception as e:
        return {"error": str(e)}
