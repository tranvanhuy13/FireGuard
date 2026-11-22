"""Render/Docker entrypoint: migrate successfully before opening the API port."""
import os
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


def migrate():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text
    from app.core.config import load_environment
    load_environment()
    from app.db.engine import get_engine, dispose_engine

    try:
        with get_engine().connect() as connection:
            # Serialize startup migrations across instances sharing this database.
            # MySQL advisory locks survive the implicit commits performed by DDL.
            lock = "fireguard_schema_migration"
            acquired = connection.execute(text("SELECT GET_LOCK(:name, 60)"), {"name": lock}).scalar()
            if acquired != 1:
                raise RuntimeError("Could not acquire schema migration lock")
            try:
                connection.commit()
                config = Config(str(BACKEND_DIR / "alembic.ini"))
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
            finally:
                connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": lock})
    finally:
        dispose_engine()


def main():
    os.chdir(BACKEND_DIR)
    port = int(os.getenv("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    migrate()
    # Replace the wrapper so Render SIGTERM reaches Uvicorn directly.
    os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "main:app",
                            "--host", "0.0.0.0", "--port", str(port), "--log-level", "info"])


if __name__ == "__main__":
    main()
