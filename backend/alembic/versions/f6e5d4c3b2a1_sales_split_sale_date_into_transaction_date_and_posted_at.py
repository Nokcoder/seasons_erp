"""sales: split sale_date into transaction_date + posted_at

The sales.sales.sale_date column conflated two distinct concepts: the
calendar date the transaction occurred, and the timestamp it was posted.
This migration replaces it with `transaction_date` (DATE, user-controlled,
backdatable — the canonical date for AR aging, AR ledger, and sales
filters/sorting/display) and `posted_at` (TIMESTAMP WITH TIME ZONE,
stamped at posting time; NULL for drafts).

Existing rows are backfilled from sale_date: posted_at = sale_date, and
transaction_date = the PH-local (Asia/Manila) calendar date of sale_date,
matching the bucketing the app already used for "today" comparisons.
Rows with no sale_date (drafts) get transaction_date = CURRENT_DATE.

Revision ID: f6e5d4c3b2a1
Revises: a1b2c3d4e5f6
Create Date: 2026-06-08
"""
from alembic import op

revision = 'f6e5d4c3b2a1'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales
            ADD COLUMN transaction_date DATE,
            ADD COLUMN posted_at TIMESTAMP WITH TIME ZONE;

        UPDATE sales.sales
            SET posted_at = sale_date,
                transaction_date = (sale_date AT TIME ZONE 'Asia/Manila')::date
            WHERE sale_date IS NOT NULL;

        UPDATE sales.sales
            SET transaction_date = CURRENT_DATE
            WHERE transaction_date IS NULL;

        ALTER TABLE sales.sales
            ALTER COLUMN transaction_date SET NOT NULL,
            ALTER COLUMN transaction_date SET DEFAULT CURRENT_DATE;

        ALTER TABLE sales.sales DROP COLUMN sale_date;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales ADD COLUMN sale_date TIMESTAMP WITH TIME ZONE;
        UPDATE sales.sales SET sale_date = posted_at;
        ALTER TABLE sales.sales DROP COLUMN transaction_date;
        ALTER TABLE sales.sales DROP COLUMN posted_at;
    """)
