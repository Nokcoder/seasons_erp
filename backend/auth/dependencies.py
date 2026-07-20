# auth/dependencies.py
import os
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session, joinedload
import jwt

from core.database import get_db
from auth import models

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
ALGORITHM = "HS256"

_bearer = HTTPBearer()


# ── Real JWT identity ─────────────────────────────────────────────────────────
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    """Decode the Bearer JWT and return the authenticated User."""
    try:
        payload = jwt.decode(
            credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM]
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or malformed token")

    user_id: int | None = payload.get("id")
    tenant_id: int | None = payload.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = (
        db.query(models.User)
        .options(joinedload(models.User.roles))
        .filter(
            models.User.user_id == user_id,
            models.User.tenant_id == tenant_id,
            models.User.is_active == True,
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return user


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_role_ids(user: models.User) -> list[int]:
    return [r.role_id for r in user.roles]


def _resolve_action_set(user: models.User, db: Session) -> set[str]:
    """Query all action_keys granted to this user via their roles.

    Result is cached on the SQLAlchemy session for the duration of the request
    to avoid repeated round-trips when multiple require_permission guards fire.
    """
    cache_attr = f"_action_cache_{user.user_id}"
    cached = getattr(db, cache_attr, None)
    if cached is not None:
        return cached

    role_ids = _get_role_ids(user)
    if not role_ids:
        result: set[str] = set()
        setattr(db, cache_attr, result)
        return result

    rows = (
        db.query(models.Action.action_key)
        .join(models.role_actions_table,
              models.role_actions_table.c.action_id == models.Action.action_id)
        .filter(models.role_actions_table.c.role_id.in_(role_ids))
        .all()
    )
    result = {r.action_key for r in rows}
    setattr(db, cache_attr, result)
    return result


def _resolve_program_set(user: models.User, db: Session) -> set[str]:
    """Query all program_keys granted to this user via their roles."""
    cache_attr = f"_program_cache_{user.user_id}"
    cached = getattr(db, cache_attr, None)
    if cached is not None:
        return cached

    role_ids = _get_role_ids(user)
    if not role_ids:
        result: set[str] = set()
        setattr(db, cache_attr, result)
        return result

    rows = (
        db.query(models.Program.program_key)
        .join(models.role_programs_table,
              models.role_programs_table.c.program_id == models.Program.program_id)
        .filter(models.role_programs_table.c.role_id.in_(role_ids))
        .all()
    )
    result = {r.program_key for r in rows}
    setattr(db, cache_attr, result)
    return result


# ── Public non-raising check (used inside business logic helpers) ─────────────

def has_action(user: models.User, action_key: str, db: Session) -> bool:
    """Return True if the user holds the given action_key. Does not raise."""
    return action_key in _resolve_action_set(user, db)


# ── Permission guard ──────────────────────────────────────────────────────────

def require_permission(required_action_key: str):
    """FastAPI dependency: enforces action-level access on an endpoint.

    Injects current_user and db, resolves the user's full action set from
    role_actions, and raises HTTP 403 if the required action is absent.
    The resolved set is cached on the db session to avoid N queries per request
    when multiple guards fire on the same endpoint.
    """
    def _checker(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if required_action_key not in _resolve_action_set(current_user, db):
            raise HTTPException(
                status_code=403,
                detail=f"Missing permission: {required_action_key}",
            )
        return current_user
    return _checker


def require_program(required_program_key: str):
    """FastAPI dependency: enforces program-level access on an endpoint.

    Used for backend enforcement on sensitive routes. Frontend uses
    GET /auth/programs for nav/page gating.
    """
    def _checker(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if required_program_key not in _resolve_program_set(current_user, db):
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: program '{required_program_key}'",
            )
        return current_user
    return _checker
