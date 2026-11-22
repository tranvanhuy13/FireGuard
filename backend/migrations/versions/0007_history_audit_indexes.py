"""Indexes for account-scoped history and chronological audit pages."""
from alembic import op, context
from sqlalchemy import inspect

revision = "0007_history_audit_indexes"
down_revision = "0006_owned_notifications"
branch_labels = None
depends_on = None


def upgrade():
    for name, table, columns in (
        ("events_owner_source_time_id", "events", ["owner_user_id", "source_kind", "timestamp", "id"]),
        ("audit_timestamp_id", "audit_log", ["timestamp", "id"]),
    ):
        # MySQL DDL commits immediately: retry safely if only the first index
        # succeeded before a deployment was interrupted.
        existing = {} if context.is_offline_mode() else {
            index["name"]: index["column_names"] for index in inspect(op.get_bind()).get_indexes(table)}
        if name in existing:
            if existing[name] != columns:
                raise RuntimeError(f"Unexpected definition for index {name}")
        else:
            op.create_index(name, table, columns)


def downgrade():
    op.drop_index("audit_timestamp_id", table_name="audit_log")
    op.drop_index("events_owner_source_time_id", table_name="events")
