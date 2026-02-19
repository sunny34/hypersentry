from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Float, Text, Integer, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

Base = declarative_base()


class User(Base):
    """User model for OAuth authentication"""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255))
    avatar_url = Column(Text)
    telegram_chat_id = Column(String(255), nullable=True)  # User's personal TG Chat ID
    provider = Column(String(50), nullable=False)  # 'google' or 'twitter'
    provider_id = Column(String(255), nullable=False)
    role = Column(String(50), default="user", nullable=False) # 'user' or 'pro'
    is_admin = Column(Boolean, default=False)
    trial_credits = Column(Integer, default=5)
    last_credit_reset = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    wallets = relationship("Wallet", back_populates="user", cascade="all, delete-orphan")
    twap_tokens = relationship("UserTwap", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": str(self.id),
            "email": self.email,
            "name": self.name,
            "avatar_url": self.avatar_url,
            "telegram_chat_id": self.telegram_chat_id,
            "provider": self.provider,
            "role": self.role,
            "is_admin": bool(self.is_admin),
            "trial_credits": self.trial_credits,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class Wallet(Base):
    """Wallet model - linked to a specific user"""
    __tablename__ = "wallets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    address = Column(String(255), nullable=False, index=True)
    label = Column(String(255))
    active_trading = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    user = relationship("User", back_populates="wallets")

    def to_dict(self):
        return {
            "id": str(self.id),
            "address": self.address,
            "label": self.label,
            "active_trading": self.active_trading,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class UserTwap(Base):
    """TWAP token watchlist - linked to a specific user"""
    __tablename__ = "user_twaps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(50), nullable=False)
    min_size = Column(Float, default=10000.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    user = relationship("User", back_populates="twap_tokens")

    def to_dict(self):
        return {
            "id": str(self.id),
            "token": self.token,
            "min_size": self.min_size
        }


class UserKey(Base):
    """Encrypted API Keys for users."""
    __tablename__ = 'user_keys'
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    exchange = Column(String(50), nullable=False) # 'binance' or 'hyperliquid'
    key_name = Column(String(100), nullable=True) # Optional label
    
    # Encrypted fields
    api_key_enc = Column(Text, nullable=False) 
    api_secret_enc = Column(Text, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationship
    user = relationship("User", back_populates="keys")

User.keys = relationship("UserKey", back_populates="user", cascade="all, delete-orphan")

class ActiveTrade(Base):
    """Tracks active arbitrage positions for PnL monitoring."""
    __tablename__ = 'active_trades'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    symbol = Column(String(20), nullable=False)
    direction = Column(String(50), nullable=False) # e.g. "Long HL / Short Bin"
    size_usd = Column(Float, nullable=False)
    
    # Entry Snapshot
    entry_price_hl = Column(Float, nullable=True)
    entry_price_bin = Column(Float, nullable=True)
    entry_time = Column(DateTime(timezone=True), server_default=func.now())
    
    status = Column(String(20), default="OPEN") # OPEN, CLOSED, FAILED
    
    # Relationships
    user = relationship("User", back_populates="trades")

User.trades = relationship("ActiveTrade", back_populates="user", cascade="all, delete-orphan")


class IntelItem(Base):
    """Stores intelligence items (News, Predictions) for persistence."""
    __tablename__ = 'intel_items'

    id = Column(String(255), primary_key=True) # Using source ID (url/guid) as primary key
    source_type = Column(String(50), nullable=False) # 'rss', 'twitter', 'polymarket'
    title = Column(Text, nullable=False)
    content = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    
    # Analysis fields
    sentiment = Column(String(20), default="neutral") # bullish, bearish, neutral
    sentiment_score = Column(Float, default=0.0)
    is_high_impact = Column(Boolean, default=False)
    
    # Metadata (e.g. probability for predictions)
    metadata_json = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "source": self.source_type, # mapping back to 'source' key used in frontend
            "title": self.title,
            "content": self.content,
            "url": self.url,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "sentiment": self.sentiment,
            "sentiment_score": self.sentiment_score,
            "is_high_impact": self.is_high_impact,
            "metadata": self.metadata_json or {}
        }


class MicrostructureSnapshot(Base):
    """Stores high-fidelity market microstructure metrics (CVD, Premium) over time."""
    __tablename__ = 'microstructure_snapshots'

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False, index=True) # e.g. BTC
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    
    # Core Metrics
    price = Column(Float, nullable=False)
    cvd_total = Column(Float, nullable=False) # Aggregate CVD (Binance Spot mostly)
    
    # Premium / Basis
    premium_usd = Column(Float, default=0.0) # Coinbase Price - Binance Price
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "cvd": self.cvd_total,
            "spread_usd": self.premium_usd,
            "price": self.price
        }

class TradeSignal(Base):
    """
    Persisted AI Trading Signals to track performance accuracy.
    """
    __tablename__ = 'trade_signals'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(String(20), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    
    recommendation = Column(String(50), nullable=False) # STRONG BUY, ACCUMULATE, etc.
    entry_price = Column(Float, nullable=False)
    stop_loss = Column(Float, nullable=False)
    take_profit_1 = Column(Float, nullable=False)
    take_profit_2 = Column(Float, nullable=True)
    
    alpha_score = Column(Float, default=0.0)
    confidence_label = Column(String(50), default="MEDIUM")
    
    # Tracking
    result = Column(String(20), default="PENDING") # PENDING, WIN, LOSS, EXPIRED
    closed_at = Column(DateTime(timezone=True), nullable=True)
    pnl_percent = Column(Float, default=0.0)

    def to_dict(self):
        return {
            "id": str(self.id),
            "token": self.token,
            "timestamp": self.timestamp.isoformat(),
            "recommendation": self.recommendation,
            "entry": self.entry_price,
            "result": self.result,
            "pnl": self.pnl_percent
        }


class WalletLoginNonce(Base):
    """
    One-time wallet login challenges for SIWE-style authentication.
    """
    __tablename__ = "wallet_login_nonces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    address = Column(String(255), nullable=False, index=True)
    nonce = Column(String(128), nullable=False, index=True)
    chain_id = Column(Integer, nullable=False, default=1)
    issued_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used = Column(Boolean, nullable=False, default=False)
    used_at = Column(DateTime(timezone=True), nullable=True)


class UserTradingSettings(Base):
    """User trading configuration for autonomous mode"""
    __tablename__ = "user_trading_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Position sizing
    equity_usd = Column(Float, default=100000.0)  # User's account equity
    max_position_usd = Column(Float, default=1000.0)  # Max $ per trade
    max_risk_pct = Column(Float, default=0.02)  # 2% risk per trade
    max_leverage = Column(Float, default=3.0)  # Max leverage
    
    # Target levels
    target_profit_pct = Column(Float, default=0.03)  # 3% target profit
    stop_loss_pct = Column(Float, default=0.01)  # 1% stop loss
    
    # Autonomous mode settings
    auto_mode_enabled = Column(Boolean, default=False)
    max_daily_trades = Column(Integer, default=5)
    max_daily_loss_pct = Column(Float, default=0.05)  # 5% max daily loss
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": str(self.id),
            "equity_usd": self.equity_usd,
            "max_position_usd": self.max_position_usd,
            "max_risk_pct": self.max_risk_pct,
            "max_leverage": self.max_leverage,
            "target_profit_pct": self.target_profit_pct,
            "stop_loss_pct": self.stop_loss_pct,
            "auto_mode_enabled": self.auto_mode_enabled,
            "max_daily_trades": self.max_daily_trades,
            "max_daily_loss_pct": self.max_daily_loss_pct,
        }
