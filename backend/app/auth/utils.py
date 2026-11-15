import logging
import os
import re
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from passlib.context import CryptContext
import requests

try:  # read GMAIL_ADDRESS / GMAIL_APP_PASSWORD from a .env file if python-dotenv is installed
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

OTP_EXPIRE_MINUTES = 5
OTP_RESEND_COOLDOWN_SECONDS = 60

# true = print the OTP in the server log instead of e-mailing it
DEV_MODE = os.getenv("AUTH_DEV_MODE", "false").lower() == "true"

_ALNUM = re.compile(r"[A-Za-z0-9]+")
_GMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@gmail\.com", re.IGNORECASE)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def is_plain_text(value: str):
    """Only letters and digits, no special symbols."""
    return _ALNUM.fullmatch(value) is not None

def is_valid_email(email: str):
    """Must be a @gmail.com address (the OTP is sent there)."""
    return len(email) <= 254 and _GMAIL.fullmatch(email) is not None

def generate_otp():
    return f"{secrets.randbelow(10 ** 6):06d}"

def otp_expiry():
    return (datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES)).isoformat()

def otp_expired(expires_at):
    return not expires_at or datetime.fromisoformat(expires_at) <= datetime.now(timezone.utc)

def otp_seconds_since_sent(expires_at):
    sent_at = datetime.fromisoformat(expires_at) - timedelta(minutes=OTP_EXPIRE_MINUTES)
    return (datetime.now(timezone.utc) - sent_at).total_seconds()

def otp_seconds_until_expiry(expires_at):
    if not expires_at:
        return 0
    return max(0, int((datetime.fromisoformat(expires_at) - datetime.now(timezone.utc)).total_seconds()))


def send_otp_email(to_email: str, otp: str, purpose: str = "verify"):
    sender = os.getenv("GMAIL_ADDRESS")
    api_key = os.getenv("BREVO_API_KEY")
    subject = "Your password reset code" if purpose == "reset" else "Your verification code"
    text = (
        f"Your code is: {otp}\n\n"
        f"It expires in {OTP_EXPIRE_MINUTES} minutes. "
        "If you did not request this, you can ignore this e-mail."
    )

    if api_key and sender:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": api_key, "Content-Type": "application/json"},
            json={
                "sender": {"email": sender, "name": "FireGuard"},
                "to": [{"email": to_email}],
                "subject": subject,
                "textContent": text,
            },
            timeout=10,
        )
        r.raise_for_status()
        return

    # Fallback: Gmail SMTP (works locally and on paid Render instances)
    app_password = (os.getenv("GMAIL_APP_PASSWORD") or "").replace(" ", "")
    if not sender or not app_password:
        if DEV_MODE:
            logger.warning("[DEV MODE] OTP for %s is %s", to_email, otp)
            return
        raise RuntimeError("Email is not configured")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(text)
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=8) as smtp:
        smtp.starttls()
        smtp.login(sender, app_password)
        smtp.send_message(msg)
