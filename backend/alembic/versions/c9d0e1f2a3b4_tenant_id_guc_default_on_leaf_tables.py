"""platform: tenant_id GUC default on the leaf/reference tables (Phase 2 step 3b)

Makes tenant_id auto-populate from the per-request tenant context on INSERTs
that omit it. The column default is current_setting('app.tenant_id')::int — the
GUC set per request by get_db's after_begin listener (Phase 2 step 2).

Why: step 3 made tenant_id NOT NULL, but the create endpoints don't set it, so
the ORM was sending tenant_id=NULL → NOT NULL violation. Rather than editing
every create endpoint, we let the DB fill it from the request context (paired
with server_default on the models so SQLAlchemy omits the column on insert).

Still NOT an RLS policy and NOT ROW LEVEL SECURITY — just a column default.
- Request path (erp_app, GUC set): default resolves to the caller's tenant.
- Admin/seed path (erp_admin, no GUC): those inserts set tenant_id explicitly,
  so the default is never relied on; a contextless insert would get NULL and be
  rejected by NOT NULL (fail closed), which is the desired behaviour.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-13
"""
from alembic import op

revision = 'c9d0e1f2a3b4'
down_revision = 'b8c9d0e1f2a3'
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

_DEFAULT = "current_setting('app.tenant_id', true)::integer"


def upgrade():
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ALTER COLUMN tenant_id SET DEFAULT {_DEFAULT};")


def downgrade():
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ALTER COLUMN tenant_id DROP DEFAULT;")
