"""sales: transaction_date server default — use Manila-local "today"

The column's default was `CURRENT_DATE`, which the DB computes in UTC (the
container/DB run in UTC). During the ~00:00-08:00 Manila-local window this
misclassifies "today" as "yesterday" — exactly the bug class the
transaction_date/posted_at split was meant to eliminate. Application code
now always sets transaction_date explicitly on creation; this updates the
server-side default to match (a safety net for any path that doesn't).

Revision ID: a3b4c5d6e7f8
Revises: f6e5d4c3b2a1
Create Date: 2026-06-08
"""
from alembic import op

revision = 'a3b4c5d6e7f8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales
            ALTER COLUMN transaction_date
            SET DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales
            ALTER COLUMN transaction_date
            SET DEFAULT CURRENT_DATE;
    """)
