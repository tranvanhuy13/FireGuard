from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from .utils import verify_password
from .login_limiter import reserve, finish
from users.models import User
from .database import get_connection

security = HTTPBasic()

def get_db():
    db = get_connection()
    try:
        yield db
    finally:
        db.close()

def get_user(db, username: str):
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        return None
    return User(**dict(row))

def get_user_by_email(db, email: str):
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row is None:
        return None
    return User(**dict(row))

def get_user_by_identifier(db, identifier: str):
    """Find a user by email (if it contains '@') or by username."""
    identifier = identifier.strip()
    if "@" in identifier:
        return get_user_by_email(db, identifier.lower())
    return get_user(db, identifier)

def authenticate_user(db, identifier: str, password: str):
    user = get_user_by_identifier(db, identifier)
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user

def get_current_user(request: Request, db = Depends(get_db), credentials: HTTPBasicCredentials = Depends(security)):
    user = get_user_by_identifier(db, credentials.username)
    # Uvicorn applies its trusted-proxy policy to request.client. Never parse
    # arbitrary forwarded headers here.
    client_ip = request.client.host if request.client else "unknown"
    ticket, scopes = reserve(db, credentials.username, user, client_ip)
    try:
        valid = bool(user and verify_password(credentials.password, user.hashed_password))
    except ValueError:
        valid = False
    except Exception:
        finish(db, ticket, scopes, True)
        raise
    finish(db, ticket, scopes, valid)
    if not valid:
        user = None
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    validate_account(user)
    return user


def validate_account(user):
    if user.is_blocked:
        raise HTTPException(status_code=403, detail="Account blocked")
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not verified",
        )
    if user.role not in ("user", "admin"):
        raise HTTPException(status_code=403, detail="Invalid account role")


def require_admin(current_user=Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin permission required")
    return current_user
