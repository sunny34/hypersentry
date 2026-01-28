"""
Database models for HyperliquidSentry
Using SQLAlchemy ORM with PostgreSQL
"""

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Float, Text
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
    provider = Column(String(50), nullable=False)  # 'google' or 'twitter'
    provider_id = Column(String(255), nullable=False)
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
            "provider": self.provider,
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

    # Unique constraint: one wallet per user
    __table_args__ = (
        {"postgresql_concurrently": False},  # For unique constraint
    )

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
