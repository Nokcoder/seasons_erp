"""platform: RLS pilot on the 8 leaf/reference tables (Phase 2 step 4)

Enables Row-Level Security tenant isolation on the tables that already carry
tenant_id. Each gets ENABLE + FORCE ROW LEVEL SECURITY and a single FOR ALL
policy whose USING (read/update/delete visibility) and WITH CHECK (insert/update
validation) both require:

    tenant_id = current_setting('app.tenant_id', true)::integer

The GUC is set per request by get_db's after_begin listener (Phase 2 step 2).
missing_ok=true means an unset GUC yields NULL, so `tenant_id = NULL` is NULL for
every row → zero rows → fail closed (never fail open to all rows).

FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner. Our
owner/migrator/seam role erp_admin is a SUPERUSER, and superusers bypass RLS
unconditionally regardless of FORCE — so the admin/seed/signup path (get_admin_db)
and migrations are unaffected. FORCE is defense-in-depth for the day the owner is
not a superuser. (This bypass is verified empirically in the step report.)

Pairs with the server_default from migration c9d0e1f2a3b4: an INSERT that omits
tenant_id gets it from the same GUC the WITH CHECK validates against, so the
default and the policy agree by construction.

No tenant_id added to any further table here — this is a pilot on 8 tables only.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-13
"""
from alembic import op

revision = 'd0e1f2a3b4c5'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None

TABLES = [
    ("inventory", "locations"),
    ("inventory", "uoms"),
    ("inventory", "product_categories"),
    ("inventory", "suppliers"),
    ("sales",     "payment_modes"),
    ("sales",     "cash_registers"),
    ("sales",     "shifts"),
    ("sales",     "customers"),
]

_PREDICATE = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {s}.{t} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {s}.{t}
            USING ({_PREDICATE})
            WITH CHECK ({_PREDICATE});
        """)


def downgrade():
    for s, t in TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {s}.{t};")
        op.execute(f"ALTER TABLE {s}.{t} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {s}.{t} DISABLE ROW LEVEL SECURITY;")
