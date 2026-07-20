# tenancy/rbac_seed.py
"""Per-tenant RBAC seeding.

auth.programs and auth.actions are a global feature catalog, seeded once at
boot (see main.py's _seed_programs_and_actions()). auth.roles became
per-tenant in migration y5z6a7b8c9d0 — every tenant gets its own copies of
the 6 default roles and the same starting grants, so each can be customized
independently afterward.

seed_roles_for_tenant() is meant to be called once per tenant at
tenant-creation time (the platform signup flow), not at container boot —
role seeding is a per-tenant lifecycle event, not a global one.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

DEFAULT_ROLES = [
    "ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF",
    "ACCOUNTANT", "STORE_MANAGER", "CASHIER",
]


def _grant_programs(db: Session, tenant_id: int, role_name: str, program_keys: list[str]):
    for pk in program_keys:
        db.execute(text("""
            INSERT INTO auth.role_programs (role_id, program_id)
            SELECT r.role_id, p.program_id
            FROM auth.roles r, auth.programs p
            WHERE r.tenant_id = :tid AND r.role_name = :rn AND p.program_key = :pk
            ON CONFLICT DO NOTHING
        """), {"tid": tenant_id, "rn": role_name, "pk": pk})


def _grant_actions(db: Session, tenant_id: int, role_name: str, action_keys: list[str]):
    for ak in action_keys:
        db.execute(text("""
            INSERT INTO auth.role_actions (role_id, action_id)
            SELECT r.role_id, a.action_id
            FROM auth.roles r, auth.actions a
            WHERE r.tenant_id = :tid AND r.role_name = :rn AND a.action_key = :ak
            ON CONFLICT DO NOTHING
        """), {"tid": tenant_id, "rn": role_name, "ak": ak})


def seed_roles_for_tenant(tenant_id: int, db: Session) -> None:
    """Idempotently create the 6 default roles for `tenant_id` and apply the
    standard starting role -> program/action grants. Safe to call more than
    once for the same tenant without duplicating rows.
    """
    for rn in DEFAULT_ROLES:
        db.execute(text("""
            INSERT INTO auth.roles (tenant_id, role_name)
            VALUES (:tid, :rn)
            ON CONFLICT (tenant_id, role_name) DO NOTHING
        """), {"tid": tenant_id, "rn": rn})
    db.flush()

    # ── ADMIN: all programs, all actions ──────────────────────────────────
    db.execute(text("""
        INSERT INTO auth.role_programs (role_id, program_id)
        SELECT r.role_id, p.program_id
        FROM auth.roles r, auth.programs p
        WHERE r.tenant_id = :tid AND r.role_name = 'ADMIN'
        ON CONFLICT DO NOTHING
    """), {"tid": tenant_id})
    db.execute(text("""
        INSERT INTO auth.role_actions (role_id, action_id)
        SELECT r.role_id, a.action_id
        FROM auth.roles r, auth.actions a
        WHERE r.tenant_id = :tid AND r.role_name = 'ADMIN'
        ON CONFLICT DO NOTHING
    """), {"tid": tenant_id})

    # ── WAREHOUSE_MANAGER ───────────────────────────────────────────────────
    _grant_programs(db, tenant_id, "WAREHOUSE_MANAGER", [
        "inventory_catalogue", "stock_transfers", "stock_receiving",
        "stock_ledger", "procurement_suppliers",
        "procurement_purchase_orders", "settings",
    ])
    _grant_actions(db, tenant_id, "WAREHOUSE_MANAGER", [
        "view_inventory", "manage_products", "export_products", "import_products",
        "view_transfers", "create_transfer", "edit_transfer_header",
        "view_receiving", "create_shipment", "confirm_shipment",
        "view_stock_ledger", "export_stock_ledger",
        "view_suppliers", "manage_suppliers",
        "view_purchase_orders", "manage_purchase_orders",
        "manage_locations", "manage_inventory_policy",
    ])

    # ── WAREHOUSE_STAFF ──────────────────────────────────────────────────────
    _grant_programs(db, tenant_id, "WAREHOUSE_STAFF", [
        "stock_transfers", "stock_receiving", "stock_ledger",
    ])
    _grant_actions(db, tenant_id, "WAREHOUSE_STAFF", [
        "view_transfers", "create_transfer",
        "view_receiving", "view_stock_ledger",
    ])

    # ── ACCOUNTANT ───────────────────────────────────────────────────────────
    _grant_programs(db, tenant_id, "ACCOUNTANT", [
        "inventory_catalogue", "ap_invoices", "ap_payments",
        "ap_ledger", "ap_aging",
    ])
    _grant_actions(db, tenant_id, "ACCOUNTANT", [
        "view_inventory",
        "view_invoices", "manage_invoices",
        "view_ap_payments", "manage_payments",
        "view_ap_ledger", "export_ap_ledger",
        "view_ap_aging", "export_ap_aging",
    ])

    # ── STORE_MANAGER ────────────────────────────────────────────────────────
    _grant_programs(db, tenant_id, "STORE_MANAGER", [
        "sales_workstation", "sales_ledger", "sales_returns",
        "inventory_catalogue", "stock_ledger", "customers_list",
        "customers_aging", "customers_ar_ledger",
        "customers_credit_memo", "customers_pdc_vault", "settings",
    ])
    _grant_actions(db, tenant_id, "STORE_MANAGER", [
        "process_sale", "process_returns", "process_blind_returns", "apply_discount",
        "view_sales_ledger", "export_sales",
        "view_returns", "export_returns",
        "view_inventory",
        "view_stock_ledger",
        "view_customers", "manage_customers", "reverse_customer_payment", "reverse_return",
        "view_customer_aging", "export_customer_aging",
        "view_ar_ledger", "export_ar_ledger",
        "view_credit_memos", "issue_credit_memo", "cancel_credit_memo",
        "view_pdc_vault", "manage_pdc",
        "manage_users", "manage_roles", "manage_shifts",
        "manage_registers", "manage_payment_modes",
        "manage_inventory_policy",
    ])

    # ── CASHIER ──────────────────────────────────────────────────────────────
    _grant_programs(db, tenant_id, "CASHIER", ["sales_workstation"])
    _grant_actions(db, tenant_id, "CASHIER", ["process_sale", "process_returns"])


def seed_defaults_for_tenant(tenant_id: int, db: Session) -> None:
    """Idempotently seed a tenant's own system rows: the Quarantine/Adjustment
    virtual locations and the Store Credit payment mode, plus flag-fixing on any
    of its known payment modes.

    Replaces the old global singleton-by-name seeds (_seed_system_locations,
    _seed_store_credit, _seed_payment_mode_flags), which resolved "the" row by a
    bare name lookup — ambiguous the moment a second tenant exists. Every lookup
    here is scoped to tenant_id. Does not commit; the caller commits.
    """
    from inventory.models import Location
    from sales.models import PaymentMode

    # ── System virtual locations, one pair per tenant ─────────────────────────
    for name in ("Quarantine", "Adjustment"):
        exists = db.query(Location).filter(
            Location.tenant_id == tenant_id,
            Location.location_name == name,
        ).first()
        if not exists:
            db.add(Location(
                tenant_id=tenant_id,
                location_name=name,
                location_type="Virtual",
                status="Active",
                is_system=True,
            ))

    # ── Store Credit payment mode, one per tenant ─────────────────────────────
    if not db.query(PaymentMode).filter(
        PaymentMode.tenant_id == tenant_id,
        PaymentMode.name == "Store Credit",
    ).first():
        db.add(PaymentMode(
            tenant_id=tenant_id, name="Store Credit",
            is_physical=False, is_active=True,
        ))

    db.flush()

    # ── Flag-fix this tenant's known payment modes (no-op if absent) ──────────
    FLAGS = [
        ("Post Dated Check", {"is_pdc": True,  "is_physical": True}),
        ("Cash",             {"is_cash": True, "is_physical": True}),
        ("On Date Check",    {"is_pdc": False, "is_physical": True}),
    ]
    for nm, flags in FLAGS:
        mode = db.query(PaymentMode).filter(
            PaymentMode.tenant_id == tenant_id,
            PaymentMode.name == nm,
        ).first()
        if mode:
            for attr, val in flags.items():
                setattr(mode, attr, val)
    db.flush()

    # ── System settings (per tenant) ──────────────────────────────────────────
    # Only allow_negative_stock is consumed by app code (settings/inventory/sales
    # read it). Kept here as the per-tenant replacement for the old global
    # _seed_system_settings.
    from settings.models import SystemSetting
    if not db.query(SystemSetting).filter(
        SystemSetting.tenant_id == tenant_id,
        SystemSetting.key == "allow_negative_stock",
    ).first():
        db.add(SystemSetting(tenant_id=tenant_id, key="allow_negative_stock", value="false"))
    db.flush()
