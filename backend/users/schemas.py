from pydantic import BaseModel
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

    class Config:
        from_attributes = True
