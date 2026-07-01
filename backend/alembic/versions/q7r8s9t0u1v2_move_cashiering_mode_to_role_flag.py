"""auth: move cashiering_mode from an action to a role-level boolean flag

Replaces the auth.actions row for 'cashiering_mode' with a dedicated
is_cashiering_mode column on auth.roles. Backfills the flag from whichever
roles currently hold the action before the action (and its role_actions
rows, via ON DELETE CASCADE) are removed.

Note: the column must exist before it can be backfilled, so the physical
statement order here is ADD COLUMN -> UPDATE -> DELETE, even though the
column is conceptually "step 2" of the change.

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-07-02
"""
from alembic import op

revision = 'q7r8s9t0u1v2'
down_revision = 'p6q7r8s9t0u1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE auth.roles
            ADD COLUMN IF NOT EXISTS is_cashiering_mode BOOLEAN NOT NULL DEFAULT FALSE;
    """)

    op.execute("""
        UPDATE auth.roles
        SET is_cashiering_mode = TRUE
        WHERE role_id IN (
            SELECT ra.role_id
            FROM auth.role_actions ra
            JOIN auth.actions a ON a.action_id = ra.action_id
            WHERE a.action_key = 'cashiering_mode'
        );
    """)

    # role_actions.action_id has ON DELETE CASCADE, so this also removes any
    # remaining role_actions rows that referenced the cashiering_mode action.
    op.execute("""
        DELETE FROM auth.actions WHERE action_key = 'cashiering_mode';
    """)


def downgrade():
    op.execute("""
        INSERT INTO auth.actions (action_key, display_name, program_id)
        SELECT 'cashiering_mode', 'Cashiering Mode', p.program_id
        FROM auth.programs p
        WHERE p.program_key = 'sales_workstation'
        ON CONFLICT (action_key) DO NOTHING;
    """)
    op.execute("""
        INSERT INTO auth.role_actions (role_id, action_id)
        SELECT r.role_id, a.action_id
        FROM auth.roles r, auth.actions a
        WHERE r.is_cashiering_mode = TRUE
          AND a.action_key = 'cashiering_mode'
        ON CONFLICT DO NOTHING;
    """)
    op.execute("""
        ALTER TABLE auth.roles DROP COLUMN IF EXISTS is_cashiering_mode;
    """)
