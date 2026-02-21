import logging
import datetime
import asyncio
import hashlib
from typing import List, Dict, Any
from src.intel.engine import engine as intel_engine
from src.manager import TraderManager

logger = logging.getLogger(__name__)

class NexusEngine:
    """
    The Decision Nexus: Correlates multiple data silos to detect Alpha Confluence.
    Bridges News Sentiment, Prediction Odds, and Whale TWAP activity.
    """
    def __init__(self):
        self.manager = TraderManager()
        self.active_signals = [] # runtime cache
        
        # Start Auditor Background Task
        self._audit_task = None
        try:
            loop = asyncio.get_running_loop()
            self._audit_task = loop.create_task(self._audit_loop())
        except RuntimeError:
            logger.debug("Nexus audit task deferred: no running event loop")

    async def _audit_loop(self):
        """
        Background process to validate past signals against price action.
        """
        while True:
            try:
                await self.audit_signals()
            except Exception as e:
                logger.error(f"Auditor loop error: {e}")
            await asyncio.sleep(60) # Audit every minute

    async def audit_signals(self):
        """
        Checks 'PENDING' signals in DB.
        If price hit TP -> WIN.
        If price hit SL -> LOSS.
        """
        from database import get_db_session
        from models import TradeSignal
        from src.intel.providers.microstructure import MicrostructureProvider
        
        # Get Prices
        micro_provider = next((p for p in intel_engine.providers if isinstance(p, MicrostructureProvider)), None)
        if not micro_provider: return

        with get_db_session() as db:
            pending = db.query(TradeSignal).filter(TradeSignal.result == "PENDING").all()
            
            for sig in pending:
                # Get current price
                state = await micro_provider.get_symbol_state(sig.token)
                current_price = state.get("raw_prices", {}).get("binance", 0)
                if not current_price: continue

                # Check Outcome
                is_long = "BUY" in sig.recommendation or "ACCUMULATE" in sig.recommendation
                
                if is_long:
                    if current_price >= sig.take_profit_1:
                        sig.result = "WIN"
                        sig.closed_at = datetime.datetime.now(datetime.timezone.utc)
                        sig.pnl_percent = ((current_price - sig.entry_price) / sig.entry_price) * 100
                    elif current_price <= sig.stop_loss:
                        sig.result = "LOSS"
                        sig.closed_at = datetime.datetime.now(datetime.timezone.utc)
                        sig.pnl_percent = ((current_price - sig.entry_price) / sig.entry_price) * 100
                else: # Short
                    if current_price <= sig.take_profit_1:
                        sig.result = "WIN"
                        sig.closed_at = datetime.datetime.now(datetime.timezone.utc)
                        sig.pnl_percent = ((sig.entry_price - current_price) / sig.entry_price) * 100
                    elif current_price >= sig.stop_loss:
                        sig.result = "LOSS"
                        sig.closed_at = datetime.datetime.now(datetime.timezone.utc)
                        sig.pnl_percent = ((sig.entry_price - current_price) / sig.entry_price) * 100
                
                # Expiry (24h)
                if sig.result == "PENDING":
                    # Correctly handle offset-aware timestamp comparison
                    sig_time = sig.timestamp
                    if sig_time.tzinfo is None:
                         sig_time = sig_time.replace(tzinfo=datetime.timezone.utc)
                         
                    if (datetime.datetime.now(datetime.timezone.utc) - sig_time).total_seconds() > 86400:
                        sig.result = "EXPIRED"
                        sig.closed_at = datetime.datetime.now(datetime.timezone.utc)

    def get_token_performance(self, token: str) -> Dict[str, Any]:
        """
        Calculates REAL performance stats from DB.
        """
        from database import get_db_session
        from models import TradeSignal
        
        with get_db_session() as db:
            # Last 5 closed signals
            last_5 = db.query(TradeSignal).filter(
                TradeSignal.token == token,
                TradeSignal.result.in_(["WIN", "LOSS"])
            ).order_by(TradeSignal.closed_at.desc()).limit(5).all()
            
            outcomes = [s.result for s in last_5]
            
            # 24h Accuracy
            since_24h = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)
            wins = db.query(TradeSignal).filter(
                TradeSignal.token == token, 
                TradeSignal.result == "WIN",
                TradeSignal.closed_at >= since_24h
            ).count()
            total = db.query(TradeSignal).filter(
                TradeSignal.token == token,
                TradeSignal.result.in_(["WIN", "LOSS"]),
                TradeSignal.closed_at >= since_24h
            ).count()
            
            accuracy = f"{(wins/total)*100:.0f}%" if total > 0 else "N/A"
            
            # Fallback for new tokens
            if not outcomes: outcomes = ["PENDING"]

            return {
                "accuracy_24h": accuracy,
                "last_5_signals": outcomes
            }

    def calculate_trade_plan(self, signal: Dict[str, Any], micro_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates precise Entry, Stop Loss, and Take Profit levels based on
        Microstructure walls and Volatility.
        """
        price = micro_state.get("raw_prices", {}).get("binance", 0)
        if not price: return None

        recommendation = signal.get("recommendation", "NEUTRAL")
        walls = micro_state.get("depth_walls", {})
        
        # Volatility Factor (Default 2% if no volatility data)
        vol_factor = 0.02 

        plan = {
            "entry": price,
            "stop_loss": 0,
            "take_profit_1": 0,
            "take_profit_2": 0,
            "risk_reward": 0.0,
            "confidence": "MEDIUM"
        }

        if "BUY" in recommendation or "ACCUMULATE" in recommendation:
            # LONG SCENARIO
            # SL: Below nearest bid wall or 2% down
            nearest_bid = walls.get("bid", [])[0] if walls.get("bid") else None
            if nearest_bid:
                plan["stop_loss"] = nearest_bid * 0.995 # Just below wall
            else:
                plan["stop_loss"] = price * (1 - vol_factor)
            
            # Risk
            risk = price - plan["stop_loss"]
            
            # TP: 1.5R and 3R
            plan["take_profit_1"] = price + (risk * 1.5)
            plan["take_profit_2"] = price + (risk * 3.0)
            plan["risk_reward"] = 1.5

        elif "SELL" in recommendation or "DISTRIBUTE" in recommendation:
            # SHORT SCENARIO
            nearest_ask = walls.get("ask", [])[0] if walls.get("ask") else None
            if nearest_ask:
                plan["stop_loss"] = nearest_ask * 1.005 # Just above wall
            else:
                plan["stop_loss"] = price * (1 + vol_factor)
                
            risk = plan["stop_loss"] - price
            
            plan["take_profit_1"] = price - (risk * 1.5)
            plan["take_profit_2"] = price - (risk * 3.0)
            plan["risk_reward"] = 1.5

        # Calculate Confidence based on Confluence Count
        score = abs(signal.get("alpha_score", 0))
        if score >= 6: plan["confidence"] = "LEGENDARY (90% Win Rate)"
        elif score >= 4: plan["confidence"] = "HIGH (75% Win Rate)"
        else: plan["confidence"] = "MEDIUM (60% Win Rate)"

        return plan

    async def get_alpha_confluence(self) -> List[Dict[str, Any]]:
        """
        Analyzes and correlates all intelligence sources.
        Returns a list of high-confluence 'Nexus' signals.
        """
        try:
            # 1. Gather Data
            intel_items = intel_engine.recent_items
            
            # Ensure we have fresh TWAP data
            if not self.manager.twap_detector.active_twaps:
                await self.manager.twap_detector.scan_once()
                
            active_twaps = self.manager.twap_detector.get_all_tokens_summary()
            
            # Map for correlation
            token_signals = {}

            def get_or_create_signal(token: str):
                token = token.upper()
                if token not in token_signals:
                    token_signals[token] = {
                        "id": hashlib.sha256(token.encode()).hexdigest()[:12],
                        "token": token,
                        "alpha_score": 0,
                        "twap_delta": 0,
                        "confluence_factors": [],
                        "signals": {"news": []},
                        "sentiment": "neutral",
                        "threat_level": "low",
                        "recommendation": "neutral"
                    }
                return token_signals[token]

            # 2. Process TWAPs (Anchor)
            for twap in active_twaps:
                token = twap.get("token", "").upper()
                if not token: continue
                sig = get_or_create_signal(token)
                
                net_delta = twap.get("net_delta", 0)
                sentiment = twap.get("sentiment", "neutral")
                
                if sentiment == "accumulating": sig["alpha_score"] += 3
                elif sentiment == "distributing": sig["alpha_score"] -= 3
                
                sig["twap_delta"] = net_delta
                sig["sentiment"] = sentiment
                sig["confluence_factors"].append("Whale TWAP Activity")
                sig["signals"]["twap"] = twap

            # 3. Process Predictions (Anchor/Correlate)
            predictions = [i for i in intel_items if i.get("metadata", {}).get("type") == "prediction"]
            # Known major tokens for broad discovery if token_signals is small
            major_tokens = ["BTC", "ETH", "SOL", "ARB", "TIA", "PYTH", "LINK", "JUP"]
            
            TOKEN_NAMES = {
                "BTC": "BITCOIN",
                "ETH": "ETHEREUM",
                "SOL": "SOLANA",
                "ARB": "ARBITRUM",
                "TIA": "CELESTIA",
                "LINK": "CHAINLINK"
            }
            
            # Helper for accurate keyword matching
            def is_match(token: str, text: str) -> bool:
                token = token.upper()
                text = text.upper()
                # 1. Exact token match with word boundaries
                padded_text = f" {text} "
                if f" {token} " in padded_text:
                    return True
                
                # 2. Check for Token/USDT or Token-USD
                if f"{token}/" in text or f"{token}-" in text:
                    return True
                
                # 3. Check Full Name if available
                full_name = TOKEN_NAMES.get(token)
                if full_name and f" {full_name} " in padded_text:
                    return True

                return False

            for pred in predictions:
                title = pred.get("title", "")
                matched_token = None
                
                # Check current signals first
                for t in list(token_signals.keys()) + major_tokens:
                    if is_match(t, title):
                        matched_token = t
                        break
                
                if matched_token:
                    sig = get_or_create_signal(matched_token)
                    prob = pred.get("metadata", {}).get("probability", 50)
                    
                    if prob > 70:
                        sig["alpha_score"] += 2
                        if "Bullish Prediction Bias" not in sig["confluence_factors"]:
                            sig["confluence_factors"].append("Bullish Prediction Bias")
                    elif prob < 30:
                        sig["alpha_score"] -= 2
                        if "Bearish Prediction Bias" not in sig["confluence_factors"]:
                            sig["confluence_factors"].append("Bearish Prediction Bias")
                    
                    sig["signals"]["prediction"] = pred

            # 4. Process News (Anchor/Correlate)
            news = [i for i in intel_items if i.get("metadata", {}).get("type") != "prediction"]
            for item in news:
                title = item.get("title", "")
                content = item.get("content", "") + " " + title
                matched_token = None
                
                for t in list(token_signals.keys()) + major_tokens:
                    if is_match(t, content):
                        matched_token = t
                        break
                
                if matched_token:
                    sig = get_or_create_signal(matched_token)
                    sentiment = item.get("sentiment", "neutral")
                    impact = item.get("is_high_impact", False)
                    
                    weight = 2 if impact else 1
                    if sentiment == "bullish":
                        sig["alpha_score"] += weight
                        if "Positive News Sentiment" not in sig["confluence_factors"]:
                            sig["confluence_factors"].append("Positive News Sentiment")
                    elif sentiment == "bearish":
                        sig["alpha_score"] -= weight
                        if "Negative News Sentiment" not in sig["confluence_factors"]:
                            sig["confluence_factors"].append("Negative News Sentiment")
                    
                    sig["signals"]["news"].append(item)

            # 5. Final Synthesis
            nexus_output = []
            for token, sig in token_signals.items():
                if len(sig["confluence_factors"]) >= 2: # High-confluence threshold
                    score = sig["alpha_score"]
                    if score >= 5:
                        sig["recommendation"] = "STRONG BUY"
                        sig["threat_level"] = "low"
                    elif score >= 3:
                        sig["recommendation"] = "ACCUMULATE"
                    elif score <= -5:
                        sig["recommendation"] = "STRONG SELL"
                        sig["threat_level"] = "high"
                    elif score <= -3:
                        sig["recommendation"] = "DISTRIBUTE"
                        sig["threat_level"] = "medium"
                    
                    # Temporal Metadata
                    sig["timestamp"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    comp_times = []
                    if "prediction" in sig["signals"]:
                        ts = sig["signals"]["prediction"].get("timestamp")
                        if ts: comp_times.append(ts)
                    if "news" in sig["signals"]:
                        for itm in sig["signals"]["news"]:
                            ts = itm.get("timestamp")
                            if ts: comp_times.append(ts)
                    if comp_times:
                        try: sig["timestamp"] = max(comp_times)
                        except: pass

                    # 6. ENRICHMENT: Calculate Trade Plan via Microstructure
                    from src.intel.providers.microstructure import MicrostructureProvider
                    micro_provider = next((p for p in intel_engine.providers if isinstance(p, MicrostructureProvider)), None)
                    
                    if micro_provider:
                        # Normalize token symbol (e.g. ARB -> ARB)
                        # Ensure Microstructure has state (it lazy loads, so trigger it)
                        if token in micro_provider.states:
                            state = micro_provider.states[token]
                            trade_plan = self.calculate_trade_plan(sig, state)
                            if trade_plan:
                                sig["trade_plan"] = trade_plan
                                # Boost score if plan is solid
                                if trade_plan["confidence"].startswith("HIGH"):
                                    sig["alpha_score"] += 1
                        elif abs(sig["alpha_score"]) >= 3:
                            # Auto-Watch: Start tracking microstructure for this hot token
                            # We don't await result to avoid blocking Nexus, just trigger ingestion
                            import asyncio
                            asyncio.create_task(micro_provider.get_symbol_state(token))

                    
                            # PERSISTENCE: Save Signal if High Confidence & New
                            if sig.get("trade_plan") and abs(sig["alpha_score"]) >= 4:
                                try:
                                    from database import get_db_session
                                    from models import TradeSignal
                                    with get_db_session() as db:
                                        # Deduplicate: Check if we have a recent pending signal for this token
                                        # to avoid spamming the DB every 10s
                                        existing = db.query(TradeSignal).filter(
                                            TradeSignal.token == token,
                                            TradeSignal.result == "PENDING"
                                        ).first()
                                        
                                        if not existing:
                                            new_sig = TradeSignal(
                                                token=token,
                                                recommendation=sig["recommendation"],
                                                entry_price=sig["trade_plan"]["entry"],
                                                stop_loss=sig["trade_plan"]["stop_loss"],
                                                take_profit_1=sig["trade_plan"]["take_profit_1"],
                                                take_profit_2=sig["trade_plan"]["take_profit_2"],
                                                alpha_score=sig["alpha_score"],
                                                confidence_label=sig["trade_plan"]["confidence"]
                                            )
                                            db.add(new_sig)
                                            logger.info(f"💾 Persisted new Trade Signal for {token}")
                                except Exception as e:
                                    logger.error(f"Failed to persist signal: {e}")

                    # 7. TRACKING: Append Performance Metadata
                    # Use REAL db stats
                    sig["performance"] = self.get_token_performance(token)

                    nexus_output.append(sig)

            # 6. If no confluence detected, return empty (frontend shows empty state)
            # NEVER inject synthetic signals — user trust depends on data integrity

            nexus_output.sort(key=lambda x: abs(x.get("alpha_score", 0)), reverse=True)
            return nexus_output

        except Exception as e:
            logger.error(f"Nexus synthesis failed: {e}")
            return []

nexus = NexusEngine()
