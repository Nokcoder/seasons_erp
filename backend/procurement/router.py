# procurement/router.py
from __future__ import annotations
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, timezone, date, timedelta
from uuid import uuid4

import io

import xlsxwriter
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_db
from core.doc_sequence import next_document_pid
from core.audit import write_audit, _serialize
from auth.dependencies import get_current_user, require_permission
from auth.models import User as AuthUser
from procurement import models as proc_models, schemas
from inventory import models as inv_models
from ap import models as ap_models
from sales import models as sales_models

router = APIRouter(
    prefix="/procurement",
    tags=["Procurement"],
    dependencies=[Depends(get_current_user)],
)


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
            selectinload(proc_models.InventoryShipment.received_by_employee),
            selectinload(proc_models.InventoryShipment.inspected_by_employee),
            selectinload(proc_models.InventoryShipment.receiving_details)
                .selectinload(proc_models.ReceivingDetail.variant)
                .selectinload(inv_models.Variant.product),
        )
        .filter(proc_models.InventoryShipment.shipment_id == shipment_id)
        .first()
    )
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment


def _compute_po_unit_cost(gross_cost: Decimal, discount_pct: Decimal) -> Decimal:
    return gross_cost * (Decimal('1') - discount_pct / Decimal('100'))


def _upsert_stock(db: Session, variant_id: int, location_id: int, delta: Decimal):
    """Atomically add delta to current_stocks, creating the row if it doesn't exist."""
    tbl  = inv_models.CurrentStock.__table__
    stmt = (
        pg_insert(tbl)
        .values(variant_id=variant_id, location_id=location_id, quantity=delta)
        .on_conflict_do_update(
            constraint="uq_current_stocks_variant_location",
            set_={"quantity": tbl.c.quantity + delta},
        )
    )
    db.execute(stmt)


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

@router.get("/variant-supplier-cost", response_model=schemas.VariantSupplierCostOut, dependencies=[Depends(require_permission("view_purchase_orders"))])
def get_variant_supplier_cost(
    variant_id: int,
    supplier_id: int,
    db: Session = Depends(get_db),
):
    """Returns the primary variant_suppliers cost record for a variant/supplier pair,
    used to auto-populate gross_cost and discount_pct when adding a line item to a PO."""
    vs = (
        db.query(inv_models.VariantSupplier)
        .filter_by(variant_id=variant_id, supplier_id=supplier_id, is_primary=True)
        .first()
    )
    if not vs:
        raise HTTPException(status_code=404, detail="No primary supplier cost record found")
    return schemas.VariantSupplierCostOut(
        gross_cost=vs.gross_cost or Decimal('0'),
        discount_pct=vs.supplier_discount or Decimal('0'),
    )


@router.get("/orders", response_model=List[schemas.POOut], dependencies=[Depends(require_permission("view_purchase_orders"))])
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


@router.get("/orders/{po_id}", response_model=schemas.POOut, dependencies=[Depends(require_permission("view_purchase_orders"))])
def get_purchase_order(po_id: int, db: Session = Depends(get_db)):
    return _load_po(po_id, db)


