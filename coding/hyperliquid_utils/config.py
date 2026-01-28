import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Config:
    """
    HyperSentry Configuration
    All settings are loaded from environment variables for security and flexibility.
    """
    
    # Environment
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    DEBUG = ENVIRONMENT == "development"
    
    # Hyperliquid Credentials
    HL_ACCOUNT_ADDRESS = os.getenv("HL_ACCOUNT_ADDRESS")
    HL_PRIVATE_KEY = os.getenv("HL_PRIVATE_KEY")
    
    # Telegram Bot
    TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
    TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
    
    # Google AI (Gemini)
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    
    # Redis (for Celery)
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # PostgreSQL Database
    DATABASE_URL = os.getenv("DATABASE_URL")
    
    # CORS - Allowed origins for frontend
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

    @classmethod
    def validate(cls):
        """Validate critical configuration on startup."""
        import logging
        logger = logging.getLogger(__name__)
        
        warnings = []
        
        if not cls.HL_ACCOUNT_ADDRESS:
            warnings.append("HL_ACCOUNT_ADDRESS not set")
        if not cls.HL_PRIVATE_KEY:
            warnings.append("HL_PRIVATE_KEY not set (Trading will fail)")
        if not cls.TELEGRAM_BOT_TOKEN:
            warnings.append("TELEGRAM_BOT_TOKEN not set (Notifications disabled)")
        if not cls.DATABASE_URL:
            logger.info("DATABASE_URL not set - using JSON file storage")
            
        for w in warnings:
            logger.warning(f"⚠️  {w}")
            
        if cls.ENVIRONMENT == "production":
            logger.info("🚀 Running in PRODUCTION mode")
        else:
            logger.info("🔧 Running in DEVELOPMENT mode")
            
        return len(warnings) == 0

    @classmethod
    def is_production(cls) -> bool:
        return cls.ENVIRONMENT == "production"


config = Config()
