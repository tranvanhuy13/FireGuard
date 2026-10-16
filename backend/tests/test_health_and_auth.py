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
