"""Account isolation and retention without production DB, storage or hardware."""
import asyncio
import os
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
import sqlalchemy as sa
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db.repositories import operations as database
from app.storage import evidence as evidence
from app.storage import service as storage
import app.db.engine as engine_module
from app.db.engine import Connection
from app.db.schema import metadata
from app.auth.dependencies import get_current_user
from app.auth.stream_tokens import require_stream_user, require_snapshot_user
from tests.unit.test_api_security_registration import app_module


@pytest.fixture
def owned_database():
    engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(metadata.tables["users"].insert(), [{"id": 1}, {"id": 2}])
    # Patch captured modules directly: app_module temporarily replaces sys.modules.
    with patch.object(database, "get_connection", side_effect=lambda: Connection(engine.connect())), \
         patch.object(evidence, "get_connection", side_effect=lambda: Connection(engine.connect())), \
         patch.object(engine_module, "get_connection", side_effect=lambda: Connection(engine.connect())), \
         patch.object(engine_module, "get_engine", side_effect=AssertionError("Live database forbidden in offline tests")):
        yield
    engine.dispose()


def test_event_scope_and_camera_history_remain_separate(owned_database):
    own, _ = database.add_event("fire", .9, owner_user_id=1)
    database.add_event("smoke", .8, owner_user_id=2)
    video, _ = database.add_event("fire", .9, owner_user_id=1, source_kind="video", video_job_id="job")
    database.add_event("fire", .9)  # Unassigned legacy event.
    assert {row["id"] for row in database.get_recent_events(owner_user_id=1)} == {own, video}
    assert database.search_events(owner_user_id=1)["total"] == 1
    assert not database.update_event_status(own, "confirmed", "other", owner_user_id=2)
    assert database.update_event_status(own, "confirmed", "owner", owner_user_id=1)
    assert sum(row["count"] for row in database.get_daily_stats(owner_user_id=1)) == 1


def test_registered_snapshot_ownership_and_expiration(owned_database):
    evidence.register("private.jpg", 1, "video", "job")
    assert evidence.require_snapshot("private.jpg", 1)["source_id"] == "job"
    with pytest.raises(HTTPException) as denied:
        evidence.require_snapshot("private.jpg", 2)
    assert denied.value.status_code == 404
    with patch("app.storage.evidence.time.time", return_value=time.time() + 7 * 86400 + 1):
        with pytest.raises(HTTPException) as expired:
            evidence.require_snapshot("private.jpg", 1)
        assert expired.value.status_code == 410


def test_cleanup_retries_remote_failure_and_never_marks_failure_deleted(owned_database, tmp_path):
    evidence.register("expired.jpg", 1, "camera", "1")
    (tmp_path / "expired.jpg").write_bytes(b"jpeg")
    remote = Mock()
    remote.delete.side_effect = RuntimeError("offline")
    future = time.time() + 7 * 86400 + 1
    with patch.object(storage, "SNAPSHOT_DIR", str(tmp_path)), patch.object(storage, "enabled", return_value=True), \
         patch.object(storage, "_get_store", return_value=remote):
        storage.pin_snapshot("expired.jpg")
        try:
            assert storage.cleanup_evidence(future) == 0
            assert evidence.find("expired.jpg")["deleted_at"] is None
            assert (tmp_path / "expired.jpg").exists()
            remote.delete.side_effect = None
            assert storage.cleanup_evidence(future) == 1
            assert not (tmp_path / "expired.jpg").exists()
            assert evidence.find("expired.jpg")["deleted_at"] is not None
            assert storage.cleanup_evidence(future) == 0
        finally:
            storage.unpin_snapshot("expired.jpg")


def test_sync_does_not_resurrect_expired_file(owned_database, tmp_path):
    evidence.register("expired.jpg", 1, "video", "job")
    path = tmp_path / "expired.jpg"
    path.write_bytes(b"jpeg")
    os.utime(path, (0, 0))
    store = Mock()
    with patch.object(storage, "SNAPSHOT_DIR", str(tmp_path)), patch.object(storage, "_get_store", return_value=store), \
         patch.object(storage.time, "time", return_value=time.time() + 8 * 86400):
        storage._stop.clear()
        storage._sync_pending()
    store.put.assert_not_called()


