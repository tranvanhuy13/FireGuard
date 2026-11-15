"""Shared MySQL failure budget; reservations also bound concurrent guesses."""
import hashlib
import math
import time
import uuid

from fastapi import HTTPException

WINDOW_SECONDS = 60
ACCOUNT_LIMIT = 5
IP_LIMIT = 50


def reject(retry_after):
    raise HTTPException(429, detail="LOGIN_RATE_LIMITED",
                        headers={"Retry-After": str(max(1, math.ceil(retry_after)))})


def reserve(db, identifier, user, client_ip):
    now = time.time()
    normalized = identifier.strip()
    if "@" in normalized:
        normalized = normalized.lower()
    account = f"user:{user.id}" if user else "unknown:" + hashlib.sha256(normalized.encode()).hexdigest()
    scopes = [(account, ACCOUNT_LIMIT), ("ip:" + client_ip, IP_LIMIT)]
    ticket = uuid.uuid4().hex
    db.begin_serialized()
    try:
        db.execute("DELETE FROM login_attempts WHERE expires_at <= ?", (now,))
        for scope, limit in scopes:
            rows = db.execute("SELECT expires_at FROM login_attempts WHERE scope = ? ORDER BY expires_at", (scope,)).fetchall()
            if len(rows) >= limit:
                reject(rows[len(rows) - limit][0] - now)
        db.executemany("INSERT INTO login_attempts (ticket, scope, expires_at) VALUES (?, ?, ?)",
                       [(ticket, scope, now + WINDOW_SECONDS) for scope, _ in scopes])
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return ticket, scopes


def finish(db, ticket, scopes, success):
    if success:
        db.execute("DELETE FROM login_attempts WHERE ticket = ?", (ticket,))
        db.commit()
        return
    now = time.time()
    for scope, limit in scopes:
        rows = db.execute("SELECT expires_at FROM login_attempts WHERE scope = ? AND expires_at > ? ORDER BY expires_at", (scope, now)).fetchall()
        if len(rows) >= limit:
            reject(rows[len(rows) - limit][0] - now)
