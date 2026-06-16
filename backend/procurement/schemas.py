# procurement/schemas.py
from __future__ import annotations
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, date


# ── shared refs ───────────────────────────────────────────────────────────────

class SupplierRefOut(BaseModel):
    supplier_id: int
    supplier_code: str = ""
    supplier_name: str
    class Config: from_attributes = True

class LocationRefOut(BaseModel):
    location_id: int
    location_name: str
    class Config: from_attributes = True

class VariantRefOut(BaseModel):
    variant_id: int
    PID: str
    variant_name: str
    class Config: from_attributes = True

class ProductBrandRef(BaseModel):
    brand: str
    class Config: from_attributes = True

class VariantWithProductRef(BaseModel):
    variant_id: int
    PID: str
    variant_name: str
    sku: Optional[str] = None
    product: Optional[ProductBrandRef] = None
    class Config: from_attributes = True

class EmployeeRefOut(BaseModel):
    employee_id: int
    first_name: str
    last_name: str
    class Config: from_attributes = True


# ── PURCHASE ORDER ITEMS ──────────────────────────────────────────────────────

class POItemCreate(BaseModel):
    variant_id: int
    ordered_quantity: Decimal
    unit_cost: Decimal          # gross cost per unit at time of ordering

class POItemUpdate(BaseModel):
    ordered_quantity: Optional[Decimal] = None
    unit_cost: Optional[Decimal] = None

class POItemOut(BaseModel):
    po_item_id: int
    variant_id: int
    ordered_quantity: Decimal
    received_quantity: Decimal
    unit_cost: Decimal
    variant: Optional[VariantRefOut] = None
    class Config: from_attributes = True


# ── PURCHASE ORDERS ───────────────────────────────────────────────────────────

class POCreate(BaseModel):
    po_pid: Optional[str] = None
    supplier_id: int
    location_id: Optional[int] = None
    expected_arrival_date: Optional[date] = None
    created_by_user_id: Optional[int] = None
    items: List[POItemCreate]

class POStatusUpdate(BaseModel):
    status: str     # Draft | Open | Partially_Received | Closed | Cancelled

class POOut(BaseModel):
    po_id: int
    po_pid: str
    supplier_id: int
    location_id: Optional[int] = None
    status: str
    total_amount: Decimal
    order_date: datetime
    expected_arrival_date: Optional[date] = None
    created_at: datetime
    supplier: Optional[SupplierRefOut] = None
    location: Optional[LocationRefOut] = None
    items: List[POItemOut] = []
    class Config: from_attributes = True


# ── RECEIVING DETAILS ─────────────────────────────────────────────────────────

class ReceivingDetailCreate(BaseModel):
    variant_id: int
    location_id: int
    po_item_id: Optional[int] = None
    received_at: Optional[datetime] = None
    inspected_at: Optional[datetime] = None
    quantity_ordered: Decimal = Decimal('0')
    quantity_declared: Decimal = Decimal('0')
    quantity_actual: Decimal
    quantity_rejected: Decimal = Decimal('0')
    qc_status: str = "Pending"  # Pending | Passed | Failed | Partially_Passed

class ReceivingDetailOut(BaseModel):
    detail_id: int
    shipment_id: int
    variant_id: int
    location_id: int
    po_item_id: Optional[int] = None
    received_at: Optional[datetime] = None
    inspected_at: Optional[datetime] = None
    quantity_ordered: Decimal
    quantity_declared: Decimal
    quantity_actual: Decimal
    quantity_rejected: Decimal
    qc_status: str
    is_deleted: bool
    variant: Optional[VariantWithProductRef] = None
    class Config: from_attributes = True


# ── INVENTORY SHIPMENTS ───────────────────────────────────────────────────────

class ShipmentCreate(BaseModel):
    shipment_pid: Optional[str] = None
    supplier_id: int
    po_id: Optional[int] = None
    reference_number: Optional[str] = None
    received_at: Optional[datetime] = None
    received_by_user_id:      Optional[int] = None
    inspected_by_user_id:     Optional[int] = None
    received_by_employee_id:  Optional[int] = None
    inspected_by_employee_id: Optional[int] = None

class ShipmentOut(BaseModel):
    shipment_id: int
    shipment_pid: Optional[str] = None
    supplier_id: int
    po_id: Optional[int] = None
    reference_number: Optional[str] = None
    received_at: Optional[datetime] = None
    is_confirmed: bool = False
    discrepancy_status: str = "None"
    discrepancy_notes: Optional[str] = None
    received_by_user_id:      Optional[int] = None
    inspected_by_user_id:     Optional[int] = None
    received_by_employee_id:  Optional[int] = None
    inspected_by_employee_id: Optional[int] = None
    supplier: Optional[SupplierRefOut] = None
    received_by_employee:  Optional[EmployeeRefOut] = None
    inspected_by_employee: Optional[EmployeeRefOut] = None
    receiving_details: List[ReceivingDetailOut] = []
    class Config: from_attributes = True


class ShipmentDiscrepancyUpdate(BaseModel):
    """Payload for PATCH /procurement/shipments/{id}/discrepancy."""
    discrepancy_status: str           # None | Flagged | Supplier_Notified | Resolved | Waived
    discrepancy_notes: Optional[str] = None


# ── CONFIRM COSTS (Stage 2) ───────────────────────────────────────────────────

class ConfirmCostLine(BaseModel):
    detail_id: int
    unit_cost: Decimal

class ConfirmCostsRequest(BaseModel):
    lines: List[ConfirmCostLine]
    inspected_by_employee_id: Optional[int] = None

class ReceiveResult(BaseModel):
    shipment_id: int
    ledger_entries_written: int


# ── SUPPLIER RETURNS ─────────────────────────────────────────────────────────

class SupplierReturnItemIn(BaseModel):
    variant_id: int
    cost_layer_id: Optional[int] = None
    quantity: Decimal
    unit_credit_expected: Optional[Decimal] = None


class SupplierReturnCreate(BaseModel):
    supplier_id: int
    location_id: int              # source — typically Quarantine
    items: List[SupplierReturnItemIn]
    total_credit_amount: Optional[Decimal] = None   # auto-computed if omitted


class SupplierReturnStatusPatch(BaseModel):
    """Advance: Draft → Shipped → Credit_Received"""
    status: str


class SupplierReturnItemOut(BaseModel):
    return_item_id: int
    return_id: int
    variant_id: int
    cost_layer_id: Optional[int] = None
    quantity: Decimal
    unit_credit_expected: Optional[Decimal] = None
    variant: Optional[VariantRefOut] = None
    class Config: from_attributes = True


class SupplierReturnOut(BaseModel):
    return_id: int
    return_pid: Optional[str] = None
    supplier_id: int
    location_id: int
    status: str
    total_credit_amount: Decimal
    created_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None
    items: List[SupplierReturnItemOut] = []
    supplier: Optional[SupplierRefOut] = None
    class Config: from_attributes = True


# ── CONFIRM RESPONSE ──────────────────────────────────────────────────────────

class ConfirmResult(BaseModel):
    shipment_id: int
    details_confirmed: int      # count of details processed
    ledger_entries_written: int
    cost_layers_created: int
    po_status_updated: Optional[str] = None   # new PO status if changed
    invoice_id: Optional[int] = None          # auto-created invoice
