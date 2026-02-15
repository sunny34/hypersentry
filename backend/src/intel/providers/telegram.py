import datetime
import asyncio
import os
import aiohttp
import logging
from typing import List, Dict, Any
from .base import IntelProvider

logger = logging.getLogger(__name__)

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
                        import re
                        
                        for upd in updates:
                            self.last_update_id = max(self.last_update_id, upd["update_id"])
                            
                            message = upd.get("message") or upd.get("channel_post")
                            if not message or not message.get("text"):
                                continue
                                
                            text = message["text"]
                            
                            # 1. Extract Tickers
                            # Matches $BTC, #ETH, or just capitalized symbols in context if possible
                            tickers = re.findall(r'[\$#]([A-Za-z]{2,6})', text)
                            
                            # 2. Check High Impact Keywords
                            high_impact_terms = ["LISTING", "BINANCE", "UPBIT", "COINBASE", "HACK", "EXPLOIT", "STOLEN", "PARTNERSHIP", "MAINNET"]
                            is_high_impact = any(term in text.upper() for term in high_impact_terms)
                            
                            # 3. Format Title
                            # If tickers found, start with them
                            if tickers:
                                ticker_str = " ".join([f"${t.upper()}" for t in tickers[:3]])
                                title = f"TG Alpha {ticker_str}: {text[:80]}..."
                            else:
                                lines = text.split("\n", 1)
                                title = f"TG Alpha: {lines[0][:100]}"
                            
                            content = text
                            
                            chat_id = str(message['chat']['id']).replace("-100", "") # Clean channel ID
                            
                            item = self.normalize(
                                raw_id=str(upd["update_id"]),
                                title=title,
                                content=content,
                                url=f"https://t.me/c/{chat_id}/{message.get('message_id', '')}",
                                timestamp=datetime.datetime.fromtimestamp(message["date"]),
                                sentiment="neutral" # Engine will enhance this via Gemini
                            )
                            
                            if is_high_impact:
                                item["is_high_impact"] = True
                                item["sentiment"] = "bullish" if "LISTING" in text.upper() else "bearish" if "HACK" in text.upper() else "neutral"
                            
                            items.append(item)
                            
                        return items
        except Exception as e:
            logger.debug("Telegram provider fetch failed err=%s", e)
            
        return []
