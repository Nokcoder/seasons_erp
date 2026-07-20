import os
import jwt
from urllib.parse import quote_plus
from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load the variables from .env into the system environment
load_dotenv()

# Extract variables with fallbacks for safety
db_user = os.getenv("DB_USER")
db_password = os.getenv("DB_PASSWORD")
db_host = os.getenv("DB_HOST", "db")   # <--- Added 'db' as the default Docker fallback
db_port = os.getenv("DB_PORT", "5432")
db_name = os.getenv("DB_NAME")

# Safely URL-encode the password to handle special characters
safe_password = quote_plus(db_password) if db_password else ""

# ── Admin connection (erp_admin) ──────────────────────────────────────────────
# Superuser/owner/migrator. Used by Alembic (via DATABASE_URL) and by the
# bootstrap path — boot seeds, schema/table DDL, and signup — i.e. everything
# that runs OUTSIDE a tenant request context. This is the seam that will bypass
# RLS once policies land in a later step.
DATABASE_URL = f"postgresql+psycopg2://{db_user}:{safe_password}@{db_host}:{db_port}/{db_name}"

# ── App connection (erp_app) ──────────────────────────────────────────────────
# Non-superuser, NOBYPASSRLS role that the normal request path connects as
# (get_db). The role and its grants are created by migration a7b8c9d0e1f2.
app_db_user     = os.getenv("APP_DB_USER", "erp_app")
app_db_password = os.getenv("APP_DB_PASSWORD")
safe_app_password = quote_plus(app_db_password) if app_db_password else ""
APP_DATABASE_URL = f"postgresql+psycopg2://{app_db_user}:{safe_app_password}@{db_host}:{db_port}/{db_name}"

# The default `engine`/`SessionLocal` are the APP (erp_app) connection — this is
# what get_db() and all request-path code use.
engine = create_engine(APP_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Admin engine/session for the bootstrap path only (see get_admin_db).
admin_engine = create_engine(DATABASE_URL)
AdminSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=admin_engine)

Base = declarative_base()

# ── Tenant context plumbing (Phase 2 step 2) ─────────────────────────────────
# SECRET_KEY read from env (not imported from auth.dependencies) to avoid a
# circular import: auth.dependencies imports get_db from here.
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"


def _tenant_id_from_request(request: Request):
    """Return the verified tenant_id from the request's Bearer JWT, or None.

    Never raises: an unauthenticated / malformed / expired token simply yields
    None, so the request runs with NO tenant context set. Once RLS lands, unset
    context means zero rows (fail closed). Authentication *enforcement* is
    get_current_user's job — this only extracts context for the ones that have it.
    """
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header[:7].lower() == "bearer " else ""
    if not token or not SECRET_KEY:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        tid = payload.get("tenant_id")
        return int(tid) if tid is not None else None
    except Exception:
        return None


@event.listens_for(SessionLocal, "after_begin")
def _apply_tenant_context(session, transaction, connection):
    """Re-assert the tenant GUC at the start of EVERY transaction on an app
    (erp_app) session.

    ── DO NOT change SET LOCAL to a session-level SET. ──
    SET LOCAL is scoped to the current transaction: it is wiped when the
    transaction ends, and again by the connection pool's reset-on-return
    ROLLBACK. A plain (session-level) SET would SURVIVE the connection's return
    to the pool and leak one request's tenant into the next request that reuses
    that pooled connection — the catastrophic cross-tenant data breach this
    entire step exists to prevent.

    Re-applied on every after_begin rather than once in get_db because a single
    request may commit several times; each commit ends the transaction and
    clears SET LOCAL, so the following transaction would otherwise run unscoped.

    Only fires when the session carries a tenant_id in .info — i.e. a get_db
    (erp_app) request with a valid token. get_admin_db (erp_admin) never sets
    .info, so the bypass seam is untouched; unauthenticated requests set nothing.
    """
    tid = session.info.get("tenant_id")
    if tid is not None:
        # int() guarantees no injection; this is the transaction-scoped SET LOCAL.
        connection.exec_driver_sql(f"SET LOCAL app.tenant_id = {int(tid)}")


def get_db(request: Request):
    db = SessionLocal()
    tid = _tenant_id_from_request(request)
    if tid is not None:
        # Read by the after_begin listener above on every transaction this
        # session opens. Absent for unauthenticated requests → no context set.
        db.info["tenant_id"] = tid
    try:
        yield db
    finally:
        db.close()

def get_admin_db():
    """erp_admin session for administrative paths that run outside a tenant
    request context (currently: signup). Deliberately uses the owner role so it
    is unaffected by the app-role restrictions — and, once RLS lands, bypasses
    tenant policies. Do NOT use this for ordinary request handlers."""
    db = AdminSessionLocal()
    try:
        yield db
    finally:
        db.close()
