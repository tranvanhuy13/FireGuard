import os
import sqlite3

# AUTH_DB_PATH lets Docker keep the accounts in the persistent /data volume
DATABASE_PATH = os.getenv("AUTH_DB_PATH", "example.db")


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
            otp_attempts INTEGER DEFAULT 0
        )
        """
    )
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    if "otp_attempts" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN otp_attempts INTEGER DEFAULT 0")
    if "role" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))")
    if "is_blocked" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT 0")
    conn.commit()
    conn.close()
