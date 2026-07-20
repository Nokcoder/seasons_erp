# inventory/transfers_router.py
from typing import List
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_db
from core.doc_sequence import next_document_pid
from core.audit import write_audit, _serialize
from auth.dependencies import get_current_user, require_permission
from auth.models import User
from inventory import models, schemas
from settings.models import SystemSetting


def _get_allow_negative_stock(db: Session) -> bool:
    row = db.query(SystemSetting).filter_by(key="allow_negative_stock").first()
    return row.value == "true" if row else False

router = APIRouter(
    prefix="/transfers",
    tags=["Transfers"],
    dependencies=[Depends(get_current_user)],
)


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
            selectinload(models.InventoryTransfer.released_by_employee),
            selectinload(models.InventoryTransfer.received_by_employee),
            selectinload(models.InventoryTransfer.items)
                .selectinload(models.InventoryTransferItem.variant)
                .selectinload(models.Variant.product),
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
    allow_negative: bool = False,
) -> list[tuple[Decimal, Decimal]]:
    """
    Deduct qty from cost layers FIFO oldest-first (row-locks layers for concurrency safety).
    Returns [(units_taken, net_unit_cost), ...].
    Raises 400 on insufficient stock (skipped when allow_negative is True) or insufficient layers.
    """
    stock = (
        db.query(models.CurrentStock)
        .filter_by(variant_id=variant_id, location_id=location_id)
        .first()
    )
    available_stock = stock.quantity if stock else Decimal("0")
    if not allow_negative and available_stock < qty:
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
    if available < qty and not allow_negative:
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

    # When allow_negative and layers were depleted, cover remainder at zero cost
    # so the destination always receives matching FIFO layers.
    if remaining > 0 and allow_negative:
        consumed.append((remaining, Decimal("0")))

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
    out_reason: models.LedgerReason = models.LedgerReason.TRANSFER_OUT,
    in_reason: models.LedgerReason = models.LedgerReason.TRANSFER_IN,
    allow_negative: bool = False,
) -> None:
    """
    Write ledger entries, consume FIFO layers at source, create matching layers
    at destination, and update current_stocks — all for a single (non-bundle) variant.
    Pass out_reason=ADJUST / in_reason=ADJUST for stock adjustment movements.
    """
    _write_ledger(db, variant_id, from_location_id, -actual_out,
                  out_reason, "inventory_transfer", ref_id)
    _write_ledger(db, variant_id, to_location_id, actual_in,
                  in_reason, "inventory_transfer", ref_id)

    consumed = _consume_fifo(db, variant_id, from_location_id, actual_out,
                             allow_negative=allow_negative)
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


