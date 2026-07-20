"""platform: add tenant_id to first leaf/reference tables (Phase 2 step 3)

First domain-schema tenant_id pass. Deliberately limited to the leaf/reference
tables with the fewest inbound FK dependencies:
  inventory.locations, inventory.uoms, inventory.product_categories,
  inventory.suppliers, sales.payment_modes, sales.cash_registers,
  sales.shifts, sales.customers

No RLS policies and no ROW LEVEL SECURITY are added here — columns + backfill
only. Policies come in a later step once every table a policy would reference
carries tenant_id.

Column is added NULLABLE, backfilled to the Default tenant (resolved by
slug='default', not a hardcoded id — consistent with the Phase 1 migrations),
then set NOT NULL. Postgres refuses the NOT NULL step if any row was missed by
the backfill, so the whole (transactional) migration rolls back rather than
partially applying — that is the actual safety guarantee.

The four global UNIQUE constraints flagged in the audit become composite
(tenant_id, value) so two tenants can reuse the same location name / uom code /
category name / supplier code. Their backing indexes are tenant_id-leading, so
they double as the per-tenant lookup index for those columns.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-13
"""
from alembic import op

revision = 'b8c9d0e1f2a3'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None

# add tenant_id + backfill + NOT NULL on each of these
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

# (schema, table, old_global_unique, column, new_composite_name)
UNIQUES = [
    ("inventory", "locations",          "locations_location_name_key",          "location_name", "uq_locations_tenant_name"),
    ("inventory", "uoms",               "uoms_uom_code_key",                    "uom_code",      "uq_uoms_tenant_code"),
    ("inventory", "product_categories", "product_categories_category_name_key", "category_name", "uq_categories_tenant_name"),
    ("inventory", "suppliers",          "suppliers_supplier_code_key",          "supplier_code", "uq_suppliers_tenant_code"),
]


def upgrade():
    # 1. Add tenant_id as a NULLABLE FK.
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ADD COLUMN tenant_id INTEGER "
                   f"REFERENCES platform.tenants(tenant_id);")

    # 2. Backfill every existing row to the Default tenant (resolved by slug).
    for s, t in TABLES:
        op.execute(f"""
            UPDATE {s}.{t}
            SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
            WHERE tenant_id IS NULL;
        """)

    # 3. Only now NOT NULL — fails the whole migration if any row was missed.
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ALTER COLUMN tenant_id SET NOT NULL;")

    # 4. Swap the four global UNIQUEs for per-tenant composites.
    for s, t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE {s}.{t} DROP CONSTRAINT {old};")
        op.execute(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {new} UNIQUE (tenant_id, {col});")

    # 5. One added index: sales.customers is the only growth table in this set
    #    without a composite-unique (which would otherwise supply a tenant-leading
    #    index). The bounded reference tables (uoms/locations/registers/shifts/
    #    payment_modes) don't warrant one, and PK indexes stay fully selective for
    #    id lookups even with an added tenant_id filter.
    op.execute("CREATE INDEX ix_customers_tenant_id ON sales.customers (tenant_id);")


def downgrade():
    op.execute("DROP INDEX IF EXISTS sales.ix_customers_tenant_id;")
    for s, t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE {s}.{t} DROP CONSTRAINT {new};")
        op.execute(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {old} UNIQUE ({col});")
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} DROP COLUMN tenant_id;")
