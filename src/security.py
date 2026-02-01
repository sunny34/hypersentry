import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

# Generate a key if one doesn't exist (in production, strictly load from env)
_env_key = os.getenv("ENCRYPTION_KEY")
if not _env_key:
    # detailed warning in logs would go here
    _key = Fernet.generate_key()
    # In a real app, you MUST persist this key or you lose all data
    # For this session/MVP, we'll error if it's missing to force safety
    # But to prevent crashing the user's current run if they didn't set it:
    print("WARNING: ENCRYPTION_KEY not found in env. Using temporary key (data lost on restart).")
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
