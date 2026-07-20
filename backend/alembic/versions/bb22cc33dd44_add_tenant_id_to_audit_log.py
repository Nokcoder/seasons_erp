"""add tenant_id to auth.audit_log (last piece of tenant scoping)

auth.audit_log had no tenant_id. It could reach a tenant via
actor_user_id -> users.tenant_id, but system/boot writes pass
actor_user_id=None, so those rows had no tenant even via the join.

Mechanism: a GUC server_default
    current_setting('app.tenant_id', true)::integer
auto-fills the column on the request path. write_audit() receives the
per-request session (which has SET LOCAL app.tenant_id from get_db), so
every business call site is covered with no code change and no risk of a
missed site. auth is NOT RLS'd, so this is purely a column default, not a
policy.

NULLABLE by design: genuine system/boot writes (no request, no GUC) have
no tenant. Forcing NOT NULL would break boot writes and misattribute
platform activity to a tenant.

Backfill:
  * actor set          -> users.tenant_id (364 rows here)
  * null actor         -> attribute by the record touched:
                          record_pk -> the touched row's tenant_id
                          (17 auth.users INSERTs, 1 customer_payments UPDATE)
  * anything remaining -> left NULL (genuinely un-attributable)

Runs as erp_admin (RLS-bypassing), so the cross-tenant backfill joins see
every tenant's rows.

Revision ID: bb22cc33dd44
Revises: aa11bb22cc33
Create Date: 2026-07-14
"""
from alembic import op

revision = "bb22cc33dd44"
down_revision = "aa11bb22cc33"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. add the column, nullable, no default yet (backfill before defaulting)
    op.execute("ALTER TABLE auth.audit_log ADD COLUMN tenant_id integer")

    # 2a. rows with an actor -> the actor's tenant
    op.execute("""
        UPDATE auth.audit_log al
        SET tenant_id = u.tenant_id
        FROM auth.users u
        WHERE al.actor_user_id = u.user_id
          AND al.tenant_id IS NULL
    """)

    # 2b. null-actor rows -> attribute by the record they touched
    op.execute("""
        UPDATE auth.audit_log al
        SET tenant_id = u.tenant_id
        FROM auth.users u
        WHERE al.actor_user_id IS NULL
          AND al.table_name = 'auth.users'
          AND al.record_pk ~ '^[0-9]+$'
          AND u.user_id = al.record_pk::int
          AND al.tenant_id IS NULL
    """)
    op.execute("""
        UPDATE auth.audit_log al
        SET tenant_id = cp.tenant_id
        FROM sales.customer_payments cp
        WHERE al.actor_user_id IS NULL
          AND al.table_name = 'sales.customer_payments'
          AND al.record_pk ~ '^[0-9]+$'
          AND cp.payment_id = al.record_pk::int
          AND al.tenant_id IS NULL
    """)

    # 3. now install the GUC server_default for all future request-path inserts
    op.execute("""
        ALTER TABLE auth.audit_log
        ALTER COLUMN tenant_id
        SET DEFAULT current_setting('app.tenant_id', true)::integer
    """)

    # 4. FK to platform.tenants (NULLs skip the check) + index
    op.execute("""
        ALTER TABLE auth.audit_log
        ADD CONSTRAINT audit_log_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenants(tenant_id)
    """)
    op.execute("""
        CREATE INDEX ix_audit_log_tenant
        ON auth.audit_log (tenant_id, occurred_at)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS auth.ix_audit_log_tenant")
    op.execute("ALTER TABLE auth.audit_log DROP CONSTRAINT IF EXISTS audit_log_tenant_id_fkey")
    op.execute("ALTER TABLE auth.audit_log DROP COLUMN IF EXISTS tenant_id")