@router.post("/orders", response_model=schemas.POOut, status_code=201)
def create_purchase_order(
    payload: schemas.POCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_purchase_orders")),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Purchase order must have at least one item")

    po = proc_models.PurchaseOrder(
        # po_pid is NOT NULL; use caller-supplied value or a unique placeholder.
        # If auto-generating, we need po_id first — replace after flush.
        po_pid=payload.po_pid or f"_tmp_{uuid4().hex}",
        supplier_id=payload.supplier_id,
        location_id=payload.location_id,
        expected_arrival_date=payload.expected_arrival_date,
        created_by_user_id=payload.created_by_user_id,
        status="Draft",
        total_amount=Decimal('0'),
    )
    db.add(po)
    db.flush()  # get po_id

    if not payload.po_pid:
        po.po_pid = next_document_pid(db, "PO")

    grand_total = Decimal('0')
    for item in payload.items:
        unit_cost = _compute_po_unit_cost(item.gross_cost, item.discount_pct)
        grand_total += unit_cost * item.ordered_quantity
        db.add(proc_models.PurchaseOrderItem(
            po_id=po.po_id,
            variant_id=item.variant_id,
            ordered_quantity=item.ordered_quantity,
            received_quantity=Decimal('0'),
            gross_cost=item.gross_cost,
            discount_pct=item.discount_pct,
            unit_cost=unit_cost,
        ))

    po.total_amount = grand_total
    db.commit()
    write_audit(db, "procurement.purchase_orders", str(po.po_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(po))
    db.commit()
    return _load_po(po.po_id, db)


_PO_TRANSITIONS: dict[str, set[str]] = {
    "Draft":              {"Open", "Cancelled"},
    "Open":               {"Partially_Received", "Closed", "Cancelled"},
    "Partially_Received": {"Closed", "Cancelled"},
    "Closed":             set(),
    "Cancelled":          set(),
}


@router.put("/orders/{po_id}/items/{po_item_id}", response_model=schemas.POOut)
def update_po_item(
    po_id: int,
    po_item_id: int,
    payload: schemas.POItemUpdate,
    db: Session = Depends(get_db), _actor: AuthUser = Depends(require_permission("manage_purchase_orders"))):
    """Update ordered_quantity or unit_cost on a PO line item.

    Only allowed when the PO is in Draft or Open status.
    Recalculates PO total_amount after the update.
    """
    po = _load_po(po_id, db)
    if po.status not in ("Draft", "Open"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit items on a PO in '{po.status}' status",
        )

    item = (
        db.query(proc_models.PurchaseOrderItem)
        .filter(
            proc_models.PurchaseOrderItem.po_item_id == po_item_id,
            proc_models.PurchaseOrderItem.po_id == po_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="PO line item not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(item, key, value)

    # unit_cost is always server-computed, never accepted from the caller
    item.unit_cost = _compute_po_unit_cost(item.gross_cost, item.discount_pct)

    # recalculate PO total
    all_items = (
        db.query(proc_models.PurchaseOrderItem)
        .filter(proc_models.PurchaseOrderItem.po_id == po_id)
        .all()
    )
    po.total_amount = sum(i.ordered_quantity * i.unit_cost for i in all_items)

    db.commit()
    return _load_po(po_id, db)


@router.patch("/orders/{po_id}/status", response_model=schemas.POOut)
def update_po_status(
    po_id: int,
    payload: schemas.POStatusUpdate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_purchase_orders")),
):
    po = _load_po(po_id, db)
    allowed_next = _PO_TRANSITIONS.get(po.status, set())
    if payload.status not in allowed_next:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot transition PO from '{po.status}' to '{payload.status}'. "
                f"Valid next statuses: {sorted(allowed_next) if allowed_next else ['none — terminal state']}"
            ),
        )
    old = _serialize(po)
    po.status = payload.status
    db.commit()
    write_audit(db, "procurement.purchase_orders", str(po_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(po))
    db.commit()
    return _load_po(po_id, db)


# ═══════════════════════════════════════════════════════════════════════════════
# SHIPMENTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/shipments", response_model=List[schemas.ShipmentOut], dependencies=[Depends(require_permission("view_receiving"))])
def list_shipments(db: Session = Depends(get_db)):
    return (
        db.query(proc_models.InventoryShipment)
        .options(
            selectinload(proc_models.InventoryShipment.supplier),
            selectinload(proc_models.InventoryShipment.purchase_order),
            selectinload(proc_models.InventoryShipment.received_by_employee),
            selectinload(proc_models.InventoryShipment.inspected_by_employee),
            selectinload(proc_models.InventoryShipment.receiving_details)
                .selectinload(proc_models.ReceivingDetail.variant)
                .selectinload(inv_models.Variant.product),
        )
        .order_by(proc_models.InventoryShipment.shipment_id.desc())
        .all()
    )


@router.get("/shipments/{shipment_id}", response_model=schemas.ShipmentOut, dependencies=[Depends(require_permission("view_receiving"))])
def get_shipment(shipment_id: int, db: Session = Depends(get_db)):
    return _load_shipment(shipment_id, db)


@router.post("/shipments", response_model=schemas.ShipmentOut, status_code=201)
def create_shipment(payload: schemas.ShipmentCreate, db: Session = Depends(get_db), _actor: AuthUser = Depends(require_permission("create_shipment"))):
    shipment = proc_models.InventoryShipment(
        supplier_id=payload.supplier_id,
        po_id=payload.po_id,
        reference_number=payload.reference_number,
        received_at=payload.received_at or datetime.now(timezone.utc),
        received_by_user_id=payload.received_by_user_id,
        inspected_by_user_id=payload.inspected_by_user_id,
        received_by_employee_id=payload.received_by_employee_id,
        inspected_by_employee_id=payload.inspected_by_employee_id,
        is_confirmed=False,
    )
    db.add(shipment)
    db.flush()

    shipment.shipment_pid = payload.shipment_pid or next_document_pid(db, "SHP")

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
    db: Session = Depends(get_db), _actor: AuthUser = Depends(require_permission("create_shipment"))):
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
            received_at=d.received_at,
            inspected_at=d.inspected_at,
            quantity_ordered=d.quantity_ordered,
            quantity_declared=d.quantity_declared,
            quantity_actual=d.quantity_actual,
            quantity_rejected=d.quantity_rejected,
            qc_status=d.qc_status,
        ))

    db.commit()
    return _load_shipment(shipment_id, db)


