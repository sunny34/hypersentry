import time
import math
from typing import Optional, Dict, List
from src.alpha_engine.state.state_store import global_state_store
from src.alpha_engine.processors.oi_price_regime import OIRegimeClassifier

from src.alpha_engine.models.simplified_models import SimplifiedSignal, SignalStrength

# Signal history for win rate tracking
SIGNAL_HISTORY: Dict[str, List[Dict]] = {}


class SimplifiedAlphaService:
    """
    Simplified Alpha - One clear signal per symbol.
    
    Philosophy: Fewer inputs, clearer signals, actionable entries.
    
    Signal Logic:
    1. Must have strong directional bias from at least 2/3 sources:
       - Orderbook imbalance (bid/ask pressure)
       - Price action + OI regime (trend confirmation)
       - Volume flow (aggressive buyer/seller dominance)
    
    2. If no clear consensus → WAIT
    3. If consensus → Generate BUY/SELL with entry/stop/target
    """
    
    # Thresholds for signal generation
    MIN_CONFIDENCE = 60  # Minimum confidence to generate signal
    MIN_IMBALANCE = 0.15  # Orderbook imbalance threshold
    MIN_REGIME_CONFIDENCE = 0.4  # Minimum regime confidence
    
    @staticmethod
    async def generate_signal(symbol: str) -> Optional[SimplifiedSignal]:
        """
        Generate a simplified, actionable signal.
        Returns None if no clear directional bias.
        """
        state = await global_state_store.get_state(symbol)
        if not state or state.price <= 0:
            return None
        
        # Get current price and calculate signals from each source
        current_price = state.price
        
        # 1. Orderbook Signal
        ob_signal = SimplifiedAlphaService._analyze_orderbook(state)
        
        # 2. Regime Signal
        regime_signal = SimplifiedAlphaService._analyze_regime(state, current_price)
        
        # 3. Volume Flow Signal
        flow_signal = SimplifiedAlphaService._analyze_volume_flow(state)
        
        # Combine signals - need at least 2/3 agreeing
        signals = [ob_signal, regime_signal, flow_signal]
        bullish_count = sum(1 for s in signals if s > 0)
        bearish_count = sum(1 for s in signals if s < 0)
        
        # Determine direction and confidence
        if bullish_count >= 2:
            direction = "BUY"
            confidence = min(95, 50 + (bullish_count * 15) + (ob_signal * 5))
        elif bearish_count >= 2:
            direction = "SELL"
            confidence = min(95, 50 + (bearish_count * 15) + (abs(ob_signal) * 5))
        else:
            # No clear consensus - WAIT
            return SimplifiedSignal(
                symbol=symbol,
                signal="WAIT",
                entry_price=current_price,
                stop_loss=current_price,
                target_price=current_price,
                risk_reward_ratio=0.0,
                confidence=confidence,
                timeframe="intraday",
                reasoning="No clear directional consensus from signals",
                source="simplified",
                timestamp=int(time.time() * 1000)
            )
        
        # Calculate entry, stop, target based on direction
        if direction == "BUY":
            # Entry slightly above current price
            entry_price = current_price * 1.002  # 0.2% above
            stop_loss = current_price * 0.99  # 1% stop
            target_price = current_price * 1.03  # 3% target = 3:1 R:R
            risk_reward = (target_price - entry_price) / (entry_price - stop_loss)
        else:
            entry_price = current_price * 0.998  # 0.2% below
            stop_loss = current_price * 1.01  # 1% stop
            target_price = current_price * 0.97  # 3% target = 3:1 R:R
            risk_reward = (entry_price - target_price) / (stop_loss - entry_price)
        
        # Determine timeframe based on regime
        timeframe = SimplifiedAlphaService._determine_timeframe(state)
        
        # Build reasoning string
        reasoning = SimplifiedAlphaService._build_reasoning(
            direction, ob_signal, regime_signal, flow_signal
        )
        
        # Determine confidence level
        confidence = min(95, max(50, confidence))
        
        # Record signal for historical tracking
        SimplifiedAlphaService._record_signal(symbol, direction, confidence, timeframe)
        
        return SimplifiedSignal(
            symbol=symbol,
            signal=direction,
            entry_price=round(entry_price, 2),
            stop_loss=round(stop_loss, 2),
            target_price=round(target_price, 2),
            risk_reward_ratio=round(risk_reward, 2),
            confidence=confidence,
            timeframe=timeframe,
            reasoning=reasoning,
            source="simplified",
            timestamp=int(time.time() * 1000)
        )
    
    @staticmethod
    def _analyze_orderbook(state) -> float:
        """Orderbook imbalance signal (-1 to 1)"""
        bids = state.orderbook_bids or []
        asks = state.orderbook_asks or []
        
        if not bids or not asks:
            return 0.0
        
        # Calculate total bid/ask volume
        bid_vol = sum(size for _, size in bids[:10])
        ask_vol = sum(size for _, size in asks[:10])
        
        if bid_vol + ask_vol == 0:
            return 0.0
        
        imbalance = (bid_vol - ask_vol) / (bid_vol + ask_vol)
        
        # Return normalized signal
        if abs(imbalance) < SimplifiedAlphaService.MIN_IMBALANCE:
            return 0.0  # Not enough imbalance
        return max(-1.0, min(1.0, imbalance * 3))
    
    @staticmethod
    def _analyze_regime(state, current_price) -> float:
        """Regime signal (-1 to 1)"""
        # Use price history for regime detection
        price_history = getattr(state, 'price_history', [])
        
        if not price_history:
            price_1m_ago = current_price * 0.999
        else:
            price_1m_ago = price_history[-10] if len(price_history) >= 10 else price_history[0]
        
        try:
            result = OIRegimeClassifier.classify(state, price_1m_ago)
            regime = result.get("regime", "NEUTRAL")
            conf = result.get("confidence", 0.3)
        except:
            return 0.0
        
        # Map regime to signal
        regime_signals = {
            "AGGRESSIVE_LONG_BUILD": 1.0,
            "SHORT_COVER": 0.7,
            "STABLE_ACCUMULATION": 0.5,
            "NEUTRAL": 0.0,
            "STABLE_DISTRIBUTION": -0.5,
            "LONG_UNWIND": -0.7,
            "AGGRESSIVE_SHORT_BUILD": -1.0,
        }
        
        signal = regime_signals.get(str(regime), 0.0)
        
        # Reduce confidence if regime confidence is low
        if conf < SimplifiedAlphaService.MIN_REGIME_CONFIDENCE:
            signal *= 0.5
        
        return signal
    
    @staticmethod
    def _analyze_volume_flow(state) -> float:
        """Volume flow signal (-1 to 1)"""
        buy_vol = state.aggressive_buy_volume_1m or 0
        sell_vol = state.aggressive_sell_volume_1m or 0
        
        if buy_vol + sell_vol == 0:
            return 0.0
        
        # Calculate imbalance
        flow = (buy_vol - sell_vol) / (buy_vol + sell_vol)
        
        # Need meaningful volume to signal
        if buy_vol + sell_vol < 10000:  # Low volume threshold
            return 0.0
        
        return max(-1.0, min(1.0, flow * 2))
    
    @staticmethod
    def _determine_timeframe(state) -> str:
        """Determine appropriate timeframe based on volatility"""
        # For now, default to intraday
        # Could add logic based on volatility regime
        return "intraday"
    
    @staticmethod
    def _build_reasoning(direction: str, ob: float, regime: float, flow: float) -> str:
        """Build human-readable reasoning"""
        reasons = []
        
        if direction == "BUY":
            reasons.append("Bullish")
            if ob > 0.3:
                reasons.append("strong orderbook buying pressure")
            if regime > 0.3:
                reasons.append("accumulation regime")
            if flow > 0.3:
                reasons.append("aggressive buying volume")
        else:
            reasons.append("Bearish")
            if ob < -0.3:
                reasons.append("strong orderbook selling pressure")
            if regime < -0.3:
                reasons.append("distribution regime")
            if flow < -0.3:
                reasons.append("aggressive selling volume")
        
        return ". ".join(reasons) if reasons else "Mixed signals"
    
    @staticmethod
    def _record_signal(symbol: str, direction: str, confidence: float, timeframe: str):
        """Record signal for historical tracking"""
        if symbol not in SIGNAL_HISTORY:
            SIGNAL_HISTORY[symbol] = []
        
        SIGNAL_HISTORY[symbol].append({
            "direction": direction,
            "confidence": confidence,
            "timeframe": timeframe,
            "timestamp": int(time.time() * 1000)
        })
        
        # Keep last 50 signals
        if len(SIGNAL_HISTORY[symbol]) > 50:
            SIGNAL_HISTORY[symbol] = SIGNAL_HISTORY[symbol][-50:]
    
    @staticmethod
    def get_signal_history(symbol: str) -> SignalStrength:
        """Get signal statistics for a symbol"""
        history = SIGNAL_HISTORY.get(symbol, [])
        
        if not history:
            return SignalStrength(symbol=symbol)
        
        # For now, return basic stats
        # In production, you'd track actual outcomes
        return SignalStrength(
            symbol=symbol,
            total_signals=len(history),
            winning_signals=0,  # Would need to track actual outcomes
            win_rate=0.0,
            avg_rr=2.0,  # Target R:R
            last_signal_timestamp=history[-1]["timestamp"]
        )


# Global service
simplified_alpha_service = SimplifiedAlphaService()
