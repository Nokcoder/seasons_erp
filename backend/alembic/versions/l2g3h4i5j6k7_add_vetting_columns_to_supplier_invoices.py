"""ap: add vetting_status, paid_before_received, check_drafted, check_drafted_note to supplier_invoices

These columns were added to the SQLAlchemy model but never had a corresponding
migration, causing UndefinedColumn errors on every INSERT and SELECT against
ap.supplier_invoices (confirm-costs, list-invoices, aging report, etc.).

Revision ID: l2g3h4i5j6k7
Revises: k1f2g3h4i5j6
Create Date: 2026-06-26
"""
from alembic import op

revision = 'l2g3h4i5j6k7'
down_revision = 'k1f2g3h4i5j6'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create the vetting status enum type (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE t.typname = 'invoice_vetting_status'
                  AND n.nspname = 'ap'
            ) THEN
                CREATE TYPE ap.invoice_vetting_status AS ENUM (
                    'Pending_Review', 'Approved', 'Rejected'
                );
            END IF;
        END $$;
    """)

    # 2. Add the new columns — all with safe defaults for existing rows
    op.execute("""
        ALTER TABLE ap.supplier_invoices
            ADD COLUMN IF NOT EXISTS vetting_status ap.invoice_vetting_status
                NOT NULL DEFAULT 'Pending_Review',
            ADD COLUMN IF NOT EXISTS paid_before_received BOOLEAN
                NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS check_drafted BOOLEAN
                NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS check_drafted_note TEXT;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE ap.supplier_invoices
            DROP COLUMN IF EXISTS vetting_status,
            DROP COLUMN IF EXISTS paid_before_received,
            DROP COLUMN IF EXISTS check_drafted,
            DROP COLUMN IF EXISTS check_drafted_note;
    """)
    op.execute("DROP TYPE IF EXISTS ap.invoice_vetting_status;")
