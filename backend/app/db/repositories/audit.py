"""Bounded, server-filtered audit pages for administrators."""
from datetime import datetime, timezone

from app.auth.database import get_connection


def search_audit(limit=25, offset=0, *, search="", action="", date_from="", date_to="",
                 sort="timestamp", direction="desc", max_id=None):
    if sort not in {"id", "timestamp", "username", "action", "target", "detail"} or direction not in {"asc", "desc"}:
        raise ValueError("Invalid audit order")
    clauses, args = [], []
    for column, operator, value in (("timestamp", ">=", date_from), ("timestamp", "<", date_to)):
        if value:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            clauses.append(f"{column} {operator} ?")
            args.append(parsed.astimezone(timezone.utc).isoformat(timespec="seconds"))
    if action:
        clauses.append("action = ?")
        args.append(action)
    if search:
        pattern = "%" + search.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        clauses.append("(" + " OR ".join(f"{col} LIKE ? ESCAPE '!'" for col in ("username", "action", "target", "detail")) + ")")
        args.extend([pattern] * 4)
    with get_connection() as conn:
        watermark = max_id if max_id is not None else conn.execute("SELECT MAX(id) FROM audit_log").fetchone()[0] or 0
        clauses.append("id <= ?")
        args.append(watermark)
        where = " WHERE " + " AND ".join(clauses)
        total = conn.execute("SELECT COUNT(*) FROM audit_log" + where, args).fetchone()[0]
        # IDs are insertion ordered; avoid sorting timestamp ties by an unrelated key.
        rows = conn.execute("SELECT * FROM audit_log" + where +
                            f" ORDER BY {sort} {direction}, id {direction} LIMIT ? OFFSET ?",
                            [*args, limit, offset]).fetchall()
    return {"logs": [dict(row) for row in rows], "total": total, "max_id": watermark}
