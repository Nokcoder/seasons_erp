# auth/dependencies.py
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db
from inventory import models  # Importing your User model

# 1. THE DICTIONARY (Who can do what)
ROLE_PERMISSIONS = {
    "ADMIN": [
        "edit_transfer_header",
        "create_transfer",
        "receive_transfer",
        "view_inventory"
    ],
    "WAREHOUSE_MANAGER": [
        "create_transfer",
        "receive_transfer",
        "view_inventory"
    ],
    "WAREHOUSE_STAFF": [
        "view_inventory"
    ]
}

# 2. THE IDENTITY CHECKER
def get_current_user(db: Session = Depends(get_db)):
    """
    NOTE: Since we haven't fully wired up JWT tokens to headers yet,
    this is a temporary mock that just grabs the first user in the DB (usually your Admin).
    We will replace this with real token decoding later!
    """
    user = db.query(models.User).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

# 3. THE PERMISSION GATEKEEPER
def require_permission(required_perm: str):
    def permission_checker(current_user: models.User = Depends(get_current_user)):
        user_perms = ROLE_PERMISSIONS.get(current_user.role, [])
        if required_perm not in user_perms:
            raise HTTPException(status_code=403, detail=f"Missing permission: {required_perm}")
        return current_user
    return permission_checker