# ── Confirm shipment — DEPRECATED ────────────────────────────────────────────
# This one-step endpoint has been replaced by the two-stage workflow:
#   Stage 1: POST /shipments/{id}/receive       (ledger + stock)
#   Stage 2: POST /shipments/{id}/confirm-costs (cost layers + invoice)

@router.post("/shipments/{shipment_id}/confirm")
def confirm_shipment_deprecated(shipment_id: int, _actor: AuthUser = Depends(require_permission("confirm_shipment"))):
    """Deprecated — use the two-stage workflow instead."""
    raise HTTPException(
        status_code=410,
        detail=(
            "POST /shipments/{id}/confirm is deprecated. "
            "Use the two-stage workflow: "
            "POST /shipments/{id}/receive (Stage 1 — ledger + stock), "
            "then POST /shipments/{id}/confirm-costs (Stage 2 — cost layers + invoice)."
        ),
    )


# ── Discrepancy tracking ──────────────────────────────────────────────────────

_VALID_DISCREPANCY_STATUSES = {"None", "Flagged", "Supplier_Notified", "Resolved", "Waived"}


@router.patch("/shipments/{shipment_id}/discrepancy", response_model=schemas.ShipmentOut)
def update_shipment_discrepancy(
    shipment_id: int,
    payload: schemas.ShipmentDiscrepancyUpdate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_purchase_orders")),
):
    """Update discrepancy_status and optionally discrepancy_notes on a shipment."""
    if payload.discrepancy_status not in _VALID_DISCREPANCY_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid discrepancy_status '{payload.discrepancy_status}'. "
                f"Must be one of: {sorted(_VALID_DISCREPANCY_STATUSES)}"
            ),
        )

    shipment = _load_shipment(shipment_id, db)
    old = _serialize(shipment)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(shipment, field, value)

    db.commit()
    write_audit(
        db, "procurement.inventory_shipments", str(shipment_id), "UPDATE",
        actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(shipment),
    )
    db.commit()
    return _load_shipment(shipment_id, db)


# ── Stage 1: receive — writes ledger entries only, no cost layers ─────────────

@router.post("/shipments/{shipment_id}/receive", response_model=schemas.ReceiveResult)
def receive_shipment(
    shipment_id: int,
    db: Session = Depends(get_db), _actor: AuthUser = Depends(require_permission("confirm_shipment"))):
    """Stage 1 receive: write RECEIVE ledger entries and update current_stocks for all
    non-deleted details. No cost layers created. Shipment is left as is_confirmed=False."""
    shipment = _load_shipment(shipment_id, db)

    ledger_count = 0
    for detail in shipment.receiving_details:
        if detail.is_deleted:
            continue
        qty = detail.quantity_actual or Decimal("0")
        if qty <= 0:
            continue

        variant_obj = (
            db.query(inv_models.Variant)
            .options(selectinload(inv_models.Variant.product))
            .filter_by(variant_id=detail.variant_id)
            .first()
        )
        if not variant_obj or variant_obj.product.product_type in ("Non-Inventory", "Service"):
            continue

        db.add(inv_models.InventoryLedger(
            variant_id=detail.variant_id,
            location_id=detail.location_id,
            qty_change=qty,
            reason=inv_models.LedgerReason.RECEIVE,
            reference_type="inventory_shipments",
            reference_id=str(shipment_id),
        ))
        ledger_count += 1
        _upsert_stock(db, detail.variant_id, detail.location_id, qty)

        if detail.po_item_id:
            po_item = (
                db.query(proc_models.PurchaseOrderItem)
                .filter_by(po_item_id=detail.po_item_id)
                .first()
            )
            if po_item:
                net_received = qty - (detail.quantity_rejected or Decimal("0"))
                po_item.received_quantity = (po_item.received_quantity or Decimal("0")) + net_received

    if shipment.po_id:
        po = (
            db.query(proc_models.PurchaseOrder)
            .filter_by(po_id=shipment.po_id)
            .first()
        )
        if po:
            new_status = _recalculate_po_status(db, po)
            if new_status:
                po.status = new_status

    db.commit()
    return schemas.ReceiveResult(shipment_id=shipment_id, ledger_entries_written=ledger_count)


