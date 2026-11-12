"""Pooled connections with the small result interface used by existing services.

Question-mark parameters are bound through SQLAlchemy, never interpolated into SQL.
SQL dialect differences remain explicit in the calling repositories.
"""
from threading import Lock
from pathlib import Path
import logging
from alembic.script import ScriptDirectory

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from .config import settings

_engine = None
_lock = Lock()


def get_engine():
    global _engine
    with _lock:
        if _engine is None:
            url, options = settings()
            _engine = create_engine(url, **options)
        return _engine


def dispose_engine():
    global _engine
    with _lock:
        if _engine is not None:
            _engine.dispose()
            _engine = None


class Record(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class Result:
    def __init__(self, result):
        self.result = result
        self.lastrowid = result.lastrowid
        self.rowcount = result.rowcount

    def fetchone(self):
        row = self.result.mappings().fetchone()
        return Record(row) if row is not None else None

    def fetchall(self):
        return [Record(row) for row in self.result.mappings().fetchall()]

    def __iter__(self):
        return iter(self.fetchall())


def bind(sql, parameters):
    # All repository statements are fixed SQL; '?' inside literals is unsupported.
    pieces = sql.split("?")
    if len(pieces) - 1 != len(parameters):
        raise ValueError("SQL parameter count mismatch")
    statement = pieces[0]
    for index, piece in enumerate(pieces[1:]):
        statement += f":p{index}" + piece
    return text(statement), {f"p{i}": value for i, value in enumerate(parameters)}


class Connection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, parameters=()):
        statement, values = bind(sql, parameters)
        return Result(self.connection.execute(statement, values))

    def executemany(self, sql, rows):
        rows = list(rows)
        if not rows:
            return None
        statement, _ = bind(sql, rows[0])
        values = [bind(sql, row)[1] for row in rows]
        return Result(self.connection.execute(statement, values))

    def begin_serialized(self, name="auth"):
        # Call only before writes. End an earlier lookup's transaction first.
        self.rollback()
        row = self.execute("SELECT name FROM transaction_locks WHERE name=? FOR UPDATE", (name,)).fetchone()
        if row is None:
            self.rollback()
            raise RuntimeError("Database lock rows missing; run alembic upgrade head")

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.rollback() if kind else self.commit()
        finally:
            self.close()


def get_connection():
    return Connection(get_engine().connect())


def read_rows(sql, parameters=()):
    """Retry one disconnected read with a fresh connection; never replay writes."""
    if not sql.lstrip().upper().startswith("SELECT "):
        raise ValueError("read_rows only accepts SELECT statements")
    for attempt in range(2):
        try:
            with get_connection() as conn:
                return conn.execute(sql, parameters).fetchall()
        except OperationalError as error:
            code = error.orig.args[0] if error.orig.args else None
            if attempt or code not in (2006, 2013, 2055):
                raise
            logging.getLogger(__name__).warning("MySQL read disconnected (%s); retrying once", code)


def check_database():
    with get_connection() as conn:
        version = conn.execute("SELECT version_num FROM alembic_version").fetchall()
        expected = ScriptDirectory(str(Path(__file__).resolve().parents[1] / "migrations")).get_current_head()
        if [row[0] for row in version] != [expected]:
            raise RuntimeError("Database schema version mismatch; run alembic upgrade head")
        for table in ("users", "events", "cameras", "settings", "notification_targets", "audit_log", "login_attempts", "snapshots", "video_jobs"):
            conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
        conn.execute("SELECT full_name, phone, avatar_url FROM users LIMIT 1")
        locks = conn.execute("SELECT name FROM transaction_locks").fetchall()
        if {row["name"] for row in locks} != {"auth", "notifications"}:
            raise RuntimeError("Database migrations are incomplete")
