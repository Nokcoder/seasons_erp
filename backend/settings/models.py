# settings/models.py
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import text
from core.database import Base
from sqlalchemy.orm import relationship

# Hardened tenant_id server-default: nullif(...) so NULL and '' (post-RESET) both
# resolve to NULL rather than throwing on the ::integer cast.
_TENANT_DEFAULT = text("nullif(current_setting('app.tenant_id', true), '')::integer")


class SystemSetting(Base):
    __tablename__ = "system_settings"
    __table_args__ = {"schema": "settings"}

    # Composite primary key (tenant_id, key): system_settings has no surrogate id,
    # so tenant scoping makes the natural key per-tenant.
    tenant_id           = Column(Integer, ForeignKey("platform.tenants.tenant_id"),
                                 primary_key=True,
                                 server_default=text("current_setting('app.tenant_id', true)::integer"))
    key                 = Column(String, primary_key=True)
    value               = Column(String, nullable=False)
    updated_at          = Column(DateTime(timezone=True), nullable=True)
    updated_by_user_id  = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)

    updated_by = relationship("User", foreign_keys=[updated_by_user_id])


class PrintTemplate(Base):
    """A named print template design (paper size + positioned elements), stored
    server-side and shared across a tenant's terminals. `template` is the whole
    design blob as JSONB; `doc_type` is a plain string so future document types
    need no migration. Soft-deleted via is_deleted (never hard-deleted)."""
    __tablename__ = "print_templates"
    __table_args__ = {"schema": "settings"}

    template_id        = Column(UUID(as_uuid=True), primary_key=True,
                                server_default=text("gen_random_uuid()"))
    tenant_id          = Column(Integer, ForeignKey("platform.tenants.tenant_id"),
                                nullable=False, server_default=_TENANT_DEFAULT)
    name               = Column(String, nullable=False)
    doc_type           = Column(String, nullable=False)
    template           = Column(JSONB, nullable=False)
    created_at         = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at         = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    created_by_user_id = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    is_deleted         = Column(Boolean, nullable=False, server_default=text("false"))


class PrintFunctionAssignment(Base):
    """Which template is bound to a named function (e.g. 'salesReceipt') for a
    tenant. One row per (tenant, function_key)."""
    __tablename__ = "print_function_assignments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "function_key", name="uq_print_fn_assign_tenant_key"),
        {"schema": "settings"},
    )

    assignment_id      = Column(UUID(as_uuid=True), primary_key=True,
                                server_default=text("gen_random_uuid()"))
    tenant_id          = Column(Integer, ForeignKey("platform.tenants.tenant_id"),
                                nullable=False, server_default=_TENANT_DEFAULT)
    function_key       = Column(String, nullable=False)
    template_id        = Column(UUID(as_uuid=True),
                                ForeignKey("settings.print_templates.template_id"), nullable=True)
    updated_at         = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_by_user_id = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