# ── Stage 2 autofill — pre-fills gross_cost / discount_pct per line ───────────

@router.get("/shipment-cost-autofill", response_model=List[schemas.CostAutofillItem], dependencies=[Depends(require_permission("view_receiving"))])
def shipment_cost_autofill(shipment_id: int, db: Session = Depends(get_db)):
    """For each receiving_detail on the shipment, resolve a starting gross_cost +
    discount_pct so the Confirm Costs page can pre-fill the line items.

    Priority:
      1. Most recent cost_layer for this variant + the shipment's supplier
         (joined via inventory_shipments.supplier_id), newest created_at first.
      2. The matching variant_suppliers record (variant_id, supplier_id).
      3. Nulls — caller must enter costs manually.
    """
    shipment = _load_shipment(shipment_id, db)
    results: list[schemas.CostAutofillItem] = []

    for detail in shipment.receiving_details:
        if detail.is_deleted:
            continue

        layer = (
            db.query(inv_models.CostLayer)
            .join(
                proc_models.InventoryShipment,
                inv_models.CostLayer.shipment_id == proc_models.InventoryShipment.shipment_id,
            )
            .filter(
                inv_models.CostLayer.variant_id == detail.variant_id,
                proc_models.InventoryShipment.supplier_id == shipment.supplier_id,
            )
            .order_by(inv_models.CostLayer.created_at.desc())
            .first()
        )

        if layer is not None:
            gross_cost    = layer.gross_cost
            discount_pct  = layer.supplier_discount or Decimal('0')
            source        = "cost_layer"
        else:
            vs = (
                db.query(inv_models.VariantSupplier)
                .filter_by(variant_id=detail.variant_id, supplier_id=shipment.supplier_id)
                .first()
            )
            if vs is not None and vs.gross_cost is not None:
                gross_cost   = vs.gross_cost
                discount_pct = vs.supplier_discount or Decimal('0')
                source       = "variant_suppliers"
            else:
                gross_cost = discount_pct = None
                source     = "none"

        net_unit_cost = None
        if gross_cost is not None:
            net_unit_cost = gross_cost * (Decimal('1') - discount_pct / Decimal('100'))

        results.append(schemas.CostAutofillItem(
            detail_id=detail.detail_id,
            variant_id=detail.variant_id,
            gross_cost=gross_cost,
            discount_pct=discount_pct,
            net_unit_cost=net_unit_cost,
            source=source,
        ))

    return results


# ── Stage 2: confirm-costs — creates cost layers and supplier invoice ──────────

