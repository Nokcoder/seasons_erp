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

# --- IMPORT ALL MODELS ---
# CRITICAL: Every model module must be imported before create_all() so
# SQLAlchemy knows about every table. Import order matters for FK resolution:
#   auth → inventory → procurement → ap
from auth import models as auth_models
from inventory import models as inventory_models
from procurement import models as procurement_models
from ap import models as ap_models

# --- CREATE SCHEMAS ---
with engine.connect() as conn:
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS inventory"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS procurement"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS ap"))
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


@app.get("/")
def health_check():
    return {
        "status": "Season ERP API is online.",
        "cors_mode": "Dynamic" if raw_origins else "Wildcard Fallback",
    }
