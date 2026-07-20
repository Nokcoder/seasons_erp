"""platform: tenant_id + RLS across procurement + ap (Phase 2, cluster 3)

procurement and ap migrate as ONE unit because they are FK-entangled:
  ap.supplier_invoices        -> procurement.inventory_shipments
  ap.supplier_invoice_items   -> procurement.purchase_order_items
Splitting them would recreate the dangling-reference hazard the pilot exposed.

Tables (9):
  procurement: purchase_orders, purchase_order_items, inventory_shipments,
               receiving_details
  ap:          supplier_invoices, supplier_invoice_items, supplier_payments,
               invoice_payments, ap_ledger

Every FK in this cluster points either at an already-scoped table (inventory /
suppliers / locations / auth) or at another table inside the cluster, so after
this lands there is no window where a referenced table is filtered while its
referencing table is not.

Per table: tenant_id NULLABLE FK -> backfill to Default (by slug) -> NOT NULL ->
GUC server_default -> ENABLE + FORCE RLS with the standard tenant_isolation
policy (USING + WITH CHECK on tenant_id = current_setting('app.tenant_id')::int).

Global uniques -> composite (tenant_id, value): purchase_orders.po_pid,
inventory_shipments.shipment_pid.

Indexes: ap_ledger is append-only/unbounded (same class as inventory_ledger) —
gets (tenant_id, supplier_id) and (tenant_id, occurred_at), mirroring the
inventory_ledger treatment. The other 8 tables have no secondary index that the
implicit tenant filter would render non-selective (PK lookups stay selective;
child tables are accessed by parent FK which is already tenant-implicit and were
unindexed before, so RLS degrades nothing).

Note: ap has zero user-attribution columns, but tenant_id is a direct column
(not derived from any user FK), so scoping is unaffected.

Revision ID: p1a2b3c4d5e6
Revises: f2a3b4c5d6e7
Create Date: 2026-07-14
"""
from alembic import op

revision = 'p1a2b3c4d5e6'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None

TABLES = [
    ("procurement", "purchase_orders"),
    ("procurement", "purchase_order_items"),
    ("procurement", "inventory_shipments"),
    ("procurement", "receiving_details"),
    ("ap", "supplier_invoices"),
    ("ap", "supplier_invoice_items"),
    ("ap", "supplier_payments"),
    ("ap", "invoice_payments"),
    ("ap", "ap_ledger"),
]

# (schema, table, old_global_unique, column, new_composite_name)
UNIQUES = [
    ("procurement", "purchase_orders",     "purchase_orders_po_pid_key",          "po_pid",       "uq_purchase_orders_tenant_pid"),
    ("procurement", "inventory_shipments",  "inventory_shipments_shipment_pid_key", "shipment_pid", "uq_shipments_tenant_pid"),
]

_DEFAULT   = "current_setting('app.tenant_id', true)::integer"
_PREDICATE = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ADD COLUMN tenant_id INTEGER "
                   f"REFERENCES platform.tenants(tenant_id);")
    for s, t in TABLES:
        op.execute(f"""
            UPDATE {s}.{t}
            SET tenant_id = (SELECT tenant_id FROM platform.tenants WHERE slug = 'default')
            WHERE tenant_id IS NULL;
        """)
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ALTER COLUMN tenant_id SET NOT NULL;")
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ALTER COLUMN tenant_id SET DEFAULT {_DEFAULT};")

    for s, t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE {s}.{t} DROP CONSTRAINT {old};")
        op.execute(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {new} UNIQUE (tenant_id, {col});")

    op.execute("CREATE INDEX ix_ap_ledger_tenant_supplier ON ap.ap_ledger (tenant_id, supplier_id);")
    op.execute("CREATE INDEX ix_ap_ledger_tenant_occurred ON ap.ap_ledger (tenant_id, occurred_at);")

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
    op.execute("DROP INDEX IF EXISTS ap.ix_ap_ledger_tenant_supplier;")
    op.execute("DROP INDEX IF EXISTS ap.ix_ap_ledger_tenant_occurred;")
    for s, t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE {s}.{t} DROP CONSTRAINT {new};")
        op.execute(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {old} UNIQUE ({col});")
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} DROP COLUMN tenant_id;")
