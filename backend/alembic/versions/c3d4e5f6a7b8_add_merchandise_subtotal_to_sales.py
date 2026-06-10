"""sales: add merchandise_subtotal to sales.sales

Stores the sum of Inventory-type line items only (excludes Service and
Non-Inventory). Used by get_sales_summary to compute merchandise_gross
without double-counting non-merchandise revenue.

Revision ID: c3d4e5f6a7b8
Revises: a3b4c5d6e7f8
Create Date: 2026-06-11
"""
from alembic import op

revision = 'c3d4e5f6a7b8'
down_revision = 'a3b4c5d6e7f8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales
            ADD COLUMN merchandise_subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0;
    """)

    # Backfill existing Posted sales — the ADD COLUMN default leaves them at 0.
    op.execute("""
        UPDATE sales.sales s
           SET merchandise_subtotal = (
               SELECT COALESCE(SUM(si.line_total), 0)
                 FROM sales.sale_items si
                 JOIN inventory.variants  v ON v.variant_id  = si.variant_id
                 JOIN inventory.products  p ON p.product_id  = v.product_id
                WHERE si.sale_id = s.sale_id
                  AND p.product_type = 'Inventory'
           )
         WHERE s.status = 'Posted';
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales
            DROP COLUMN merchandise_subtotal;
    """)
