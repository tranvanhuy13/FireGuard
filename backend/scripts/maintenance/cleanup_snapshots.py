"""One-shot cleanup for an external hourly scheduler; no model or cameras loaded."""
from pathlib import Path
from dotenv import load_dotenv


def main():
    from app.core.config import BACKEND_DIR
    backend = BACKEND_DIR
    load_dotenv(backend / ".env.local")
    load_dotenv(backend / ".env")
    load_dotenv(backend.parent / ".env")
    from app.db.repositories import operations as database
    from app.storage import service as storage
    database.init_db()
    removed = storage.cleanup_evidence() + storage.cleanup_unregistered()
    print(f"Snapshot cleanup: {removed} copies deleted")


if __name__ == "__main__":
    main()
