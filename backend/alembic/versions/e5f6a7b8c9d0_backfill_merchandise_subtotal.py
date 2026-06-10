"""sales: backfill merchandise_subtotal for pre-migration Posted sales

c3d4e5f6a7b8 added the column with DEFAULT 0, leaving existing Posted sales
at zero. This migration computes the correct value for each of those rows by
summing Inventory-type line items from sales.sale_items.

Downgrade is a no-op: the column stays, values are left as-is (re-running
the upgrade is idempotent).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-11
"""
from alembic import op

revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE sales.sales s
           SET merchandise_subtotal = (
               SELECT COALESCE(SUM(si.line_total), 0)
                 FROM sales.sale_items si
                 JOIN inventory.variants v ON v.variant_id = si.variant_id
                 JOIN inventory.products p ON p.product_id = v.product_id
                WHERE si.sale_id = s.sale_id
                  AND p.product_type = 'Inventory'
           )
         WHERE s.status = 'Posted';
    """)


def downgrade():
    pass  # intentionally left blank — column stays, values are not reversed
