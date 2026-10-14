import os
import sqlite3

DATABASE_PATH = "example.db"


def get_connection():
    conn = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            hashed_password TEXT,
            is_active BOOLEAN DEFAULT 0,
            otp TEXT,
            otp_expires_at TEXT,
            role TEXT NOT NULL DEFAULT 'viewer'
        )
        """
    )
    # migrate DB cũ: thêm cột role, user cũ sẽ là viewer
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    if "role" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT,
            detail TEXT
        )
        """
    )
    conn.commit()
    promote_configured_admins(conn)
    conn.close()


def promote_configured_admins(conn=None):
    """Tài khoản có username nằm trong ADMIN_USERNAMES (.env, ngăn cách bằng dấu phẩy) -> admin."""
    names = [n.strip().lower() for n in os.getenv("ADMIN_USERNAMES", "").split(",") if n.strip()]
    if not names:
        return
    own = conn is None
    conn = conn or get_connection()
    marks = ",".join("?" * len(names))
    conn.execute(
        f"UPDATE users SET role = 'admin' WHERE is_active = 1 AND lower(username) IN ({marks})",
        names,
    )
    conn.commit()
    if own:
        conn.close()