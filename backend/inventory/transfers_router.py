# inventory/transfers_router.py
from typing import List
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_db
from inventory import models, schemas
from auth.dependencies import require_permission

router = APIRouter(prefix="/transfers", tags=["Transfers"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_transfer(transfer_id: int, db: Session) -> models.InventoryTransfer:
    transfer = (
        db.query(models.InventoryTransfer)
        .options(
            selectinload(models.InventoryTransfer.from_location),
            selectinload(models.InventoryTransfer.to_location),
            selectinload(models.InventoryTransfer.released_by),
            selectinload(models.InventoryTransfer.received_by),
            selectinload(models.InventoryTransfer.requested_by),
            selectinload(models.InventoryTransfer.items),
        )
        .filter(models.InventoryTransfer.transfer_id == transfer_id)
        .first()
    )
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return transfer


def _upsert_stock(
    db: Session,
    variant_id: int,
    location_id: int,
    delta: Decimal,
):
    """Atomically add delta to current_stocks, creating the row if it doesn't exist.

    Uses PostgreSQL INSERT ... ON CONFLICT DO UPDATE so that multiple calls
    within the same transaction (autoflush=False) are safe and correct.
    """
    tbl  = models.CurrentStock.__table__
    stmt = (
        pg_insert(tbl)
        .values(variant_id=variant_id, location_id=location_id, quantity=delta)
        .on_conflict_do_update(
            constraint="uq_current_stocks_variant_location",
            set_={"quantity": tbl.c.quantity + delta},
        )
    )
    db.execute(stmt)


def _write_ledger(
    db: Session,
    variant_id: int,
    location_id: int,
    qty_change: Decimal,
    reason: models.LedgerReason,
    reference_type: str,
    reference_id: str,
):
    db.add(models.InventoryLedger(
        variant_id=variant_id,
        location_id=location_id,
        qty_change=qty_change,
        reason=reason,
        reference_type=reference_type,
        reference_id=reference_id,
    ))


def _consume_fifo(
    db: Session,
    variant_id: int,
    location_id: int,
    qty: Decimal,
) -> list[tuple[Decimal, Decimal]]:
    """
    Deduct qty from cost layers FIFO oldest-first (row-locks layers for concurrency safety).
    Returns [(units_taken, net_unit_cost), ...].
    Raises 400 if available layers are insufficient to cover qty.
    """
    # Pre-flight: check current_stocks before touching cost layers.
    # If current_stocks and layers have drifted out of sync (e.g. due to a
    # failed partial transaction), this catches the discrepancy early and
    # prevents stock from going negative.
    stock = (
        db.query(models.CurrentStock)
        .filter_by(variant_id=variant_id, location_id=location_id)
        .first()
    )
    available_stock = stock.quantity if stock else Decimal("0")
    if available_stock < qty:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient stock for variant {variant_id} at location {location_id}: "
                f"need {qty}, stock balance is {available_stock}"
            ),
        )

    layers = (
        db.query(models.CostLayer)
        .filter(
            models.CostLayer.variant_id == variant_id,
            models.CostLayer.location_id == location_id,
            models.CostLayer.quantity_remaining > 0,
        )
        .order_by(models.CostLayer.created_at.asc())
        .with_for_update()
        .all()
    )

    available = sum(l.quantity_remaining for l in layers)
    if available < qty:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient cost layers for variant {variant_id} at location {location_id}: "
                f"need {qty}, available {available}"
            ),
        )

    consumed: list[tuple[Decimal, Decimal]] = []
    remaining = qty
    for layer in layers:
        if remaining <= 0:
            break
        take = min(layer.quantity_remaining, remaining)
        layer.quantity_remaining -= take
        consumed.append((take, layer.net_unit_cost))
        remaining -= take

    return consumed


