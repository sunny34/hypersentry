
import asyncio
import time
import hmac
import hashlib
import json
import logging
import aiohttp
from urllib.parse import urlencode

from hyperliquid.exchange import Exchange
from hyperliquid.utils import types
from eth_account.account import Account

from src.security import decrypt_secret
from models import UserKey, ActiveTrade

logger = logging.getLogger(__name__)

class ArbExecutor:
    """
    Orchestrator for cross-exchange basis arbitrage.
    
    Handles multi-exchange credentials, price discovery, and synchronized leg 
    execution to minimize delta exposure during trade entry.
    """
    def __init__(self, db_session):
        self.db = db_session

    async def get_user_keys(self, user_id: str):
        """Retrieves and filters encrypted API keys for the specified user."""
        keys = self.db.query(UserKey).filter(UserKey.user_id == user_id).all()
        hl_key = next((k for k in keys if k.exchange == 'hyperliquid'), None)
        bin_key = next((k for k in keys if k.exchange == 'binance'), None)
        return hl_key, bin_key

    async def execute_arb(self, user_id: str, symbol: str, size_usd: float, direction: str):
        """
        Executes a synchronized two-leg arbitrage trade.
        
        Args:
            user_id (str): Database ID of the user.
            symbol (str): Asset symbol (e.g., BTC).
            size_usd (float): Total position size in USD.
            direction (str): 'Long HL / Short Binance' or vice-versa.
            
        Returns:
            dict: Execution summary and status markers.
        """
        hl_key_enc, bin_key_enc = await self.get_user_keys(user_id)
        
        if not hl_key_enc or not bin_key_enc:
            return {"status": "error", "message": "Missing API keys for one or both exchanges."}

        # Decrypt
        try:
            hl_secret = decrypt_secret(hl_key_enc.api_secret_enc)
            # HL usually needs wallet private key. Assuming api_secret stored IS the private key for HL.
            
            # Additional safety verify
            import binascii
            try:
                if hl_secret.startswith('0x'):
                    binascii.unhexlify(hl_secret[2:])
                else:
                    binascii.unhexlify(hl_secret)
            except binascii.Error:
                 return {"status": "error", "message": "Stored Hyperliquid Private Key is corrupt or invalid hex."}

            hl_wallet = Account.from_key(hl_secret)
            
            bin_api_key = decrypt_secret(bin_key_enc.api_key_enc)
            bin_secret = decrypt_secret(bin_key_enc.api_secret_enc)
        except Exception as e:
            logger.error(f"Key Decryption Failed: {e}")
            return {"status": "error", "message": f"Failed to decrypt keys: {str(e)}"}

        # 1. Parallel Leg Execution
        is_long_hl = "Long HL" in direction
        logger.info("⚖️ [ARB] Starting direction=%s symbol=%s size_usd=%s user_id=%s", direction, symbol, size_usd, user_id)
        
        results = await asyncio.gather(
            self._execute_hl(hl_wallet, symbol, size_usd, is_long_hl),
            self._execute_binance(bin_api_key, bin_secret, symbol, size_usd, not is_long_hl)
        )
        hl_res, bin_res = results[0], results[1]
        leg_statuses = [hl_res.get("status"), bin_res.get("status")]
        all_ok = all(s in {"executed", "simulated"} for s in leg_statuses)
        has_simulation = any(s == "simulated" for s in leg_statuses)
        overall_status = "error"
        if all_ok and has_simulation:
            overall_status = "simulated"
        elif all_ok:
            overall_status = "executed"
        logger.info("⚖️ [ARB] Completed symbol=%s statuses=%s overall=%s", symbol, leg_statuses, overall_status)
        
        # Record Trade in Database
        try:
            # Persist only truly executed trades; simulated runs are analytics-only.
            if hl_res.get("status") == "executed" and bin_res.get("status") == "executed":
                new_trade = ActiveTrade(
                    user_id=user_id,
                    symbol=symbol,
                    direction=direction,
                    size_usd=size_usd,
                    entry_price_hl=hl_res.get("price", 0), 
                    entry_price_bin=bin_res.get("price", 0),
                    status="OPEN"
                )
                self.db.add(new_trade)
                self.db.commit()
                logger.info(f"✅ [ARB] Trade recorded for {symbol} | User: {user_id}")
            elif overall_status == "simulated":
                logger.warning("⚠️ [ARB] Simulation-only result. No trade persisted for symbol=%s", symbol)
        except Exception as e:
            logger.error(f"❌ [ARB] Database Persistence Error: {e}")

        return {
            "status": overall_status,
            "results": {
                "hyperliquid": hl_res,
                "binance": bin_res
            }
        }
        
    async def broadcast_trade(self, message):
         """Broadcasts trade events to connected WebSocket clients."""
         from src.ws_manager import manager
         await manager.broadcast(message)

    async def _execute_hl(self, wallet, symbol: str, size_usd: float, is_buy: bool):
        """Internal helper for Hyperliquid leg execution."""
        try:
            exchange = Exchange(wallet, base_url="https://api.hyperliquid.xyz")
            logger.debug("Prepared HL exchange client for symbol=%s side=%s", symbol, "Buy" if is_buy else "Sell")
            
            async with aiohttp.ClientSession(trust_env=True) as session:
                async with session.post("https://api.hyperliquid.xyz/info", json={"type": "metaAndAssetCtxs"}) as resp:
                     if resp.status == 200:
                          data = await resp.json()
                          universe = data[0]['universe']
                          ctxs = data[1]
                          for i, asset in enumerate(universe):
                              if asset['name'] == symbol:
                                  price = float(ctxs[i]['markPx'])
                                  return {
                                      "status": "simulated",
                                      "exchange": "hyperliquid",
                                      "side": "Buy" if is_buy else "Sell",
                                      "price": price,
                                      "reason": "dry_run_price_snapshot_only",
                                  }
            
            return {
                "status": "simulated",
                "exchange": "hyperliquid",
                "side": "Buy" if is_buy else "Sell",
                "price": 0,
                "reason": "dry_run_no_price_match",
            }
        except Exception as e:
            logger.error(f"❌ [ARB] HL Exec Error: {e}")
            return {"status": "error", "error": str(e)}

    async def _execute_binance(self, api_key, secret, symbol: str, size_usd: float, is_buy: bool):
        """Internal helper for Binance leg execution."""
        try:
            async with aiohttp.ClientSession(trust_env=True) as session:
                 async with session.get(f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={symbol}USDT", timeout=5) as resp:
                     if resp.status == 200:
                          data = await resp.json()
                          price = float(data['price'])
                          return {
                              "status": "simulated",
                              "exchange": "binance",
                              "side": "Buy" if is_buy else "Sell",
                              "price": price,
                              "reason": "dry_run_price_snapshot_only",
                          }

            return {
                "status": "simulated",
                "exchange": "binance",
                "side": "Buy" if is_buy else "Sell",
                "price": 0,
                "reason": "dry_run_no_price_match",
            }
        except Exception as e:
            logger.error(f"❌ [ARB] Binance Exec Error: {e}")
            return {"status": "error", "error": str(e)}
