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


def test_audit_boundary_limits_wildcard_escaping_and_unicode(audit_db):
    # Insert edge case records with SQL wildcards (%, _, !) and Vietnamese Unicode
    with audit_db.begin() as conn:
        conn.execute(metadata.tables["audit_log"].insert(), [
            dict(timestamp="2026-11-24T08:00:00+00:00", username="nguyễn_văn_a", role="admin",
                 action="camera.update", target="Cổng_chính_100%!명", detail="Cập nhật ngưỡng 50%_fire!"),
        ])
    # Exact wildcard matching via '!' escape character
    assert audit.search_audit(search="100%!")["total"] == 1
    assert audit.search_audit(search="Cổng_chính")["total"] == 1
    assert audit.search_audit(search="50%_fire!")["total"] == 1
    assert audit.search_audit(search="nguyễn_văn_a")["total"] == 1
    assert audit.search_audit(search="100%X")["total"] == 0

    # Naive ISO date (without timezone) is treated as UTC
    res_naive = audit.search_audit(date_from="2026-11-24T00:00:00", date_to="2026-11-25T00:00:00")
    assert res_naive["total"] == 1
    assert res_naive["logs"][0]["username"] == "nguyễn_văn_a"

    # Direct repository validation rejects invalid sort or direction
    for bad_sort, bad_dir in [("ip", "desc"), ("result", "asc"), ("timestamp; DROP TABLE", "desc"), ("id", "sideways")]:
        with pytest.raises(ValueError, match="Invalid audit order"):
            audit.search_audit(sort=bad_sort, direction=bad_dir)

    # Empty table watermark boundary (max_id = 0)
    with audit_db.begin() as conn:
        conn.execute(metadata.tables["audit_log"].delete())
    empty = audit.search_audit()
    assert empty == {"logs": [], "total": 0, "max_id": 0}


def test_http_audit_filter_length_and_clamping_boundaries(audit_db):
    app = FastAPI()
    from app.core.timing import ListTimingMiddleware
    app.add_middleware(ListTimingMiddleware)
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=1, username="admin", email="admin@example.com", is_active=True, role="admin", hashed_password="h")
    with TestClient(app) as client:
        # Clamping: limit <= 0 clamps to 1; limit > 500 clamps to 500; offset < 0 clamps to 0
        clamped_low = client.get("/audit-log?limit=0&offset=-10")
        assert clamped_low.status_code == 200
        assert len(clamped_low.json()["logs"]) == 1

        clamped_high = client.get("/audit-log?limit=9999&offset=0")
        assert clamped_high.status_code == 200
        assert len(clamped_high.json()["logs"]) == 65

        # Max length boundary: 255 chars allowed for search/action, 256 rejected with 422
        assert client.get(f"/audit-log?search={'a' * 255}").status_code == 200
        assert client.get(f"/audit-log?search={'a' * 256}").status_code == 422
        assert client.get(f"/audit-log?action={'a' * 255}").status_code == 200
        assert client.get(f"/audit-log?action={'a' * 256}").status_code == 422

        # Date string length boundary (>40 chars rejected with 422) and invalid date_to format
        assert client.get(f"/audit-log?date_from={'2' * 41}").status_code == 422
        assert client.get(f"/audit-log?date_to={'2' * 41}").status_code == 422
        assert client.get("/audit-log?date_to=not-a-date").status_code == 422

        # max_id = 0 boundary returns 0 logs
        zero_max = client.get("/audit-log?max_id=0")
        assert zero_max.status_code == 200
        assert zero_max.json() == {"logs": [], "total": 0, "max_id": 0}

        # Non-list endpoints are untouched by ListTimingMiddleware
        other = client.get("/auth/stream-token")
        assert "server-timing" not in other.headers
