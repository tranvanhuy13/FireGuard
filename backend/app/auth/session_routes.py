import logging
from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_user, require_admin
from app.auth.stream_tokens import STREAM_TOKEN_TTL_SECONDS, create_stream_token

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/auth/login")
def login(current_user=Depends(get_current_user)):
    """Check credentials (HTTP Basic). Returns the user profile on success."""
    from app.auth.sessions import create_session, SESSION_TTL_SECONDS
    from fastapi.responses import JSONResponse
    name = getattr(current_user, "full_name", None) or current_user.username
    return JSONResponse({
        "access_token": create_session(current_user),
        "token_type": "bearer",
        "expires_in": SESSION_TTL_SECONDS,
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
    }, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


@router.get("/auth/stream-token")
def get_stream_token(current_user=Depends(get_current_user)):
    """Issue a password-bound credential for media and WebSockets."""
    return {"token": create_stream_token(current_user),
            "expires_in": STREAM_TOKEN_TTL_SECONDS}


@router.get("/audit-log", dependencies=[Depends(require_admin)])
def get_audit_log(limit: int = 25, offset: int = 0, search: str = "", action: str = "",
                  date_from: str = "", date_to: str = "", sort: str = "timestamp",
                  direction: str = "desc", max_id: int | None = None):
    """Return persisted audit history to administrators only."""
    from fastapi import HTTPException
    from app.db.repositories.audit import search_audit
    if (len(search) > 255 or len(action) > 255 or len(date_from) > 40 or len(date_to) > 40
            or (max_id is not None and max_id < 0)):
        raise HTTPException(422, "Invalid audit filters")
    try:
        return search_audit(max(1, min(limit, 500)), max(0, offset), search=search, action=action,
                            date_from=date_from, date_to=date_to, sort=sort, direction=direction, max_id=max_id)
    except ValueError:
        raise HTTPException(422, "Invalid audit filters") from None
