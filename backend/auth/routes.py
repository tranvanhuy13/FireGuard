import logging
from fastapi import APIRouter, Depends, HTTPException
from .dependencies import get_db, get_user, get_user_by_email
import secrets
from .schemas import (
    UserCreate, UserResponse, OTPVerify, OTPResend,
    ForgotPassword, ResetPassword,
)
from users.models import User
from .utils import (
    get_password_hash, is_plain_text, is_valid_email,
    generate_otp, otp_expiry, otp_expired, send_otp_email,
    OTP_RESEND_COOLDOWN_SECONDS, otp_seconds_since_sent,
)

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_OTP_ATTEMPTS = 5
MIN_PASSWORD_LENGTH = 6

def send_new_otp(db, user_id: int, email: str, purpose: str = "verify"):
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
        db.execute("UPDATE users SET otp = NULL, otp_expires_at = NULL WHERE id = ?", (user_id,))
        db.commit()
        raise HTTPException(status_code=502, detail="Could not send OTP email")

@router.post("/signup", response_model=UserResponse)
def signup(user: UserCreate, db = Depends(get_db)):
    email = user.email.strip().lower()
    if not is_plain_text(user.username) or not is_plain_text(user.password):
        raise HTTPException(status_code=400, detail="Username and password must not contain special characters")
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Please use a valid Gmail address (example@gmail.com).")
    if get_user(db, username=user.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    if get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = get_password_hash(user.password)
    # is_active = 0 until the OTP is verified
    cursor = db.execute(
        "INSERT INTO users (username, email, hashed_password, is_active) VALUES (?, ?, ?, 0)",
        (user.username, email, hashed_password),
    )
    db.commit()
    send_new_otp(db, cursor.lastrowid, email)
    return User(id=cursor.lastrowid, username=user.username, email=email, hashed_password=hashed_password)

@router.post("/verify-otp")
def verify_otp(data: OTPVerify, db = Depends(get_db)):
    user = get_user_by_email(db, data.email.strip().lower())
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.is_active:
        raise HTTPException(status_code=400, detail="Account already verified")
    if not user.otp or user.otp != data.otp.strip():
        raise HTTPException(status_code=400, detail="Invalid OTP")
    if otp_expired(user.otp_expires_at):
        raise HTTPException(status_code=400, detail="OTP has expired")
    # OTP is correct -> change is_active to 1
    db.execute(
        "UPDATE users SET is_active = 1, otp = NULL, otp_expires_at = NULL WHERE id = ?",
        (user.id,),
    )
    db.commit()
    return {"message": "Account verified"}

@router.post("/resend-otp")
def resend_otp(data: OTPResend, db = Depends(get_db)):
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


@router.post("/reset-password")
def reset_password(data: ResetPassword, db = Depends(get_db)):
    if not is_plain_text(data.new_password):
        raise HTTPException(status_code=400, detail="Password must not contain special characters")
    if len(data.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400,
                            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

    invalid = HTTPException(status_code=400, detail="Invalid or expired code")

    user = get_user_by_email(db, data.email.strip().lower())
    if not user or not user.is_active or not user.otp:
        raise invalid
    if otp_expired(user.otp_expires_at):
        raise invalid

    # Brute-force protection: a 6-digit code must not be guessable by retrying
    if (user.otp_attempts or 0) >= MAX_OTP_ATTEMPTS:
        db.execute("UPDATE users SET otp = NULL, otp_expires_at = NULL WHERE id = ?", (user.id,))
        db.commit()
        raise HTTPException(status_code=429, detail="Too many attempts. Please request a new code.")

    if not secrets.compare_digest(user.otp, data.otp.strip()):
        db.execute("UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?", (user.id,))
        db.commit()
        raise invalid

    db.execute(
        "UPDATE users SET hashed_password = ?, otp = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?",
        (get_password_hash(data.new_password), user.id),
    )
    db.commit()
    return {"message": "Password has been reset"}