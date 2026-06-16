# ap/router.py
from __future__ import annotations
from typing import List, Optional
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.audit import write_audit, _serialize
from auth.dependencies import get_current_user, require_permission
from auth.models import User as AuthUser
from ap import models, schemas
from inventory import models as inv_models
from procurement import models as proc_models

router = APIRouter(
    prefix="/ap",
    tags=["Accounts Payable"],
    dependencies=[Depends(get_current_user)],
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_invoice(invoice_id: int, db: Session) -> models.SupplierInvoice:
    invoice = (
        db.query(models.SupplierInvoice)
        .options(
            selectinload(models.SupplierInvoice.supplier),
            selectinload(models.SupplierInvoice.items)
                .selectinload(models.SupplierInvoiceItem.variant),
        )
        .filter(models.SupplierInvoice.invoice_id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


def _load_payment(payment_id: int, db: Session) -> models.SupplierPayment:
    payment = (
        db.query(models.SupplierPayment)
        .options(
            selectinload(models.SupplierPayment.supplier),
            selectinload(models.SupplierPayment.invoice_payments),
        )
        .filter(models.SupplierPayment.payment_id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


def _recalculate_invoice_status(invoice: models.SupplierInvoice, db: Session) -> str:
    """Returns the correct status for an invoice based on payments applied.

    Uses amended_amount when set, falling back to total_amount (Requirements §10.1).
    """
    total_applied = (
        db.query(func.sum(models.InvoicePayment.amount_applied))
        .filter(models.InvoicePayment.invoice_id == invoice.invoice_id)
        .scalar()
    ) or Decimal('0')

    effective_amount = (
        invoice.amended_amount
        if invoice.amended_amount is not None
        else invoice.total_amount
    )

    if total_applied >= effective_amount:
        return "Paid"
    if total_applied > 0:
        return "Partial"
    return "Unpaid"


# ═══════════════════════════════════════════════════════════════════════════════
# INVOICES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/invoices", response_model=List[schemas.InvoiceOut])
def list_invoices(
    supplier_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.SupplierInvoice)
        .options(
            selectinload(models.SupplierInvoice.supplier),
            selectinload(models.SupplierInvoice.items)
                .selectinload(models.SupplierInvoiceItem.variant),
        )
        .order_by(models.SupplierInvoice.invoice_id.desc())
    )
    if supplier_id is not None:
        q = q.filter(models.SupplierInvoice.supplier_id == supplier_id)
    if status is not None:
        q = q.filter(models.SupplierInvoice.status == status)
    return q.all()


@router.get("/invoices/{invoice_id}", response_model=schemas.InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    return _load_invoice(invoice_id, db)


@router.patch("/invoices/{invoice_id}", response_model=schemas.InvoiceOut)
def amend_invoice(
    invoice_id: int,
    payload: schemas.InvoiceAmend,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    """Set amended_amount and/or amendment_notes on an existing invoice.

    After saving, the invoice status is recalculated against the new effective
    amount so that Paid/Partial/Unpaid always reflects the amended figure.
    """
    invoice = _load_invoice(invoice_id, db)
    old = _serialize(invoice)
    if payload.amended_amount is not None:
        invoice.amended_amount = payload.amended_amount
    if payload.amendment_notes is not None:
        invoice.amendment_notes = payload.amendment_notes
    invoice.status = _recalculate_invoice_status(invoice, db)
    db.commit()
    write_audit(
        db, "ap.supplier_invoices", str(invoice_id), "UPDATE",
        actor_user_id=_actor.user_id,
        old_values=old,
        new_values=_serialize(invoice),
    )
    db.commit()
    return _load_invoice(invoice_id, db)


_VALID_VETTING_STATUSES = {"Pending_Review", "Approved", "Rejected"}
_BLOCKING_DISCREPANCY_STATUSES = {"Flagged", "Supplier_Notified"}


@router.patch("/invoices/{invoice_id}/vetting", response_model=schemas.InvoiceOut)
def update_invoice_vetting(
    invoice_id: int,
    payload: schemas.InvoiceVettingUpdate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    """Set vetting_status on an invoice.

    If the linked shipment has an unresolved discrepancy (Flagged or
    Supplier_Notified), returns a 200 warning and does NOT update the
    invoice unless override_discrepancy=True is also sent.
    """
    if payload.vetting_status not in _VALID_VETTING_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid vetting_status '{payload.vetting_status}'. "
                f"Must be one of: {sorted(_VALID_VETTING_STATUSES)}"
            ),
        )

    invoice = _load_invoice(invoice_id, db)

    discrepancy_overridden = False
    if invoice.shipment_id:
        shipment = (
            db.query(proc_models.InventoryShipment)
            .filter_by(shipment_id=invoice.shipment_id)
            .first()
        )
        if shipment and shipment.discrepancy_status in _BLOCKING_DISCREPANCY_STATUSES:
            if not payload.override_discrepancy:
                return JSONResponse(
                    status_code=200,
                    content={
                        "warning": True,
                        "message": (
                            "Linked shipment has an unresolved discrepancy. "
                            "Set override_discrepancy: true to confirm approval."
                        ),
                    },
                )
            discrepancy_overridden = True

    old = _serialize(invoice)
    invoice.vetting_status = payload.vetting_status
    db.commit()

    audit_new = _serialize(invoice)
    if discrepancy_overridden:
        audit_new["discrepancy_override"] = True
    write_audit(
        db, "ap.supplier_invoices", str(invoice_id), "UPDATE",
        actor_user_id=_actor.user_id, old_values=old, new_values=audit_new,
    )
    db.commit()
    return _load_invoice(invoice_id, db)


@router.patch("/invoices/{invoice_id}/check-draft", response_model=schemas.InvoiceOut)
def update_invoice_check_draft(
    invoice_id: int,
    payload: schemas.InvoiceCheckDraftUpdate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    """Record that a physical check has been drafted outside the system
    (check_drafted=True) or clear that flag (check_drafted=False)."""
    invoice = _load_invoice(invoice_id, db)

    old = _serialize(invoice)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(invoice, field, value)

    db.commit()
    write_audit(
        db, "ap.supplier_invoices", str(invoice_id), "UPDATE",
        actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(invoice),
    )
    db.commit()
    return _load_invoice(invoice_id, db)


@router.post("/invoices", response_model=schemas.InvoiceOut, status_code=201)
def create_invoice(
    payload: schemas.InvoiceCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    # validate supplier exists
    supplier = (
        db.query(inv_models.Supplier)
        .filter(
            inv_models.Supplier.supplier_id == payload.supplier_id,
            inv_models.Supplier.is_deleted == False,
        )
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # due_date = invoice_date + supplier payment terms (in days)
    due_date = payload.invoice_date + timedelta(days=supplier.terms or 0)

    invoice = models.SupplierInvoice(
        supplier_id=payload.supplier_id,
        shipment_id=payload.shipment_id,
        invoice_number=payload.invoice_number,
        invoice_date=payload.invoice_date,
        due_date=due_date,
        total_amount=payload.total_amount,
        status="Unpaid",
    )
    db.add(invoice)
    db.flush()  # get invoice_id for ledger reference

    # write immutable AP ledger entry — debt increases
    db.add(models.ApLedger(
        supplier_id=payload.supplier_id,
        amount_change=payload.total_amount,
        reason="INVOICE",
        reference_type="supplier_invoices",
        reference_id=str(invoice.invoice_id),
    ))

    db.commit()
    write_audit(db, "ap.supplier_invoices", str(invoice.invoice_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(invoice))
    db.commit()
    return _load_invoice(invoice.invoice_id, db)


# ═══════════════════════════════════════════════════════════════════════════════
# INVOICE LINE ITEMS
# ═══════════════════════════════════════════════════════════════════════════════

@router.patch(
    "/invoices/{invoice_id}/items/{item_id}",
    response_model=schemas.SupplierInvoiceItemOut,
)
def update_invoice_item(
    invoice_id: int,
    item_id: int,
    payload: schemas.SupplierInvoiceItemUpdate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    """Update billed_qty and/or billed_unit_cost on a line item.

    Recalculates line_total = billed_qty × billed_unit_cost, then recomputes
    invoice.total_amount as the sum of all line_total values for this invoice.
    Does not touch amended_amount if one is set.  Recalculates Paid/Partial/Unpaid
    status against the updated total_amount.
    """
    item = (
        db.query(models.SupplierInvoiceItem)
        .options(selectinload(models.SupplierInvoiceItem.variant))
        .filter(
            models.SupplierInvoiceItem.id == item_id,
            models.SupplierInvoiceItem.invoice_id == invoice_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Invoice line item not found")

    # Apply only the fields the caller supplied
    updated = False
    if payload.billed_qty is not None:
        item.billed_qty = payload.billed_qty
        updated = True
    if payload.billed_unit_cost is not None:
        item.billed_unit_cost = payload.billed_unit_cost
        updated = True

    if not updated:
        return item

    old = _serialize(item)
    item.line_total = item.billed_qty * item.billed_unit_cost

    # Flush so the updated line_total is visible to the aggregate query below.
    db.flush()

    new_total = (
        db.query(func.sum(models.SupplierInvoiceItem.line_total))
        .filter(models.SupplierInvoiceItem.invoice_id == invoice_id)
        .scalar()
    ) or Decimal('0')

    invoice = (
        db.query(models.SupplierInvoice)
        .filter(models.SupplierInvoice.invoice_id == invoice_id)
        .first()
    )
    invoice.total_amount = new_total
    invoice.status = _recalculate_invoice_status(invoice, db)

    db.commit()

    write_audit(
        db, "ap.supplier_invoice_items", str(item_id), "UPDATE",
        actor_user_id=_actor.user_id,
        old_values=old,
        new_values=_serialize(item),
    )
    db.commit()

    # Re-query to pick up the DB-generated updated_at timestamp.
    return (
        db.query(models.SupplierInvoiceItem)
        .options(selectinload(models.SupplierInvoiceItem.variant))
        .filter(models.SupplierInvoiceItem.id == item_id)
        .first()
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 3-WAY MATCH
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/invoices/{invoice_id}/match", response_model=schemas.MatchResponse)
def get_invoice_match(
    invoice_id: int,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    """Return the full 3-way match view for an invoice.

    Joins invoice line items against the linked PO and GRN to expose
    ordered / received / billed quantities and cost variances per line.
    Read-only — no writes occur here.
    """
    invoice = _load_invoice(invoice_id, db)

    # ── shipment ──────────────────────────────────────────────────────────────
    shipment_ref: Optional[schemas.MatchShipmentRef] = None
    po_id: Optional[int] = None
    if invoice.shipment_id:
        shipment = (
            db.query(proc_models.InventoryShipment)
            .filter_by(shipment_id=invoice.shipment_id)
            .first()
        )
        if shipment:
            shipment_ref = schemas.MatchShipmentRef(
                id=shipment.shipment_id,
                is_confirmed=shipment.is_confirmed,
                discrepancy_status=shipment.discrepancy_status or "None",
                discrepancy_notes=shipment.discrepancy_notes,
                received_at=shipment.received_at,
            )
            po_id = shipment.po_id

    # ── PO ────────────────────────────────────────────────────────────────────
    po_ref: Optional[schemas.MatchPoRef] = None
    po_item_cost: dict[int, Decimal] = {}   # po_item_id → unit_cost
    if po_id:
        po = (
            db.query(proc_models.PurchaseOrder)
            .options(
                selectinload(proc_models.PurchaseOrder.supplier),
                selectinload(proc_models.PurchaseOrder.items),
            )
            .filter_by(po_id=po_id)
            .first()
        )
        if po:
            po_ref = schemas.MatchPoRef(
                id=po.po_id,
                po_pid=po.po_pid,
                status=po.status,
                created_at=po.created_at,
                supplier_id=po.supplier_id,
                supplier_name=po.supplier.supplier_name if po.supplier else "",
            )
            for pi in po.items:
                po_item_cost[pi.po_item_id] = pi.unit_cost

    # ── Match lines ───────────────────────────────────────────────────────────
    lines: list[schemas.MatchLineOut] = []
    for item in invoice.items:
        variant    = item.variant
        po_uc      = po_item_cost.get(item.po_item_id, Decimal('0'))
        po_lt      = item.received_qty * po_uc
        qty_var    = item.billed_qty - item.received_qty
        cost_var   = item.line_total - po_lt
        has_var    = (qty_var != Decimal('0') or cost_var != Decimal('0'))
        lines.append(schemas.MatchLineOut(
            variant_id=item.variant_id,
            variant_name=variant.variant_name if variant else None,
            variant_sku=variant.sku if variant else None,
            ordered_qty=item.ordered_qty,
            received_qty=item.received_qty,
            rejected_qty=item.rejected_qty,
            billed_qty=item.billed_qty,
            billed_unit_cost=item.billed_unit_cost,
            line_total=item.line_total,
            po_line_total=po_lt,
            qty_variance=qty_var,
            cost_variance=cost_var,
            has_variance=has_var,
        ))

    return schemas.MatchResponse(
        invoice=schemas.InvoiceOut.model_validate(invoice),
        po=po_ref,
        shipment=shipment_ref,
        lines=lines,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/payments", response_model=List[schemas.PaymentOut])
def list_payments(
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.SupplierPayment)
        .options(
            selectinload(models.SupplierPayment.supplier),
            selectinload(models.SupplierPayment.invoice_payments),
        )
        .order_by(models.SupplierPayment.payment_id.desc())
    )
    if supplier_id is not None:
        q = q.filter(models.SupplierPayment.supplier_id == supplier_id)
    return q.all()


@router.get("/payments/{payment_id}", response_model=schemas.PaymentOut)
def get_payment(payment_id: int, db: Session = Depends(get_db)):
    return _load_payment(payment_id, db)


@router.post("/payments", response_model=schemas.PaymentOut, status_code=201)
def create_payment(
    payload: schemas.PaymentCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_payments")),
):
    # validate supplier
    supplier = (
        db.query(inv_models.Supplier)
        .filter(
            inv_models.Supplier.supplier_id == payload.supplier_id,
            inv_models.Supplier.is_deleted == False,
        )
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # validate that applications don't exceed payment amount
    if payload.applications:
        total_applied = sum(a.amount_applied for a in payload.applications)
        if total_applied > payload.amount:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Total applied ({total_applied}) exceeds payment amount ({payload.amount})"
                ),
            )

    # ── Step 5 gate: vetting and check-draft validation ───────────────────────
    # All invoices must be Approved and must not have a check already drafted
    # outside the system before any payment record is created.
    for app in payload.applications:
        inv_check = (
            db.query(models.SupplierInvoice)
            .filter(
                models.SupplierInvoice.invoice_id == app.invoice_id,
                models.SupplierInvoice.supplier_id == payload.supplier_id,
            )
            .first()
        )
        if not inv_check:
            raise HTTPException(
                status_code=404,
                detail=f"Invoice {app.invoice_id} not found for this supplier",
            )
        if inv_check.vetting_status != "Approved":
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invoice {app.invoice_id} has not been approved for payment. "
                    f"Vetting status: {inv_check.vetting_status}"
                ),
            )
        if inv_check.check_drafted:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invoice {app.invoice_id} has a check marked as drafted outside "
                    f"the system. Clear the check_drafted flag before recording a "
                    f"system payment."
                ),
            )
    # ── end gate ──────────────────────────────────────────────────────────────

    payment = models.SupplierPayment(
        supplier_id=payload.supplier_id,
        amount=payload.amount,
        payment_date=payload.payment_date or datetime.now(timezone.utc),
        reference_number=payload.reference_number,
        payment_method=payload.payment_method,
    )
    db.add(payment)
    db.flush()  # get payment_id

    # apply to invoices and update each invoice's status
    paid_before_received_invoices: list[models.SupplierInvoice] = []
    for app in payload.applications:
        invoice = (
            db.query(models.SupplierInvoice)
            .filter(
                models.SupplierInvoice.invoice_id == app.invoice_id,
                models.SupplierInvoice.supplier_id == payload.supplier_id,
            )
            .first()
        )
        # invoice existence already confirmed by gate above; no re-check needed

        db.add(models.InvoicePayment(
            invoice_id=app.invoice_id,
            payment_id=payment.payment_id,
            amount_applied=app.amount_applied,
        ))
        db.flush()  # so _recalculate can see the new row

        invoice.status = _recalculate_invoice_status(invoice, db)

        # ── Step 4: paid_before_received anomaly detection ────────────────────
        if invoice.shipment_id:
            shipment = (
                db.query(proc_models.InventoryShipment)
                .filter_by(shipment_id=invoice.shipment_id)
                .first()
            )
            if shipment and not shipment.is_confirmed and not invoice.paid_before_received:
                invoice.paid_before_received = True
                paid_before_received_invoices.append(invoice)
        # ── end anomaly detection ─────────────────────────────────────────────

    # write immutable AP ledger entry — debt decreases
    db.add(models.ApLedger(
        supplier_id=payload.supplier_id,
        amount_change=-payment.amount,
        reason="PAYMENT",
        reference_type="supplier_payments",
        reference_id=str(payment.payment_id),
    ))

    # If the payment amount exceeds the sum of invoice applications, record the
    # unapplied portion as a positive ADJUSTMENT so the AP ledger net effect
    # equals only what was actually applied (-payment + surplus = -sum_applied).
    total_applied = sum(
        (a.amount_applied for a in payload.applications), Decimal('0')
    )
    surplus = payment.amount - total_applied
    if surplus > Decimal('0'):
        db.add(models.ApLedger(
            supplier_id=payload.supplier_id,
            amount_change=surplus,
            reason="ADJUSTMENT",
            reference_type="supplier_payments",
            reference_id=str(payment.payment_id),
        ))

    db.commit()

    write_audit(db, "ap.supplier_payments", str(payment.payment_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(payment))
    for flagged_inv in paid_before_received_invoices:
        write_audit(
            db, "ap.supplier_invoices", str(flagged_inv.invoice_id), "UPDATE",
            actor_user_id=_actor.user_id,
            old_values={"paid_before_received": False},
            new_values={
                "paid_before_received": True,
                "anomaly": "payment recorded before shipment cost confirmation",
            },
        )
    db.commit()
    return _load_payment(payment.payment_id, db)


# ═══════════════════════════════════════════════════════════════════════════════
# AP LEDGER  (read-only)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/ledger", response_model=List[schemas.ApLedgerOut])
def list_ap_ledger(
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.ApLedger)
        .options(selectinload(models.ApLedger.supplier))
        .order_by(models.ApLedger.occurred_at.desc())
    )
    if supplier_id is not None:
        q = q.filter(models.ApLedger.supplier_id == supplier_id)
    return q.all()


# ═══════════════════════════════════════════════════════════════════════════════
# AP AGING
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/aging", response_model=schemas.SupplierAgingResponse)
def get_supplier_aging(
    as_of: Optional[str] = None,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_invoices")),
):
    """Supplier AP aging report — outstanding balances bucketed by days past due.

    Includes Unpaid and Partial invoices across all vetting statuses.
    Balances are the effective invoice amount minus any payments applied.
    """
    if as_of:
        try:
            as_of_date = date.fromisoformat(as_of)
        except ValueError:
            raise HTTPException(status_code=400, detail="as_of must be YYYY-MM-DD")
    else:
        as_of_date = date.today()

    invoices = (
        db.query(models.SupplierInvoice)
        .options(
            selectinload(models.SupplierInvoice.supplier),
            selectinload(models.SupplierInvoice.invoice_payments),
        )
        .filter(models.SupplierInvoice.status.in_(["Unpaid", "Partial"]))
        .all()
    )

    supplier_rows: dict[int, dict] = {}

    for inv in invoices:
        sid = inv.supplier_id
        if sid not in supplier_rows:
            sup = inv.supplier
            supplier_rows[sid] = {
                "supplier_id":         sid,
                "supplier_name":       sup.supplier_name if sup else "Unknown",
                "supplier_code":       sup.supplier_code if sup else None,
                "invoice_count":       0,
                "has_pending_vetting": False,
                "has_rejected":        False,
                "current":    Decimal("0"),
                "bucket_30":  Decimal("0"),
                "bucket_60":  Decimal("0"),
                "bucket_90":  Decimal("0"),
                "bucket_90p": Decimal("0"),
            }

        row = supplier_rows[sid]
        row["invoice_count"] += 1

        if inv.vetting_status == "Pending_Review":
            row["has_pending_vetting"] = True
        if inv.vetting_status == "Rejected":
            row["has_rejected"] = True

        effective = (
            inv.amended_amount if inv.amended_amount is not None else inv.total_amount
        )
        total_applied = sum(
            (ip.amount_applied for ip in inv.invoice_payments), Decimal("0")
        )
        balance = effective - total_applied
        if balance <= Decimal("0"):
            continue

        if inv.due_date is None:
            days = 0
        else:
            days = (as_of_date - inv.due_date).days

        if days <= 0:
            row["current"] += balance
        elif days <= 30:
            row["bucket_30"] += balance
        elif days <= 60:
            row["bucket_60"] += balance
        elif days <= 90:
            row["bucket_90"] += balance
        else:
            row["bucket_90p"] += balance

    zero = Decimal("0")
    rows_out: list[schemas.SupplierAgingRow] = []
    for data in supplier_rows.values():
        data["total"] = (
            data["current"] + data["bucket_30"] + data["bucket_60"] +
            data["bucket_90"] + data["bucket_90p"]
        )
        rows_out.append(schemas.SupplierAgingRow(**data))

    rows_out.sort(key=lambda r: r.total, reverse=True)

    totals = schemas.SupplierAgingRow(
        supplier_id=0,
        supplier_name="Total",
        supplier_code=None,
        invoice_count=sum(r.invoice_count for r in rows_out),
        has_pending_vetting=any(r.has_pending_vetting for r in rows_out),
        has_rejected=any(r.has_rejected for r in rows_out),
        current=sum((r.current    for r in rows_out), zero),
        bucket_30=sum((r.bucket_30  for r in rows_out), zero),
        bucket_60=sum((r.bucket_60  for r in rows_out), zero),
        bucket_90=sum((r.bucket_90  for r in rows_out), zero),
        bucket_90p=sum((r.bucket_90p for r in rows_out), zero),
        total=sum((r.total for r in rows_out), zero),
    )

    return schemas.SupplierAgingResponse(
        as_of=as_of_date,
        rows=rows_out,
        totals=totals,
    )


@router.post("/ledger", response_model=schemas.ApLedgerOut, status_code=201)
def create_manual_ledger_entry(
    payload: schemas.ManualApLedgerCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_ap_ledger")),
):
    """Write a manual CREDIT_MEMO or ADJUSTMENT entry to the AP ledger.

    INVOICE and PAYMENT entries are created automatically by their respective
    endpoints. This endpoint exists for supplier return recoveries and free
    replacement scenarios (Requirements §9.3, §10.4).
    """
    _MANUAL_REASONS = {"CREDIT_MEMO", "ADJUSTMENT"}
    if payload.reason not in _MANUAL_REASONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only {sorted(_MANUAL_REASONS)} entries may be created manually. "
                f"INVOICE and PAYMENT entries are written automatically."
            ),
        )

    supplier = (
        db.query(inv_models.Supplier)
        .filter(
            inv_models.Supplier.supplier_id == payload.supplier_id,
            inv_models.Supplier.is_deleted == False,
        )
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    entry = models.ApLedger(
        supplier_id=payload.supplier_id,
        amount_change=payload.amount_change,
        reason=payload.reason,
        reference_type=payload.reference_type,
        reference_id=payload.reference_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    write_audit(
        db, "ap.ap_ledger", str(entry.ap_ledger_id), "INSERT",
        actor_user_id=_actor.user_id,
        new_values=_serialize(entry),
    )
    db.commit()
    return entry
