# ap/schemas.py
from __future__ import annotations
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, date


# ── shared refs ───────────────────────────────────────────────────────────────

class SupplierRefOut(BaseModel):
    supplier_id: int
    supplier_name: str
    class Config: from_attributes = True


class ShipmentRefOut(BaseModel):
    shipment_id: int
    shipment_pid: Optional[str] = None
    class Config: from_attributes = True


# ── INVOICES ──────────────────────────────────────────────────────────────────

class InvoiceCreate(BaseModel):
    supplier_id: int
    shipment_id: int
    invoice_number: Optional[str] = None
    invoice_date: date
    total_amount: Decimal


class InvoiceOut(BaseModel):
    invoice_id: int
    supplier_id: int
    shipment_id: Optional[int] = None
    invoice_number: Optional[str] = None
    invoice_date: date
    due_date: Optional[date] = None
    total_amount: Decimal
    status: str
    created_at: datetime
    supplier: Optional[SupplierRefOut] = None

    class Config: from_attributes = True


# ── PAYMENTS ──────────────────────────────────────────────────────────────────

class InvoiceApplicationCreate(BaseModel):
    """One invoice to apply part of this payment against."""
    invoice_id: int
    amount_applied: Decimal


class PaymentCreate(BaseModel):
    supplier_id: int
    amount: Decimal
    payment_date: Optional[datetime] = None
    reference_number: Optional[str] = None
    payment_method: Optional[str] = None
    applications: List[InvoiceApplicationCreate] = []


class InvoicePaymentOut(BaseModel):
    invoice_id: int
    payment_id: int
    amount_applied: Decimal
    class Config: from_attributes = True


class PaymentOut(BaseModel):
    payment_id: int
    supplier_id: int
    amount: Decimal
    payment_date: Optional[datetime] = None
    reference_number: Optional[str] = None
    payment_method: Optional[str] = None
    supplier: Optional[SupplierRefOut] = None
    invoice_payments: List[InvoicePaymentOut] = []

    class Config: from_attributes = True


# ── AP LEDGER ─────────────────────────────────────────────────────────────────

class ApLedgerOut(BaseModel):
    ap_ledger_id: int
    supplier_id: int
    amount_change: Decimal
    reason: str
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    occurred_at: datetime

    class Config: from_attributes = True
