from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv
from detection import FireDetector
from camera_manager import CameraManager
from video_analyzer import VideoAnalyzer, ALLOWED_EXT, MAX_UPLOAD_MB, UPLOAD_DIR
import database
import os
import uuid
import cv2
import asyncio
import time
import logging
import numpy as np

from contextlib import asynccontextmanager
import uvicorn

logger = logging.getLogger(__name__)

CAMERA_FPS = 30

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Lấy event loop hiện tại cho WebSocket broadcast
    global main_loop
    main_loop = asyncio.get_running_loop()
    
    # Cấu hình callback cho CameraManager
    camera_manager.alert_callback = broadcast_alert
    
    yield 
    # Shutdown
    camera_manager.shutdown()

app = FastAPI(title="AI Fire Detection System", lifespan=lifespan)

#  CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://192.168.1.12:3000"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

database.init_db()

# Initialize components
detector = FireDetector()
camera_manager = CameraManager(detector)
# Uploaded-video check uses the very same model (and lock) as the live cameras
video_analyzer = VideoAnalyzer(camera_manager.detect, database.get_setting)


# Mount snapshots directory
if not os.path.exists("snapshots"):
    os.makedirs("snapshots")
app.mount("/snapshots", StaticFiles(directory="snapshots"), name="snapshots")

# Connection Manager for WebSockets
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
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Connection is likely closed, ignore and let cleanup handle it
                pass

manager = ConnectionManager()
main_loop = None

def broadcast_alert(alert_data):
    """Safely broadcast alert data from background thread to WebSocket connections."""
    if main_loop:
        asyncio.run_coroutine_threadsafe(manager.broadcast(alert_data), main_loop)
    else:
        print("[WebSocket] Event loop not ready. Broadcast skipped.")



@app.get("/")
def read_root():
    return {"status": "ok", "message": "Fire Detection System API is running"}

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
async def video_feed_default(request: Request):
    """Default video feed for backwards compatibility (VideoFeed.tsx)"""
    first_cam = next(iter(camera_manager.cameras.keys()), 1)
    logger.info("[Stream %s] Default stream requested", first_cam)
    return StreamingResponse(generate_camera_stream(first_cam, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)

@app.get("/video_feed/{camera_id}")
async def video_feed_by_id(camera_id: int, request: Request):
    """Endpoint for grid view (CameraGrid.tsx)"""
    logger.info("[Stream %s] Camera stream requested", camera_id)
    return StreamingResponse(generate_camera_stream(camera_id, request),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=STREAM_HEADERS)

class CameraModel(BaseModel):
    source: str
    name: str

@app.get("/cameras")
def get_cameras():
    """Get list of cameras with real-time status details."""
    cameras = []
    for id, cam in camera_manager.cameras.items():
        cameras.append({
            "id": id, 
            "name": cam.name, 
            "source": str(cam.source),
            "is_active": cam.is_active,
            "status": cam.status
        })
    return {"cameras": cameras}

@app.post("/cameras")
def add_new_camera(cam: CameraModel):
    """Add a new camera."""
    new_id = camera_manager.add_camera(cam.source, cam.name)
    return {"status": "ok", "id": new_id, "message": "Camera added"}

@app.delete("/cameras/{camera_id}")
def delete_camera(camera_id: int):
    """Remove a camera."""
    if camera_manager.remove_camera(camera_id):
        return {"status": "ok", "message": "Camera removed"}
    raise HTTPException(status_code=404, detail="Camera not found")

@app.post("/cameras/{camera_id}/toggle")
def toggle_camera(camera_id: int, active: bool):
    """Enable or disable a camera."""
    if camera_manager.toggle_camera(camera_id, active):
        return {"status": "ok", "message": f"Camera {'enabled' if active else 'disabled'}"}
    raise HTTPException(status_code=404, detail="Camera not found")

# ---------------------------------------------------------------------------
# Video upload analysis (requires: pip install python-multipart)
# ---------------------------------------------------------------------------
@app.post("/video-analysis")
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

@app.get("/video-analysis")
def list_video_analyses():
    """Recent video analysis jobs (newest first)."""
    return {"jobs": video_analyzer.list()}

@app.get("/video-analysis/{job_id}")
def get_video_analysis(job_id: str):
    """Progress and result of one video analysis job."""
    job = video_analyzer.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job

@app.post("/video-analysis/{job_id}/cancel")
def cancel_video_analysis(job_id: str):
    if video_analyzer.cancel(job_id):
        return {"status": "ok", "message": "Cancelling"}
    raise HTTPException(status_code=404, detail="Job not found or already finished")

@app.get("/alerts")
def get_alerts():
    # Fetch recent events from database
    events = database.get_recent_events(limit=50)
    
    # Format for frontend
    formatted_alerts = []
    for event in events:
        formatted_alerts.append({
            "id": event["id"],
            "timestamp": event["timestamp"],
            "type": event["type"],
            "confidence": event["confidence"],
            "snapshot": event["snapshot_path"]
        })
        
    return {"alerts": formatted_alerts}

@app.get("/stats")
def get_stats():
    """Get daily event statistics."""
    stats = database.get_daily_stats()
    return {"stats": stats}

@app.get("/history")
def get_history(limit: int = 50, offset: int = 0):
    """Get historical events with pagination."""
    events = database.get_all_events(limit, offset)
    return {"events": events}

class SettingsModel(BaseModel):
    key: str
    value: str

@app.get("/settings")
def get_settings():
    """Get all settings (masking secrets)."""
    settings = database.get_all_settings()
    # Mask secrets for frontend display
    masked_keys = ["zalo_bot_token", "zalo_oa_access_token", "zalo_oa_refresh_token", "zalo_oa_secret_key", "telegram_bot_token"]
    for key in masked_keys:
        if key in settings and settings[key]:
            settings[key] = "********"
    return {"settings": settings}

@app.post("/settings")
def save_setting(setting: SettingsModel):
    """Save a setting."""
    # Don't save masked values back
    if setting.value == "********":
        return {"status": "skipped", "message": "Masked value ignored"}
    
    database.set_setting(setting.key, setting.value)
    return {"status": "ok", "message": "Setting saved"}

import notification

@app.post("/test-notification")
def test_notification():
    """Trigger a test notification."""
    # Use a placeholder image or None
    notification.trigger_notifications("TEST EVENT", 0.99, None)
    return {"status": "ok", "message": "Test notification triggered"}

# WebSocket Endpoint
@app.websocket("/ws/alerts")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket connection endpoint for real-time alert push."""
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open and listen for heartbeat or messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="info")