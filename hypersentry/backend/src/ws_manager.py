import asyncio
import json
import logging
from typing import List, Dict, Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Manages WebSocket connections and broadcasting.
    Singleton pattern to ensure one manager across the app.
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConnectionManager, cls).__new__(cls)
            cls._instance.active_connections: List[WebSocket] = []
        return cls._instance

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Checking WebSocket connection... Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket disconnected. Remaining: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        """Parallel non-blocking broadcast to all connected clients."""
        if not self.active_connections:
            return

        # Snapshot current connections to avoid race conditions
        current_connections = list(self.active_connections)
        json_msg = json.dumps(message)
        
        # Concurrent send to avoid bottlenecking on slow clients
        tasks = [connection.send_text(json_msg) for connection in current_connections]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        disconnected = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(f"⚠️ Broadcast failed for client {i}: {result}")
                disconnected.append(current_connections[i])

        # Cleanup dead connections
        for dead in disconnected:
            self.disconnect(dead)

manager = ConnectionManager()
