"""platform: add tenant_id to auth.employees/users/roles (multi-tenancy phase 2)

Retrofits tenant_id onto the three core auth tables and converts
users.username / roles.role_name uniqueness from global to per-tenant.

The "Default" tenant insert below is idempotent (ON CONFLICT DO NOTHING) so
this migration is self-contained and reproducible on a fresh database — but
on THIS database it was already created manually before this migration ran
(platform.tenants.tenant_id = 1), so it's a no-op here. The backfill below
resolves the tenant by slug rather than hardcoding that id, so it's correct
either way.

Column is added nullable first, backfilled, then set NOT NULL in the same
migration transaction — Postgres itself refuses the NOT NULL step if any row
was missed by the backfill, which is the actual safety guarantee (not just a
manual check): if that happens, the whole migration rolls back and nothing
partially applies.

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-07-13
"""
from alembic import op

revision = 'y5z6a7b8c9d0'
down_revision = 'x4y5z6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    # Safety net for fresh environments — no-op here since it already exists.
    op.execute("""
        INSERT INTO platform.tenants (name, slug)
        VALUES ('Default', 'default')
        ON CONFLICT (slug) DO NOTHING;
    """)

    # 1. Add tenant_id as NULLABLE first.
    op.execute("""
        ALTER TABLE auth.employees ADD COLUMN tenant_id INTEGER
            REFERENCES platform.tenants(tenant_id);
        ALTER TABLE auth.users ADD COLUMN tenant_id INTEGER
            REFERENCES platform.tenants(tenant_id);
        ALTER TABLE auth.roles ADD COLUMN tenant_id INTEGER
            REFERENCES platform.tenants(tenant_id);
    """)

    # 2. Backfill every existing row to the Default tenant, resolved by slug
    #    (not hardcoded) so this is correct regardless of the actual id.
    op.execute("""
        UPDATE auth.employees SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
        WHERE tenant_id IS NULL;
        UPDATE auth.users SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
        WHERE tenant_id IS NULL;
        UPDATE auth.roles SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
        WHERE tenant_id IS NULL;
    """)

    # 3. Only now make it NOT NULL. Fails the whole (transactional) migration
    #    if any row still has NULL tenant_id.
    op.execute("""
        ALTER TABLE auth.employees ALTER COLUMN tenant_id SET NOT NULL;
        ALTER TABLE auth.users ALTER COLUMN tenant_id SET NOT NULL;
        ALTER TABLE auth.roles ALTER COLUMN tenant_id SET NOT NULL;
    """)

    # 4. Swap global uniqueness for per-tenant uniqueness.
    op.execute("""
        ALTER TABLE auth.users DROP CONSTRAINT users_username_key;
        ALTER TABLE auth.users ADD CONSTRAINT uq_users_tenant_username UNIQUE (tenant_id, username);

        ALTER TABLE auth.roles DROP CONSTRAINT roles_role_name_key;
        ALTER TABLE auth.roles ADD CONSTRAINT uq_roles_tenant_role_name UNIQUE (tenant_id, role_name);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE auth.roles DROP CONSTRAINT uq_roles_tenant_role_name;
        ALTER TABLE auth.roles ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);

        ALTER TABLE auth.users DROP CONSTRAINT uq_users_tenant_username;
        ALTER TABLE auth.users ADD CONSTRAINT users_username_key UNIQUE (username);
    """)
    op.execute("""
        ALTER TABLE auth.employees DROP COLUMN tenant_id;
        ALTER TABLE auth.users DROP COLUMN tenant_id;
        ALTER TABLE auth.roles DROP COLUMN tenant_id;
    """)
