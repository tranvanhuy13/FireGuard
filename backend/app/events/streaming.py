import asyncio
import logging
from typing import List, Optional
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from app.auth.stream_tokens import authorize_websocket
from app.core.runtime import runtime

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            if message.get("owner_user_id") != connection.state.media_user.id:
                continue
            try:
                payload = {key: value for key, value in message.items() if key != "owner_user_id"}
                await asyncio.wait_for(connection.send_json(payload), timeout=5)
            except Exception:
                pass


def broadcast_alert(alert_data):
    """Safely broadcast alert data from a background thread to WebSocket clients."""
    if runtime.main_loop:
        asyncio.run_coroutine_threadsafe(runtime.manager.broadcast(alert_data), runtime.main_loop)
    else:
        print("[WebSocket] Event loop not ready. Broadcast skipped.")


@router.websocket("/ws/alerts")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    """Real-time alert push."""
    if not await authorize_websocket(websocket):
        return
    await runtime.manager.connect(websocket)
    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                pass
            if not await authorize_websocket(websocket):
                return
    except WebSocketDisconnect:
        pass
    finally:
        runtime.manager.disconnect(websocket)
