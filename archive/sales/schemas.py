# backend/sales/schemas.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal


# --- INCOMING PAYLOAD SCHEMAS (POST) ---
class SalesItemCreate(BaseModel):
    product_id: int
    qty: int  # This remains int, but now accepts negative numbers for refunds
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
    register_id: str
    date: date
    shift: str
    sales_invoice_id: Optional[str] = None
    delivery_receipt_id: Optional[str] = None

    subtotal_amount: Decimal
    discount_amount: Decimal = Decimal('0.00')  # Item-level aggregate
    tax_amount: Optional[Decimal] = Decimal('0.00')

    # New separate tracks
    basket_discount_amount: Optional[Decimal] = Decimal('0.00')
    service_charge: Optional[Decimal] = Decimal('0.00')
    delivery_charge: Optional[Decimal] = Decimal('0.00')
    total_amount: Decimal

    transaction_type: str = "SALE"
    manual_adjustment_amount: Decimal = Decimal('0.00')  # "Bad Math" track
    adjustment_reason: Optional[str] = None
    linked_receipt_id: Optional[str] = None
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    idempotency_key: Optional[str] = None


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

    # --- ADD THE MISSING BASKET DISCOUNT ---
    discount_amount: Decimal = Decimal('0.00')
    basket_discount_amount: Decimal = Decimal('0.00')  # <--- THIS WAS MISSING
    service_charge: Decimal = Decimal('0.00')
    delivery_charge: Decimal = Decimal('0.00')
    # ---------------------------------------

    transaction_type: str = "SALE"
    manual_adjustment_amount: Decimal = Decimal('0.00')
    adjustment_reason: Optional[str] = None
    linked_receipt_id: Optional[str] = None

    location_name: str
    cashier_name: str
    payments: List[SalesPaymentResponse]

    class Config:
        from_attributes = True


class DashboardKPIs(BaseModel):
    total_collected: float
    margined_net_sales: float      # The profit from items with costs
    unmargined_gross_sales: float  # The revenue from items without costs
    margined_revenue: float        # Added so Merchandise Gross calculates correctly!
    total_basket_discounts: float
    logistics_total: float
    net_discrepancies: float

class SalesDashboardResponse(BaseModel):
    kpis: DashboardKPIs
    sales: List[SalesHeaderResponse]


class SalesItemDetailResponse(BaseModel):
    product_id: int            # <--- ADD THIS
    product_name: str
    brand: Optional[str] = ""  # <--- ADD THIS
    sku: Optional[str] = ""    # <--- ADD THIS
    is_inventory: bool = True  # <--- ADD THIS
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