import pytest
import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Guard before importing application modules: collection imports main and starts services.
from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env.local"))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))
if os.getenv("FIREGUARD_TEST_MYSQL") != "1" or not os.getenv("MYSQL_DATABASE", "").endswith("_test"):
    pytest.exit("Integration pytest requires FIREGUARD_TEST_MYSQL=1 and MYSQL_DATABASE ending in _test; use unittest for offline checks.", returncode=4)

from unittest.mock import patch
from auth.utils import get_password_hash
from db.engine import get_connection

@pytest.fixture(autouse=True)
def mock_otp_email_sending():
    """Mock việc gửi email SMTP thật để test chạy độc lập, tốc độ cao và không phụ thuộc mạng ngoại vi"""
    with patch("auth.routes.send_otp_email", return_value=True):
        yield

@pytest.fixture(autouse=True)
def setup_test_user():
    """Tự động đảm bảo tài khoản kiểm thử chuẩn 'vyvy' luôn sẵn sàng trong database trước mỗi bài test"""
    conn = get_connection()
    conn.execute("DELETE FROM users WHERE username = 'vyvy' OR email = 'vynguyen30082005@gmail.com'")
    conn.execute(
        """
        INSERT INTO users (username, email, hashed_password, is_active, otp_attempts)
        VALUES (?, ?, ?, 1, 0)
        """,
        ('vyvy', 'vynguyen30082005@gmail.com', get_password_hash('vyvy12345678'))
    )
    conn.commit()
    conn.close()
    yield
    # Dọn dẹp và khôi phục trạng thái chuẩn sau mỗi bài test
    conn = get_connection()
    conn.execute("DELETE FROM users WHERE username = 'vyvy' OR email = 'vynguyen30082005@gmail.com'")
    conn.execute(
        """
        INSERT INTO users (username, email, hashed_password, is_active, otp_attempts)
        VALUES (?, ?, ?, 1, 0)
        """,
        ('vyvy', 'vynguyen30082005@gmail.com', get_password_hash('vyvy12345678'))
    )
    conn.commit()
    conn.close()
