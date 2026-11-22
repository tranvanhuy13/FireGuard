"""MySQL repositories for camera events, settings and camera configuration."""
from datetime import datetime, timedelta, timezone

from app.db.engine import check_database, get_connection, read_rows
from app.settings.cache import SettingsCache


def _load_settings():
    return {row[0]: row[1] for row in read_rows("SELECT `key`, value FROM settings")}


_settings = SettingsCache(_load_settings)


def peek_settings():
    return _settings.peek()


def cache_setting(key, value):
    _settings.put(key, value)


def init_db():
    """Check migrated schema. Schema creation is an explicit Alembic operation."""
    check_database()


def add_event(type, confidence, snapshot_path=None, *, camera_id=None, camera_name=None,
              owner_user_id=None, source_kind="camera", video_job_id=None, video_time=None, video_name=None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.execute("INSERT INTO events (timestamp, type, confidence, snapshot_path, camera_id, camera_name, "
                              "owner_user_id, source_kind, video_job_id, video_time, video_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                              (timestamp, type, confidence, snapshot_path, camera_id, camera_name,
                               owner_user_id, source_kind, video_job_id, video_time, video_name))
        return cursor.lastrowid, timestamp


def get_recent_events(limit=50, *, owner_user_id):
    with get_connection() as conn:
        return conn.execute("SELECT * FROM events WHERE owner_user_id=? ORDER BY id DESC LIMIT ?",
                            (owner_user_id, limit)).fetchall()


def get_daily_stats(days=7, *, owner_user_id):
    # Preserve SQLite date('now', '-N days'): UTC date boundary, string comparison.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    with get_connection() as conn:
        return conn.execute("SELECT SUBSTR(timestamp, 1, 10) AS date, COUNT(*) AS count "
                            "FROM events WHERE timestamp >= ? AND owner_user_id=? AND source_kind='camera' "
                            "GROUP BY date ORDER BY date ASC", (cutoff, owner_user_id)).fetchall()


def get_all_events(limit=100, offset=0):
    with get_connection() as conn:
        return conn.execute("SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()


def search_events(limit=50, offset=0, *, search="", event_type="all", status="all",
                  sort="timestamp", direction="desc", max_id=None, owner_user_id=None):
    sortable = {"timestamp", "camera_id", "type", "confidence", "status", "id"}
    if sort not in sortable or direction not in ("asc", "desc"):
        raise ValueError("Invalid history order")
    clauses, args = ["source_kind = 'camera'"], []
    if owner_user_id is not None:
        clauses.append("owner_user_id = ?")
        args.append(owner_user_id)
    for column, value in (("type", event_type), ("status", status)):
        if value != "all":
            clauses.append(column + " = ?")
            args.append(value)
    if search:
        pattern = "%" + search.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        clauses.append("(CAST(id AS CHAR) LIKE ? ESCAPE '!' OR CAST(camera_id AS CHAR) LIKE ? ESCAPE '!' OR camera_name LIKE ? ESCAPE '!')")
        args.extend([pattern] * 3)
    with get_connection() as conn:
        if max_id is not None:
            clauses.append("id <= ?")
            args.append(max_id)
        where = " WHERE " + " AND ".join(clauses)
        # Count and establish the export watermark in one round trip.
        summary = conn.execute("SELECT COUNT(*) AS total, MAX(id) AS max_id FROM events" + where, args).fetchone()
        total = summary["total"]
        watermark = max_id if max_id is not None else summary["max_id"] or 0
        where += " AND id <= ?"
        args.append(watermark)
        rows = conn.execute("SELECT * FROM events" + where +
                            f" ORDER BY {sort} {direction}, id {direction} LIMIT ? OFFSET ?",
                            [*args, limit, offset]).fetchall()
    return {"events": rows, "total": total, "max_id": watermark or 0}


def get_setting(key, default=None):
    return _settings.snapshot().get(key, default)


def set_setting(key, value):
    with get_connection() as conn:
        conn.execute("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=?",
                     (key, value, value))
    cache_setting(key, value)


def get_all_settings():
    with get_connection() as conn:
        return {row[0]: row[1] for row in conn.execute("SELECT `key`, value FROM settings")}


def add_db_camera(name, source, is_active=0, *, owner_user_id=None):
    with get_connection() as conn:
        return conn.execute("INSERT INTO cameras (name, source, is_active, created_at, owner_user_id) VALUES (?, ?, ?, ?, ?)",
                            (name, source, int(is_active), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), owner_user_id)).lastrowid


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


def update_event_status(event_id, status, username, *, owner_user_id=None):
    with get_connection() as conn:
        scope = " AND owner_user_id=?" if owner_user_id is not None else ""
        args = [status, username, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), event_id]
        if owner_user_id is not None:
            args.append(owner_user_id)
        return conn.execute("UPDATE events SET status=?, handled_by=?, handled_at=? WHERE id=?" + scope, args).rowcount > 0
