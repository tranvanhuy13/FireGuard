"""Durable ownership and seven-day retention for private snapshot evidence."""
import json
import time
from fastapi import HTTPException
from db.engine import get_connection

RETENTION_SECONDS = 7 * 86400


def register(name, owner_user_id, source_kind, source_id):
    now = time.time()
    with get_connection() as conn:
        conn.execute("INSERT INTO snapshots (name, owner_user_id, source_kind, source_id, created_at, expires_at) "
                     "VALUES (?, ?, ?, ?, ?, ?)",
                     (name, owner_user_id, source_kind, str(source_id), now, now + RETENTION_SECONDS))


def find(name):
    with get_connection() as conn:
        return conn.execute("SELECT * FROM snapshots WHERE name=?", (name,)).fetchone()


def require_snapshot(name, user_id):
    row = find(name)
    if row is None or row["owner_user_id"] != user_id:
        raise HTTPException(404, "Snapshot not found")
    if row["expires_at"] <= time.time() or row["deleted_at"] is not None:
        raise HTTPException(410, "Snapshot expired")
    return row


def expired(limit=500, now=None):
    with get_connection() as conn:
        return conn.execute("SELECT * FROM snapshots WHERE expires_at <= ? AND deleted_at IS NULL "
                            "ORDER BY expires_at LIMIT ?", (time.time() if now is None else now, limit)).fetchall()


def mark_deleted(name):
    with get_connection() as conn:
        conn.execute("UPDATE snapshots SET deleted_at=? WHERE name=?", (time.time(), name))


def save_job(job):
    """Persist metadata/results, never the base64 preview or source video."""
    payload = json.dumps({key: value for key, value in job.items() if key != "frame"})
    with get_connection() as conn:
        conn.execute("INSERT INTO video_jobs (id, owner_user_id, payload) VALUES (?, ?, ?) "
                     "ON DUPLICATE KEY UPDATE payload=?", (job["id"], job["owner_user_id"], payload, payload))


def archived_jobs(user_id, job_id=None):
    with get_connection() as conn:
        scope = " AND id=?" if job_id is not None else ""
        args = (user_id, job_id) if job_id is not None else (user_id,)
        rows = conn.execute("SELECT payload FROM video_jobs WHERE owner_user_id=?" + scope +
                            " ORDER BY sequence DESC LIMIT 50", args).fetchall()
    jobs = []
    for row in rows:
        job = json.loads(row["payload"])
        # Decoder and notification queues cannot be resumed after a process restart.
        if job["status"] not in ("done", "error", "cancelled"):
            job.update(status="error", error="Analysis interrupted; upload the video again.")
        job.update(archived=True, notification_pending=0, notifications={}, notifications_cancelled=True)
        jobs.append(job)
    return jobs