@router.post("/shipments/{shipment_id}/confirm-costs", response_model=schemas.ShipmentOut)
def confirm_costs(
    shipment_id: int,
    payload: schemas.ConfirmCostsRequest,
    db: Session = Depends(get_db), _actor: AuthUser = Depends(require_permission("confirm_shipment"))):
    """Stage 2 cost confirmation: create FIFO cost layers at the provided gross
    cost + discount per line, update variant_suppliers (gross_cost + discount),
    record the supplier invoice (invoice_number/invoice_date/due_date) and AP
    ledger entry, mark shipment as is_confirmed=True."""
    shipment = _load_shipment(shipment_id, db)

    if shipment.is_confirmed:
        raise HTTPException(status_code=400, detail="Shipment is already confirmed")

    for item in payload.items:
        if item.gross_cost <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Gross cost must be greater than 0 for detail {item.detail_id}",
            )
        if not (Decimal('0') <= item.discount_pct <= Decimal('100')):
            raise HTTPException(
                status_code=400,
                detail=f"Discount % must be between 0 and 100 for detail {item.detail_id}",
            )

    detail_map = {d.detail_id: d for d in shipment.receiving_details if not d.is_deleted}
    items_by_detail = {item.detail_id: item for item in payload.items}
    net_unit_cost_by_detail: dict[int, Decimal] = {}

    invoice_total = Decimal("0")

    for detail_id, item in items_by_detail.items():
        detail = detail_map.get(detail_id)
        if not detail:
            continue
        qty = detail.quantity_actual or Decimal("0")
        if qty <= 0:
            continue

        variant_obj = (
            db.query(inv_models.Variant)
            .options(selectinload(inv_models.Variant.product))
            .filter_by(variant_id=detail.variant_id)
            .first()
        )
        if not variant_obj or variant_obj.product.product_type in ("Non-Inventory", "Service"):
            continue

        net_unit_cost = item.gross_cost * (Decimal('1') - item.discount_pct / Decimal('100'))
        net_unit_cost_by_detail[detail_id] = net_unit_cost

        db.add(inv_models.CostLayer(
            variant_id=detail.variant_id,
            location_id=detail.location_id,
            shipment_id=shipment_id,
            original_quantity=qty,
            quantity_remaining=qty,
            gross_cost=item.gross_cost,
            supplier_discount=item.discount_pct,
            net_unit_cost=net_unit_cost,
        ))

        # Update variant_suppliers (gross_cost + supplier_discount) for this supplier,
        # creating the record if it doesn't exist yet.
        vs = (
            db.query(inv_models.VariantSupplier)
            .filter_by(variant_id=detail.variant_id, supplier_id=shipment.supplier_id)
            .first()
        )
        if vs:
            vs.gross_cost = item.gross_cost
            vs.supplier_discount = item.discount_pct
        else:
            db.add(inv_models.VariantSupplier(
                variant_id=detail.variant_id,
                supplier_id=shipment.supplier_id,
                gross_cost=item.gross_cost,
                supplier_discount=item.discount_pct,
            ))

        invoice_total += qty * net_unit_cost

    # Update inspected_by if provided
    if payload.inspected_by_employee_id is not None:
        shipment.inspected_by_employee_id = payload.inspected_by_employee_id

    shipment.is_confirmed = True

    # ── Build invoice line items from linked PO ───────────────────────────────
    # One SupplierInvoiceItem per PO line.  Only attempted when the shipment
    # has a linked PO; unlinked shipments fall back to the existing lump total.
    line_items_data: list[dict] = []
    if shipment.po_id:
        po = (
            db.query(proc_models.PurchaseOrder)
            .options(selectinload(proc_models.PurchaseOrder.items))
            .filter_by(po_id=shipment.po_id)
            .first()
        )
        if po and po.items:
            # First non-deleted receiving detail per variant (one-per-variant assumption).
            # Shipments with multiple details for the same variant on different locations
            # will only match the first encountered detail.
            detail_by_variant: dict[int, proc_models.ReceivingDetail] = {}
            for d in shipment.receiving_details:
                if not d.is_deleted and d.variant_id not in detail_by_variant:
                    detail_by_variant[d.variant_id] = d

            for po_item in po.items:
                detail = detail_by_variant.get(po_item.variant_id)

                # Prefer the accountant-supplied cost from the payload; fall back
                # to _resolve_cost when this PO item's variant had no detail costed.
                if detail and detail.detail_id in net_unit_cost_by_detail:
                    unit_cost = net_unit_cost_by_detail[detail.detail_id]
                else:
                    _, _, unit_cost = _resolve_cost(db, po_item.variant_id, po_item)

                recv_qty = (detail.quantity_actual   or Decimal('0')) if detail else Decimal('0')
                rej_qty  = (detail.quantity_rejected or Decimal('0')) if detail else Decimal('0')
                line_tot = recv_qty * unit_cost

                line_items_data.append({
                    'po_item_id':       po_item.po_item_id,
                    'variant_id':       po_item.variant_id,
                    'ordered_qty':      po_item.ordered_quantity,
                    'received_qty':     recv_qty,
                    'rejected_qty':     rej_qty,
                    'billed_qty':       recv_qty,
                    'billed_unit_cost': unit_cost,
                    'line_total':       line_tot,
                })

    # When line items were built, replace the running total with their sum so
    # the invoice and ledger reflect the PO-grounded figures.
    if line_items_data:
        invoice_total = sum(d['line_total'] for d in line_items_data)

    # ── Create supplier invoice + AP ledger entry ─────────────────────────────
    supplier = db.query(inv_models.Supplier).filter_by(supplier_id=shipment.supplier_id).first()
    due_date = payload.due_date or (
        payload.invoice_date + timedelta(days=supplier.terms if supplier and supplier.terms else 0)
    )

    invoice = ap_models.SupplierInvoice(
        supplier_id=shipment.supplier_id,
        shipment_id=shipment_id,
        invoice_number=payload.invoice_number,
        invoice_date=payload.invoice_date,
        due_date=due_date,
        total_amount=invoice_total,
        status="Unpaid",
    )
    db.add(invoice)
    db.flush()  # populate invoice.invoice_id before referencing it below

    # Add line items now that invoice_id is available — same transaction as
    # the invoice and cost layers so any failure rolls everything back.
    for d in line_items_data:
        db.add(ap_models.SupplierInvoiceItem(invoice_id=invoice.invoice_id, **d))

    db.add(ap_models.ApLedger(
        supplier_id=shipment.supplier_id,
        amount_change=invoice_total,
        reason="INVOICE",
        reference_type="supplier_invoices",
        reference_id=str(invoice.invoice_id),
    ))

    db.commit()
    return _load_shipment(shipment_id, db)


