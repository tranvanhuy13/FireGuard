import logging
from datetime import datetime, timezone
from .database import get_connection

logger = logging.getLogger(__name__)


def log_action(user, action: str, target: str | None = None, detail: str | None = None):
    """Ghi audit log. Không bao giờ làm hỏng request chính nếu ghi lỗi."""
    try:
        conn = get_connection()
        try:
            conn.execute(
                "INSERT INTO audit_log (timestamp, username, role, action, target, detail) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 user.username, user.role, action, target, detail),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        logger.exception("Could not write audit log")