# procurement/router.py
from __future__ import annotations
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from procurement import models as proc_models, schemas
from inventory import models as inv_models

router = APIRouter(prefix="/procurement", tags=["Procurement"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_po(po_id: int, db: Session) -> proc_models.PurchaseOrder:
    po = (
        db.query(proc_models.PurchaseOrder)
        .options(
            selectinload(proc_models.PurchaseOrder.supplier),
            selectinload(proc_models.PurchaseOrder.location),
            selectinload(proc_models.PurchaseOrder.items)
                .selectinload(proc_models.PurchaseOrderItem.variant),
        )
        .filter(proc_models.PurchaseOrder.po_id == po_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


def _load_shipment(shipment_id: int, db: Session) -> proc_models.InventoryShipment:
    shipment = (
        db.query(proc_models.InventoryShipment)
        .options(
            selectinload(proc_models.InventoryShipment.supplier),
            selectinload(proc_models.InventoryShipment.receiving_details),
        )
        .filter(proc_models.InventoryShipment.shipment_id == shipment_id)
        .first()
    )
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment


def _upsert_stock(db: Session, variant_id: int, location_id: int, delta: Decimal):
    stock = (
        db.query(inv_models.CurrentStock)
        .filter_by(variant_id=variant_id, location_id=location_id)
        .first()
    )
    if stock:
        stock.quantity += delta
    else:
        db.add(inv_models.CurrentStock(
            variant_id=variant_id,
            location_id=location_id,
            quantity=delta,
        ))


def _resolve_cost(
    db: Session,
    variant_id: int,
    po_item: proc_models.PurchaseOrderItem | None,
) -> tuple[Decimal, Decimal, Decimal]:
    """
    Returns (gross_cost, supplier_discount, net_unit_cost).

    Priority:
      1. PO item unit_cost (always gross cost, no discount applied at PO level)
      2. Primary VariantSupplier record
      3. Zero fallback
    """
    gross_cost       = Decimal('0')
    supplier_discount = Decimal('0')

    if po_item is not None:
        gross_cost = po_item.unit_cost
        # try to find a matching supplier discount from the primary VariantSupplier
        vs = (
            db.query(inv_models.VariantSupplier)
            .filter_by(variant_id=variant_id, is_primary=True)
            .first()
        )
        if vs and vs.supplier_discount:
            supplier_discount = vs.supplier_discount
    else:
        # no PO link — fall back to primary VariantSupplier record
        vs = (
            db.query(inv_models.VariantSupplier)
            .filter_by(variant_id=variant_id, is_primary=True)
            .first()
        )
        if vs:
            gross_cost        = vs.gross_cost or Decimal('0')
            supplier_discount = vs.supplier_discount or Decimal('0')

    net_unit_cost = gross_cost * (Decimal('1') - supplier_discount / Decimal('100'))
    return gross_cost, supplier_discount, net_unit_cost


def _recalculate_po_status(
    db: Session, po: proc_models.PurchaseOrder
) -> str | None:
    """
    Checks all PO items and returns the new status if it should change, else None.
    Only transitions from Open or Partially_Received.
    """
    if po.status not in ("Open", "Partially_Received"):
        return None

    items = (
        db.query(proc_models.PurchaseOrderItem)
        .filter(proc_models.PurchaseOrderItem.po_id == po.po_id)
        .all()
    )
    if not items:
        return None

    all_received  = all(i.received_quantity >= i.ordered_quantity for i in items)
    some_received = any(i.received_quantity > 0 for i in items)

    if all_received:
        return "Closed"
    if some_received:
        return "Partially_Received"
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# PURCHASE ORDERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/orders", response_model=List[schemas.POOut])
def list_purchase_orders(db: Session = Depends(get_db)):
    return (
        db.query(proc_models.PurchaseOrder)
        .options(
            selectinload(proc_models.PurchaseOrder.supplier),
            selectinload(proc_models.PurchaseOrder.location),
            selectinload(proc_models.PurchaseOrder.items)
                .selectinload(proc_models.PurchaseOrderItem.variant),
        )
        .order_by(proc_models.PurchaseOrder.po_id.desc())
        .all()
    )


@router.get("/orders/{po_id}", response_model=schemas.POOut)
def get_purchase_order(po_id: int, db: Session = Depends(get_db)):
    return _load_po(po_id, db)


@router.post("/orders", response_model=schemas.POOut, status_code=201)
def create_purchase_order(payload: schemas.POCreate, db: Session = Depends(get_db)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Purchase order must have at least one item")

    po = proc_models.PurchaseOrder(
        supplier_id=payload.supplier_id,
        location_id=payload.location_id,
        expected_arrival_date=payload.expected_arrival_date,
        created_by_user_id=payload.created_by_user_id,
        status="Draft",
        total_amount=Decimal('0'),
    )
    db.add(po)
    db.flush()  # get po_id for PID generation and item FKs

    # auto-generate PO PID if not provided
    po.po_pid = payload.po_pid or f"PO-{po.po_id:06d}"

    grand_total = Decimal('0')
    for item in payload.items:
        grand_total += item.unit_cost * item.ordered_quantity
        db.add(proc_models.PurchaseOrderItem(
            po_id=po.po_id,
            variant_id=item.variant_id,
            ordered_quantity=item.ordered_quantity,
            received_quantity=Decimal('0'),
            unit_cost=item.unit_cost,
        ))

    po.total_amount = grand_total
    db.commit()
    return _load_po(po.po_id, db)


@router.patch("/orders/{po_id}/status", response_model=schemas.POOut)
def update_po_status(
    po_id: int,
    payload: schemas.POStatusUpdate,
    db: Session = Depends(get_db),
):
    allowed = {"Draft", "Open", "Partially_Received", "Closed", "Cancelled"}
    if payload.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Allowed: {sorted(allowed)}",
        )
    po = _load_po(po_id, db)
    po.status = payload.status
    db.commit()
    return _load_po(po_id, db)


# ═══════════════════════════════════════════════════════════════════════════════
# SHIPMENTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/shipments", response_model=List[schemas.ShipmentOut])
def list_shipments(db: Session = Depends(get_db)):
    return (
        db.query(proc_models.InventoryShipment)
        .options(
            selectinload(proc_models.InventoryShipment.supplier),
            selectinload(proc_models.InventoryShipment.receiving_details),
        )
        .order_by(proc_models.InventoryShipment.shipment_id.desc())
        .all()
    )


@router.get("/shipments/{shipment_id}", response_model=schemas.ShipmentOut)
def get_shipment(shipment_id: int, db: Session = Depends(get_db)):
    return _load_shipment(shipment_id, db)


@router.post("/shipments", response_model=schemas.ShipmentOut, status_code=201)
def create_shipment(payload: schemas.ShipmentCreate, db: Session = Depends(get_db)):
    shipment = proc_models.InventoryShipment(
        supplier_id=payload.supplier_id,
        po_id=payload.po_id,
        reference_number=payload.reference_number,
        received_at=payload.received_at or datetime.now(timezone.utc),
    )
    db.add(shipment)
    db.flush()

    shipment.shipment_pid = payload.shipment_pid or f"SHP-{shipment.shipment_id:06d}"

    # auto-advance PO to Open if it is still in Draft
    if payload.po_id:
        po = db.query(proc_models.PurchaseOrder).filter_by(po_id=payload.po_id).first()
        if po and po.status == "Draft":
            po.status = "Open"

    db.commit()
    return _load_shipment(shipment.shipment_id, db)


# ── Receiving details ─────────────────────────────────────────────────────────

@router.post(
    "/shipments/{shipment_id}/details",
    response_model=schemas.ShipmentOut,
    status_code=201,
)
def add_receiving_details(
    shipment_id: int,
    details: List[schemas.ReceivingDetailCreate],
    db: Session = Depends(get_db),
):
    """Attach one or more receiving-detail rows to a shipment (QC data entry)."""
    _load_shipment(shipment_id, db)  # 404 guard

    for d in details:
        if not db.query(inv_models.Variant).filter(
            inv_models.Variant.variant_id == d.variant_id,
            inv_models.Variant.is_deleted == False,
        ).first():
            raise HTTPException(
                status_code=404, detail=f"Variant {d.variant_id} not found"
            )
        loc = db.query(inv_models.Location).filter(
            inv_models.Location.location_id == d.location_id,
            inv_models.Location.is_deleted == False,
        ).first()
        if not loc:
            raise HTTPException(
                status_code=404, detail=f"Location {d.location_id} not found"
            )
        if loc.status == "Inactive":
            raise HTTPException(
                status_code=400,
                detail=f"Location '{loc.location_name}' is inactive",
            )

        db.add(proc_models.ReceivingDetail(
            shipment_id=shipment_id,
            variant_id=d.variant_id,
            location_id=d.location_id,
            po_item_id=d.po_item_id,
            quantity_ordered=d.quantity_ordered,
            quantity_declared=d.quantity_declared,
            quantity_actual=d.quantity_actual,
            quantity_rejected=d.quantity_rejected,
            qc_status=d.qc_status,
        ))

    db.commit()
    return _load_shipment(shipment_id, db)


# ── Confirm shipment ──────────────────────────────────────────────────────────

@router.post("/shipments/{shipment_id}/confirm", response_model=schemas.ConfirmResult)
def confirm_shipment(shipment_id: int, db: Session = Depends(get_db)):
    """
    Confirm a shipment. For every non-deleted detail with QC status
    Passed or Partially_Passed this endpoint atomically:

      1. Writes an InventoryLedger entry  (reason = RECEIVE)
      2. Upserts CurrentStock
      3. Creates a CostLayer              (FIFO bucket)
      4. Updates PurchaseOrderItem.received_quantity  (if linked)
      5. Auto-advances the parent PO status

    All writes happen in a single transaction.
    """
    shipment = _load_shipment(shipment_id, db)

    passing_statuses = {"Passed", "Partially_Passed"}
    eligible = [
        d for d in shipment.receiving_details
        if not d.is_deleted and d.qc_status in passing_statuses
    ]

    if not eligible:
        raise HTTPException(
            status_code=400,
            detail="No passing receiving details to confirm on this shipment",
        )

    ledger_count     = 0
    cost_layer_count = 0
    po_status_new: str | None = None
    po: proc_models.PurchaseOrder | None = None

    if shipment.po_id:
        po = db.query(proc_models.PurchaseOrder).filter_by(po_id=shipment.po_id).first()

    for detail in eligible:
        qty = detail.quantity_actual

        # ── 1. resolve cost ───────────────────────────────────────────────────
        po_item: proc_models.PurchaseOrderItem | None = None
        if detail.po_item_id:
            po_item = (
                db.query(proc_models.PurchaseOrderItem)
                .filter_by(po_item_id=detail.po_item_id)
                .first()
            )

        gross_cost, supplier_discount, net_unit_cost = _resolve_cost(
            db, detail.variant_id, po_item
        )

        # ── 2. inventory ledger ───────────────────────────────────────────────
        db.add(inv_models.InventoryLedger(
            variant_id=detail.variant_id,
            location_id=detail.location_id,
            qty_change=qty,
            reason=inv_models.LedgerReason.RECEIVE,
            reference_type="inventory_shipments",
            reference_id=str(shipment_id),
        ))
        ledger_count += 1

        # ── 3. current stock ──────────────────────────────────────────────────
        _upsert_stock(db, detail.variant_id, detail.location_id, qty)

        # ── 4. cost layer (FIFO bucket) ───────────────────────────────────────
        db.add(inv_models.CostLayer(
            variant_id=detail.variant_id,
            location_id=detail.location_id,
            shipment_id=shipment_id,
            original_quantity=qty,
            quantity_remaining=qty,
            gross_cost=gross_cost,
            supplier_discount=supplier_discount,
            net_unit_cost=net_unit_cost,
        ))
        cost_layer_count += 1

        # ── 5. update PO item received qty ────────────────────────────────────
        if po_item:
            po_item.received_quantity = (po_item.received_quantity or Decimal('0')) + qty

    # ── 6. auto-advance PO status ─────────────────────────────────────────────
    if po:
        new_status = _recalculate_po_status(db, po)
        if new_status and new_status != po.status:
            po.status = new_status
            po_status_new = new_status

    db.commit()

    return schemas.ConfirmResult(
        shipment_id=shipment_id,
        details_confirmed=len(eligible),
        ledger_entries_written=ledger_count,
        cost_layers_created=cost_layer_count,
        po_status_updated=po_status_new,
    )
