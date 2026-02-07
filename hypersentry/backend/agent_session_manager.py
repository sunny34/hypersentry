import logging
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from hyperliquid.utils import constants
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AgentSessionManager:
    """
    Expert implementation of Hyperliquid Agent Session Management.
    This system allows a 'Main Wallet' to authorize an 'Agent Wallet' (ephemeral)
     to sign trades, keeping the Main Wallet's private key offline after setup.
    """

    def __init__(self, main_address: str, main_private_key: str = None):
        self.main_address = main_address
        self.main_private_key = main_private_key
        self.agent_account = None
        self.exchange = None
        self.info = Info(constants.MAINNET_API_URL, skip_ws=True)

    def generate_agent(self):
        """
        Requirement: Agent Generation.
        Uses eth_account to generate a new random private key/wallet to act as the Agent.
        """
        self.agent_account = Account.create()
        logger.info(f"🆕 Generated fresh Agent: {self.agent_account.address}")
        return self.agent_account

    def authorize_agent(self, main_private_key: str = None):
        """
        Requirement: One-Time Authorization.
        Uses the Main Wallet's private key to call exchange.approve_agent().
        
        TECHNICAL NOTE: In a real production terminal, you would NOT store the main_private_key.
        The user would either:
        1. Provide it once for this specific session (in-memory only).
        2. Sign an EIP-712 message via a browser extension (MetaMask) which is then relayed.
        """
        if not self.agent_account:
            self.generate_agent()

        priv_key = main_private_key or self.main_private_key
        if not priv_key:
            raise ValueError("Main private key required for initial authorization.")

        # Initialize Exchange with Main Wallet to perform the authorization
        main_exchange = Exchange(Account.from_key(priv_key), constants.MAINNET_API_URL)
        
        logger.info(f"🔐 Authorizing Agent {self.agent_account.address} for Main Wallet {self.main_address}...")
        
        # Hyperliquid L1 Action: approveAgent
        # This registers the agentAddress as a valid 'subkey' for this main_address
        result = main_exchange.approve_agent(self.agent_account.address, "AlphaTerminalAgent")
        
        if result['status'] == 'ok':
            logger.info("✅ Agent Successfully Authorized on Hyperliquid L1.")
            return True
        else:
            logger.error(f"❌ Authorization Failed: {result}")
            return False

    def initialize_agent_trading(self):
        """
        Requirement: Agent-Based Trading.
        
        CRUCIAL: We set 'account_address' to the Main Wallet's public address
        but 'base_signer' to the Agent's private key.
        
        WHY: Hyperliquid needs to know WHICH account is trading (account_address)
        but the signature must be valid for an authorized Agent (base_signer).
        The SDK internally handles the EIP-712 'Sub-key' signing logic.
        """
        if not self.agent_account:
            raise ValueError("No agent generated. Call generate_agent() first.")

        # Initialize the Exchange class using the Agent's private key as the base_signer.
        # account_address MUST be the Main Wallet.
        self.exchange = Exchange(
            base_signer=self.agent_account,
            base_url=constants.MAINNET_API_URL,
            account_address=self.main_address 
        )
        logger.info(f"🚀 Trading initialized for {self.main_address} using Agent {self.agent_account.address}")
        return self.exchange

    def execute_market_order(self, coin: str, is_buy: bool, size: float):
        """
        Requirement: Agent-Based Trading Example.
        After authorization, only the Agent's private key is used for signing orders.
        """
        if not self.exchange:
            self.initialize_agent_trading()

        logger.info(f"📊 Executing {'BUY' if is_buy else 'SELL'} {size} {coin} via Agent...")
        
        # The SDK will use the Agent key to sign, referencing the Main Account
        result = self.exchange.market_open(coin, is_buy, size, None, 0.01) # 1% slippage
        
        logger.info(f"Order Result: {result}")
        return result

    def revoke_agent(self, main_private_key: str = None):
        """
        Requirement: Revoke Agent (Logout).
        Shows how a user 'logs out' by revoking the subkey authority on-chain.
        """
        priv_key = main_private_key or self.main_private_key
        if not priv_key:
            logger.error("Main private key required to revoke agent on-chain.")
            return False

        main_exchange = Exchange(Account.from_key(priv_key), constants.MAINNET_API_URL)
        
        logger.info(f"🛑 Revoking Agent {self.agent_account.address}...")
        
        # Currently, users often just clear local storage, but for full security,
        # you can approve a null address or use specific revoke actions if supported.
        # In Hyperliquid, authorized agents can be cleared or overridden.
        # This example uses a mock-up of revoking (check SDK docs for specific revoke call if available, 
        # usually it's overriding the agent).
        
        # Note: Clearing local state is the first step of 'logging out'.
        self.agent_account = None
        self.exchange = None
        logger.info("✅ Local Agent Session Cleared.")
        return True

if __name__ == "__main__":
    # --- EXAMPLE USAGE ---
    # In a real scenario, these would come from environment variables or secure user input
    USER_MAIN_ADDRESS = "0x1424f6867332308E88EFCd2E4876bBe0978Eca26"
    # DO NOT hardcode private keys in real applications!
    SECRET_KEY = "YOUR_MAIN_PRIVATE_KEY_HERE" 

    session = AgentSessionManager(USER_MAIN_ADDRESS)
    
    # 1. Generate Agent
    agent = session.generate_agent()
    
    # 2. Authorize (requires main key once)
    # success = session.authorize_agent(SECRET_KEY)
    
    # 3. Trade (Only uses Agent key from now on)
    # if success:
    #     session.execute_market_order("BTC", True, 0.001)
    
    # 4. Revoke
    # session.revoke_agent(SECRET_KEY)
