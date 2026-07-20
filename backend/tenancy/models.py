# tenancy/models.py
#
# Lives in a package named "tenancy" rather than "platform" to avoid shadowing
# Python's stdlib `platform` module — the backend container's sys.path has the
# working directory ('') before the stdlib paths, so a top-level `platform/`
# package here would hijack `import platform` for the whole app, including
# third-party dependencies. The Postgres schema itself is still named
# `platform`, as specified.
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = {"schema": "platform"}

    tenant_id  = Column(Integer, primary_key=True)
    name       = Column(String, nullable=False)
    slug       = Column(String, unique=True, nullable=False)
    is_active  = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PlatformOwner(Base):
    """Identity that sits ABOVE tenants — belongs to no tenant and (once Track B
    lands) can act across all of them: list/deactivate tenants, handle failed
    payments. Deliberately separate from auth.users (which is tenant-scoped and
    RLS'd) so cross-tenant capability never requires a hole in the tenant user
    model. This table has NO tenant_id and NO RLS; it is reached only on the
    erp_admin (BYPASSRLS) connection, never the tenant request path — and erp_app
    is explicitly revoked from it (migration dd44ee55ff66).

    Schema/identity only at this stage. The login endpoint and admin API that use
    it are Track B (blocked on Track A) and not yet built."""
    __tablename__ = "platform_owners"
    __table_args__ = {"schema": "platform"}

    owner_id      = Column(Integer, primary_key=True)
    email         = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name     = Column(String(255), nullable=True)
    is_active     = Column(Boolean, nullable=False, default=True, server_default="true")
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at    = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class DocumentSequence(Base):
    """Per-tenant, per-doc-type monotonic counter for generated document PIDs
    (SALE, RET, SRET, PO, SHP, TRF). next_number = the next value to assign.
    Incremented atomically via INSERT..ON CONFLICT DO UPDATE..RETURNING (see
    core/doc_sequence.py) so concurrent callers in the same tenant serialize on
    the row lock and never collide. RLS policy is migration-only."""
    __tablename__ = "document_sequences"
    __table_args__ = {"schema": "platform"}

    tenant_id   = Column(Integer, ForeignKey("platform.tenants.tenant_id"), primary_key=True)
    doc_type    = Column(String, primary_key=True)
    next_number = Column(Integer, nullable=False)
