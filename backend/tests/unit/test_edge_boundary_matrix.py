"""Comprehensive boundary-value & edge-case tests across core FireGuard functions."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.pool import StaticPool

from app.auth import routes as auth_routes, stream_tokens
from app.auth.dependencies import get_current_user, get_db
from app.auth.utils import get_password_hash, otp_expiry
from app.cameras.schemas import CameraModel, normalize_source
from app.db.engine import Connection
from app.db.schema import metadata
from app.detection import rules
from app.events import routes as event_routes
from app.users import routes as user_routes


@pytest.fixture
def boundary_db():
    engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(metadata.tables["transaction_locks"].insert(), [{"name": "auth"}, {"name": "notifications"}])

    def open_conn():
        return Connection(engine.connect())

    app = FastAPI()
    app.include_router(auth_routes.router, prefix="/auth")
    app.include_router(user_routes.router, prefix="/users")
    app.include_router(event_routes.router)

    def override_get_db():
        db = open_conn()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with patch.object(Connection, "begin_serialized", lambda self, name="auth": self.rollback()), \
         patch("app.users.routes.log_action"), \
         patch("app.events.routes.log_action"), \
         TestClient(app) as client:
        yield SimpleNamespace(client=client, engine=engine, open_conn=open_conn, app=app)
    engine.dispose()


def _insert_user(engine, *, username, email, password="Password123", is_active=1,
                 is_blocked=0, role="user", otp=None, otp_expires_at=None, otp_attempts=0):
    with engine.begin() as conn:
        res = conn.execute(metadata.tables["users"].insert().values(
            username=username, email=email, hashed_password=get_password_hash(password),
            is_active=is_active, is_blocked=is_blocked, role=role,
            otp=otp, otp_expires_at=otp_expires_at, otp_attempts=otp_attempts,
        ))
        return res.lastrowid


def test_signup_boundary_and_special_inputs(boundary_db):
    client = boundary_db.client
    # Empty, whitespace, Unicode, SQLi/XSS usernames -> 400; 256 chars -> 422
    for bad_username in ("", "   ", "người1", "admin'--", "<script>alert(1)</script>"):
        res = client.post("/auth/signup", json={
            "username": bad_username, "email": "okuser@gmail.com", "password": "Password123",
        })
        assert res.status_code == 400

    assert client.post("/auth/signup", json={
        "username": "u" * 256, "email": "long256@gmail.com", "password": "Password123",
    }).status_code == 422

    # Email boundaries: empty / missing local part / 255 chars -> 400; 321 chars -> 422
    for bad_email in ("", "@gmail.com", "a" * 245 + "@gmail.com"):
        assert client.post("/auth/signup", json={
            "username": "validname1", "email": bad_email, "password": "Password123",
        }).status_code == 400
    assert client.post("/auth/signup", json={
        "username": "validname2", "email": "a" * 311 + "@gmail.com", "password": "Password123",
    }).status_code == 422

    # Max valid boundary: 255-char username + 254-char Gmail address -> 200
    with patch.object(auth_routes, "generate_otp", return_value="123456"), \
         patch.object(auth_routes, "send_otp_email"):
        ok_res = client.post("/auth/signup", json={
            "username": "u" * 255, "email": "a" * 244 + "@gmail.com", "password": "Password123",
        })
        assert ok_res.status_code == 200


def test_otp_and_resend_boundary_and_error_recovery(boundary_db):
    client = boundary_db.client
    _insert_user(boundary_db.engine, username="otpuser", email="otpuser@gmail.com",
                 is_active=0, otp="654321", otp_expires_at=otp_expiry(), otp_attempts=0)
    _insert_user(boundary_db.engine, username="nullotp", email="nullotp@gmail.com",
                 is_active=0, otp=None, otp_expires_at=otp_expiry(), otp_attempts=0)

    # Empty, whitespace, non-numeric, 5-digit, 7-digit OTPs are invalid and count as failed attempts
    for idx, bad_otp in enumerate(("", "      ", "abcdef", "12345"), start=1):
        res = client.post("/auth/verify-otp", json={"email": "otpuser@gmail.com", "otp": bad_otp})
        assert res.status_code == 400
    # Missing/null stored OTP -> 400
    assert client.post("/auth/verify-otp", json={"email": "nullotp@gmail.com", "otp": "123456"}).status_code == 400

    # 59s elapsed -> cooldown 429; 60s elapsed with SMTP failure restores prior OTP & returns 502
    sent_59s_ago = (datetime.now(timezone.utc) + timedelta(minutes=5) - timedelta(seconds=59)).isoformat()
    with boundary_db.engine.begin() as conn:
        conn.execute(metadata.tables["users"].update()
                     .where(metadata.tables["users"].c.username == "otpuser")
                     .values(otp_expires_at=sent_59s_ago, otp="654321", otp_attempts=2))
    assert client.post("/auth/resend-otp", json={"email": "otpuser@gmail.com"}).status_code == 429

    sent_60s_ago = (datetime.now(timezone.utc) + timedelta(minutes=5) - timedelta(seconds=60)).isoformat()
    with boundary_db.engine.begin() as conn:
        conn.execute(metadata.tables["users"].update()
                     .where(metadata.tables["users"].c.username == "otpuser")
                     .values(otp_expires_at=sent_60s_ago))
    with patch.object(auth_routes, "send_otp_email", side_effect=RuntimeError("SMTP failure")):
        assert client.post("/auth/resend-otp", json={"email": "otpuser@gmail.com"}).status_code == 502
    with boundary_db.open_conn() as conn:
        restored = conn.execute("SELECT otp, otp_attempts FROM users WHERE username=?", ("otpuser",)).fetchone()
        assert restored["otp"] == "654321" and restored["otp_attempts"] == 2

    # Trimmed uppercase email succeeds when OTP matches
    assert client.post("/auth/verify-otp", json={"email": "  OTPUser@GMAIL.com ", "otp": "654321"}).status_code == 200


def test_reset_password_expiry_lockout_and_invalid_password_boundaries(boundary_db):
    client = boundary_db.client
    expired_ts = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    _insert_user(boundary_db.engine, username="expreset", email="expreset@gmail.com",
                 is_active=1, otp="111222", otp_expires_at=expired_ts, otp_attempts=0)
    assert client.post("/auth/verify-reset-otp", json={"email": "expreset@gmail.com", "otp": "111222"}).json()["detail"] == "OTP_EXPIRED"

    # Valid OTP preserved if new_password violates byte/null constraints before reset
    with boundary_db.engine.begin() as conn:
        conn.execute(metadata.tables["users"].update()
                     .where(metadata.tables["users"].c.username == "expreset")
                     .values(otp_expires_at=otp_expiry(), otp_attempts=0))
    for bad_pwd, code_detail in [("bad\x00pwd123", "PASSWORD_INVALID"), ("é" * 37, "PASSWORD_TOO_LONG")]:
        res = client.post("/auth/reset-password", json={
            "email": "expreset@gmail.com", "otp": "111222", "new_password": bad_pwd,
        })
        assert res.status_code == 400 and res.json()["detail"] == code_detail

    # 5 wrong reset OTPs lock account (429)
    for _ in range(4):
        assert client.post("/auth/verify-reset-otp", json={"email": "expreset@gmail.com", "otp": "000000"}).status_code == 400
    assert client.post("/auth/verify-reset-otp", json={"email": "expreset@gmail.com", "otp": "000000"}).status_code == 429


def test_stream_and_snapshot_token_boundaries():
    user = SimpleNamespace(id=1, username="streamuser", hashed_password="pw", is_blocked=False, is_active=True, role="user")
    db = Mock()
    db.execute.return_value.fetchone.return_value = {
        "id": 1, "username": "streamuser", "email": "s@gmail.com",
        "hashed_password": "pw", "is_active": 1, "is_blocked": 0, "role": "user",
    }

    with patch.object(stream_tokens.time, "time", return_value=1000):
        token = stream_tokens.create_stream_token(user)
    with patch.object(stream_tokens.time, "time", return_value=1000 + stream_tokens.STREAM_TOKEN_TTL_SECONDS - 1):
        assert stream_tokens.verify_stream_token(token, db).username == "streamuser"
    with patch.object(stream_tokens.time, "time", return_value=1000 + stream_tokens.STREAM_TOKEN_TTL_SECONDS):
        with pytest.raises(HTTPException) as caught:
            stream_tokens.verify_stream_token(token, db)
        assert caught.value.status_code == 401

    for malformed in (None, "", "a:b", "streamuser:badint:sig", "streamuser:9999999999:forged"):
        with pytest.raises(HTTPException) as caught:
            stream_tokens.verify_stream_token(malformed, db)
        assert caught.value.status_code == 401

    # Snapshot token is scoped strictly to the exact filename and expires at 300s
    with patch.object(stream_tokens.time, "time", return_value=5000):
        snap_token = stream_tokens.create_snapshot_token("cam1_fire.jpg")
    with patch.object(stream_tokens.time, "time", return_value=5299):
        stream_tokens.require_snapshot_user("cam1_fire.jpg", token=snap_token, db=db)
        with pytest.raises(HTTPException) as wrong_file:
            stream_tokens.require_snapshot_user("other.jpg", token=snap_token, db=db)
        assert wrong_file.value.status_code == 401
    with patch.object(stream_tokens.time, "time", return_value=5300):
        with pytest.raises(HTTPException) as expired_snap:
            stream_tokens.require_snapshot_user("cam1_fire.jpg", token=snap_token, db=db)
        assert expired_snap.value.status_code == 401


def test_change_password_and_admin_update_user_boundaries(boundary_db):
    admin_id = _insert_user(boundary_db.engine, username="admin1", email="admin1@gmail.com", role="admin", is_active=1)
    pending_id = _insert_user(boundary_db.engine, username="pend1", email="pend1@gmail.com", role="user", is_active=0)
    actor = SimpleNamespace(id=admin_id, username="admin1", email="admin1@gmail.com",
                          role="admin", is_active=True, is_blocked=False,
                          hashed_password=get_password_hash("Password123"))
    boundary_db.app.dependency_overrides[get_current_user] = lambda: actor
    client = boundary_db.client

    # Empty password fields & invalid password bytes
    assert client.post("/users/change-password", json={"currentPassword": "", "newPassword": "NewPassword123"}).status_code == 400
    assert client.post("/users/change-password", json={"currentPassword": "Password123", "newPassword": ""}).status_code == 400
    assert client.post("/users/change-password", json={"currentPassword": "Password123", "newPassword": "Bad\x00Pass1"}).status_code == 400
    assert client.post("/users/change-password", json={"currentPassword": "Password123", "newPassword": "é" * 37}).status_code == 400
    assert client.post("/users/change-password", json={"currentPassword": "Password123", "newPassword": "é" * 36}).status_code == 200

    # Admin update_user enum/extra/id boundaries & blocking unverified user
    assert client.put(f"/users/{pending_id}", json={"role": "superadmin"}).status_code == 422
    assert client.put(f"/users/{pending_id}", json={"status": "deleted"}).status_code == 422
    assert client.put(f"/users/{pending_id}", json={"extra": True}).status_code == 422
    assert client.put("/users/0", json={"role": "admin"}).status_code == 404
    assert client.put("/users/-1", json={"role": "admin"}).status_code == 404
    assert client.put(f"/users/{pending_id}", json={}).status_code == 200
    assert client.put(f"/users/{pending_id}", json={"status": "blocked"}).json()["status"] == "blocked"
    assert client.put(f"/users/{pending_id}", json={"status": "active"}).status_code == 409


def test_camera_schema_and_detection_rules_edge_boundaries():
    assert normalize_source("00") == "0"
    assert normalize_source("063") == "63"
    exact_2048 = "https://camera.local/" + "a" * (2048 - len("https://camera.local/"))
    assert len(exact_2048) == 2048
    assert CameraModel(name="Cổng Chính 01", source=exact_2048).source == exact_2048
    assert CameraModel(name="a" * 255, source="http://cam.local:65535/stream").name == "a" * 255

    for bad_src in (exact_2048 + "x", "http://cam/\x00", "http://cam/a b", "999999999999", "https://cam:65536/live"):
        with pytest.raises(ValidationError):
            CameraModel(name="Cam", source=bad_src)
    with pytest.raises(ValidationError):
        CameraModel(name="a" * 256, source="0")

    # filter_detections & confirm_frame boundary behavior
    assert rules.filter_detections(None, {"fire": 0.5, "smoke": 0.5}) == []
    assert rules.filter_detections([{"class": "fire", "confidence": -0.1}], {"fire": 0.0, "smoke": 0.5}) == []
    boundary_hits = rules.filter_detections([
        {"class": "fire", "confidence": 0.5},
        {"class": "fire", "confidence": 0.499999},
        {"class": "fire", "confidence": float("inf")},
    ], {"fire": 0.5, "smoke": 0.5})
    assert len(boundary_hits) == 1 and boundary_hits[0]["confidence"] == 0.5

    streak = {}
    assert rules.confirm_frame(streak, [{"class": "fire", "confidence": 0.6}, {"class": "fire", "confidence": 0.9}], 1) == {"fire": 0.9}
    assert rules.confirm_frame(streak, [], 1) == {}
    assert streak["fire"] == 0


def test_history_and_status_http_boundaries(boundary_db):
    uid1 = _insert_user(boundary_db.engine, username="evowner1", email="ev1@gmail.com")
    uid2 = _insert_user(boundary_db.engine, username="evowner2", email="ev2@gmail.com")
    with boundary_db.engine.begin() as conn:
        conn.execute(metadata.tables["events"].insert(), [
            {"timestamp": "2026-11-26 10:00:00", "type": "fire", "confidence": 0.9,
             "owner_user_id": uid1, "camera_id": 1, "camera_name": "Gate 1", "source_kind": "camera"},
            {"timestamp": "2026-11-26 10:01:00", "type": "smoke", "confidence": 0.8,
             "owner_user_id": uid1, "camera_id": None, "camera_name": None, "source_kind": "video", "video_name": "v.mp4"},
            {"timestamp": "2026-11-26 10:02:00", "type": "fire", "confidence": 0.95,
             "owner_user_id": uid2, "camera_id": 2, "camera_name": "Gate 2", "source_kind": "camera"},
        ])
    boundary_db.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uid1, username="evowner1")
    with patch("app.db.repositories.operations.get_connection", side_effect=boundary_db.open_conn):
        client = boundary_db.client
        assert client.get("/history?limit=1&offset=0").status_code == 200
        assert client.get("/history?limit=500&offset=0").status_code == 200
        assert client.get("/history?limit=501").status_code == 422
        assert client.get("/history?offset=-1").status_code == 422
        assert client.get("/history?max_id=-1").status_code == 422
        assert client.get(f"/history?search={'x' * 256}").status_code == 422
        hist = client.get("/history").json()
        assert hist["total"] == 1 and hist["events"][0]["camera_name"] == "Gate 1"
        assert client.get("/history?max_id=0").json() == {"events": [], "total": 0, "max_id": 0}
        # Cannot mutate another owner's alert status
        assert client.patch("/alerts/3/status", json={"status": "confirmed"}).status_code == 404
