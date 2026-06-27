# auth/router.py
import os
from typing import List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload
from passlib.context import CryptContext
import jwt

from core.database import get_db
from core.audit import write_audit, _serialize
from auth import models, schemas
from auth.dependencies import SECRET_KEY, ALGORITHM, get_current_user, require_permission

router = APIRouter(prefix="/auth", tags=["Authentication"])

TOKEN_TTL_HOURS = 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_user(db: Session, username: str) -> models.User | None:
    return (
        db.query(models.User)
        .options(
            joinedload(models.User.employee),
            joinedload(models.User.roles),
        )
        .filter(models.User.username == username)
        .first()
    )


def _make_token(user: models.User) -> str:
    payload = {
        "sub":   user.username,
        "id":    user.user_id,
        "roles": [r.role_name for r in user.roles],
        "exp":   datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _log_attempt(db: Session, username: str, success: bool,
                 user_id: int | None = None, request: Request | None = None):
    ip = request.client.host if request and request.client else None
    ua = request.headers.get("user-agent") if request else None
    db.add(models.LoginAttempt(
        user_id=user_id,
        username=username,
        success=success,
        ip_address=ip,
        user_agent=ua,
    ))


# ── POST /auth/register ───────────────────────────────────────────────────────

@router.post("/register", response_model=schemas.UserResponse, status_code=201)
def register(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")

    # 1. create employee
    employee = models.Employee(
        first_name=payload.first_name,
        last_name=payload.last_name,
    )
    db.add(employee)
    db.flush()   # get employee_id before creating user

    # 2. create user
    user = models.User(
        employee_id=employee.employee_id,
        username=payload.username,
        password_hash=pwd_context.hash(payload.password),
    )
    db.add(user)
    db.flush()   # get user_id before assigning roles

    # 3. assign roles (create Role rows on the fly if they don't exist)
    for role_name in payload.role_names:
        role = db.query(models.Role).filter(models.Role.role_name == role_name).first()
        if not role:
            role = models.Role(role_name=role_name)
            db.add(role)
            db.flush()
        user.roles.append(role)

    db.commit()
    db.refresh(user)
    write_audit(db, "auth.users", str(user.user_id), "INSERT",
                new_values=_serialize(user))
    db.commit()
    return user


# ── POST /auth/login ──────────────────────────────────────────────────────────

@router.post("/login", response_model=schemas.LoginResponse)
def login(payload: schemas.UserLogin, request: Request, db: Session = Depends(get_db)):
    user = _load_user(db, payload.username)

    if not user or not pwd_context.verify(payload.password, user.password_hash):
        # log the failed attempt (user_id may be None if username not found)
        _log_attempt(db, payload.username, success=False,
                     user_id=user.user_id if user else None,
                     request=request)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        _log_attempt(db, payload.username, success=False,
                     user_id=user.user_id, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # update last login timestamp
    user.last_login_at = datetime.now(timezone.utc)
    _log_attempt(db, payload.username, success=True,
                 user_id=user.user_id, request=request)
    db.commit()
    db.refresh(user)

    return schemas.LoginResponse(
        access_token=_make_token(user),
        token_type="bearer",
        user=user,
    )


# ── GET /auth/users/all ───────────────────────────────────────────────────────

@router.get("/users/all", response_model=List[schemas.UserResponse])
def get_all_active_users(db: Session = Depends(get_db)):
    return (
        db.query(models.User)
        .options(
            joinedload(models.User.employee),
            joinedload(models.User.roles),
        )
        .filter(models.User.is_active == True)
        .all()
    )


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_user_by_id(user_id: int, db: Session) -> models.User:
    user = (
        db.query(models.User)
        .options(joinedload(models.User.employee), joinedload(models.User.roles))
        .filter(models.User.user_id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── PATCH /auth/users/{user_id}/active ───────────────────────────────────────

@router.patch("/users/{user_id}/active", response_model=schemas.UserResponse)
def set_user_active(
    user_id: int,
    payload: schemas.UserActiveUpdate,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    """Activate or deactivate a user account (Requirements §4.1)."""
    user = _load_user_by_id(user_id, db)
    old = _serialize(user)
    user.is_active = payload.is_active
    # Cascade to the linked employee so dropdowns respect the flag
    if user.employee:
        user.employee.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    write_audit(db, "auth.users", str(user_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(user))
    db.commit()
    return user


# ── PUT /auth/users/{user_id}/roles ──────────────────────────────────────────

@router.put("/users/{user_id}/roles", response_model=schemas.UserResponse)
def update_user_roles(
    user_id: int,
    payload: schemas.UserRolesUpdate,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    """Replace a user's role assignments entirely (Requirements §4.2)."""
    user = _load_user_by_id(user_id, db)
    old = _serialize(user)

    roles = []
    for role_name in payload.role_names:
        role = db.query(models.Role).filter(models.Role.role_name == role_name).first()
        if not role:
            role = models.Role(role_name=role_name)
            db.add(role)
            db.flush()
        roles.append(role)

    user.roles = roles
    db.commit()
    db.refresh(user)
    write_audit(db, "auth.users", str(user_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old,
                new_values={"roles": payload.role_names})
    db.commit()
    return user


# ── PATCH /auth/users/{user_id}/password ─────────────────────────────────────

@router.patch("/users/{user_id}/password", status_code=204)
def change_password(
    user_id: int,
    payload: schemas.UserPasswordChange,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    """Change a user's password (Requirements §4.1)."""
    user = _load_user_by_id(user_id, db)
    user.password_hash = pwd_context.hash(payload.new_password)
    db.commit()
    write_audit(db, "auth.users", str(user_id), "UPDATE",
                actor_user_id=_actor.user_id,
                new_values={"password_changed": True})
    db.commit()


# ── GET /auth/users ───────────────────────────────────────────────────────────
# All users (active + inactive) — used by the Settings page.

@router.get("/users", response_model=List[schemas.UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    return (
        db.query(models.User)
        .options(joinedload(models.User.employee), joinedload(models.User.roles))
        .order_by(models.User.user_id)
        .all()
    )


# ── GET /auth/roles ───────────────────────────────────────────────────────────

@router.get("/roles", response_model=List[schemas.RoleDetailOut])
def list_roles(
    db: Session = Depends(get_db),
    _actor: models.User = Depends(get_current_user),
):
    roles = (
        db.query(models.Role)
        .options(joinedload(models.Role.users))
        .order_by(models.Role.role_name)
        .all()
    )
    return [
        schemas.RoleDetailOut(
            role_id=r.role_id,
            role_name=r.role_name,
            user_count=len(r.users),
        )
        for r in roles
    ]


# ── POST /auth/roles ──────────────────────────────────────────────────────────

@router.post("/roles", response_model=schemas.RoleDetailOut, status_code=201)
def create_role(
    payload: schemas.RoleCreate,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_roles")),
):
    name = payload.role_name.strip().upper()
    if db.query(models.Role).filter(models.Role.role_name == name).first():
        raise HTTPException(status_code=400, detail=f"Role '{name}' already exists")
    role = models.Role(role_name=name)
    db.add(role)
    db.commit()
    db.refresh(role)
    return schemas.RoleDetailOut(role_id=role.role_id, role_name=role.role_name, user_count=0)


# ── PATCH /auth/roles/{role_id} ───────────────────────────────────────────────

@router.patch("/roles/{role_id}", response_model=schemas.RoleDetailOut)
def update_role(
    role_id: int,
    payload: schemas.RolePatch,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_roles")),
):
    role = db.query(models.Role).filter(models.Role.role_id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    role.role_name = payload.role_name.strip().upper()
    db.commit()
    db.refresh(role)
    return schemas.RoleDetailOut(
        role_id=role.role_id, role_name=role.role_name, user_count=len(role.users)
    )


# ── DELETE /auth/roles/{role_id} ──────────────────────────────────────────────

@router.delete("/roles/{role_id}", status_code=204)
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_roles")),
):
    role = db.query(models.Role).filter(models.Role.role_id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    count = len(role.users)
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete '{role.role_name}': {count} user{'s' if count != 1 else ''} assigned",
        )
    db.delete(role)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# EMPLOYEE CRUD
# ═══════════════════════════════════════════════════════════════════════════════

def _load_employee(employee_id: int, db: Session) -> models.Employee:
    emp = db.query(models.Employee).filter(
        models.Employee.employee_id == employee_id
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@router.get("/employees", response_model=List[schemas.EmployeeOut])
def list_employees(
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    return (
        db.query(models.Employee)
        .order_by(models.Employee.last_name, models.Employee.first_name)
        .all()
    )


@router.post("/employees", response_model=schemas.EmployeeOut, status_code=201)
def create_employee(
    payload: schemas.EmployeeCreate,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    emp = models.Employee(
        first_name=payload.first_name,
        last_name=payload.last_name,
        is_active=True,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    write_audit(db, "auth.employees", str(emp.employee_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(emp))
    db.commit()
    return emp


@router.patch("/employees/{employee_id}", response_model=schemas.EmployeeOut)
def update_employee(
    employee_id: int,
    payload: schemas.EmployeePatch,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_users")),
):
    emp = _load_employee(employee_id, db)
    old = _serialize(emp)
    if payload.first_name is not None:
        emp.first_name = payload.first_name
    if payload.last_name is not None:
        emp.last_name = payload.last_name
    if payload.is_active is not None:
        emp.is_active = payload.is_active
    db.commit()
    db.refresh(emp)
    write_audit(db, "auth.employees", str(employee_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(emp))
    db.commit()
    return emp


# ═══════════════════════════════════════════════════════════════════════════════
# RBAC — PROGRAMS & ACTIONS CATALOGUE
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/programs", response_model=List[schemas.ModuleGroup])
def list_programs(
    db: Session = Depends(get_db),
    _actor: models.User = Depends(get_current_user),
):
    """Return all programs grouped by module, each with their actions.

    Any authenticated user may call this endpoint. The frontend uses the
    full catalogue to render the permission matrix in Settings → Roles and
    to resolve which nav items to show for the logged-in user's roles.
    """
    programs = (
        db.query(models.Program)
        .options(joinedload(models.Program.actions))
        .order_by(models.Program.module, models.Program.sort_order)
        .all()
    )

    # Group by module preserving sort_order within each module
    module_map: dict[str, list[models.Program]] = {}
    for p in programs:
        module_map.setdefault(p.module, []).append(p)

    # Stable module ordering: use the first program's position as proxy
    MODULE_ORDER = ["Sales", "Inventory", "Stock", "Procurement", "AP", "Customers", "Settings"]
    ordered_modules = sorted(
        module_map.keys(),
        key=lambda m: MODULE_ORDER.index(m) if m in MODULE_ORDER else 99,
    )

    return [
        schemas.ModuleGroup(
            module=mod,
            programs=[
                schemas.ProgramOut(
                    program_id=p.program_id,
                    program_key=p.program_key,
                    display_name=p.display_name,
                    sort_order=p.sort_order,
                    actions=[
                        schemas.ActionOut(
                            action_id=a.action_id,
                            action_key=a.action_key,
                            display_name=a.display_name,
                        )
                        for a in sorted(p.actions, key=lambda a: a.action_id)
                    ],
                )
                for p in sorted(module_map[mod], key=lambda p: p.sort_order)
            ],
        )
        for mod in ordered_modules
    ]


@router.get("/actions", response_model=List[schemas.ActionWithProgramOut])
def list_actions(
    db: Session = Depends(get_db),
    _actor: models.User = Depends(get_current_user),
):
    """Return a flat list of all actions with their program_key.

    Any authenticated user may call this endpoint.
    """
    rows = (
        db.query(models.Action, models.Program.program_key)
        .join(models.Program, models.Program.program_id == models.Action.program_id)
        .order_by(models.Program.module, models.Program.sort_order, models.Action.action_id)
        .all()
    )
    return [
        schemas.ActionWithProgramOut(
            action_id=a.action_id,
            action_key=a.action_key,
            display_name=a.display_name,
            program_key=pk,
        )
        for a, pk in rows
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# RBAC — ROLE PERMISSION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

def _load_role(role_id: int, db: Session) -> models.Role:
    role = (
        db.query(models.Role)
        .options(
            joinedload(models.Role.programs),
            joinedload(models.Role.actions),
        )
        .filter(models.Role.role_id == role_id)
        .first()
    )
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.get("/roles/{role_id}/permissions", response_model=schemas.RolePermissionsOut)
def get_role_permissions(
    role_id: int,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_roles")),
):
    """Return the full set of program and action keys assigned to this role."""
    role = _load_role(role_id, db)
    return schemas.RolePermissionsOut(
        program_keys=[p.program_key for p in role.programs],
        action_keys=[a.action_key for a in role.actions],
    )


@router.put("/roles/{role_id}/permissions", response_model=schemas.RolePermissionsOut)
def set_role_permissions(
    role_id: int,
    payload: schemas.RolePermissionsIn,
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("manage_roles")),
):
    """Replace the complete program and action set for a role atomically.

    Validation: every supplied action_key must belong to a program whose
    program_key is also in the supplied program_keys list. Actions whose
    program is not in program_keys are rejected with HTTP 422.
    """
    role = _load_role(role_id, db)

    # Resolve supplied program_keys → Program rows
    programs = (
        db.query(models.Program)
        .filter(models.Program.program_key.in_(payload.program_keys))
        .all()
    ) if payload.program_keys else []

    found_program_keys = {p.program_key for p in programs}
    missing_progs = set(payload.program_keys) - found_program_keys
    if missing_progs:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown program_keys: {sorted(missing_progs)}",
        )

    # Resolve supplied action_keys → Action rows (with their program)
    actions = (
        db.query(models.Action)
        .options(joinedload(models.Action.program))
        .filter(models.Action.action_key.in_(payload.action_keys))
        .all()
    ) if payload.action_keys else []

    found_action_keys = {a.action_key for a in actions}
    missing_acts = set(payload.action_keys) - found_action_keys
    if missing_acts:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown action_keys: {sorted(missing_acts)}",
        )

    # Validate: every action's program must be in the supplied program set
    orphaned = [
        a.action_key for a in actions
        if a.program.program_key not in found_program_keys
    ]
    if orphaned:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Actions {sorted(orphaned)} belong to programs not included in "
                f"program_keys. Add the parent program or remove the action."
            ),
        )

    # Replace assignments atomically
    role.programs = programs
    role.actions  = actions
    db.commit()
    db.refresh(role)

    return schemas.RolePermissionsOut(
        program_keys=[p.program_key for p in role.programs],
        action_keys=[a.action_key for a in role.actions],
    )