def test_signing_requires_owner_and_clamps_ttl(owned_database):
    evidence.register("private.jpg", 1, "video", "job")
    store = Mock()
    store.snapshot_url.return_value = "https://storage.example/signed"
    with patch.object(storage, "S3_ENDPOINT", "https://storage.example"), patch.object(storage, "_get_store", return_value=store):
        url, ttl = storage.private_snapshot_url("private.jpg", 1)
        assert url == "https://storage.example/signed" and 0 < ttl <= 300
        assert store.snapshot_url.call_args.kwargs["expires_in"] <= 300
        store.reset_mock()
        with pytest.raises(HTTPException):
            storage.private_snapshot_url("private.jpg", 2)
        store.snapshot_url.assert_not_called()


def test_http_cross_account_camera_video_snapshot_and_history(app_module, owned_database):
    user = SimpleNamespace(id=1, username="owner", role="user")
    app_module.app.dependency_overrides[get_current_user] = lambda: user
    app_module.app.dependency_overrides[require_stream_user] = lambda: user
    app_module.app.dependency_overrides[require_snapshot_user] = lambda: user
    app_module.camera_manager.cameras = {2: SimpleNamespace(owner_user_id=2)}
    app_module.video_analyzer.get.return_value = {"id": "foreign", "owner_user_id": 2}
    app_module.storage.private_snapshot_url.side_effect = storage.private_snapshot_url
    evidence.register("foreign.jpg", 2, "video", "foreign")
    with patch("app.events.routes.log_action"), patch("app.events.routes.database", database), TestClient(app_module.app) as client:
        assert client.get("/cameras").json() == {"cameras": []}
        for method, path, body in [
            ("get", "/video_feed/2", None), ("get", "/video-analysis/foreign", None),
            ("post", "/video-analysis/foreign/cancel", None),
            ("post", "/video-analysis/foreign/playback", {"action": "restart"}),
            ("post", "/video-analysis/foreign/notifications/retry", {"event_type": "fire", "channel": "telegram"}),
            ("delete", "/cameras/2", None), ("put", "/cameras/2", {"name": "Stolen", "is_active": False}),
            ("post", "/cameras/2/toggle?active=false", None),
            ("get", "/snapshots/foreign.jpg", None), ("get", "/snapshot-access/foreign.jpg", None),
        ]:
            response = client.request(method, path, **({"json": body} if body is not None else {}))
            assert response.status_code == 404, (path, response.text)
        assert client.get("/history").json()["total"] == 0
    app_module.camera_manager.remove_camera.assert_not_called()
    app_module.video_analyzer.playback.assert_not_called()
    app_module.storage.read_snapshot.assert_not_called()


def test_broadcast_delivers_only_to_owner(app_module):
    owner = Mock(state=SimpleNamespace(media_user=SimpleNamespace(id=1)), send_json=AsyncMock())
    other = Mock(state=SimpleNamespace(media_user=SimpleNamespace(id=2)), send_json=AsyncMock())
    manager = app_module.ConnectionManager()
    manager.active_connections = [owner, other]
    asyncio.run(manager.broadcast({"id": 3, "owner_user_id": 1}))
    owner.send_json.assert_awaited_once_with({"id": 3})
    other.send_json.assert_not_awaited()


