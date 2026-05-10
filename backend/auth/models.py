from sqlalchemy import Column, Integer, String, Boolean
from core.database import Base

class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "auth"} # New schema for the whole ERP

    user_id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), default='WAREHOUSE_STAFF')
    is_active = Column(Boolean, default=True)