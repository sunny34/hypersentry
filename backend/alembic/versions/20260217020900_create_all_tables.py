"""Create all remaining tables

Revision ID: create_all_tables_001
Revises: sync_user_001
Create Date: 2026-02-17 02:09

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'create_all_tables_001'
down_revision: Union[str, Sequence[str], None] = 'sync_user_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_exists(table_name: str) -> bool:
    """Check if table exists"""
    conn = op.get_bind()
    result = conn.execute(
        sa.text(f"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '{table_name}')")
    )
    return result.scalar()


def upgrade() -> None:
    """Create all remaining tables (idempotent)"""
    
    # wallets table
    if not table_exists('wallets'):
        op.create_table('wallets',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('address', sa.String(255), nullable=False),
            sa.Column('label', sa.String(255), nullable=True),
            sa.Column('active_trading', sa.Boolean(), server_default='false'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        )
        op.create_index('ix_wallets_address', 'wallets', ['address'])
    
    # user_twaps table
    if not table_exists('user_twaps'):
        op.create_table('user_twaps',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('token', sa.String(50), nullable=False),
            sa.Column('min_size', sa.Float(), server_default='10000.0'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        )
    
    # user_keys table
    if not table_exists('user_keys'):
        op.create_table('user_keys',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('exchange', sa.String(50), nullable=False),
            sa.Column('key_name', sa.String(100), nullable=True),
            sa.Column('api_key_enc', sa.Text(), nullable=False),
            sa.Column('api_secret_enc', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        )
    
    # active_trades table
    if not table_exists('active_trades'):
        op.create_table('active_trades',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('symbol', sa.String(20), nullable=False),
            sa.Column('direction', sa.String(50), nullable=False),
            sa.Column('size_usd', sa.Float(), nullable=False),
            sa.Column('entry_price_hl', sa.Float(), nullable=True),
            sa.Column('entry_price_bin', sa.Float(), nullable=True),
            sa.Column('entry_time', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
            sa.Column('status', sa.String(20), server_default='OPEN'),
        )
    
    # intel_items table
    if not table_exists('intel_items'):
        op.create_table('intel_items',
            sa.Column('id', sa.String(255), primary_key=True),
            sa.Column('source_type', sa.String(50), nullable=False),
            sa.Column('title', sa.Text(), nullable=False),
            sa.Column('content', sa.Text(), nullable=True),
            sa.Column('url', sa.Text(), nullable=True),
            sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
            sa.Column('sentiment', sa.String(20), server_default='neutral'),
            sa.Column('sentiment_score', sa.Float(), server_default='0.0'),
            sa.Column('is_high_impact', sa.Boolean(), server_default='false'),
            sa.Column('metadata_json', postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        )
        op.create_index('ix_intel_items_timestamp', 'intel_items', ['timestamp'])
        op.create_index('ix_intel_items_source_type', 'intel_items', ['source_type'])
    
    # microstructure_snapshots table
    if not table_exists('microstructure_snapshots'):
        op.create_table('microstructure_snapshots',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('symbol', sa.String(20), nullable=False, index=True),
            sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column('price', sa.Float(), nullable=False),
            sa.Column('cvd_total', sa.Float(), nullable=False),
            sa.Column('premium_usd', sa.Float(), server_default='0.0'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        )
    
    # trade_signals table
    if not table_exists('trade_signals'):
        op.create_table('trade_signals',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('token', sa.String(20), nullable=False, index=True),
            sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
            sa.Column('recommendation', sa.String(50), nullable=False),
            sa.Column('entry_price', sa.Float(), nullable=False),
            sa.Column('stop_loss', sa.Float(), nullable=False),
            sa.Column('take_profit_1', sa.Float(), nullable=False),
            sa.Column('take_profit_2', sa.Float(), nullable=True),
            sa.Column('alpha_score', sa.Float(), server_default='0.0'),
            sa.Column('confidence_label', sa.String(50), server_default='MEDIUM'),
            sa.Column('result', sa.String(20), server_default='PENDING'),
            sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('pnl_percent', sa.Float(), server_default='0.0'),
        )
    
    # wallet_login_nonces table
    if not table_exists('wallet_login_nonces'):
        op.create_table('wallet_login_nonces',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('address', sa.String(255), nullable=False, index=True),
            sa.Column('nonce', sa.String(128), nullable=False, index=True),
            sa.Column('chain_id', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('issued_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column('used', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        )
    
    # user_trading_settings table
    if not table_exists('user_trading_settings'):
        op.create_table('user_trading_settings',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('equity_usd', sa.Float(), server_default='100000.0'),
            sa.Column('max_position_usd', sa.Float(), server_default='1000.0'),
            sa.Column('max_risk_pct', sa.Float(), server_default='0.02'),
            sa.Column('max_leverage', sa.Float(), server_default='3.0'),
            sa.Column('target_profit_pct', sa.Float(), server_default='0.03'),
            sa.Column('stop_loss_pct', sa.Float(), server_default='0.01'),
            sa.Column('auto_mode_enabled', sa.Boolean(), server_default='false'),
            sa.Column('max_daily_trades', sa.Integer(), server_default='5'),
            sa.Column('max_daily_loss_pct', sa.Float(), server_default='0.05'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        )


def downgrade() -> None:
    """Drop all tables"""
    op.drop_table('user_trading_settings')
    op.drop_table('wallet_login_nonces')
    op.drop_table('trade_signals')
    op.drop_table('microstructure_snapshots')
    op.drop_table('intel_items')
    op.drop_table('active_trades')
    op.drop_table('user_keys')
    op.drop_table('user_twaps')
    op.drop_table('wallets')
