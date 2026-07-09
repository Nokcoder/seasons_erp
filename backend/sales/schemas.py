# sales/schemas.py
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, date, timezone, timedelta


# ==========================================
# SHARED REFS
# ==========================================

class LocationRefOut(BaseModel):
    location_id: int
    location_name: str
    class Config: from_attributes = True


class VariantRefOut(BaseModel):
    variant_id:    int
    PID:           str
    variant_name:  str
    sku:           Optional[str] = None
    product_brand: Optional[str] = None
    product_type:  Optional[str] = None
    class Config: from_attributes = True


# ==========================================
# SHIFTS
# ==========================================

class ShiftCreate(BaseModel):
    shift_name: str
    is_active: bool = True


class ShiftPatch(BaseModel):
    shift_name: Optional[str] = None
    is_active: Optional[bool] = None


class ShiftOut(BaseModel):
    shift_id: int
    shift_name: str
    is_active: bool
    class Config: from_attributes = True


# ==========================================
# PAYMENT MODES
# ==========================================

class PaymentModeCreate(BaseModel):
    name: str
    is_physical: bool = True
    is_active: bool = True
    is_ar_charge: bool = False
    is_ar_credit: bool = False
    is_credit_memo: bool = False
    is_pdc: bool = False
    is_cash: bool = False


class PaymentModePatch(BaseModel):
    name: Optional[str] = None
    is_physical: Optional[bool] = None
    is_active: Optional[bool] = None
    is_ar_charge: Optional[bool] = None
    is_ar_credit: Optional[bool] = None
    is_credit_memo: Optional[bool] = None
    is_pdc: Optional[bool] = None
    is_cash: Optional[bool] = None


class PaymentModeOut(BaseModel):
    payment_mode_id: int
    name: str
    is_physical: bool
    is_active: bool
    is_ar_charge: bool
    is_ar_credit: bool
    is_credit_memo: bool = False
    is_pdc: bool = False
    is_cash: bool = False
    class Config: from_attributes = True


# ==========================================
# CASH REGISTERS
# ==========================================

class CashRegisterCreate(BaseModel):
    name: str
    location_id: int
    is_active: bool = True


class CashRegisterPatch(BaseModel):
    name: Optional[str] = None
    location_id: Optional[int] = None
    is_active: Optional[bool] = None


class CashRegisterOut(BaseModel):
    register_id: int
    name: str
    location_id: int
    is_active: bool
    location: Optional[LocationRefOut] = None
    class Config: from_attributes = True


# ==========================================
# CUSTOMERS
# ==========================================

class CustomerCreate(BaseModel):
    customer_name: str
    credit_limit: Optional[Decimal] = None
    terms_days: int = 0


class CustomerPatch(BaseModel):
    customer_name: Optional[str] = None
    credit_limit: Optional[Decimal] = None
    terms_days: Optional[int] = None


class CustomerOut(BaseModel):
    customer_id: int
    customer_name: str
    credit_limit: Optional[Decimal] = None
    terms_days: int
    outstanding_balance: Decimal
    is_deleted: bool
    has_bounced_check: bool = False
    is_overdue: bool = False
    class Config: from_attributes = True


# ==========================================
# AR AGING REPORT  (read-only; computed server-side)
# ==========================================

class AgingRowOut(BaseModel):
    customer_id:   int
    customer_name: str
    invoice_id:    int
    invoice_date:  date
    due_date:      date
    current_amt:   Decimal
    days_1_30:     Decimal
    days_31_60:    Decimal
    days_61_90:    Decimal
    days_91_plus:  Decimal


# ==========================================
# CUSTOMER AR LEDGER VIEW  (invoice-level)
# ==========================================

class CustomerARLedgerRowOut(BaseModel):
    sale_id:          int
    sale_pid:         str
    customer_id:      int
    customer_name:    str
    transaction_date: date
    due_date:         date
    grand_total:      Decimal
    balance_due:      Decimal
    status:           str  # Open | Partial | Paid | Overdue


