"""Persistent notification destinations shared by the UI and bot delivery."""
import sqlite3
import uuid
from contextlib import contextmanager

import database


@contextmanager
def connection():
    conn = sqlite3.connect(database.DB_NAME, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("""CREATE TABLE IF NOT EXISTS notification_targets (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, channel TEXT NOT NULL,
            friendly_name TEXT NOT NULL, chat_id TEXT NOT NULL, active INTEGER NOT NULL,
            UNIQUE(channel, chat_id))""")
        with conn:
            yield conn
    finally:
        conn.close()


def public(row):
    return {"id": row["id"], "channel": row["channel"], "friendlyName": row["friendly_name"],
            "chatId": row["chat_id"], "active": bool(row["active"])}


def list_targets(kind=None, channel=None):
    conditions, args = [], []
    for key, value in (("kind", kind), ("channel", channel)):
        if value is not None:
            conditions.append(key + "=?")
            args.append(value)
    with connection() as conn:
        rows = conn.execute("SELECT * FROM notification_targets" +
                            (" WHERE " + " AND ".join(conditions) if conditions else "") +
                            " ORDER BY rowid", args).fetchall()
        return [public(row) for row in rows]


def save_target(kind, body, target_id=None):
    with connection() as conn:
        if target_id and not conn.execute("SELECT 1 FROM notification_targets WHERE id=? AND kind=?",
                                          (target_id, kind)).fetchone():
            raise KeyError(target_id)
        target_id = target_id or uuid.uuid4().hex
        if not conn.execute("SELECT 1 FROM notification_targets WHERE id=?", (target_id,)).fetchone():
            if conn.execute("SELECT COUNT(*) FROM notification_targets WHERE channel=?", (body.channel,)).fetchone()[0] >= 20:
                raise ValueError("A channel supports at most 20 saved recipients")
        conn.execute("""INSERT INTO notification_targets(id,kind,channel,friendly_name,chat_id,active)
            VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET channel=excluded.channel,
            friendly_name=excluded.friendly_name,chat_id=excluded.chat_id,active=excluded.active""",
                     (target_id, kind, body.channel, body.friendlyName, body.chatId, int(body.active)))
        # Turning a recipient on also turns on its channel's persisted switch.
        # A process/environment *_ENABLED override still has higher priority.
        if body.active:
            conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?, 'true')",
                         (body.channel + "_enabled",))
        return public(conn.execute("SELECT * FROM notification_targets WHERE id=?", (target_id,)).fetchone())


def delete_target(kind, target_id):
    with connection() as conn:
        if not conn.execute("DELETE FROM notification_targets WHERE id=? AND kind=?", (target_id, kind)).rowcount:
            raise KeyError(target_id)
