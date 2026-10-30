"""MySQL repositories for camera events, settings and camera configuration."""
from datetime import datetime, timedelta, timezone

from db.engine import check_database, get_connection


def init_db():
    """Check migrated schema. Schema creation is an explicit Alembic operation."""
    check_database()


def add_event(type, confidence, snapshot_path=None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.execute("INSERT INTO events (timestamp, type, confidence, snapshot_path) VALUES (?, ?, ?, ?)",
                              (timestamp, type, confidence, snapshot_path))
        return cursor.lastrowid, timestamp


def get_recent_events(limit=50):
    return get_all_events(limit)


def get_daily_stats(days=7):
    # Preserve SQLite date('now', '-N days'): UTC date boundary, string comparison.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    with get_connection() as conn:
        return conn.execute("SELECT SUBSTR(timestamp, 1, 10) AS date, COUNT(*) AS count "
                            "FROM events WHERE timestamp >= ? GROUP BY date ORDER BY date ASC", (cutoff,)).fetchall()


def get_all_events(limit=100, offset=0):
    with get_connection() as conn:
        return conn.execute("SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()


def get_setting(key, default=None):
    with get_connection() as conn:
        row = conn.execute("SELECT value FROM settings WHERE `key`=?", (key,)).fetchone()
        return row[0] if row else default


def set_setting(key, value):
    with get_connection() as conn:
        conn.execute("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=?",
                     (key, value, value))


def get_all_settings():
    with get_connection() as conn:
        return {row[0]: row[1] for row in conn.execute("SELECT `key`, value FROM settings")}


def add_db_camera(name, source, is_active=1):
    with get_connection() as conn:
        return conn.execute("INSERT INTO cameras (name, source, is_active, created_at) VALUES (?, ?, ?, ?)",
                            (name, source, int(is_active), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))).lastrowid


def delete_db_camera(camera_id):
    with get_connection() as conn:
        conn.execute("DELETE FROM cameras WHERE id=?", (camera_id,))
    return True


def update_db_camera(camera_id, name, source, is_active):
    with get_connection() as conn:
        conn.execute("UPDATE cameras SET name=?, source=?, is_active=? WHERE id=?",
                     (name, source, int(is_active), camera_id))


def get_all_db_cameras():
    with get_connection() as conn:
        return conn.execute("SELECT * FROM cameras ORDER BY id ASC").fetchall()


def set_db_camera_status(camera_id, is_active):
    with get_connection() as conn:
        conn.execute("UPDATE cameras SET is_active=? WHERE id=?", (int(is_active), camera_id))
    return True


def update_event_status(event_id, status, username):
    with get_connection() as conn:
        return conn.execute("UPDATE events SET status=?, handled_by=?, handled_at=? WHERE id=?",
                            (status, username, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), event_id)).rowcount > 0