@router.get("/locations/{location_id}", response_model=schemas.LocationOut, dependencies=[Depends(require_permission("view_transfers"))])
def get_location(location_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(
        models.Location.location_id == location_id,
        models.Location.is_deleted == False,
    ).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    return loc


@router.post("/locations", response_model=schemas.LocationOut, status_code=201)
def create_location(
    payload: schemas.LocationCreate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_locations")),
):
    loc = models.Location(
        location_name=payload.location_name,
        location_type=payload.location_type,
        parent_location_id=payload.parent_location_id,
        address=payload.address,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    write_audit(db, "inventory.locations", str(loc.location_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(loc))
    db.commit()
    return loc


@router.put("/locations/{location_id}", response_model=schemas.LocationOut)
def update_location(
    location_id: int,
    payload: schemas.LocationUpdate,
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_locations"))):
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

@router.get("/", response_model=List[schemas.TransferOut], dependencies=[Depends(require_permission("view_transfers"))])
def list_transfers(db: Session = Depends(get_db)):
    return (
        db.query(models.InventoryTransfer)
        .options(
            selectinload(models.InventoryTransfer.from_location),
            selectinload(models.InventoryTransfer.to_location),
            selectinload(models.InventoryTransfer.released_by),
            selectinload(models.InventoryTransfer.received_by),
            selectinload(models.InventoryTransfer.requested_by),
            selectinload(models.InventoryTransfer.released_by_employee),
            selectinload(models.InventoryTransfer.received_by_employee),
            selectinload(models.InventoryTransfer.items)
                .selectinload(models.InventoryTransferItem.variant)
                .selectinload(models.Variant.product),
        )
        .order_by(models.InventoryTransfer.occurred_at.desc())
        .all()
    )


@router.get("/{transfer_id}", response_model=schemas.TransferOut, dependencies=[Depends(require_permission("view_transfers"))])
def get_transfer(transfer_id: int, db: Session = Depends(get_db)):
    return _load_transfer(transfer_id, db)


@router.post("/", response_model=schemas.TransferOut, status_code=201)
def create_transfer(
    payload: schemas.TransferCreate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("create_transfer")),
):
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

    allow_negative = _get_allow_negative_stock(db)

    # validate both locations exist, are not deleted, and are active;
    # capture them so we can detect Adjustment movements below
    _validated_locs: dict[int, models.Location] = {}
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
        _validated_locs[loc_id] = loc

    # use ADJUST reason when either end of the transfer is the Adjustment location
    _from_loc = _validated_locs[payload.from_location_id]
    _to_loc   = _validated_locs[payload.to_location_id]
    _is_adjustment = (
        _from_loc.location_name == "Adjustment" or
        _to_loc.location_name   == "Adjustment"
    )
    _out_reason = models.LedgerReason.ADJUST if _is_adjustment else models.LedgerReason.TRANSFER_OUT
    _in_reason  = models.LedgerReason.ADJUST if _is_adjustment else models.LedgerReason.TRANSFER_IN

    transfer = models.InventoryTransfer(
        transfer_pid=payload.transfer_pid,
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        released_by_user_id=payload.released_by_user_id,
        received_by_user_id=payload.received_by_user_id,
        requested_by_user_id=payload.requested_by_user_id,
        released_by_employee_id=payload.released_by_employee_id,
        received_by_employee_id=payload.received_by_employee_id,
        total_bundle_count=payload.total_bundle_count,
        occurred_at=payload.occurred_at or datetime.now(timezone.utc),
    )
    db.add(transfer)
    db.flush()  # get transfer_id for PID and ledger reference

    # auto-generate PID if not supplied
    if not transfer.transfer_pid:
        transfer.transfer_pid = next_document_pid(db, "TRF")

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
                              comp_out, comp_in, ref_id,
                              out_reason=_out_reason, in_reason=_in_reason,
                              allow_negative=allow_negative)
        else:
            _move_variant(db, item_in.variant_id,
                          payload.from_location_id, payload.to_location_id,
                          actual_out, actual_in, ref_id,
                          out_reason=_out_reason, in_reason=_in_reason,
                          allow_negative=allow_negative)

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


# ── Void transfer ─────────────────────────────────────────────────────────────

class _VoidRequest(schemas.BaseModel):
    void_reason: str

    class Config:
        from_attributes = True


@router.post("/{transfer_id}/void", response_model=schemas.TransferOut)
def void_transfer(
    transfer_id: int,
    payload: _VoidRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("create_transfer")),
):
    """Void a Posted transfer, reversing all ledger entries and stock movements.

    Only Posted transfers can be voided. A Voided transfer is terminal.
    For each item, the reversal writes:
      - TRANSFER_IN  at the source location  (+qty back to source)
      - TRANSFER_OUT at the destination location (-qty removed from destination)
    FIFO layers transferred to the destination are consumed; source layers are restored.
    """
    transfer = _load_transfer(transfer_id, db)

    if transfer.status != "Posted":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot void a transfer with status '{transfer.status}'",
        )

    ref_id = str(transfer.transfer_id)

    for item in transfer.items:
        actual_out = item.quantity_released or item.quantity_requested
        actual_in  = item.quantity_received or actual_out

        variant_obj = (
            db.query(models.Variant)
            .options(selectinload(models.Variant.product))
            .filter_by(variant_id=item.variant_id)
            .first()
        )
        if not variant_obj or variant_obj.product.product_type in ("Non-Inventory", "Service"):
            continue

        # Reversal: move stock BACK from destination to source
        components = _get_bundle_components(db, item.variant_id)
        if components:
            for comp in components:
                comp_variant = (
                    db.query(models.Variant)
                    .options(selectinload(models.Variant.product))
                    .filter_by(variant_id=comp.component_variant_id)
                    .first()
                )
                if not comp_variant or comp_variant.product.product_type in ("Non-Inventory", "Service"):
                    continue
                comp_out = actual_in  * comp.quantity   # take back what was sent to destination
                comp_in  = actual_out * comp.quantity   # return to source
                _move_variant(db, comp.component_variant_id,
                              transfer.to_location_id, transfer.from_location_id,
                              comp_out, comp_in, ref_id)
        else:
            _move_variant(db, item.variant_id,
                          transfer.to_location_id, transfer.from_location_id,
                          actual_in, actual_out, ref_id)

    transfer.status      = "Voided"
    transfer.voided_at   = datetime.now(timezone.utc)
    transfer.void_reason = payload.void_reason

    db.commit()
    return _load_transfer(transfer_id, db)
