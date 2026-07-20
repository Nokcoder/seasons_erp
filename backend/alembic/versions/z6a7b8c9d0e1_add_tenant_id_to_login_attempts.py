"""platform: add tenant_id to auth.login_attempts (multi-tenancy, pass 1)

Adds a NULLABLE tenant_id to auth.login_attempts. Deliberately nullable, not
NOT NULL: a login attempt against a bogus org_slug has no tenant to attribute
to, and recording that (as NULL) is a real, required case — a failed attempt
where the tenant itself couldn't be resolved.

login_attempts is the one auth-schema table that cannot recover a tenant after
the fact: username is a bare string and failed attempts often carry
user_id = NULL (username not found), so there's no join path to a tenant. Once
signup lets two tenants both have an "admin", the failed-login history becomes
permanently ambiguous — hence this lands before signup. (audit_log, which does
retain an actor_user_id -> users.tenant_id join path, is deliberately deferred
to its own later pass.)

Existing rows all predate multi-tenancy and belong to the Default tenant;
backfilled by slug rather than a hardcoded id, consistent with the earlier
tenant_id migrations.

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-07-13
"""
from alembic import op

revision = 'z6a7b8c9d0e1'
down_revision = 'y5z6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add tenant_id as a NULLABLE FK (stays nullable — see module docstring).
    op.execute("""
        ALTER TABLE auth.login_attempts ADD COLUMN tenant_id INTEGER
            REFERENCES platform.tenants(tenant_id);
    """)

    # 2. Backfill every existing row to the Default tenant, resolved by slug.
    op.execute("""
        UPDATE auth.login_attempts
        SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
        WHERE tenant_id IS NULL;
    """)


def downgrade():
    op.execute("ALTER TABLE auth.login_attempts DROP COLUMN tenant_id;")
