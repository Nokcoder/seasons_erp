# tenancy/router.py
import os

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from core.database import get_admin_db
from tenancy import schemas
from tenancy.models import Tenant
from tenancy.validation import validate_slug
from tenancy.rbac_seed import seed_roles_for_tenant, seed_defaults_for_tenant
from auth import models as auth_models
# Reuse the exact CryptContext the login path verifies against, so signup and
# login can never drift on hashing scheme/params.
from auth.router import pwd_context

router = APIRouter(prefix="/platform", tags=["Platform"])


def _require_platform_key(x_platform_key: str | None = Header(default=None)):
    """Shared-secret gate on tenant creation. This is NOT user authentication —
    it's a deliberate lock so tenants can only be created by an operator holding
    PLATFORM_SIGNUP_KEY, since we onboard tenants manually rather than offering
    public self-serve signup. When an internal admin UI is built, this gate is
    swapped for that UI's auth. Read at request time (not import) so it can't be
    defeated by import ordering. Fails closed: if PLATFORM_SIGNUP_KEY is unset,
    every request is rejected.
    """
    expected = os.getenv("PLATFORM_SIGNUP_KEY")
    if not expected or x_platform_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing platform key")


@router.post("/signup", response_model=schemas.SignupResponse, status_code=201)
def signup(
    payload: schemas.SignupRequest,
    db: Session = Depends(get_admin_db),
    _key: None = Depends(_require_platform_key),
):
    """Operator-gated tenant creation (X-Platform-Key header, see _require_platform_key).

    Creates a tenant, its default roles + grants, and its first admin user, all
    in one transaction — any failure rolls the whole thing back, so a failed
    signup never leaves an orphan tenant or orphan roles behind.

    Returns the tenant identity only, NOT a JWT: the client then logs in via
    POST /auth/login with {org_slug: slug, username, password}. This keeps token
    issuance on a single code path (auth.router._make_token, which also stamps
    last_login_at and writes the login_attempts row) rather than duplicating that
    logic here where it would inevitably drift.
    """
    # 1. Validate slug format + reserved words (application-layer, not just DB).
    try:
        slug = validate_slug(payload.slug)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Uniqueness pre-check for a clean 409; the DB UNIQUE(slug) is the backstop
    # against a concurrent race (handled by the IntegrityError catch below).
    if db.query(Tenant).filter(Tenant.slug == slug).first():
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' is already taken")

    # 2. Atomic creation — single transaction, single commit at the end.
    try:
        tenant = Tenant(name=payload.business_name, slug=slug)
        db.add(tenant)
        db.flush()  # assigns tenant_id

        # 6 default roles + their program/action grants, scoped to this tenant.
        seed_roles_for_tenant(tenant.tenant_id, db)
        # This tenant's own Quarantine/Adjustment locations + Store Credit mode.
        seed_defaults_for_tenant(tenant.tenant_id, db)

        employee = auth_models.Employee(
            tenant_id=tenant.tenant_id,
            first_name="Admin",
            last_name="User",
        )
        db.add(employee)
        db.flush()

        user = auth_models.User(
            tenant_id=tenant.tenant_id,
            employee_id=employee.employee_id,
            username=payload.admin_username,
            password_hash=pwd_context.hash(payload.admin_password),
        )
        db.add(user)
        db.flush()

        # Resolve the ADMIN role scoped to THIS tenant — never by bare role_name.
        admin_role = db.query(auth_models.Role).filter(
            auth_models.Role.tenant_id == tenant.tenant_id,
            auth_models.Role.role_name == "ADMIN",
        ).first()
        if not admin_role:
            # seed_roles_for_tenant guarantees this exists; defensive only.
            raise HTTPException(
                status_code=500,
                detail="ADMIN role missing after seeding",
            )
        user.roles.append(admin_role)

        db.commit()
    except IntegrityError:
        # Concurrent signup won the slug between the pre-check and commit.
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' is already taken")
    except Exception:
        db.rollback()
        raise

    return schemas.SignupResponse(
        tenant_id=tenant.tenant_id,
        business_name=tenant.name,
        slug=tenant.slug,
        admin_username=user.username,
    )
