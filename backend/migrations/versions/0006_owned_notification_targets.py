"""Scope bot recipients to accounts; legacy NULL-owner rows remain quarantined."""
from alembic import op
import sqlalchemy as sa

revision = "0006_owned_notifications"
down_revision = "0005_cameras_default_off"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("notification_targets", sa.Column("owner_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("notification_targets_owner_fk", "notification_targets", "users",
                          ["owner_user_id"], ["id"])
    op.drop_constraint("notification_channel_chat", "notification_targets", type_="unique")
    op.create_unique_constraint("notification_owner_channel_chat", "notification_targets",
                                ["owner_user_id", "channel", "chat_id"])


def downgrade():
    # Restoring shared recipients would expose private destinations. Require an
    # explicit operator-reviewed data migration rather than silently sharing them.
    raise RuntimeError("Account-owned recipients require a manual data migration before downgrade")
