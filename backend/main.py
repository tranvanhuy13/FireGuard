"""
main.py - AI Fire Detection System API (login required)

Expected project layout:

    main.py
    detection.py, camera_manager.py, video_analyzer.py, notification.py, database.py
    auth/   (database.py, dependencies.py, models.py, routes.py, schemas.py, utils.py)
    users/  (models.py, routes.py, schemas.py)

Access rules
------------
PUBLIC     GET /                              health check
           POST /auth/signup, /auth/verify-otp, /auth/resend-otp
           /snapshots/*                       (must stay public: Zalo downloads the
                                               photo from public_base_url without a login)

LOGIN      Everything else. Send HTTP Basic credentials (the scheme used by
REQUIRED   auth/dependencies.get_current_user). Unverified accounts get 403.

BROWSER    <img src="/video_feed/1"> and WebSocket cannot send an Authorization
STREAMS    header, so: log in, call GET /auth/stream-token, then use
           /video_feed/1?token=...   and   /ws/alerts?token=...
"""
import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from typing import List, Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import (APIRouter, Depends, FastAPI, File, Form, HTTPException, Query,
                     Request, UploadFile, WebSocket, WebSocketDisconnect, status)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

import database
import notification
from auth.database import get_connection as get_auth_connection
from auth.dependencies import authenticate_user, get_current_user, get_user
from auth.routes import router as auth_router
from camera_manager import CameraManager
from detection import FireDetector
from users.routes import router as users_router
from video_analyzer import ALLOWED_EXT, MAX_UPLOAD_MB, UPLOAD_DIR, VideoAnalyzer

# ---------------------------------------------------------------------------
# Stream tokens (short-lived, signed) for <img> streams and WebSockets
# ---------------------------------------------------------------------------
STREAM_TOKEN_TTL_SECONDS = 60 * 60
# Set STREAM_TOKEN_SECRET in .env so tokens survive a server restart.
STREAM_TOKEN_SECRET = os.getenv("STREAM_TOKEN_SECRET") or secrets.token_hex(32)