class ARLedgerPaymentRowOut(BaseModel):
    payment_id:       int
    payment_date:     date
    payment_mode:     str
    reference_number: Optional[str] = None
    collection_receipt_no: Optional[str] = None
    amount_applied:   Decimal


class TransactionLedgerRowOut(BaseModel):
    """One row of a customer's AR-Charge transaction ledger — either the
    original credit sale (debit) or a subsequent collection payment against
    it (credit). Sorted oldest to newest with a running balance."""
    seq:             int  # ordinal position in the full chronological ledger; used as the Load More cursor
    date:            date
    type:            str  # 'SALE' | 'PAYMENT'
    sale_id:         Optional[int] = None
    payment_id:      Optional[int] = None
    sales_id:        str  # receipt_no for a sale row, collection_receipt_no for a payment row
    debit:           Decimal
    credit:          Decimal
    running_balance: Decimal
    status:          str  # 'Paid' | 'Partially Paid' | 'Unpaid' (SALE rows) | 'Payment' (PAYMENT rows)


# ==========================================
# AR LEDGER  (read-only; written programmatically)
# ==========================================

class ArLedgerOut(BaseModel):
    ar_ledger_id: int
    customer_id: Optional[int] = None
    amount_change: Decimal
    reason: str
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    occurred_at: datetime
    class Config: from_attributes = True


# ==========================================
# SALE LINE ITEMS  (input / output)
# ==========================================

class SaleLineItemIn(BaseModel):
    """One line sent by the frontend when creating or updating a draft.

    uom_id / uom_factor: present when selling in a non-base UOM (e.g. BOX).
    quantity is always in the selected UOM.  The backend converts to base units
    before writing sale_items and consuming FIFO layers.
    """
    variant_id: int
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Optional[Decimal] = None
    discount_flat: Optional[Decimal] = None
    uom_id: Optional[int] = None
    uom_factor: Optional[Decimal] = None


class SaleItemOut(BaseModel):
    """Raw sale_items row — one per FIFO layer split. Router collapses these for display."""
    sale_item_id: int
    sale_id: int
    variant_id: int
    cost_layer_id: Optional[int] = None
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Optional[Decimal] = None
    discount_flat: Optional[Decimal] = None
    line_total: Decimal
    gross_cost: Optional[Decimal] = None
    supplier_discount: Optional[Decimal] = None
    net_unit_cost: Optional[Decimal] = None
    cost_source:      Optional[str]     = None
    already_returned: Optional[Decimal] = None  # set by /sale/:id/items-for-return
    variant: Optional[VariantRefOut] = None
    class Config: from_attributes = True


# ==========================================
# SALES (header)
# ==========================================

class SaleCreate(BaseModel):
    """Payload for POST /sales/drafts — creates a draft sale."""
    location_id: int
    register_id: Optional[int] = None
    customer_id: Optional[int] = None
    employee_id: Optional[int] = None
    shift_id: Optional[int] = None
    origin_sale_id: Optional[int] = None
    sale_pid: Optional[str] = None
    idempotency_key: Optional[str] = None
    receipt_no: Optional[str] = None
    cart_discount_pct: Optional[Decimal] = None
    cart_discount_flat: Optional[Decimal] = None
    discount_amount: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    receipt_grand_total: Optional[Decimal] = None
    items: List[SaleLineItemIn] = []


class SalePatch(BaseModel):
    """Payload for PATCH /sales/drafts/{id} — update a draft's header or line items."""
    register_id: Optional[int] = None
    customer_id: Optional[int] = None
    employee_id: Optional[int] = None
    shift_id: Optional[int] = None
    receipt_no: Optional[str] = None
    cart_discount_pct: Optional[Decimal] = None
    cart_discount_flat: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None
    receipt_grand_total: Optional[Decimal] = None
    items: Optional[List[SaleLineItemIn]] = None


