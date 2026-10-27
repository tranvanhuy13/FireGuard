from dataclasses import dataclass

@dataclass
class User:
    id: int
    username: str
    email: str
    hashed_password: str
    is_active: bool = False
    otp: str | None = None
    otp_expires_at: str | None = None
    otp_attempts: int = 0
    role: str = "user"
    is_blocked: bool = False
