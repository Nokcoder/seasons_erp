"""platform: per-tenant document numbering (document_sequences counter)

Replaces global-serial-based PID assignment (f"SALE-{sale_id}") — which leaked
cross-tenant document volume and made every tenant continue from one shared
counter — with a per-tenant counter table incremented under a row lock.

Creates platform.document_sequences (tenant_id, doc_type) PK, next_number, with
RLS so a tenant can only touch its own counters. Backfills existing tenants'
counters to (their current max document number + 1) so their numbering
CONTINUES — never restarts (a second SALE-00001 in tenant 1 would collide with a
live ledger row). Tenants with no documents of a type get no row and are
auto-started at 1 by the app's INSERT..ON CONFLICT on first use.

Doc types: SALE, RET, SRET, PO, SHP, TRF. (CM/credit-memo excluded — random code,
not a sequential counter.)

NOTE: acme's usability-test documents (SALE-00108 etc.) are renumbered to start at
1 by a separate one-off dev data-fix, not this migration — this migration is
generic and reproducible on any environment.

Revision ID: r3c4d5e6f7a8
Revises: q2b3c4d5e6f7
Create Date: 2026-07-14
"""
from alembic import op

revision = 'r3c4d5e6f7a8'
down_revision = 'q2b3c4d5e6f7'
branch_labels = None
depends_on = None

# (doc_type, source_table, pid_column, substring_start)  substring_start = len(prefix)+1
BACKFILLS = [
    ("SALE", "sales.sales",                    "sale_pid",     6),
    ("RET",  "sales.sales_returns",            "return_pid",   5),
    ("SRET", "sales.supplier_returns",         "return_pid",   6),
    ("PO",   "procurement.purchase_orders",    "po_pid",       4),
    ("SHP",  "procurement.inventory_shipments","shipment_pid", 5),
    ("TRF",  "inventory.inventory_transfers",  "transfer_pid", 5),
]


def upgrade():
    op.execute("""
        CREATE TABLE platform.document_sequences (
            tenant_id   INTEGER NOT NULL REFERENCES platform.tenants(tenant_id),
            doc_type    VARCHAR NOT NULL,
            next_number INTEGER NOT NULL,
            PRIMARY KEY (tenant_id, doc_type)
        );
    """)
    op.execute("ALTER TABLE platform.document_sequences ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE platform.document_sequences FORCE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON platform.document_sequences
        USING (tenant_id = current_setting('app.tenant_id', true)::integer)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::integer);
    """)

    # Seed each existing tenant's counter to (max used number + 1) so numbering continues.
    for doc, tbl, col, pos in BACKFILLS:
        prefix = doc + "-"
        op.execute(f"""
            INSERT INTO platform.document_sequences (tenant_id, doc_type, next_number)
            SELECT tenant_id, '{doc}',
                   COALESCE(MAX(CAST(SUBSTRING({col} FROM {pos}) AS INTEGER)), 0) + 1
            FROM {tbl}
            WHERE {col} ~ '^{prefix}[0-9]+$'
            GROUP BY tenant_id;
        """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS platform.document_sequences;")
