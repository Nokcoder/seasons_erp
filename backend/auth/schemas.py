# auth/schemas.py
from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel


# ==========================================
# ROLES
# ==========================================
class RoleOut(BaseModel):
    role_id: int
    role_name: str

    class Config:
        from_attributes = True


# ==========================================
# EMPLOYEES
# ==========================================
class EmployeeOut(BaseModel):
    employee_id: int
    first_name: str
    last_name: str

    class Config:
        from_attributes = True


# ==========================================
# USERS — input
# ==========================================
class UserCreate(BaseModel):
    """Creates an Employee row and a linked User row in one call."""
    first_name: str
    last_name: str
    username: str
    password: str
    role_names: List[str] = []   # e.g. ["ADMIN", "WAREHOUSE_MANAGER"]


class UserLogin(BaseModel):
    username: str
    password: str


# ==========================================
# USERS — output
# ==========================================
class UserResponse(BaseModel):
    user_id: int
    username: str
    is_active: bool
    employee: EmployeeOut
    roles: List[RoleOut]

    class Config:
        from_attributes = True


# ==========================================
# LOGIN response
# ==========================================
class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
