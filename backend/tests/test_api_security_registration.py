"""Import the entire app with external services replaced, retaining real route registration."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient
from auth.dependencies import get_db
import detection_rules  # Load native OpenCV/NumPy once, outside sys.modules patching.


@pytest.fixture
def app_module():
    camera = Mock(cameras={})
    video = Mock()
    services = {
        "database": Mock(), "storage": Mock(), "notification": Mock(),
        "camera_manager": SimpleNamespace(CameraManager=Mock(return_value=camera)),
        "detection": SimpleNamespace(FireDetector=Mock()),
        "video_analyzer": SimpleNamespace(ALLOWED_EXT={".mp4"}, MAX_UPLOAD_MB=500,
                                         UPLOAD_DIR="unused", VideoAnalyzer=Mock(return_value=video)),
    }
    with patch.dict("sys.modules", services):
        spec = importlib.util.spec_from_file_location("review_api_app", Path(__file__).resolve().parents[1] / "main.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.app.dependency_overrides[get_db] = lambda: Mock()
        yield module


@pytest.mark.parametrize("method,path", [
    ("GET", "/cameras"), ("POST", "/cameras"), ("DELETE", "/cameras/1"),
    ("POST", "/cameras/1/toggle?active=false"), ("GET", "/history"),
    ("GET", "/alerts"), ("GET", "/stats"), ("GET", "/video-analysis"),
    ("POST", "/video-analysis/job/cancel"), ("POST", "/video-analysis/job/playback"),
    ("GET", "/video_feed/1"), ("GET", "/snapshots/example.jpg"),
])
def test_operational_routes_reject_anonymous_requests(app_module, method, path):
    with TestClient(app_module.app) as client:
        assert client.request(method, path).status_code == 401


def test_upload_registration_authenticates_before_reading_body(app_module):
    route = next(route for route in app_module.upload_router.routes if route.path == "/video-analysis")
    from auth.upload import AuthenticatedUploadRoute
    assert isinstance(route, AuthenticatedUploadRoute)
    with TestClient(app_module.app) as client:
        assert client.post("/video-analysis", content=b"invalid multipart").status_code == 401


@pytest.mark.parametrize("path", ["/ws/alerts", "/ws/detections", "/ws/video-analysis/job"])
def test_sockets_reject_missing_credentials(app_module, path):
    from starlette.websockets import WebSocketDisconnect
    with patch("auth.stream_tokens.stream_is_authorized", return_value=False), TestClient(app_module.app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(path):
                pass


def test_configured_cors_has_no_development_regex(monkeypatch):
    from cors_config import cors_options
    monkeypatch.setenv("CORS_ORIGINS", "https://example.com, https://dashboard.example.com/")
    assert cors_options() == {"allow_origins": ["https://example.com", "https://dashboard.example.com"]}
    monkeypatch.setenv("CORS_ORIGINS", "https://example.com/path")
    with pytest.raises(ValueError):
        cors_options()


def test_camera_routes_validate_and_forward_real_sources(app_module):
    from auth.dependencies import get_current_user
    app_module.app.dependency_overrides[get_current_user] = lambda: Mock(id=1, username='operator')
    manager = app_module.camera_manager
    manager.add_camera.return_value = 7
    manager.update_camera.return_value = True
    with TestClient(app_module.app) as client:
        body = {'name': 'Gate', 'source': 'rtsp://camera.local/live', 'is_active': True}
        assert client.post('/cameras', json=body).json()['id'] == 7
        manager.add_camera.assert_called_once_with(body['source'], 'Gate', True, owner_user_id=1)
        manager.cameras = {7: SimpleNamespace(owner_user_id=1)}
        body['source'] = 'https://camera.local/live.m3u8'
        assert client.put('/cameras/7', json=body).status_code == 200
        manager.update_camera.assert_called_once_with(7, 'Gate', True, source=body['source'])
        assert client.put('/cameras/7', json={'name': 'Renamed', 'is_active': True}).status_code == 200
        manager.update_camera.assert_called_with(7, 'Renamed', True, source=None)
        assert client.post('/cameras', json={**body, 'source': 'file:///private'}).status_code == 422
        assert manager.add_camera.call_count == 1
