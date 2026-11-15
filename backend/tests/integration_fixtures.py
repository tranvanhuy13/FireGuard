"""Database-writing fixtures, registered only after explicit integration opt-in."""
import pytest

from unittest.mock import patch
from app.auth.utils import get_password_hash
from app.db.engine import get_connection

@pytest.fixture(autouse=True)
def mock_otp_email_sending(request):
    """Prevent SMTP delivery only for live application tests."""
    if request.node.get_closest_marker("integration") is None:
        yield
        return
    with patch("app.auth.routes.send_otp_email", return_value=True):
        yield

@pytest.fixture(autouse=True)
def setup_test_user(request):
    """Reset the integration account without affecting offline or MySQL unit tests."""
    if request.node.get_closest_marker("integration") is None:
        yield
        return
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
