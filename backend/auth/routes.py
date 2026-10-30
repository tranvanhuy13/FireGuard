import logging
from contextlib import contextmanager
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, HTTPException
from .dependencies import get_db, get_user, get_user_by_email
import secrets
from .schemas import (
    UserCreate, UserResponse, OTPVerify, OTPResend,
    ForgotPassword, ResetPassword,
)
from users.models import User
from .utils import (
    get_password_hash, verify_password, is_plain_text, is_valid_email,
    generate_otp, otp_expiry, otp_expired, send_otp_email,
    OTP_RESEND_COOLDOWN_SECONDS, otp_seconds_since_sent, otp_seconds_until_expiry,
)
logger = logging.getLogger(__name__)

router = APIRouter()

MAX_OTP_ATTEMPTS = 5
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt's input limit; reject rather than silently truncate.


def validate_password(password):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if "\x00" in password:
        raise HTTPException(status_code=400, detail="PASSWORD_INVALID")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise HTTPException(status_code=400, detail="PASSWORD_TOO_LONG")


@contextmanager
def otp_transaction(db):
    # Serialize read/check/update so concurrent guesses cannot lose increments.
    db.begin_serialized()
    try:
        yield
    except HTTPException:
        db.commit()  # Persist failed-attempt counters before returning the error.
        raise
    except Exception:
        db.rollback()
        raise
    else:
        db.commit()


def check_otp(db, user, otp, *, reset=False):
    invalid = "INVALID_OTP" if reset else "Invalid OTP"
    expired = "OTP_EXPIRED" if reset else "OTP has expired"
    if (user.otp_attempts or 0) >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts. Please request a new code.")
    if not user.otp:
        raise HTTPException(status_code=400, detail="Invalid or expired code" if reset else invalid)
    if otp_expired(user.otp_expires_at):
        raise HTTPException(status_code=400, detail=expired)
    if not secrets.compare_digest(user.otp.encode("utf-8"), otp.strip().encode("utf-8")):
        attempts = (user.otp_attempts or 0) + 1
        # Retain expiry as the sent-time anchor for the existing resend cooldown.
        db.execute("UPDATE users SET otp_attempts=?, otp=? WHERE id=?",
                   (attempts, None if attempts >= MAX_OTP_ATTEMPTS else user.otp, user.id))
        if attempts >= MAX_OTP_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Too many attempts. Please request a new code.")
        raise HTTPException(status_code=400, detail=invalid)

def send_new_otp(db, user_id: int, email: str, purpose: str = "verify"):
    previous = db.execute("SELECT otp, otp_expires_at, otp_attempts FROM users WHERE id=?", (user_id,)).fetchone()
    otp = generate_otp()
    db.execute(
        "UPDATE users SET otp = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?",
        (otp, otp_expiry(), user_id),
    )
    db.commit()
    try:
        send_otp_email(email, otp, purpose)
    except Exception:
        logger.exception("Could not send OTP e-mail to %s", email)
        db.execute(
            "UPDATE users SET otp=?, otp_expires_at=?, otp_attempts=? WHERE id=? AND otp=?",
            (previous["otp"], previous["otp_expires_at"], previous["otp_attempts"], user_id, otp),
        )
        db.commit()
        raise HTTPException(status_code=502, detail="Could not send OTP email")

@router.post("/signup", response_model=UserResponse)
def signup(user: UserCreate, db = Depends(get_db)):
    email = user.email.strip().lower()
    if not is_plain_text(user.username):
        raise HTTPException(status_code=400, detail="Username must not contain special characters")
    validate_password(user.password)
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Please use a valid Gmail address (example@gmail.com).")
    if get_user(db, username=user.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    if get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = get_password_hash(user.password)
    # is_active = 0 until the OTP is verified
    try:
        cursor = db.execute(
            "INSERT INTO users (username, email, hashed_password, is_active, role) VALUES (?, ?, ?, 0, 'user')",
            (user.username, email, hashed_password),
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username or email already registered") from exc
    send_new_otp(db, cursor.lastrowid, email)
    return User(id=cursor.lastrowid, username=user.username, email=email,
                hashed_password=hashed_password, role="user")

@router.post("/verify-otp")
def verify_otp(data: OTPVerify, db = Depends(get_db)):
    with otp_transaction(db):
        user = get_user_by_email(db, data.email.strip().lower())
        if not user:
            raise HTTPException(status_code=404, detail="Account not found")
        if user.is_active:
            raise HTTPException(status_code=400, detail="Account already verified")
        check_otp(db, user, data.otp)
        db.execute("UPDATE users SET is_active=1, otp=NULL, otp_expires_at=NULL, otp_attempts=0 WHERE id=?",
                   (user.id,))
    return {"message": "Account verified"}

@router.post("/resend-otp")
def resend_otp(data: OTPResend, db = Depends(get_db)):
    with otp_transaction(db):
        user = get_user_by_email(db, data.email.strip().lower())
        if not user:
            raise HTTPException(status_code=404, detail="Account not found")
        if user.is_active:
            raise HTTPException(status_code=400, detail="Account already verified")
        if user.otp_expires_at:
            since = otp_seconds_since_sent(user.otp_expires_at)
            if since < OTP_RESEND_COOLDOWN_SECONDS:
                wait = int(OTP_RESEND_COOLDOWN_SECONDS - since) + 1
                raise HTTPException(status_code=429, detail=f"Please wait {wait}s before requesting a new code.")
        send_new_otp(db, user.id, user.email)
        return {"message": "OTP sent"}

@router.post("/forgot-password")
def forgot_password(data: ForgotPassword, db = Depends(get_db)):
    """Send a reset code. Always returns the same message so the endpoint
    can't be used to find out which e-mails are registered."""
    with otp_transaction(db):
        generic = {"message": "If that account exists, a reset code has been sent."}

        user = get_user_by_email(db, data.email.strip().lower())
        # Unverified accounts must finish /verify-otp first
        if not user or not user.is_active:
            return generic

        # Respect the resend cooldown (silently, for the same reason as above)
        if user.otp_expires_at and otp_seconds_since_sent(user.otp_expires_at) < OTP_RESEND_COOLDOWN_SECONDS:
            return generic

        send_new_otp(db, user.id, user.email, purpose="reset")
        return generic


def get_reset_otp_user(db, email: str, otp: str):
    user = get_user_by_email(db, email.strip().lower())
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    check_otp(db, user, otp, reset=True)
    return user


@router.post("/verify-reset-otp")
def verify_reset_otp(data: OTPVerify, db = Depends(get_db)):
    with otp_transaction(db):
        user = get_reset_otp_user(db, data.email, data.otp)
    return {
        "message": "OTP verified",
        "expires_in": otp_seconds_until_expiry(user.otp_expires_at),
    }


@router.post("/reset-password")
def reset_password(data: ResetPassword, db = Depends(get_db)):
    validate_password(data.new_password)
    with otp_transaction(db):
        user = get_reset_otp_user(db, data.email, data.otp)
        if verify_password(data.new_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="PASSWORD_REUSED")
        db.execute(
            "UPDATE users SET hashed_password=?, otp=NULL, otp_expires_at=NULL, otp_attempts=0 WHERE id=?",
            (get_password_hash(data.new_password), user.id),
        )
    return {"message": "Password has been reset"}
