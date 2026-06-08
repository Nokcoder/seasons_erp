# auth/dependencies.py
import os
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session, joinedload
import jwt

from core.database import get_db
from auth import models

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-this-in-production")
ALGORITHM  = "HS256"

_bearer = HTTPBearer()

# ── Role → permission map ─────────────────────────────────────────────────────
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "ADMIN": [
        "view_inventory",
        "manage_products",
        "manage_locations",
        "create_transfer",
        "receive_transfer",
        "edit_transfer_header",
        "manage_suppliers",
        "manage_purchase_orders",
        "confirm_shipment",
        "manage_invoices",
        "manage_payments",
        "manage_ap_ledger",
        "manage_users",
        "manage_inventory_policy",
        # sales module
        "manage_sales_settings",
        "manage_customers",
        "process_sale",
        "process_returns",
        "process_blind_returns",
    ],
    "WAREHOUSE_MANAGER": [
        "view_inventory",
        "manage_products",
        "manage_locations",
        "create_transfer",
        "receive_transfer",
        "manage_suppliers",
        "manage_purchase_orders",
        "confirm_shipment",
        "manage_inventory_policy",
    ],
    "WAREHOUSE_STAFF": [
        "view_inventory",
        "create_transfer",
        "receive_transfer",
    ],
    "ACCOUNTANT": [
        "view_inventory",
        "manage_invoices",
        "manage_payments",
        "manage_ap_ledger",
    ],
    "STORE_MANAGER": [
        "view_inventory",
        "manage_sales_settings",
        "manage_customers",
        "process_sale",
        "process_returns",
        "process_blind_returns",
        "manage_payments",
        "manage_users",
        "manage_inventory_policy",
    ],
    "CASHIER": [
        "view_inventory",
        "process_sale",
        "process_returns",
    ],
}


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
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = (
        db.query(models.User)
        .options(joinedload(models.User.roles))
        .filter(models.User.user_id == user_id, models.User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return user


# ── Permission guard ──────────────────────────────────────────────────────────
def require_permission(required_perm: str):
    def _checker(
        current_user: models.User = Depends(get_current_user),
    ) -> models.User:
        user_perms: set[str] = set()
        for role in current_user.roles:
            user_perms.update(ROLE_PERMISSIONS.get(role.role_name, []))
        if required_perm not in user_perms:
            raise HTTPException(
                status_code=403, detail=f"Missing permission: {required_perm}"
            )
        return current_user
    return _checker