def _sign(payload: str) -> str:
    return hmac.new(STREAM_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def create_stream_token(username: str) -> str:
    payload = f"{username}:{int(time.time()) + STREAM_TOKEN_TTL_SECONDS}"
    return f"{payload}:{_sign(payload)}"


def _lookup_active_user(username: str):
    conn = get_auth_connection()
    try:
        user = get_user(conn, username)
    finally:
        conn.close()
    return user if user and user.is_active else None


def verify_stream_token(token: Optional[str]):
    """Return the active User for a valid, unexpired token, otherwise None."""
    if not token:
        return None
    try:
        username, expires, signature = token.rsplit(":", 2)
        if not hmac.compare_digest(signature, _sign(f"{username}:{expires}")):
            return None
        if int(expires) < time.time():
            return None
    except ValueError:
        return None
    return _lookup_active_user(username)


optional_basic = HTTPBasic(auto_error=False)


def get_stream_user(
    token: Optional[str] = Query(None),
    credentials: Optional[HTTPBasicCredentials] = Depends(optional_basic),
):
    """Auth for video streams: a stream token (?token=...) or HTTP Basic credentials."""
    user = None
    if token:
        user = verify_stream_token(token)
    elif credentials:
        conn = get_auth_connection()
        try:
            user = authenticate_user(conn, credentials.username, credentials.password)
        finally:
            conn.close()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Login required")
    return user


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Event loop used to push alerts from background threads to WebSockets
    global main_loop
    main_loop = asyncio.get_running_loop()
    camera_manager.alert_callback = broadcast_alert
    yield
    camera_manager.shutdown()


app = FastAPI(title="AI Fire Detection System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://192.168.1.12:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

database.init_db()

detector = FireDetector()
camera_manager = CameraManager(detector)
# Uploaded-video check uses the very same model (and lock) as the live cameras
video_analyzer = VideoAnalyzer(camera_manager.detect, database.get_setting)

# Snapshots stay public on purpose (Zalo needs to download them by URL).
os.makedirs("snapshots", exist_ok=True)
app.mount("/snapshots", StaticFiles(directory="snapshots"), name="snapshots")

# Authentication / account routes (signup + OTP are public, /users/me is protected)
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(users_router, prefix="/users", tags=["users"])

# Every route on this router requires a verified, logged-in user.
protected = APIRouter(dependencies=[Depends(get_current_user)])


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
# Public
# ---------------------------------------------------------------------------
@app.get("/")
def read_root():
    return {"status": "ok", "message": "Fire Detection System API is running"}


# ---------------------------------------------------------------------------
# Login helpers
# ---------------------------------------------------------------------------
@protected.get("/auth/login")
def login(current_user=Depends(get_current_user)):
    """Check credentials (HTTP Basic). Returns the user profile on success."""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "is_active": current_user.is_active,
    }


@protected.get("/auth/stream-token")
def get_stream_token(current_user=Depends(get_current_user)):
    """Short-lived token for <img> video streams and the alerts WebSocket."""
    return {"token": create_stream_token(current_user.username),
            "expires_in": STREAM_TOKEN_TTL_SECONDS}


# ---------------------------------------------------------------------------
# Video streams (login via stream token or Basic)
# ---------------------------------------------------------------------------
STREAM_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate"}


async def generate_camera_stream(camera_id: int, request: Request):
    """
    Push every new frame as soon as the capture thread publishes it (~30 FPS).
    No fixed sleep, no re-sending of old frames, JPEG encoded once per frame.
    """
    frames_sent = 0
    last_id = -1
    logger.info("[Stream %s] Client connected", camera_id)
    try:
        while True:
            if await request.is_disconnected():
                break

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


@app.get("/video_feed")
async def video_feed_default(request: Request, user=Depends(get_stream_user)):
    """Default video feed for backwards compatibility (VideoFeed.tsx)"""
    first_cam = next(iter(camera_manager.cameras.keys()), 1)
    logger.info("[Stream %s] Default stream requested by %s", first_cam, user.username)
    return StreamingResponse(generate_camera_stream(first_cam, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)


@app.get("/video_feed/{camera_id}")
async def video_feed_by_id(camera_id: int, request: Request, user=Depends(get_stream_user)):
    """Endpoint for grid view (CameraGrid.tsx)"""
    logger.info("[Stream %s] Camera stream requested by %s", camera_id, user.username)
    return StreamingResponse(generate_camera_stream(camera_id, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------
class CameraModel(BaseModel):
    source: str
    name: str


@protected.get("/cameras")
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


@protected.post("/cameras")
def add_new_camera(cam: CameraModel):
    """Add a new camera."""
    new_id = camera_manager.add_camera(cam.source, cam.name)
    return {"status": "ok", "id": new_id, "message": "Camera added"}


@protected.delete("/cameras/{camera_id}")
def delete_camera(camera_id: int):
    """Remove a camera."""
    if camera_manager.remove_camera(camera_id):
        return {"status": "ok", "message": "Camera removed"}
    raise HTTPException(status_code=404, detail="Camera not found")


@protected.post("/cameras/{camera_id}/toggle")
def toggle_camera(camera_id: int, active: bool):
    """Enable or disable a camera."""
    if camera_manager.toggle_camera(camera_id, active):
        return {"status": "ok", "message": f"Camera {'enabled' if active else 'disabled'}"}
    raise HTTPException(status_code=404, detail="Camera not found")


# ---------------------------------------------------------------------------
# Video upload analysis (requires: pip install python-multipart)
# ---------------------------------------------------------------------------
@protected.post("/video-analysis")
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

    job_id = video_analyzer.submit(tmp_path, file.filename, sample_fps)
    logger.info("[Video %s] Queued '%s' (%.1f MB, %s fps)", job_id, file.filename, size / 1e6, sample_fps)
    return {"job_id": job_id}


@protected.get("/video-analysis")
def list_video_analyses():
    """Recent video analysis jobs (newest first)."""
    return {"jobs": video_analyzer.list()}


@protected.get("/video-analysis/{job_id}")
def get_video_analysis(job_id: str):
    """Progress and result of one video analysis job."""
    job = video_analyzer.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job


@protected.post("/video-analysis/{job_id}/cancel")
def cancel_video_analysis(job_id: str):
    if video_analyzer.cancel(job_id):
        return {"status": "ok", "message": "Cancelling"}
    raise HTTPException(status_code=404, detail="Job not found or already finished")


# ---------------------------------------------------------------------------
# Alerts, stats, history
# ---------------------------------------------------------------------------
@protected.get("/alerts")
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
        })
    return {"alerts": formatted_alerts}


@protected.get("/stats")
def get_stats():
    """Get daily event statistics."""
    return {"stats": database.get_daily_stats()}


@protected.get("/history")
def get_history(limit: int = 50, offset: int = 0):
    """Get historical events with pagination."""
    return {"events": database.get_all_events(limit, offset)}


# ---------------------------------------------------------------------------
# Settings & notifications
# ---------------------------------------------------------------------------
class SettingsModel(BaseModel):
    key: str
    value: str


@protected.get("/settings")
def get_settings():
    """Get all settings (masking secrets)."""
    settings = database.get_all_settings()
    masked_keys = ["zalo_bot_token", "zalo_oa_access_token", "zalo_oa_refresh_token",
                   "zalo_oa_secret_key", "telegram_bot_token"]
    for key in masked_keys:
        if key in settings and settings[key]:
            settings[key] = "********"
    return {"settings": settings}


@protected.post("/settings")
def save_setting(setting: SettingsModel):
    """Save a setting."""
    if setting.value == "********":      # never save the masked placeholder back
        return {"status": "skipped", "message": "Masked value ignored"}
    database.set_setting(setting.key, setting.value)
    return {"status": "ok", "message": "Setting saved"}


@protected.post("/test-notification")
def test_notification():
    """Trigger a test notification."""
    notification.trigger_notifications("TEST EVENT", 0.99, None)
    return {"status": "ok", "message": "Test notification triggered"}


# ---------------------------------------------------------------------------
# WebSocket (login via ?token=...)
# ---------------------------------------------------------------------------
@app.websocket("/ws/alerts")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    """Real-time alert push. Requires a valid stream token."""
    user = await asyncio.to_thread(verify_stream_token, token)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# Register all login-protected routes (must come after they are defined)
app.include_router(protected)


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="info")