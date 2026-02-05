
import os
from sqlalchemy import create_engine, text
from config import config

def migrate():
    # Construct DB URL if using local config or fallback
    db_url = config.DATABASE_URL
    if not db_url:
        print("No DATABASE_URL found. Skipping migration.")
        return

    print(f"Migrating database: {db_url}")
    engine = create_engine(db_url)
    
    with engine.connect() as conn:
        conn.execution_options(isolation_level="AUTOCOMMIT")
        try:
            # Check if column exists
            print("Checking if column exists...")
            result = conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='users' AND column_name='telegram_chat_id';"
            ))
            
            if result.fetchone():
                print("Column 'telegram_chat_id' already exists.")
            else:
                print("Adding 'telegram_chat_id' column...")
                conn.execute(text("ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(255);"))
                print("Column added successfully.")
                
        except Exception as e:
            print(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
