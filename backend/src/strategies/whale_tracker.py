"""
Whale Wallet Tracker — The #1 Alpha Generator for Hyperliquid

Monitors the top profitable traders on Hyperliquid and detects position changes
in real-time. Since Hyperliquid is fully on-chain, every position is publicly
queryable — this is the single biggest information asymmetry in DeFi perps.

Data flow:
1. On startup: fetch the leaderboard to seed the whale registry
2. Every 15 seconds: poll each whale's clearinghouse state
3. Detect deltas: new positions, closes, size increases/decreases
4. Emit alerts via WebSocket + store for API consumption
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Set
from datetime import datetime
import aiohttp
from aiohttp import ClientConnectorError

logger = logging.getLogger("WhaleTracker")


class WhalePosition:
    """Snapshot of a single position held by a whale."""
    def __init__(self, coin: str, size: float, entry_px: float, unrealized_pnl: float, 
                 leverage: float, side: str, liquidation_px: float = 0):
        self.coin = coin
        self.size = size
        self.entry_px = entry_px
        self.unrealized_pnl = unrealized_pnl
        self.leverage = leverage
        self.side = side  # "long" or "short"
        self.liquidation_px = liquidation_px


class WhaleProfile:
    """A tracked whale wallet with metadata and position history."""
    def __init__(self, address: str, pnl: float = 0, win_rate: float = 0, 
                 label: str = "", rank: int = 0):
        self.address = address
        self.label = label or f"Whale #{rank}"
        self.pnl = pnl
        self.win_rate = win_rate
        self.rank = rank
        self.positions: Dict[str, WhalePosition] = {}  # coin -> position
        self.last_updated = 0
        self.account_value = 0


class WhaleAlert:
    """An alert generated when a whale makes a significant move."""
    def __init__(self, address: str, label: str, event_type: str, coin: str, 
                 side: str, size: float, entry_px: float, leverage: float = 0,
                 old_size: float = 0, pnl: float = 0):
        self.id = f"{address[:8]}_{coin}_{int(time.time()*1000)}"
        self.address = address
        self.label = label
        self.event_type = event_type  # "open", "close", "increase", "decrease", "flip"
        self.coin = coin
        self.side = side
        self.size = size
        self.entry_px = entry_px
        self.leverage = leverage
        self.old_size = old_size
        self.pnl = pnl
        self.timestamp = int(time.time() * 1000)
        self.time_str = datetime.now().strftime('%H:%M:%S')

    def to_dict(self):
        notional = abs(self.size * self.entry_px)
        return {
            "id": self.id,
            "address": self.address,
            "addressShort": f"{self.address[:6]}...{self.address[-4:]}",
            "label": self.label,
            "event": self.event_type,
            "coin": self.coin,
            "side": self.side,
            "size": self.size,
            "notionalUsd": notional,
            "entryPrice": self.entry_px,
            "leverage": self.leverage,
            "oldSize": self.old_size,
            "pnl": self.pnl,
            "timestamp": self.timestamp,
            "timeStr": self.time_str,
            "significance": self._score_significance(notional),
        }

    def _score_significance(self, notional: float) -> str:
        """Score how significant this move is."""
        if notional >= 5_000_000:
            return "legendary"
        elif notional >= 1_000_000:
            return "massive"
        elif notional >= 500_000:
            return "large"
        elif notional >= 100_000:
            return "notable"
        return "standard"


class WhaleTracker:
    """
    Real-time whale position tracker for Hyperliquid.
    
    Monitors the top N most profitable traders and detects
    position changes as they happen.
    """
    
    CLEARINGHOUSE_URL = "https://api.hyperliquid.xyz/info"
    LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
    
    def __init__(self, max_whales: int = 50, poll_interval: int = 60, 
                 min_notional: float = 50_000, notifier=None):
        """
        Args:
            max_whales: Number of top traders to track
            poll_interval: Seconds between position checks (increased to 60s to avoid 429)
            min_notional: Minimum USD notional to trigger an alert
            notifier: Optional TelegramBot for push alerts
        """
        self.max_whales = max_whales
        # Protect upstream APIs from burst loops caused by low env values.
        self.poll_interval = max(30, int(poll_interval))
        self.min_notional = min_notional
        self.notifier = notifier
        
        self.whales: Dict[str, WhaleProfile] = {}
        self.alerts: List[dict] = []  # Recent alerts (max 500)
        self.is_running = False
        self._initialized = False
        self.session: Optional[aiohttp.ClientSession] = None
        self._stats = {
            "total_alerts": 0,
            "last_scan_time": 0,
            "scan_count": 0,
            "tracked_wallets": 0,
        }
        self._rate_limited_until = 0.0

    async def start(self):
        """Start the whale tracking loop."""
        self.is_running = True
        logger.info(f"🐋 Whale Tracker starting — tracking top {self.max_whales} wallets (Poll: {self.poll_interval}s)")
        
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30),
            headers={"Content-Type": "application/json"}
        ) as session:
            self.session = session
            
            # Phase 1: Seed whale registry from leaderboard
            await self._seed_whales()
            
            if not self.whales:
                logger.warning("No whales loaded from leaderboard. Retrying in 30s...")
                await asyncio.sleep(30)
                await self._seed_whales()
            
            if not self.whales:
                logger.error("Failed to load whales after retry. Will keep trying...")
            
            # Phase 2: Get initial positions (no alerts for existing positions)
            if self.whales:
                await self._scan_all_positions(initial=True)
                self._initialized = True
                logger.info(f"🐋 Initialized {len(self.whales)} whales with existing positions")
            
            # Phase 3: Continuous monitoring
            while self.is_running:
                try:
                    # Re-seed periodically if we have no whales
                    if not self.whales:
                        await self._seed_whales()
                        if self.whales:
                            await self._scan_all_positions(initial=True)
                            self._initialized = True
                        else:
                            await asyncio.sleep(60)
                            continue
                    
                    scan_start = time.time()
                    await self._scan_all_positions(initial=False)
                    scan_duration = time.time() - scan_start
                    
                    self._stats["last_scan_time"] = round(scan_duration, 2)
                    self._stats["scan_count"] += 1
                    self._stats["tracked_wallets"] = len(self.whales)
                    
                    # Adaptive polling: if scan was slow, wait less
                    wait_time = max(5, self.poll_interval - scan_duration)
                    await asyncio.sleep(wait_time)
                    
                except Exception as e:
                    logger.error(f"Whale scan error: {e}")
                    await asyncio.sleep(30)
    
    async def _seed_whales(self):
        """Fetch the Hyperliquid leaderboard to identify top traders."""
        try:
            logger.info("🐋 Fetching leaderboard from stats-data.hyperliquid.xyz...")
            
            # GET request to the stats-data leaderboard endpoint
            async with self.session.get(
                self.LEADERBOARD_URL,
                timeout=aiohttp.ClientTimeout(total=20)
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.warning(f"Leaderboard API returned {resp.status}: {body[:200]}")
                    return
                
                data = await resp.json()
            
            # Extract leaderboardRows
            rows = data.get("leaderboardRows", []) if isinstance(data, dict) else data
            
            if not rows:
                logger.warning("Leaderboard returned empty rows")
                return
            
            logger.info(f"🐋 Leaderboard returned {len(rows)} traders")
            
            # Parse performance data and sort by all-time PnL
            parsed_traders = []
            for row in rows:
                address = row.get("ethAddress", "")
                if not address:
                    continue
                
                # Parse windowPerformances: list of [window_name, {pnl, roi, vlm}]
                window_perf = {}
                for wp in row.get("windowPerformances", []):
                    if isinstance(wp, (list, tuple)) and len(wp) == 2:
                        window_perf[wp[0]] = wp[1]
                
                # Get PnL values for different time windows
                all_time = window_perf.get("allTime", {})
                month = window_perf.get("month", {})
                week = window_perf.get("week", {})
                day = window_perf.get("day", {})
                
                all_time_pnl = float(all_time.get("pnl", 0))
                month_pnl = float(month.get("pnl", 0))
                week_pnl = float(week.get("pnl", 0))
                day_pnl = float(day.get("pnl", 0))
                account_value = float(row.get("accountValue", 0))
                display_name = row.get("displayName", "")
                
                # Only track traders with meaningful account value
                if account_value < 10_000:
                    continue
                
                parsed_traders.append({
                    "address": address,
                    "allTimePnl": all_time_pnl,
                    "monthPnl": month_pnl,
                    "weekPnl": week_pnl,
                    "dayPnl": day_pnl,
                    "accountValue": account_value,
                    "displayName": display_name,
                    "roi": float(all_time.get("roi", 0)),
                    "volume": float(all_time.get("vlm", 0)),
                })
            
            # ── Filter out Market Makers ──
            # MMs have extremely high volume relative to PnL (earning rebates, not alpha)
            # Smart directional traders have higher ROI per unit of volume
            smart_traders = []
            for t in parsed_traders:
                pnl = abs(t["allTimePnl"]) if t["allTimePnl"] != 0 else 1
                volume = t["volume"] if t["volume"] > 0 else 1
                volume_to_pnl = volume / pnl
                
                # MM heuristics:
                # 1. Volume > 100x PnL → almost certainly MM (rebate farming)
                # 2. Very low absolute ROI despite huge volume → systematic MM
                is_likely_mm = (
                    volume_to_pnl > 100 or
                    (volume > 50_000_000 and abs(t["roi"]) < 0.05)
                )
                
                if is_likely_mm:
                    logger.debug(f"Filtered MM: {t['address'][:10]}... vol/pnl={volume_to_pnl:.0f}x, roi={t['roi']:.2%}")
                    continue
                
                # Smart trader composite score:
                # 40% ROI (alpha efficiency), 30% recent performance, 30% all-time PnL
                account_value = t["accountValue"]
                roi_score = min(t["roi"], 5.0) / 5.0  # cap at 500% ROI
                recent_score = (t["weekPnl"] + t["monthPnl"]) / max(account_value, 1)
                recent_score = max(0, min(recent_score, 2.0)) / 2.0
                pnl_score = min(t["allTimePnl"], 10_000_000) / 10_000_000
                
                t["smart_score"] = (roi_score * 0.4) + (recent_score * 0.3) + (pnl_score * 0.3)
                smart_traders.append(t)
            
            logger.info(f"🐋 Filtered {len(parsed_traders) - len(smart_traders)} likely MMs, {len(smart_traders)} smart traders remain")
            
            # Sort by smart_score descending (not raw PnL)
            smart_traders.sort(key=lambda x: x["smart_score"], reverse=True)
            
            for i, trader in enumerate(smart_traders[:self.max_whales]):
                address = trader["address"]
                pnl = trader["allTimePnl"]
                display_name = trader["displayName"]
                
                profile = WhaleProfile(
                    address=address,
                    pnl=pnl,
                    win_rate=trader["roi"],
                    label=display_name if display_name else f"Top #{i+1}",
                    rank=i + 1
                )
                # Store extended performance data on the profile
                profile.account_value = trader["accountValue"]
                profile.month_pnl = trader["monthPnl"]
                profile.week_pnl = trader["weekPnl"]
                profile.day_pnl = trader["dayPnl"]
                profile.volume = trader["volume"]
                
                self.whales[address] = profile
            
            logger.info(f"🐋 Loaded {len(self.whales)} smart traders from leaderboard (MM-filtered, scored by alpha)")
            if self.whales:
                top_whale = list(self.whales.values())[0]
                logger.info(f"🐋 #1: {top_whale.label} — ${top_whale.pnl:,.0f} PnL, ${top_whale.account_value:,.0f} AV")
                
        except Exception as e:
            logger.error(f"Failed to seed whales: {e}", exc_info=True)
    
    async def _scan_all_positions(self, initial: bool = False):
        """Scan all tracked whales for position changes."""
        if time.time() < self._rate_limited_until:
            return

        # Process in batches to avoid rate limiting
        whale_list = list(self.whales.values())
        batch_size = 4

        for i in range(0, len(whale_list), batch_size):
            if time.time() < self._rate_limited_until:
                break

            batch = whale_list[i:i+batch_size]
            tasks = [self._check_whale(whale, initial) for whale in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            rate_limited_hits = sum(1 for r in results if r is True)
            if rate_limited_hits > 0:
                cooldown = min(30.0, 4.0 + (2.0 * rate_limited_hits))
                self._rate_limited_until = max(self._rate_limited_until, time.time() + cooldown)
                logger.warning("WhaleTracker cooldown %.1fs after %s rate-limited checks", cooldown, rate_limited_hits)
                break
            
            # Delay between batches
            if i + batch_size < len(whale_list):
                await asyncio.sleep(2.5)
    
    async def _check_whale(self, whale: WhaleProfile, initial: bool = False):
        """Check a single whale's position and detect changes."""
        try:
            payload = {
                "type": "clearinghouseState",
                "user": whale.address
            }
            
            async with self.session.post(
                self.CLEARINGHOUSE_URL, json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 429:
                    logger.warning(f"Rate limited checking {whale.address[:8]}...")
                    return True
                if resp.status != 200:
                    return False
                
                data = await resp.json()
            
            # Parse positions
            asset_positions = data.get("assetPositions", [])
            current_positions: Dict[str, WhalePosition] = {}
            
            for ap in asset_positions:
                pos = ap.get("position", {})
                coin = pos.get("coin", "")
                size = float(pos.get("szi", 0))
                
                if abs(size) < 1e-10 or not coin:
                    continue
                
                entry_px = float(pos.get("entryPx", 0))
                unrealized_pnl = float(pos.get("unrealizedPnl", 0))
                leverage_val = float(pos.get("leverage", {}).get("value", 1)) if isinstance(pos.get("leverage"), dict) else float(pos.get("leverage", 1))
                liq_px = float(pos.get("liquidationPx", 0) or 0)
                
                side = "long" if size > 0 else "short"
                
                current_positions[coin] = WhalePosition(
                    coin=coin,
                    size=abs(size),
                    entry_px=entry_px,
                    unrealized_pnl=unrealized_pnl,
                    leverage=leverage_val,
                    side=side,
                    liquidation_px=liq_px
                )
            
            # Update account value from live data
            margin_summary = data.get("marginSummary", {})
            live_account_value = float(margin_summary.get("accountValue", 0))
            if live_account_value > 0:
                whale.account_value = live_account_value
            
            # Detect changes (skip on initial scan)
            if not initial:
                self._detect_changes(whale, current_positions)
            
            # Update stored positions
            whale.positions = current_positions
            whale.last_updated = int(time.time() * 1000)
            return False
            
        except asyncio.TimeoutError:
            logger.debug(f"Timeout checking whale {whale.address[:8]}...")
            return False
        except ClientConnectorError as e:
            # Connection reset (Errno 54) or similar
            logger.warning(f"Connection error checking whale {whale.address[:8]}: {e}. Retrying next cycle.")
            await asyncio.sleep(1) # Backoff slightly
            return False
        except Exception as e:
            logger.error(f"Error checking whale {whale.address[:8]}: {e}")
            return False
    
    def _detect_changes(self, whale: WhaleProfile, current: Dict[str, WhalePosition]):
        """Compare current vs previous positions and generate alerts."""
        old = whale.positions
        
        # Check for new positions and changes to existing ones
        for coin, new_pos in current.items():
            old_pos = old.get(coin)
            notional = new_pos.size * new_pos.entry_px
            
            if notional < self.min_notional:
                continue
            
            if old_pos is None:
                # NEW POSITION
                alert = WhaleAlert(
                    address=whale.address,
                    label=whale.label,
                    event_type="open",
                    coin=coin,
                    side=new_pos.side,
                    size=new_pos.size,
                    entry_px=new_pos.entry_px,
                    leverage=new_pos.leverage,
                )
                self._emit_alert(alert)
                
            elif old_pos.side != new_pos.side:
                # FLIPPED DIRECTION (closed + reopened opposite)
                alert = WhaleAlert(
                    address=whale.address,
                    label=whale.label,
                    event_type="flip",
                    coin=coin,
                    side=new_pos.side,
                    size=new_pos.size,
                    entry_px=new_pos.entry_px,
                    leverage=new_pos.leverage,
                    old_size=old_pos.size,
                )
                self._emit_alert(alert)
                
            elif abs(new_pos.size - old_pos.size) / max(old_pos.size, 0.01) > 0.05:
                # SIGNIFICANT SIZE CHANGE (>5%)
                if new_pos.size > old_pos.size:
                    event = "increase"
                else:
                    event = "decrease"
                
                alert = WhaleAlert(
                    address=whale.address,
                    label=whale.label,
                    event_type=event,
                    coin=coin,
                    side=new_pos.side,
                    size=new_pos.size,
                    entry_px=new_pos.entry_px,
                    leverage=new_pos.leverage,
                    old_size=old_pos.size,
                )
                self._emit_alert(alert)
        
        # Check for closed positions
        for coin, old_pos in old.items():
            if coin not in current:
                notional = old_pos.size * old_pos.entry_px
                if notional < self.min_notional:
                    continue
                
                alert = WhaleAlert(
                    address=whale.address,
                    label=whale.label,
                    event_type="close",
                    coin=coin,
                    side=old_pos.side,
                    size=0,
                    entry_px=old_pos.entry_px,
                    old_size=old_pos.size,
                    pnl=old_pos.unrealized_pnl,
                )
                self._emit_alert(alert)
    
    def _emit_alert(self, alert: WhaleAlert):
        """Process and store a new alert."""
        alert_dict = alert.to_dict()
        self.alerts.insert(0, alert_dict)
        
        # Keep max 500 alerts
        if len(self.alerts) > 500:
            self.alerts = self.alerts[:500]
        
        self._stats["total_alerts"] += 1
        
        # Log it
        emoji = {
            "open": "🟢", "close": "🔴", "increase": "⬆️", 
            "decrease": "⬇️", "flip": "🔄"
        }.get(alert.event_type, "📊")
        
        notional = abs(alert.size * alert.entry_px)
        logger.info(
            f"{emoji} {alert.label}: {alert.event_type.upper()} "
            f"{alert.coin} {alert.side} ${notional:,.0f} "
            f"@ ${alert.entry_px:,.2f}"
        )
        
        # Send Telegram notification for significant alerts
        if self.notifier and alert_dict["significance"] in ("legendary", "massive", "large"):
            asyncio.create_task(self._send_telegram_alert(alert_dict))
    
    async def _send_telegram_alert(self, alert: dict):
        """Send a Telegram notification for a whale alert."""
        try:
            emoji = {
                "open": "🟢 OPENED", "close": "🔴 CLOSED",
                "increase": "⬆️ INCREASED", "decrease": "⬇️ DECREASED",
                "flip": "🔄 FLIPPED"
            }.get(alert["event"], alert["event"].upper())
            
            sig_emoji = {
                "legendary": "🏆", "massive": "💎", "large": "🐋"
            }.get(alert["significance"], "")
            
            msg = (
                f"{sig_emoji} <b>Whale Alert</b> — {alert['coin']}\n\n"
                f"🏷 <b>{alert['label']}</b>\n"
                f"👤 <code>{alert['addressShort']}</code>\n"
                f"━━━━━━━━━━━━\n"
                f"📊 {emoji} <b>{alert['side'].upper()}</b>\n"
                f"💰 Size: ${alert['notionalUsd']:,.0f}\n"
                f"📍 Entry: ${alert['entryPrice']:,.2f}\n"
                f"⚡ Leverage: {alert['leverage']:.0f}x\n"
                f"━━━━━━━━━━━━\n"
                f"⏰ {alert['timeStr']}"
            )
            
            await self.notifier.send_message(msg)
        except Exception as e:
            logger.error(f"Failed to send whale alert telegram: {e}")
    
    # === API Methods ===
    
    def get_alerts(self, limit: int = 50, coin: str = None) -> List[dict]:
        """Get recent whale alerts, optionally filtered by coin."""
        if coin:
            filtered = [a for a in self.alerts if a["coin"].upper() == coin.upper()]
            return filtered[:limit]
        return self.alerts[:limit]
    
    def get_whale_positions(self, address: str = None) -> List[dict]:
        """Get current positions for a specific whale or all whales."""
        results = []
        
        whales_to_check = [self.whales[address]] if address and address in self.whales else self.whales.values()
        
        for whale in whales_to_check:
            for coin, pos in whale.positions.items():
                results.append({
                    "address": whale.address,
                    "addressShort": f"{whale.address[:6]}...{whale.address[-4:]}",
                    "label": whale.label,
                    "rank": whale.rank,
                    "coin": coin,
                    "side": pos.side,
                    "size": pos.size,
                    "notionalUsd": pos.size * pos.entry_px,
                    "entryPrice": pos.entry_px,
                    "unrealizedPnl": pos.unrealized_pnl,
                    "leverage": pos.leverage,
                    "liquidationPrice": pos.liquidation_px,
                    "totalPnl": whale.pnl,
                    "accountValue": whale.account_value,
                })
        
        # Sort by notional value descending
        results.sort(key=lambda x: x["notionalUsd"], reverse=True)
        return results
    
    def get_leaderboard(self) -> List[dict]:
        """Get whale leaderboard data sorted by all-time PnL."""
        results = []
        
        for whale in self.whales.values():
            # Collect coins this whale is trading
            coins = list(whale.positions.keys())
            total_notional = sum(
                pos.size * pos.entry_px for pos in whale.positions.values()
            )
            total_unrealized = sum(
                pos.unrealized_pnl for pos in whale.positions.values()
            )
            
            results.append({
                "address": whale.address,
                "addressShort": f"{whale.address[:6]}...{whale.address[-4:]}",
                "label": whale.label,
                "rank": whale.rank,
                "totalPnl": whale.pnl,
                "accountValue": whale.account_value,
                "monthPnl": getattr(whale, 'month_pnl', 0),
                "weekPnl": getattr(whale, 'week_pnl', 0),
                "dayPnl": getattr(whale, 'day_pnl', 0),
                "roi": getattr(whale, 'win_rate', 0),  # ROI stored as win_rate
                "volume": getattr(whale, 'volume', 0),
                "positionCount": len(whale.positions),
                "totalNotional": total_notional,
                "unrealizedPnl": total_unrealized,
                "coins": coins[:10],
                "lastUpdated": whale.last_updated,
            })
        
        # Sort by all-time PnL descending
        results.sort(key=lambda x: x["totalPnl"], reverse=True)
        return results
    
    def get_whale_summary(self, coin: str = None) -> dict:
        """Aggregate whale positioning for a specific coin or overall."""
        positions = self.get_whale_positions()
        
        if coin:
            positions = [p for p in positions if p["coin"].upper() == coin.upper()]
        
        long_notional = sum(p["notionalUsd"] for p in positions if p["side"] == "long")
        short_notional = sum(p["notionalUsd"] for p in positions if p["side"] == "short")
        long_count = sum(1 for p in positions if p["side"] == "long")
        short_count = sum(1 for p in positions if p["side"] == "short")
        
        total = long_notional + short_notional
        bias = ((long_notional - short_notional) / total * 100) if total > 0 else 0
        
        return {
            "longNotional": long_notional,
            "shortNotional": short_notional,
            "longCount": long_count,
            "shortCount": short_count,
            "totalNotional": total,
            "bias": round(bias, 1),
            "biasLabel": "LONG HEAVY" if bias > 20 else "SHORT HEAVY" if bias < -20 else "BALANCED",
            "topPositions": positions[:10],
            "coin": coin,
        }
    
    def get_stats(self) -> dict:
        """Get tracker statistics."""
        return {
            **self._stats,
            "is_running": self.is_running,
            "initialized": self._initialized,
            "whale_count": len(self.whales),
            "alert_count": len(self.alerts),
            "poll_interval": self.poll_interval,
            "min_notional": self.min_notional,
        }
    
    def stop(self):
        """Stop the whale tracker."""
        self.is_running = False
        logger.info("🐋 Whale Tracker stopped")
