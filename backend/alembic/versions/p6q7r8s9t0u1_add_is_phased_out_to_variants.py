"""inventory: add is_phased_out to variants

Marks a variant as phased out (discontinued but still carried on hand).
Independent of product.status, is_deleted, and include_in_ordering.
Defaults to FALSE so all existing variants remain active on day one.

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-07-01
"""
from alembic import op

revision = 'p6q7r8s9t0u1'
down_revision = 'o5p6q7r8s9t0'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE inventory.variants
            ADD COLUMN IF NOT EXISTS is_phased_out BOOLEAN NOT NULL DEFAULT FALSE;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE inventory.variants
            DROP COLUMN IF EXISTS is_phased_out;
    """)
