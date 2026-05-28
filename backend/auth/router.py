# auth/router.py
import os
from typing import List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload
from passlib.context import CryptContext
import jwt

from core.database import get_db
from auth import models, schemas

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-this-in-production")
ALGORITHM  = "HS256"
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
