"""Short-lived API sessions, invalidated by password changes and fresh account checks."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import HTTPException
from app.users.models import User

SESSION_TTL_SECONDS = 3600
_SECRET = os.getenv("AUTH_SESSION_SECRET") or os.getenv("STREAM_TOKEN_SECRET") or secrets.token_hex(32)


def _signature(payload, password_hash):
    return hmac.new(_SECRET.encode(), f"api-session:{payload}:{password_hash}".encode(), hashlib.sha256).hexdigest()


def create_session(user):
    payload = base64.urlsafe_b64encode(json.dumps({
        "id": user.id, "exp": int(time.time()) + SESSION_TTL_SECONDS,
    }, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{payload}.{_signature(payload, user.hashed_password)}"


def verify_session(token, db):
    try:
        if not token or len(token) > 1024:
            raise ValueError()
        payload, signature = token.split(".")
        claims = json.loads(base64.b64decode(payload + "=" * (-len(payload) % 4), altchars=b"-_", validate=True))
        if type(claims["id"]) is not int or type(claims["exp"]) is not int or claims["exp"] <= time.time():
            raise ValueError()
        row = db.execute("SELECT * FROM users WHERE id = ?", (claims["id"],)).fetchone()
        if row is None or not hmac.compare_digest(signature, _signature(payload, row["hashed_password"])):
            raise ValueError()
        return User(**dict(row))
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise HTTPException(401, "Invalid or expired session", headers={"WWW-Authenticate": "Bearer"}) from None
