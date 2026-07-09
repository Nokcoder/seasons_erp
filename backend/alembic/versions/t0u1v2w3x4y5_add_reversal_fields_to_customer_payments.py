"""sales: add reversal fields to customer_payments

Adds reversed_at / reversed_reason / reversed_by_user_id, mirroring the
sales.sales voided_at / void_reason naming convention. Backs the new
POST /sales/payments/{payment_id}/reverse endpoint (payment correction
mechanism per docs/payment_correction_proposal.md). No boolean flag —
reversal state is inferred from reversed_at IS NOT NULL, same as Sale
has no separate is_voided column.

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-07-09
"""
from alembic import op

revision = 't0u1v2w3x4y5'
down_revision = 's9t0u1v2w3x4'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.customer_payments
            ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS reversed_reason VARCHAR(500),
            ADD COLUMN IF NOT EXISTS reversed_by_user_id INTEGER
                REFERENCES auth.users (user_id);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.customer_payments
            DROP COLUMN IF EXISTS reversed_at,
            DROP COLUMN IF EXISTS reversed_reason,
            DROP COLUMN IF EXISTS reversed_by_user_id;
    """)
