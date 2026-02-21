import binascii
import logging
import os
import time
from typing import Optional

import eth_account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from hyperliquid.utils import constants

from config import config

logger = logging.getLogger(__name__)

_PLACEHOLDER_TOKENS = {
    "",
    "...",
    "0x...",
    "your_private_key_here",
    "your_hl_private_key_here",
    "changeme",
}

class HyperliquidClient:
    def __init__(self):
        self.info = Info(constants.MAINNET_API_URL, skip_ws=True)

        self.wallet = None
        self.exchange = None
        self._exchange_init_attempted = False
        self._configured_private_key = config.HL_PRIVATE_KEY
        self._configured_account_address = config.HL_ACCOUNT_ADDRESS
        self._user_state_cache = {}
        self._user_state_backoff_until = {}
        self._user_state_cache_ttl_sec = max(1.0, float(os.getenv("HL_USER_STATE_CACHE_SEC", "2.0")))

        # Startup must be read-only safe.
        # We intentionally defer key parsing and Exchange init until a trade call.
        if not self._configured_private_key:
            logger.info("HL_PRIVATE_KEY not set. Running in READ-ONLY mode.")
        elif self._is_placeholder_value(self._configured_private_key):
            logger.info("HL_PRIVATE_KEY is a placeholder. Running in READ-ONLY mode.")

        if not self._configured_account_address or self._is_placeholder_value(self._configured_account_address):
            logger.info("HL_ACCOUNT_ADDRESS not set. Signed account actions are disabled.")

    @staticmethod
    def _is_placeholder_value(value: str) -> bool:
        if value is None:
            return True
        cleaned = str(value).strip().strip("\"'").lower()
        return cleaned in _PLACEHOLDER_TOKENS

    @staticmethod
    def _normalize_private_key(raw_key: str) -> str:
        if not raw_key:
            raise ValueError("Private key is empty.")
        cleaned = raw_key.strip().strip("\"'")
        key_hex = cleaned[2:] if cleaned.lower().startswith("0x") else cleaned
        if len(key_hex) != 64:
            raise ValueError("Private key must be 64 hex chars (32 bytes).")
        try:
            binascii.unhexlify(key_hex)
        except binascii.Error as exc:
            raise ValueError("Private key contains non-hex characters.") from exc
        return f"0x{key_hex}"

    def can_use_server_signing(self) -> bool:
        """
        Returns True only when a server-side signing config is valid.
        This lets API routes fail fast without triggering noisy init warnings.
        """
        raw_key = self._configured_private_key
        if not raw_key or self._is_placeholder_value(raw_key):
            return False
        if not self._configured_account_address or self._is_placeholder_value(self._configured_account_address):
            return False
        try:
            self._normalize_private_key(raw_key)
        except ValueError:
            return False
        return True

    def _ensure_exchange(self) -> Optional[Exchange]:
        if self.exchange:
            return self.exchange
        if self._exchange_init_attempted:
            return None
        self._exchange_init_attempted = True

        if not self.wallet:
            raw_key = self._configured_private_key
            if not raw_key or self._is_placeholder_value(raw_key):
                logger.warning("Exchange initialization skipped: HL private key is missing.")
                return None
            try:
                normalized = self._normalize_private_key(raw_key)
                self.wallet = eth_account.Account.from_key(normalized)
            except Exception as e:
                logger.warning(
                    "Trading key invalid. Running in READ-ONLY mode until key is fixed: %s",
                    e,
                )
                return None
        if not self._configured_account_address or self._is_placeholder_value(self._configured_account_address):
            logger.warning("Exchange initialization skipped: HL_ACCOUNT_ADDRESS is missing.")
            return None
        try:
            self.exchange = Exchange(self.wallet, constants.MAINNET_API_URL)
            logger.info("Hyperliquid Exchange initialized successfully.")
            return self.exchange
        except Exception as e:
            self.exchange = None
            logger.warning("Exchange init failed. Running in READ-ONLY mode: %s", e)
            return None

    def get_user_state(self, address: str):
        """
        Get the current state of a user (positions, margin, etc.)
        """
        key = str(address or "").lower()

        # Skip API calls for placeholder addresses
        if self._is_placeholder_value(address):
            logger.debug(f"Skipping fetch for placeholder address: {address}")
            return None

        now = time.time()
        cached = self._user_state_cache.get(key)

        if cached and (now - cached["ts"]) <= self._user_state_cache_ttl_sec:
            return cached["data"]

        if now < float(self._user_state_backoff_until.get(key, 0.0)):
            return cached["data"] if cached else None

        try:
            state = self.info.user_state(address)
            self._user_state_cache[key] = {"data": state, "ts": now}
            self._user_state_backoff_until[key] = 0.0
            return state
        except Exception as e:
            text = str(e).lower()
            if "429" in text or "rate limited" in text:
                self._user_state_backoff_until[key] = now + 3.0
                if cached:
                    return cached["data"]
            logger.error(f"Error fetching user state for {address}: {e}")
            return None

    def get_open_orders(self, address: str):
        """
        Get open orders for a user.
        """
        # Skip API calls for placeholder addresses
        if self._is_placeholder_value(address):
            logger.debug(f"Skipping open orders fetch for placeholder address: {address}")
            return None

        try:
            return self.info.open_orders(address)
        except Exception as e:
            logger.error(f"Error fetching open orders for {address}: {e}")
            return None

    def get_l2_snapshot(self, coin: str):
        """
        Get Level 2 Order Book snapshot.
        """
        try:
            return self.info.l2_snapshot(coin)
        except Exception as e:
            logger.error(f"Error fetching L2 snapshot for {coin}: {e}")
            return None

    def get_candles(self, coin: str, interval: str, start_time: int, end_time: int):
        """
        Get candle snapshot for a coin.
        """
        try:
            return self.info.candles_snapshot(coin, interval, start_time, end_time)
        except Exception as e:
            logger.error(f"Error fetching candles for {coin}: {e}")
            return []

    async def get_mark_price(self, coin: str) -> float:
        """
        Retrieves the current mark price for a given asset.
        
        Attempts to use allMids for efficiency. If the coin is missing (e.g. newer listing),
        falls back to a full metaAndAssetCtxs fetch.
        
        Args:
            coin (str): The symbol of the asset (e.g., 'BTC').
            
        Returns:
            float: The current mark price or 0.0 if fetch fails.
        """
        try:
            res = self.info.all_mids()
            if coin in res:
                return float(res[coin])
            
            # Fallback to metaAndAssetCtxs if allMids lacks the coin
            meta = self.info.meta_and_asset_ctxs()
            universe = meta[0]['universe']
            for i, asset in enumerate(universe):
                if asset['name'] == coin:
                    return float(meta[1][i]['markPx'])
            return 0.0
        except Exception as e:
            logger.error(f"Error fetching mark price for {coin}: {e}")
            return 0.0

    def market_open(self, coin: str, is_buy: bool, sz: float, px: float = None, slippage: float = 0.05):
        """
        Executes a market-style order by placing an aggressive limit order.
        
        Hyperliquid uses aggressive limits to simulate market execution while 
        providing slippage protection.
        
        Args:
            coin (str): The symbol of the asset.
            is_buy (bool): True for Buy/Long, False for Sell/Short.
            sz (float): The size of the order in base asset units.
            px (float, optional): The reference price. If None, derived from mid.
            slippage (float): Slippage tolerance (default 5%).
            
        Returns:
            dict: The API response from the exchange.
        """
        exchange = self._ensure_exchange()
        if not exchange:
            raise Exception("Exchange not initialized. Private key missing or invalid.")

        try:
            logger.info(f"🚀 [TRADE] Executing Market Order: {coin} {'BUY' if is_buy else 'SELL'} {sz}")
            res = exchange.market_open(coin, is_buy, sz, px, slippage)
            
            if res.get("status") == "err":
                logger.error(f"❌ [TRADE] Execution Error for {coin}: {res.get('response')}")
            else:
                logger.info(f"✅ [TRADE] Order Filled | {coin} | Response Status: {res.get('status')}")
            
            return res
        except Exception as e:
            logger.error(f"❌ [TRADE] CRITICAL EXCEPTION during {coin} execution: {e}")
            raise e

    async def managed_trade(self, coin: str, is_buy: bool, sz: float, tp: float = None, sl: float = None, twap: dict = None):
        """
        Executes an atomic 'Managed Trade' or a scheduled 'TWAP' order.
        
        Args:
            coin (str): Asset symbol.
            is_buy (bool): Direction.
            sz (float): Base size.
            tp (float, optional): Price level for Take Profit.
            sl (float, optional): Price level for Stop Loss.
            twap (dict, optional): TWAP config {minutes: int, randomize: bool}.
            
        Returns:
            dict: Summary of all execution steps.
        """
        exchange = self._ensure_exchange()
        if not exchange:
            raise Exception("Exchange not initialized. Actions requiring signing are disabled.")

        results = []
        try:
            # 1. Place Primary Order (TWAP vs Market)
            logger.info(f"⛓️ [MANAGED] Initiating atomic flow for {coin}...")
            
            if twap:
                # Use native TWAP order
                mark_px = await self.get_mark_price(coin)
                # For TWAP, limit price should be generous to allow fill
                limit_px = mark_px * (1.1 if is_buy else 0.9)
                
                logger.info(f"⏳ [TWAP] Scheduling {twap['minutes']}m execution for {sz} {coin} @ {twap.get('randomize')} randomization")
                main_res = exchange.order({
                    "asset": exchange.coin_to_asset(coin),
                    "isBuy": is_buy,
                    "sz": sz,
                    "limitPx": limit_px,
                    "orderType": {"twap": {"minutes": int(twap['minutes']), "randomize": bool(twap.get('randomize', False))}},
                    "reduceOnly": False
                })
            else:
                main_res = self.market_open(coin, is_buy, sz)
            
            results.append({"type": "main", "result": main_res})
            
            if main_res.get("status") != "ok" and main_res.get("status") != "filled":
                 logger.warning(f"🚫 [MANAGED] Primary leg failed. Aborting Risk Guardians for {coin}.")
                 return {"status": "err", "message": "Primary order failed", "results": results}

            # 2. Place Take Profit (Reduce Only)
            if tp:
                logger.info(f"🎯 [MANAGED] Setting Take Profit trigger at ${tp}")
                tp_res = exchange.order({
                    "asset": exchange.coin_to_asset(coin),
                    "isBuy": not is_buy,
                    "sz": sz,
                    "limitPx": tp,
                    "orderType": {"trigger": {"isMarket": True, "triggerPx": tp, "tpsl": "tp"}},
                    "reduceOnly": True
                })
                results.append({"type": "tp", "result": tp_res})

            # 3. Place Stop Loss (Reduce Only)
            if sl:
                logger.info(f"🛡️ [MANAGED] Setting Stop Loss trigger at ${sl}")
                sl_res = exchange.order({
                    "asset": exchange.coin_to_asset(coin),
                    "isBuy": not is_buy,
                    "sz": sz,
                    "limitPx": sl,
                    "orderType": {"trigger": {"isMarket": True, "triggerPx": sl, "tpsl": "sl"}},
                    "reduceOnly": True
                })
                results.append({"type": "sl", "result": sl_res})

            logger.info(f"🏁 [MANAGED] Flow complete for {coin}. TP: {'SET' if tp else 'NONE'} | SL: {'SET' if sl else 'NONE'}")
            return {"status": "ok", "results": results}

        except Exception as e:
            logger.error(f"❌ [MANAGED] CRITICAL FAILURE during atomic flow: {e}")
            return {"status": "err", "message": str(e), "results": results}
