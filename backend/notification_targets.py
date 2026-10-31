"""Persistent notification destinations shared by the UI and bot delivery."""
import uuid
from contextlib import contextmanager

from db.engine import get_connection, read_rows
from database import cache_setting


@contextmanager
def connection():
    with get_connection() as conn:
        yield conn


def public(row):
    return {"id": row["id"], "channel": row["channel"], "friendlyName": row["friendly_name"],
            "chatId": row["chat_id"], "active": bool(row["active"])}


def list_targets(kind=None, channel=None):
    conditions, args = [], []
    for key, value in (("kind", kind), ("channel", channel)):
        if value is not None:
            conditions.append(key + "=?")
            args.append(value)
    rows = read_rows("SELECT * FROM notification_targets" +
                            (" WHERE " + " AND ".join(conditions) if conditions else "") +
                            " ORDER BY sequence", args)
    return [public(row) for row in rows]


def save_target(kind, body, target_id=None):
    with connection() as conn:
        conn.begin_serialized("notifications")
        if target_id and not conn.execute("SELECT 1 FROM notification_targets WHERE id=? AND kind=?",
                                          (target_id, kind)).fetchone():
            raise KeyError(target_id)
        target_id = target_id or uuid.uuid4().hex
        if conn.execute("SELECT COUNT(*) FROM notification_targets WHERE channel=? AND id<>?",
                        (body.channel, target_id)).fetchone()[0] >= 20:
            raise ValueError("A channel supports at most 20 saved recipients")
        # Updating explicitly prevents a chat-ID collision from overwriting a
        # different recipient, as a MySQL multi-unique-key upsert could do.
        if conn.execute("SELECT 1 FROM notification_targets WHERE id=?", (target_id,)).fetchone():
            conn.execute("UPDATE notification_targets SET channel=?, friendly_name=?, chat_id=?, active=? WHERE id=?",
                         (body.channel, body.friendlyName, body.chatId, int(body.active), target_id))
        else:
            conn.execute("INSERT INTO notification_targets(id,kind,channel,friendly_name,chat_id,active) VALUES (?,?,?,?,?,?)",
                         (target_id, kind, body.channel, body.friendlyName, body.chatId, int(body.active)))
        # Turning a recipient on also turns on its channel's persisted switch.
        # A process/environment *_ENABLED override still has higher priority.
        if body.active:
            conn.execute("INSERT INTO settings(`key`,value) VALUES (?, 'true') ON DUPLICATE KEY UPDATE value='true'",
                         (body.channel + "_enabled",))
        saved = public(conn.execute("SELECT * FROM notification_targets WHERE id=?", (target_id,)).fetchone())
    if body.active:
        cache_setting(body.channel + "_enabled", "true")
    return saved


def delete_target(kind, target_id):
    with connection() as conn:
        if not conn.execute("DELETE FROM notification_targets WHERE id=? AND kind=?", (target_id, kind)).rowcount:
            raise KeyError(target_id)
