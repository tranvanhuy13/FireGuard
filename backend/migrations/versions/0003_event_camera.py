"""Preserve camera identity with each event; old events remain explicitly unknown."""
from alembic import op
import sqlalchemy as sa

revision = "0003_event_camera"
down_revision = "0002_user_profile"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("events", sa.Column("camera_id", sa.Integer(), nullable=True))
    op.add_column("events", sa.Column("camera_name", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("events", "camera_name")
    op.drop_column("events", "camera_id")
