from typing import List, Dict, Any, Optional
from datetime import datetime
import statistics

from src.alpha_engine.models.backtest_models import BacktestTrade
from src.alpha_engine.models.regime_models import MarketRegime, VolatilityRegime


class RegimeProfiler:
    """
    Correlates alpha strategy performance with specific market regimes.
    Identifies if the system has an edge in specific volatility or trend environments.
    """

    @staticmethod
    def _to_dt(x: Optional[Any]) -> Optional[datetime]:
        """Normalize input to a datetime or return None.
        Accepts datetime instances or integer timestamps (seconds or milliseconds).
        """
        if x is None:
            return None
        if isinstance(x, datetime):
            return x
        try:
            # assume integer timestamp (either seconds or milliseconds)
            ts = int(x)
        except Exception:
            return None
        # heuristics: if timestamp is very large, treat as milliseconds
        if ts > 1_000_000_000_000:
            return datetime.fromtimestamp(ts / 1000.0)
        return datetime.fromtimestamp(ts)

    @staticmethod
    def _agg(pnl_list: List[float]) -> Dict[str, float]:
        if not pnl_list:
            return {
                "count": 0,
                "mean_return": 0.0,
                "win_rate": 0.0,
                "std_return": 0.0,
            }
        count = len(pnl_list)
        mean_return = statistics.mean(pnl_list)
        wins = sum(1 for p in pnl_list if p > 0)
        win_rate = wins / count if count else 0.0
        try:
            std_return = statistics.stdev(pnl_list) if count > 1 else 0.0
        except statistics.StatisticsError:
            std_return = 0.0
        return {
            "count": count,
            "mean_return": mean_return,
            "win_rate": win_rate,
            "std_return": std_return,
        }

    @staticmethod
    def profile(trades: List[BacktestTrade], regime_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Profile trade performance by regime.

        regime_history: list of dicts with keys including at least:
          - 'start' (datetime or int timestamp)
          - 'end' (datetime or int timestamp) or None
          - 'regime' (MarketRegime or str)
          - 'volatility_regime' (VolatilityRegime or str)
          - optional 'regime_confidence' (float)

        Returns a dict with 'volatility' and 'trend' groupings and an 'edges' summary.
        """
        # Normalize regime history entries
        norm_regs = []
        for r in regime_history or []:
            start_dt = RegimeProfiler._to_dt(r.get("start"))
            end_dt = RegimeProfiler._to_dt(r.get("end"))
            regime = r.get("regime")
            vol = r.get("volatility_regime")
            conf = r.get("regime_confidence")
            norm_regs.append({
                "start": start_dt,
                "end": end_dt,
                "regime": regime,
                "volatility_regime": vol,
                "regime_confidence": conf,
            })

        # Sort by start time (None starts go to far future)
        norm_regs.sort(key=lambda x: x["start"] or datetime.max)

        # containers for pnl lists
        vol_performance: Dict[str, List[float]] = {}
        trend_performance: Dict[str, List[float]] = {}

        unmatched = 0

        # helper to convert enum to key
        def key_of(val: Any) -> str:
            if val is None:
                return "UNKNOWN"
            if isinstance(val, (MarketRegime, VolatilityRegime)):
                return val.value
            return str(val)

        # For ease, sort trades by entry_time
        trades_sorted = sorted(trades, key=lambda t: t.entry_time)

        for t in trades_sorted:
            entry = t.entry_time
            # find candidate regimes that cover this entry
            candidates = []
            for rec in norm_regs:
                s = rec.get("start")
                e = rec.get("end")
                if s is None:
                    # can't match if start missing; skip
                    continue
                # if end is None treat as open-ended
                if e is None:
                    if entry >= s:
                        candidates.append(rec)
                else:
                    if s <= entry < e:
                        candidates.append(rec)
            chosen = None
            if len(candidates) == 1:
                chosen = candidates[0]
            elif len(candidates) > 1:
                # prefer highest confidence, else latest start
                candidates_sorted = sorted(
                    candidates,
                    key=lambda r: (
                        -(r.get("regime_confidence") or 0.0),
                        r.get("start") or datetime.min,
                    ),
                )
                chosen = candidates_sorted[0]
            else:
                # no direct candidate: assign to latest regime whose start <= entry
                prev = None
                for rec in norm_regs:
                    s = rec.get("start")
                    if s and s <= entry:
                        prev = rec
                    elif s and s > entry:
                        break
                if prev is not None:
                    chosen = prev
                else:
                    # assign earliest if entry is before first start
                    if norm_regs:
                        chosen = norm_regs[0]
                    else:
                        chosen = None

            if chosen is None:
                unmatched += 1
                # skip adding to groups
                continue

            vol_key = key_of(chosen.get("volatility_regime"))
            trend_key = key_of(chosen.get("regime"))
            pnl = getattr(t, "pnl_perc", 0.0) or 0.0

            vol_performance.setdefault(vol_key, []).append(pnl)
            trend_performance.setdefault(trend_key, []).append(pnl)

        # Aggregate
        vol_agg = {k: RegimeProfiler._agg(v) for k, v in vol_performance.items()}
        trend_agg = {k: RegimeProfiler._agg(v) for k, v in trend_performance.items()}

        # Derived edges
        def mean_for(key: str, mapping: Dict[str, Any]) -> Optional[float]:
            rec = mapping.get(key)
            return rec["mean_return"] if rec is not None else None

        compression_mean = mean_for(str(VolatilityRegime.COMPRESSION.value), vol_agg)
        trending_mean = mean_for(str(VolatilityRegime.TRENDING.value), vol_agg)
        expansion_mean = mean_for(str(VolatilityRegime.EXPANSION.value), vol_agg)

        compression_edge = None
        if compression_mean is not None and trending_mean is not None:
            compression_edge = compression_mean - trending_mean

        expansion_drawdown = 0.0
        if expansion_mean is not None:
            expansion_drawdown = min(0.0, expansion_mean)

        trending_winrate = 0.0
        trending_rec = vol_agg.get(VolatilityRegime.TRENDING.value)
        if trending_rec is not None:
            trending_winrate = trending_rec.get("win_rate", 0.0)

        total_trades = sum(r.get("count", 0) for r in vol_agg.values())

        return {
            "volatility": vol_agg,
            "trend": trend_agg,
            "edges": {
                "compression_edge": compression_edge,
                "expansion_drawdown": expansion_drawdown,
                "trending_winrate": trending_winrate,
                "total_trades": total_trades,
                "unmatched_count": unmatched,
            },
        }