def test_owned_video_persists_alerts_and_survives_job_eviction(owned_database, tmp_path):
    import cv2
    import numpy as np
    import app.videos.analyzer as video
    source = tmp_path / "source.avi"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"MJPG"), 10, (32, 32))
    assert writer.isOpened()
    for _ in range(3):
        writer.write(np.zeros((32, 32, 3), dtype=np.uint8))
    writer.release()
    detect = lambda frame, **_: (frame, [{"class": "fire", "confidence": .95, "bbox": [1, 1, 20, 20]}])
    settings = lambda key, default=None: {"persistence": "1"}.get(key, default)
    callback = Mock()
    with patch.object(video, "UPLOAD_DIR", str(tmp_path / "uploads")), \
         patch.object(storage, "save_snapshot", return_value=None) as save, \
         patch.object(storage, "delete_snapshot") as delete, patch.object(evidence, "save_job") as checkpoint:
        analyzer = video.VideoAnalyzer(detect, settings, alert_callback=callback)
        try:
            job_id = analyzer.submit(str(source), "source.avi", 10, owner_user_id=1)
            analyzer._controls[job_id]["thread"].join(5)
            assert analyzer.get(job_id)["status"] == "done"
            assert save.call_args.kwargs["owner_user_id"] == 1
            assert save.call_args.kwargs["source_id"] == job_id
            assert checkpoint.call_args.args[0]["status"] == "done"
            assert callback.call_args.args[0]["owner_user_id"] == 1
            assert callback.call_args.args[0]["source_kind"] == "video"
            assert database.search_events(owner_user_id=1)["total"] == 0
            assert len(database.get_recent_events(owner_user_id=1)) == 1
            restarted = analyzer.playback(job_id, "restart")
            analyzer._controls[restarted]["thread"].join(5)
            assert analyzer.get(restarted)["owner_user_id"] == 1
            with patch.object(video, "MAX_JOBS_KEPT", 1):
                analyzer._prune()
            delete.assert_not_called()
        finally:
            analyzer.shutdown()


def test_websockets_do_not_leak_other_account_video_or_camera_state(app_module):
    from starlette.websockets import WebSocketDisconnect
    async def authorize(socket):
        socket.state.media_user = SimpleNamespace(id=1)
        return True
    app_module.video_analyzer.get.return_value = {"id": "foreign", "owner_user_id": 2}
    app_module.camera_manager.cameras = {
        1: SimpleNamespace(owner_user_id=1), 2: SimpleNamespace(owner_user_id=2)}
    app_module.camera_manager.detection_states.return_value = [{"camera_id": 1}, {"camera_id": 2}]
    with patch("app.cameras.streaming.authorize_websocket", side_effect=authorize), \
         patch("app.videos.routes.authorize_websocket", side_effect=authorize), TestClient(app_module.app) as client:
        with client.websocket_connect("/ws/video-analysis/foreign") as socket:
            with pytest.raises(WebSocketDisconnect) as denied:
                socket.receive_json()
            assert denied.value.code == 1008
        with client.websocket_connect("/ws/detections") as socket:
            assert socket.receive_json() == {"cameras": [{"camera_id": 1}]}


def test_signed_access_response_is_private_and_uses_authenticated_owner(app_module):
    app_module.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    app_module.storage.private_snapshot_url.return_value = ("https://storage.example/signed", 300)
    with TestClient(app_module.app) as client:
        response = client.get("/snapshot-access/owned.jpg")
        assert response.json()["url"] == "https://storage.example/signed"
        assert response.headers["cache-control"] == "no-store"
    app_module.storage.private_snapshot_url.assert_called_once_with("owned.jpg", 1)


def test_legacy_cleanup_removes_only_expired_generated_images(owned_database, tmp_path):
    names = ["video_old.jpg", "periodic_old.jpg", "event_old.jpg", "best.pt", "unrelated.jpg", "event_fresh.jpg"]
    for name in names:
        file = tmp_path / name
        file.write_bytes(b"test")
        if name != "event_fresh.jpg":
            os.utime(file, (0, 0))
    evidence.register("event_owned.jpg", 1, "camera", "1")
    (tmp_path / "event_owned.jpg").write_bytes(b"test")
    os.utime(tmp_path / "event_owned.jpg", (0, 0))
    with patch.object(storage, "SNAPSHOT_DIR", str(tmp_path)), patch.object(storage, "enabled", return_value=False):
        assert storage.cleanup_unregistered() == 3
    assert {file.name for file in tmp_path.iterdir()} == {"best.pt", "unrelated.jpg", "event_fresh.jpg", "event_owned.jpg"}
