"""Operator-only test account with camera/video image persistence disabled.

Run from backend: python -m scripts.provisioning.provision_camera_test_account camtest
Password is prompted securely. Never stores or prints plaintext passwords.
For an existing account: python -m scripts.provisioning.provision_camera_test_account camtest --disable-images
"""
import argparse
import getpass
import sys

from app.auth.utils import get_password_hash
from app.db.engine import get_connection


def provision(username, password):
    username = username.strip()
    if not username or "@" in username or not password:
        raise ValueError("Username and password are required; username must not be an email")
    hashed = get_password_hash(password)
    with get_connection() as conn:
        conn.begin_serialized()
        if conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
            raise ValueError("Account already exists; no password or policy was changed")
        result = conn.execute("INSERT INTO users (username,email,hashed_password,is_active,role,is_blocked) "
                              "VALUES (?, '', ?, 1, 'user', 0)", (username, hashed))
        user_id = result.lastrowid
        conn.execute("INSERT INTO settings (`key`,value) VALUES (?, 'false')",
                     (f"camera_snapshots_enabled_user_{user_id}",))
        conn.execute("INSERT INTO settings (`key`,value) VALUES (?, 'false')",
                     (f"snapshots_enabled_user_{user_id}",))
    return user_id


def disable_images(username):
    """Idempotently opt an existing account out without changing its credentials."""
    with get_connection() as conn:
        conn.begin_serialized()
        row = conn.execute("SELECT id FROM users WHERE username=?", (username.strip(),)).fetchone()
        if row is None:
            raise ValueError("Account not found; no policy was changed")
        user_id = row["id"]
        for prefix in ("snapshots_enabled_user_", "camera_snapshots_enabled_user_"):
            conn.execute("INSERT INTO settings (`key`,value) VALUES (?, 'false') "
                         "ON DUPLICATE KEY UPDATE value='false'", (f"{prefix}{user_id}",))
    return user_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("--password-stdin", action="store_true", help="Read password from stdin for operator automation")
    parser.add_argument("--disable-images", action="store_true", help="Disable camera/video images for an existing account without resetting its password")
    args = parser.parse_args()
    if args.disable_images:
        user_id = disable_images(args.username)
        print(f"Disabled camera/video snapshots for {args.username} (id={user_id}); credentials unchanged")
        return
    password = sys.stdin.readline().rstrip("\r\n") if args.password_stdin else getpass.getpass("Password: ")
    user_id = provision(args.username, password)
    print(f"Created active user {args.username} (id={user_id}), no email, camera/video snapshots disabled")


if __name__ == "__main__":
    main()
