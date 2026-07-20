# settings/models.py
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime
from sqlalchemy.sql import text
from core.database import Base
from sqlalchemy.orm import relationship


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
