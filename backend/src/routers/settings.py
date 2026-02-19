from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from models import User, UserKey, UserTradingSettings
from database import get_db
from auth import require_user
from schemas import KeyInput
from src.security import encrypt_secret, decrypt_secret
import logging
import colorlog
import json

logger = colorlog.getLogger()

router = APIRouter(prefix="/settings", tags=["Settings"])

@router.post("/keys")
async def add_api_key(
    data: KeyInput,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Encrypted storage of API keys."""
    # Check limit? (e.g. max 1 per exchange per user for MVP)
    # Validate keys before saving
    if data.exchange == "hyperliquid":
        # Check if valid private key (hex, 64 chars ignoring 0x)
        import binascii
        clean_key = data.api_secret.replace("0x", "")
        # Standard private key is 32 bytes = 64 hex chars
        # But we also want to catch complete garbage early
        if len(clean_key) != 64:
             # Just strict length check for prod
             return Response(content=json.dumps({"error": "Invalid Private Key. Must be 32-byte hex string (64 chars)."}), status_code=400, media_type="application/json")
        try:
            binascii.unhexlify(clean_key)
        except binascii.Error:
            return Response(content=json.dumps({"error": "Invalid Private Key: Non-hex characters found."}), status_code=400, media_type="application/json")
            
    existing = db.query(UserKey).filter(
        UserKey.user_id == user.id,
        UserKey.exchange == data.exchange
    ).first()
    
    if existing:
        # Overwrite
        existing.api_key_enc = encrypt_secret(data.api_key)
        existing.api_secret_enc = encrypt_secret(data.api_secret)
        existing.key_name = data.label or existing.key_name
        db.commit()
        return {"status": "updated", "exchange": data.exchange}
    
    new_key = UserKey(
        user_id=user.id,
        exchange=data.exchange,
        key_name=data.label,
        api_key_enc=encrypt_secret(data.api_key),
        api_secret_enc=encrypt_secret(data.api_secret)
    )
    db.add(new_key)
    db.commit()
    return {"status": "created", "exchange": data.exchange}

@router.get("/keys")
async def get_api_keys(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """List stored keys (masked)."""
    logger.info(f"DEBUG: Fetching keys for user {user.id}")
    keys = db.query(UserKey).filter(UserKey.user_id == user.id).all()
    result = []
    for k in keys:
        # Decrypt first to get length/suffix, but NEVER return full secret
        real_key = decrypt_secret(k.api_key_enc)
        mask_key = f"****{real_key[-4:]}" if len(real_key) > 4 else "****"
        
        result.append({
            "id": str(k.id),
            "exchange": k.exchange,
            "label": k.key_name,
            "api_key_masked": mask_key,
            "created_at": k.created_at
        })
    return {"keys": result}

@router.delete("/keys/{key_id}")
async def delete_api_key(
    key_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    key = db.query(UserKey).filter(UserKey.id == key_id, UserKey.user_id == user.id).first()
    if not key:
        return Response(status_code=404)
    db.delete(key)
    db.commit()
    return {"status": "deleted"}


# Trading Settings Models
from pydantic import BaseModel
from typing import Optional

class TradingSettingsInput(BaseModel):
    equity_usd: Optional[float] = None
    max_position_usd: Optional[float] = None
    max_risk_pct: Optional[float] = None
    max_leverage: Optional[float] = None
    target_profit_pct: Optional[float] = None
    stop_loss_pct: Optional[float] = None
    auto_mode_enabled: Optional[bool] = None
    max_daily_trades: Optional[int] = None
    max_daily_loss_pct: Optional[float] = None


@router.get("/trading")
async def get_trading_settings(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Get user's trading settings"""
    settings = db.query(UserTradingSettings).filter(
        UserTradingSettings.user_id == user.id
    ).first()
    
    if not settings:
        # Return defaults
        return UserTradingSettings(
            user_id=user.id,
            equity_usd=100000.0,
            max_position_usd=1000.0,
            max_risk_pct=0.02,
            max_leverage=3.0,
            target_profit_pct=0.03,
            stop_loss_pct=0.01,
            auto_mode_enabled=False,
            max_daily_trades=5,
            max_daily_loss_pct=0.05,
        ).to_dict()
    
    return settings.to_dict()


@router.post("/trading")
async def update_trading_settings(
    data: TradingSettingsInput,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Update user's trading settings"""
    settings = db.query(UserTradingSettings).filter(
        UserTradingSettings.user_id == user.id
    ).first()
    
    if not settings:
        settings = UserTradingSettings(user_id=user.id)
        db.add(settings)
    
    # Update only provided fields
    if data.equity_usd is not None:
        settings.equity_usd = data.equity_usd
    if data.max_position_usd is not None:
        settings.max_position_usd = data.max_position_usd
    if data.max_risk_pct is not None:
        settings.max_risk_pct = data.max_risk_pct
    if data.max_leverage is not None:
        settings.max_leverage = data.max_leverage
    if data.target_profit_pct is not None:
        settings.target_profit_pct = data.target_profit_pct
    if data.stop_loss_pct is not None:
        settings.stop_loss_pct = data.stop_loss_pct
    if data.auto_mode_enabled is not None:
        settings.auto_mode_enabled = data.auto_mode_enabled
    if data.max_daily_trades is not None:
        settings.max_daily_trades = data.max_daily_trades
    if data.max_daily_loss_pct is not None:
        settings.max_daily_loss_pct = data.max_daily_loss_pct
    
    db.commit()
    db.refresh(settings)
    return settings.to_dict()


@router.post("/trading/enable-autonomous")
async def enable_autonomous_mode(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Enable autonomous trading mode"""
    settings = db.query(UserTradingSettings).filter(
        UserTradingSettings.user_id == user.id
    ).first()
    
    if not settings:
        return {"error": "Please configure trading settings first"}
    
    if not settings.auto_mode_enabled:
        settings.auto_mode_enabled = True
        db.commit()
    
    return {"status": "enabled", "settings": settings.to_dict()}


@router.post("/trading/disable-autonomous")
async def disable_autonomous_mode(
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Disable autonomous trading mode"""
    settings = db.query(UserTradingSettings).filter(
        UserTradingSettings.user_id == user.id
    ).first()
    
    if settings and settings.auto_mode_enabled:
        settings.auto_mode_enabled = False
        db.commit()
    
    return {"status": "disabled"}
