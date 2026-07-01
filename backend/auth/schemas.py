from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel


# ==========================================
# ROLES
# ==========================================
class RoleOut(BaseModel):
    role_id: int
    role_name: str
    is_cashiering_mode: bool

    class Config:
        from_attributes = True


class RoleDetailOut(BaseModel):
    """Role with assigned-user count — used by the Settings roles tab."""
    role_id: int
    role_name: str
    user_count: int
    is_cashiering_mode: bool


class RoleCreate(BaseModel):
    role_name: str


class RolePatch(BaseModel):
    role_name: str


class RoleCashieringModeUpdate(BaseModel):
    is_cashiering_mode: bool


# ==========================================
# EMPLOYEES
# ==========================================
class EmployeeCreate(BaseModel):
    first_name: str
    last_name: str


class EmployeePatch(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: Optional[bool] = None


class EmployeeOut(BaseModel):
    employee_id: int
    first_name: str
    last_name: str
    is_active: bool
    has_user: bool = False

    class Config:
        from_attributes = True


# ==========================================
# USERS — input
# ==========================================
class UserCreate(BaseModel):
    """Links a User to an existing employee (employee_id) or creates a new one (first_name + last_name)."""
    employee_id: Optional[int] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: str
    password: str
    role_names: List[str] = []


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


# ==========================================
# USER MANAGEMENT
# ==========================================
class UserActiveUpdate(BaseModel):
    is_active: bool

class UserRolesUpdate(BaseModel):
    role_names: List[str]

class UserPasswordChange(BaseModel):
    new_password: str


# ==========================================
# RBAC — PROGRAMS & ACTIONS
# ==========================================

class ActionOut(BaseModel):
    action_id:    int
    action_key:   str
    display_name: str

    class Config:
        from_attributes = True


class ActionWithProgramOut(BaseModel):
    action_id:    int
    action_key:   str
    display_name: str
    program_key:  str

    class Config:
        from_attributes = True


class ProgramOut(BaseModel):
    program_id:   int
    program_key:  str
    display_name: str
    sort_order:   int
    actions:      List[ActionOut]

    class Config:
        from_attributes = True


class ModuleGroup(BaseModel):
    module:   str
    programs: List[ProgramOut]


class RolePermissionsOut(BaseModel):
    program_keys: List[str]
    action_keys:  List[str]


class RolePermissionsIn(BaseModel):
    program_keys: List[str]
    action_keys:  List[str]


class UserProgramsOut(BaseModel):
    """Scoped to the calling user's roles — not the full catalogue."""
    program_keys: List[str]
    action_keys:  List[str] = []
    is_cashiering_mode: bool = False


class UserProfileOut(BaseModel):
    """Current user's identity + linked employee record."""
    user_id:     int
    username:    str
    employee_id: Optional[int] = None
    first_name:  Optional[str] = None
    last_name:   Optional[str] = None
