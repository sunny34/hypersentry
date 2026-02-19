"""
User Balance Service - Real-time balance via Hyperliquid WebSocket
Subscribes to user states dynamically based on connected wallets.
"""
import asyncio
import logging
import time
from typing import Dict, Optional
from threading import Lock

logger = logging.getLogger(__name__)


class UserBalanceStore:
    """
    Thread-safe store for user balances with real-time updates.
    Keyed by wallet address.
    """
    _instance = None
    _lock = Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._balances: Dict[str, dict] = {}
                    cls._instance._last_update: Dict[str, float] = {}
        return cls._instance
    
    def get_balance(self, address: str) -> Optional[dict]:
        """Get cached balance for an address"""
        return self._balances.get(address.lower())
    
    def set_balance(self, address: str, balance: dict):
        """Update balance"""
        address = address.lower()
        self._balances[address] = {
            **balance,
            "updated_at": time.time()
        }
        self._last_update[address] = time.time()
    
    def get_all_balances(self) -> Dict[str, dict]:
        """Get all cached balances"""
        return dict(self._balances)


# Singleton instance
user_balance_store = UserBalanceStore()


class UserBalanceWebSocket:
    """
    Manages WebSocket connection to Hyperliquid for user state updates.
    Dynamically subscribes to users as they connect.
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._ws = None
            cls._instance._session = None
            cls._instance._subscriptions: set = set()
            cls._instance._running = False
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._address_to_user_id: Dict[str, str] = {}  # address -> user_id for WS broadcast
        return cls._instance
    
    async def start(self):
        """Start the WebSocket connection"""
        if self._running:
            return
        
        self._running = True
        self._task = asyncio.create_task(self._run_ws())
        logger.info("User balance WebSocket service started")
    
    async def stop(self):
        """Stop the WebSocket connection"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._ws:
            await self._ws.close()
        if self._session:
            await self._session.close()
        logger.info("User balance WebSocket service stopped")
    
    async def subscribe_user(self, address: str, user_id: Optional[str] = None):
        """
        Subscribe to a user's balance updates.
        Called when user connects their wallet.
        """
        address = address.lower()
        
        if address in self._subscriptions:
            return  # Already subscribed
        
        self._subscriptions.add(address)
        if user_id:
            self._address_to_user_id[address] = user_id
        
        # If WS is already connected, send subscription message
        if self._ws and not self._ws.closed:
            await self._send_subscribe(address)
        
        logger.info(f"Subscribed to balance for {address}")
    
    async def unsubscribe_user(self, address: str):
        """Unsubscribe from a user's balance updates"""
        address = address.lower()
        self._subscriptions.discard(address)
        self._address_to_user_id.pop(address, None)
        
        if self._ws and not self._ws.closed:
            await self._send_unsubscribe(address)
        
        logger.info(f"Unsubscribed from balance for {address}")
    
    async def _send_subscribe(self, address: str):
        """Send subscribe message for an address"""
        try:
            msg = {
                "method": "subscribe",
                "subscription": {
                    "type": "user",
                    "user": address
                }
            }
            await self._ws.send_json(msg)
            logger.debug(f"Sent subscribe for {address}")
        except Exception as e:
            logger.error(f"Failed to subscribe to {address}: {e}")
    
    async def _send_unsubscribe(self, address: str):
        """Send unsubscribe message for an address"""
        try:
            msg = {
                "method": "unsubscribe",
                "subscription": {
                    "type": "user",
                    "user": address
                }
            }
            await self._ws.send_json(msg)
        except Exception as e:
            logger.error(f"Failed to unsubscribe from {address}: {e}")
    
    async def _run_ws(self):
        """Main WebSocket connection loop"""
        import aiohttp

        # Hyperliquid WebSocket URL
        ws_url = "wss://api.hyperliquid.xyz/ws"

        while self._running:
            try:
                self._session = aiohttp.ClientSession()
                async with self._session.ws_connect(ws_url) as ws:
                    self._ws = ws
                    logger.info("Connected to Hyperliquid user state WebSocket")
                    
                    # Re-subscribe to all known users
                    for address in list(self._subscriptions):
                        await self._send_subscribe(address)
                    
                    # Listen for messages
                    async for msg in ws:
                        if not self._running:
                            break
                        
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                data = msg.json()
                                await self._handle_message(data)
                            except Exception as e:
                                logger.error(f"Error parsing WS message: {e}")
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            logger.error(f"WebSocket error: {msg.data}")
                            break
                        elif msg.type == aiohttp.WSMsgType.CLOSE:
                            logger.warning("WebSocket closed, reconnecting...")
                            break
                            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"WS error: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)
            
            # Brief delay before reconnecting
            if self._running:
                await asyncio.sleep(1)
        
        if self._session:
            await self._session.close()
    
    async def _handle_message(self, data: dict):
        """Handle incoming user state message"""
        try:
            # Hyperliquid sends user updates with the address as key
            # Format: {"user": "0x...", "data": {...}} or direct user data
            
            if isinstance(data, dict):
                # Extract user address and data
                user_address = data.get("user", "").lower()
                
                if not user_address:
                    return
                
                # Get the user data
                user_data = data.get("data", data)
                
                if not user_data:
                    return
                
                # Extract balance from margin summary
                margin_summary = user_data.get("marginSummary", {})
                
                if margin_summary:
                    balance = {
                        "total_equity": float(margin_summary.get("accountValue", 0)),
                        "available_balance": float(margin_summary.get("availableMargin", 0)),
                        "total_margin": float(margin_summary.get("totalMargin", 0)),
                        "currency": "USDC",
                        "address": user_address
                    }
                    
                    # Store balance
                    user_balance_store.set_balance(user_address, balance)
                    
                    # Broadcast to specific user via WebSocket
                    await self._broadcast_to_user(user_address, balance)
                    
                    logger.debug(f"Balance update for {user_address[:10]}...: {balance['total_equity']}")
                    
        except Exception as e:
            logger.error(f"Error handling user message: {e}")
    
    async def _broadcast_to_user(self, address: str, balance: dict):
        """Broadcast balance update to specific user"""
        from src.ws_manager import manager
        
        user_id = self._address_to_user_id.get(address.lower())
        
        if user_id:
            # Send to authenticated user
            await manager.send_to_user(user_id, {
                "type": "balance_update",
                "data": balance
            })


# Singleton
user_balance_ws = UserBalanceWebSocket()


async def fetch_user_balance(address: str) -> dict:
    """
    Fetch user balance - returns cached if available, otherwise fetches fresh.
    """
    # First check cache
    cached = user_balance_store.get_balance(address)
    if cached:
        return cached
    
    # Fetch fresh from REST API
    from main import manager
    
    try:
        hl_client = manager.hl_client
        if not hl_client:
            return {"total_equity": 0, "available_balance": 0, "error": "Client not initialized"}
        
        user_state = hl_client.get_user_state(address)
        
        if not user_state:
            return {"total_equity": 0, "available_balance": 0, "error": "Could not fetch state"}
        
        margin_summary = user_state.get("marginSummary", {})
        
        balance = {
            "total_equity": float(margin_summary.get("accountValue", 0)),
            "available_balance": float(margin_summary.get("availableMargin", 0)),
            "total_margin": float(margin_summary.get("totalMargin", 0)),
            "currency": "USDC",
            "address": address
        }
        
        user_balance_store.set_balance(address, balance)
        return balance
        
    except Exception as e:
        logger.error(f"Error fetching balance for {address}: {e}")
        return {"total_equity": 0, "available_balance": 0, "error": str(e)}
