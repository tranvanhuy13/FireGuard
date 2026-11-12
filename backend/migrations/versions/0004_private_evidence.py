"""Account-owned cameras, separate video evidence and expiring snapshot registry."""
from alembic import op
import sqlalchemy as sa

revision = "0004_private_evidence"
down_revision = "0003_event_camera"
branch_labels = None
depends_on = None


def upgrade():
    # Legacy ownership cannot safely be inferred; NULL records stay invisible.
    for name in ("cameras", "events"):
        op.add_column(name, sa.Column("owner_user_id", sa.Integer(), nullable=True))
        op.create_foreign_key(f"{name}_owner", name, "users", ["owner_user_id"], ["id"])
        op.create_index(f"{name}_owner_id", name, ["owner_user_id", "id"])
    op.add_column("events", sa.Column("source_kind", sa.String(16), nullable=False, server_default="camera"))
    op.add_column("events", sa.Column("video_job_id", sa.String(32)))
    op.add_column("events", sa.Column("video_time", sa.Double()))
    op.add_column("events", sa.Column("video_name", sa.Text()))
    op.create_table("snapshots",
        sa.Column("name", sa.String(191), primary_key=True),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.Double(), nullable=False),
        sa.Column("expires_at", sa.Double(), nullable=False),
        sa.Column("deleted_at", sa.Double()),
        mysql_engine="InnoDB", mysql_charset="utf8mb4", mysql_collate="utf8mb4_bin")
    op.create_index("snapshots_expiry", "snapshots", ["deleted_at", "expires_at"])
    op.create_table("video_jobs",
        sa.Column("sequence", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("id", sa.String(32), nullable=False, unique=True),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        mysql_engine="InnoDB", mysql_charset="utf8mb4", mysql_collate="utf8mb4_bin")
    op.create_index("video_jobs_owner", "video_jobs", ["owner_user_id", "sequence"])


def downgrade():
    op.drop_table("video_jobs")
    op.drop_table("snapshots")
    for column in ("video_name", "video_time", "video_job_id", "source_kind"):
        op.drop_column("events", column)
    for name in ("events", "cameras"):
        op.drop_constraint(f"{name}_owner", name, type_="foreignkey")
        op.drop_index(f"{name}_owner_id", table_name=name)
        op.drop_column(name, "owner_user_id")
