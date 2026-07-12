"""sales: add reversal fields to sales_returns

Adds reversed_at / reversed_reason / reversed_by_user_id, mirroring the
sales.customer_payments reversal-field naming convention (which itself
mirrors sales.sales voided_at / void_reason). Backs the new
POST /sales/returns/{return_id}/reverse endpoint (return reversal
mechanism per docs/return_reversal_proposal.md). No boolean flag —
reversal state is inferred from reversed_at IS NOT NULL, same as every
other reversible record in this schema.

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-07-11
"""
from alembic import op

revision = 'w3x4y5z6a7b8'
down_revision = 'v2w3x4y5z6a7'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales_returns
            ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS reversed_reason VARCHAR(500),
            ADD COLUMN IF NOT EXISTS reversed_by_user_id INTEGER
                REFERENCES auth.users (user_id);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales_returns
            DROP COLUMN IF EXISTS reversed_at,
            DROP COLUMN IF EXISTS reversed_reason,
            DROP COLUMN IF EXISTS reversed_by_user_id;
    """)
