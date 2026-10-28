import pytest
from httpx import AsyncClient, ASGITransport
import sys
import os
import base64

# Đảm bảo đường dẫn import và working directory trỏ đúng vào thư mục backend
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

from main import app

def make_basic_auth(username: str, password: str) -> dict:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}

@pytest.mark.asyncio
async def test_root_health_check():
    """1. Kiểm tra endpoint root / hoạt động và trả về status 200"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"

@pytest.mark.asyncio
async def test_signup_validation_special_characters():
    """2. Kiểm tra validation đăng ký: username chứa ký tự đặc biệt -> 400"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "username": "user@#$",
            "email": "test@gmail.com",
            "password": "Password123"
        }
        response = await client.post("/auth/signup", json=payload)
        assert response.status_code == 400
        assert "special characters" in response.json().get("detail", "")

@pytest.mark.asyncio
async def test_signup_validation_non_gmail():
    """3. Kiểm tra validation đăng ký: email không phải Gmail -> 400"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "username": "validuser123",
            "email": "test@yahoo.com",
            "password": "Password123"
        }
        response = await client.post("/auth/signup", json=payload)
        assert response.status_code == 400
        assert "Gmail" in response.json().get("detail", "")

@pytest.mark.asyncio
async def test_signup_duplicate_username():
    """4. Kiểm tra đăng ký trùng tên username -> 400 Username already registered"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "username": "vyvy",
            "email": "newuniqueemail999@gmail.com",
            "password": "Password123"
        }
        response = await client.post("/auth/signup", json=payload)
        assert response.status_code == 400
        assert "Username already registered" in response.json().get("detail", "")

@pytest.mark.asyncio
async def test_signup_duplicate_email():
    """5. Kiểm tra đăng ký trùng email -> 400 Email already registered"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "username": "newuniqueuser999",
            "email": "vynguyen30082005@gmail.com",
            "password": "Password123"
        }
        response = await client.post("/auth/signup", json=payload)
        assert response.status_code == 400
        assert "Email already registered" in response.json().get("detail", "")

@pytest.mark.asyncio
async def test_protected_routes_without_auth():
    """6. Kiểm tra các route bảo vệ yêu cầu xác thực HTTP Basic Auth -> 401"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/users/me")
        assert response.status_code == 401

        response = await client.get("/auth/login")
        assert response.status_code == 401

        response = await client.get("/auth/stream-token")
        assert response.status_code == 401

@pytest.mark.asyncio
async def test_login_success_with_valid_username():
    """7. Kiểm tra đăng nhập thành công qua Basic Auth bằng username vyvy -> 200 OK"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = make_basic_auth("vyvy", "vyvy12345678")
        response = await client.get("/auth/login", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("username") == "vyvy"
        assert data.get("email") == "vynguyen30082005@gmail.com"
        assert data.get("is_active") == 1

@pytest.mark.asyncio
async def test_login_wrong_password():
    """8. Kiểm tra đăng nhập sai mật khẩu -> 401 Unauthorized"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = make_basic_auth("vyvy", "WrongPassword999")
        response = await client.get("/auth/login", headers=headers)
        assert response.status_code == 401
        assert "Incorrect username or password" in response.json().get("detail", "")

