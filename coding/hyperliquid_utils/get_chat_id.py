import asyncio
import os
from telegram import Bot
from dotenv import load_dotenv

# Load just the token from env
load_dotenv()
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

async def get_chat_id():
    if not TOKEN:
        print("Error: TELEGRAM_BOT_TOKEN not found in .env")
        return

    bot = Bot(token=TOKEN)
    print(f"🤖 Bot Check: {await bot.get_me()}")
    print("\n👉 Please send a message (e.g., 'Hello') to your bot on Telegram now...")
    
    offset = 0
    while True:
        try:
            updates = await bot.get_updates(offset=offset, timeout=10)
            for u in updates:
                offset = u.update_id + 1
                if u.message:
                    chat_id = u.message.chat.id
                    user = u.message.from_user.username
                    print(f"\n✅ Found Message from @{user}!")
                    print(f"🆔 Your Chat ID is: {chat_id}")
                    print(f"\nPlease add this to your .env file:\nTELEGRAM_CHAT_ID={chat_id}")
                    return
        except Exception as e:
            print(f"Error polling: {e}")
            await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(get_chat_id())
