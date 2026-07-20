# settings/router.py
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import get_current_user, require_permission
from auth.models import User
from settings import models, schemas

router = APIRouter(
    prefix="/settings",
    tags=["Settings"],
    dependencies=[Depends(get_current_user)],
)


def _read_policy(db: Session) -> schemas.InventoryPolicyOut:
    row = db.query(models.SystemSetting).filter_by(key="allow_negative_stock").first()
    if not row:
        return schemas.InventoryPolicyOut(allow_negative_stock=False)
    return schemas.InventoryPolicyOut(
        allow_negative_stock=row.value == "true",
        updated_at=row.updated_at,
        updated_by_user_id=row.updated_by_user_id,
        updated_by_username=row.updated_by.username if row.updated_by else None,
    )


@router.get("/inventory-policy", response_model=schemas.InventoryPolicyOut, dependencies=[Depends(require_permission("manage_inventory_policy"))])
def get_inventory_policy(db: Session = Depends(get_db)):
    return _read_policy(db)


@router.patch("/inventory-policy", response_model=schemas.InventoryPolicyOut)
def update_inventory_policy(
    payload: schemas.InventoryPolicyPatch,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_inventory_policy")),
):
    row = db.query(models.SystemSetting).filter_by(key="allow_negative_stock").first()
    if not row:
        row = models.SystemSetting(key="allow_negative_stock", value="false")
        db.add(row)
    row.value              = "true" if payload.allow_negative_stock else "false"
    row.updated_at         = datetime.now(timezone.utc)
    row.updated_by_user_id = _actor.user_id
    db.commit()
    db.refresh(row)
    return _read_policy(db)

