# auth/models.py
from sqlalchemy import (Column, Integer, BigInteger, String, Boolean,
                         DateTime, ForeignKey, Table, Enum as SAEnum)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


# ==========================================
# 1. EMPLOYEES
# ==========================================
class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = {"schema": "auth"}

    employee_id = Column(Integer, primary_key=True)
    first_name  = Column(String, nullable=False)
    last_name   = Column(String, nullable=False)
    is_active   = Column(Boolean, default=True, nullable=False)

    user = relationship("User", back_populates="employee", uselist=False)


# ==========================================
# 2. USERS
# ==========================================
class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "auth"}

    user_id       = Column(Integer, primary_key=True)
    employee_id   = Column(Integer, ForeignKey("auth.employees.employee_id"), nullable=False)
    username      = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active     = Column(Boolean, default=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee", back_populates="user")
    roles    = relationship("Role", secondary="auth.user_roles", back_populates="users")

    # Backward-compat property so existing code that reads .id still works
    @property
    def id(self):
        return self.user_id


# ==========================================
# 3. ROLES & USER_ROLES (many-to-many)
# ==========================================
class Role(Base):
    __tablename__ = "roles"
    __table_args__ = {"schema": "auth"}

    role_id   = Column(Integer, primary_key=True)
    role_name = Column(String, unique=True, nullable=False)

    users = relationship("User", secondary="auth.user_roles", back_populates="roles")


user_roles_table = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("auth.users.user_id"), primary_key=True),
    Column("role_id", Integer, ForeignKey("auth.roles.role_id"),  primary_key=True),
    schema="auth",
)


# ==========================================
# 4. LOGIN ATTEMPTS
# ==========================================
class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    __table_args__ = {"schema": "auth"}

    attempt_id  = Column(BigInteger, primary_key=True)
    user_id     = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    username    = Column(String, nullable=False)
    success     = Column(Boolean, nullable=False)
    ip_address  = Column(String)
    user_agent  = Column(String)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now())


# ==========================================
# 5. AUDIT LOG
# ==========================================
class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = {"schema": "auth"}

    audit_id         = Column(BigInteger, primary_key=True)
    table_name       = Column(String, nullable=False)
    record_pk        = Column(String, nullable=False)
    action           = Column(
        SAEnum("INSERT", "UPDATE", "DELETE", "LOGIN", "LOGOUT",
               name="audit_action", schema="auth"),
        nullable=False,
    )
    actor_user_id     = Column(Integer, ForeignKey("auth.users.user_id"),     nullable=True)
    actor_employee_id = Column(Integer, ForeignKey("auth.employees.employee_id"), nullable=True)
    old_values        = Column(JSONB)
    new_values        = Column(JSONB)
    occurred_at       = Column(DateTime(timezone=True), server_default=func.now())
