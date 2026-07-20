"""platform: harden the tenant_isolation predicate house-wide (all remaining clusters)

Extends the auth-cluster hardening (ee55ff66aa77) to every other tenant_isolation
policy. Same fix, same reason: the predicate
    tenant_id = current_setting('app.tenant_id', true)::integer
is fail-closed when app.tenant_id is NULL, but THROWS
(`invalid input syntax for type integer: ""`) when the GUC is the empty string —
which is what a custom GUC becomes after `RESET app.tenant_id` (vs. never being
set). Re-point every policy to:
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer
so NULL and '' both mean "no context → zero rows", never reaching the cast.

Scope was taken from a live pg_policies enumeration, NOT from the six migrations'
original TABLES lists, to be exhaustive (leaf-pilot tables now live across the
inventory/sales/settings schemas, etc.). At authoring time pg_policies held 47
`tenant_isolation` policies referencing app.tenant_id: 3 already hardened (auth,
by ee55ff66aa77) and the 44 below. All are named `tenant_isolation`; no other
policy name touches the GUC.

Applied via ALTER POLICY (USING + WITH CHECK) so no policy is momentarily absent.
Idempotent in effect: re-pointing to the hardened predicate is safe to re-run.

NOTE (deliberately NOT touched here): the column-default fragility in
c9d0e1f2a3b4 (leaf tables) and bb22cc33dd44 (audit_log), which use the same bare
`current_setting(...)::integer` as a DEFAULT rather than a policy, is a separate
INSERT-time vector and is left for a separate decision.

Revision ID: ff66aa77bb88
Revises: ee55ff66aa77
Create Date: 2026-07-20
"""
from alembic import op

revision = 'ff66aa77bb88'
down_revision = 'ee55ff66aa77'
branch_labels = None
depends_on = None

# (schema, table) for every tenant_isolation policy NOT already hardened, from
# the live pg_policies enumeration (47 total − 3 auth already done = 44).
POLICIES = [
    # ap (5)
    ("ap", "ap_ledger"), ("ap", "invoice_payments"), ("ap", "supplier_invoice_items"),
    ("ap", "supplier_invoices"), ("ap", "supplier_payments"),
    # inventory (18)
    ("inventory", "bundle_components"), ("inventory", "cost_layers"),
    ("inventory", "current_stocks"), ("inventory", "inventory_ledger"),
    ("inventory", "inventory_transfer_items"), ("inventory", "inventory_transfers"),
    ("inventory", "locations"), ("inventory", "product_categories"),
    ("inventory", "product_category_links"), ("inventory", "products"),
    ("inventory", "suppliers"), ("inventory", "uoms"),
    ("inventory", "variant_barcodes"), ("inventory", "variant_cost_history"),
    ("inventory", "variant_price_history"), ("inventory", "variant_suppliers"),
    ("inventory", "variant_uom_conversions"), ("inventory", "variants"),
    # platform (1)
    ("platform", "document_sequences"),
    # procurement (4)
    ("procurement", "inventory_shipments"), ("procurement", "purchase_order_items"),
    ("procurement", "purchase_orders"), ("procurement", "receiving_details"),
    # sales (15)
    ("sales", "ar_ledger"), ("sales", "cash_registers"),
    ("sales", "credit_memo_redemptions"), ("sales", "credit_memos"),
    ("sales", "customer_payment_applied"), ("sales", "customer_payments"),
    ("sales", "customers"), ("sales", "payment_modes"),
    ("sales", "sale_items"), ("sales", "sales"),
    ("sales", "sales_return_items"), ("sales", "sales_returns"),
    ("sales", "shifts"), ("sales", "supplier_return_items"),
    ("sales", "supplier_returns"),
    # settings (1)
    ("settings", "system_settings"),
]

_HARDENED = "tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer"
_ORIGINAL = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    for s, t in POLICIES:
        op.execute(f"""
            ALTER POLICY tenant_isolation ON {s}.{t}
            USING ({_HARDENED})
            WITH CHECK ({_HARDENED});
        """)


def downgrade():
    for s, t in POLICIES:
        op.execute(f"""
            ALTER POLICY tenant_isolation ON {s}.{t}
            USING ({_ORIGINAL})
            WITH CHECK ({_ORIGINAL});
        """)