# ── Export confirmed shipment as an invoice XLSX ───────────────────────────────

@router.get("/shipments/{shipment_id}/export", dependencies=[Depends(require_permission("view_receiving"))])
def export_shipment_invoice(shipment_id: int, db: Session = Depends(get_db)):
    """Export a confirmed shipment as a two-sheet invoice workbook
    (Invoice Summary, Line Items). 404 if the shipment isn't confirmed yet."""
    shipment = _load_shipment(shipment_id, db)
    if not shipment.is_confirmed:
        raise HTTPException(status_code=404, detail="Shipment is not confirmed")

    invoice = (
        db.query(ap_models.SupplierInvoice)
        .filter_by(shipment_id=shipment_id)
        .order_by(ap_models.SupplierInvoice.invoice_id.desc())
        .first()
    )

    layers = (
        db.query(inv_models.CostLayer)
        .options(
            selectinload(inv_models.CostLayer.variant)
                .selectinload(inv_models.Variant.product),
        )
        .filter_by(shipment_id=shipment_id)
        .all()
    )
    layers.sort(key=lambda l: (l.variant.PID if l.variant else ""))

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {"in_memory": True})
    hdr = wb.add_format({"bold": True, "bg_color": "#1f2937", "font_color": "#f3f4f6",
                          "border": 1, "border_color": "#374151"})
    money = wb.add_format({"num_format": "#,##0.00"})
    pct = wb.add_format({"num_format": "0.00"})

    # Sheet 1 — Invoice Summary
    ws1 = wb.add_worksheet("Invoice Summary")
    summary_rows = [
        ("Shipment PID",   shipment.shipment_pid or ""),
        ("Supplier",       shipment.supplier.supplier_name if shipment.supplier else ""),
        ("Invoice Number", invoice.invoice_number if invoice else ""),
        ("Invoice Date",   invoice.invoice_date.isoformat() if invoice and invoice.invoice_date else ""),
        ("Date Received",  shipment.received_at.isoformat() if shipment.received_at else ""),
        ("Due Date",       invoice.due_date.isoformat() if invoice and invoice.due_date else ""),
        ("Total Amount",   float(invoice.total_amount) if invoice and invoice.total_amount is not None else 0),
    ]
    for i, (label, _) in enumerate(summary_rows):
        ws1.write(0, i, label, hdr)
    for i, (_, value) in enumerate(summary_rows):
        if isinstance(value, float):
            ws1.write_number(1, i, value, money)
        else:
            ws1.write(1, i, value)
    for i, (label, _) in enumerate(summary_rows):
        ws1.set_column(i, i, max(len(label) + 4, 16))

    # Sheet 2 — Line Items
    ws2 = wb.add_worksheet("Line Items")
    headers = ["PID", "Variant Name", "Brand", "Qty Received", "Gross Cost",
               "Discount %", "Net Unit Cost", "Line Total"]
    for i, h in enumerate(headers):
        ws2.write(0, i, h, hdr)
        ws2.set_column(i, i, max(len(h) + 4, 14))

    for row, layer in enumerate(layers, start=1):
        variant = layer.variant
        qty = layer.original_quantity or Decimal('0')
        line_total = qty * (layer.net_unit_cost or Decimal('0'))
        ws2.write(row, 0, variant.PID if variant else "")
        ws2.write(row, 1, variant.variant_name if variant else "")
        ws2.write(row, 2, (variant.product.brand if variant and variant.product else "") or "")
        ws2.write_number(row, 3, float(qty), money)
        ws2.write_number(row, 4, float(layer.gross_cost or 0), money)
        ws2.write_number(row, 5, float(layer.supplier_discount or 0), pct)
        ws2.write_number(row, 6, float(layer.net_unit_cost or 0), money)
        ws2.write_number(row, 7, float(line_total), money)

    wb.close()
    output.seek(0)
    filename = f"{shipment.shipment_pid or shipment_id}_invoice.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SUPPLIER RETURNS
