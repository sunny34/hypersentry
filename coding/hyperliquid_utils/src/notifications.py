import logging
import asyncio
from telegram import Bot
from telegram.request import HTTPXRequest
from telegram.error import TimedOut, NetworkError
from config import config

class TelegramBot:
    def __init__(self):
        self.bot = None
        self.chat_id = config.TELEGRAM_CHAT_ID
        
        if config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID:
            try:
                # Increase timeouts for better stability
                trequest = HTTPXRequest(connection_pool_size=512, read_timeout=30.0, write_timeout=30.0, connect_timeout=30.0)
                self.bot = Bot(token=config.TELEGRAM_BOT_TOKEN, request=trequest)
                logging.info("Telegram Bot initialized.")
            except Exception as e:
                logging.error(f"Failed to initialize Telegram Bot: {e}")
        else:
            logging.warning("Telegram credentials missing. Alerts will be disabled.")

    async def send_message(self, message: str):
        """
        Send a text message to the configured chat ID.
        """
        if not self.bot or not self.chat_id:
            logging.debug(f"Alert (Not Sent): {message}")
            return

        for attempt in range(3):
            try:
                await self.bot.send_message(chat_id=self.chat_id, text=message, parse_mode='HTML', disable_web_page_preview=True)
                return
            except (TimedOut, NetworkError) as e:
                logging.warning(f"Telegram Timed Out (Attempt {attempt+1}/3): {e}")
                await asyncio.sleep(1)
            except Exception as e:
                logging.error(f"Failed to send Telegram message: {e}")
                return

    async def send_order_alert(self, symbol: str, size: float, side: str, price: float = None):
        """
        Formatted alert for order execution.
        """
        price_str = f" @ ${price}" if price else " (Market)"
        msg = f"🚀 <b>Order Executed</b>\n\n" \
              f"Symbol: {symbol}\n" \
              f"Side: {side}\n" \
              f"Size: {size}\n" \
              f"Type: {price_str}"
        
        # Note: python-telegram-bot's send_message supports parse_mode='HTML'
        if self.bot and self.chat_id:
            for attempt in range(3):
                try:
                    await self.bot.send_message(chat_id=self.chat_id, text=msg, parse_mode='HTML')
                    return
                except (TimedOut, NetworkError) as e:
                    logging.warning(f"Telegram Timed Out (Attempt {attempt+1}/3): {e}")
                    await asyncio.sleep(1)
                except Exception as e:
                    logging.error(f"Failed to send order alert: {e}")
                    return
