# main.py
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from sqlalchemy import text

from core.database import engine, admin_engine, Base

load_dotenv()

# --- IMPORT ROUTERS ---
from inventory.router import router as inventory_router
from inventory.transfers_router import router as transfers_router
from auth import router as auth_router
from procurement.router import router as procurement_router
from ap.router import router as ap_router
from sales.router import router as sales_router
from settings.router import router as settings_router
from settings.print_router import router as print_router
from import_hub.router import router as import_router
from tenancy.router import router as platform_router

# --- IMPORT ALL MODELS ---
# CRITICAL: Every model module must be imported before create_all() so
# SQLAlchemy knows about every table. Import order matters for FK resolution:
#   platform → auth → inventory → procurement → ap → sales → settings
from tenancy import models as tenancy_models
from auth import models as auth_models
from inventory import models as inventory_models
from procurement import models as procurement_models
from ap import models as ap_models
from sales import models as sales_models  # noqa: F401
from settings import models as settings_models  # noqa: F401

# --- CREATE SCHEMAS ---
# Boot-time DDL runs as the owner (admin_engine / erp_admin) — the app role
# (erp_app) has no CREATE privilege by design.
with admin_engine.connect() as conn:
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS platform"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS inventory"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS procurement"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS ap"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS sales"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS settings"))
    conn.commit()

# --- CREATE TABLES ---
Base.metadata.create_all(bind=admin_engine)


# --- SEED PER-TENANT DEFAULTS ---
def _seed_tenant_defaults():
    """Ensure every existing tenant has its own default system rows (Quarantine/
    Adjustment locations, Store Credit payment mode, payment-mode flags).

    Replaces the old global singleton-by-name seeds. Idempotent and self-healing:
    it backfills any tenant missing its defaults (e.g. tenants created before this
    seeding existed) and is a no-op for tenants already set up. New tenants get
    theirs at signup via seed_defaults_for_tenant().
    """
    from core.database import AdminSessionLocal as SessionLocal
    from tenancy.rbac_seed import seed_defaults_for_tenant
    from tenancy.models import Tenant

    db = SessionLocal()
    try:
        for (tenant_id,) in db.query(Tenant.tenant_id).all():
            seed_defaults_for_tenant(tenant_id, db)
        db.commit()
    finally:
        db.close()

_seed_tenant_defaults()


def _backfill_pdc_deposit_collection():
    """One-time backfill: correct PDC payments deposited before deposit_pdc_check
    wrote a collection effect (docs/pdc_deposit_collection_proposal.md §4).

    Idempotent and self-limiting, safe to run on every startup: re-derives the
    proposal's four-part filter fresh each run rather than targeting a specific
    payment_id, so it only ever touches a DEPOSITED PDC payment that (a) has no
    existing PAYMENT-reason ArLedger entry yet (predating this backfill or a
    since-fixed deposit both correctly skip), applied to (b) a still-Posted sale
    with (c) balance_due still open. Once a payment is corrected, condition (a)
    permanently excludes it from matching again.
    """
    from decimal import Decimal
    from core.database import AdminSessionLocal as SessionLocal
    from core.audit import write_audit, _serialize
    from sales.models import (
        CustomerPayment, PaymentMode, CustomerPaymentApplied, Sale, Customer, ArLedger,
    )

    db = SessionLocal()
    try:
        candidates = (
            db.query(CustomerPayment)
            .join(PaymentMode, CustomerPayment.payment_mode_id == PaymentMode.payment_mode_id)
            .filter(
                PaymentMode.is_pdc == True,
                CustomerPayment.check_status == "DEPOSITED",
            )
            .all()
        )
        for payment in candidates:
            has_payment_entry = db.query(ArLedger).filter(
                ArLedger.reference_type == "customer_payments",
                ArLedger.reference_id == str(payment.payment_id),
                ArLedger.reason == "PAYMENT",
            ).first()
            if has_payment_entry:
                continue

            applications = db.query(CustomerPaymentApplied).filter(
                CustomerPaymentApplied.payment_id == payment.payment_id,
            ).all()
            qualifying = []
            for apply in applications:
                sale = db.query(Sale).filter(Sale.sale_id == apply.sale_id).first()
                if sale and sale.status == "Posted" and (sale.balance_due or Decimal("0")) > 0:
                    qualifying.append((apply, sale))
            if not qualifying:
                continue

            old_values = _serialize(payment)

            if payment.customer_id:
                db.add(ArLedger(
                    customer_id=payment.customer_id,
                    amount_change=-payment.amount,
                    reason="PAYMENT",
                    reference_type="customer_payments",
                    reference_id=str(payment.payment_id),
                    notes=(
                        "One-time backfill: PDC deposit-collection fix "
                        "(docs/pdc_deposit_collection_proposal.md) applied retroactively "
                        "to a check deposited before the fix shipped."
                    ),
                ))
                customer = db.query(Customer).filter(
                    Customer.customer_id == payment.customer_id
                ).first()
                if customer:
                    customer.outstanding_balance = (
                        (customer.outstanding_balance or Decimal("0")) - payment.amount
                    )

            for apply, sale in qualifying:
                sale.balance_due = max(
                    (sale.balance_due or Decimal("0")) - apply.amount_applied, Decimal("0")
                )
                sale.payment_status = "Paid" if sale.balance_due <= 0 else "Partial"

            write_audit(db, "sales.customer_payments", str(payment.payment_id), "UPDATE",
                        actor_user_id=None,
                        old_values=old_values,
                        new_values=_serialize(payment))
        db.commit()
    finally:
        db.close()

