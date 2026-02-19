from datetime import datetime
import logging
import os
from typing import Dict, Literal, Optional
from src.alpha_engine.risk.edge_calculator import EdgeCalculator

logger = logging.getLogger(__name__)
from src.alpha_engine.risk.kelly_sizer import KellySizer
from src.alpha_engine.risk.volatility_adjuster import VolatilityAdjuster
from src.alpha_engine.risk.regime_risk_scaler import RegimeRiskScaler
from src.alpha_engine.risk.drawdown_manager import DrawdownManager
from src.alpha_engine.risk.correlation_manager import CorrelationManager
from src.alpha_engine.risk.portfolio_allocator import PortfolioAllocator
from src.alpha_engine.models.risk_models import RiskAssessment, RiskBreakdown


class RiskService:
    """
    Capital Allocation & Sizing Engine for Alpha Engine Phase 9.
    Provides deterministic risk management and dynamic position sizing.
    Supports both global defaults and per-user settings.
    """

    def __init__(self):
        self.equity_manager = DrawdownManager(high_water_mark=100_000.0)
        self.portfolio_manager = PortfolioAllocator()
        self.regime_scaler = RegimeRiskScaler()
        self.corr_manager = CorrelationManager()
        self.vol_adj = VolatilityAdjuster()
        self.kelly_sizer = KellySizer()
        self.edge_calc = EdgeCalculator()

        # Global defaults
        self.fallback_equity = max(1000.0, float(os.getenv("RISK_EQUITY_FALLBACK", "100000")))
        self.max_leverage = max(1.0, float(os.getenv("RISK_MAX_LEVERAGE", "3.0")))
        self.max_risk_pct = min(0.25, max(0.001, float(os.getenv("RISK_MAX_RISK_PCT", "0.02"))))
        self.max_position_usd = max(100.0, float(os.getenv("RISK_MAX_POSITION_USD", "1000")))
        self.min_stop_dist_pct = min(0.20, max(0.0025, float(os.getenv("RISK_MIN_STOP_DIST_PCT", "0.005"))))
        self.current_regime = os.getenv("RISK_DEFAULT_REGIME", "NORMAL_MARKET")
        self.active_positions: Dict[str, float] = {}
        
        # Per-user settings cache
        self._user_settings: Dict[str, dict] = {}

    def load_user_settings(self, user_id: str, db_session) -> bool:
        """
        Load trading settings from database for a specific user.
        Returns True if settings found, False if using defaults.
        """
        if db_session is None:
            logger.warning("load_user_settings called with None db_session for user_id=%s", user_id)
            return False
        
        try:
            from models import UserTradingSettings, Wallet
            from sqlalchemy.orm import Session
            
            # Get user settings
            settings = db_session.query(UserTradingSettings).filter(
                UserTradingSettings.user_id == user_id
            ).first()
            
            if settings:
                self._user_settings[user_id] = {
                    "equity_usd": settings.equity_usd,
                    "max_position_usd": settings.max_position_usd,
                    "max_risk_pct": settings.max_risk_pct,
                    "max_leverage": settings.max_leverage,
                    "target_profit_pct": settings.target_profit_pct,
                    "stop_loss_pct": settings.stop_loss_pct,
                    "max_daily_trades": settings.max_daily_trades,
                    "max_daily_loss_pct": settings.max_daily_loss_pct,
                    "auto_mode_enabled": settings.auto_mode_enabled,
                }
                logger.info(f"Loaded user settings for {user_id}: auto_mode={settings.auto_mode_enabled}")
                return True
            
            return False
        except Exception as e:
            logger.warning(f"Could not load user settings: {e}")
            return False

    def get_user_settings(self, user_id: str) -> Optional[dict]:
        """Get cached user settings."""
        return self._user_settings.get(user_id)

    def clear_user_settings(self, user_id: str):
        """Clear cached user settings."""
        self._user_settings.pop(user_id, None)

    def sync_portfolio_state(
        self,
        *,
        current_equity: Optional[float] = None,
        current_regime: Optional[str] = None,
        active_positions: Optional[Dict[str, float]] = None,
        user_id: Optional[str] = None,
    ):
        if current_regime:
            self.current_regime = str(current_regime)
        if active_positions is not None:
            self.active_positions = {k.upper(): float(v) for k, v in active_positions.items()}
        
        # If user_id provided, sync equity from user settings
        if user_id and user_id in self._user_settings:
            user_settings = self._user_settings[user_id]
            if current_equity is not None and current_equity > 0:
                user_settings["equity_usd"] = current_equity

    def calculate_risk(self, 
        symbol: str, 
        direction: Literal["LONG", "SHORT"],
        win_prob: float,
        reward_risk_ratio: float, 
        realized_vol_pct: float,
        current_equity: Optional[float],
        current_regime: Optional[str] = None,
        current_price: Optional[float] = None,
        active_correlations: float = 0.0,
        user_id: Optional[str] = None,
    ) -> RiskAssessment:
        # Get user settings if available, otherwise use globals
        if user_id and user_id in self._user_settings:
            user_settings = self._user_settings[user_id]
            equity = current_equity if current_equity and current_equity > 0 else user_settings.get("equity_usd", self.fallback_equity)
            max_leverage = user_settings.get("max_leverage", self.max_leverage)
            max_risk_pct = user_settings.get("max_risk_pct", self.max_risk_pct)
            max_position_usd = user_settings.get("max_position_usd", self.max_position_usd)
        else:
            equity = float(current_equity) if current_equity and current_equity > 0 else self.fallback_equity
            max_leverage = self.max_leverage
            max_risk_pct = self.max_risk_pct
            max_position_usd = self.max_position_usd
        
        regime = current_regime or self.current_regime

        # 1. Edge & Kelly
        edge = self.edge_calc.compute(win_prob, avg_win_pct=reward_risk_ratio*0.01)
        raw_kelly_f = self.kelly_sizer.compute(win_prob, reward_risk_ratio)
        kelly_f = min(max_risk_pct, max(0.0, raw_kelly_f))
        
        # 2. Adjustments
        vol_scalar = self.vol_adj.compute(realized_vol_pct)
        regime_scalar = self.regime_scaler.get_multiplier(regime)
        dd_scalar = self.equity_manager.get_risk_multiplier(equity, threshold_pct=0.05)
        corr_penalty = self.corr_manager.get_penalty(active_correlations)
        
        # 3. Final Portfolio Allocation
        risk_amount_usd = equity * kelly_f
        
        # Apply scalars to the RISK AMOUNT
        adjusted_risk_usd = risk_amount_usd * vol_scalar * regime_scalar * dd_scalar * corr_penalty
        
        # Convert Risk Amount to Position Size based on Volatility (Stop Distance)
        stop_dist_pct = max(self.min_stop_dist_pct, min(0.20, 2 * realized_vol_pct))
        position_size_usd = adjusted_risk_usd / stop_dist_pct
        
        # Constraint Check
        max_pos_by_leverage = equity * max_leverage
        position_size_usd = min(position_size_usd, max_pos_by_leverage, max_position_usd)
        
        # Re-calculate risk % of equity
        final_risk_pct = (adjusted_risk_usd / equity) if equity > 0 else 0.0

        stop_loss_price = 0.0
        take_profit_price = 0.0
        if current_price is not None and current_price > 0:
            stop_distance = current_price * stop_dist_pct
            target_distance = stop_distance * max(reward_risk_ratio, 1.0)
            if direction == "SHORT":
                stop_loss_price = current_price + stop_distance
                take_profit_price = max(0.0, current_price - target_distance)
            else:  # LONG
                stop_loss_price = max(0.0, current_price - stop_distance)
                take_profit_price = current_price + target_distance
        
        breakdown = RiskBreakdown(
            edge_component=edge,
            kelly_fraction=kelly_f,
            vol_adjustment=vol_scalar,
            regime_multiplier=regime_scalar,
            drawdown_multiplier=dd_scalar,
            correlation_penalty=corr_penalty
        )
        
        return RiskAssessment(
            symbol=symbol,
            direction=direction,
            size_usd=round(position_size_usd, 2),
            max_leverage=max_leverage,
            risk_percent_equity=round(final_risk_pct, 4),
            stop_loss_price=round(stop_loss_price, 6),
            take_profit_price=round(take_profit_price, 6),
            breakdown=breakdown,
            timestamp=int(datetime.now().timestamp())
        )


# Global Service Instance
risk_service = RiskService()
