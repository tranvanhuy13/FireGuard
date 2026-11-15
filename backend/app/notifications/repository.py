"""Account-owned destinations shared by the UI and bot delivery."""
import uuid
from contextlib import contextmanager

from app.db.engine import get_connection, read_rows


@contextmanager
def connection():
    with get_connection() as conn:
        yield conn


def public(row):
    return {"id": row["id"], "channel": row["channel"], "friendlyName": row["friendly_name"],
            "chatId": row["chat_id"], "active": bool(row["active"])}


def list_targets(kind=None, channel=None, *, owner_user_id=None):
    if owner_user_id is None:
        return []
    conditions, args = ["owner_user_id=?"], [owner_user_id]
    for key, value in (("kind", kind), ("channel", channel)):
        if value is not None:
            conditions.append(key + "=?")
            args.append(value)
    rows = read_rows("SELECT * FROM notification_targets" +
                            (" WHERE " + " AND ".join(conditions) if conditions else "") +
                            " ORDER BY sequence", args)
    return [public(row) for row in rows]


def save_target(kind, body, target_id=None, *, owner_user_id):
    if owner_user_id is None:
        raise ValueError("Recipient owner is required")
    with connection() as conn:
        conn.begin_serialized("notifications")
        if target_id and not conn.execute("SELECT 1 FROM notification_targets WHERE id=? AND kind=? AND owner_user_id=?",
                                          (target_id, kind, owner_user_id)).fetchone():
            raise KeyError(target_id)
        target_id = target_id or uuid.uuid4().hex
        if conn.execute("SELECT COUNT(*) FROM notification_targets WHERE channel=? AND id<>? AND owner_user_id=?",
                        (body.channel, target_id, owner_user_id)).fetchone()[0] >= 20:
            raise ValueError("A channel supports at most 20 saved recipients")
        # Updating explicitly prevents a chat-ID collision from overwriting a
        # different recipient, as a MySQL multi-unique-key upsert could do.
        if conn.execute("SELECT 1 FROM notification_targets WHERE id=? AND owner_user_id=?", (target_id, owner_user_id)).fetchone():
            conn.execute("UPDATE notification_targets SET channel=?, friendly_name=?, chat_id=?, active=? WHERE id=? AND owner_user_id=?",
                         (body.channel, body.friendlyName, body.chatId, int(body.active), target_id, owner_user_id))
        else:
            conn.execute("INSERT INTO notification_targets(id,kind,channel,friendly_name,chat_id,active,owner_user_id) VALUES (?,?,?,?,?,?,?)",
                         (target_id, kind, body.channel, body.friendlyName, body.chatId, int(body.active), owner_user_id))
        saved = public(conn.execute("SELECT * FROM notification_targets WHERE id=? AND owner_user_id=?", (target_id, owner_user_id)).fetchone())
    return saved


def delete_target(kind, target_id, *, owner_user_id):
    with connection() as conn:
        if not conn.execute("DELETE FROM notification_targets WHERE id=? AND kind=? AND owner_user_id=?", (target_id, kind, owner_user_id)).rowcount:
            raise KeyError(target_id)
