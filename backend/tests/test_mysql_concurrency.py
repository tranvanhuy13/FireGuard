"""Opt-in real MySQL tests. Requires an EMPTY migrated *_test database.

Set FIREGUARD_TEST_MYSQL=1 plus MYSQL_* and run with unittest. Never imports main.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from types import SimpleNamespace
import unittest
import uuid

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from db.engine import check_database, get_connection, dispose_engine


@unittest.skipUnless(os.getenv("FIREGUARD_TEST_MYSQL") == "1", "Real MySQL test database not enabled")
class MySQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.getenv("MYSQL_DATABASE", "").endswith("_test"):
            raise RuntimeError("MYSQL_DATABASE must end in _test")
        check_database()
        with get_connection() as conn:
            for name in ("users", "events", "settings", "cameras", "notification_targets", "audit_log", "login_attempts"):
                if conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]:
                    raise RuntimeError("MySQL tests require empty application tables")

    @classmethod
    def tearDownClass(cls):
        dispose_engine()

    def setUp(self):
        self.prefix = "mysql_test_" + uuid.uuid4().hex[:12]
        self.ids = []

    def tearDown(self):
        with get_connection() as conn:
            conn.execute("DELETE FROM audit_log WHERE username LIKE ?", (self.prefix + "%",))
            conn.execute("DELETE FROM login_attempts WHERE scope=?", ("ip:" + self.prefix,))
            for identity in self.ids:
                conn.execute("DELETE FROM login_attempts WHERE scope=?", (f"user:{identity}",))
                conn.execute("DELETE FROM users WHERE id=?", (identity,))

    def user(self, suffix="", role="user"):
        from users.models import User
        name = self.prefix + suffix
        with get_connection() as conn:
            identity = conn.execute("INSERT INTO users (username,email,hashed_password,is_active,role) VALUES (?,?,?,1,?)",
                                    (name, name + "@example.com", "hash", role)).lastrowid
        self.ids.append(identity)
        return User(id=identity, username=name, email=name + "@example.com", hashed_password="hash", is_active=True, role=role)

    def test_login_reservations_never_exceed_account_budget(self):
        from auth.login_limiter import reserve
        user = self.user()

        def attempt(_):
            with get_connection() as conn:
                try:
                    reserve(conn, user.username, user, self.prefix)
                    return 200
                except HTTPException as exc:
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=10) as pool:
            outcomes = list(pool.map(attempt, range(10)))
        self.assertEqual(outcomes.count(200), 5)
        self.assertEqual(outcomes.count(429), 5)

    def test_concurrent_otp_failures_keep_all_five_attempts(self):
        from auth.routes import otp_transaction, check_otp
        from auth.dependencies import get_user_by_email
        from auth.utils import otp_expiry
        user = self.user()
        with get_connection() as conn:
            conn.execute("UPDATE users SET otp='123456', otp_expires_at=? WHERE id=?", (otp_expiry(), user.id))

        def attempt(_):
            with get_connection() as conn:
                try:
                    with otp_transaction(conn):
                        check_otp(conn, get_user_by_email(conn, user.email), "000000")
                except HTTPException as exc:
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=10) as pool:
            list(pool.map(attempt, range(10)))
        with get_connection() as conn:
            row = conn.execute("SELECT otp_attempts, otp FROM users WHERE id=?", (user.id,)).fetchone()
        self.assertEqual(row["otp_attempts"], 5)
        self.assertIsNone(row["otp"])

    def test_concurrent_admin_demotion_retains_an_admin(self):
        from users.routes import update_user, UserUpdate
        first, second = self.user("a", "admin"), self.user("b", "admin")

        def demote(pair):
            actor, target = pair
            with get_connection() as conn:
                try:
                    update_user(target.id, UserUpdate(role="user"), actor, conn)
                    return 200
                except HTTPException as exc:
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(demote, [(first, second), (second, first)]))
        self.assertEqual(outcomes.count(200), 1)
        with get_connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1 AND is_blocked=0").fetchone()[0]
        self.assertEqual(count, 1)

    def test_repository_crud_unique_and_rollback(self):
        import database
        import notification_targets as targets
        target_id = None
        camera_id = event_id = None
        try:
            database.set_setting(self.prefix, "tiếng Việt")
            self.assertEqual(database.get_setting(self.prefix), "tiếng Việt")
            database.set_setting(self.prefix, "updated")
            self.assertEqual(database.get_setting(self.prefix), "updated")
            owner = self.user()
            camera_id = database.add_db_camera("Test", "0", 0, owner_user_id=owner.id)
            database.update_db_camera(camera_id, "Updated", "0", 1)
            self.assertTrue(any(row["id"] == camera_id and row["name"] == "Updated" for row in database.get_all_db_cameras()))
            event_id, timestamp = database.add_event("fire", 0.98, owner_user_id=owner.id)
            self.assertTrue(database.update_event_status(event_id, "confirmed", self.prefix))
            self.assertEqual(database.get_recent_events(1, owner_user_id=owner.id)[0]["timestamp"], timestamp)
            self.assertTrue(database.get_daily_stats(owner_user_id=owner.id))
            body = SimpleNamespace(channel="telegram", friendlyName="Nhóm", chatId=self.prefix, active=False)
            target_id = targets.save_target("groups", body)["id"]
            with self.assertRaises(IntegrityError):
                targets.save_target("groups", body)
            self.assertEqual(len(targets.list_targets()), 1)
            with self.assertRaises(ValueError):
                with get_connection() as conn:
                    conn.execute("DELETE FROM settings WHERE `key`=?", (self.prefix,))
                    raise ValueError("rollback")
            self.assertEqual(database.get_setting(self.prefix), "updated")
        finally:
            if target_id:
                targets.delete_target("groups", target_id)
            with get_connection() as conn:
                conn.execute("DELETE FROM settings WHERE `key`=?", (self.prefix,))
                if event_id:
                    conn.execute("DELETE FROM events WHERE id=?", (event_id,))
                if camera_id:
                    conn.execute("DELETE FROM cameras WHERE id=?", (camera_id,))


if __name__ == "__main__":
    unittest.main()