def _create_transfer_layers(
    db: Session,
    variant_id: int,
    location_id: int,
    consumed: list[tuple[Decimal, Decimal]],
    actual_in: Decimal,
    actual_out: Decimal,
) -> None:
    """
    Create FIFO cost layers at the transfer destination, carrying over net_unit_cost
    from the consumed source layers unchanged.  If actual_in != actual_out, each slice
    is scaled proportionally so that total destination qty == actual_in.
    """
    if not consumed or actual_in <= 0:
        return

    scale = (actual_in / actual_out) if actual_out > 0 else Decimal("1")
    for qty_taken, net_unit_cost in consumed:
        dest_qty = (qty_taken * scale).quantize(Decimal("0.0001"))
        if dest_qty <= 0:
            continue
        db.add(models.CostLayer(
            variant_id=variant_id,
            location_id=location_id,
            shipment_id=None,
            original_quantity=dest_qty,
            quantity_remaining=dest_qty,
            gross_cost=net_unit_cost,
            supplier_discount=Decimal("0"),
            net_unit_cost=net_unit_cost,
        ))


def _get_bundle_components(
    db: Session,
    variant_id: int,
) -> list[models.BundleComponent]:
    """Returns the bundle components for a variant, or an empty list if it is not a bundle."""
    return (
        db.query(models.BundleComponent)
        .filter(models.BundleComponent.bundle_variant_id == variant_id)
        .all()
    )


def _move_variant(
    db: Session,
    variant_id: int,
    from_location_id: int,
    to_location_id: int,
    actual_out: Decimal,
    actual_in: Decimal,
    ref_id: str,
) -> None:
    """
    Write ledger entries, consume FIFO layers at source, create matching layers
    at destination, and update current_stocks — all for a single (non-bundle) variant.
    """
    _write_ledger(db, variant_id, from_location_id, -actual_out,
                  models.LedgerReason.TRANSFER_OUT, "inventory_transfer", ref_id)
    _write_ledger(db, variant_id, to_location_id, actual_in,
                  models.LedgerReason.TRANSFER_IN, "inventory_transfer", ref_id)

    consumed = _consume_fifo(db, variant_id, from_location_id, actual_out)
    _create_transfer_layers(db, variant_id, to_location_id, consumed, actual_in, actual_out)

    _upsert_stock(db, variant_id, from_location_id, -actual_out)
    _upsert_stock(db, variant_id, to_location_id,   actual_in)


# ═══════════════════════════════════════════════════════════════════════════════
# LOCATIONS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/locations/all", response_model=List[schemas.LocationOut])
def list_locations(db: Session = Depends(get_db)):
    return (
        db.query(models.Location)
        .filter(models.Location.is_deleted == False)
        .all()
    )


