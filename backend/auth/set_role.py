"""Local operator command: python -m auth.set_role USERNAME admin|user."""
import argparse
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env.local")
load_dotenv(BACKEND_DIR / ".env")
from .database import init_db, get_connection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("role", choices=("user", "admin"))
    args = parser.parse_args()
    init_db()
    db = get_connection()
    try:
        db.execute("BEGIN IMMEDIATE")
        target = db.execute("SELECT * FROM users WHERE username = ?", (args.username,)).fetchone()
        if not target or not target["is_active"] or target["is_blocked"]:
            parser.error("An existing verified, unblocked account is required")
        count = db.execute("SELECT count(*) FROM users WHERE role='admin' AND is_active=1 AND is_blocked=0").fetchone()[0]
        if target["role"] == "admin" and args.role == "user" and count <= 1:
            parser.error("Cannot demote the last active admin")
        db.execute("UPDATE users SET role=? WHERE id=?", (args.role, target["id"]))
        db.commit()
        print(f"Updated {args.username}: {args.role}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
