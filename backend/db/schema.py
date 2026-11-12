"""Initial schema; timestamp strings intentionally preserve the existing API."""
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGTEXT

metadata = sa.MetaData()


def table(name, *columns):
    return sa.Table(name, metadata, *columns, mysql_engine="InnoDB",
                    mysql_charset="utf8mb4", mysql_collate="utf8mb4_bin")


def identity():
    return sa.Column("id", sa.Integer, primary_key=True, autoincrement=True)


events = table("events", identity(), sa.Column("timestamp", sa.String(40), nullable=False),
    sa.Column("type", sa.String(32), nullable=False), sa.Column("confidence", sa.Double, nullable=False),
    sa.Column("snapshot_path", sa.Text), sa.Column("status", sa.String(32), nullable=False, server_default="new"),
    sa.Column("handled_by", sa.String(255)), sa.Column("handled_at", sa.String(40)),
    sa.Column("camera_id", sa.Integer), sa.Column("camera_name", sa.Text))
sa.Index("events_timestamp", events.c.timestamp)
cameras = table("cameras", identity(), sa.Column("name", sa.Text, nullable=False),
    sa.Column("source", sa.Text, nullable=False), sa.Column("is_active", sa.Integer, server_default="1"),
    sa.Column("created_at", sa.String(40), nullable=False))
settings = table("settings", sa.Column("key", sa.String(191), primary_key=True), sa.Column("value", sa.Text))
targets = table("notification_targets", sa.Column("sequence", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("id", sa.String(32), nullable=False, unique=True), sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("channel", sa.String(16), nullable=False), sa.Column("friendly_name", sa.String(120), nullable=False),
    sa.Column("chat_id", sa.String(128), nullable=False), sa.Column("active", sa.Integer, nullable=False),
    sa.UniqueConstraint("channel", "chat_id", name="notification_channel_chat"))
users = table("users", identity(), sa.Column("username", sa.String(255), unique=True),
    sa.Column("email", sa.String(320), unique=True), sa.Column("hashed_password", sa.Text),
    sa.Column("is_active", sa.Integer, server_default="0"), sa.Column("otp", sa.String(32)),
    sa.Column("otp_expires_at", sa.String(64)), sa.Column("otp_attempts", sa.Integer, server_default="0"),
    sa.Column("role", sa.String(16), nullable=False, server_default="user"),
    sa.Column("is_blocked", sa.Integer, nullable=False, server_default="0"),
    sa.Column("full_name", sa.String(255)), sa.Column("phone", sa.String(32)), sa.Column("avatar_url", sa.Text().with_variant(LONGTEXT, "mysql")),
    sa.CheckConstraint("role IN ('user', 'admin')", name="users_role"))

# Kept in sync with 0004; nullable legacy ownership deliberately grants nobody access.
for owned in (cameras, events):
    owned.append_column(sa.Column("owner_user_id", sa.Integer, sa.ForeignKey("users.id")))
    sa.Index(f"{owned.name}_owner_id", owned.c.owner_user_id, owned.c.id)
events.append_column(sa.Column("source_kind", sa.String(16), nullable=False, server_default="camera"))
events.append_column(sa.Column("video_job_id", sa.String(32)))
events.append_column(sa.Column("video_time", sa.Double))
events.append_column(sa.Column("video_name", sa.Text))
snapshots = table("snapshots", sa.Column("name", sa.String(191), primary_key=True),
    sa.Column("owner_user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
    sa.Column("source_kind", sa.String(16), nullable=False), sa.Column("source_id", sa.String(64), nullable=False),
    sa.Column("created_at", sa.Double, nullable=False), sa.Column("expires_at", sa.Double, nullable=False),
    sa.Column("deleted_at", sa.Double))
sa.Index("snapshots_expiry", snapshots.c.deleted_at, snapshots.c.expires_at)
video_jobs = table("video_jobs", sa.Column("sequence", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("id", sa.String(32), nullable=False, unique=True),
    sa.Column("owner_user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
    sa.Column("payload", sa.Text, nullable=False))
sa.Index("video_jobs_owner", video_jobs.c.owner_user_id, video_jobs.c.sequence)
audit = table("audit_log", identity(), sa.Column("timestamp", sa.String(40), nullable=False),
    sa.Column("username", sa.String(255), nullable=False), sa.Column("role", sa.String(16), nullable=False),
    sa.Column("action", sa.String(255), nullable=False), sa.Column("target", sa.Text), sa.Column("detail", sa.Text))
attempts = table("login_attempts", sa.Column("ticket", sa.String(32), primary_key=True),
    sa.Column("scope", sa.String(255), primary_key=True), sa.Column("expires_at", sa.Double, nullable=False))
sa.Index("login_attempts_scope", attempts.c.scope, attempts.c.expires_at)
sa.Index("login_attempts_expiry", attempts.c.expires_at)
locks = table("transaction_locks", sa.Column("name", sa.String(32), primary_key=True))
