"""retire phantom RBAC actions (receive_transfer, manage_sales_settings)

Both actions were seeded but guarded no distinct endpoint:

* ``receive_transfer`` — Season ERP transfers are single-step. ``create_transfer``
  (POST /transfers/) records a *completed* transfer, writing TRANSFER_OUT and
  TRANSFER_IN atomically (it accepts ``quantity_received`` inline). There is no
  separate "receive" operation to guard, so the key mapped to nothing. The
  roles that held it (WAREHOUSE_MANAGER, WAREHOUSE_STAFF) already hold
  ``create_transfer``, so no real capability is lost.

* ``manage_sales_settings`` — a coarse key that guarded the shifts / registers /
  payment-modes mutation endpoints. The frontend Settings screen already gates
  those sub-tabs by the granular keys (``manage_shifts``, ``manage_registers``,
  ``manage_payment_modes``); the endpoints have now been narrowed to match. The
  only role that held the coarse key (STORE_MANAGER) already holds all three
  granular keys, so no real capability is lost.

Deletes the role grants first, then the global catalog rows.

Revision ID: aa11bb22cc33
Revises: r3c4d5e6f7a8
Create Date: 2026-07-14
"""
from alembic import op

revision = "aa11bb22cc33"
down_revision = "r3c4d5e6f7a8"
branch_labels = None
depends_on = None

_KEYS = ("receive_transfer", "manage_sales_settings")


def upgrade() -> None:
    op.execute("""
        DELETE FROM auth.role_actions ra
        USING auth.actions a
        WHERE ra.action_id = a.action_id
          AND a.action_key IN ('receive_transfer', 'manage_sales_settings')
    """)
    op.execute("""
        DELETE FROM auth.actions
        WHERE action_key IN ('receive_transfer', 'manage_sales_settings')
    """)


def downgrade() -> None:
    # Restore the global catalog rows (grants are re-applied by the seed for
    # fresh tenants; per-tenant grants are not reconstructed here).
    op.execute("""
        INSERT INTO auth.actions (action_key, display_name, program_id)
        SELECT 'receive_transfer', 'Receive Transfer', p.program_id
        FROM auth.programs p WHERE p.program_key = 'stock_transfers'
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO auth.actions (action_key, display_name, program_id)
        SELECT 'manage_sales_settings', 'Manage Sales Settings', p.program_id
        FROM auth.programs p WHERE p.program_key = 'settings'
        ON CONFLICT DO NOTHING
    """)
