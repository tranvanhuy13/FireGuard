import pytest
import sqlite3
import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from unittest.mock import patch
from auth.utils import get_password_hash

@pytest.fixture(autouse=True)
def mock_otp_email_sending():
    """Mock việc gửi email SMTP thật để test chạy độc lập, tốc độ cao và không phụ thuộc mạng ngoại vi"""
    with patch("auth.routes.send_otp_email", return_value=True):
        yield

@pytest.fixture(autouse=True)
def setup_test_user():
    """Tự động đảm bảo tài khoản kiểm thử chuẩn 'vyvy' luôn sẵn sàng trong database trước mỗi bài test"""
    db_path = os.path.join(BACKEND_DIR, "example.db")
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM users WHERE username = 'vyvy' OR email = 'vynguyen30082005@gmail.com'")
    conn.execute(
        """
        INSERT INTO users (username, email, hashed_password, is_active, otp_attempts)
        VALUES (?, ?, ?, 1, 0)
        """,
        ('vyvy', 'vynguyen30082005@gmail.com', get_password_hash('vyvy12345678'))
    )
    conn.commit()
    yield
    # Dọn dẹp và khôi phục trạng thái chuẩn sau mỗi bài test
    conn = sqlite3.connect(db_path)
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
