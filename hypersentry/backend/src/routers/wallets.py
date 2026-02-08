from fastapi import APIRouter, Depends, BackgroundTasks, UploadFile
from sqlalchemy.orm import Session
from models import User, Wallet
from database import get_db
from auth import require_user
from schemas import AddWalletRequest
from src.manager import TraderManager

router = APIRouter(prefix="/wallets", tags=["Wallets"])

@router.get("")
def list_wallets(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """List current user's wallets (Admins see all)."""
    if user.is_admin:
        wallets = db.query(Wallet).all()
    else:
        wallets = db.query(Wallet).filter(Wallet.user_id == user.id).all()
    return {"wallets": [w.to_dict() for w in wallets]}


@router.post("/add")
async def add_wallet(
    req: AddWalletRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Add a wallet for the current user."""
    # Check if wallet already exists for this user
    existing = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.address == req.address
    ).first()
    
    if existing:
        return {"status": "exists", "address": req.address, "message": "Wallet already added"}
    
    # Create wallet in database
    wallet = Wallet(
        user_id=user.id,
        address=req.address,
        label=req.label,
        active_trading=req.active_trading
    )
    db.add(wallet)
    db.commit()
    
    # Start copy trader in background
    manager = TraderManager()
    background_tasks.add_task(manager.start_copy_trader, req.address, req.active_trading, req.label)
    
    return {
        "status": "added",
        "address": req.address,
        "label": req.label,
        "mode": "trading" if req.active_trading else "observer"
    }


@router.delete("/{address}")
async def remove_wallet(
    address: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Remove a wallet for the current user."""
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.address == address
    ).first()
    
    if not wallet:
        return {"status": "not_found", "address": address}
    
    db.delete(wallet)
    db.commit()
    
    # Stop copy trader
    manager = TraderManager()
    await manager.stop_copy_trader(address)
    
    return {"status": "removed", "address": address}


@router.post("/upload_csv")
async def upload_csv(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: Session = Depends(get_db)
):
    """Upload a CSV file of addresses (one per line)."""
    content = await file.read()
    text = content.decode('utf-8')
    lines = text.split('\n')
    
    added_count = 0
    manager = TraderManager()

    for line in lines:
        parts = line.strip().split(',')
        addr = parts[0].strip()
        label = parts[1].strip() if len(parts) > 1 else None
        
        if addr.startswith("0x") and len(addr) > 10:
            # Check if exists
            existing = db.query(Wallet).filter(
                Wallet.user_id == user.id,
                Wallet.address == addr
            ).first()
            
            if not existing:
                wallet = Wallet(user_id=user.id, address=addr, label=label)
                db.add(wallet)
                added_count += 1
                
                # Start copy trader
                background_tasks.add_task(manager.start_copy_trader, addr, False, label)
    
    db.commit()
    return {"status": "imported", "count": added_count, "user_id": str(user.id)}
