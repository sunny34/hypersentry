from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from models import User, UserKey
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
