"""pdc: add PDC vault tracking columns

Adds is_pdc and is_cash flags to payment_modes, check fields
(check_number, check_date, bank_name, check_status) to customer_payments,
and has_bounced_check to customers.

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-06-16
"""
from alembic import op

revision = 'i9d0e1f2g3h4'
down_revision = 'h8c9d0e1f2g3'
branch_labels = None
depends_on = None


def upgrade():
    # 1. New flags on payment_modes
    op.execute("""
        ALTER TABLE sales.payment_modes
            ADD COLUMN IF NOT EXISTS is_pdc  BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE;
    """)

    # 2. Create the check_status enum type (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE t.typname = 'check_status'
                  AND n.nspname = 'sales'
            ) THEN
                CREATE TYPE sales.check_status AS ENUM (
                    'IN_VAULT', 'DEPOSITED', 'BOUNCED'
                );
            END IF;
        END $$;
    """)

    # 3. PDC detail columns on customer_payments
    op.execute("""
        ALTER TABLE sales.customer_payments
            ADD COLUMN IF NOT EXISTS check_number VARCHAR(50),
            ADD COLUMN IF NOT EXISTS check_date   DATE,
            ADD COLUMN IF NOT EXISTS bank_name    VARCHAR(100),
            ADD COLUMN IF NOT EXISTS check_status sales.check_status;
    """)

    # 4. Bounced-check warning flag on customers
    op.execute("""
        ALTER TABLE sales.customers
            ADD COLUMN IF NOT EXISTS has_bounced_check BOOLEAN NOT NULL DEFAULT FALSE;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.customers
            DROP COLUMN IF EXISTS has_bounced_check;
    """)
    op.execute("""
        ALTER TABLE sales.customer_payments
            DROP COLUMN IF EXISTS check_number,
            DROP COLUMN IF EXISTS check_date,
            DROP COLUMN IF EXISTS bank_name,
            DROP COLUMN IF EXISTS check_status;
    """)
    op.execute("DROP TYPE IF EXISTS sales.check_status;")
    op.execute("""
        ALTER TABLE sales.payment_modes
            DROP COLUMN IF EXISTS is_pdc,
            DROP COLUMN IF EXISTS is_cash;
    """)