class SaleOut(BaseModel):
    sale_id: int
    sale_pid: Optional[str] = None
    transaction_date: Optional[date] = None
    posted_at: Optional[datetime] = None
    location_id: int
    register_id: Optional[int] = None
    customer_id: Optional[int] = None
    employee_id: Optional[int] = None
    shift_id: Optional[int] = None
    origin_sale_id: Optional[int] = None
    created_by_user_id: Optional[int] = None
    subtotal_amount: Decimal
    cart_discount_pct: Optional[Decimal] = None
    cart_discount_flat: Optional[Decimal] = None
    discount_amount: Decimal
    tax_amount: Decimal
    grand_total: Decimal
    receipt_grand_total: Optional[Decimal] = None
    audit_variance: Optional[Decimal] = None
    due_date: Optional[date] = None
    payment_status: str
    balance_due: Decimal
    status: str
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    idempotency_key: Optional[str] = None
    receipt_no: Optional[str] = None
    non_merchandise_revenue: Decimal = Decimal("0")
    items: List[SaleItemOut] = []
    payments: List["CustomerPaymentOut"] = []
    row_type: str = 'sale'          # 'sale' or 'return'
    return_id: Optional[int] = None  # set when row_type == 'return'
    class Config: from_attributes = True


class SaleTotals(BaseModel):
    count: int
    subtotal: Decimal
    discount: Decimal
    grand_total: Decimal
    receipt_total: Optional[Decimal] = None
    variance: Optional[Decimal] = None


class SalesListResponse(BaseModel):
    items: List[SaleOut]
    totals: SaleTotals
    next_cursor: Optional[int] = None


class CollectionEntry(BaseModel):
    payment_mode: str
    amount:       Decimal
    is_physical:  bool


class SalesSummaryResponse(BaseModel):
    merchandise_gross:       Decimal
    cart_discounts:          Decimal
    non_merchandise_revenue: Decimal
    variances:               Decimal
    returns_total:           Decimal
    cash_refunds_total:      Decimal
    total_revenue:           Decimal
    gross_profit:            Decimal
    uncosted_revenue:        Decimal
    collections:             List[CollectionEntry]
    total_physical:          Decimal
    total_virtual:           Decimal
    total_collected:         Decimal


# ==========================================
# VOID REQUEST
# ==========================================

class SaleVoidRequest(BaseModel):
    void_reason: str


# ==========================================
# POST SALE REQUEST
# ==========================================

_PH_TZ = timezone(timedelta(hours=8))


def _ph_today() -> date:
    """Today's calendar date in Manila local time (UTC+8).

    The container runs in UTC, so naive `date.today()` misclassifies the
    ~00:00-08:00 PHT window as "yesterday". Used as the default
    `transaction_date` when a posting payload omits it.
    """
    return datetime.now(_PH_TZ).date()


class SaleTenderIn(BaseModel):
    """One payment tender submitted at the point of sale."""
    payment_mode_id: int
    amount: Decimal
    reference_number: Optional[str] = None
    # PDC fields — required when payment mode has is_pdc=True
    check_number: Optional[str] = None
    check_date: Optional[date] = None
    bank_name: Optional[str] = None


class SalePostRequest(BaseModel):
    """Payload for POST /sales/drafts/{id}/post."""
    tenders: List[SaleTenderIn] = []
    is_cashiering_mode: bool = False
    transaction_date: date = Field(default_factory=_ph_today)


# ==========================================
# CUSTOMER PAYMENTS
# ==========================================

class PaymentApplicationIn(BaseModel):
    """One sale to apply part of a payment against."""
    sale_id: int
    amount_applied: Decimal


class CustomerPaymentCreate(BaseModel):
    customer_id: Optional[int] = None
    payment_mode_id: int
    amount: Decimal
    reference_number: Optional[str] = None
    applications: List[PaymentApplicationIn] = []


class CustomerPaymentAppliedOut(BaseModel):
    apply_id: int
    payment_id: int
    sale_id: int
    amount_applied: Decimal
    applied_at: datetime
    class Config: from_attributes = True


