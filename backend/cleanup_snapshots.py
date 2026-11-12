"""One-shot cleanup for an external hourly scheduler; no model or cameras loaded."""
from pathlib import Path
from dotenv import load_dotenv


def main():
    backend = Path(__file__).resolve().parent
    load_dotenv(backend / ".env.local")
    load_dotenv(backend / ".env")
    load_dotenv(backend.parent / ".env")
    import database
    import storage
    database.init_db()
    removed = storage.cleanup_evidence() + storage.cleanup_unregistered()
    print(f"Snapshot cleanup: {removed} copies deleted")


if __name__ == "__main__":
    main()