# ═══════════════════════════════════════════════════════════════════════════════

_SRET_TRANSITIONS: dict[str, set[str]] = {
    "Draft":           {"Shipped"},
    "Shipped":         {"Credit_Received"},
    "Credit_Received": set(),     # terminal
}


def _load_supplier_return(return_id: int, db: Session) -> sales_models.SupplierReturn:
    ret = (
        db.query(sales_models.SupplierReturn)
        .options(
            selectinload(sales_models.SupplierReturn.supplier),
            selectinload(sales_models.SupplierReturn.items)
                .selectinload(sales_models.SupplierReturnItem.variant),
        )
        .filter(sales_models.SupplierReturn.return_id == return_id)
        .first()
    )
    if not ret:
        raise HTTPException(status_code=404, detail="Supplier return not found")
    return ret


@router.post("/supplier-returns",
             response_model=schemas.SupplierReturnOut,
             status_code=201)
def create_supplier_return(
    payload: schemas.SupplierReturnCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_suppliers")),
):
    """Create a supplier return in Draft status.

    Validates that sufficient stock exists at the source location for every item
    before writing any records (Requirements §15.1).
    total_credit_amount is auto-computed from item unit_credit_expected × quantity
    when not explicitly provided.
    """
    # Validate supplier
    supplier = db.query(inv_models.Supplier).filter(
        inv_models.Supplier.supplier_id == payload.supplier_id,
        inv_models.Supplier.is_deleted == False,
    ).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # Validate source location
    if not db.query(inv_models.Location).filter(
        inv_models.Location.location_id == payload.location_id,
        inv_models.Location.is_deleted == False,
    ).first():
        raise HTTPException(status_code=404, detail="Source location not found")

    if not payload.items:
        raise HTTPException(
            status_code=400, detail="Supplier return must have at least one item"
        )

    # Pre-validate all items: variant exists + sufficient stock at source location
    for item in payload.items:
        if not db.query(inv_models.Variant).filter(
            inv_models.Variant.variant_id == item.variant_id,
            inv_models.Variant.is_deleted == False,
        ).first():
            raise HTTPException(
                status_code=400, detail=f"Variant {item.variant_id} not found"
            )
        stock = db.query(inv_models.CurrentStock).filter_by(
            variant_id=item.variant_id, location_id=payload.location_id
        ).first()
        available = stock.quantity if stock else Decimal("0")
        if available < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient stock for variant {item.variant_id} at location "
                    f"{payload.location_id}: need {item.quantity}, available {available}"
                ),
            )

    # Resolve total_credit_amount
    if payload.total_credit_amount is not None:
        total_credit = payload.total_credit_amount
    else:
        total_credit = sum(
            (item.quantity * (item.unit_credit_expected or Decimal("0")))
            for item in payload.items
        )
        total_credit = Decimal(str(total_credit))

    # Create the return header
    ret = sales_models.SupplierReturn(
        supplier_id=payload.supplier_id,
        location_id=payload.location_id,
        status="Draft",
        total_credit_amount=total_credit,
        created_by_user_id=_actor.user_id,
    )
    db.add(ret)
    db.flush()   # materialise return_id for PID and item FKs
    ret.return_pid = next_document_pid(db, "SRET")

    for item in payload.items:
        db.add(sales_models.SupplierReturnItem(
            return_id=ret.return_id,
            variant_id=item.variant_id,
            cost_layer_id=item.cost_layer_id,
            quantity=item.quantity,
            unit_credit_expected=item.unit_credit_expected,
        ))

    db.commit()
    return _load_supplier_return(ret.return_id, db)


