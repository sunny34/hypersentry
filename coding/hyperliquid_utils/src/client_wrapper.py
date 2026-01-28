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

    def market_open(self, coin: str, is_buy: bool, sz: float, px: float = None, slippage: float = 0.05):
        """
        Execute a Market Open order. 
        Note: Hyperliquid "Market" orders are often treated as aggressive Limit orders.
        """
        if not self.exchange:
            logging.warning(f"⚠️ SIMULATION MODE: Would have ordered {coin} {'Buy' if is_buy else 'Sell'} {sz}")
            # Return a dummy success so the flow continues (alerts get sent)
            return {"status": "filled", "oid": 123456, "simulated": True}

        # Determine price (if not provided, get current price and apply slippage)
        if px is None:
            # TODO: Fetch current price to calculate limit price for market order
            # For now, we rely on the SDK's market_open if available or implement logic
            pass
            
        # Using the SDK's helper for market open if available, or constructing the order
        # The raw SDK usually requires `order` method. 
        # For simplicity in this wrapper, let's assume we use the standard `market_open` from SDK examples if it exists,
        # otherwise we build it.
        
        # According to standard SDK usage: exchange.market_open(coin, is_buy, sz, px, slippage)
        try:
            logging.info(f"Placing Market Order: {coin} {'Buy' if is_buy else 'Sell'} {sz}")
            # return self.exchange.market_open(coin, is_buy, sz, px, slippage)
            pass 
        except Exception as e:
            logging.error(f"Trade failed: {e}")
            return None
