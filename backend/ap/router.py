# ap/router.py
from __future__ import annotations
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from ap import models, schemas
from inventory import models as inv_models

router = APIRouter(prefix="/ap", tags=["Accounts Payable"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_invoice(invoice_id: int, db: Session) -> models.SupplierInvoice:
    invoice = (
        db.query(models.SupplierInvoice)
        .options(selectinload(models.SupplierInvoice.supplier))
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
    """Returns the correct status for an invoice based on payments applied."""
    total_applied = (
        db.query(func.sum(models.InvoicePayment.amount_applied))
        .filter(models.InvoicePayment.invoice_id == invoice.invoice_id)
        .scalar()
    ) or Decimal('0')

    if total_applied >= invoice.total_amount:
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
        .options(selectinload(models.SupplierInvoice.supplier))
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


@router.post("/invoices", response_model=schemas.InvoiceOut, status_code=201)
def create_invoice(payload: schemas.InvoiceCreate, db: Session = Depends(get_db)):
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
    return _load_invoice(invoice.invoice_id, db)


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
def create_payment(payload: schemas.PaymentCreate, db: Session = Depends(get_db)):
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
    for app in payload.applications:
        invoice = (
            db.query(models.SupplierInvoice)
            .filter(
                models.SupplierInvoice.invoice_id == app.invoice_id,
                models.SupplierInvoice.supplier_id == payload.supplier_id,
            )
            .first()
        )
        if not invoice:
            db.rollback()
            raise HTTPException(
                status_code=404,
                detail=f"Invoice {app.invoice_id} not found for this supplier",
            )

        db.add(models.InvoicePayment(
            invoice_id=app.invoice_id,
            payment_id=payment.payment_id,
            amount_applied=app.amount_applied,
        ))
        db.flush()  # so _recalculate can see the new row

        invoice.status = _recalculate_invoice_status(invoice, db)

    # write immutable AP ledger entry — debt decreases
    db.add(models.ApLedger(
        supplier_id=payload.supplier_id,
        amount_change=-payment.amount,
        reason="PAYMENT",
        reference_type="supplier_payments",
        reference_id=str(payment.payment_id),
    ))

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
        .order_by(models.ApLedger.occurred_at.desc())
    )
    if supplier_id is not None:
        q = q.filter(models.ApLedger.supplier_id == supplier_id)
    return q.all()
