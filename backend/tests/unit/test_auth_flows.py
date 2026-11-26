"""Offline tests for auth routes (signup, OTP, password reset) and login rate limiter."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from app.auth import login_limiter, routes as auth_routes
from app.auth.dependencies import get_db
from app.auth.utils import get_password_hash, otp_expiry
from app.db.engine import Connection
from app.db.schema import metadata


@pytest.fixture
def auth_sqlite_db():
    engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(metadata.tables["transaction_locks"].insert(), [{"name": "auth"}, {"name": "notifications"}])

    def open_conn():
        return Connection(engine.connect())

    app = FastAPI()
    app.include_router(auth_routes.router, prefix="/auth")

    def override_get_db():
        db = open_conn()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with patch.object(Connection, "begin_serialized", lambda self, name="auth": self.rollback()), \
         TestClient(app) as client:
        yield SimpleNamespace(client=client, engine=engine, open_conn=open_conn)
    engine.dispose()


def _seed_user(engine, *, username="alice", email="alice@gmail.com", password="Password123",
               is_active=1, otp=None, otp_expires_at=None, otp_attempts=0):
    with engine.begin() as conn:
        conn.execute(metadata.tables["users"].insert(), {
            "username": username,
            "email": email,
            "hashed_password": get_password_hash(password),
            "is_active": is_active,
            "otp": otp,
            "otp_expires_at": otp_expires_at,
            "otp_attempts": otp_attempts,
            "role": "user",
            "is_blocked": 0,
        })


def test_validate_password_boundaries():
    auth_routes.validate_password("a" * 8)
    auth_routes.validate_password("é" * 36)  # Exactly 72 UTF-8 bytes
    for bad, expected_detail in [
        ("1234567", "at least 8 characters"),
        ("Pass\x00123", "PASSWORD_INVALID"),
        ("é" * 36 + "a", "PASSWORD_TOO_LONG"),  # 73 UTF-8 bytes
    ]:
        with pytest.raises(HTTPException) as caught:
            auth_routes.validate_password(bad)
        assert caught.value.status_code == 400
        assert expected_detail in caught.value.detail


def test_signup_validation_duplicates_smtp_rollback_and_success(auth_sqlite_db):
    client = auth_sqlite_db.client
    _seed_user(auth_sqlite_db.engine, username="existing", email="existing@gmail.com")

    assert client.post("/auth/signup", json={
        "username": "bad@name", "email": "new@gmail.com", "password": "Password123",
    }).status_code == 400
    assert client.post("/auth/signup", json={
        "username": "validuser", "email": "user@yahoo.com", "password": "Password123",
    }).status_code == 400
    assert client.post("/auth/signup", json={
        "username": "existing", "email": "other@gmail.com", "password": "Password123",
    }).status_code == 400
    assert client.post("/auth/signup", json={
        "username": "newname", "email": "existing@gmail.com", "password": "Password123",
    }).status_code == 400

    # Email send outage restores prior OTP and returns 502 without silently activating user
    with patch.object(auth_routes, "send_otp_email", side_effect=RuntimeError("SMTP down")):
        res_502 = client.post("/auth/signup", json={
            "username": "smtpfail", "email": "SMTPFail@gmail.com", "password": "Password123",
        })
        assert res_502.status_code == 502

    with auth_sqlite_db.open_conn() as conn:
        row = conn.execute("SELECT is_active, otp FROM users WHERE username=?", ("smtpfail",)).fetchone()
        assert row["is_active"] == 0 and row["otp"] is None

    # Valid signup normalizes email and stores inactive user + 6-digit OTP
    with patch.object(auth_routes, "generate_otp", return_value="654321"), \
         patch.object(auth_routes, "send_otp_email") as sent:
        res_ok = client.post("/auth/signup", json={
            "username": "freshuser", "email": "FreshUser@gmail.com", "password": "Password123",
        })
        assert res_ok.status_code == 200
        assert res_ok.json()["username"] == "freshuser"
        sent.assert_called_once_with("freshuser@gmail.com", "654321", "verify")

    # Concurrent IntegrityError race during INSERT maps to 400
    with patch.object(Connection, "execute", side_effect=IntegrityError("dup", {}, None)), \
         patch.object(auth_routes, "get_user", return_value=None), \
         patch.object(auth_routes, "get_user_by_email", return_value=None):
        res_race = client.post("/auth/signup", json={
            "username": "raceuser", "email": "raceuser@gmail.com", "password": "Password123",
        })
        assert res_race.status_code == 400


def test_verify_otp_lockout_expiry_and_resend_cooldown(auth_sqlite_db):
    client = auth_sqlite_db.client
    _seed_user(auth_sqlite_db.engine, username="pending", email="pending@gmail.com",
               is_active=0, otp="112233", otp_expires_at=otp_expiry(), otp_attempts=0)
    _seed_user(auth_sqlite_db.engine, username="activeu", email="activeu@gmail.com", is_active=1)

    assert client.post("/auth/verify-otp", json={"email": "missing@gmail.com", "otp": "123456"}).status_code == 404
    assert client.post("/auth/verify-otp", json={"email": "activeu@gmail.com", "otp": "123456"}).status_code == 400
    assert client.post("/auth/resend-otp", json={"email": "missing@gmail.com"}).status_code == 404
    assert client.post("/auth/resend-otp", json={"email": "activeu@gmail.com"}).status_code == 400

    # Immediate resend hits 60s cooldown -> 429
    res_cool = client.post("/auth/resend-otp", json={"email": "pending@gmail.com"})
    assert res_cool.status_code == 429
    assert "Please wait" in res_cool.json()["detail"]

    # 4 wrong attempts return 400; 5th locks account with 429 and clears OTP
    for attempt in range(1, 5):
        res_bad = client.post("/auth/verify-otp", json={"email": "pending@gmail.com", "otp": "000000"})
        assert res_bad.status_code == 400
    res_lock = client.post("/auth/verify-otp", json={"email": "pending@gmail.com", "otp": "000000"})
    assert res_lock.status_code == 429
    with auth_sqlite_db.open_conn() as conn:
        row = conn.execute("SELECT otp, otp_attempts FROM users WHERE username=?", ("pending",)).fetchone()
        assert row["otp"] is None and row["otp_attempts"] == 5

    # Expired OTP after cooldown resend works cleanly
    stale_time = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
    with auth_sqlite_db.engine.begin() as conn:
        conn.execute(metadata.tables["users"].update()
                     .where(metadata.tables["users"].c.username == "pending")
                     .values(otp_expires_at=stale_time))
    with patch.object(auth_routes, "generate_otp", return_value="778899"), \
         patch.object(auth_routes, "send_otp_email"):
        assert client.post("/auth/resend-otp", json={"email": "pending@gmail.com"}).status_code == 200

    # Valid OTP activates account and clears OTP state
    assert client.post("/auth/verify-otp", json={"email": "pending@gmail.com", "otp": " 778899 "}).status_code == 200
    with auth_sqlite_db.open_conn() as conn:
        row = conn.execute("SELECT is_active, otp, otp_attempts FROM users WHERE username=?", ("pending",)).fetchone()
        assert row["is_active"] == 1 and row["otp"] is None and row["otp_attempts"] == 0


def test_forgot_and_reset_password_full_lifecycle(auth_sqlite_db):
    client = auth_sqlite_db.client
    _seed_user(auth_sqlite_db.engine, username="resetuser", email="resetuser@gmail.com",
               password="OldPassword123", is_active=1)
    _seed_user(auth_sqlite_db.engine, username="unverified", email="unverified@gmail.com",
               password="OldPassword123", is_active=0)

    # Enumeration resistance: identical generic 200 for missing, unverified, and active users
    with patch.object(auth_routes, "generate_otp", return_value="445566"), \
         patch.object(auth_routes, "send_otp_email") as send_mock:
        for email in ("nobody@gmail.com", "unverified@gmail.com", "resetuser@gmail.com"):
            res = client.post("/auth/forgot-password", json={"email": email})
            assert res.status_code == 200
            assert "If that account exists" in res.json()["message"]
        # Second immediate call hits silent cooldown and does not send another email
        assert client.post("/auth/forgot-password", json={"email": "resetuser@gmail.com"}).status_code == 200
        send_mock.assert_called_once_with("resetuser@gmail.com", "445566", "reset")

    assert client.post("/auth/verify-reset-otp", json={"email": "unverified@gmail.com", "otp": "445566"}).status_code == 400
    assert client.post("/auth/verify-reset-otp", json={"email": "resetuser@gmail.com", "otp": "999999"}).json()["detail"] == "INVALID_OTP"
    assert client.post("/auth/verify-reset-otp", json={"email": "resetuser@gmail.com", "otp": "445566"}).status_code == 200

    # Password reuse rejected; new valid password succeeds and clears OTP
    res_reuse = client.post("/auth/reset-password", json={
        "email": "resetuser@gmail.com", "otp": "445566", "new_password": "OldPassword123",
    })
    assert res_reuse.status_code == 400 and res_reuse.json()["detail"] == "PASSWORD_REUSED"

    res_done = client.post("/auth/reset-password", json={
        "email": "resetuser@gmail.com", "otp": "445566", "new_password": "NewPassword456",
    })
    assert res_done.status_code == 200
    assert client.post("/auth/verify-reset-otp", json={"email": "resetuser@gmail.com", "otp": "445566"}).status_code == 400


def test_login_limiter_account_and_ip_thresholds_and_success_cleanup(auth_sqlite_db):
    user = SimpleNamespace(id=7)
    with auth_sqlite_db.open_conn() as conn, \
         patch.object(Connection, "begin_serialized", lambda self, name="auth": self.rollback()):
        # Case-insensitive email normalization shares failure budget
        with patch.object(login_limiter.time, "time", return_value=1000.0):
            for i in range(4):
                ticket, scopes = login_limiter.reserve(conn, "User@Gmail.com", None, "10.0.0.1")
                login_limiter.finish(conn, ticket, scopes, False)
            # 5th failure hits account limit and rejects via finish() with Retry-After
            ticket, scopes = login_limiter.reserve(conn, "user@gmail.com", None, "10.0.0.1")
            with pytest.raises(HTTPException) as caught:
                login_limiter.finish(conn, ticket, scopes, False)
            assert caught.value.status_code == 429
            assert int(caught.value.headers["Retry-After"]) >= 1

            # Next guess is blocked up-front in reserve()
            with pytest.raises(HTTPException) as blocked:
                login_limiter.reserve(conn, "user@gmail.com", None, "10.0.0.1")
            assert blocked.value.status_code == 429

        # After window expires (61s later), old attempts are purged and login succeeds, deleting ticket
        with patch.object(login_limiter.time, "time", return_value=1061.0):
            ticket, scopes = login_limiter.reserve(conn, "known", user, "10.0.0.1")
            login_limiter.finish(conn, ticket, scopes, True)
            remaining = conn.execute("SELECT COUNT(*) FROM login_attempts").fetchone()[0]
            assert remaining == 0
