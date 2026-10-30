"""Offline persistence checks: python -m unittest discover -s tests -p test_mysql_persistence.py."""
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable

from db.config import settings
from db.engine import Connection, bind
from db.schema import metadata
from scripts.migrate_sqlite_to_mysql import import_data, read_source, OPERATIONAL


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        # SQLite is ONLY a disposable offline harness, never a runtime fallback.
        self.engine = sa.create_engine("sqlite://")
        metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_bound_parameters_mapping_and_rollback(self):
        with Connection(self.engine.connect()) as conn:
            conn.execute("INSERT INTO settings (`key`, value) VALUES (?, ?)", ("tiếng Việt", "' OR 1=1 -- ?"))
            row = conn.execute("SELECT * FROM settings").fetchone()
            self.assertEqual(row["value"], "' OR 1=1 -- ?")
            self.assertEqual(row[0], "tiếng Việt")
        with self.assertRaises(ValueError):
            with Connection(self.engine.connect()) as conn:
                conn.execute("DELETE FROM settings")
                raise ValueError("rollback")
        with Connection(self.engine.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0], 1)

    def test_bind_count_and_secret_not_in_statement(self):
        statement, values = bind("SELECT ?", ("secret",))
        self.assertNotIn("secret", str(statement))
        self.assertEqual(values, {"p0": "secret"})
        with self.assertRaises(ValueError):
            bind("SELECT ?, ?", (1,))

    def test_mysql_schema_compiles_and_keys_are_bounded(self):
        for table in metadata.sorted_tables:
            ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
            self.assertIn("InnoDB", ddl)
            self.assertIn("utf8mb4_bin", ddl)
        self.assertIn("AUTO_INCREMENT", str(CreateTable(metadata.tables["events"]).compile(dialect=mysql.dialect())))

    def test_tls_config_and_special_password(self):
        with tempfile.TemporaryDirectory() as directory:
            ca = Path(directory) / "ca.pem"
            ca.touch()
            env = {"MYSQL_HOST": "db.example", "MYSQL_PORT": "12345", "MYSQL_DATABASE": "fireguard",
                   "MYSQL_USER": "user", "MYSQL_PASSWORD": "p@ss:/?#%", "MYSQL_SSL_CA": str(ca)}
            with patch.dict(os.environ, env, clear=True), patch("db.config.load_dotenv"):
                url, options = settings()
            self.assertEqual(url.password, env["MYSQL_PASSWORD"])
            self.assertTrue(options["connect_args"]["ssl_verify_cert"])
            self.assertTrue(options["connect_args"]["ssl_verify_identity"])
            self.assertTrue(options["pool_pre_ping"])
            env["MYSQL_SSL_CA"] = str(ca.parent / "missing.pem")
            with patch.dict(os.environ, env, clear=True), patch("db.config.load_dotenv"):
                with self.assertRaisesRegex(RuntimeError, "CA certificate"):
                    settings()

    def test_import_dry_run_commit_and_refuse_second_import(self):
        data = {"users": [{"id": 17, "username": "Việt", "email": "test@example.com", "hashed_password": "preserved"}],
                "notification_targets": [{"id": "b" * 32, "kind": "groups", "channel": "telegram",
                                           "friendly_name": "Nhóm", "chat_id": "-123456", "active": 1}]}
        import_data(self.engine, data, dry_run=True)
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(sa.select(sa.func.count()).select_from(metadata.tables["users"])), 0)
        import_data(self.engine, data, dry_run=False)
        with self.assertRaisesRegex(ValueError, "not empty"):
            import_data(self.engine, data, dry_run=False)
        with self.engine.connect() as conn:
            row = conn.execute(sa.select(metadata.tables["users"])).mappings().one()
            self.assertEqual((row["id"], row["hashed_password"], row["role"]), (17, "preserved", "user"))

    def test_failed_import_rolls_back_earlier_tables(self):
        data = {"settings": [{"key": "key", "value": "value"}],
                "users": [{"id": 1, "username": "same"}, {"id": 2, "username": "same"}]}
        with self.assertRaises(sa.exc.IntegrityError):
            import_data(self.engine, data, dry_run=False)
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(sa.select(sa.func.count()).select_from(metadata.tables["settings"])), 0)

    def test_source_readonly_and_preserves_notification_order(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.db"
            with closing(sqlite3.connect(source)) as conn:
                conn.executescript("CREATE TABLE events(id INTEGER PRIMARY KEY); CREATE TABLE cameras(id INTEGER PRIMARY KEY); "
                                   "CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT); "
                                   "CREATE TABLE notification_targets(id TEXT PRIMARY KEY);")
                conn.executemany("INSERT INTO notification_targets VALUES (?)", [("z",), ("a",)])
                conn.commit()
            before = source.read_bytes()
            data = read_source(source, OPERATIONAL)
            self.assertEqual([row["id"] for row in data["notification_targets"]], ["z", "a"])
            self.assertEqual(before, source.read_bytes())

    def test_notifications_use_saved_recipients_without_sqlite_path(self):
        import notification
        saved = [{"id": "saved", "chatId": "-123456", "active": True}]
        with patch("notification.setting", side_effect=lambda key: "token" if key.endswith("bot_token") else ""), \
             patch("notification.list_targets", return_value=saved):
            config = notification.channel_config("telegram")
        self.assertTrue(config["saved_targets"])
        self.assertEqual(config["targets"], saved)


if __name__ == "__main__":
    unittest.main()
