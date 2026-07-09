"""sales: scope sale_pid uniqueness to active (non-Voided) sales

Fixes a bug where voiding a sale permanently retired its sale_pid: the
unconditional unique constraint sales_sale_pid_key blocked any later sale
from reusing a voided sale's PID, and the resulting IntegrityError surfaced
to the cashier as a raw 500 instead of a clean validation error.

Decision: sale_pid stays the field in active use (no migration to
receipt_no). A voided sale's sale_pid becomes reusable; duplicates among
currently-active (Draft/Posted) sales are still blocked, now via a partial
unique index instead of a column-level constraint.

This is the first conditional-uniqueness pattern in this codebase — prior
unique constraints (e.g. sales_idempotency_key_key) are unconditional.

App-level precheck + IntegrityError handling in backend/sales/router.py
(create_draft, post_draft) gives the clean 400; this index is the actual
guarantee, same division of responsibility as the PID/barcode collision
triggers in migration s9t0u1v2w3x4.

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-07-09
"""
from alembic import op

revision = 'u1v2w3x4y5z6'
down_revision = 't0u1v2w3x4y5'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales DROP CONSTRAINT IF EXISTS sales_sale_pid_key;
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS sales_sale_pid_active_key
        ON sales.sales (sale_pid)
        WHERE status != 'Voided';
    """)


def downgrade():
    op.execute("""
        DROP INDEX IF EXISTS sales.sales_sale_pid_active_key;
    """)
    op.execute("""
        ALTER TABLE sales.sales
        ADD CONSTRAINT sales_sale_pid_key UNIQUE (sale_pid);
    """)
