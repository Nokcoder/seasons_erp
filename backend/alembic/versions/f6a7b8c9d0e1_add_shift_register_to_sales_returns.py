"""sales: add shift_id and register_id to sales_returns

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-11
"""
from alembic import op

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales_returns
            ADD COLUMN IF NOT EXISTS shift_id    INTEGER REFERENCES sales.shifts(shift_id),
            ADD COLUMN IF NOT EXISTS register_id INTEGER REFERENCES sales.cash_registers(register_id);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales_returns
            DROP COLUMN IF EXISTS shift_id,
            DROP COLUMN IF EXISTS register_id;
    """)
