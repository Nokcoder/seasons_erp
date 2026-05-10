# backend/sales/schemas.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal


# --- INCOMING PAYLOAD SCHEMAS (POST) ---
class SalesItemCreate(BaseModel):
    product_id: int
    qty: int
    price: Decimal
    discount_pct: float = 0.0
    discount_flat: float = 0.0


    net_cost: float


class SalesPaymentCreate(BaseModel):
    method: str
    amount: Decimal


class SalesHeaderCreate(BaseModel):
    location_id: int
    cashier_id: int
    date: date
    shift: str
    sales_invoice_id: Optional[str] = None
    delivery_receipt_id: Optional[str] = None

    # New Financial Breakdown
    subtotal_amount: Decimal
    discount_amount: Decimal = Decimal('0.00')
    tax_amount: Decimal = Decimal('0.00')
    total_amount: Decimal  # This is the Grand Total

    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    register_id: str
    idempotency_key: Optional[str] = None  # Prevent double-billing


class SaleCreatePayload(BaseModel):
    header: SalesHeaderCreate
    items: List[SalesItemCreate]
    payments: List[SalesPaymentCreate]


# --- OUTGOING RESPONSE SCHEMAS (GET) ---
class SalesPaymentResponse(BaseModel):
    method: str
    amount: Decimal


class SalesHeaderResponse(BaseModel):
    sales_id: int
    document_id: str
    date: date
    created_at: datetime
    shift: str
    sales_invoice_id: Optional[str] = None
    customer_name: Optional[str] = None
    register_id: str
    total_amount: Decimal

    location_name: str
    cashier_name: str
    payments: List[SalesPaymentResponse]

    class Config:
        from_attributes = True


class SalesDashboardResponse(BaseModel):
    kpis: dict
    sales: List[SalesHeaderResponse]

# Add to the bottom of backend/sales/schemas.py

class SalesItemDetailResponse(BaseModel):
    product_name: str
    pid: str
    qty: int
    price: Decimal
    discount_pct: Decimal
    discount_flat: Decimal
    net_cost: Decimal
    line_total: Decimal
    margin: Decimal

class SaleDeepDetailResponse(BaseModel):
    header: SalesHeaderResponse
    items: List[SalesItemDetailResponse]