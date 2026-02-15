import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

# Generate a key if one doesn't exist
_env_key = os.getenv("ENCRYPTION_KEY")
if not _env_key:
    if os.getenv("ENVIRONMENT") == "production":
        raise RuntimeError("FATAL: ENCRYPTION_KEY must be set in production. Generate with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'")
    import logging
    logging.getLogger(__name__).warning("⚠️ ENCRYPTION_KEY not set. Using temporary key — all encrypted data will be LOST on restart.")
    _key = Fernet.generate_key()
else:
    _key = _env_key.encode() if isinstance(_env_key, str) else _env_key

cipher_suite = Fernet(_key)

def encrypt_secret(secret: str) -> str:
    """Encrypts a string secret."""
    if not secret: return ""
    return cipher_suite.encrypt(secret.encode()).decode()

def decrypt_secret(encrypted_secret: str) -> str:
    """Decrypts a string secret."""
    if not encrypted_secret: return ""
    return cipher_suite.decrypt(encrypted_secret.encode()).decode()
