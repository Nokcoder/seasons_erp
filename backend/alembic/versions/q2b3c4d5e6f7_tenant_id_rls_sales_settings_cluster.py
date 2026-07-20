"""platform: tenant_id + RLS across sales + settings (Phase 2, cluster 4 - final domain)

Scopes the remaining sales tables (the pilot already did payment_modes,
cash_registers, shifts, customers) plus settings.system_settings.

Sales (11): ar_ledger, sales, sale_items, customer_payments,
customer_payment_applied, sales_returns, sales_return_items, supplier_returns,
supplier_return_items, credit_memos, credit_memo_redemptions.
Settings (1): system_settings.

Standard recipe per table: tenant_id NULLABLE FK -> backfill to Default (by slug)
-> NOT NULL -> GUC server_default -> ENABLE + FORCE RLS + tenant_isolation policy.

LANDMINES handled here (see step report):

* settings.system_settings — PK RESTRUCTURE. Its PK is `key` itself (no surrogate
  id), so it becomes a COMPOSITE PRIMARY KEY (tenant_id, key). This is a genuine
  PK change, done below in a clearly separated block.

* sales.sale_pid — PARTIAL unique index, not a plain constraint. The original
  `sales_sale_pid_active_key ON sales(sale_pid) WHERE status <> 'Voided'` exists
  so a voided sale's PID becomes reusable. tenant_id goes INTO that partial index
  (drop + recreate as (tenant_id, sale_pid) WHERE status <> 'Voided'), NOT a plain
  composite constraint — converting it would break PID reuse on void.

* Global uniques -> composite (tenant_id, value): sales.idempotency_key,
  customer_payments.idempotency_key, sales_returns.return_pid,
  sales_returns.idempotency_key, supplier_returns.return_pid, credit_memos.code.
  (idempotency keys are client-generated randoms; scoped for consistency.)
  sale_items' (sale_id, variant_id, cost_layer_id) unique is left as-is — already
  tenant-implicit via its FKs.

* Indexes: ar_ledger is append-only/unbounded (ledger treatment); sales and
  sale_items are the highest-growth tables. See CREATE INDEX block.

Revision ID: q2b3c4d5e6f7
Revises: p1a2b3c4d5e6
Create Date: 2026-07-14
"""
from alembic import op

revision = 'q2b3c4d5e6f7'
down_revision = 'p1a2b3c4d5e6'
branch_labels = None
depends_on = None

# add tenant_id + backfill + NOT NULL + default + RLS on each (schema, table)
TABLES = [
    ("sales", "ar_ledger"),
    ("sales", "sales"),
    ("sales", "sale_items"),
    ("sales", "customer_payments"),
    ("sales", "customer_payment_applied"),
    ("sales", "sales_returns"),
    ("sales", "sales_return_items"),
    ("sales", "supplier_returns"),
    ("sales", "supplier_return_items"),
    ("sales", "credit_memos"),
    ("sales", "credit_memo_redemptions"),
    ("settings", "system_settings"),
]

# (schema, table, old_global_unique, column, new_composite_name)
UNIQUES = [
    ("sales", "sales",             "sales_idempotency_key_key",             "idempotency_key", "uq_sales_tenant_idem"),
    ("sales", "customer_payments", "customer_payments_idempotency_key_key", "idempotency_key", "uq_cust_payments_tenant_idem"),
    ("sales", "sales_returns",     "sales_returns_return_pid_key",          "return_pid",      "uq_sales_returns_tenant_pid"),
    ("sales", "sales_returns",     "sales_returns_idempotency_key_key",     "idempotency_key", "uq_sales_returns_tenant_idem"),
    ("sales", "supplier_returns",  "supplier_returns_return_pid_key",       "return_pid",      "uq_supplier_returns_tenant_pid"),
    ("sales", "credit_memos",      "credit_memos_code_key",                 "code",            "uq_credit_memos_tenant_code"),
]

_DEFAULT   = "current_setting('app.tenant_id', true)::integer"
_PREDICATE = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    # 1-3. Add tenant_id, backfill, NOT NULL.
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

    # ── settings.system_settings: PK RESTRUCTURE (key -> composite (tenant_id, key)) ──
    op.execute("ALTER TABLE settings.system_settings DROP CONSTRAINT system_settings_pkey;")
    op.execute("ALTER TABLE settings.system_settings ADD PRIMARY KEY (tenant_id, key);")

    # 4. GUC-backed default.
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} ALTER COLUMN tenant_id SET DEFAULT {_DEFAULT};")

    # 5. Plain global uniques -> per-tenant composites.
    for s, t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE {s}.{t} DROP CONSTRAINT {old};")
        op.execute(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {new} UNIQUE (tenant_id, {col});")

    # 5b. sale_pid PARTIAL unique index -> (tenant_id, sale_pid), still partial so a
    #     voided sale's PID stays reusable.
    op.execute("DROP INDEX sales.sales_sale_pid_active_key;")
    op.execute("CREATE UNIQUE INDEX sales_sale_pid_active_key ON sales.sales "
               "(tenant_id, sale_pid) WHERE status <> 'Voided'::sales.sale_status;")

    # 6. Indexes: ar_ledger (append-only), sales + sale_items (highest growth).
    op.execute("CREATE INDEX ix_ar_ledger_tenant_customer ON sales.ar_ledger (tenant_id, customer_id);")
    op.execute("CREATE INDEX ix_ar_ledger_tenant_occurred ON sales.ar_ledger (tenant_id, occurred_at);")
    op.execute("CREATE INDEX ix_sales_tenant_txndate  ON sales.sales (tenant_id, transaction_date);")
    op.execute("CREATE INDEX ix_sales_tenant_customer ON sales.sales (tenant_id, customer_id);")
    op.execute("CREATE INDEX ix_sale_items_tenant_variant ON sales.sale_items (tenant_id, variant_id);")

    # 7. Enable + force RLS with the tenant_isolation policy.
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
    for ix in ("ix_ar_ledger_tenant_customer", "ix_ar_ledger_tenant_occurred",
               "ix_sales_tenant_txndate", "ix_sales_tenant_customer", "ix_sale_items_tenant_variant"):
        op.execute(f"DROP INDEX IF EXISTS sales.{ix};")
    op.execute("DROP INDEX IF EXISTS sales.sales_sale_pid_active_key;")
    op.execute("CREATE UNIQUE INDEX sales_sale_pid_active_key ON sales.sales "
               "(sale_pid) WHERE status <> 'Voided'::sales.sale_status;")
    for s, t, old, col, new in UNIQUES:
        op.execute(f"ALTER TABLE {s}.{t} DROP CONSTRAINT {new};")
        op.execute(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {old} UNIQUE ({col});")
    op.execute("ALTER TABLE settings.system_settings DROP CONSTRAINT system_settings_pkey;")
    op.execute("ALTER TABLE settings.system_settings ADD PRIMARY KEY (key);")
    for s, t in TABLES:
        op.execute(f"ALTER TABLE {s}.{t} DROP COLUMN tenant_id;")
