"""Add full_name, phone, avatar_url to users table

Revision ID: 0002_user_profile
Revises: 0001_mysql
Create Date: 2026-11-07 20:20:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGTEXT

# revision identifiers, used by Alembic.
revision = '0002_user_profile'
down_revision = '0001_mysql'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('full_name', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(32), nullable=True))
    op.add_column('users', sa.Column('avatar_url', sa.Text().with_variant(LONGTEXT, 'mysql'), nullable=True))


def downgrade():
    op.drop_column('users', 'avatar_url')
    op.drop_column('users', 'phone')
    op.drop_column('users', 'full_name')
