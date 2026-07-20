"""platform: tenant_id + RLS across the rest of the inventory schema (Phase 2 step 5)

Migrates the remaining inventory tables as ONE FK-coherent cluster — tenant_id +
server_default + ENABLE/FORCE RLS in the same pass — so there is no window where a
referenced table is filtered while its referencing tables are not (the
dangling-reference 500 the pilot exposed on GET /products/ for a non-owning tenant).

Tables (14):
  products, variants, variant_barcodes, variant_uom_conversions, bundle_components,
  product_category_links, variant_suppliers, current_stocks, cost_layers,
  inventory_ledger, inventory_transfers, inventory_transfer_items,
  variant_price_history, variant_cost_history

Per table: add tenant_id NULLABLE FK → backfill to Default (by slug) → NOT NULL →
GUC server_default (current_setting('app.tenant_id')::int) → ENABLE + FORCE ROW
LEVEL SECURITY + tenant_isolation policy (USING + WITH CHECK on the same predicate).

Global uniques → composite (tenant_id, value):
  variants."PID", variant_barcodes.barcode, and inventory_transfers.transfer_pid.
  (transfer_pid was not named in the brief but is the same global-string class and
  is converted here too so two tenants can reuse a transfer PID.)

Indexes added (see step report for reasoning) — tenant-leading composites where the
existing index would stop covering the access pattern under the implicit tenant
filter, focused on the unbounded/append-only tables.

tenant_id is intentionally NOT mapped in the ORM for these tables: RLS handles
isolation and no app code references it, so the ORM omits the column on INSERT and
the server_default populates it. The migration is the source of truth here.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-07-13
"""
from alembic import op

revision = 'e1f2a3b4c5d6'
down_revision = 'd0e1f2a3b4c5'
branch_labels = None
depends_on = None

TABLES = [
    "products", "variants", "variant_barcodes", "variant_uom_conversions",
    "bundle_components", "product_category_links", "variant_suppliers",
    "current_stocks", "cost_layers", "inventory_ledger", "inventory_transfers",
    "inventory_transfer_items", "variant_price_history", "variant_cost_history",
]

# (table, old_global_unique, column_sql, new_composite_name)
UNIQUES = [
    ("variants",            "variants_PID_key",                      '"PID"',       "uq_variants_tenant_pid"),
    ("variant_barcodes",    "variant_barcodes_barcode_key",          "barcode",     "uq_barcodes_tenant_barcode"),
    ("inventory_transfers", "inventory_transfers_transfer_pid_key",  "transfer_pid","uq_transfers_tenant_pid"),
]

_DEFAULT   = "current_setting('app.tenant_id', true)::integer"
_PREDICATE = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    # 1. Add tenant_id NULLABLE.
    for t in TABLES:
        op.execute(f"ALTER TABLE inventory.{t} ADD COLUMN tenant_id INTEGER "
                   f"REFERENCES platform.tenants(tenant_id);")
    # 2. Backfill to the Default tenant (by slug).
    for t in TABLES:
        op.execute(f"""
            UPDATE inventory.{t}
            SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
            WHERE tenant_id IS NULL;
        """)
    # 3. NOT NULL (fails the whole migration if any row was missed).
    for t in TABLES:
        op.execute(f"ALTER TABLE inventory.{t} ALTER COLUMN tenant_id SET NOT NULL;")
    # 4. GUC-backed default so INSERTs that omit tenant_id auto-fill from request context.
    for t in TABLES:
        op.execute(f"ALTER TABLE inventory.{t} ALTER COLUMN tenant_id SET DEFAULT {_DEFAULT};")

    # 5. Global uniques -> per-tenant composites. Old names are double-quoted
    #    because variants_PID_key is mixed-case (the column is "PID"); an unquoted
    #    identifier would be folded to lowercase and not found.
    for t, old, col, new in UNIQUES:
        op.execute(f'ALTER TABLE inventory.{t} DROP CONSTRAINT "{old}";')
        op.execute(f"ALTER TABLE inventory.{t} ADD CONSTRAINT {new} UNIQUE (tenant_id, {col});")

    # 6. Tenant-leading indexes on the unbounded / append-only tables.
    op.execute("CREATE INDEX ix_ledger_tenant_variant  ON inventory.inventory_ledger (tenant_id, variant_id);")
    op.execute("CREATE INDEX ix_ledger_tenant_occurred ON inventory.inventory_ledger (tenant_id, occurred_at);")
    op.execute("CREATE INDEX ix_cost_layers_tenant_variant ON inventory.cost_layers (tenant_id, variant_id);")

    # 7. Enable + force RLS with the tenant_isolation policy.
    for t in TABLES:
        op.execute(f"ALTER TABLE inventory.{t} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE inventory.{t} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON inventory.{t}
            USING ({_PREDICATE})
            WITH CHECK ({_PREDICATE});
        """)


def downgrade():
    for t in TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON inventory.{t};")
        op.execute(f"ALTER TABLE inventory.{t} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE inventory.{t} DISABLE ROW LEVEL SECURITY;")
    op.execute("DROP INDEX IF EXISTS inventory.ix_ledger_tenant_variant;")
    op.execute("DROP INDEX IF EXISTS inventory.ix_ledger_tenant_occurred;")
    op.execute("DROP INDEX IF EXISTS inventory.ix_cost_layers_tenant_variant;")
    for t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE inventory.{t} DROP CONSTRAINT {new};")
        op.execute(f'ALTER TABLE inventory.{t} ADD CONSTRAINT "{old}" UNIQUE ({col});')
    for t in TABLES:
        op.execute(f"ALTER TABLE inventory.{t} DROP COLUMN tenant_id;")
