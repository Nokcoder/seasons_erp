# settings/models.py
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from core.database import Base


class SystemSetting(Base):
    __tablename__ = "system_settings"
    __table_args__ = {"schema": "settings"}

    key                 = Column(String, primary_key=True)
    value               = Column(String, nullable=False)
    updated_at          = Column(DateTime(timezone=True), nullable=True)
    updated_by_user_id  = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)

    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
