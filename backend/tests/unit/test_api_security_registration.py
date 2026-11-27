"""Import the entire app with external services replaced, retaining real route registration."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient
from app.auth.dependencies import get_db, get_auth_db
from app.detection import rules as detection_rules  # Load native OpenCV/NumPy once, outside sys.modules patching.


@pytest.fixture
def app_module():
    camera = Mock(cameras={})
    video = Mock()
    from contextlib import ExitStack
    import importlib
    from app import bootstrap
    database, storage, notification = Mock(), Mock(), Mock()
    with ExitStack() as stack:
        for name, replacement in {
            "database": database, "storage": storage, "notification": notification,
            "CameraManager": Mock(return_value=camera),
            "VideoAnalyzer": Mock(return_value=video),
        }.items():
            stack.enter_context(patch.object(bootstrap, name, replacement))
        for name in ("app.core.routes", "app.auth.session_routes", "app.cameras.routes",
                     "app.cameras.streaming", "app.videos.routes", "app.settings.routes",
                     "app.notifications.delivery_routes", "app.storage.routes", "app.events.routes"):
            route_module = importlib.import_module(name)
            for attribute, replacement in (("database", database), ("storage", storage), ("notification", notification)):
                if hasattr(route_module, attribute):
                    stack.enter_context(patch.object(route_module, attribute, replacement))
        module = SimpleNamespace(app=bootstrap.create_app(detector_factory=Mock()), upload_router=bootstrap.upload_router,
                                 camera_manager=camera, video_analyzer=video, storage=storage,
                                 ConnectionManager=bootstrap.ConnectionManager)
        module.app.dependency_overrides[get_db] = lambda: Mock()
        module.app.dependency_overrides[get_auth_db] = lambda: Mock()
        yield module



@pytest.mark.parametrize("method,path", [
    ("GET", "/cameras"), ("POST", "/cameras"), ("DELETE", "/cameras/1"),
    ("POST", "/cameras/1/toggle?active=false"), ("GET", "/history"),
    ("GET", "/alerts"), ("GET", "/stats"),
    ("GET", "/video_feed/1"), ("GET", "/snapshots/example.jpg"),
])
def test_operational_routes_reject_anonymous_requests(app_module, method, path):
    with TestClient(app_module.app) as client:
        assert client.request(method, path).status_code == 401


@pytest.mark.parametrize("path", ["/ws/alerts", "/ws/detections"])
def test_sockets_reject_missing_credentials(app_module, path):
    from starlette.websockets import WebSocketDisconnect
    with patch("app.auth.stream_tokens.stream_is_authorized", return_value=False), TestClient(app_module.app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(path):
                pass


def test_configured_cors_has_no_development_regex(monkeypatch):
    from app.core.cors import cors_options
    monkeypatch.setenv("CORS_ORIGINS", "https://example.com, https://dashboard.example.com/")
    assert cors_options() == {"allow_origins": ["https://example.com", "https://dashboard.example.com"]}
    monkeypatch.setenv("CORS_ORIGINS", "https://example.com/path")
    with pytest.raises(ValueError):
        cors_options()


def test_camera_routes_validate_and_forward_real_sources(app_module):
    from app.auth.dependencies import get_current_user
    app_module.app.dependency_overrides[get_current_user] = lambda: Mock(id=1, username='operator')
    manager = app_module.camera_manager
    manager.add_camera.return_value = 7
    manager.update_camera.return_value = True
    with TestClient(app_module.app) as client:
        body = {'name': 'Gate', 'source': 'http://camera.local/live', 'is_active': True}
        assert client.post('/cameras', json=body).json()['id'] == 7
        manager.add_camera.assert_called_once_with(body['source'], 'Gate', True, owner_user_id=1)
        manager.cameras = {7: SimpleNamespace(owner_user_id=1)}
        body['source'] = 'https://camera.local/live.m3u8'
        assert client.put('/cameras/7', json=body).status_code == 200
        manager.update_camera.assert_called_once_with(7, 'Gate', True, source=body['source'])
        assert client.put('/cameras/7', json={'name': 'Renamed', 'is_active': True}).status_code == 200
        manager.update_camera.assert_called_with(7, 'Renamed', True, source=None)
        assert client.post('/cameras', json={**body, 'source': 'file:///private'}).status_code == 422
        for source in ('rtsp://camera.local/live', 'rtsps://camera.local/live'):
            assert client.post('/cameras', json={**body, 'source': source}).status_code == 422
            assert client.put('/cameras/7', json={**body, 'source': source}).status_code == 422
        assert manager.add_camera.call_count == 1
        assert manager.update_camera.call_count == 2
