"""Disable existing cameras and require explicit activation for future cameras."""
from alembic import op
import sqlalchemy as sa

revision = "0005_cameras_default_off"
down_revision = "0004_private_evidence"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("UPDATE cameras SET is_active=0"))
    op.alter_column("cameras", "is_active", existing_type=sa.Integer(),
                    existing_nullable=True, server_default=sa.text("0"))


def downgrade():
    # Never reactivate cameras implicitly when reverting the schema default.
    op.alter_column("cameras", "is_active", existing_type=sa.Integer(),
                    existing_nullable=True, server_default=sa.text("1"))
