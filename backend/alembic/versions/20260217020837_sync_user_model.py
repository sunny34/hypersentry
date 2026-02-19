"""Sync user model with schema

Revision ID: sync_user_001
Revises: e56d057f9f72
Create Date: 2026-02-17 02:08

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'sync_user_001'
down_revision: Union[str, Sequence[str], None] = 'e56d057f9f72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Sync user table to match models.py"""
    # Add missing columns (nullable first to handle existing rows)
    op.add_column('users', sa.Column('name', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('avatar_url', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('telegram_chat_id', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('provider', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('provider_id', sa.String(length=255), nullable=True))
    
    # Drop old columns that are no longer in model
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('username')
        batch_op.drop_column('hashed_password')
        batch_op.drop_column('wallet_address')
        batch_op.drop_column('is_active')
    
    # Set defaults for provider columns
    op.execute("UPDATE users SET provider = 'wallet' WHERE provider IS NULL")
    op.execute("UPDATE users SET provider_id = '' WHERE provider_id IS NULL")
    
    # Make them non-nullable
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('provider', nullable=False)
        batch_op.alter_column('provider_id', nullable=False)
    
    # Add indexes for provider lookups
    op.create_index('ix_users_provider', 'users', ['provider'])
    op.create_index('ix_users_provider_id', 'users', ['provider_id'])
    op.create_index('ix_users_provider_composite', 'users', ['provider', 'provider_id'], unique=True)


def downgrade() -> None:
    """Restore old schema"""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('username', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('hashed_password', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('wallet_address', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), server_default='true', nullable=True))
    
    op.drop_column('users', 'provider_id')
    op.drop_column('users', 'provider')
    op.drop_column('users', 'telegram_chat_id')
    op.drop_column('users', 'avatar_url')
    op.drop_column('users', 'name')
    
    op.drop_index('ix_users_provider_composite', table_name='users')
    op.drop_index('ix_users_provider_id', table_name='users')
    op.drop_index('ix_users_provider', table_name='users')
