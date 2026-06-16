"""ap: allow null shipment_id on supplier_invoices (manual invoices)

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-06-15
"""
from alembic import op

revision = 'h8c9d0e1f2g3'
down_revision = 'g7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    # shipment_id was already nullable in the original DDL (plain INTEGER,
    # no NOT NULL), but this migration documents the deliberate intent to
    # support standalone invoices that are not linked to a GRN/shipment.
    # DROP NOT NULL is idempotent — safe to run on any environment.
    op.execute("""
        ALTER TABLE ap.supplier_invoices
            ALTER COLUMN shipment_id DROP NOT NULL;
    """)


def downgrade():
    # NOTE: this will fail if any rows have shipment_id = NULL.
    # Clear or backfill those rows before running the downgrade.
    op.execute("""
        ALTER TABLE ap.supplier_invoices
            ALTER COLUMN shipment_id SET NOT NULL;
    """)
