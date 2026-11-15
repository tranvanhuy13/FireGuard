import logging
from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_user, require_admin
from app.auth.database import get_connection as get_auth_connection
from app.auth.stream_tokens import STREAM_TOKEN_TTL_SECONDS, create_stream_token

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/auth/login")
def login(current_user=Depends(get_current_user)):
    """Check credentials (HTTP Basic). Returns the user profile on success."""
    name = getattr(current_user, "full_name", None) or current_user.username
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "is_active": current_user.is_active,
        "role": current_user.role,
        "full_name": getattr(current_user, "full_name", None) or "",
        "fullName": name,
        "phone": getattr(current_user, "phone", None) or "",
        "avatar_url": getattr(current_user, "avatar_url", None) or "",
        "avatarUrl": getattr(current_user, "avatar_url", None) or "",
    }


@router.get("/auth/stream-token")
def get_stream_token(current_user=Depends(get_current_user)):
    """Issue a password-bound credential for media and WebSockets."""
    return {"token": create_stream_token(current_user),
            "expires_in": STREAM_TOKEN_TTL_SECONDS}


@router.get("/audit-log", dependencies=[Depends(require_admin)])
def get_audit_log(limit: int = 200, offset: int = 0):
    """Return persisted audit history to administrators only."""
    conn = get_auth_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?",
            (max(1, min(limit, 500)), max(0, offset)),
        ).fetchall()
        return {"logs": [dict(row) for row in rows]}
    finally:
        conn.close()
