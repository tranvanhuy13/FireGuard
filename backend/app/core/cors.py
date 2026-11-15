"""Explicit deployment allowlist; development defaults apply only when unset."""
import os
from urllib.parse import urlsplit


def cors_options():
    configured = os.getenv("CORS_ORIGINS")
    if configured is None:
        return {"allow_origins": ["https://fireguard-279w.onrender.com", "https://fireguard-10hd.onrender.com",
                                  "http://localhost:3000", "http://127.0.0.1:3000"],
                "allow_origin_regex": r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$"}
    origins = []
    for value in configured.split(","):
        value = value.strip().rstrip("/")
        if not value:
            continue
        parsed = urlsplit(value)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username
                or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("CORS_ORIGINS must contain comma-separated HTTP(S) origins")
        origins.append(value)
    return {"allow_origins": origins}
