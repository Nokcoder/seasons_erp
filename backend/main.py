# main.py
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from sqlalchemy import text

from core.database import engine, Base

load_dotenv()

# --- IMPORT ROUTERS ---
from inventory.router import router as inventory_router
from inventory.transfers_router import router as transfers_router
from auth import router as auth_router
from procurement.router import router as procurement_router
from ap.router import router as ap_router
from sales.router import router as sales_router
from settings.router import router as settings_router
from import_hub.router import router as import_router

# --- IMPORT ALL MODELS ---
# CRITICAL: Every model module must be imported before create_all() so
# SQLAlchemy knows about every table. Import order matters for FK resolution:
#   auth → inventory → procurement → ap → sales → settings
from auth import models as auth_models
from inventory import models as inventory_models
from procurement import models as procurement_models
from ap import models as ap_models
from sales import models as sales_models  # noqa: F401
from settings import models as settings_models  # noqa: F401

# --- CREATE SCHEMAS ---
with engine.connect() as conn:
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS inventory"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS procurement"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS ap"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS sales"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS settings"))
    conn.commit()

# --- CREATE TABLES ---
Base.metadata.create_all(bind=engine)


# --- SEED SYSTEM LOCATIONS ---
def _seed_system_locations():
    """Idempotently create the Quarantine and Adjustment virtual locations."""
    from core.database import SessionLocal
    from inventory.models import Location

    SYSTEM_LOCATIONS = [
        {"location_name": "Quarantine",  "location_type": "Virtual"},
        {"location_name": "Adjustment",  "location_type": "Virtual"},
    ]
    db = SessionLocal()
    try:
        for spec in SYSTEM_LOCATIONS:
            exists = db.query(Location).filter(
                Location.location_name == spec["location_name"]
            ).first()
            if not exists:
                db.add(Location(
                    location_name=spec["location_name"],
                    location_type=spec["location_type"],
                    status="Active",
                    is_system=True,
                ))
        db.commit()
    finally:
        db.close()

_seed_system_locations()


def _seed_system_settings():
    """Idempotently insert default system_settings rows."""
    from core.database import SessionLocal
    from settings.models import SystemSetting

    DEFAULTS = [
        ("allow_negative_stock", "false"),
    ]
    db = SessionLocal()
    try:
        for key, value in DEFAULTS:
            if not db.query(SystemSetting).filter_by(key=key).first():
                db.add(SystemSetting(key=key, value=value))
        db.commit()
    finally:
        db.close()

_seed_system_settings()


def _seed_store_credit():
    """Idempotently create the Store Credit payment mode."""
    from core.database import SessionLocal
    from sales.models import PaymentMode
    db = SessionLocal()
    try:
        if not db.query(PaymentMode).filter_by(name="Store Credit").first():
            db.add(PaymentMode(name="Store Credit", is_physical=False, is_active=True))
            db.commit()
    finally:
        db.close()

_seed_store_credit()


def _seed_payment_mode_flags():
    """Idempotently set is_pdc and is_cash flags on known payment modes.

    Identifies modes by name match.  If a name is not found, silently skips
    (the mode may not exist in all environments).  Safe to run on every startup.
    """
    from core.database import SessionLocal
    from sales.models import PaymentMode

    UPDATES = [
        ("Post Dated Check", {"is_pdc": True,  "is_physical": True}),
        ("Cash",             {"is_cash": True, "is_physical": True}),
        ("On Date Check",    {"is_pdc": False, "is_physical": True}),
    ]
    db = SessionLocal()
    try:
        for name, flags in UPDATES:
            mode = db.query(PaymentMode).filter_by(name=name).first()
            if not mode:
                continue
            for attr, val in flags.items():
                setattr(mode, attr, val)
        db.commit()
    finally:
        db.close()

_seed_payment_mode_flags()