_backfill_pdc_deposit_collection()


def _seed_programs_and_actions():
    """Idempotently seed the global programs/actions feature catalog.

    Unlike roles (per-tenant as of migration y5z6a7b8c9d0), programs and
    actions are shared across all tenants, so this runs unconditionally on
    every startup. Per-tenant role + grant seeding lives in
    tenancy/rbac_seed.py's seed_roles_for_tenant(), called at tenant-creation
    time instead of here.

    All inserts use ON CONFLICT DO NOTHING so this is safe to run on every startup.
    """
    from core.database import AdminSessionLocal as SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # ── Programs ─────────────────────────────────────────────────────────────
        PROGRAMS = [
            # (program_key, display_name, module, sort_order)
            ("sales_workstation",          "POS Workstation",    "Sales",       1),
            ("sales_ledger",               "Sales Ledger",       "Sales",       2),
            ("sales_returns",              "Returns",            "Sales",       3),
            ("inventory_catalogue",        "Product Catalogue",  "Inventory",   1),
            ("stock_transfers",            "Stock Transfers",    "Stock",       1),
            ("stock_receiving",            "Receiving",          "Stock",       2),
            ("stock_ledger",               "Stock Ledger",       "Stock",       3),
            ("procurement_suppliers",      "Suppliers",          "Procurement", 1),
            ("procurement_purchase_orders","Purchase Orders",    "Procurement", 2),
            ("ap_invoices",                "AP Invoices",        "AP",          1),
            ("ap_payments",                "AP Payments",        "AP",          2),
            ("ap_ledger",                  "AP Ledger",          "AP",          3),
            ("ap_aging",                   "Supplier Aging",     "AP",          4),
            ("customers_list",             "Customer List",      "Customers",   1),
            ("customers_aging",            "Customer Aging",     "Customers",   2),
            ("customers_ar_ledger",        "AR Ledger",          "Customers",   3),
            ("customers_credit_memo",      "Credit Memos",       "Customers",   4),
            ("customers_pdc_vault",        "PDC Vault",          "Customers",   5),
            ("settings",                   "Settings",           "Settings",    1),
        ]
        for pk, dn, mod, so in PROGRAMS:
            db.execute(text("""
                INSERT INTO auth.programs (program_key, display_name, module, sort_order)
                VALUES (:pk, :dn, :mod, :so)
                ON CONFLICT (program_key) DO NOTHING
            """), {"pk": pk, "dn": dn, "mod": mod, "so": so})

        db.flush()

        # ── Actions ──────────────────────────────────────────────────────────────
        ACTIONS = [
            # (action_key, display_name, program_key)
            # Sales
            ("process_sale",           "Process Sale",             "sales_workstation"),
            ("process_returns",        "Process Returns",          "sales_workstation"),
            ("process_blind_returns",  "Process Blind Returns",    "sales_workstation"),
            ("apply_discount",         "Apply Discount",           "sales_workstation"),
            ("view_sales_ledger",      "View Sales Ledger",        "sales_ledger"),
            ("export_sales",           "Export Sales",             "sales_ledger"),
            ("view_returns",           "View Returns",             "sales_returns"),
            ("export_returns",         "Export Returns",           "sales_returns"),
            ("reverse_return",         "Reverse Return",           "sales_returns"),
            # Inventory
            ("view_inventory",         "View Inventory",           "inventory_catalogue"),
            ("manage_products",        "Manage Products",          "inventory_catalogue"),
            ("export_products",        "Export Products",          "inventory_catalogue"),
            ("import_products",        "Import Products",          "inventory_catalogue"),
            # Stock
            ("view_transfers",         "View Transfers",           "stock_transfers"),
            ("create_transfer",        "Create Transfer",          "stock_transfers"),
            ("edit_transfer_header",   "Edit Transfer Header",     "stock_transfers"),
            ("view_receiving",         "View Receiving",           "stock_receiving"),
            ("create_shipment",        "Create Shipment",          "stock_receiving"),
            ("confirm_shipment",       "Confirm Shipment",         "stock_receiving"),
            ("view_stock_ledger",      "View Stock Ledger",        "stock_ledger"),
            ("export_stock_ledger",    "Export Stock Ledger",      "stock_ledger"),
            # Procurement
            ("view_suppliers",         "View Suppliers",           "procurement_suppliers"),
            ("manage_suppliers",       "Manage Suppliers",         "procurement_suppliers"),
            ("view_purchase_orders",   "View Purchase Orders",     "procurement_purchase_orders"),
            ("manage_purchase_orders", "Manage Purchase Orders",   "procurement_purchase_orders"),
            # AP
            ("view_invoices",          "View Invoices",            "ap_invoices"),
            ("manage_invoices",        "Manage Invoices",          "ap_invoices"),
            ("view_ap_payments",       "View AP Payments",         "ap_payments"),
            ("manage_payments",        "Manage AP Payments",       "ap_payments"),
            ("view_ap_ledger",         "View AP Ledger",           "ap_ledger"),
            ("export_ap_ledger",       "Export AP Ledger",         "ap_ledger"),
            ("view_ap_aging",          "View Supplier Aging",      "ap_aging"),
            ("export_ap_aging",        "Export Supplier Aging",    "ap_aging"),
            # Customers
            ("view_customers",         "View Customers",           "customers_list"),
            ("manage_customers",       "Manage Customers",         "customers_list"),
            ("reverse_customer_payment","Reverse Customer Payment","customers_list"),
            ("view_customer_aging",    "View Customer Aging",      "customers_aging"),
            ("export_customer_aging",  "Export Customer Aging",    "customers_aging"),
            ("view_ar_ledger",         "View AR Ledger",           "customers_ar_ledger"),
            ("export_ar_ledger",       "Export AR Ledger",         "customers_ar_ledger"),
            ("view_credit_memos",      "View Credit Memos",        "customers_credit_memo"),
            ("issue_credit_memo",      "Issue Credit Memo",        "customers_credit_memo"),
            ("cancel_credit_memo",     "Cancel Credit Memo",       "customers_credit_memo"),
            ("view_pdc_vault",         "View PDC Vault",           "customers_pdc_vault"),
            ("manage_pdc",             "Manage PDC",               "customers_pdc_vault"),
            # Settings
            ("manage_locations",       "Manage Locations",         "settings"),
            ("manage_shifts",          "Manage Shifts",            "settings"),
            ("manage_registers",       "Manage Registers",         "settings"),
            ("manage_payment_modes",   "Manage Payment Modes",     "settings"),
            ("manage_uoms",            "Manage UOMs",              "settings"),
            ("manage_categories",      "Manage Categories",        "settings"),
            ("manage_users",           "Manage Users & Employees", "settings"),
            ("manage_roles",           "Manage Roles & Permissions","settings"),
            ("manage_inventory_policy","Inventory Policy",         "settings"),
            ("manage_import",          "Manage Import",            "settings"),
            ("manage_appearance",      "Manage Appearance",        "settings"),
            ("manage_print_templates", "Manage Print Templates",   "settings"),
        ]
        for ak, dn, pk in ACTIONS:
            db.execute(text("""
                INSERT INTO auth.actions (action_key, display_name, program_id)
                SELECT :ak, :dn, p.program_id
                FROM auth.programs p
                WHERE p.program_key = :pk
                ON CONFLICT (action_key) DO NOTHING
            """), {"ak": ak, "dn": dn, "pk": pk})

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

_seed_programs_and_actions()


app = FastAPI(title="Season ERP")

# --- CORS ---
raw_origins = os.getenv("ALLOWED_ORIGINS")
origins = [o.strip() for o in raw_origins.split(",")] if raw_origins else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ROUTES ---
app.include_router(inventory_router)
app.include_router(transfers_router)
app.include_router(auth_router.router)
app.include_router(procurement_router)
app.include_router(ap_router)
app.include_router(sales_router)
app.include_router(settings_router)
app.include_router(print_router)
app.include_router(import_router)
app.include_router(platform_router)


@app.get("/")
def health_check():
    return {
        "status": "Season ERP API is online.",
        "cors_mode": "Dynamic" if raw_origins else "Wildcard Fallback",
    }
