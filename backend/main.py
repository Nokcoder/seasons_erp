# main.py
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from core.database import engine, Base
from sqlalchemy import text

# Load environment variables from .env
load_dotenv()

# --- IMPORT ROUTERS ---
from inventory.router import router as inventory_router
from inventory.transfers_router import router as transfers_router
from auth import router as auth_router
from procurement.router import router as procurement_router
from sales.router import router as sales_router

# --- IMPORT ALL MODELS ---
# CRITICAL: This tells SQLAlchemy exactly what tables exist before it runs create_all()
from inventory import models as inventory_models
from procurement import models as procurement_models
from auth import models as auth_models    # <-- THE FIX: Tells SQLAlchemy about the 'users' table
from sales import models as sales_models  # <-- THE FIX: Tells SQLAlchemy about the 'sales' tables

# Create the schemas explicitly before building tables
with engine.connect() as conn:
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS inventory"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS procurement"))
    conn.execute(text("CREATE SCHEMA IF NOT EXISTS sales")) # <-- THE FIX: Creates the sales schema
    conn.commit()

# Now SQLAlchemy can safely build the tables and link the foreign keys
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Master ERP")

# --- DYNAMIC CORS CONFIGURATION ---
# Pull the comma-separated string from .env, fallback to wildcard if empty
raw_origins = os.getenv("ALLOWED_ORIGINS")

if raw_origins:
    # Convert "site1.com, site2.com" into ["site1.com", "site2.com"]
    origins = [origin.strip() for origin in raw_origins.split(",")]
else:
    # Fallback to wildcard if .env is not set
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tell the Receptionist where to send the requests
app.include_router(inventory_router)
app.include_router(transfers_router)
app.include_router(auth_router.router)
app.include_router(procurement_router)
app.include_router(sales_router)

@app.get("/")
def health_check():
    return {
        "status": "ERP API is online and ready for requests!",
        "cors_mode": "Dynamic" if raw_origins else "Wildcard Fallback"
    }
