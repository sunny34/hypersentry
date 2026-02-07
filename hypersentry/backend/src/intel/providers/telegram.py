import datetime
import asyncio
import os
import aiohttp
from typing import List, Dict, Any
from .base import IntelProvider

class TelegramProvider(IntelProvider):
    """
    Sourced intelligence from Telegram Insider Channels via Bot API.
    """
    def __init__(self):
        super().__init__("Telegram")
        self.bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.last_update_id = 0

    async def fetch_latest(self) -> List[Dict[str, Any]]:
        """Fetch latest messages from the Telegram bot updates."""
        if not self.bot_token:
            return []
            
        url = f"https://api.telegram.org/bot{self.bot_token}/getUpdates"
        params = {"offset": self.last_update_id + 1, "timeout": 0}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        updates = data.get("result", [])
                        
                        items = []
                        for upd in updates:
                            self.last_update_id = max(self.last_update_id, upd["update_id"])
                            
                            message = upd.get("message") or upd.get("channel_post")
                            if not message or not message.get("text"):
                                continue
                                
                            text = message["text"]
                            # Basic parser: first line is title, rest is content
                            lines = text.split("\n", 1)
                            title = lines[0][:100]
                            content = lines[1] if len(lines) > 1 else text
                            
                            items.append(self.normalize(
                                raw_id=str(upd["update_id"]),
                                title=f"TG Alpha: {title}",
                                content=content,
                                url=f"https://t.me/c/{message['chat']['id']}/{message.get('message_id', '')}",
                                timestamp=datetime.datetime.fromtimestamp(message["date"]),
                                sentiment="neutral" # Frontend heuristics will handle this
                            ))
                        return items
        except Exception as e:
            print(f"Telegram Provider Error: {e}")
            
        return []
