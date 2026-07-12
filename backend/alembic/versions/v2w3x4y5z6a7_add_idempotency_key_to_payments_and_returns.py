"""sales: add idempotency_key to customer_payments and sales_returns

Extends the duplicate-submission protection already proven for
sales.sales.idempotency_key (see migration a1b2c3d4e5f6 / models.Sale) to
the two remaining unguarded creation surfaces: standalone/applied customer
payments and sales returns. Same shape as Sale's column: nullable, unique,
client-supplied. A double-click or network retry on "Record Payment",
"Receive Payment", or "Process Return" can now be detected and answered
idempotently instead of creating a second financially-effective row.

Named constraints (customer_payments_idempotency_key_key /
sales_returns_idempotency_key_key) are declared explicitly so the
application-level IntegrityError safety net (mirroring the sale_pid race
fix in migration u1v2w3x4y5z6) can match on a known constraint name rather
than relying on Postgres's default-naming behavior.

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-07-10
"""
from alembic import op

revision = 'v2w3x4y5z6a7'
down_revision = 'u1v2w3x4y5z6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.customer_payments
            ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
    """)
    op.execute("""
        ALTER TABLE sales.customer_payments
            ADD CONSTRAINT customer_payments_idempotency_key_key UNIQUE (idempotency_key);
    """)
    op.execute("""
        ALTER TABLE sales.sales_returns
            ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
    """)
    op.execute("""
        ALTER TABLE sales.sales_returns
            ADD CONSTRAINT sales_returns_idempotency_key_key UNIQUE (idempotency_key);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales_returns
            DROP CONSTRAINT IF EXISTS sales_returns_idempotency_key_key;
    """)
    op.execute("""
        ALTER TABLE sales.sales_returns
            DROP COLUMN IF EXISTS idempotency_key;
    """)
    op.execute("""
        ALTER TABLE sales.customer_payments
            DROP CONSTRAINT IF EXISTS customer_payments_idempotency_key_key;
    """)
    op.execute("""
        ALTER TABLE sales.customer_payments
            DROP COLUMN IF EXISTS idempotency_key;
    """)
