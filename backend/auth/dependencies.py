# auth/dependencies.py
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from core.database import get_db
from auth import models


# ── Role → permission map ─────────────────────────────────────────────────────
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "ADMIN": [
        "edit_transfer_header",
        "create_transfer",
        "receive_transfer",
        "view_inventory",
    ],
    "WAREHOUSE_MANAGER": [
        "create_transfer",
        "receive_transfer",
        "view_inventory",
    ],
    "WAREHOUSE_STAFF": [
        "view_inventory",
    ],
}


# ── Identity stub ─────────────────────────────────────────────────────────────
def get_current_user(db: Session = Depends(get_db)) -> models.User:
    """
    Temporary stub — returns the first active user instead of decoding a JWT.
    Replace with real token validation before production use.
    """
    user = (
        db.query(models.User)
        .options(joinedload(models.User.roles))
        .filter(models.User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ── Permission guard ──────────────────────────────────────────────────────────
def require_permission(required_perm: str):
    def permission_checker(
        current_user: models.User = Depends(get_current_user),
    ) -> models.User:
        # collect all permissions for every role the user holds
        user_perms: set[str] = set()
        for role in current_user.roles:
            user_perms.update(ROLE_PERMISSIONS.get(role.role_name, []))
        if required_perm not in user_perms:
            raise HTTPException(
                status_code=403, detail=f"Missing permission: {required_perm}"
            )
        return current_user
    return permission_checker
