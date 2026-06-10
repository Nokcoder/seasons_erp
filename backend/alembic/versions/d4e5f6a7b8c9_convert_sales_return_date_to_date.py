"""sales_returns: convert return_date from TIMESTAMPTZ to DATE

The column was originally TIMESTAMP WITH TIME ZONE DEFAULT now(). Application
code now supplies return_date explicitly (Manila-local calendar date via
_ph_today()) and the model was updated to Date, nullable=False.

Upgrade:
  1. Fill any NULL rows (defensive; new() default means there should be none).
  2. Convert type to DATE, casting existing timestamps using Manila time
     (UTC+8) so the stored date matches the business day the return occurred.
  3. Set NOT NULL and drop the now()-based server default.

Downgrade restores TIMESTAMPTZ + NOT NULL dropped + default now().

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-11
"""
from alembic import op

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    # Safety: coerce any NULL rows so SET NOT NULL never fails
    op.execute("""
        UPDATE sales.sales_returns
           SET return_date = now()
         WHERE return_date IS NULL;
    """)

    op.execute("""
        ALTER TABLE sales.sales_returns
            ALTER COLUMN return_date TYPE DATE
                USING (return_date AT TIME ZONE 'Asia/Manila')::date;
    """)

    op.execute("""
        ALTER TABLE sales.sales_returns
            ALTER COLUMN return_date SET NOT NULL;
    """)

    op.execute("""
        ALTER TABLE sales.sales_returns
            ALTER COLUMN return_date DROP DEFAULT;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales_returns
            ALTER COLUMN return_date TYPE TIMESTAMP WITH TIME ZONE
                USING return_date::timestamp with time zone;
    """)

    op.execute("""
        ALTER TABLE sales.sales_returns
            ALTER COLUMN return_date DROP NOT NULL;
    """)

    op.execute("""
        ALTER TABLE sales.sales_returns
            ALTER COLUMN return_date SET DEFAULT now();
    """)
