from pydantic import BaseModel, Field

class UserBase(BaseModel):
    username: str = Field(max_length=255)

class UserCreate(UserBase):
    email: str = Field(max_length=320)
    password: str

class UserResponse(UserBase):
    id: int

    class Config:
        from_attributes = True

class OTPVerify(BaseModel):
    email: str
    otp: str

class OTPResend(BaseModel):
    email: str

class ForgotPassword(BaseModel):
    email: str

class ResetPassword(BaseModel):
    email: str
    otp: str
    new_password: str
