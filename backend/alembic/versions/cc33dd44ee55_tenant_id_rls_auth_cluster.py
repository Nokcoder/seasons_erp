"""platform: RLS on the auth cluster (users, employees, roles) — Track A auth subset

The auth cluster already carries tenant_id (NOT NULL, added Phase 1 migration
y5z6a7b8c9d0) with composite uniques (uq_users_tenant_username,
uq_roles_tenant_role_name). This migration adds ONLY the enforcement layer:
ENABLE + FORCE ROW LEVEL SECURITY + a tenant_isolation policy on each of the
three tables. No columns, constraints, defaults, or indexes change here.

Predicate is the house standard used by every other cluster:
    tenant_id = current_setting('app.tenant_id', true)::integer
The `, true` (missing_ok) makes current_setting return NULL when the GUC is
unset, so `tenant_id = NULL` is NULL (never true) → zero rows. Fail-closed: a
request with no tenant context sees nothing rather than everything.

── Why no GUC server_default on tenant_id (unlike the inventory cluster) ──
The auth ORM maps tenant_id explicitly and every writer sets it by hand
(auth.router.register, tenancy.router.signup). There is no code path that
INSERTs an auth row while relying on the GUC to fill tenant_id, so no default is
added — the explicit value is always present.

── Two bypass/bootstrap seams this migration depends on (both already in place) ──
1. signup (tenancy.router.signup) runs on get_admin_db = erp_admin, a SUPERUSER.
   Superusers bypass RLS entirely (FORCE does not apply to a superuser), so
   creating a new tenant's roles/employee/user with explicit tenant_id is
   unaffected. FORCE is kept anyway for defence-in-depth should ownership ever
   move to a non-superuser role.
2. login (auth.router.login) runs on erp_app with NO JWT yet, so no tenant
   context exists when it must read auth.users. The login handler was reworked
   in the same change to resolve org_slug → tenant_id against the (un-RLS'd)
   platform.tenants table, SET LOCAL app.tenant_id, and only THEN read auth.users
   — so the scoped lookup returns the row. Without that rework this migration
   would break login for every tenant.

login_attempts and audit_log are intentionally NOT included: both legitimately
hold rows with a NULL tenant (bogus-slug login attempts; system/boot audit
writes), which the fail-closed policy would reject.

Revision ID: cc33dd44ee55
Revises: bb22cc33dd44
Create Date: 2026-07-19
"""
from alembic import op

revision = 'cc33dd44ee55'
down_revision = 'bb22cc33dd44'
branch_labels = None
depends_on = None

TABLES = ["users", "employees", "roles"]

_PREDICATE = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    for t in TABLES:
        op.execute(f"ALTER TABLE auth.{t} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE auth.{t} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON auth.{t}
            USING ({_PREDICATE})
            WITH CHECK ({_PREDICATE});
        """)


def downgrade():
    for t in TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON auth.{t};")
        op.execute(f"ALTER TABLE auth.{t} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE auth.{t} DISABLE ROW LEVEL SECURITY;")