@router.patch("/supplier-returns/{return_id}/status",
              response_model=schemas.SupplierReturnOut)
def update_supplier_return_status(
    return_id: int,
    payload: schemas.SupplierReturnStatusPatch,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_suppliers")),
):
    """Advance a supplier return through its lifecycle.

    Draft → Shipped:
        Writes RETURN_OUT inventory_ledger entries and updates current_stocks
        for every Inventory-type item at the source location.
    Shipped → Credit_Received:
        Writes a CREDIT_MEMO entry to ap_ledger reducing the amount owed to the
        supplier by total_credit_amount (Requirements §15.2).
    """
    ret = _load_supplier_return(return_id, db)

    allowed = _SRET_TRANSITIONS.get(ret.status, set())
    if payload.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot transition supplier return from '{ret.status}' to "
                f"'{payload.status}'. Allowed next status: "
                f"{sorted(allowed) if allowed else 'none — this status is terminal'}"
            ),
        )

    ref_id = str(ret.return_id)

    if payload.status == "Shipped":
        # Write RETURN_OUT + update current_stocks for each Inventory item
        for item in ret.items:
            variant_obj = (
                db.query(inv_models.Variant)
                .options(selectinload(inv_models.Variant.product))
                .filter_by(variant_id=item.variant_id)
                .first()
            )
            if (not variant_obj or
                    variant_obj.product.product_type in ("Non-Inventory", "Service")):
                continue

            db.add(inv_models.InventoryLedger(
                variant_id=item.variant_id,
                location_id=ret.location_id,
                qty_change=-item.quantity,
                reason=inv_models.LedgerReason.RETURN_OUT,
                reference_type="supplier_returns",
                reference_id=ref_id,
            ))
            _upsert_stock(db, item.variant_id, ret.location_id, -item.quantity)

    elif payload.status == "Credit_Received":
        # Reduce the AP balance for this supplier
        credit = ret.total_credit_amount or Decimal("0")
        db.add(ap_models.ApLedger(
            supplier_id=ret.supplier_id,
            amount_change=-credit,   # negative = debt to supplier decreases
            reason="CREDIT_MEMO",
            reference_type="supplier_returns",
            reference_id=ref_id,
        ))

    ret.status = payload.status
    db.commit()
    return _load_supplier_return(return_id, db)


@router.get("/supplier-returns", response_model=List[schemas.SupplierReturnOut], dependencies=[Depends(require_permission("view_receiving"))])
def list_supplier_returns(
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List supplier returns, newest first. Optionally filter by supplier_id."""
    q = (
        db.query(sales_models.SupplierReturn)
        .options(
            selectinload(sales_models.SupplierReturn.supplier),
            selectinload(sales_models.SupplierReturn.items)
                .selectinload(sales_models.SupplierReturnItem.variant),
        )
        .order_by(sales_models.SupplierReturn.return_id.desc())
    )
    if supplier_id is not None:
        q = q.filter(sales_models.SupplierReturn.supplier_id == supplier_id)
    return q.all()


@router.get("/supplier-returns/{return_id}",
            response_model=schemas.SupplierReturnOut,
            dependencies=[Depends(require_permission("view_receiving"))])
def get_supplier_return(return_id: int, db: Session = Depends(get_db)):
    """Get a supplier return with its line items."""
    return _load_supplier_return(return_id, db)
