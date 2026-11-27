"""Offline unit tests for settings, camera ownership, event alerts/stats, and detection rule edges."""
import math
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.cameras import routes as camera_routes
from app.detection import rules
from app.events import routes as event_routes
from app.settings import routes as settings_routes


def test_settings_rbac_masking_and_boundaries():
    store = {"telegram_bot_token": "secret-token", "alarm_sound_enabled": "true", "fire_threshold": "75"}
    actor = SimpleNamespace(id=1, role="user")
    app = FastAPI()
    app.include_router(settings_routes.router)
    app.dependency_overrides[get_current_user] = lambda: actor

    fake_db = SimpleNamespace(
        get_setting=lambda key, default=None: store.get(key, default),
        get_all_settings=lambda: dict(store),
        set_setting=lambda key, val: store.__setitem__(key, val),
    )
    with patch.object(settings_routes, "database", fake_db), \
         patch.object(settings_routes.notification, "configuration_status", return_value=({}, {})), \
         TestClient(app) as client:
        # Non-admin reads only alarm_sound_enabled and cannot update AI thresholds
        res_user = client.get("/settings")
        assert res_user.status_code == 200
        assert res_user.json() == {"settings": {"alarm_sound_enabled": "true"}}
        assert client.post("/settings", json={"key": "fire_threshold", "value": "80"}).status_code == 403
        assert client.post("/settings", json={"key": "alarm_sound_enabled", "value": "false"}).status_code == 200
        assert store["alarm_sound_enabled"] == "false"

        # Admin sees masked secret, masked placeholder write is skipped, and bounds are enforced
        actor.role = "admin"
        assert client.get("/settings").json()["settings"]["telegram_bot_token"] == "********"
        assert client.post("/settings", json={"key": "telegram_bot_token", "value": "********"}).json()["status"] == "skipped"
        assert store["telegram_bot_token"] == "secret-token"

        for bad_key, bad_val in [
            ("fire_threshold", "-0.1"), ("fire_threshold", "100.1"), ("fire_threshold", "nan"),
            ("smoke_threshold", "inf"), ("persistence", "2.5"), ("persistence", "0"),
            ("persistence", "31"), ("cooldown", "-1"), ("cooldown", "3601"),
        ]:
            assert client.post("/settings", json={"key": bad_key, "value": bad_val}).status_code == 400

        for ok_key, ok_val in [("fire_threshold", "0"), ("fire_threshold", "100"),
                               ("persistence", "1"), ("persistence", "30"), ("cooldown", "3600")]:
            assert client.post("/settings", json={"key": ok_key, "value": ok_val}).status_code == 200


def test_camera_routes_ownership_isolation_and_manager_missing_404():
    actor = SimpleNamespace(id=1, username="owner1")
    app = FastAPI()
    app.include_router(camera_routes.router)
    app.dependency_overrides[get_current_user] = lambda: actor

    manager = Mock()
    manager.cameras = {
        10: SimpleNamespace(name="Cam A", source="0", is_active=True, status="connected", owner_user_id=1),
        20: SimpleNamespace(name="Cam B", source="1", is_active=False, status="disconnected", owner_user_id=2),
    }
    manager.remove_camera.return_value = False
    manager.update_camera.return_value = False
    manager.toggle_camera.return_value = False

    with patch.object(camera_routes, "runtime", SimpleNamespace(camera_manager=manager)), \
         TestClient(app) as client:
        listed = client.get("/cameras").json()["cameras"]
        assert [c["id"] for c in listed] == [10]

        # Foreign user camera access must appear as 404
        assert client.delete("/cameras/20").status_code == 404
        assert client.put("/cameras/20", json={"name": "Hijack", "is_active": True}).status_code == 404
        assert client.post("/cameras/20/toggle?active=true").status_code == 404

        # Manager failure for owned camera returns 404 rather than silent 200
        assert client.delete("/cameras/10").status_code == 404
        assert client.put("/cameras/10", json={"name": "Cam A", "is_active": False}).status_code == 404
        assert client.post("/cameras/10/toggle?active=false").status_code == 404


def test_alerts_and_stats_scope_by_owner():
    actor = SimpleNamespace(id=42, username="operator42")
    app = FastAPI()
    app.include_router(event_routes.router)
    app.dependency_overrides[get_current_user] = lambda: actor

    fake_db = SimpleNamespace(
        get_recent_events=Mock(return_value=[{
            "id": 5, "timestamp": "2026-11-26 10:00:00", "type": "smoke", "confidence": 0.91,
            "snapshot_path": "/snapshots/cam.jpg", "status": "new", "handled_by": None,
            "camera_id": 1, "camera_name": "Gate 1", "source_kind": "camera",
        }]),
        get_daily_stats=Mock(return_value=[{"date": "2026-11-26", "count": 3}]),
    )
    with patch.object(event_routes, "database", fake_db), TestClient(app) as client:
        alerts = client.get("/alerts").json()["alerts"]
        assert alerts[0]["source_kind"] == "camera"
        assert alerts[0]["camera_name"] == "Gate 1"
        fake_db.get_recent_events.assert_called_once_with(limit=50, owner_user_id=42)

        stats = client.get("/stats").json()["stats"]
        assert stats == [{"date": "2026-11-26", "count": 3}]
        fake_db.get_daily_stats.assert_called_once_with(owner_user_id=42)


def test_detection_rules_boundary_values():
    assert rules.normalize_class("  FLAME ") == "fire"
    assert rules.normalize_class("Flames") == "fire"
    settings = rules.read_settings(lambda k, d=None: {"fire_threshold": "nan", "persistence": "99"}.get(k, d))
    assert math.isclose(settings["fire"], 0.25)
    assert settings["persistence"] == 30  # Clamped to upper bound 30

    accepted = rules.filter_detections([
        {"class": "flame", "confidence": 0.5},
        {"class": "fire", "confidence": float("nan")},
        {"class": "person", "confidence": 0.99},
    ], {"fire": 0.5, "smoke": 0.5})
    assert len(accepted) == 1 and accepted[0]["class"] == "fire"
