import asyncio
import logging
import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from app.auth.stream_tokens import require_stream_user, stream_is_authorized, authorize_websocket
from app.core.runtime import runtime

logger = logging.getLogger(__name__)
router = APIRouter()

from app.cameras.routes import owned_camera
STREAM_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate"}


async def generate_camera_stream(camera_id: int, request: Request):
    """
    Push every new frame as soon as the capture thread publishes it (~30 FPS).
    No fixed sleep, no re-sending of old frames, JPEG encoded once per frame.
    """
    frames_sent = 0
    last_id = -1
    next_auth = 0.0
    logger.info("[Stream %s] Client connected", camera_id)
    camera = runtime.camera_manager.cameras.get(camera_id)
    try:
        while True:
            if (camera is None or runtime.camera_manager.cameras.get(camera_id) is not camera
                    or not camera.running or not camera.is_active):
                break
            if await request.is_disconnected():
                break
            if time.monotonic() >= next_auth:
                user = await asyncio.to_thread(stream_is_authorized, request.query_params.get("token"), return_user=True)
                if not user or camera.owner_user_id != user.id:
                    break
                next_auth = time.monotonic() + 30

            frame_id = runtime.camera_manager.get_frame_id(camera_id)
            if frame_id is None:                      # unknown camera
                await asyncio.sleep(0.2)
                continue
            if frame_id == last_id:                   # nothing new yet
                await asyncio.sleep(0.005)
                continue

            result = await asyncio.to_thread(runtime.camera_manager.get_jpeg, camera_id)
            if result is None:                        # no frame available yet
                await asyncio.sleep(0.05)
                continue

            last_id, jpeg = result
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n')
            frames_sent += 1
            if frames_sent == 1 or frames_sent % 300 == 0:
                logger.info("[Stream %s] Sent %s frames (latest JPEG: %s bytes)",
                            camera_id, frames_sent, len(jpeg))
    finally:
        logger.info("[Stream %s] Client disconnected after %s frames", camera_id, frames_sent)


@router.get("/video_feed")
async def video_feed_default(request: Request, token: Optional[str] = Query(None), current_user=Depends(require_stream_user)):
    """Default video feed for backwards compatibility (VideoFeed.tsx). A signed media token is required."""
    first_cam = next((key for key, camera in list(runtime.camera_manager.cameras.items())
                      if camera.owner_user_id == current_user.id), None)
    if first_cam not in runtime.camera_manager.cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
    logger.info("[Stream %s] Default stream requested", first_cam)
    return StreamingResponse(generate_camera_stream(first_cam, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)


@router.get("/video_feed/{camera_id}")
async def video_feed_by_id(camera_id: int, request: Request, token: Optional[str] = Query(None), current_user=Depends(require_stream_user)):
    """Endpoint for grid view (CameraGrid.tsx). A signed media token is required."""
    owned_camera(camera_id, current_user.id)
    logger.info("[Stream %s] Camera stream requested", camera_id)
    return StreamingResponse(generate_camera_stream(camera_id, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)


@router.websocket("/ws/detections")
async def camera_detection_updates(websocket: WebSocket):
    if not await authorize_websocket(websocket):
        return
    await websocket.accept()
    next_auth = time.monotonic() + 30
    try:
        while True:
            if time.monotonic() >= next_auth:
                if not await authorize_websocket(websocket):
                    return
                next_auth = time.monotonic() + 30
            states = runtime.camera_manager.detection_states()
            cameras = dict(list(runtime.camera_manager.cameras.items()))
            states = [state for state in states if cameras.get(state["camera_id"]) is not None
                      and cameras[state["camera_id"]].owner_user_id == websocket.state.media_user.id]
            await asyncio.wait_for(websocket.send_json({"cameras": states}), timeout=5)
            await asyncio.sleep(0.1)
    except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError):
        return
