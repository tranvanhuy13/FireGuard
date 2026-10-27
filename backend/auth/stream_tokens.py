"""Signed, expiring media credentials bound to the current account password."""
import hashlib
import hmac
import os
import secrets
import time

from fastapi import Depends, HTTPException, Query
from .dependencies import get_db, get_user, validate_account

STREAM_TOKEN_TTL_SECONDS = 3600
STREAM_TOKEN_SECRET = os.getenv("STREAM_TOKEN_SECRET") or secrets.token_hex(32)


def _sign(payload, password_hash):
    return hmac.new(STREAM_TOKEN_SECRET.encode(), f"{payload}:{password_hash}".encode(), hashlib.sha256).hexdigest()


def create_stream_token(user):
    payload = f"{user.username}:{int(time.time()) + STREAM_TOKEN_TTL_SECONDS}"
    return f"{payload}:{_sign(payload, user.hashed_password)}"


def verify_stream_token(token, db):
    try:
        username, expires, signature = (token or "").rsplit(":", 2)
        if int(expires) <= time.time():
            raise ValueError()
        user = get_user(db, username)
        if user is None or not hmac.compare_digest(signature, _sign(f"{username}:{expires}", user.hashed_password)):
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        raise HTTPException(status_code=401, detail="Invalid or expired stream token") from None
    validate_account(user)
    return user


def require_stream_user(token: str | None = Query(None), db=Depends(get_db)):
    return verify_stream_token(token, db)


def create_snapshot_token(name):
    """Worker credential for one notification image, valid for five minutes."""
    payload = f"snapshot:{name}:{int(time.time()) + 300}"
    return f"{payload}:{_sign(payload, 'notification-image')}"


def require_snapshot_user(name: str, token: str | None = Query(None), db=Depends(get_db)):
    if token and token.startswith("snapshot:") and token.count(":") == 3:
        try:
            scope, filename, expires, signature = token.rsplit(":", 3)
            payload = f"{scope}:{filename}:{expires}"
            if scope != "snapshot" or filename != name or int(expires) <= time.time():
                raise ValueError()
            if not hmac.compare_digest(signature, _sign(payload, "notification-image")):
                raise ValueError()
            return
        except (ValueError, TypeError):
            raise HTTPException(status_code=401, detail="Invalid snapshot credential") from None
    return verify_stream_token(token, db)


def stream_is_authorized(token):
    # A fresh connection reflects account blocking/password changes during streams.
    from .database import get_connection
    db = get_connection()
    try:
        verify_stream_token(token, db)
        return True
    except HTTPException:
        return False
    finally:
        db.close()


async def authorize_websocket(websocket):
    import asyncio
    if await asyncio.to_thread(stream_is_authorized, websocket.query_params.get("token")):
        return True
    await websocket.close(code=1008, reason="Authentication required")
    return False
