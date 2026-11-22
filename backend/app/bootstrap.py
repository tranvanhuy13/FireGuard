"""Application construction and lifecycle; route imports are side-effect free of startup."""
from app.core.config import load_environment, model_path
load_environment()

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.timing import ListTimingMiddleware
from app.core.runtime import runtime
from app.db.repositories import operations as database
from app.notifications import service as notification
from app.storage import service as storage
from app.cameras.manager import CameraManager
from app.videos.analyzer import MAX_UPLOAD_MB, VideoAnalyzer
from app.auth.upload import UploadLimitMiddleware
from app.core.cors import cors_options
from app.auth.routes import router as auth_router
from app.users.routes import router as users_router
from app.notifications.routes import router as notification_router
from app.events.routes import router as event_router
from app.auth.session_routes import router as session_router
from app.cameras.routes import router as camera_router
from app.cameras.streaming import router as streaming_router
from app.videos.routes import router as video_router, upload_router
from app.settings.routes import router as settings_router
from app.notifications.delivery_routes import router as notification_test_router
from app.storage.routes import router as storage_router
from app.core.routes import router as health_router
from app.events.streaming import router as alert_router, ConnectionManager, broadcast_alert

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.main_loop = asyncio.get_running_loop()
    runtime.camera_manager.alert_callback = broadcast_alert
    runtime.video_analyzer.alert_callback = broadcast_alert
    try:
        yield
    finally:
        try:
            runtime.video_analyzer.shutdown()
        finally:
            try:
                runtime.camera_manager.shutdown()
            finally:
                from app.db.engine import dispose_engine
                dispose_engine()
                runtime.main_loop = None

def create_app(*, detector_factory=None, camera_factory=None, video_factory=None):
    if detector_factory is None:
        from app.detection.detector import FireDetector
        detector_factory = FireDetector
    database.init_db()
    path = model_path()
    storage.ensure_model(path)
    storage.start_sync()
    detector = detector_factory(path)
    runtime.camera_manager = (camera_factory or CameraManager)(detector)
    runtime.video_analyzer = (video_factory or VideoAnalyzer)(runtime.camera_manager.detect, database.get_setting, notification.trigger_notifications)
    runtime.manager = ConnectionManager()
    app = FastAPI(title="AI Fire Detection System", lifespan=lifespan)
    app.add_middleware(ListTimingMiddleware)
    app.add_middleware(UploadLimitMiddleware, max_bytes=(MAX_UPLOAD_MB + 1) * 1024 * 1024)
    app.add_middleware(CORSMiddleware, **cors_options(), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    app.include_router(auth_router, prefix="/auth", tags=["auth"])
    app.include_router(users_router, prefix="/users", tags=["users"])
    app.include_router(notification_router)
    app.include_router(event_router)
    for router in (health_router, session_router, camera_router, streaming_router, upload_router,
                   video_router, settings_router, notification_test_router, storage_router, alert_router):
        app.include_router(router)
    return app
