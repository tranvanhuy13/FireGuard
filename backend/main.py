"""FireGuard API: verified accounts for operations; signed credentials for media."""
import asyncio
import logging
import math
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional
from typing import Literal

import uvicorn
from dotenv import load_dotenv
from fastapi import (APIRouter, Depends, FastAPI, File, Form, HTTPException, Query,
                     Request, UploadFile, WebSocket, WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).resolve().parent
# Shell/hosting variables win, then local overrides, then the shared .env.
load_dotenv(BACKEND_DIR / ".env.local")
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

import database
import notification
import storage
from auth.dependencies import get_current_user, require_admin
from auth.database import get_connection as get_auth_connection
from auth.routes import router as auth_router
from auth.stream_tokens import (STREAM_TOKEN_TTL_SECONDS, create_stream_token,
                                require_stream_user, require_snapshot_user,
                                stream_is_authorized, authorize_websocket)
from auth.upload import AuthenticatedUploadRoute, get_upload_user, UploadLimitMiddleware
from cors_config import cors_options
from camera_manager import CameraManager
from detection import FireDetector
from users.routes import router as users_router
from notification_routes import router as notification_router
from video_analyzer import ALLOWED_EXT, MAX_UPLOAD_MB, UPLOAD_DIR, VideoAnalyzer
from detection_rules import read_settings
from event_routes import router as event_router

# ---------------------------------------------------------------------------
# Media credentials are issued and verified by auth.stream_tokens
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Event loop used to push alerts from background threads to WebSockets
    global main_loop
    main_loop = asyncio.get_running_loop()
    camera_manager.alert_callback = broadcast_alert
    try:
        yield
    finally:
        try:
            video_analyzer.shutdown()
        finally:
            try:
                camera_manager.shutdown()
            finally:
                from db.engine import dispose_engine
                dispose_engine()


app = FastAPI(title="AI Fire Detection System", lifespan=lifespan)
upload_router = APIRouter(route_class=AuthenticatedUploadRoute)
app.add_middleware(UploadLimitMiddleware, max_bytes=(MAX_UPLOAD_MB + 1) * 1024 * 1024)