@router.post("/locations", response_model=schemas.LocationOut, status_code=201)
def create_location(payload: schemas.LocationCreate, db: Session = Depends(get_db)):
    loc = models.Location(
        location_name=payload.location_name,
        location_type=payload.location_type,
        parent_location_id=payload.parent_location_id,
        address=payload.address,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


@router.put("/locations/{location_id}", response_model=schemas.LocationOut)
def update_location(
    location_id: int,
    payload: schemas.LocationUpdate,
    db: Session = Depends(get_db),
):
    loc = (
        db.query(models.Location)
        .filter(models.Location.location_id == location_id, models.Location.is_deleted == False)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    if loc.is_system:
        raise HTTPException(
            status_code=400,
            detail=f"'{loc.location_name}' is a system location and cannot be modified",
        )

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(loc, key, value)

    db.commit()
    db.refresh(loc)
    return loc


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/", response_model=List[schemas.TransferOut])
def list_transfers(db: Session = Depends(get_db)):
    return (
        db.query(models.InventoryTransfer)
        .options(
            selectinload(models.InventoryTransfer.from_location),
            selectinload(models.InventoryTransfer.to_location),
            selectinload(models.InventoryTransfer.released_by),
            selectinload(models.InventoryTransfer.received_by),
            selectinload(models.InventoryTransfer.requested_by),
            selectinload(models.InventoryTransfer.items),
        )
        .order_by(models.InventoryTransfer.occurred_at.desc())
        .all()
    )


@router.get("/{transfer_id}", response_model=schemas.TransferOut)
def get_transfer(transfer_id: int, db: Session = Depends(get_db)):
    return _load_transfer(transfer_id, db)


@router.post("/", response_model=schemas.TransferOut, status_code=201)
def create_transfer(payload: schemas.TransferCreate, db: Session = Depends(get_db)):
    """
    Record a completed stock transfer.

    For each item the actual movement quantity is determined as:
      quantity_received  (if provided)   — what arrived at destination
      quantity_released  (if provided)   — what left the source
      quantity_requested                 — fallback

    Both inventory_ledger and current_stocks are written atomically.
    """
    if not payload.items:
        raise HTTPException(status_code=400, detail="Transfer must have at least one item")

    # validate both locations exist, are not deleted, and are active
    for loc_id, label in [
        (payload.from_location_id, "Source"),
        (payload.to_location_id,   "Destination"),
    ]:
        loc = db.query(models.Location).filter(
            models.Location.location_id == loc_id,
            models.Location.is_deleted == False,
        ).first()
        if not loc:
            raise HTTPException(status_code=404, detail=f"{label} location not found")
        if loc.status == "Inactive":
            raise HTTPException(
                status_code=400,
                detail=f"{label} location '{loc.location_name}' is inactive",
            )

    transfer = models.InventoryTransfer(
        transfer_pid=payload.transfer_pid,
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        released_by_user_id=payload.released_by_user_id,
        received_by_user_id=payload.received_by_user_id,
        requested_by_user_id=payload.requested_by_user_id,
        total_bundle_count=payload.total_bundle_count,
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(transfer)
    db.flush()  # get transfer_id for PID and ledger reference

    # auto-generate PID if not supplied
    if not transfer.transfer_pid:
        transfer.transfer_pid = f"TRF-{transfer.transfer_id:06d}"

    ref_id = str(transfer.transfer_id)

    for item_in in payload.items:
        # determine the quantity that actually moved
        actual_out = item_in.quantity_released or item_in.quantity_requested
        actual_in  = item_in.quantity_received or actual_out

        db.add(models.InventoryTransferItem(
            transfer_id=transfer.transfer_id,
            variant_id=item_in.variant_id,
            quantity_requested=item_in.quantity_requested,
            quantity_released=item_in.quantity_released,
            quantity_received=item_in.quantity_received,
        ))

        # ── Non-Inventory / Service variants generate no ledger entries ────────
        variant_obj = (
            db.query(models.Variant)
            .options(selectinload(models.Variant.product))
            .filter_by(variant_id=item_in.variant_id)
            .first()
        )
        if not variant_obj or variant_obj.product.product_type in ("Non-Inventory", "Service"):
            continue

        # ── move stock: bundle explosion or direct variant ──────────────────
        components = _get_bundle_components(db, item_in.variant_id)
        if components:
            # Bundle variant: explode into components.
            # The InventoryTransferItem above records the bundle-level quantities
            # for the document trail; all actual stock / ledger / FIFO movements
            # happen at the component level.
            for comp in components:
                comp_variant = (
                    db.query(models.Variant)
                    .options(selectinload(models.Variant.product))
                    .filter_by(variant_id=comp.component_variant_id)
                    .first()
                )
                if not comp_variant or comp_variant.product.product_type in ("Non-Inventory", "Service"):
                    continue
                comp_out = actual_out * comp.quantity
                comp_in  = actual_in  * comp.quantity
                _move_variant(db, comp.component_variant_id,
                              payload.from_location_id, payload.to_location_id,
                              comp_out, comp_in, ref_id)
        else:
            _move_variant(db, item_in.variant_id,
                          payload.from_location_id, payload.to_location_id,
                          actual_out, actual_in, ref_id)

    db.commit()
    return _load_transfer(transfer.transfer_id, db)


# ── Admin-only header edit ────────────────────────────────────────────────────

class _HeaderPatch(schemas.BaseModel):
    transfer_pid: str | None = None
    released_by_user_id: int | None = None
    received_by_user_id: int | None = None
    requested_by_user_id: int | None = None
    total_bundle_count: int | None = None

    class Config:
        from_attributes = True


@router.put(
    "/{transfer_id}/header",
    response_model=schemas.TransferOut,
)
def update_transfer_header(
    transfer_id: int,
    payload: _HeaderPatch,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_permission("edit_transfer_header")),
):
    transfer = _load_transfer(transfer_id, db)

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(transfer, key, value)

    db.commit()
    return _load_transfer(transfer_id, db)
