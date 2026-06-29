"""sales: add receipt_no to sales table

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-06-30
"""
from alembic import op

revision = 'o5p6q7r8s9t0'
down_revision = 'n4o5p6q7r8s9'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.sales
        ADD COLUMN IF NOT EXISTS receipt_no VARCHAR(100) NULL;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sales.sales
        DROP COLUMN IF EXISTS receipt_no;
    """)