@pytest.mark.asyncio
async def test_login_with_email_success():
    """9. Kiểm tra tính năng mới (Commit 56bb42f): Đăng nhập thành công bằng Email -> 200 OK"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = make_basic_auth("vynguyen30082005@gmail.com", "vyvy12345678")
        response = await client.get("/auth/login", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("username") == "vyvy"
        assert data.get("email") == "vynguyen30082005@gmail.com"
        assert data.get("is_active") == 1

@pytest.mark.asyncio
async def test_users_me_success():
    """10. Kiểm tra lấy thông tin cá nhân /users/me sau khi xác thực"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = make_basic_auth("vyvy", "vyvy12345678")
        response = await client.get("/users/me", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("username") == "vyvy"

@pytest.mark.asyncio
async def test_auth_stream_token_success():
    """11. Kiểm tra cấp token luồng video /auth/stream-token"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = make_basic_auth("vyvy", "vyvy12345678")
        response = await client.get("/auth/stream-token", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data.get("expires_in") == 3600

@pytest.mark.asyncio
async def test_forgot_password_generic_response():
    """12. Kiểm tra API /auth/forgot-password luôn trả về thông điệp chung (chống liệt kê tài khoản)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Trường hợp email tồn tại
        res_exist = await client.post("/auth/forgot-password", json={"email": "vynguyen30082005@gmail.com"})
        assert res_exist.status_code == 200
        assert "If that account exists" in res_exist.json().get("message", "")

        # Trường hợp email không tồn tại
        res_nonexist = await client.post("/auth/forgot-password", json={"email": "nonexistent999@gmail.com"})
        assert res_nonexist.status_code == 200
        assert "If that account exists" in res_nonexist.json().get("message", "")

@pytest.mark.asyncio
async def test_reset_password_validations():
    """13. Special characters reach OTP validation; short passwords are rejected."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # A special-character password is accepted by validation; this unknown account has no reset OTP.
        res_special = await client.post("/auth/reset-password", json={
            "email": "unknown-reset-validation@gmail.com",
            "otp": "123456",
            "new_password": "Pass!@#$123"
        })
        assert res_special.status_code == 400
        assert res_special.json().get("detail") == "Invalid or expired code"

        # Mật khẩu ngắn dưới 8 ký tự -> 400
        res_short = await client.post("/auth/reset-password", json={
            "email": "unknown-reset-validation@gmail.com",
            "otp": "123456",
            "new_password": "Pass12"
        })
        assert res_short.status_code == 400
        assert "at least 8 characters" in res_short.json().get("detail", "")

@pytest.mark.asyncio
async def test_full_reset_password_and_login_flow():
    """14. Kiểm tra toàn trình: Verify Reset OTP -> Đổi mật khẩu mới -> Đăng nhập bằng mật khẩu mới thành công"""
    import sqlite3
    from auth.utils import otp_expiry

    # Giả lập mã OTP hợp lệ trong DB cho tài khoản vyvy
    expiry_time = otp_expiry()
    db_path = os.path.join(BACKEND_DIR, "example.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE users SET otp = '888888', otp_expires_at = ?, otp_attempts = 0 WHERE username = 'vyvy'",
        (expiry_time,)
    )
    conn.commit()
    conn.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Bước 1: Verify OTP sai -> 400 INVALID_OTP
        res_wrong = await client.post("/auth/verify-reset-otp", json={
            "email": "vynguyen30082005@gmail.com",
            "otp": "111111"
        })
        assert res_wrong.status_code == 400
        assert res_wrong.json().get("detail") == "INVALID_OTP"

        # Bước 2: Verify OTP đúng -> 200 OK
        res_verify = await client.post("/auth/verify-reset-otp", json={
            "email": "vynguyen30082005@gmail.com",
            "otp": "888888"
        })
        assert res_verify.status_code == 200
        assert res_verify.json().get("message") == "OTP verified"
        assert "expires_in" in res_verify.json()

        # Bước 3: Đổi sang mật khẩu mới hợp lệ
        res_reset = await client.post("/auth/reset-password", json={
            "email": "vynguyen30082005@gmail.com",
            "otp": "888888",
            "new_password": "NewPassword888"
        })
        assert res_reset.status_code == 200
        assert res_reset.json().get("message") == "Password has been reset"

        # Bước 4: Đăng nhập bằng mật khẩu cũ -> 401
        res_old_login = await client.get("/auth/login", headers=make_basic_auth("vyvy", "vyvy12345678"))
        assert res_old_login.status_code == 401

        # Bước 5: Đăng nhập bằng mật khẩu mới -> 200 OK!
        res_new_login = await client.get("/auth/login", headers=make_basic_auth("vyvy", "NewPassword888"))
        assert res_new_login.status_code == 200
        assert res_new_login.json().get("username") == "vyvy"