class CustomerPaymentOut(BaseModel):
    payment_id: int
    customer_id: Optional[int] = None
    payment_mode_id: int
    amount: Decimal
    payment_date: Optional[datetime] = None
    reference_number: Optional[str] = None
    collection_receipt_no: Optional[str] = None
    notes: Optional[str] = None
    unapplied_amount: Decimal
    applications: List[CustomerPaymentAppliedOut] = []
    # Populated when payment_mode relationship is eagerly loaded
    payment_mode_name:        Optional[str]  = None
    payment_mode_is_physical: Optional[bool] = None
    # PDC fields — non-null only when payment mode has is_pdc=True
    check_number:  Optional[str]  = None
    check_date:    Optional[date] = None
    bank_name:     Optional[str]  = None
    check_status:  Optional[str]  = None
    # Reversal — non-null only after POST /sales/payments/{id}/reverse
    reversed_at:          Optional[datetime] = None
    reversed_reason:      Optional[str]      = None
    reversed_by_user_id:  Optional[int]      = None
    class Config: from_attributes = True


class ManualPaymentApplyIn(BaseModel):
    """Payload for POST /sales/payments/{id}/apply — manually apply unapplied credit."""
    sale_id: int
    amount_applied: Decimal


class RecordPaymentIn(BaseModel):
    """Standalone payment against a customer balance — no sale application required."""
    payment_mode_id: int
    amount: Decimal
    payment_date: Optional[datetime] = None
    reference_number: Optional[str] = None
    collection_receipt_no: Optional[str] = None
    notes: Optional[str] = None
    sale_id: Optional[int] = None  # when provided, applies payment to this specific sale
    # PDC fields — required when payment mode has is_pdc=True
    check_number: Optional[str] = None
    check_date: Optional[date] = None
    bank_name: Optional[str] = None


class PDCPaymentFields(BaseModel):
    """Required PDC fields for both POS and AR payment recording."""
    check_number: str
    check_date: date
    bank_name: str


class ArLedgerOut(BaseModel):
    ar_ledger_id: int
    customer_id: Optional[int] = None
    amount_change: Decimal
    reason: str
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    notes: Optional[str] = None
    occurred_at: Optional[datetime] = None
    class Config: from_attributes = True


# ==========================================
# SALES RETURNS
# ==========================================

class SalesReturnItemIn(BaseModel):
    """One item line for a return. sale_item_id may be omitted for blind returns."""
    sale_item_id: Optional[int] = None
    variant_id: int
    quantity: Decimal
    unit_price: Decimal


class SalesReturnCreate(BaseModel):
    sale_id: Optional[int] = None       # Omitted for blind returns
    location_id: Optional[int] = None   # Defaults to original sale's location if sale_id given
    customer_id: Optional[int] = None   # For blind returns with a registered customer
    disposition: Optional[str] = None   # 'cash_refund' or 'credit_to_account'
    reason: Optional[str] = None
    return_date: Optional[date] = None
    shift_id: Optional[int] = None
    register_id: Optional[int] = None
    items: List[SalesReturnItemIn]


class SalesReturnItemOut(BaseModel):
    return_item_id: int
    return_id: int
    sale_item_id: Optional[int] = None
    variant_id: int
    cost_layer_id: Optional[int] = None
    quantity: Decimal
    line_total: Decimal
    variant: Optional[VariantRefOut] = None
    class Config: from_attributes = True


class SalesReturnOut(BaseModel):
    return_id: int
    return_pid: Optional[str] = None
    sale_id: Optional[int] = None
    location_id: int
    return_date: Optional[date] = None
    reason: Optional[str] = None
    grand_total: Decimal
    disposition: Optional[str] = None
    customer_id: Optional[int] = None
    created_by_user_id: Optional[int] = None
    shift_id: Optional[int] = None
    register_id: Optional[int] = None
    items: List[SalesReturnItemOut] = []
    exchange_sale_pid: Optional[str] = None  # set if an exchange was created
    exchange_sale_id:  Optional[int] = None  # set if an exchange was created
    class Config: from_attributes = True


class ExchangeResult(BaseModel):
    """Response from POST /sales/returns/exchange."""
    sales_return:    SalesReturnOut
    exchange_draft:  "SaleOut"


