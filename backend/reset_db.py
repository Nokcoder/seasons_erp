"""
reset_db.py — one-time database reset script.

Drops all custom schemas with CASCADE, then recreates every table from
the current SQLAlchemy models.  Run via Docker:

    docker-compose run --rm backend python reset_db.py

Safe to run when there is no data to preserve.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv()

# ── 1. bootstrap DB connection ────────────────────────────────────────────────
from core.database import engine, Base

# ── 2. import ALL models so Base.metadata is fully populated ─────────────────
#    Order: auth → inventory → procurement → ap
import auth.models          # noqa: F401  (Employee, User, Role, …)
import inventory.models     # noqa: F401  (Product, Variant, Location, …)
import procurement.models   # noqa: F401  (PurchaseOrder, InventoryShipment, …)
import ap.models            # noqa: F401  (SupplierInvoice, ApLedger, …)

# ── 3. drop then recreate all custom schemas ──────────────────────────────────
SCHEMAS = ["ap", "procurement", "inventory", "auth", "sales", "settings"]

print("Dropping schemas …")
with engine.connect() as conn:
    for schema in SCHEMAS:
        conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
        print(f"  dropped: {schema}")
    conn.commit()

print("Recreating schemas …")
with engine.connect() as conn:
    for schema in ["auth", "inventory", "procurement", "ap"]:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))
        print(f"  created: {schema}")
    conn.commit()

# ── 4. create all tables from current models ──────────────────────────────────
print("Running Base.metadata.create_all() …")
Base.metadata.create_all(bind=engine)
print("  all tables created.")

# ── 5. stamp alembic to head so it does not try to run stale migrations ───────
print("Stamping alembic to head …")
import subprocess, sys
result = subprocess.run(
    [sys.executable, "-m", "alembic", "stamp", "head"],
    capture_output=True, text=True,
)
print(result.stdout.strip() or "(no output)")
if result.returncode != 0:
    print("WARNING: alembic stamp failed (non-fatal if alembic_version is absent):")
    print(result.stderr.strip())

print("\n✓ Database reset complete.")
