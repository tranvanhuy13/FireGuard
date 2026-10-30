"""Runtime configuration shared by the API, migrations and operator commands."""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import URL

BACKEND_DIR = Path(__file__).resolve().parents[1]


def settings():
    load_dotenv(BACKEND_DIR / ".env.local")
    load_dotenv(BACKEND_DIR / ".env")
    required = ("MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_SSL_CA")
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        raise RuntimeError("Missing MySQL configuration: " + ", ".join(missing))
    ca = Path(os.environ["MYSQL_SSL_CA"]).expanduser()
    if not ca.is_absolute():
        ca = BACKEND_DIR / ca
    if not ca.is_file():
        raise RuntimeError("MYSQL_SSL_CA must point to an existing CA certificate file")
    port = int(os.environ["MYSQL_PORT"])
    if not 1 <= port <= 65535:
        raise ValueError("MYSQL_PORT must be between 1 and 65535")
    url = URL.create("mysql+pymysql", username=os.environ["MYSQL_USER"],
                     password=os.environ["MYSQL_PASSWORD"], host=os.environ["MYSQL_HOST"],
                     port=port, database=os.environ["MYSQL_DATABASE"], query={"charset": "utf8mb4"})
    options = {}
    for env, name, default, minimum in (
        ("DB_POOL_SIZE", "pool_size", 5, 1),
        ("DB_MAX_OVERFLOW", "max_overflow", 5, 0),
        ("DB_POOL_TIMEOUT", "pool_timeout", 10, 1),
        ("DB_POOL_RECYCLE", "pool_recycle", 300, 1),
    ):
        value = int(os.getenv(env, str(default)))
        if value < minimum:
            raise ValueError(f"{env} must be >= {minimum}")
        options[name] = value
    return url, {
        **options, "pool_pre_ping": True, "isolation_level": "READ COMMITTED", "hide_parameters": True,
        "connect_args": {"ssl_ca": str(ca), "ssl_verify_cert": True, "ssl_verify_identity": True,
                         "connect_timeout": 10, "read_timeout": 10, "write_timeout": 10},
    }
