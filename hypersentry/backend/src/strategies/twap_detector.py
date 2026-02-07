import asyncio
import logging
import aiohttp
from typing import List, Set, Dict, Optional
from datetime import datetime
from collections import deque, defaultdict
from sqlalchemy.orm import Session
from src.notifications import TelegramBot
from models import User, UserTwap, Wallet
from database import get_db_session

logger = logging.getLogger("TwapDetector")

# Dynamic Asset ID to Symbol mapping (populated from Hyperliquid API)
# Perps use index 0-255, Spot uses 10000+, etc.
ASSET_ID_MAP = {}  # Will be populated dynamically

async def fetch_asset_mapping() -> Dict[int, str]:
    """Fetch the current asset ID to symbol mapping from Hyperliquid."""
    mapping = {}
    try:
        async with aiohttp.ClientSession() as session:
            # Fetch perp universe
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "meta"},
                headers={"Content-Type": "application/json"}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    universe = data.get("universe", [])
                    for i, token in enumerate(universe):
                        name = token.get("name", f"PERP_{i}")
                        mapping[i] = name
                    logger.info(f"📊 Loaded {len(universe)} perp asset mappings")
            
            # Fetch spot universe  
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "spotMeta"},
                headers={"Content-Type": "application/json"}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    tokens = data.get("tokens", [])
                    for token in tokens:
                        idx = token.get("index", 0)
                        name = token.get("name", f"SPOT_{idx}")
                        # Spot tokens are at 10000 + index typically
                        mapping[10000 + idx] = f"@{name}"
                        # Some spots have different ID schemes (110xxx etc)
                        if idx < 1000:
                            mapping[110000 + idx] = f"@{name}"
                    logger.info(f"📊 Loaded {len(tokens)} spot asset mappings")
                    
    except Exception as e:
        logger.error(f"Failed to fetch asset mapping: {e}")
        # Fallback to some common ones
        mapping = {
            0: "BTC", 1: "ETH", 2: "ATOM", 3: "MATIC", 4: "DYDX", 5: "SOL", 
            6: "AVAX", 7: "BNB", 8: "APE", 9: "OP", 10: "LTC", 11: "ARB",
            12: "DOGE", 13: "INJ", 14: "SUI", 18: "LINK", 25: "XRP",
            110000: "@BTC", 110001: "@ETH", 110002: "@SOL", 110003: "@HYPE",
        }
    return mapping

def get_token_symbol(asset_id: int) -> str:
    """Convert asset ID to human-readable symbol."""
    if asset_id in ASSET_ID_MAP:
        return ASSET_ID_MAP[asset_id]
    # Guess based on ranges
    if 110000 <= asset_id < 200000:
        return f"SPOT_{asset_id}"
    return f"PERP_{asset_id}"