def _seed_admin_user():
    """Idempotently create the initial ADMIN user from INIT_ADMIN_* env vars."""
    username = os.getenv("INIT_ADMIN_USERNAME")
    password = os.getenv("INIT_ADMIN_PASSWORD")
    if not username or not password:
        return

    from core.database import SessionLocal
    from auth.models import Employee, User, Role
    from passlib.context import CryptContext

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            return
        employee = Employee(first_name="Admin", last_name="User")
        db.add(employee)
        db.flush()
        user = User(
            employee_id=employee.employee_id,
            username=username,
            password_hash=CryptContext(schemes=["bcrypt"], deprecated="auto").hash(password),
        )
        db.add(user)
        db.flush()
        role = db.query(Role).filter(Role.role_name == "ADMIN").first()
        if not role:
            role = Role(role_name="ADMIN")
            db.add(role)
            db.flush()
        user.roles.append(role)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

_seed_admin_user()


def _seed_rbac():
    """Idempotently seed programs, actions, and default role-permission assignments.

    All inserts use ON CONFLICT DO NOTHING so this is safe to run on every startup.
    Role rows are created if absent (covers environments where the default roles
    were never manually created).
    """
    from core.database import SessionLocal
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
            ("cashiering_mode",        "Cashiering Mode",          "sales_workstation"),
            ("view_sales_ledger",      "View Sales Ledger",        "sales_ledger"),
            ("export_sales",           "Export Sales",             "sales_ledger"),
            ("view_returns",           "View Returns",             "sales_returns"),
            ("export_returns",         "Export Returns",           "sales_returns"),
            # Inventory
            ("view_inventory",         "View Inventory",           "inventory_catalogue"),
            ("manage_products",        "Manage Products",          "inventory_catalogue"),
            ("export_products",        "Export Products",          "inventory_catalogue"),
            ("import_products",        "Import Products",          "inventory_catalogue"),
            # Stock
            ("view_transfers",         "View Transfers",           "stock_transfers"),
            ("create_transfer",        "Create Transfer",          "stock_transfers"),
            ("edit_transfer_header",   "Edit Transfer Header",     "stock_transfers"),
            ("receive_transfer",       "Receive Transfer",         "stock_transfers"),
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
            ("manage_sales_settings",  "Manage Sales Settings",    "settings"),
        ]
        for ak, dn, pk in ACTIONS:
            db.execute(text("""
                INSERT INTO auth.actions (action_key, display_name, program_id)
                SELECT :ak, :dn, p.program_id
                FROM auth.programs p
                WHERE p.program_key = :pk
                ON CONFLICT (action_key) DO NOTHING
            """), {"ak": ak, "dn": dn, "pk": pk})

        db.flush()

        # ── Default roles (create if absent) ─────────────────────────────────────
        DEFAULT_ROLES = [
            "ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF",
            "ACCOUNTANT", "STORE_MANAGER", "CASHIER",
        ]
        for rn in DEFAULT_ROLES:
            db.execute(text("""
                INSERT INTO auth.roles (role_name)
                VALUES (:rn)
                ON CONFLICT (role_name) DO NOTHING
            """), {"rn": rn})

        db.flush()

        # ── Helper: grant programs/actions by role_name ───────────────────────────
        def _grant_programs(role_name: str, program_keys: list[str]):
            for pk in program_keys:
                db.execute(text("""
                    INSERT INTO auth.role_programs (role_id, program_id)
                    SELECT r.role_id, p.program_id
                    FROM auth.roles r, auth.programs p
                    WHERE r.role_name = :rn AND p.program_key = :pk
                    ON CONFLICT DO NOTHING
                """), {"rn": role_name, "pk": pk})

        def _grant_actions(role_name: str, action_keys: list[str]):
            for ak in action_keys:
                db.execute(text("""
                    INSERT INTO auth.role_actions (role_id, action_id)
                    SELECT r.role_id, a.action_id
                    FROM auth.roles r, auth.actions a
                    WHERE r.role_name = :rn AND a.action_key = :ak
                    ON CONFLICT DO NOTHING
                """), {"rn": role_name, "ak": ak})

        # ── ADMIN: all programs, all actions ──────────────────────────────────────
        db.execute(text("""
            INSERT INTO auth.role_programs (role_id, program_id)
            SELECT r.role_id, p.program_id
            FROM auth.roles r, auth.programs p
            WHERE r.role_name = 'ADMIN'
            ON CONFLICT DO NOTHING
        """))
        db.execute(text("""
            INSERT INTO auth.role_actions (role_id, action_id)
            SELECT r.role_id, a.action_id
            FROM auth.roles r, auth.actions a
            WHERE r.role_name = 'ADMIN'
            ON CONFLICT DO NOTHING
        """))

        # ── WAREHOUSE_MANAGER ─────────────────────────────────────────────────────
        _grant_programs("WAREHOUSE_MANAGER", [
            "inventory_catalogue", "stock_transfers", "stock_receiving",
            "stock_ledger", "procurement_suppliers",
            "procurement_purchase_orders", "settings",
        ])
        _grant_actions("WAREHOUSE_MANAGER", [
            "view_inventory", "manage_products", "export_products", "import_products",
            "view_transfers", "create_transfer", "edit_transfer_header", "receive_transfer",
            "view_receiving", "create_shipment", "confirm_shipment",
            "view_stock_ledger", "export_stock_ledger",
            "view_suppliers", "manage_suppliers",
            "view_purchase_orders", "manage_purchase_orders",
            "manage_locations", "manage_inventory_policy",
        ])

        # ── WAREHOUSE_STAFF ───────────────────────────────────────────────────────
        _grant_programs("WAREHOUSE_STAFF", [
            "stock_transfers", "stock_receiving", "stock_ledger",
        ])
        _grant_actions("WAREHOUSE_STAFF", [
            "view_transfers", "create_transfer", "receive_transfer",
            "view_receiving", "view_stock_ledger",
        ])

        # ── ACCOUNTANT ────────────────────────────────────────────────────────────
        _grant_programs("ACCOUNTANT", [
            "inventory_catalogue", "ap_invoices", "ap_payments",
            "ap_ledger", "ap_aging",
        ])
        _grant_actions("ACCOUNTANT", [
            "view_inventory",
            "view_invoices", "manage_invoices",
            "view_ap_payments", "manage_payments",
            "view_ap_ledger", "export_ap_ledger",
            "view_ap_aging", "export_ap_aging",
        ])

        # ── STORE_MANAGER ─────────────────────────────────────────────────────────
        _grant_programs("STORE_MANAGER", [
            "sales_workstation", "sales_ledger", "sales_returns",
            "inventory_catalogue", "stock_ledger", "customers_list",
            "customers_aging", "customers_ar_ledger",
            "customers_credit_memo", "customers_pdc_vault", "settings",
        ])
        _grant_actions("STORE_MANAGER", [
            "process_sale", "process_returns", "process_blind_returns", "apply_discount",
            "view_sales_ledger", "export_sales",
            "view_returns", "export_returns",
            "view_inventory",
            "view_stock_ledger",
            "view_customers", "manage_customers",
            "view_customer_aging", "export_customer_aging",
            "view_ar_ledger", "export_ar_ledger",
            "view_credit_memos", "issue_credit_memo", "cancel_credit_memo",
            "view_pdc_vault", "manage_pdc",
            "manage_users", "manage_roles", "manage_shifts",
            "manage_registers", "manage_payment_modes",
            "manage_sales_settings", "manage_inventory_policy",
        ])

        # ── CASHIER ───────────────────────────────────────────────────────────────
        _grant_programs("CASHIER", ["sales_workstation"])
        _grant_actions("CASHIER", ["process_sale", "process_returns"])

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

_seed_rbac()


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
app.include_router(import_router)


@app.get("/")
def health_check():
    return {
        "status": "Season ERP API is online.",
        "cors_mode": "Dynamic" if raw_origins else "Wildcard Fallback",
    }
