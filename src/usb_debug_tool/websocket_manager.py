"""
WebSocket connection management for real-time updates.

Handles multiple client connections and broadcasts USB events.
"""

from __future__ import annotations
import asyncio
import logging
from typing import Any
from fastapi import WebSocket

from .models import USBEvent

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages WebSocket connections and broadcasts."""

    def __init__(self):
        self._connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket connection."""
        await websocket.accept()
        async with self._lock:
            self._connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self._connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        async with self._lock:
            if websocket in self._connections:
                self._connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self._connections)}")

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast a message to all connected clients."""
        if not self._connections:
            return

        # Create tasks for all sends
        async with self._lock:
            connections = self._connections.copy()

        disconnected: list[WebSocket] = []

        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                disconnected.append(websocket)

        # Remove disconnected clients
        if disconnected:
            async with self._lock:
                for ws in disconnected:
                    if ws in self._connections:
                        self._connections.remove(ws)

    async def broadcast_event(self, event: USBEvent) -> None:
        """Broadcast a USB event to all clients."""
        message = event.to_websocket_message()
        await self.broadcast(message)

    @property
    def connection_count(self) -> int:
        """Get number of active connections."""
        return len(self._connections)

    async def send_to_client(self, websocket: WebSocket, message: dict[str, Any]) -> bool:
        """Send a message to a specific client."""
        try:
            await websocket.send_json(message)
            return True
        except Exception as e:
            logger.warning(f"Failed to send to client: {e}")
            await self.disconnect(websocket)
            return False


# Global WebSocket manager instance
_ws_manager: WebSocketManager | None = None


def get_ws_manager() -> WebSocketManager:
    """Get or create the global WebSocket manager."""
    global _ws_manager
    if _ws_manager is None:
        _ws_manager = WebSocketManager()
    return _ws_manager