class TwapDetector:
    """
    TWAP Detector using HypurrScan API (Stage 1).
    
    Polls https://api.hypurrscan.io/twap/* every 30 seconds for all active TWAPs globally.
    Filters and alerts based on user-watched tokens.
    """
    
    HYPURRSCAN_API = "https://api.hypurrscan.io/twap/*"
    POLL_INTERVAL = 30  # seconds
    
    def __init__(self, notifier: TelegramBot):
        self.notifier = notifier
        self.watched_tokens: Set[str] = set()
        self.seen_hashes: Set[str] = set()  # Track alerted TWAPs to avoid duplicates
        self.active_twaps: Dict[str, List[Dict]] = {}  # {token: [twap_data, ...]}
        self.all_active_twaps: List[Dict] = []  # All active TWAPs (for frontend)
        self.is_running = False
        self.min_size_usd = 10000.0  # Minimum size to alert
        
        # Time-series history for charts
        self.twap_history: Dict[str, deque] = {}
        self.MAX_HISTORY_POINTS = 2880  # ~24h at 30s intervals
        
        self.session: Optional[aiohttp.ClientSession] = None

    async def start(self):
        """Main loop: Poll HypurrScan API for active TWAPs."""
        global ASSET_ID_MAP
        self.is_running = True
        
        # Fetch asset mapping on startup
        ASSET_ID_MAP = await fetch_asset_mapping()
        logger.info(f"📡 TWAP Detector Started (HypurrScan API Mode) - {len(ASSET_ID_MAP)} assets mapped")
        
        while self.is_running:
            try:
                # 1. Sync watched tokens from DB
                await self._sync_watched_tokens()
                
                # 2. Fetch all active TWAPs from HypurrScan
                all_twaps = await self._fetch_all_twaps()
                
                if all_twaps is None:
                    logger.warning("Failed to fetch TWAPs, retrying in 10s...")
                    await asyncio.sleep(10)
                    continue
                
                # 3. Filter for ACTIVE TWAPs (no 'ended' field)
                active_twaps = [t for t in all_twaps if not t.get("ended")]
                logger.info(f"📊 Found {len(active_twaps)} active TWAPs globally")
                
                # 4. Process and organize by token
                await self._process_twaps(active_twaps)
                
                # 5. Wait before next poll
                await asyncio.sleep(self.POLL_INTERVAL)
                
            except Exception as e:
                logger.error(f"TWAP polling error: {e}")
                await asyncio.sleep(10)
        
        # Cleanup
        if self.session:
            await self.session.close()

    async def _sync_watched_tokens(self):
        """Sync watched tokens from database."""
        try:
            with get_db_session() as db:
                user_twaps = db.query(UserTwap.token).distinct().all()
                self.watched_tokens = {t[0].upper() for t in user_twaps}
        except Exception as e:
            logger.error(f"Failed to sync watched tokens: {e}")

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session

    async def _fetch_all_twaps(self) -> Optional[List[Dict]]:
        """Fetch all TWAPs from HypurrScan API."""
        try:
            session = await self._get_session()
            async with session.get(self.HYPURRSCAN_API, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200:
                    logger.error(f"HypurrScan API returned {resp.status}")
                    return None
                return await resp.json()
        except Exception as e:
            logger.error(f"Error fetching from HypurrScan: {e}")
            return None

    async def _fetch_prices(self) -> Dict[str, float]:
        """Fetch current prices from Hyperliquid API."""
        try:
            session = await self._get_session()
            async with session.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "allMids"},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception as e:
            logger.warning(f"Failed to fetch prices: {e}")
        return {}

    async def _process_twaps(self, active_twaps: List[Dict]):
        """Process active TWAPs, organize by token, and send alerts."""
        # Reset state
        self.active_twaps = {}
        self.all_active_twaps = []
        
        # Fetch current prices for USD conversion
        prices = await self._fetch_prices()
        
        for twap in active_twaps:
            try:
                user = twap.get("user", "")
                action = twap.get("action", {})
                twap_info = action.get("twap", {})
                
                # Extract fields
                asset_id = twap_info.get("a", 0)
                is_buy = twap_info.get("b", True)
                size_str = twap_info.get("s", "0")
                duration_mins = twap_info.get("m", 0)
                reduce_only = twap_info.get("r", False)
                is_perp = twap_info.get("t", False)  # t=True means perp
                
                # Parse size (could be string or number)
                try:
                    size_raw = float(size_str)
                except:
                    size_raw = 0
                
                # Get token symbol
                token = get_token_symbol(asset_id)
                
                # Convert to USD
                # - Perp orders (t=True): size is already in USD notional
                # - Spot orders (t=False): size is in token units, multiply by price
                if is_perp:
                    size_usd = size_raw
                else:
                    # Try to get price for this token
                    base_token = token.replace("@", "").split("/")[0].upper()
                    price = float(prices.get(base_token, 0))
                    size_usd = size_raw * price if price > 0 else size_raw
                
                # Build normalized entry
                entry = {
                    "user": user,
                    "token": token,
                    "asset_id": asset_id,
                    "hash": twap.get("hash", ""),
                    "time": twap.get("time", 0),
                    "size_usd": size_usd,
                    "is_buy": is_buy,
                    "is_perp": is_perp,
                    "duration_mins": duration_mins,
                    "reduce_only": reduce_only,
                    "block": twap.get("block", 0),
                    # Keep original for compatibility
                    "action": action
                }
                
                # Add to all active
                self.all_active_twaps.append(entry)
                
                # Organize by token
                if token not in self.active_twaps:
                    self.active_twaps[token] = []
                self.active_twaps[token].append(entry)
                
                # Check if we should alert (new TWAP for watched token)
                await self._maybe_alert(entry)
                
            except Exception as e:
                logger.error(f"Error processing TWAP entry: {e}")
                continue
        
        # Update history for charts
        self._update_history()

    async def _maybe_alert(self, entry: Dict):
        """Send alert if this is a new TWAP for a watched token."""
        token = entry["token"]
        twap_hash = entry["hash"]
        size_usd = entry["size_usd"]
        
        # Check if already alerted
        if twap_hash in self.seen_hashes:
            return
        
        # Check size threshold
        if size_usd < self.min_size_usd:
            return
        
        # Check if token is watched (match base token)
        # Handle cases like "HYPE" matching "@HYPE" or "HYPE/USDC"
        base_token = token.replace("@", "").split("/")[0].upper()
        is_watched = any(
            base_token == w.upper() or token.upper() == w.upper()
            for w in self.watched_tokens
        )
        
        if not is_watched:
            return
        
        # Mark as seen
        self.seen_hashes.add(twap_hash)
        
        # Build and send alert
        side_str = "BUY" if entry["is_buy"] else "SELL"
        side_icon = "🟢" if entry["is_buy"] else "🔴"
        reduce_str = " (Reduce Only)" if entry["reduce_only"] else ""
        
        msg = (
            f"🚨 <b>Active TWAP Detected</b>\n\n"
            f"🕵️ <b>Wallet:</b> <code>{entry['user']}</code>\n"
            f"{side_icon} <b>{side_str} {token}</b>{reduce_str}\n"
            f"💰 <b>Size:</b> ${size_usd:,.0f}\n"
            f"⏱️ <b>Duration:</b> {entry['duration_mins']}m\n"
            f"━━━━━━━━━━━━\n"
            f"<i>Source: HypurrScan Verified</i>"
        )
        
        # Send to all users watching this token
        try:
            with get_db_session() as db:
                # Find users watching this token
                watchers = db.query(User, UserTwap).join(UserTwap).filter(
                    UserTwap.token.ilike(f"%{base_token}%")
                ).all()
                
                sent = set()
                for user, _ in watchers:
                    if user.telegram_chat_id and user.id not in sent:
                        await self.notifier.send_message(msg, chat_id=user.telegram_chat_id)
                        sent.add(user.id)
                        logger.info(f"🔔 Alerted user {user.email} about {side_str} {token}")
                        
        except Exception as e:
            logger.error(f"Failed to send TWAP alert: {e}")

    def _update_history(self):
        """Update time-series history for charts."""
        now = datetime.now().timestamp() * 1000
        
        for token, twaps in self.active_twaps.items():
            if token not in self.twap_history:
                self.twap_history[token] = deque(maxlen=self.MAX_HISTORY_POINTS)
            
            buy_total = sum(t["size_usd"] for t in twaps if t["is_buy"])
            sell_total = sum(t["size_usd"] for t in twaps if not t["is_buy"])
            
            self.twap_history[token].append({
                "timestamp": now,
                "buy_total": buy_total,
                "sell_total": sell_total,
                "net_delta": buy_total - sell_total,
                "active_count": len(twaps)
            })

    def get_active_twaps(self, token: Optional[str] = None) -> List[Dict]:
        """Get active TWAPs, optionally filtered by token."""
        if token:
            return self.active_twaps.get(token.upper(), [])
        return self.all_active_twaps

    def get_history(self, token: str) -> List[Dict]:
        """Get time-series history for a token."""
        return list(self.twap_history.get(token.upper(), []))

    def stop(self):
        """Stop the detector."""
        self.is_running = False
        logger.info("TWAP Detector stopped")

    async def scan_once(self, tokens: List[str] = None) -> Dict[str, List[Dict]]:
        """Run a single scan (for API endpoint compatibility)."""
        global ASSET_ID_MAP
        
        # Ensure asset mapping is loaded
        if not ASSET_ID_MAP:
            ASSET_ID_MAP = await fetch_asset_mapping()
            
        all_twaps = await self._fetch_all_twaps()
        if all_twaps:
            active = [t for t in all_twaps if not t.get("ended")]
            await self._process_twaps(active)
        return self.active_twaps
    
    def add_token(self, token: str):
        """Add a token to watched list."""
        self.watched_tokens.add(token.upper())
        logger.info(f"Added {token.upper()} to TWAP watch list")
    
    def get_active_users(self, token: str) -> Dict[str, List[Dict]]:
        """Get active TWAP users for a specific token, organized by side."""
        token_upper = token.upper()
        base_token = token_upper.replace("@", "").split("/")[0]
        
        buyers = []
        sellers = []
        
        # Check all tokens that match (handle HYPE, @HYPE, HYPE/USDC etc)
        for stored_token, twaps in self.active_twaps.items():
            stored_base = stored_token.replace("@", "").split("/")[0].upper()
            if stored_base == base_token or stored_token.upper() == token_upper:
                for twap in twaps:
                    entry = {
                        "address": twap.get("user", ""),
                        "size": twap.get("size_usd", 0),
                        "duration": twap.get("duration_mins", 0),
                        "hash": twap.get("hash", ""),
                        "started": twap.get("time", 0),
                    }
                    if twap.get("is_buy", True):
                        buyers.append(entry)
                    else:
                        sellers.append(entry)
        
        # Sort by size descending
        buyers.sort(key=lambda x: x["size"], reverse=True)
        sellers.sort(key=lambda x: x["size"], reverse=True)
        
        return {"buyers": buyers, "sellers": sellers}
    
    def get_all_tokens_summary(self) -> List[Dict]:
        """Get summary of all tokens with active TWAPs."""
        summaries = []
        
        for token, twaps in self.active_twaps.items():
            buy_volume = sum(t.get("size_usd", 0) for t in twaps if t.get("is_buy", True))
            sell_volume = sum(t.get("size_usd", 0) for t in twaps if not t.get("is_buy", True))
            
            summaries.append({
                "token": token,
                "buy_volume": buy_volume,
                "sell_volume": sell_volume,
                "net_delta": buy_volume - sell_volume,
                "active_count": len(twaps),
                "buyers_count": sum(1 for t in twaps if t.get("is_buy", True)),
                "sellers_count": sum(1 for t in twaps if not t.get("is_buy", True)),
                "sentiment": "accumulating" if buy_volume > sell_volume * 1.2 else 
                            "distributing" if sell_volume > buy_volume * 1.2 else "neutral"
            })
        
        # Sort by total volume
        summaries.sort(key=lambda x: x["buy_volume"] + x["sell_volume"], reverse=True)
        return summaries

    async def handle_user_event(self, data: Dict):
        """Stub for compatibility - not used in API mode."""
        pass

    async def handle_trade(self, data: Dict):
        """Stub for compatibility - not used in API mode."""
        pass
