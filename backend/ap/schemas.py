# ap/schemas.py
from __future__ import annotations
from pydantic import BaseModel, model_validator
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


# ── INVOICE LINE ITEMS ────────────────────────────────────────────────────────

class SupplierInvoiceItemOut(BaseModel):
    id: int
    invoice_id: int
    po_item_id: int
    variant_id: int
    ordered_qty: Decimal
    received_qty: Decimal
    rejected_qty: Decimal
    billed_qty: Decimal
    billed_unit_cost: Decimal
    line_total: Decimal
    # Populated from the variant relationship at serialization time
    variant_name: Optional[str] = None
    variant_sku: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode='before')
    @classmethod
    def _flatten_variant(cls, v):
        # When serializing an ORM object with a loaded variant relationship,
        # extract variant_name and variant_sku into flat fields.
        if isinstance(v, dict):
            return v
        variant = getattr(v, 'variant', None)
        if variant is not None:
            return {
                'id':               v.id,
                'invoice_id':       v.invoice_id,
                'po_item_id':       v.po_item_id,
                'variant_id':       v.variant_id,
                'ordered_qty':      v.ordered_qty,
                'received_qty':     v.received_qty,
                'rejected_qty':     v.rejected_qty,
                'billed_qty':       v.billed_qty,
                'billed_unit_cost': v.billed_unit_cost,
                'line_total':       v.line_total,
                'variant_name':     variant.variant_name,
                'variant_sku':      variant.sku,
                'created_at':       v.created_at,
                'updated_at':       v.updated_at,
            }
        return v

    class Config: from_attributes = True


class SupplierInvoiceItemUpdate(BaseModel):
    """Payload for PATCH /ap/invoices/{id}/items/{item_id}.

    Both fields are optional so accountant can edit one without touching the other.
    """
    billed_qty: Optional[Decimal] = None
    billed_unit_cost: Optional[Decimal] = None


# ── INVOICES ──────────────────────────────────────────────────────────────────

class InvoiceCreate(BaseModel):
    supplier_id: int
    shipment_id: Optional[int] = None
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
    amended_amount: Optional[Decimal] = None
    amendment_notes: Optional[str] = None
    status: str
    vetting_status: str = "Pending_Review"
    paid_before_received: bool = False
    check_drafted: bool = False
    check_drafted_note: Optional[str] = None
    created_at: datetime
    supplier: Optional[SupplierRefOut] = None
    items: List[SupplierInvoiceItemOut] = []

    class Config: from_attributes = True


class InvoiceAmend(BaseModel):
    """Payload for PATCH /ap/invoices/{id} — set amended_amount and/or notes."""
    amended_amount: Optional[Decimal] = None
    amendment_notes: Optional[str] = None


class InvoiceVettingUpdate(BaseModel):
    """Payload for PATCH /ap/invoices/{id}/vetting."""
    vetting_status: str           # Pending_Review | Approved | Rejected
    override_discrepancy: bool = False


class InvoiceCheckDraftUpdate(BaseModel):
    """Payload for PATCH /ap/invoices/{id}/check-draft."""
    check_drafted: bool
    check_drafted_note: Optional[str] = None


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

class ManualApLedgerCreate(BaseModel):
    """Payload for POST /ap/ledger — only CREDIT_MEMO and ADJUSTMENT are allowed."""
    supplier_id: int
    amount_change: Decimal
    reason: str                         # CREDIT_MEMO | ADJUSTMENT
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None


class ApLedgerOut(BaseModel):
    ap_ledger_id: int
    supplier_id: int
    amount_change: Decimal
    reason: str
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    occurred_at: datetime
    supplier_name: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def _flatten_supplier(cls, v):
        if isinstance(v, dict):
            return v
        supplier = getattr(v, 'supplier', None)
        if supplier is not None:
            return {
                'ap_ledger_id':   v.ap_ledger_id,
                'supplier_id':    v.supplier_id,
                'amount_change':  v.amount_change,
                'reason':         v.reason,
                'reference_type': v.reference_type,
                'reference_id':   v.reference_id,
                'occurred_at':    v.occurred_at,
                'supplier_name':  supplier.supplier_name,
            }
        return v

    class Config: from_attributes = True


# ── 3-WAY MATCH ───────────────────────────────────────────────────────────────

class MatchPoRef(BaseModel):
    id: int
    po_pid: str
    status: str
    created_at: datetime
    supplier_id: int
    supplier_name: str


class MatchShipmentRef(BaseModel):
    id: int
    is_confirmed: bool
    discrepancy_status: str
    discrepancy_notes: Optional[str] = None
    received_at: Optional[datetime] = None


class MatchLineOut(BaseModel):
    variant_id: int
    variant_name: Optional[str] = None
    variant_sku: Optional[str] = None
    ordered_qty: Decimal
    received_qty: Decimal
    rejected_qty: Decimal
    billed_qty: Decimal
    billed_unit_cost: Decimal
    line_total: Decimal
    po_line_total: Decimal          # received_qty × po unit_cost
    qty_variance: Decimal           # billed_qty − received_qty
    cost_variance: Decimal          # line_total − po_line_total
    has_variance: bool              # true if either variance ≠ 0


class MatchResponse(BaseModel):
    invoice: InvoiceOut
    po: Optional[MatchPoRef] = None
    shipment: Optional[MatchShipmentRef] = None
    lines: List[MatchLineOut] = []


# ── AGING ─────────────────────────────────────────────────────────────────────

class SupplierAgingRow(BaseModel):
    supplier_id:          int
    supplier_name:        str
    supplier_code:        Optional[str] = None
    invoice_count:        int
    has_pending_vetting:  bool
    has_rejected:         bool
    current:              Decimal
    bucket_30:            Decimal
    bucket_60:            Decimal
    bucket_90:            Decimal
    bucket_90p:           Decimal
    total:                Decimal


class SupplierAgingResponse(BaseModel):
    as_of:  date
    rows:   List[SupplierAgingRow]
    totals: SupplierAgingRow
