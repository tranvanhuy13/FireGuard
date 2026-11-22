from unittest.mock import patch

import pytest
import sqlalchemy as sa
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI
from fastapi.testclient import TestClient
from types import SimpleNamespace
from app.db.engine import Connection
from app.db.schema import metadata
from app.db.repositories import audit
from app.auth.session_routes import router
from app.auth.dependencies import get_current_user


@pytest.fixture
def audit_db():
    engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(metadata.tables["audit_log"].insert(), [dict(timestamp="2026-11-22T00:00:00+00:00",
                     username="owner", role="admin", action="camera.create", target=f"camera:{i}") for i in range(65)])
    with patch.object(audit, "get_connection", side_effect=lambda: Connection(engine.connect())):
        yield engine
    engine.dispose()


def test_pages_filters_and_export_watermark(audit_db):
    first = audit.search_audit(10)
    assert first["total"] == 65
    assert len(audit.search_audit(10, 60)["logs"]) == 5
    with audit_db.begin() as conn:
        conn.execute(metadata.tables["audit_log"].insert(), dict(timestamp="2026-11-23T00:00:00+00:00",
                     username="other", role="user", action="user.update"))
    assert audit.search_audit(500, max_id=first["max_id"])["total"] == 65
    assert audit.search_audit(search="other")["total"] == 1
    assert audit.search_audit(search="% OR 1=1")["total"] == 0
    assert audit.search_audit(action="user.update")["total"] == 1
    assert audit.search_audit(date_from="2026-11-22T00:00:00.000Z", date_to="2026-11-23T00:00:00.000Z")["total"] == 65


def test_http_audit_requires_admin_and_validates_sort_dates(audit_db):
    app = FastAPI()
    from app.core.timing import ListTimingMiddleware
    app.add_middleware(ListTimingMiddleware)
    app.include_router(router)
    actor = SimpleNamespace(role="admin")
    app.dependency_overrides[get_current_user] = lambda: actor
    with TestClient(app) as client:
        response = client.get("/audit-log?limit=10&offset=60")
        assert len(response.json()["logs"]) == 5 and response.json()["total"] == 65
        assert "auth;dur=" in response.headers["server-timing"]
        assert response.headers["cache-control"] == "no-store"
        for query in ["sort=bad", "direction=bad", "date_from=bad", "max_id=-1"]:
            assert client.get("/audit-log?" + query).status_code == 422
        actor.role = "user"
        assert client.get("/audit-log").status_code == 403
