import asyncio
import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import aiohttp
from aiohttp import WSMsgType

from src.alpha_engine.models.footprint_models import Trade
from src.alpha_engine.services.alpha_service import alpha_service
from src.services.event_bus import event_bus

logger = logging.getLogger(__name__)
SYMBOL_RE = re.compile(r"^[A-Z0-9]{1,20}$")


class DataAggregator:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataAggregator, cls).__new__(cls)
            cls._instance.is_running = False
            cls._instance.subscriptions: Set[str] = set()
            cls._instance.active_subs: Set[str] = set()
            cls._instance.system_symbols: Set[str] = set()
            cls._instance.client_refcounts: Dict[str, int] = {}
            cls._instance.data_cache: Dict[str, Any] = {}
            cls._instance.cvd_data: Dict[str, float] = {}
            cls._instance.available_symbols_cache: List[Dict[str, float]] = []
            cls._instance.available_symbols_updated_ms = 0
            cls._instance._symbols_refresh_retry_after_ts = 0.0
            cls._instance._symbols_refresh_backoff_sec = 2.0
            cls._instance._symbols_refresh_last_log_ts = 0.0
            cls._instance.max_subscriptions = max(1, int(os.getenv("AGGREGATOR_MAX_SUBSCRIPTIONS", "80")))
            cls._instance.auto_subscribe_top_n = max(0, int(os.getenv("AGGREGATOR_AUTO_SUBSCRIBE_TOP_N", "0")))
            cls._instance.alpha_worker_count = max(1, int(os.getenv("AGGREGATOR_ALPHA_WORKERS", "4")))
            cls._instance.alpha_update_queue: asyncio.Queue = asyncio.Queue(
                maxsize=max(1000, int(os.getenv("AGGREGATOR_ALPHA_QUEUE_SIZE", "10000")))
            )
            cls._instance.alpha_workers: List[asyncio.Task] = []
            cls._instance.alpha_drop_count = 0
            cls._instance._last_drop_log_ms = 0
            cls._instance._last_metrics_log_ms = 0
            cls._instance.default_symbol_env = os.getenv(
                "AGGREGATOR_DEFAULT_SYMBOLS",
                "BTC,ETH,SOL,HYPE,ARB,LINK,DOGE,AVAX,SUI,TIA",
            )
            cls._instance.default_symbols = cls._instance._parse_symbols(cls._instance.default_symbol_env)
            cls._instance.subscribe_batch_size = max(1, int(os.getenv("AGGREGATOR_SUBSCRIBE_BATCH_SIZE", "1")))
            cls._instance.subscribe_batch_pause_sec = max(
                0.01, float(os.getenv("AGGREGATOR_SUBSCRIBE_BATCH_PAUSE_SEC", "0.25"))
            )
            cls._instance.subscribe_send_pause_sec = max(
                0.0, float(os.getenv("AGGREGATOR_SUBSCRIBE_SEND_PAUSE_SEC", "0.05"))
            )
            cls._instance.reconnect_min_sec = max(1.0, float(os.getenv("AGGREGATOR_RECONNECT_MIN_SEC", "8")))
            cls._instance.reconnect_max_sec = max(
                cls._instance.reconnect_min_sec, float(os.getenv("AGGREGATOR_RECONNECT_MAX_SEC", "120"))
            )
            cls._instance.stable_connection_sec = max(
                5.0, float(os.getenv("AGGREGATOR_STABLE_CONNECTION_SEC", "30"))
            )
            cls._instance.last_ws_close_code = None
            cls._instance.last_ws_close_reason = None
            cls._instance.last_ws_close_ts = 0.0
            cls._instance.upstream_connected = False
            cls._instance._ws = None
            cls._instance._ws_task: Optional[asyncio.Task] = None
            cls._instance._broadcast_task: Optional[asyncio.Task] = None
            cls._instance._external_task: Optional[asyncio.Task] = None
            cls._instance.external_enabled = os.getenv("AGGREGATOR_EXTERNAL_ENABLE", "true").strip().lower() in {
                "1",
                "true",
                "yes",
                "on",
            }
            cls._instance.external_poll_interval_sec = max(1.0, float(os.getenv("AGGREGATOR_EXTERNAL_POLL_SEC", "4")))
            cls._instance.external_ws_resync_sec = max(
                0.5,
                float(
                    os.getenv(
                        "AGGREGATOR_EXTERNAL_WS_RESYNC_SEC",
                        str(cls._instance.external_poll_interval_sec),
                    )
                ),
            )
            cls._instance.external_oi_poll_interval_sec = max(
                2.0, float(os.getenv("AGGREGATOR_EXTERNAL_OI_POLL_SEC", "12"))
            )
            cls._instance.external_reconnect_min_sec = max(
                1.0, float(os.getenv("AGGREGATOR_EXTERNAL_RECONNECT_MIN_SEC", "2"))
            )
            cls._instance.external_reconnect_max_sec = max(
                cls._instance.external_reconnect_min_sec,
                float(os.getenv("AGGREGATOR_EXTERNAL_RECONNECT_MAX_SEC", "60")),
            )
            cls._instance.external_max_symbols = max(1, int(os.getenv("AGGREGATOR_EXTERNAL_MAX_SYMBOLS", "12")))
            cls._instance.external_concurrency = max(1, int(os.getenv("AGGREGATOR_EXTERNAL_CONCURRENCY", "4")))
            cls._instance.external_source_ttl_ms = max(1000, int(os.getenv("AGGREGATOR_EXTERNAL_TTL_MS", "15000")))
            cls._instance.oi_weight_hl = max(0.0, float(os.getenv("AGGREGATOR_OI_HL_WEIGHT", "0.65")))
            cls._instance.oi_weight_binance = max(0.0, float(os.getenv("AGGREGATOR_OI_BINANCE_WEIGHT", "0.35")))
            cls._instance.cvd_weight_binance = max(0.0, float(os.getenv("AGGREGATOR_CVD_BINANCE_WEIGHT", "0.70")))
            cls._instance.cvd_weight_coinbase = max(0.0, float(os.getenv("AGGREGATOR_CVD_COINBASE_WEIGHT", "0.30")))
            cls._instance.external_metrics: Dict[str, Dict[str, Any]] = {}
            cls._instance._binance_external_subs: Set[str] = set()
            cls._instance._coinbase_external_subs: Set[str] = set()
            cls._instance._binance_external_blocklist: Set[str] = set()
            cls._instance._coinbase_external_blocklist: Set[str] = set()
            cls._instance._binance_external_pending: Dict[int, str] = {}
            cls._instance._external_req_id = 1
            cls._instance.last_broadcast_time = 0
            cls._instance.broadcast_interval = 0.05  # 50ms for near-real-time book updates
        return cls._instance

    async def start(self):
        logger.info("DataAggregator.start() called")
        if self.is_running:
            return
        self.is_running = True
        await self._prime_default_subscriptions()
        logger.info("🚀 Data Aggregator: Online")
        for idx in range(self.alpha_worker_count):
            self.alpha_workers.append(asyncio.create_task(self._alpha_update_worker(idx)))
        self._ws_task = asyncio.create_task(self._ws_loop())
        self._broadcast_task = asyncio.create_task(self._broadcast_loop())
        if self.external_enabled:
            self._external_task = asyncio.create_task(self._external_loop())

    async def stop(self):
        if (
            not self.is_running
            and not self.alpha_workers
            and not self._ws_task
            and not self._broadcast_task
            and not self._external_task
        ):
            return

        self.is_running = False
        logger.info("Data Aggregator: shutting down")

        ws = self._ws
        self._ws = None
        if ws is not None and not ws.closed:
            try:
                await ws.close()
            except Exception:
                logger.exception("Failed to close aggregator upstream websocket")

        tasks: List[asyncio.Task] = []
        for task in self.alpha_workers:
            if task and not task.done():
                task.cancel()
                tasks.append(task)
        self.alpha_workers = []

        for task in (self._ws_task, self._broadcast_task, self._external_task):
            if task and not task.done():
                task.cancel()
                tasks.append(task)
        self._ws_task = None
        self._broadcast_task = None
        self._external_task = None

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        while not self.alpha_update_queue.empty():
            try:
                self.alpha_update_queue.get_nowait()
                self.alpha_update_queue.task_done()
            except Exception:
                break
        self.external_metrics.clear()
        self._binance_external_subs.clear()
        self._coinbase_external_subs.clear()
        self._binance_external_blocklist.clear()
        self._coinbase_external_blocklist.clear()
        self._binance_external_pending.clear()

        logger.info("Data Aggregator: Offline")

    def _parse_symbols(self, raw: str) -> List[str]:
        symbols: List[str] = []
        for part in (raw or "").split(","):
            sym = self._normalize_symbol(part)
            if sym:
                symbols.append(sym)
        return list(dict.fromkeys(symbols))

    @staticmethod
    def _normalize_symbol(coin: str) -> Optional[str]:
        if coin is None:
            return None
        symbol = str(coin).strip().upper().split("/")[0]
        if not SYMBOL_RE.match(symbol):
            return None
        return symbol

    @staticmethod
    def _is_rate_limit_error(exc: Exception) -> bool:
        status = getattr(exc, "status", None)
        if status == 429:
            return True
        status_code = getattr(exc, "status_code", None)
        if status_code == 429:
            return True
        text = str(exc).lower()
        return "429" in text or "rate limited" in text

    def _mark_symbols_refresh_rate_limited(self, status: int | None = None):
        now = time.time()
        self._symbols_refresh_retry_after_ts = max(
            self._symbols_refresh_retry_after_ts,
            now + self._symbols_refresh_backoff_sec,
        )
        if now - self._symbols_refresh_last_log_ts >= 5.0:
            logger.warning(
                "Aggregator symbols refresh rate limited status=%s retry_in=%.1fs",
                status,
                max(0.0, self._symbols_refresh_retry_after_ts - now),
            )
            self._symbols_refresh_last_log_ts = now
        self._symbols_refresh_backoff_sec = min(60.0, max(2.0, self._symbols_refresh_backoff_sec * 1.7))

    def _mark_symbols_refresh_success(self):
        self._symbols_refresh_retry_after_ts = 0.0
        self._symbols_refresh_backoff_sec = 2.0

    async def refresh_available_symbols(self, force: bool = False) -> List[Dict[str, float]]:
        now = time.time()
        if now < self._symbols_refresh_retry_after_ts:
            return list(self.available_symbols_cache)
        now_ms = int(time.time() * 1000)
        cache_age_ms = now_ms - self.available_symbols_updated_ms
        if not force and self.available_symbols_cache and cache_age_ms < 60_000:
            return list(self.available_symbols_cache)

        url = "https://api.hyperliquid.xyz/info"
        payload = {"type": "metaAndAssetCtxs"}
        rows: List[Dict[str, float]] = []
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as resp:
                    if resp.status == 429:
                        self._mark_symbols_refresh_rate_limited(status=resp.status)
                        return list(self.available_symbols_cache)
                    if resp.status != 200:
                        logger.warning("Aggregator symbols refresh failed status=%s", resp.status)
                        return list(self.available_symbols_cache)
                    data = await resp.json()

            universe = data[0].get("universe", []) if isinstance(data, list) and len(data) >= 2 else []
            contexts = data[1] if isinstance(data, list) and len(data) >= 2 and isinstance(data[1], list) else []

            for idx, asset in enumerate(universe):
                symbol = self._normalize_symbol(asset.get("name"))
                if not symbol:
                    continue
                day_ntl_vlm = 0.0
                prev_day_px = 0.0
                if idx < len(contexts):
                    try:
                        day_ntl_vlm = float(contexts[idx].get("dayNtlVlm", 0.0) or 0.0)
                        prev_day_px = float(contexts[idx].get("prevDayPx", 0.0) or 0.0)
                    except Exception:
                        day_ntl_vlm = 0.0
                        prev_day_px = 0.0
                rows.append({"symbol": symbol, "index": idx, "day_ntl_vlm": day_ntl_vlm, "prev_day_px": prev_day_px})
            rows.sort(key=lambda row: row["day_ntl_vlm"], reverse=True)
        except Exception as exc:
            if self._is_rate_limit_error(exc):
                self._mark_symbols_refresh_rate_limited()
                return list(self.available_symbols_cache)
            logger.exception("Aggregator symbols refresh failed")
            return list(self.available_symbols_cache)

        self._mark_symbols_refresh_success()
        self.available_symbols_cache = rows
        self.available_symbols_updated_ms = now_ms
        return list(self.available_symbols_cache)

    async def _prime_default_subscriptions(self):
        symbols = list(self.default_symbols)
        if self.auto_subscribe_top_n > 0:
            rows = await self.refresh_available_symbols(force=True)
            top_symbols = [row["symbol"] for row in rows[: self.auto_subscribe_top_n]]
            symbols = list(dict.fromkeys(symbols + top_symbols))

        if not symbols:
            logger.warning("No default symbols configured; waiting for client subscriptions only.")
            return

        capped = symbols[: self.max_subscriptions]
        for symbol in capped:
            self.subscribe(symbol, source="system")

        logger.info(
            "Aggregator default symbols loaded count=%s max=%s top_n=%s",
            len(capped),
            self.max_subscriptions,
            self.auto_subscribe_top_n,
        )

    def get_symbol_overview(self, limit: int = 50) -> Dict[str, Any]:
        available = [row["symbol"] for row in self.available_symbols_cache[: max(1, limit)]]
        return {
            "max_subscriptions": self.max_subscriptions,
            "auto_subscribe_top_n": self.auto_subscribe_top_n,
            "defaults": sorted(self.system_symbols),
            "subscribed": sorted(self.subscriptions),
            "available": available,
            "client_refcounts": dict(self.client_refcounts),
            "alpha_queue_depth": self.alpha_update_queue.qsize(),
            "alpha_drop_count": self.alpha_drop_count,
            "alpha_worker_count": self.alpha_worker_count,
            "external_enabled": self.external_enabled,
            "external_symbols_tracked": len(self.external_metrics),
            "last_ws_close_code": self.last_ws_close_code,
            "last_ws_close_reason": self.last_ws_close_reason,
            "last_ws_close_ts": self.last_ws_close_ts,
            "upstream_connected": self.upstream_connected,
        }

    def _enqueue_alpha_update(self, symbol: str, payload: Dict[str, Any]):
        if not self.is_running:
            return
        try:
            self.alpha_update_queue.put_nowait((symbol, payload))
        except asyncio.QueueFull:
            self.alpha_drop_count += 1
            now_ms = int(time.time() * 1000)
            if now_ms - self._last_drop_log_ms > 5000:
                self._last_drop_log_ms = now_ms
                logger.warning(
                    "Aggregator alpha queue full; dropping updates total_dropped=%s depth=%s",
                    self.alpha_drop_count,
                    self.alpha_update_queue.qsize(),
                )

    async def _alpha_update_worker(self, worker_idx: int):
        while True:
            try:
                symbol, payload = await self.alpha_update_queue.get()
                logger.info(f"Worker {worker_idx} got payload for {symbol}")
                try:
                    await alpha_service.update_market_state(symbol, payload)
                    logger.info(f"Worker {worker_idx} finished update_market_state for {symbol}")
                except Exception:
                    logger.exception("Alpha update worker failed worker=%s symbol=%s", worker_idx, symbol)
                finally:
                    self.alpha_update_queue.task_done()
                if not self.is_running and self.alpha_update_queue.empty():
                    break
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Alpha worker loop error worker=%s", worker_idx)
                await asyncio.sleep(0.1)

    async def _send_unsubscribe(self, symbol: str):
        ws = self._ws
        if ws is None or ws.closed:
            return
        try:
            for sub_type in ("l2Book", "trades", "activeAssetCtx", "liquidations"):
                await ws.send_str(
                    json.dumps(
                        {
                            "method": "unsubscribe",
                            "subscription": {"type": sub_type, "coin": symbol},
                        }
                    )
                )
        except Exception as exc:
            reason = self._format_exception(exc)
            if self._is_expected_ws_shutdown_error(exc):
                logger.info("Skipped unsubscribe for closing socket symbol=%s err=%s", symbol, reason)
            else:
                logger.warning("Failed to unsubscribe symbol=%s from upstream err=%s", symbol, reason)

    @staticmethod
    def _format_exception(exc: Exception) -> str:
        detail = str(exc).strip()
        if detail:
            return f"{exc.__class__.__name__}: {detail}"
        return repr(exc)

    @staticmethod
    def _is_expected_ws_shutdown_error(exc: Exception) -> bool:
        if isinstance(exc, (ConnectionResetError, BrokenPipeError)):
            return True
        text = str(exc).lower()
        exc_name = exc.__class__.__name__.lower()
        if "disconnect" in exc_name or "closed" in exc_name:
            return True
        expected_fragments = (
            "cannot write to closing transport",
            "connection closed",
            "websocket connection is closing",
            "session is closed",
            "broken pipe",
            "cannot write request body",
        )
        return any(fragment in text for fragment in expected_fragments)

    @classmethod
    def _is_upstream_rate_limited_error(cls, exc: Exception) -> bool:
        if cls._is_rate_limit_error(exc):
            return True
        if exc.__class__.__name__ == "WSServerHandshakeError" and getattr(exc, "status", None) == 429:
            return True
        return False

    async def _ws_send_json(self, ws: aiohttp.ClientWebSocketResponse, payload: Dict[str, Any], context: str) -> bool:
        if ws.closed:
            return False
        try:
            await ws.send_str(json.dumps(payload))
            return True
        except Exception as exc:
            reason = self._format_exception(exc)
            self.last_ws_close_reason = reason
            if self._is_expected_ws_shutdown_error(exc):
                logger.info("Aggregator WS send skipped context=%s err=%s", context, reason)
            else:
                logger.warning("Aggregator WS send failed context=%s err=%s", context, reason)
            return False

    async def _hydrate_book_snapshot(self, symbol: str):
        payload = {"type": "l2Snapshot", "coin": symbol}
        try:
            timeout = aiohttp.ClientTimeout(total=3)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post("https://api.hyperliquid.xyz/info", json=payload) as resp:
                    if resp.status != 200:
                        return
                    data = await resp.json()

            levels = data.get("levels", []) if isinstance(data, dict) else []
            if not (isinstance(levels, list) and len(levels) >= 2):
                return
            if len(levels[0]) == 0 and len(levels[1]) == 0:
                return

            self._update_cache(symbol, "book", levels)
            self._update_cache(symbol, "walls", self._detect_walls(levels))
            logger.info(
                "Hydrated l2 snapshot symbol=%s bids=%s asks=%s",
                symbol,
                len(levels[0]),
                len(levels[1]),
            )
        except Exception:
            logger.exception("Failed to hydrate l2 snapshot symbol=%s", symbol)

    @staticmethod
    def _series_baseline(series: List[Tuple[int, float]], cutoff_ms: int) -> float:
        baseline = series[0][1]
        for ts_ms, value in series:
            if ts_ms <= cutoff_ms:
                baseline = value
            else:
                break
        return baseline

    def _is_fresh(self, ts_ms: Optional[int], now_ms: Optional[int] = None) -> bool:
        if not ts_ms:
            return False
        current = now_ms if now_ms is not None else int(time.time() * 1000)
        return (current - int(ts_ms)) <= self.external_source_ttl_ms

    def _ensure_external_symbol(self, symbol: str) -> Dict[str, Any]:
        return self.external_metrics.setdefault(
            symbol,
            {
                "bin_spot_last_id": None,
                "bin_spot_cum": 0.0,
                "bin_spot_series": [],
                "bin_spot_1m": 0.0,
                "bin_spot_5m": 0.0,
                "bin_spot_ts": 0,
                "cb_spot_last_id": None,
                "cb_spot_cum": 0.0,
                "cb_spot_series": [],
                "cb_spot_1m": 0.0,
                "cb_spot_5m": 0.0,
                "cb_spot_ts": 0,
                "bin_perp_oi_usd": 0.0,
                "bin_perp_oi_ts": 0,
            },
        )

    def _current_external_symbols(self) -> List[str]:
        return sorted(list(self.subscriptions))[: self.external_max_symbols]

    @staticmethod
    def _binance_stream_for_symbol(symbol: str) -> str:
        return f"{symbol.lower()}usdt@aggTrade"

    @staticmethod
    def _symbol_from_binance_payload(raw_symbol: Any) -> Optional[str]:
        if not isinstance(raw_symbol, str):
            return None
        symbol = raw_symbol.strip().upper()
        if symbol.endswith("USDT") and len(symbol) > 4:
            symbol = symbol[:-4]
        return DataAggregator._normalize_symbol(symbol)

    @staticmethod
    def _coinbase_product_for_symbol(symbol: str) -> str:
        return f"{symbol}-USD"

    @staticmethod
    def _symbol_from_coinbase_product(raw_product: Any) -> Optional[str]:
        if not isinstance(raw_product, str):
            return None
        product = raw_product.strip().upper()
        if "-" not in product:
            return None
        base, _quote = product.split("-", 1)
        return DataAggregator._normalize_symbol(base)

    def _next_external_req_id(self) -> int:
        req_id = self._external_req_id
        self._external_req_id += 1
        if self._external_req_id > 2_000_000_000:
            self._external_req_id = 1
        return req_id

    @staticmethod
    def _chunked(items: List[str], size: int = 100) -> List[List[str]]:
        return [items[idx : idx + size] for idx in range(0, len(items), size)]

    def _emit_external_payloads(
        self,
        symbol: str,
        now_ms: int,
        include_cvd: bool = True,
        include_oi: bool = True,
    ):
        if symbol not in self.data_cache:
            self.data_cache[symbol] = {"price": 0, "book": [[], []], "trades": [], "walls": [], "liquidations": []}

        if include_cvd:
            ext_cvd = self._build_external_cvd_payload(symbol, now_ms=now_ms)
            if ext_cvd:
                self.data_cache[symbol]["external_spot"] = ext_cvd
                self._enqueue_alpha_update(symbol, ext_cvd)

        if include_oi:
            hl_oi = float(self.data_cache.get(symbol, {}).get("oi", 0.0) or 0.0)
            if hl_oi > 0:
                oi_payload = self._build_external_oi_payload(symbol, hl_oi=hl_oi, now_ms=now_ms)
                self.data_cache[symbol]["external_oi"] = oi_payload
                self._enqueue_alpha_update(symbol, oi_payload)

    async def _safe_json_get(self, session: aiohttp.ClientSession, url: str) -> Optional[Any]:
        try:
            async with session.get(url, timeout=3) as resp:
                if resp.status != 200:
                    return None
                return await resp.json()
        except Exception:
            return None

    def _apply_binance_spot_cvd(self, symbol: str, payload: Any, now_ms: int):
        if not isinstance(payload, list) or not payload:
            return
        metrics = self._ensure_external_symbol(symbol)
        parsed: List[Tuple[int, float]] = []
        for row in payload:
            try:
                trade_id = int(row.get("id"))
                price = float(row.get("price", 0.0))
                qty = float(row.get("qty", 0.0))
                signed_notional = -price * qty if bool(row.get("isBuyerMaker")) else price * qty
                parsed.append((trade_id, signed_notional))
            except Exception:
                continue
        if not parsed:
            return

        parsed.sort(key=lambda x: x[0])
        prev_id = metrics.get("bin_spot_last_id")
        if prev_id is None:
            delta = sum(v for _, v in parsed)
        else:
            delta = sum(v for tid, v in parsed if tid > prev_id)
        metrics["bin_spot_last_id"] = parsed[-1][0]
        if prev_id is None:
            metrics["bin_spot_cum"] = float(delta)
        else:
            metrics["bin_spot_cum"] = float(metrics.get("bin_spot_cum", 0.0) + delta)

        series = metrics.setdefault("bin_spot_series", [])
        series.append((now_ms, float(metrics["bin_spot_cum"])))
        cutoff = now_ms - 6 * 60 * 1000
        while len(series) > 1 and series[0][0] < cutoff:
            series.pop(0)
        metrics["bin_spot_1m"] = float(metrics["bin_spot_cum"] - self._series_baseline(series, now_ms - 60 * 1000))
        metrics["bin_spot_5m"] = float(metrics["bin_spot_cum"] - self._series_baseline(series, now_ms - 5 * 60 * 1000))
        metrics["bin_spot_ts"] = now_ms

    def _apply_coinbase_spot_cvd(self, symbol: str, payload: Any, now_ms: int):
        if not isinstance(payload, list) or not payload:
            return
        metrics = self._ensure_external_symbol(symbol)
        parsed: List[Tuple[int, float]] = []
        for row in payload:
            try:
                trade_id = int(row.get("trade_id"))
                price = float(row.get("price", 0.0))
                size = float(row.get("size", 0.0))
                side = str(row.get("side", "")).lower()
                sign = 1.0 if side == "buy" else -1.0
                parsed.append((trade_id, sign * price * size))
            except Exception:
                continue
        if not parsed:
            return

        parsed.sort(key=lambda x: x[0])
        prev_id = metrics.get("cb_spot_last_id")
        if prev_id is None:
            delta = sum(v for _, v in parsed)
        else:
            delta = sum(v for tid, v in parsed if tid > prev_id)
        metrics["cb_spot_last_id"] = parsed[-1][0]
        if prev_id is None:
            metrics["cb_spot_cum"] = float(delta)
        else:
            metrics["cb_spot_cum"] = float(metrics.get("cb_spot_cum", 0.0) + delta)

        series = metrics.setdefault("cb_spot_series", [])
        series.append((now_ms, float(metrics["cb_spot_cum"])))
        cutoff = now_ms - 6 * 60 * 1000
        while len(series) > 1 and series[0][0] < cutoff:
            series.pop(0)
        metrics["cb_spot_1m"] = float(metrics["cb_spot_cum"] - self._series_baseline(series, now_ms - 60 * 1000))
        metrics["cb_spot_5m"] = float(metrics["cb_spot_cum"] - self._series_baseline(series, now_ms - 5 * 60 * 1000))
        metrics["cb_spot_ts"] = now_ms

    def _apply_binance_perp_oi(self, symbol: str, payload: Any, now_ms: int):
        if not isinstance(payload, dict):
            return
        try:
            oi_contracts = float(payload.get("openInterest", 0.0))
        except Exception:
            return
        metrics = self._ensure_external_symbol(symbol)
        ref_price = float(self.data_cache.get(symbol, {}).get("price", 0.0) or 0.0)
        oi_usd = oi_contracts * ref_price if ref_price > 0 else oi_contracts
        metrics["bin_perp_oi_usd"] = float(oi_usd)
        metrics["bin_perp_oi_ts"] = now_ms

    def _compose_open_interest(self, hl_oi: Optional[float], binance_oi: Optional[float]) -> Tuple[float, str]:
        hl = float(hl_oi or 0.0)
        bn = float(binance_oi or 0.0)
        if hl > 0 and bn > 0:
            total_w = self.oi_weight_hl + self.oi_weight_binance
            if total_w <= 0:
                return hl, "hl"
            return ((hl * self.oi_weight_hl) + (bn * self.oi_weight_binance)) / total_w, "composite"
        if hl > 0:
            return hl, "hl"
        if bn > 0:
            return bn, "binance_perp"
        return 0.0, "none"

    def _build_external_cvd_payload(self, symbol: str, now_ms: Optional[int] = None) -> Dict[str, Any]:
        metrics = self.external_metrics.get(symbol)
        if not metrics:
            return {}
        current = now_ms if now_ms is not None else int(time.time() * 1000)
        payload: Dict[str, Any] = {}

        bin_ok = self._is_fresh(metrics.get("bin_spot_ts"), current)
        cb_ok = self._is_fresh(metrics.get("cb_spot_ts"), current)
        if bin_ok:
            payload["cvd_spot_binance_1m"] = float(metrics.get("bin_spot_1m", 0.0))
            payload["cvd_spot_binance_5m"] = float(metrics.get("bin_spot_5m", 0.0))
        if cb_ok:
            payload["cvd_spot_coinbase_1m"] = float(metrics.get("cb_spot_1m", 0.0))
            payload["cvd_spot_coinbase_5m"] = float(metrics.get("cb_spot_5m", 0.0))

        weighted_1m = 0.0
        weighted_5m = 0.0
        total_w = 0.0
        if bin_ok:
            weighted_1m += float(metrics.get("bin_spot_1m", 0.0)) * self.cvd_weight_binance
            weighted_5m += float(metrics.get("bin_spot_5m", 0.0)) * self.cvd_weight_binance
            total_w += self.cvd_weight_binance
        if cb_ok:
            weighted_1m += float(metrics.get("cb_spot_1m", 0.0)) * self.cvd_weight_coinbase
            weighted_5m += float(metrics.get("cb_spot_5m", 0.0)) * self.cvd_weight_coinbase
            total_w += self.cvd_weight_coinbase

        if total_w > 0:
            payload["cvd_spot_composite_1m"] = weighted_1m / total_w
            payload["cvd_spot_composite_5m"] = weighted_5m / total_w
            payload["cvd_source"] = "spot_composite"
        return payload

    def _build_external_oi_payload(self, symbol: str, hl_oi: float, now_ms: Optional[int] = None) -> Dict[str, Any]:
        metrics = self.external_metrics.get(symbol) or {}
        current = now_ms if now_ms is not None else int(time.time() * 1000)
        binance_oi = None
        if self._is_fresh(metrics.get("bin_perp_oi_ts"), current):
            try:
                binance_oi = float(metrics.get("bin_perp_oi_usd", 0.0))
            except Exception:
                binance_oi = None

        composed_oi, source = self._compose_open_interest(hl_oi, binance_oi)
        payload: Dict[str, Any] = {
            "open_interest_hl": float(hl_oi or 0.0),
            "open_interest": float(composed_oi),
            "open_interest_source": source,
        }
        if binance_oi is not None:
            payload["open_interest_binance_perp"] = float(binance_oi)
        return payload

    async def _external_ws_send_json(
        self, ws: aiohttp.ClientWebSocketResponse, payload: Dict[str, Any], context: str
    ) -> bool:
        if ws.closed:
            return False
        try:
            await ws.send_str(json.dumps(payload))
            return True
        except Exception as exc:
            reason = self._format_exception(exc)
            if self._is_expected_ws_shutdown_error(exc):
                logger.info("External WS send skipped context=%s err=%s", context, reason)
            else:
                logger.warning("External WS send failed context=%s err=%s", context, reason)
            return False

    async def _sync_binance_ws_subscriptions(self, ws: aiohttp.ClientWebSocketResponse) -> bool:
        target_symbols = [s for s in self._current_external_symbols() if s not in self._binance_external_blocklist]
        targets = {self._binance_stream_for_symbol(symbol) for symbol in target_symbols}
        to_sub = sorted(targets - self._binance_external_subs)
        to_unsub = sorted(self._binance_external_subs - targets)

        for stream in to_sub:
            req_id = self._next_external_req_id()
            self._binance_external_pending[req_id] = stream
            sent = await self._external_ws_send_json(
                ws,
                {"method": "SUBSCRIBE", "params": [stream], "id": req_id},
                context=f"binance:subscribe:{stream}",
            )
            if not sent:
                self._binance_external_pending.pop(req_id, None)
                return False

        for chunk in self._chunked(to_unsub, size=60):
            req_id = self._next_external_req_id()
            sent = await self._external_ws_send_json(
                ws,
                {"method": "UNSUBSCRIBE", "params": chunk, "id": req_id},
                context=f"binance:unsubscribe:{len(chunk)}",
            )
            if not sent:
                return False

        self._binance_external_subs = targets
        return True

    async def _sync_coinbase_ws_subscriptions(self, ws: aiohttp.ClientWebSocketResponse) -> bool:
        target_symbols = [s for s in self._current_external_symbols() if s not in self._coinbase_external_blocklist]
        targets = {self._coinbase_product_for_symbol(symbol) for symbol in target_symbols}
        to_sub = sorted(targets - self._coinbase_external_subs)
        to_unsub = sorted(self._coinbase_external_subs - targets)

        for product in to_sub:
            sent = await self._external_ws_send_json(
                ws,
                {"type": "subscribe", "channels": [{"name": "matches", "product_ids": [product]}]},
                context=f"coinbase:subscribe:{product}",
            )
            if not sent:
                return False

        for product in to_unsub:
            sent = await self._external_ws_send_json(
                ws,
                {"type": "unsubscribe", "channels": [{"name": "matches", "product_ids": [product]}]},
                context=f"coinbase:unsubscribe:{product}",
            )
            if not sent:
                return False

        self._coinbase_external_subs = targets
        return True

    def _handle_binance_external_message(self, raw: str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return

        if isinstance(data, dict) and "id" in data and "result" in data:
            try:
                req_id = int(data.get("id"))
            except Exception:
                req_id = None
            if req_id is not None:
                self._binance_external_pending.pop(req_id, None)
            return

        if isinstance(data, dict) and "code" in data and "msg" in data:
            stream = None
            try:
                req_id = int(data.get("id"))
            except Exception:
                req_id = None
            if req_id is not None:
                stream = self._binance_external_pending.pop(req_id, None)
            if stream:
                symbol = self._symbol_from_binance_payload(stream.split("@", 1)[0])
                if symbol:
                    self._binance_external_blocklist.add(symbol)
                    self._binance_external_subs.discard(stream)
                    logger.warning(
                        "External Binance stream rejected symbol=%s stream=%s err=%s",
                        symbol,
                        stream,
                        data.get("msg"),
                    )
                return
            logger.warning("External Binance WS error payload=%s", data)
            return
        payload = data.get("data") if isinstance(data, dict) and "data" in data else data
        if not isinstance(payload, dict):
            return
        if payload.get("e") != "aggTrade":
            return

        symbol = self._symbol_from_binance_payload(payload.get("s"))
        if not symbol:
            return

        now_ms = int(time.time() * 1000)
        self._apply_binance_spot_cvd(
            symbol,
            [
                {
                    "id": payload.get("a"),
                    "price": payload.get("p"),
                    "qty": payload.get("q"),
                    "isBuyerMaker": payload.get("m"),
                }
            ],
            now_ms,
        )
        self._emit_external_payloads(symbol, now_ms=now_ms, include_cvd=True, include_oi=False)

    def _handle_coinbase_external_message(self, raw: str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return

        msg_type = str(data.get("type", "")).lower()
        if msg_type in {"subscriptions", "heartbeat"}:
            return
        if msg_type == "error":
            blocked_products: Set[str] = set()
            product_id = data.get("product_id")
            if isinstance(product_id, str) and "-" in product_id:
                blocked_products.add(product_id.upper())
            product_ids = data.get("product_ids")
            if isinstance(product_ids, list):
                for product in product_ids:
                    if isinstance(product, str) and "-" in product:
                        blocked_products.add(product.upper())
            if not blocked_products:
                msg_text = f"{data.get('reason', '')} {data.get('message', '')}"
                blocked_products.update(set(re.findall(r"[A-Z0-9]{1,20}-USD", msg_text.upper())))

            for product in blocked_products:
                symbol = self._symbol_from_coinbase_product(product)
                if symbol:
                    self._coinbase_external_blocklist.add(symbol)
                    self._coinbase_external_subs.discard(product)
                    logger.warning("External Coinbase product blocked symbol=%s product=%s", symbol, product)
            logger.warning("Coinbase WS error payload=%s", data)
            return
        if msg_type not in {"match", "last_match"}:
            return

        symbol = self._symbol_from_coinbase_product(data.get("product_id"))
        if not symbol:
            return

        now_ms = int(time.time() * 1000)
        self._apply_coinbase_spot_cvd(
            symbol,
            [
                {
                    "trade_id": data.get("trade_id"),
                    "price": data.get("price"),
                    "size": data.get("size"),
                    "side": data.get("side"),
                }
            ],
            now_ms,
        )
        self._emit_external_payloads(symbol, now_ms=now_ms, include_cvd=True, include_oi=False)

    async def _refresh_binance_oi_symbol(self, session: aiohttp.ClientSession, symbol: str):
        now_ms = int(time.time() * 1000)
        spot_pair = f"{symbol}USDT"
        bin_oi_url = f"https://fapi.binance.com/fapi/v1/openInterest?symbol={spot_pair}"
        bin_oi = await self._safe_json_get(session, bin_oi_url)
        if bin_oi is None:
            return
        self._apply_binance_perp_oi(symbol, bin_oi, now_ms)
        self._emit_external_payloads(symbol, now_ms=now_ms, include_cvd=False, include_oi=True)

    async def _binance_ws_loop(self):
        url = "wss://fstream.binance.com/ws"
        reconnect_delay = self.external_reconnect_min_sec
        logger.info("External Binance WS loop started url=%s", url)
        while self.is_running and self.external_enabled:
            targets = self._current_external_symbols()
            if not targets:
                self._binance_external_subs.clear()
                self._binance_external_pending.clear()
                await asyncio.sleep(1.0)
                continue
            connected_at: Optional[float] = None
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(url, heartbeat=20) as ws:
                        connected_at = time.time()
                        reconnect_delay = self.external_reconnect_min_sec
                        self._binance_external_subs = set()
                        self._binance_external_pending.clear()
                        logger.info("External Binance WS connected symbols=%s", len(targets))
                        last_sync = 0.0
                        while self.is_running and self.external_enabled and not ws.closed:
                            now = time.time()
                            if now - last_sync >= self.external_ws_resync_sec:
                                synced = await self._sync_binance_ws_subscriptions(ws)
                                if not synced:
                                    break
                                last_sync = now

                            try:
                                msg = await asyncio.wait_for(ws.receive(), timeout=1.0)
                            except asyncio.TimeoutError:
                                continue

                            if msg.type == WSMsgType.TEXT:
                                self._handle_binance_external_message(msg.data)
                            elif msg.type == WSMsgType.ERROR:
                                ws_exc = ws.exception()
                                if ws_exc is not None and not self._is_expected_ws_shutdown_error(ws_exc):
                                    logger.warning("External Binance WS error=%s", self._format_exception(ws_exc))
                                break
                            elif msg.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING}:
                                break
                        uptime = (time.time() - connected_at) if connected_at else 0.0
                        if uptime >= self.stable_connection_sec:
                            reconnect_delay = self.external_reconnect_min_sec
                        else:
                            reconnect_delay = min(
                                self.external_reconnect_max_sec,
                                max(self.external_reconnect_min_sec + 0.5, reconnect_delay * 1.6),
                            )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if self._is_upstream_rate_limited_error(exc):
                    reconnect_delay = min(self.external_reconnect_max_sec, max(10.0, reconnect_delay * 2.0))
                    logger.warning(
                        "External Binance WS rate limited err=%s reconnect_in=%.1fs",
                        self._format_exception(exc),
                        reconnect_delay,
                    )
                else:
                    reconnect_delay = min(
                        self.external_reconnect_max_sec,
                        max(self.external_reconnect_min_sec + 0.5, reconnect_delay * 1.6),
                    )
                    logger.warning(
                        "External Binance WS reconnect err=%s reconnect_in=%.1fs",
                        self._format_exception(exc),
                        reconnect_delay,
                    )

            if not self.is_running or not self.external_enabled:
                break
            await asyncio.sleep(reconnect_delay + random.uniform(0.1, 0.8))

    async def _coinbase_ws_loop(self):
        url = "wss://ws-feed.exchange.coinbase.com"
        reconnect_delay = self.external_reconnect_min_sec
        logger.info("External Coinbase WS loop started url=%s", url)
        while self.is_running and self.external_enabled:
            targets = self._current_external_symbols()
            if not targets:
                self._coinbase_external_subs.clear()
                await asyncio.sleep(1.0)
                continue
            connected_at: Optional[float] = None
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(url, heartbeat=20) as ws:
                        connected_at = time.time()
                        reconnect_delay = self.external_reconnect_min_sec
                        self._coinbase_external_subs = set()
                        logger.info("External Coinbase WS connected symbols=%s", len(targets))
                        last_sync = 0.0
                        while self.is_running and self.external_enabled and not ws.closed:
                            now = time.time()
                            if now - last_sync >= self.external_ws_resync_sec:
                                synced = await self._sync_coinbase_ws_subscriptions(ws)
                                if not synced:
                                    break
                                last_sync = now

                            try:
                                msg = await asyncio.wait_for(ws.receive(), timeout=1.0)
                            except asyncio.TimeoutError:
                                continue

                            if msg.type == WSMsgType.TEXT:
                                self._handle_coinbase_external_message(msg.data)
                            elif msg.type == WSMsgType.ERROR:
                                ws_exc = ws.exception()
                                if ws_exc is not None and not self._is_expected_ws_shutdown_error(ws_exc):
                                    logger.warning("External Coinbase WS error=%s", self._format_exception(ws_exc))
                                break
                            elif msg.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING}:
                                break
                        uptime = (time.time() - connected_at) if connected_at else 0.0
                        if uptime >= self.stable_connection_sec:
                            reconnect_delay = self.external_reconnect_min_sec
                        else:
                            reconnect_delay = min(
                                self.external_reconnect_max_sec,
                                max(self.external_reconnect_min_sec + 0.5, reconnect_delay * 1.6),
                            )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                reconnect_delay = min(
                    self.external_reconnect_max_sec,
                    max(self.external_reconnect_min_sec + 0.5, reconnect_delay * 1.6),
                )
                logger.warning(
                    "External Coinbase WS reconnect err=%s reconnect_in=%.1fs",
                    self._format_exception(exc),
                    reconnect_delay,
                )

            if not self.is_running or not self.external_enabled:
                break
            await asyncio.sleep(reconnect_delay + random.uniform(0.1, 0.8))

    async def _binance_oi_loop(self):
        logger.info(
            "External Binance OI loop started poll_sec=%.2f max_symbols=%s",
            self.external_oi_poll_interval_sec,
            self.external_max_symbols,
        )
        while self.is_running and self.external_enabled:
            try:
                symbols = self._current_external_symbols()
                if not symbols:
                    await asyncio.sleep(self.external_oi_poll_interval_sec)
                    continue

                timeout = aiohttp.ClientTimeout(total=5)
                sem = asyncio.Semaphore(self.external_concurrency)
                async with aiohttp.ClientSession(timeout=timeout) as session:

                    async def _run(symbol: str):
                        async with sem:
                            await self._refresh_binance_oi_symbol(session, symbol)

                    await asyncio.gather(*(_run(symbol) for symbol in symbols), return_exceptions=True)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("External Binance OI loop error")
            await asyncio.sleep(self.external_oi_poll_interval_sec)

    async def _external_loop(self):
        logger.info(
            "External feed supervisor started enabled=%s ws_resync_sec=%.2f oi_poll_sec=%.2f max_symbols=%s",
            self.external_enabled,
            self.external_ws_resync_sec,
            self.external_oi_poll_interval_sec,
            self.external_max_symbols,
        )
        tasks = [
            asyncio.create_task(self._binance_ws_loop()),
            asyncio.create_task(self._coinbase_ws_loop()),
            asyncio.create_task(self._binance_oi_loop()),
        ]
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        finally:
            self._binance_external_subs.clear()
            self._coinbase_external_subs.clear()
            self._binance_external_pending.clear()

    async def _ws_loop(self):
        logger.info("Aggregator WebSocket loop started")
        url = "wss://api.hyperliquid.xyz/ws"
        reconnect_delay = self.reconnect_min_sec
        while self.is_running:
            connected_at: Optional[float] = None
            try:
                logger.info("Connecting to %s", url)
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(url, heartbeat=20) as ws:
                        self._ws = ws
                        self.upstream_connected = True
                        connected_at = time.time()
                        logger.info("✅ Aggregator: Connected to HL")
                        self.active_subs = set()

                        sent = await self._ws_send_json(
                            ws,
                            {"method": "subscribe", "subscription": {"type": "allMids"}},
                            context="subscribe:allMids",
                        )
                        if not sent:
                            break

                        while self.is_running and not ws.closed:
                            try:
                                current_targets = list(self.subscriptions)
                                pending = [coin for coin in current_targets if coin not in self.active_subs]
                                if pending:
                                    batch = pending[: self.subscribe_batch_size]
                                    send_failed = False
                                    for coin in batch:
                                        logger.info("📡 Aggregator: Requesting data for %s", coin)
                                        for sub_type in ("l2Book", "trades", "activeAssetCtx", "liquidations"):
                                            sent = await self._ws_send_json(
                                                ws,
                                                {
                                                    "method": "subscribe",
                                                    "subscription": {"type": sub_type, "coin": coin},
                                                },
                                                context=f"subscribe:{sub_type}:{coin}",
                                            )
                                            if not sent:
                                                send_failed = True
                                                break
                                            if self.subscribe_send_pause_sec > 0:
                                                await asyncio.sleep(self.subscribe_send_pause_sec)
                                        if send_failed:
                                            break
                                        self.active_subs.add(coin)
                                    if send_failed:
                                        break
                                    if len(pending) > self.subscribe_batch_size:
                                        await asyncio.sleep(self.subscribe_batch_pause_sec)

                                try:
                                    msg = await asyncio.wait_for(ws.receive(), timeout=0.5)
                                    if msg.type == WSMsgType.TEXT:
                                        data = json.loads(msg.data)
                                        self._handle_message(data)
                                    elif msg.type == WSMsgType.ERROR:
                                        ws_exc = ws.exception()
                                        if ws_exc is None:
                                            logger.warning("WS Error without exception close_code=%s", ws.close_code)
                                        elif self._is_expected_ws_shutdown_error(ws_exc):
                                            logger.info("WS Closed (expected) err=%s", self._format_exception(ws_exc))
                                        else:
                                            logger.error("WS Error: %s", self._format_exception(ws_exc))
                                        break
                                    elif msg.type in {WSMsgType.CLOSED, WSMsgType.CLOSING, WSMsgType.CLOSE}:
                                        self.last_ws_close_code = ws.close_code
                                        self.last_ws_close_ts = time.time()
                                        self.upstream_connected = False
                                        self.last_ws_close_reason = (
                                            f"closed pending={len([c for c in self.subscriptions if c not in self.active_subs])}"
                                        )
                                        logger.info(
                                            "WS Closed close_code=%s active=%s subs=%s",
                                            ws.close_code,
                                            len(self.active_subs),
                                            len(self.subscriptions),
                                        )
                                        break
                                except asyncio.TimeoutError:
                                    continue
                                except json.JSONDecodeError:
                                    continue
                            except Exception as e:
                                reason = self._format_exception(e)
                                self.last_ws_close_reason = reason
                                self.last_ws_close_ts = time.time()
                                self.upstream_connected = False
                                if self._is_expected_ws_shutdown_error(e):
                                    logger.info("Aggregator WS loop closed while sending/receiving err=%s", reason)
                                else:
                                    logger.error("⚠️ Aggregator Inner Loop Error: %s", reason)
                                break
                        uptime = (time.time() - connected_at) if connected_at is not None else 0.0
                        if uptime >= self.stable_connection_sec:
                            reconnect_delay = self.reconnect_min_sec
                        else:
                            reconnect_delay = min(
                                self.reconnect_max_sec,
                                max(self.reconnect_min_sec + 1.0, reconnect_delay * 1.6),
                            )
            except Exception as e:
                reason = self._format_exception(e)
                self.last_ws_close_reason = reason
                self.last_ws_close_ts = time.time()
                self.upstream_connected = False
                if self._is_expected_ws_shutdown_error(e):
                    reconnect_delay = min(
                        self.reconnect_max_sec,
                        max(self.reconnect_min_sec + 1.0, reconnect_delay * 1.4),
                    )
                    logger.warning("Aggregator WS disconnected err=%s. Reconnect in %.1fs.", reason, reconnect_delay)
                elif self._is_upstream_rate_limited_error(e):
                    reconnect_delay = min(
                        self.reconnect_max_sec,
                        max(20.0, reconnect_delay * 2.2),
                    )
                    logger.warning(
                        "Aggregator upstream rate limited err=%s. Reconnect in %.1fs.",
                        reason,
                        reconnect_delay,
                    )
                else:
                    reconnect_delay = min(
                        self.reconnect_max_sec,
                        max(self.reconnect_min_sec + 1.0, reconnect_delay * 1.6),
                    )
                    logger.error("❌ Aggregator Connection Failed: %s. Reconnect in %.1fs.", reason, reconnect_delay)
            finally:
                self._ws = None
                self.upstream_connected = False

            if not self.is_running:
                break

            wait_s = reconnect_delay + random.uniform(0.2, 1.5)
            await asyncio.sleep(wait_s)

    def _handle_message(self, msg: Dict[str, Any]):
        channel = msg.get("channel")
        data = msg.get("data")
        if not channel or not data:
            return

        coin = data.get("coin") if isinstance(data, dict) else None

        if channel == "allMids":
            mids = data.get("mids", {}) if isinstance(data, dict) else {}
            for c, px in mids.items():
                self._update_cache(c, "price", float(px))

        elif channel == "l2Book" and coin:
            logger.debug("Received l2Book for %s", coin)
            levels = data.get("levels")
            if levels and len(levels) >= 2:
                self._update_cache(coin, "book", levels)
                self._enqueue_alpha_update(
                    coin,
                    {
                        "orderbook_bids": [(float(l["px"]), float(l["sz"])) for l in levels[0][:25]],
                        "orderbook_asks": [(float(l["px"]), float(l["sz"])) for l in levels[1][:25]],
                        "_debug_book_count": len(levels[0]) + len(levels[1]),
                    },
                )
                self._update_cache(coin, "walls", self._detect_walls(levels))

        elif channel == "trades" and isinstance(data, list) and data:
            for t in data:
                c = t.get("coin")
                if c:
                    now_ms = int(time.time() * 1000)
                    px, sz, side = float(t.get("px", 0)), float(t.get("sz", 0)), t.get("side")
                    notional = px * sz
                    signed_notional = notional if side == "B" else -notional
                    self.cvd_data[c] = self.cvd_data.get(c, 0) + signed_notional

                    trade_obj = Trade(
                        price=px,
                        size=notional,
                        side="BUY" if side == "B" else "SELL",
                        timestamp=datetime.fromtimestamp(t.get("time", time.time() * 1000) / 1000, tz=timezone.utc),
                    )

                    self._enqueue_alpha_update(
                        c,
                        {
                            "price": px,
                            "trade_update": trade_obj,
                            "cvd_1m": self.cvd_data[c],
                            "cvd_hl_1m": self.cvd_data[c],
                            "cvd_hl_5m": self.cvd_data[c],
                            **self._build_external_cvd_payload(c, now_ms=now_ms),
                        },
                    )

                    if c not in self.data_cache:
                        self._update_cache(c, "price", px)
                    hist = self.data_cache[c].get("trades", [])
                    hist.insert(0, t)
                    self.data_cache[c]["trades"] = hist[:100]
                    self.data_cache[c]["price"] = px

        elif channel == "activeAssetCtx" and coin:
            ctx = data.get("ctx", {})
            oi = float(ctx.get("openInterest", 0))
            funding = float(ctx.get("funding", 0))
            oi_payload = self._build_external_oi_payload(coin, hl_oi=oi)
            self._enqueue_alpha_update(
                coin,
                {
                    "funding_rate": funding,
                    **oi_payload,
                },
            )
            self._update_cache(coin, "oi", oi)
            self._update_cache(coin, "funding", funding)

        elif channel == "liquidations" and coin:
            px, sz, side = float(data.get("px", 0)), float(data.get("sz", 0)), data.get("side")
            from src.alpha_engine.models.liquidation_models import LiquidationLevel

            if side not in {"B", "A"}:
                logger.warning("Unknown liquidation side=%s coin=%s payload=%s", side, coin, data)
            liq_side = "SHORT" if side == "B" else "LONG"
            liq_obj = LiquidationLevel(
                price=px,
                notional=sz * px,
                side=liq_side,
            )
            logger.info(f"=== AGGREGATOR LIQUIDATION: {coin} px={px} sz={sz} side={side} ===")
            self._enqueue_alpha_update(coin, {"liquidation_event": liq_obj})
            if coin not in self.data_cache:
                self.data_cache[coin] = {"price": 0, "book": [[], []], "trades": [], "walls": [], "liquidations": []}
            history = self.data_cache[coin].get("liquidations", [])
            history.insert(
                0,
                {
                    "coin": coin,
                    "px": f"{px}",
                    "sz": f"{sz}",
                    "side": liq_side.lower(),
                    "time": int(time.time() * 1000),
                },
            )
            self.data_cache[coin]["liquidations"] = history[:200]

    def _update_cache(self, coin: str, key: str, value: Any):
        if coin not in self.data_cache:
            self.data_cache[coin] = {"price": 0, "book": [[], []], "trades": [], "walls": [], "liquidations": []}

        now_ms = int(time.time() * 1000)
        if key == "book" and isinstance(value, list) and len(value) >= 2:
            self.data_cache[coin][key] = [value[0][:40], value[1][:40]]
            self.data_cache[coin]["book_ts"] = now_ms
        else:
            self.data_cache[coin][key] = value
        self.data_cache[coin]["updated_at"] = now_ms

        if key == "price":
            self.data_cache[coin]["price_ts"] = now_ms
            self._enqueue_alpha_update(coin, {"price": value, "timestamp": int(time.time() * 1000)})

    def _detect_walls(self, levels: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        walls = []
        try:
            bids, asks = levels[0][:20], levels[1][:20]
            avg = sum(float(l["sz"]) for l in (bids + asks)) / len(bids + asks)
            for i, side_l in enumerate([bids, asks]):
                side = "bid" if i == 0 else "ask"
                for l in side_l:
                    sz = float(l["sz"])
                    if sz > avg * 15:
                        walls.append({"px": l["px"], "sz": l["sz"], "side": side, "strength": "massive"})
                    elif sz > avg * 8:
                        walls.append({"px": l["px"], "sz": l["sz"], "side": side, "strength": "major"})
        except Exception:
            logger.exception("Failed wall detection for levels snapshot")
        return walls[:8]

    async def _broadcast_loop(self):
        while self.is_running:
            try:
                start = time.time()
                packet = {"type": "agg_update", "data": {}}
                for c in list(self.subscriptions):
                    if c in self.data_cache:
                        packet["data"][c] = {**self.data_cache[c], "cvd": round(self.cvd_data.get(c, 0), 2)}
                if packet["data"]:
                    await event_bus.publish(
                        "agg_update",
                        packet["data"],
                        source="aggregator",
                        channel="public",
                    )
                    self.last_broadcast_time = time.time()

                now_ms = int(time.time() * 1000)
                if now_ms - self._last_metrics_log_ms > 10_000:
                    self._last_metrics_log_ms = now_ms
                    logger.info(
                        "agg_metrics subs=%s active=%s cache=%s q_depth=%s dropped=%s",
                        len(self.subscriptions),
                        len(self.active_subs),
                        len(self.data_cache),
                        self.alpha_update_queue.qsize(),
                        self.alpha_drop_count,
                    )

                await asyncio.sleep(max(0.01, self.broadcast_interval - (time.time() - start)))
            except Exception as e:
                logger.error("⚠️ Broadcast Loop Error: %s", e)
                await asyncio.sleep(1)

    def subscribe(self, coin: str, source: str = "client") -> bool:
        symbol = self._normalize_symbol(coin)
        if not symbol:
            logger.warning("Rejecting invalid symbol subscription input=%r", coin)
            return False

        if symbol not in self.subscriptions and len(self.subscriptions) >= self.max_subscriptions:
            logger.warning(
                "Subscription cap reached max=%s rejecting symbol=%s source=%s",
                self.max_subscriptions,
                symbol,
                source,
            )
            return False

        was_new = symbol not in self.subscriptions
        self.subscriptions.add(symbol)

        if source == "system":
            self.system_symbols.add(symbol)
        else:
            self.client_refcounts[symbol] = self.client_refcounts.get(symbol, 0) + 1

        if was_new:
            logger.info("Subscribed symbol=%s source=%s total=%s", symbol, source, len(self.subscriptions))

        if source == "client":
            cached_book = self.data_cache.get(symbol, {}).get("book", [[], []])
            has_cached_book = (
                isinstance(cached_book, list)
                and len(cached_book) >= 2
                and isinstance(cached_book[0], list)
                and isinstance(cached_book[1], list)
                and (len(cached_book[0]) > 0 or len(cached_book[1]) > 0)
            )
            if not has_cached_book:
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    # No running loop in current context; websocket stream will hydrate later.
                    loop = None
                if loop is not None:
                    loop.create_task(self._hydrate_book_snapshot(symbol))
        return True

    def unsubscribe(self, coin: str, source: str = "client") -> bool:
        symbol = self._normalize_symbol(coin)
        if not symbol:
            return False

        if source == "system":
            self.system_symbols.discard(symbol)
        else:
            curr = self.client_refcounts.get(symbol, 0)
            if curr > 1:
                self.client_refcounts[symbol] = curr - 1
            else:
                self.client_refcounts.pop(symbol, None)

        should_keep = symbol in self.system_symbols or self.client_refcounts.get(symbol, 0) > 0
        if should_keep or symbol not in self.subscriptions:
            return False

        self.subscriptions.discard(symbol)
        self.active_subs.discard(symbol)
        self.data_cache.pop(symbol, None)
        self.cvd_data.pop(symbol, None)
        self.external_metrics.pop(symbol, None)
        logger.info("Unsubscribed symbol=%s total=%s", symbol, len(self.subscriptions))

        if self._ws is not None and not self._ws.closed:
            asyncio.create_task(self._send_unsubscribe(symbol))
        return True


aggregator = DataAggregator()