# ==========================================
# SUPPLIER RETURNS
# ==========================================

class SupplierReturnItemIn(BaseModel):
    variant_id: int
    cost_layer_id: Optional[int] = None
    quantity: Decimal
    unit_credit_expected: Optional[Decimal] = None


class SupplierReturnCreate(BaseModel):
    supplier_id: int
    location_id: int
    items: List[SupplierReturnItemIn]
    total_credit_amount: Optional[Decimal] = None


class SupplierReturnStatusPatch(BaseModel):
    """Payload for PATCH /procurement/supplier-returns/{id}/status"""
    status: str   # Draft | Shipped | Credit_Received


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
    class Config: from_attributes = True


# ==========================================
# CREDIT MEMOS
# ==========================================

class CreditMemoCreate(BaseModel):
    amount: Decimal
    valid_until: Optional[date] = None   # defaults to issued_at + 30 days server-side
    return_id: Optional[int] = None
    notes: Optional[str] = None


class CreditMemoRedemptionOut(BaseModel):
    redemption_id:       int
    memo_id:             int
    sale_id:             int
    amount_redeemed:     Decimal
    redeemed_at:         Optional[datetime] = None
    redeemed_by_user_id: int
    class Config: from_attributes = True


class CreditMemoOut(BaseModel):
    memo_id:              int
    code:                 str
    amount:               Decimal
    status:               str
    issued_at:            date
    valid_until:          date
    issued_by_user_id:    Optional[int] = None
    issued_by_name:       Optional[str] = None
    return_id:            Optional[int] = None
    return_pid:           Optional[str] = None
    notes:                Optional[str] = None
    cancelled_by_user_id: Optional[int] = None
    cancelled_at:         Optional[datetime] = None
    redemptions:          List[CreditMemoRedemptionOut] = []
    class Config: from_attributes = True


class CreditMemoListOut(BaseModel):
    memo_id:            int
    code:               str
    amount:             Decimal
    status:             str
    issued_at:          date
    valid_until:        date
    issued_by_user_id:  Optional[int] = None
    issued_by_name:     Optional[str] = None
    return_id:          Optional[int] = None
    return_pid:         Optional[str] = None
    notes:              Optional[str] = None
    redeemed_sale_id:   Optional[int] = None
    class Config: from_attributes = True


class CreditMemoValidateOut(BaseModel):
    memo_id:        Optional[int] = None
    code:           str
    amount:         Optional[Decimal] = None
    valid_until:    Optional[date] = None
    status:         Optional[str] = None
    is_valid:       bool
    invalid_reason: Optional[str] = None   # EXPIRED | CANCELLED | REDEEMED | NOT_FOUND


# ==========================================
# PDC VAULT & MATURITY REPORT
# ==========================================

class PDCEntryOut(BaseModel):
    payment_id:          int
    customer_id:         int
    customer_name:       str
    check_number:        str
    check_date:          date
    bank_name:           str
    check_status:        str   # IN_VAULT | DEPOSITED | BOUNCED
    amount:              Decimal
    payment_date:        Optional[date] = None  # when the payment was recorded / deposited
    days_until_maturity: int               # negative = overdue, 0 = today, positive = future
    sale_ids:            List[int]
    sale_refs:           List[str]


class PDCMaturitySummary(BaseModel):
    maturing_today:      Decimal   # IN_VAULT checks whose check_date == as_of
    maturing_next_7_days: Decimal  # IN_VAULT checks whose check_date between as_of and as_of+7
    total_uncleared:     Decimal   # all IN_VAULT checks
    total_overdue:       Decimal   # IN_VAULT checks past check_date


class PDCMaturityResponse(BaseModel):
    summary: PDCMaturitySummary
    entries: List[PDCEntryOut]


class PDCDepositIn(BaseModel):
    deposited_at: date


class PDCBounceIn(BaseModel):
    bounce_notes: Optional[str] = None


class PaymentReversalRequest(BaseModel):
    """Payload for POST /sales/payments/{id}/reverse."""
    reversal_reason: str
