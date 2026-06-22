"""procurement: add discrepancy tracking columns to inventory_shipments

Adds discrepancy_status (enum, default 'None') and discrepancy_notes (text,
nullable) to procurement.inventory_shipments. These columns were added to
the SQLAlchemy model but never had a corresponding migration, causing
UndefinedColumn errors on shipment create/list/receive.

Revision ID: j0e1f2g3h4i5
Revises: i9d0e1f2g3h4
Create Date: 2026-06-22
"""
from alembic import op

revision = 'j0e1f2g3h4i5'
down_revision = 'i9d0e1f2g3h4'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create the discrepancy_status enum type (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE t.typname = 'shipment_discrepancy_status'
                  AND n.nspname = 'procurement'
            ) THEN
                CREATE TYPE procurement.shipment_discrepancy_status AS ENUM (
                    'None', 'Flagged', 'Supplier_Notified', 'Resolved', 'Waived'
                );
            END IF;
        END $$;
    """)

    # 2. Discrepancy tracking columns on inventory_shipments
    op.execute("""
        ALTER TABLE procurement.inventory_shipments
            ADD COLUMN IF NOT EXISTS discrepancy_status procurement.shipment_discrepancy_status
                NOT NULL DEFAULT 'None',
            ADD COLUMN IF NOT EXISTS discrepancy_notes TEXT;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE procurement.inventory_shipments
            DROP COLUMN IF EXISTS discrepancy_status,
            DROP COLUMN IF EXISTS discrepancy_notes;
    """)
    op.execute("DROP TYPE IF EXISTS procurement.shipment_discrepancy_status;")
