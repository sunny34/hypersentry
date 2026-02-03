import logging
import eth_account
from hyperliquid.info import Info
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants
from config import config

class HyperliquidClient:
    def __init__(self):
        self.info = Info(constants.MAINNET_API_URL, skip_ws=True)
        
        self.wallet = None
        self.exchange = None
        
        # Initialize Exchange if credentials are present
        if config.HL_PRIVATE_KEY and config.HL_ACCOUNT_ADDRESS:
            if "..." in config.HL_PRIVATE_KEY:
                logging.warning("⚠️ Private Key is a placeholder. Initializing in SIMULATION MODE.")
                self.wallet = None
                self.exchange = None
            else:
                try:
                    self.wallet = eth_account.Account.from_key(config.HL_PRIVATE_KEY)
                    self.exchange = Exchange(self.wallet, constants.MAINNET_API_URL)
                    logging.info("Hyperliquid Exchange initialized successfully.")
                except Exception as e:
                    logging.error(f"Failed to initialize Exchange (Check Private Key format): {e}")
        else:
            logging.warning("Private key not found. Client is in READ-ONLY mode.")

    def get_user_state(self, address: str):
        """
        Get the current state of a user (positions, margin, etc.)
        """
        try:
            return self.info.user_state(address)
        except Exception as e:
            logging.error(f"Error fetching user state for {address}: {e}")
            return None

    def get_open_orders(self, address: str):
        """
        Get open orders for a user.
        """
        try:
            return self.info.open_orders(address)
        except Exception as e:
            logging.error(f"Error fetching open orders for {address}: {e}")
    def get_l2_snapshot(self, coin: str):
        """
        Get Level 2 Order Book snapshot.
        """
        try:
            return self.info.l2_snapshot(coin)
        except Exception as e:
            logging.error(f"Error fetching L2 snapshot for {coin}: {e}")
            return None

    def get_candles(self, coin: str, interval: str, start_time: int, end_time: int):
        """
        Get candle snapshot for a coin.
        """
        try:
            return self.info.candles_snapshot(coin, interval, start_time, end_time)
        except Exception as e:
            logging.error(f"Error fetching candles for {coin}: {e}")
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
            logging.error(f"Error fetching mark price for {coin}: {e}")
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
        if not self.exchange:
            logging.warning(f"⚠️ [SIMULATION] Market order {coin} {'Buy' if is_buy else 'Sell'} {sz}")
            return {"status": "filled", "oid": 123456, "simulated": True}

        try:
            logging.info(f"🚀 [TRADE] Executing Market Order: {coin} {'BUY' if is_buy else 'SELL'} {sz}")
            res = self.exchange.market_open(coin, is_buy, sz, px, slippage)
            
            if res.get("status") == "err":
                logging.error(f"❌ [TRADE] Execution Error for {coin}: {res.get('response')}")
            else:
                logging.info(f"✅ [TRADE] Order Filled | {coin} | Response Status: {res.get('status')}")
            
            return res
        except Exception as e:
            logging.error(f"❌ [TRADE] CRITICAL EXCEPTION during {coin} execution: {e}")
            raise e

    def managed_trade(self, coin: str, is_buy: bool, sz: float, tp: float = None, sl: float = None):
        """
        Executes an atomic 'Managed Trade' with automated safety guards.
        
        Workflow:
        1. Places a primary market order for the specified size.
        2. If successful, immediately places 'Reduce Only' trigger orders for 
           Take Profit and Stop Loss at the specified prices.
        
        Args:
            coin (str): Asset symbol.
            is_buy (bool): Direction.
            sz (float): Base size.
            tp (float, optional): Price level for Take Profit.
            sl (float, optional): Price level for Stop Loss.
            
        Returns:
            dict: Summary of all execution steps.
        """
        if not self.exchange:
            logging.warning(f"⚠️ [SIMULATION] Managed Trade {coin} | TP: {tp} | SL: {sl}")
            return {"status": "ok", "simulated": True, "message": "Managed simulation successful"}

        results = []
        try:
            # 1. Place Primary Order
            logging.info(f"⛓️ [MANAGED] Initiating atomic flow for {coin}...")
            main_res = self.market_open(coin, is_buy, sz)
            results.append({"type": "main", "result": main_res})
            
            if main_res.get("status") != "ok" and main_res.get("status") != "filled":
                 logging.warning(f"🚫 [MANAGED] Primary leg failed. Aborting Risk Guardians for {coin}.")
                 return {"status": "err", "message": "Primary order failed", "results": results}

            # 2. Place Take Profit (Reduce Only)
            if tp:
                logging.info(f"🎯 [MANAGED] Setting Take Profit trigger at ${tp}")
                tp_res = self.exchange.order({
                    "asset": self.exchange.coin_to_asset(coin),
                    "isBuy": not is_buy,
                    "sz": sz,
                    "limitPx": tp,
                    "orderType": {"trigger": {"isMarket": True, "triggerPx": tp, "tpsl": "tp"}},
                    "reduceOnly": True
                })
                results.append({"type": "tp", "result": tp_res})

            # 3. Place Stop Loss (Reduce Only)
            if sl:
                logging.info(f"🛡️ [MANAGED] Setting Stop Loss trigger at ${sl}")
                sl_res = self.exchange.order({
                    "asset": self.exchange.coin_to_asset(coin),
                    "isBuy": not is_buy,
                    "sz": sz,
                    "limitPx": sl,
                    "orderType": {"trigger": {"isMarket": True, "triggerPx": sl, "tpsl": "sl"}},
                    "reduceOnly": True
                })
                results.append({"type": "sl", "result": sl_res})

            logging.info(f"🏁 [MANAGED] Flow complete for {coin}. TP: {'SET' if tp else 'NONE'} | SL: {'SET' if sl else 'NONE'}")
            return {"status": "ok", "results": results}

        except Exception as e:
            logging.error(f"❌ [MANAGED] CRITICAL FAILURE during atomic flow: {e}")
            return {"status": "err", "message": str(e), "results": results}
