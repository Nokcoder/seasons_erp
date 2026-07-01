# auth/models.py
from sqlalchemy import (Column, Integer, BigInteger, String, Boolean,
                         DateTime, ForeignKey, Table, Enum as SAEnum)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


# ==========================================
# RBAC — PROGRAMS & ACTIONS
# ==========================================

role_programs_table = Table(
    "role_programs",
    Base.metadata,
    Column("role_id",    Integer, ForeignKey("auth.roles.role_id",    ondelete="CASCADE"), primary_key=True),
    Column("program_id", Integer, ForeignKey("auth.programs.program_id", ondelete="CASCADE"), primary_key=True),
    schema="auth",
)

role_actions_table = Table(
    "role_actions",
    Base.metadata,
    Column("role_id",   Integer, ForeignKey("auth.roles.role_id",   ondelete="CASCADE"), primary_key=True),
    Column("action_id", Integer, ForeignKey("auth.actions.action_id", ondelete="CASCADE"), primary_key=True),
    schema="auth",
)


class Program(Base):
    __tablename__ = "programs"
    __table_args__ = {"schema": "auth"}

    program_id   = Column(Integer, primary_key=True)
    program_key  = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    module       = Column(String, nullable=False)
    sort_order   = Column(Integer, nullable=False, default=0)

    actions = relationship("Action", back_populates="program", order_by="Action.action_id")
    roles   = relationship("Role", secondary="auth.role_programs", back_populates="programs")


class Action(Base):
    __tablename__ = "actions"
    __table_args__ = {"schema": "auth"}

    action_id    = Column(Integer, primary_key=True)
    action_key   = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    program_id   = Column(Integer, ForeignKey("auth.programs.program_id"), nullable=False)

    program = relationship("Program", back_populates="actions")
    roles   = relationship("Role", secondary="auth.role_actions", back_populates="actions")


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

    role_id            = Column(Integer, primary_key=True)
    role_name          = Column(String, unique=True, nullable=False)
    is_cashiering_mode = Column(Boolean, nullable=False, default=False)

    users    = relationship("User",    secondary="auth.user_roles",    back_populates="roles")
    programs = relationship("Program", secondary="auth.role_programs", back_populates="roles")
    actions  = relationship("Action",  secondary="auth.role_actions",  back_populates="roles")


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
