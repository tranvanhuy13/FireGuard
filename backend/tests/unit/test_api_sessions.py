"""Session authentication never verifies passwords again or reserves login attempts."""
import base64
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.auth import sessions, dependencies as auth
from app.auth.session_routes import router


def account(**updates):
    return dict(id=1, username="admin", email="admin@example.com", hashed_password="test-hash",
                is_active=True, is_blocked=False, role="admin", **updates)


def test_session_validates_fresh_account_and_releases_connection():
    row = account()
    token = sessions.create_session(SimpleNamespace(**row))
    db = Mock()
    db.execute.return_value.fetchone.return_value = row
    request = SimpleNamespace(headers={"authorization": "Bearer " + token})
    with patch.object(auth, "verify_password") as bcrypt, patch.object(auth, "reserve") as reserve:
        assert auth.get_current_user(request, db, None).id == 1
    bcrypt.assert_not_called()
    reserve.assert_not_called()
    db.close.assert_called_once()
    assert db.execute.call_count == 1


@pytest.mark.parametrize("change,expected", [({"is_blocked": True}, 403), ({"is_active": False}, 403),
                                            ({"role": "invalid"}, 403), ({"hashed_password": "changed"}, 401)])
def test_existing_session_respects_block_verification_roles_and_password_changes(change, expected):
    row = account()
    token = sessions.create_session(SimpleNamespace(**row))
    row.update(change)
    db = Mock()
    db.execute.return_value.fetchone.return_value = row
    with pytest.raises(auth.HTTPException) as caught:
        auth.get_current_user(SimpleNamespace(headers={"authorization": "Bearer " + token}), db, None)
    assert caught.value.status_code == expected
    db.close.assert_called_once()


def test_expired_forged_and_other_token_types_are_rejected():
    row = account()
    with patch.object(sessions.time, "time", return_value=100):
        token = sessions.create_session(SimpleNamespace(**row))
    db = Mock()
    db.execute.return_value.fetchone.return_value = row
    with patch.object(sessions.time, "time", return_value=3700), pytest.raises(auth.HTTPException):
        sessions.verify_session(token, db)
    db.execute.assert_not_called()
    forged = base64.urlsafe_b64encode(json.dumps({"id": 2, "exp": 9999999999}).encode()).decode().rstrip("=")
    for invalid in [forged + "." + token.split(".")[1], "", "x", "x.y.z", "@@@@.abc", "snapshot:a:1:abc"]:
        with pytest.raises(auth.HTTPException) as caught:
            sessions.verify_session(invalid, db)
        assert caught.value.status_code == 401


def test_session_boundary_length_claim_types_and_missing_user():
    row = account()
    db = Mock()
    db.execute.return_value.fetchone.return_value = row
    # Boundary: None, exact 1024 length vs 1025 length (>1024 rejected before split/decode)
    for oversized_or_null in [None, "a" * 1025, "a" * 512 + "." + "b" * 512]:
        with pytest.raises(auth.HTTPException) as caught:
            sessions.verify_session(oversized_or_null, db)
        assert caught.value.status_code == 401
    db.execute.assert_not_called()

    # Exact expiration boundary: exp == time.time() must be rejected (exp <= time.time())
    with patch.object(sessions.time, "time", return_value=1000):
        token = sessions.create_session(SimpleNamespace(**row))
    with patch.object(sessions.time, "time", return_value=1000 + sessions.SESSION_TTL_SECONDS):
        with pytest.raises(auth.HTTPException) as caught:
            sessions.verify_session(token, db)
        assert caught.value.status_code == 401
    # 1 second before expiration must succeed
    with patch.object(sessions.time, "time", return_value=1000 + sessions.SESSION_TTL_SECONDS - 1):
        assert sessions.verify_session(token, db).id == 1

    # Wrong claim types (bool is a subclass of int in Python, float, string, missing keys)
    bad_claims_list = [
        {"id": True, "exp": 9999999999},
        {"id": 1, "exp": True},
        {"id": "1", "exp": 9999999999},
        {"id": 1.5, "exp": 9999999999},
        {"id": 1, "exp": 9999999999.0},
        {"id": 1},
        {"exp": 9999999999},
        [],
        "not-a-dict",
    ]
    for claims in bad_claims_list:
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        sig = sessions._signature(payload, row["hashed_password"])
        with pytest.raises(auth.HTTPException) as caught:
            sessions.verify_session(f"{payload}.{sig}", db)
        assert caught.value.status_code == 401

    # Deleted user in database after session token was issued
    db.execute.return_value.fetchone.return_value = None
    with pytest.raises(auth.HTTPException) as caught:
        sessions.verify_session(token, db)
    assert caught.value.status_code == 401


def test_bearer_header_case_insensitivity_and_whitespace():
    row = account()
    token = sessions.create_session(SimpleNamespace(**row))
    for header in [f"bearer {token}", f"BEARER   {token}  ", f"BeArEr {token}"]:
        db = Mock()
        db.execute.return_value.fetchone.return_value = row
        request = SimpleNamespace(headers={"authorization": header}, state=SimpleNamespace())
        user = auth.get_current_user(request, db, None)
        assert user.id == 1
        assert hasattr(request.state, "auth_ms") and request.state.auth_ms >= 0
        db.close.assert_called_once()

    # Empty bearer token "Bearer   " fails with 401 and still closes db
    db = Mock()
    request = SimpleNamespace(headers={"authorization": "Bearer    "}, state=SimpleNamespace())
    with pytest.raises(auth.HTTPException) as caught:
        auth.get_current_user(request, db, None)
    assert caught.value.status_code == 401
    db.close.assert_called_once()


def test_login_returns_session_then_bearer_reads_without_password_or_limiter():
    row = account()
    db = Mock()
    db.execute.return_value.fetchone.return_value = row
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[auth.get_auth_db] = lambda: db
    with patch.object(auth, "get_user_by_identifier", return_value=SimpleNamespace(**row)), \
         patch.object(auth, "_verify_user_password", return_value=True) as verify, \
         patch.object(auth, "reserve", return_value=("ticket", [])) as reserve, \
         patch.object(auth, "finish"), TestClient(app) as client:
        response = client.get("/auth/login", auth=("admin", "password"))
        assert response.status_code == 200
        token = response.json()["access_token"]
        assert response.json()["expires_in"] == 3600
        verify.reset_mock(); reserve.reset_mock()
        assert client.get("/auth/stream-token", headers={"Authorization": "Bearer " + token}).status_code == 200
        verify.assert_not_called(); reserve.assert_not_called()


def test_no_credentials_never_opens_database():
    app = FastAPI()
    app.include_router(router)
    with patch.object(auth, "get_connection") as connect, TestClient(app) as client:
        assert client.get("/auth/login").status_code == 401
    connect.assert_not_called()


def test_camera_auth_connection_is_released_before_stream_body():
    from fastapi import Depends
    from fastapi.responses import StreamingResponse
    from app.auth.stream_tokens import require_stream_user

    app = FastAPI()
    db = Mock()

    @app.get("/stream")
    def stream(user=Depends(require_stream_user)):
        def frames():
            db.close.assert_called_once()
            yield b"frame"
        return StreamingResponse(frames())

    with patch.object(auth, "get_connection", return_value=db), \
         patch("app.auth.stream_tokens.verify_stream_token", return_value=SimpleNamespace(id=1)), \
         TestClient(app) as client:
        assert client.get("/stream?token=test").content == b"frame"
