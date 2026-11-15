"""Import stopped/consistent SQLite backups into an empty migrated MySQL schema.

Run from backend: python -m scripts.migration.migrate_sqlite_to_mysql --help
Never imports main, starts cameras, sends messages, or modifies SQLite sources.
"""
import argparse
from contextlib import closing
from pathlib import Path
import sqlite3

import sqlalchemy as sa
from app.db.engine import get_engine
from app.db.schema import metadata

OPERATIONAL = ("events", "cameras", "settings", "notification_targets")
ACCOUNTS = ("users", "audit_log", "login_attempts")


def read_source(path, names):
    path = Path(path).resolve(strict=True)
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as source:
        source.row_factory = sqlite3.Row
        available = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"events", "cameras", "settings"} if names == OPERATIONAL else {"users"}
        if not required <= available:
            raise ValueError("Source is missing required tables: " + ", ".join(sorted(required - available)))
        data = {}
        for name in names:
            rows = []
            if name in available:
                for record in source.execute(f"SELECT * FROM {name} ORDER BY rowid"):
                    row = dict(record)
                    if name == "users" and row.get("role") in ("viewer", "operator"):
                        row["role"] = "user"
                    allowed = set(metadata.tables[name].c.keys()) - {"sequence"}
                    row = {key: value for key, value in row.items() if key in allowed}
                    # Validate bounded strings before contacting the destination.
                    for key, value in row.items():
                        length = getattr(metadata.tables[name].c[key].type, "length", None)
                        if length and value is not None and len(str(value)) > length:
                            raise ValueError(f"{name}.{key} exceeds MySQL length {length}")
                    rows.append(row)
            data[name] = rows
        return data


def import_data(engine, data, batch_size=500, dry_run=True):
    """Validate/insert/compare in one transaction; dry-run rolls everything back."""
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            # Do not run the API during import. Refuse seeded or previously imported targets.
            for name in OPERATIONAL + ACCOUNTS:
                table = metadata.tables[name]
                if conn.scalar(sa.select(sa.func.count()).select_from(table)):
                    raise ValueError(f"Destination {name} is not empty; import refused")
            for name, rows in data.items():
                table = metadata.tables[name]
                for start in range(0, len(rows), batch_size):
                    batch = rows[start:start + batch_size]
                    # Older schemas may omit columns with server defaults.
                    groups = {}
                    for row in batch:
                        groups.setdefault(tuple(sorted(row)), []).append(row)
                    for group in groups.values():
                        conn.execute(table.insert(), group)
                actual = [dict(row) for row in conn.execute(sa.select(table)).mappings()]
                keys = [column.name for column in table.primary_key.columns]
                if name == "notification_targets":
                    actual.sort(key=lambda row: row["sequence"])
                    for expected, saved in zip(rows, actual):
                        if any(saved[key] != value for key, value in expected.items()):
                            raise ValueError(f"Verification failed for {name}")
                else:
                    by_key = {tuple(row[key] for key in keys): row for row in actual}
                    for expected in rows:
                        saved = by_key.get(tuple(expected[key] for key in keys))
                        if saved is None or any(saved[key] != value for key, value in expected.items()):
                            raise ValueError(f"Verification failed for {name}")
                if len(actual) != len(rows):
                    raise ValueError(f"Row count mismatch for {name}")
                print(f"{name}: {len(rows)} rows verified")
            tx.rollback() if dry_run else tx.commit()
        except BaseException:
            if tx.is_active:
                tx.rollback()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operational-db", required=True, help="Consistent backup of fire_guard.db")
    parser.add_argument("--auth-db", required=True, help="Actual auth.db/example.db backup used by deployment")
    parser.add_argument("--apply", action="store_true", help="Commit import; default is a rollback-only dry run")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")
    data = {**read_source(args.operational_db, OPERATIONAL), **read_source(args.auth_db, ACCOUNTS)}
    try:
        import_data(get_engine(), data, args.batch_size, dry_run=not args.apply)
    except sa.exc.SQLAlchemyError:
        # Do not print driver exceptions: duplicate-key messages can contain credentials/OTP data.
        raise SystemExit("MySQL import failed; transaction rolled back. Check schema, unique keys and source data.") from None
    print("Import committed." if args.apply else "Dry run verified; all inserted rows rolled back (AUTO_INCREMENT may advance).")


if __name__ == "__main__":
    main()
