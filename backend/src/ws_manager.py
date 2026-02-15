import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Set
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


@dataclass
class ConnectionContext:
    websocket: WebSocket
    user_id: Optional[str] = None
    symbols: Set[str] = field(default_factory=set)
    channels: Set[str] = field(default_factory=lambda: {"public"})


class ConnectionManager:
    """
    Manages WebSocket connections and broadcasting.
    Singleton pattern to ensure one manager across the app.
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConnectionManager, cls).__new__(cls)
            cls._instance.active_connections: Dict[WebSocket, ConnectionContext] = {}
        return cls._instance

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = ConnectionContext(websocket=websocket)
        logger.info("WebSocket connected total=%s", len(self.active_connections))

    def set_user(self, websocket: WebSocket, user_id: str):
        ctx = self.active_connections.get(websocket)
        if not ctx:
            return
        ctx.user_id = user_id
        ctx.channels.add("private")

    def subscribe_symbol(self, websocket: WebSocket, symbol: str):
        ctx = self.active_connections.get(websocket)
        if not ctx:
            return
        ctx.symbols.add(symbol.upper())

    def is_symbol_subscribed(self, websocket: WebSocket, symbol: str) -> bool:
        ctx = self.active_connections.get(websocket)
        if not ctx:
            return False
        return symbol.upper() in ctx.symbols

    def get_symbols(self, websocket: WebSocket) -> Set[str]:
        ctx = self.active_connections.get(websocket)
        if not ctx:
            return set()
        return set(ctx.symbols)

    def unsubscribe_symbol(self, websocket: WebSocket, symbol: str):
        ctx = self.active_connections.get(websocket)
        if not ctx:
            return
        ctx.symbols.discard(symbol.upper())

    def has_private_access(self, websocket: WebSocket) -> bool:
        ctx = self.active_connections.get(websocket)
        return bool(ctx and ctx.user_id)

    def disconnect(self, websocket: WebSocket):
        ctx = self.active_connections.pop(websocket, None)
        if not ctx:
            return
        if ctx.symbols:
            try:
                from src.services.aggregator import aggregator

                for symbol in ctx.symbols:
                    aggregator.unsubscribe(symbol, source="client")
            except Exception:
                logger.exception("Failed to release symbol subscriptions on disconnect")
        logger.info(f"WebSocket disconnected. Remaining: {len(self.active_connections)}")

    async def send_to_user(self, user_id: str, message: Dict[str, Any]):
        await self.broadcast(message, channel="private", user_id=user_id)

    @staticmethod
    def _is_socket_disconnected(websocket: WebSocket) -> bool:
        for state in (getattr(websocket, "client_state", None), getattr(websocket, "application_state", None)):
            if state is None:
                continue
            state_name = getattr(state, "name", str(state)).upper()
            if "DISCONNECTED" in state_name:
                return True
        return False

    @staticmethod
    def _is_expected_disconnect(exc: Exception) -> bool:
        if isinstance(exc, WebSocketDisconnect):
            return True
        msg = str(exc).lower()
        exc_name = exc.__class__.__name__.lower()
        if "disconnect" in exc_name or "closed" in exc_name:
            return True
        expected_fragments = (
            "connection closed",
            "websocket is not connected",
            "close message has been sent",
            "broken pipe",
            "brokenresourceerror",
            "endofstream",
        )
        return any(fragment in msg for fragment in expected_fragments)

    @staticmethod
    def _format_exception(exc: Exception) -> str:
        detail = str(exc).strip()
        if detail:
            return f"{exc.__class__.__name__}: {detail}"
        return repr(exc)

    async def broadcast(self, message: Dict[str, Any], channel: str = "public", user_id: Optional[str] = None):
        """Parallel non-blocking broadcast with channel/user filtering."""
        if not self.active_connections:
            return

        # Snapshot current connections to avoid race conditions
        current_contexts = list(self.active_connections.values())
        msg_type = message.get("type")
        msg_data = message.get("data")

        # Concurrent send to avoid bottlenecking on slow clients
        tasks = []
        recipients: list[ConnectionContext] = []
        stale: Set[WebSocket] = set()
        for ctx in current_contexts:
            if self._is_socket_disconnected(ctx.websocket):
                stale.add(ctx.websocket)
                continue

            if channel == "private":
                if not ctx.user_id:
                    continue
                if user_id and ctx.user_id != user_id:
                    continue

            payload = message
            # For high-volume agg updates, only send subscribed symbols when present.
            if msg_type == "agg_update" and isinstance(msg_data, dict) and ctx.symbols:
                filtered = {sym: val for sym, val in msg_data.items() if sym in ctx.symbols}
                if not filtered:
                    continue
                payload = {"type": msg_type, "data": filtered}

            try:
                encoded = json.dumps(payload)
            except Exception:
                logger.exception("Broadcast serialization failed type=%s channel=%s", msg_type, channel)
                continue

            recipients.append(ctx)
            tasks.append(ctx.websocket.send_text(encoded))

        for dead in stale:
            self.disconnect(dead)

        if not tasks:
            return

        results = await asyncio.gather(*tasks, return_exceptions=True)

        disconnected: Set[WebSocket] = set()
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                ctx = recipients[i]
                reason = self._format_exception(result)
                if self._is_expected_disconnect(result):
                    logger.info(
                        "Broadcast dropped disconnected client idx=%s user=%s symbols=%s err=%s",
                        i,
                        ctx.user_id or "anon",
                        len(ctx.symbols),
                        reason,
                    )
                else:
                    logger.warning(
                        "Broadcast failed client idx=%s user=%s symbols=%s err=%s",
                        i,
                        ctx.user_id or "anon",
                        len(ctx.symbols),
                        reason,
                    )
                disconnected.add(ctx.websocket)

        # Cleanup dead connections
        for dead in disconnected:
            self.disconnect(dead)

manager = ConnectionManager()
