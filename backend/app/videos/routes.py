from app.videos.schemas import PlaybackControl, RetryVideoNotification
import asyncio
import logging
import os
import time
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from app.auth.dependencies import get_current_user
from app.auth.stream_tokens import authorize_websocket
from app.auth.upload import AuthenticatedUploadRoute, get_upload_user
from app.videos.analyzer import ALLOWED_EXT, MAX_UPLOAD_MB, UPLOAD_DIR
from app.storage import evidence as evidence
from app.core.runtime import runtime

logger = logging.getLogger(__name__)
router = APIRouter()

upload_router = APIRouter(route_class=AuthenticatedUploadRoute)


def owned_job(job_id, user_id):
    job = runtime.video_analyzer.get(job_id)
    if job is None or job.get("owner_user_id") != user_id:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job


@upload_router.post("/video-analysis", dependencies=[Depends(get_upload_user)])
def upload_video_for_analysis(file: UploadFile = File(...), sample_fps: int = Form(5), current_user=Depends(get_upload_user)):
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
        job_id = runtime.video_analyzer.submit(tmp_path, file.filename, sample_fps, owner_user_id=current_user.id)
    except ValueError as error:
        os.remove(tmp_path)
        raise HTTPException(status_code=429, detail=str(error)) from error
    except Exception:
        os.remove(tmp_path)
        raise
    logger.info("[Video %s] Queued '%s' (%.1f MB, %s fps)", job_id, file.filename, size / 1e6, sample_fps)
    return {"job_id": job_id}


@router.get("/video-analysis")
def list_video_analyses(current_user=Depends(get_current_user)):
    """Recent video analysis jobs (newest first)."""
    live = [job for job in runtime.video_analyzer.list() if job.get("owner_user_id") == current_user.id]
    live_ids = {job["id"] for job in live}
    return {"jobs": live + [job for job in evidence.archived_jobs(current_user.id) if job["id"] not in live_ids]}


@router.get("/video-analysis/{job_id}")
def get_video_analysis(job_id: str, current_user=Depends(get_current_user)):
    """Progress and result of one video analysis job."""
    job = runtime.video_analyzer.get(job_id)
    if job is None:
        job = next(iter(evidence.archived_jobs(current_user.id, job_id)), None)
    if job is None or job.get("owner_user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job


@router.post("/video-analysis/{job_id}/cancel")
def cancel_video_analysis(job_id: str, current_user=Depends(get_current_user)):
    owned_job(job_id, current_user.id)
    if runtime.video_analyzer.cancel(job_id):
        return {"status": "ok", "message": "Cancelling"}
    raise HTTPException(status_code=404, detail="Job not found or already finished")






@router.post("/video-analysis/{job_id}/notifications/retry")
def retry_video_notification(job_id: str, body: RetryVideoNotification,
                             current_user=Depends(get_current_user)):
    owned_job(job_id, current_user.id)
    try:
        return runtime.video_analyzer.retry_notification(job_id, body.event_type, body.channel)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Analysis job not found") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/video-analysis/{job_id}/playback")
def control_video_playback(job_id: str, control: PlaybackControl, current_user=Depends(get_current_user)):
    owned_job(job_id, current_user.id)
    try:
        return {"job_id": runtime.video_analyzer.playback(job_id, control.action)}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Analysis job not found") from error
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.websocket("/ws/video-analysis/{job_id}")
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
            job = runtime.video_analyzer.get(job_id, include_frame=True)
            if job is None or job.get("owner_user_id") != websocket.state.media_user.id:
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
