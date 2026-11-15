from types import SimpleNamespace
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.db.repositories import operations as database
from app.db.engine import Connection
from app.db.schema import metadata
from app.events.routes import router
from app.auth.dependencies import get_current_user, get_db


@pytest.fixture
def event_database():
    engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(metadata.tables["events"].insert(), [
            {"timestamp": "2026-11-09 12:00:00", "type": "fire", "confidence": 0.9,
             "owner_user_id": 1, "camera_id": i, "camera_name": f"Gate {i}"} for i in range(1, 66)])
    with patch("app.db.repositories.operations.get_connection", side_effect=lambda: Connection(engine.connect())):
        yield
    engine.dispose()


def test_history_can_retrieve_old_events_and_preserves_camera_identity(event_database):
    first = database.search_events(10, 0)
    old = database.search_events(10, 60)
    assert first["total"] == 65
    assert len(old["events"]) == 5
    assert old["events"][-1]["camera_name"] == "Gate 1"
    assert database.search_events(search="Gate 1")["total"] == 11
    assert database.search_events(search="% OR 1=1")["total"] == 0


def test_export_watermark_ignores_new_insertions(event_database):
    initial = database.search_events(50)
    database.add_event("smoke", 0.8, camera_id=99, camera_name="New camera")
    old = database.search_events(50, 50, max_id=initial["max_id"])
    assert old["total"] == 65
    assert len(old["events"]) == 15


def test_status_endpoint_persists_actor_and_validates_contract(event_database):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: None
    with patch("app.events.routes.log_action"), TestClient(app) as client:
        assert client.patch("/alerts/1/status", json={"status": "confirmed"}).status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, username="reviewer")
        assert client.patch("/alerts/1/status", json={"status": "confirmed", "handler": "forged"}).status_code == 422
        assert client.patch("/alerts/1/status", json={"status": "invalid"}).status_code == 422
        assert client.patch("/alerts/999/status", json={"status": "confirmed"}).status_code == 404
        assert client.patch("/alerts/1/status", json={"status": "confirmed"}).status_code == 200
        data = client.get("/history?status=confirmed").json()
        assert data["total"] == 1
        assert data["events"][0]["handled_by"] == "reviewer"
        assert client.get("/history?limit=0").status_code == 422
        assert client.get("/history?sort=bad").status_code == 422