app.add_middleware(
    CORSMiddleware,
    **cors_options(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

database.init_db()


@app.get("/health/ready")
def database_readiness():
    try:
        database.init_db()
    except Exception:
        logger.warning("Database readiness check failed")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ready", "database": "mysql"}

# The model is not in git: in Docker it is downloaded from MinIO / GCS on first start
_model_path = Path(os.getenv("MODEL_PATH") or "best.pt")
MODEL_PATH = str(_model_path if _model_path.is_absolute() else BACKEND_DIR / _model_path)
storage.ensure_model(MODEL_PATH)
storage.start_sync()
detector = FireDetector(MODEL_PATH)
camera_manager = CameraManager(detector)
# Uploaded-video check uses the very same model (and lock) as the live cameras
video_analyzer = VideoAnalyzer(camera_manager.detect, database.get_setting, notification.trigger_notifications)


# Snapshots require account media credentials or a scoped notification signature.
# They may live in MinIO / GCS instead of on disk, so they are served by a route.
@app.get("/snapshots/{name}", dependencies=[Depends(require_snapshot_user)])
def get_snapshot(name: str):
    data = storage.read_snapshot(name)
    if data is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return Response(data, media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=86400"})


# Authentication / account routes (signup + OTP + /users/me)
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(users_router, prefix="/users", tags=["users"])
app.include_router(notification_router)
app.include_router(event_router)


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------
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
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()
main_loop = None


def broadcast_alert(alert_data):
    """Safely broadcast alert data from a background thread to WebSocket clients."""
    if main_loop:
        asyncio.run_coroutine_threadsafe(manager.broadcast(alert_data), main_loop)
    else:
        print("[WebSocket] Event loop not ready. Broadcast skipped.")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/")
def read_root():
    return {"status": "ok", "message": "Fire Detection System API is running"}


# ---------------------------------------------------------------------------
# Login helpers (these still check credentials - they are about the user)
# ---------------------------------------------------------------------------
@app.get("/auth/login")
def login(current_user=Depends(get_current_user)):
    """Check credentials (HTTP Basic). Returns the user profile on success."""
    name = getattr(current_user, "full_name", None) or current_user.username
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "is_active": current_user.is_active,
        "role": current_user.role,
        "full_name": getattr(current_user, "full_name", None) or "",
        "fullName": name,
        "phone": getattr(current_user, "phone", None) or "",
        "avatar_url": getattr(current_user, "avatar_url", None) or "",
        "avatarUrl": getattr(current_user, "avatar_url", None) or "",
    }


@app.get("/auth/stream-token")
def get_stream_token(current_user=Depends(get_current_user)):
    """Issue a password-bound credential for media and WebSockets."""
    return {"token": create_stream_token(current_user),
            "expires_in": STREAM_TOKEN_TTL_SECONDS}


# ---------------------------------------------------------------------------
# Video streams
# ---------------------------------------------------------------------------
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
    try:
        while True:
            if await request.is_disconnected():
                break
            if time.monotonic() >= next_auth:
                if not await asyncio.to_thread(stream_is_authorized, request.query_params.get("token")):
                    break
                next_auth = time.monotonic() + 30

            frame_id = camera_manager.get_frame_id(camera_id)
            if frame_id is None:                      # unknown camera
                await asyncio.sleep(0.2)
                continue
            if frame_id == last_id:                   # nothing new yet
                await asyncio.sleep(0.005)
                continue

            result = await asyncio.to_thread(camera_manager.get_jpeg, camera_id)
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


@app.get("/video_feed", dependencies=[Depends(require_stream_user)])
async def video_feed_default(request: Request, token: Optional[str] = Query(None)):
    """Default video feed for backwards compatibility (VideoFeed.tsx). A signed media token is required."""
    first_cam = next(iter(camera_manager.cameras.keys()), 1)
    logger.info("[Stream %s] Default stream requested", first_cam)
    return StreamingResponse(generate_camera_stream(first_cam, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)


@app.get("/video_feed/{camera_id}", dependencies=[Depends(require_stream_user)])
async def video_feed_by_id(camera_id: int, request: Request, token: Optional[str] = Query(None)):
    """Endpoint for grid view (CameraGrid.tsx). A signed media token is required."""
    logger.info("[Stream %s] Camera stream requested", camera_id)
    return StreamingResponse(generate_camera_stream(camera_id, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------
class CameraModel(BaseModel):
    source: str = "0"
    name: str
    is_active: bool = False


@app.get("/cameras", dependencies=[Depends(get_current_user)])
def get_cameras():
    """Get list of cameras with real-time status details."""
    cameras = []
    for id, cam in camera_manager.cameras.items():
        cameras.append({
            "id": id,
            "name": cam.name,
            "source": str(cam.source),
            "is_active": cam.is_active,
            "status": cam.status,
        })
    return {"cameras": cameras}


@app.post("/cameras", dependencies=[Depends(get_current_user)])
def add_new_camera(cam: CameraModel):
    """Add a new camera."""
    new_id = camera_manager.add_camera("0", cam.name, cam.is_active)
    return {"status": "ok", "id": new_id, "message": "Camera added"}


@app.delete("/cameras/{camera_id}", dependencies=[Depends(get_current_user)])
def delete_camera(camera_id: int):
    """Remove a camera."""
    if camera_manager.remove_camera(camera_id):
        return {"status": "ok", "message": "Camera removed"}
    raise HTTPException(status_code=404, detail="Camera not found")


@app.put("/cameras/{camera_id}", dependencies=[Depends(get_current_user)])
def update_camera(camera_id: int, cam: CameraModel):
    if camera_manager.update_camera(camera_id, cam.name, cam.is_active):
        return {"status": "ok", "message": "Camera updated"}
    raise HTTPException(status_code=404, detail="Camera not found")


@app.post("/cameras/{camera_id}/toggle", dependencies=[Depends(get_current_user)])
def toggle_camera(camera_id: int, active: bool):
    """Enable or disable a camera."""
    if camera_manager.toggle_camera(camera_id, active):
        return {"status": "ok", "message": f"Camera {'enabled' if active else 'disabled'}"}
    raise HTTPException(status_code=404, detail="Camera not found")


# ---------------------------------------------------------------------------
# Video upload analysis (requires: pip install python-multipart)
# ---------------------------------------------------------------------------
@upload_router.post("/video-analysis", dependencies=[Depends(get_upload_user)])
def upload_video_for_analysis(file: UploadFile = File(...), sample_fps: int = Form(5)):
    """Upload a video; it is analysed in the background with the live-camera model."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400,
                            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXT))}")

    sample_fps = max(1, min(sample_fps, 15))
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    tmp_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")
    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with open(tmp_path, "wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=413,
                                        detail=f"Video is too large (max {MAX_UPLOAD_MB} MB).")
                out.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    try:
        job_id = video_analyzer.submit(tmp_path, file.filename, sample_fps)
    except ValueError as error:
        os.remove(tmp_path)
        raise HTTPException(status_code=429, detail=str(error)) from error
    logger.info("[Video %s] Queued '%s' (%.1f MB, %s fps)", job_id, file.filename, size / 1e6, sample_fps)
    return {"job_id": job_id}


app.include_router(upload_router)


@app.get("/video-analysis", dependencies=[Depends(get_current_user)])
def list_video_analyses():
    """Recent video analysis jobs (newest first)."""
    return {"jobs": video_analyzer.list()}


@app.get("/video-analysis/{job_id}", dependencies=[Depends(get_current_user)])
def get_video_analysis(job_id: str):
    """Progress and result of one video analysis job."""
    job = video_analyzer.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job


@app.post("/video-analysis/{job_id}/cancel", dependencies=[Depends(get_current_user)])
def cancel_video_analysis(job_id: str):
    if video_analyzer.cancel(job_id):
        return {"status": "ok", "message": "Cancelling"}
    raise HTTPException(status_code=404, detail="Job not found or already finished")


class PlaybackControl(BaseModel):
    action: Literal["pause", "resume", "restart"]


class RetryVideoNotification(BaseModel):
    event_type: Literal["fire", "smoke"]
    channel: Literal["zalo", "telegram"]


@app.post("/video-analysis/{job_id}/notifications/retry")
def retry_video_notification(job_id: str, body: RetryVideoNotification,
                             current_user=Depends(get_current_user)):
    try:
        return video_analyzer.retry_notification(job_id, body.event_type, body.channel)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Analysis job not found") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/video-analysis/{job_id}/playback", dependencies=[Depends(get_current_user)])
def control_video_playback(job_id: str, control: PlaybackControl):
    try:
        return {"job_id": video_analyzer.playback(job_id, control.action)}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Analysis job not found") from error
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.websocket("/ws/video-analysis/{job_id}")
async def video_analysis_updates(websocket: WebSocket, job_id: str):
    if not await authorize_websocket(websocket):
        return
    await websocket.accept()
    next_auth = time.monotonic() + 30
    revision, frame_id = -1, -1
    try:
        while True:
            if time.monotonic() >= next_auth:
                if not await authorize_websocket(websocket):
                    return
                next_auth = time.monotonic() + 30
            job = video_analyzer.get(job_id, include_frame=True)
            if job is None:
                await websocket.close(code=1008, reason="Analysis job not found")
                return
            if job["revision"] != revision:
                revision = job["revision"]
                if job["frame_id"] == frame_id:
                    job.pop("frame", None)
                else:
                    frame_id = job["frame_id"]
                await asyncio.wait_for(websocket.send_json(job), timeout=5)
                if job["status"] in ("done", "error", "cancelled") and not job.get("notification_pending", 0):
                    await websocket.close()
                    return
            # Observe client disconnects even while a paused job has no updates.
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=0.04)
            except asyncio.TimeoutError:
                pass
    except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError):
        return


@app.websocket("/ws/detections")
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
            await asyncio.wait_for(websocket.send_json({"cameras": camera_manager.detection_states()}), timeout=5)
            await asyncio.sleep(0.1)
    except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError):
        return


# ---------------------------------------------------------------------------
# Alerts, stats, history
# ---------------------------------------------------------------------------
@app.get("/alerts", dependencies=[Depends(get_current_user)])
def get_alerts():
    events = database.get_recent_events(limit=50)
    formatted_alerts = []
    for event in events:
        formatted_alerts.append({
            "id": event["id"],
            "timestamp": event["timestamp"],
            "type": event["type"],
            "confidence": event["confidence"],
            "snapshot": event["snapshot_path"],
            "status": event["status"],
            "handled_by": event.get("handled_by"),
            "camera_id": event.get("camera_id"),
            "camera_name": event.get("camera_name"),
        })
    return {"alerts": formatted_alerts}


@app.get("/stats", dependencies=[Depends(get_current_user)])
def get_stats():
    """Get daily event statistics."""
    return {"stats": database.get_daily_stats()}


# ---------------------------------------------------------------------------
# Settings & notifications
# ---------------------------------------------------------------------------
class SettingsModel(BaseModel):
    key: str
    value: str


@app.get("/settings")
def get_settings(current_user=Depends(get_current_user)):
    """Get all settings (masking secrets)."""
    if current_user.role != "admin":
        return {"settings": {"alarm_sound_enabled": database.get_setting("alarm_sound_enabled", "true")}}
    settings = database.get_all_settings()
    effective = read_settings(database.get_setting)
    settings.update(fire_threshold=str(effective["fire"] * 100),
                    smoke_threshold=str(effective["smoke"] * 100),
                    persistence=str(effective["persistence"]), cooldown=str(effective["cooldown"]))
    masked_keys = ["zalo_bot_token", "zalo_oa_access_token", "zalo_oa_refresh_token",
                   "zalo_oa_secret_key", "telegram_bot_token"]
    for key in masked_keys:
        if key in settings and settings[key]:
            settings[key] = "********"
    return {"settings": settings}


@app.post("/settings")
def save_setting(setting: SettingsModel, current_user=Depends(get_current_user)):
    """Save a setting."""
    if current_user.role != "admin" and setting.key != "alarm_sound_enabled":
        raise HTTPException(status_code=403, detail="Admin permission required")
    if setting.value == "********":      # never save the masked placeholder back
        return {"status": "skipped", "message": "Masked value ignored"}
    bounds = {"fire_threshold": (0, 100), "smoke_threshold": (0, 100),
              "persistence": (1, 30), "cooldown": (0, 3600),
              "ai_confidence_threshold": (0, 1), "ai_persistence_frames": (1, 30),
              "ai_cooldown_seconds": (0, 3600)}
    if setting.key in bounds:
        try:
            value = float(setting.value)
            low, high = bounds[setting.key]
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError()
            if setting.key in ("persistence", "ai_persistence_frames") and not value.is_integer():
                raise ValueError()
        except ValueError as error:
            raise HTTPException(status_code=400, detail=f"Invalid value for {setting.key}") from error
    database.set_setting(setting.key, setting.value)
    return {"status": "ok", "message": "Setting saved"}


@app.post("/test-notification", dependencies=[Depends(require_admin)])
def test_notification():
    """Trigger a test notification."""
    results = notification.trigger_notifications("TEST EVENT", 0.99, None, bypass_cooldown=True)
    results = results if isinstance(results, dict) else {}
    sent = sum(result.get("status") == "sent" for result in results.values())
    status = "ok" if results and sent == len(results) else "partial" if sent else "error"
    return {"status": status, "channels": results,
            "message": "Test notification sent" if status == "ok" else
                       "Some channels did not send; check per-channel outcomes" if status == "partial" else
                       "No notification sent; check enabled channels, credentials and recipients"}


# ---------------------------------------------------------------------------
# Authenticated alert WebSocket
# ---------------------------------------------------------------------------
@app.websocket("/ws/alerts")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    """Real-time alert push."""
    if not await authorize_websocket(websocket):
        return
    await manager.connect(websocket)
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
        manager.disconnect(websocket)


@app.get("/audit-log", dependencies=[Depends(require_admin)])
def get_audit_log(limit: int = 200, offset: int = 0):
    """Return persisted audit history to administrators only."""
    conn = get_auth_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?",
            (max(1, min(limit, 500)), max(0, offset)),
        ).fetchall()
        return {"logs": [dict(row) for row in rows]}
    finally:
        conn.close()


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="info")
