"""sales: add collection_receipt_no to customer_payments

Adds an optional, always-visible Collection Receipt No. field to customer
payments (AR ledger). Distinct from the unrelated reference_number column
already on this table, and from sales_headers.receipt_no (a POS transaction
receipt number, not a customer-payment receipt number).

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-07-02
"""
from alembic import op

revision = 'r8s9t0u1v2w3'
down_revision = 'q7r8s9t0u1v2'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.customer_payments
            ADD COLUMN IF NOT EXISTS collection_receipt_no VARCHAR(100);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.customer_payments
            DROP COLUMN IF EXISTS collection_receipt_no;
    """)
