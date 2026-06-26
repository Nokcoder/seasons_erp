"""inventory: add include_in_ordering to variants

Controls whether a variant appears in ordering workflows (PO creation,
ordering forms). Independent of product.status and is_deleted. Defaults
to TRUE so all existing variants remain fully orderable on day one.

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-06-26
"""
from alembic import op

revision = 'm3h4i5j6k7l8'
down_revision = 'l2g3h4i5j6k7'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE inventory.variants
            ADD COLUMN IF NOT EXISTS include_in_ordering BOOLEAN NOT NULL DEFAULT TRUE;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE inventory.variants
            DROP COLUMN IF EXISTS include_in_ordering;
    """)
