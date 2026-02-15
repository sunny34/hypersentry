"""
Database connection and session management
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
import os
import logging

from models import Base

logger = logging.getLogger(__name__)

# Database engine (lazily initialized)
_engine = None
_SessionLocal = None


def get_database_url():
    """Get and normalize the database URL"""
    url = os.getenv("DATABASE_URL", "")
    if not url:
        return None
    # Fix for SQLAlchemy - Railway uses postgres:// but SQLAlchemy needs postgresql://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


def get_engine():
    """Get or create the database engine"""
    global _engine
    if _engine is None:
        database_url = get_database_url()
        if not database_url:
            raise RuntimeError("DATABASE_URL environment variable is not set")
        
        if "sqlite" in database_url:
            connect_args = {"check_same_thread": False}
            pool_kwargs = {} # SQLite has different pooling
        else:
            connect_args = {}
            pool_kwargs = {
                "pool_pre_ping": True,
                "pool_size": 10,
                "max_overflow": 20,
            }

        _engine = create_engine(
            database_url,
            connect_args=connect_args,
            echo=os.getenv("SQL_DEBUG", "false").lower() == "true",
            **pool_kwargs
        )
    return _engine


def get_session_factory():
    """Get or create the session factory"""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())
    return _SessionLocal


def init_db():
    """Create all tables if they don't exist"""
    logger.info("🗄️ Initializing database tables...")
    try:
        engine = get_engine()
        Base.metadata.create_all(bind=engine)
        logger.info("✅ Database tables ready")
    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {e}")
        raise


def get_db():
    """FastAPI dependency for database sessions"""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_session():
    """Context manager for database sessions (for use outside FastAPI)"""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
