"""
User Settings Service - Central place to get user trading settings
"""
from typing import Optional
from models import User, UserTradingSettings, Wallet
from sqlalchemy.orm import Session

def get_user_trading_settings(db: Session, user_id: str) -> dict:
    """
    Get user's trading settings with defaults fallback.
    """
    settings = db.query(UserTradingSettings).filter(
        UserTradingSettings.user_id == user_id
    ).first()
    
    if settings:
        return {
            "equity_usd": settings.equity_usd,
            "max_position_usd": settings.max_position_usd,
            "max_risk_pct": settings.max_risk_pct,
            "max_leverage": settings.max_leverage,
            "target_profit_pct": settings.target_profit_pct,
            "stop_loss_pct": settings.stop_loss_pct,
            "max_daily_trades": settings.max_daily_trades,
            "max_daily_loss_pct": settings.max_daily_loss_pct,
        }
    
    # Return defaults
    return {
        "equity_usd": 100000.0,
        "max_position_usd": 1000.0,
        "max_risk_pct": 0.02,
        "max_leverage": 3.0,
        "target_profit_pct": 0.03,
        "stop_loss_pct": 0.01,
        "max_daily_trades": 5,
        "max_daily_loss_pct": 0.05,
    }


def get_user_balance(db: Session, user_id: str) -> float:
    """
    Get user's current balance from Hyperliquid.
    """
    from main import manager
    
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet:
        return 0.0
    
    try:
        hl_client = manager.hl_client
        if not hl_client:
            return 0.0
        
        user_state = hl_client.get_user_state(wallet.address)
        if not user_state:
            return 0.0
        
        margin_summary = user_state.get("marginSummary", {})
        return float(margin_summary.get("accountValue", 0))
    except Exception:
        return 0.0
