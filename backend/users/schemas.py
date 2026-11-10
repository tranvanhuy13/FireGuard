from pydantic import BaseModel, ConfigDict
from typing import Literal

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    email: str
    is_active: bool
    role: Literal["user", "admin"] = "user"
    full_name: str | None = None
    fullName: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    avatarUrl: str | None = None

    model_config = ConfigDict(from_attributes=True)

class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    full_name: str | None = None
    fullName: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    avatarUrl: str | None = None

class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    current_password: str | None = None
    currentPassword: str | None = None
    password: str | None = None
    new_password: str | None = None
    newPassword: str | None = None
