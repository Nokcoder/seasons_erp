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


# ── Receipt printing enable/disable (tenant-wide) ─────────────────────────────
# Stored as a per-tenant key-value row (settings.system_settings), the same
# mechanism as allow_negative_stock — there is no columnar settings table.
# Default is ENABLED (True) when no row exists yet.
_RECEIPTS_KEY = "receipts_enabled"


def _read_receipts(db: Session) -> schemas.ReceiptsSettingOut:
    row = db.query(models.SystemSetting).filter_by(key=_RECEIPTS_KEY).first()
    if not row:
        return schemas.ReceiptsSettingOut(receipts_enabled=True)
    return schemas.ReceiptsSettingOut(
        receipts_enabled=row.value == "true",
        updated_at=row.updated_at,
        updated_by_user_id=row.updated_by_user_id,
        updated_by_username=row.updated_by.username if row.updated_by else None,
    )


@router.get("/receipts", response_model=schemas.ReceiptsSettingOut)
def get_receipts_setting(db: Session = Depends(get_db)):
    """Tenant-wide receipt-printing flag. Only authentication is required (the
    router-level get_current_user dependency) — the checkout path needs to read
    this, not just template admins."""
    return _read_receipts(db)


@router.patch("/receipts", response_model=schemas.ReceiptsSettingOut)
def update_receipts_setting(
    payload: schemas.ReceiptsSettingPatch,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_print_templates")),
):
    row = db.query(models.SystemSetting).filter_by(key=_RECEIPTS_KEY).first()
    if not row:
        row = models.SystemSetting(key=_RECEIPTS_KEY, value="true")
        db.add(row)
    row.value              = "true" if payload.receipts_enabled else "false"
    row.updated_at         = datetime.now(timezone.utc)
    row.updated_by_user_id = _actor.user_id
    db.commit()
    db.refresh(row)
    return _read_receipts(db)


# ── Auto-print-on-completion (tenant-wide, opt-in) ────────────────────────────
# A separate axis from receipts_enabled: receipts_enabled governs whether
# printing is available at all; this governs whether a completed sale prints
# automatically (skipping the confirm-preview). Default FALSE (opt-in). Same KV /
# permission pattern.
_AUTO_PRINT_KEY = "receipts_auto_print"


def _read_auto_print(db: Session) -> schemas.ReceiptsAutoPrintSettingOut:
    row = db.query(models.SystemSetting).filter_by(key=_AUTO_PRINT_KEY).first()
    if not row:
        return schemas.ReceiptsAutoPrintSettingOut(receipts_auto_print=False)
    return schemas.ReceiptsAutoPrintSettingOut(
        receipts_auto_print=row.value == "true",
        updated_at=row.updated_at,
        updated_by_user_id=row.updated_by_user_id,
        updated_by_username=row.updated_by.username if row.updated_by else None,
    )


@router.get("/receipts-auto-print", response_model=schemas.ReceiptsAutoPrintSettingOut)
def get_receipts_auto_print(db: Session = Depends(get_db)):
    """Tenant-wide auto-print-on-completion flag. Auth-only (checkout reads it)."""
    return _read_auto_print(db)


@router.patch("/receipts-auto-print", response_model=schemas.ReceiptsAutoPrintSettingOut)
def update_receipts_auto_print(
    payload: schemas.ReceiptsAutoPrintSettingPatch,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_print_templates")),
):
    row = db.query(models.SystemSetting).filter_by(key=_AUTO_PRINT_KEY).first()
    if not row:
        row = models.SystemSetting(key=_AUTO_PRINT_KEY, value="false")
        db.add(row)
    row.value              = "true" if payload.receipts_auto_print else "false"
    row.updated_at         = datetime.now(timezone.utc)
    row.updated_by_user_id = _actor.user_id
    db.commit()
    db.refresh(row)
    return _read_auto_print(db)

