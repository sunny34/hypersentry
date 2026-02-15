import logging
import asyncio
import os
import time
from telegram import Bot
from telegram.request import HTTPXRequest
from telegram.error import TimedOut, NetworkError, RetryAfter
from config import config

class TelegramBot:
    def __init__(self):
        self.bot = None
        self.chat_id = config.TELEGRAM_CHAT_ID
        self._send_lock = asyncio.Lock()
        self._global_backoff_until = 0.0
        self._chat_next_send_at = {}
        self._message_last_sent_at = {}
        self._min_interval_sec = max(0.2, float(os.getenv("TELEGRAM_MIN_INTERVAL_SEC", "0.6")))
        self._dedupe_window_sec = max(1.0, float(os.getenv("TELEGRAM_DEDUPE_WINDOW_SEC", "4.0")))
        
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

    async def send_message(self, message: str, chat_id: str = None):
        """
        Send a text message to the specific chat ID or default admin.
        """
        target_id = chat_id or self.chat_id
        
        if not self.bot or not target_id:
            logging.debug(f"Alert (Not Sent): {message}")
            return

        target_key = str(target_id)
        now = time.monotonic()
        dedupe_key = (target_key, message.strip())
        last_sent = self._message_last_sent_at.get(dedupe_key, 0.0)
        if (now - last_sent) < self._dedupe_window_sec:
            logging.debug("Telegram dedupe skip chat=%s", target_key)
            return

        async with self._send_lock:
            for attempt in range(5):
                now = time.monotonic()
                wait_for_global = max(0.0, self._global_backoff_until - now)
                wait_for_chat = max(0.0, self._chat_next_send_at.get(target_key, 0.0) - now)
                wait_for = max(wait_for_global, wait_for_chat)
                if wait_for > 0:
                    await asyncio.sleep(wait_for)

                try:
                    await self.bot.send_message(
                        chat_id=target_id,
                        text=message,
                        parse_mode='HTML',
                        disable_web_page_preview=True,
                    )
                    sent_at = time.monotonic()
                    self._chat_next_send_at[target_key] = sent_at + self._min_interval_sec
                    self._message_last_sent_at[dedupe_key] = sent_at
                    return
                except RetryAfter as e:
                    retry_after = max(1, int(getattr(e, "retry_after", 1)))
                    self._global_backoff_until = max(self._global_backoff_until, time.monotonic() + retry_after + 1)
                    logging.warning("Telegram flood control. Retry after %ss.", retry_after)
                    continue
                except (TimedOut, NetworkError) as e:
                    wait = min(8, 2 ** attempt)
                    logging.warning("Telegram network timeout (attempt %s/5): %s", attempt + 1, e)
                    await asyncio.sleep(wait)
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
        await self.send_message(msg, chat_id=self.chat_id)
