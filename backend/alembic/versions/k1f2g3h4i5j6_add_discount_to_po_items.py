"""procurement: add gross_cost and discount_pct to purchase_order_items

unit_cost on a PO line is now always a server-computed value:
gross_cost * (1 - discount_pct / 100). Existing rows are backfilled with
gross_cost = unit_cost and discount_pct = 0, which preserves their current
unit_cost value exactly.

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-06-24
"""
from alembic import op

revision = 'k1f2g3h4i5j6'
down_revision = 'j0e1f2g3h4i5'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE procurement.purchase_order_items
            ADD COLUMN IF NOT EXISTS gross_cost NUMERIC(15,2),
            ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
    """)
    op.execute("""
        UPDATE procurement.purchase_order_items
        SET gross_cost = unit_cost
        WHERE gross_cost IS NULL;
    """)
    op.execute("""
        ALTER TABLE procurement.purchase_order_items
            ALTER COLUMN gross_cost SET NOT NULL;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE procurement.purchase_order_items
            DROP COLUMN IF EXISTS gross_cost,
            DROP COLUMN IF EXISTS discount_pct;
    """)
