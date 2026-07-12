# inventory/schemas.py
from __future__ import annotations
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from decimal import Decimal
from datetime import datetime, date


# ── UOM ───────────────────────────────────────────────────────────────────────
class UOMCreate(BaseModel):
    uom_code: str
    uom_name: Optional[str] = None

class UOMUpdate(BaseModel):
    uom_name: Optional[str] = None

class UOMOut(BaseModel):
    uom_id: int
    uom_code: str
    uom_name: Optional[str] = None
    is_deleted: bool
    class Config: from_attributes = True


# ── CATEGORY ─────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    category_name: str
    parent_category_id: Optional[int] = None

class CategoryUpdate(BaseModel):
    category_name: Optional[str] = None
    parent_category_id: Optional[int] = None

class CategoryOut(BaseModel):
    category_id: int
    category_name: str
    parent_category_id: Optional[int] = None
    is_deleted: bool
    class Config: from_attributes = True


# ── LOCATION ─────────────────────────────────────────────────────────────────
class LocationCreate(BaseModel):
    location_name: str
    location_type: str          # Warehouse | Store | Bin | Virtual
    parent_location_id: Optional[int] = None
    address: Optional[str] = None

class LocationUpdate(BaseModel):
    location_name: Optional[str] = None
    location_type: Optional[str] = None
    status: Optional[str] = None    # Active | Inactive
    address: Optional[str] = None

class LocationOut(BaseModel):
    location_id: int
    location_name: str
    location_type: str
    status: str
    is_system: bool = False
    address: Optional[str] = None
    parent_location_id: Optional[int] = None
    class Config: from_attributes = True


# ── CURRENT STOCK ─────────────────────────────────────────────────────────────
class CurrentStockOut(BaseModel):
    quantity: Decimal
    location: LocationOut
    class Config: from_attributes = True


# ── COST LAYER ────────────────────────────────────────────────────────────────
class CostLayerOut(BaseModel):
    layer_id: int
    gross_cost: Decimal
    supplier_discount: Decimal
    net_unit_cost: Decimal
    original_quantity: Decimal
    quantity_remaining: Decimal
    location_id: int
    created_at: datetime
    class Config: from_attributes = True


# ── VARIANT BARCODES ─────────────────────────────────────────────────────────
class VariantBarcodeCreate(BaseModel):
    barcode: str
    uom_id: Optional[int] = None
    is_primary: bool = False

class VariantBarcodeUpdate(BaseModel):
    uom_id: Optional[int] = None
    is_primary: Optional[bool] = None

class VariantBarcodeOut(BaseModel):
    barcode_id: int
    variant_id: int
    barcode: str
    uom_id: Optional[int] = None
    is_primary: bool
    class Config: from_attributes = True


# ── BARCODE RESOLVER (Fix 2, reverse direction) ──────────────────────────────
class BarcodeResolveOut(BaseModel):
    variant_id: int
    PID: str
    variant_name: str
    product_id: int
    matched_via: str  # "barcode" | "pid"
    class Config: from_attributes = True


# ── VARIANT UOM CONVERSIONS ───────────────────────────────────────────────────
class VariantUomConversionCreate(BaseModel):
    from_uom_id: int
    to_uom_id: int
    factor: Decimal
    is_warehouse_bundle: bool = False
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None

class VariantUomConversionUpdate(BaseModel):
    """Partial update — only fields included in the request body are modified."""
    factor: Optional[Decimal] = None
    is_warehouse_bundle: Optional[bool] = None
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None

class VariantUomConversionOut(BaseModel):
    variant_id: int
    from_uom_id: int
    to_uom_id: int
    factor: Decimal
    is_warehouse_bundle: bool
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None
    class Config: from_attributes = True


# ── VARIANT SUPPLIERS ─────────────────────────────────────────────────────────
class VariantSupplierCreate(BaseModel):
    supplier_id: int
    supplier_sku: Optional[str] = None
    gross_cost: Optional[Decimal] = None
    supplier_discount: Decimal = Decimal("0")
    is_primary: bool = False

class VariantSupplierUpdate(BaseModel):
    supplier_sku: Optional[str] = None
    gross_cost: Optional[Decimal] = None
    supplier_discount: Optional[Decimal] = None
    is_primary: Optional[bool] = None


# ── BUNDLE COMPONENTS ─────────────────────────────────────────────────────────
class BundleComponentCreate(BaseModel):
    component_variant_id: int
    quantity: Decimal

class BundleComponentUpdate(BaseModel):
    quantity: Decimal

class VariantMiniRef(BaseModel):
    """Minimal variant reference used inside BundleComponentOut."""
    variant_id: int
    PID: str
    variant_name: str
    class Config: from_attributes = True


class ProductBrandRef(BaseModel):
    brand: str
    class Config: from_attributes = True


class VariantWithProductRef(BaseModel):
    """Variant ref that includes sku and brand — used in transfer/receiving line items."""
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

class BundleComponentOut(BaseModel):
    bundle_variant_id: int
    component_variant_id: int
    quantity: Decimal
    component_variant: Optional[VariantMiniRef] = None
    class Config: from_attributes = True


# ── SUPPLIER (reference) ──────────────────────────────────────────────────────
class SupplierRefOut(BaseModel):
    supplier_id: int
    supplier_code: str = ""
    supplier_name: str
    class Config: from_attributes = True

class VariantSupplierOut(BaseModel):
    id: int
    supplier_sku: Optional[str] = None
    gross_cost: Optional[Decimal] = None
    supplier_discount: Decimal
    is_primary: bool
    supplier: SupplierRefOut
    class Config: from_attributes = True


# ── SUPPLIER CRUD ─────────────────────────────────────────────────────────────
class SupplierCreate(BaseModel):
    supplier_code: str
    supplier_name: str
    bank_account_name: Optional[str] = None
    terms: int = 0
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    contact_notes: Optional[str] = None

class SupplierUpdate(BaseModel):
    supplier_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    terms: Optional[int] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    contact_notes: Optional[str] = None

class SupplierPatch(BaseModel):
    """For deactivate / reactivate. supplier_code is intentionally excluded — read-only after creation."""
    supplier_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    terms: Optional[int] = None
    is_deleted: Optional[bool] = None

class SupplierOut(BaseModel):
    supplier_id: int
    supplier_code: str
    supplier_name: str
    bank_account_name: Optional[str] = None
    terms: int
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    contact_notes: Optional[str] = None
    is_deleted: bool
    class Config: from_attributes = True


# ── VARIANTS ─────────────────────────────────────────────────────────────────
class VariantCreate(BaseModel):
    PID: str
    variant_name: str = "Default"
    sku: Optional[str] = None
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None
    is_default: bool = False
    attributes: Optional[Dict[str, Any]] = None
    include_in_ordering: bool = True
    is_phased_out: bool = False

class VariantUpdate(BaseModel):
    PID: Optional[str] = None
    variant_name: Optional[str] = None
    sku: Optional[str] = None
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None
    is_default: Optional[bool] = None
    attributes: Optional[Dict[str, Any]] = None
    include_in_ordering: Optional[bool] = None
    is_phased_out: Optional[bool] = None
    is_deleted: Optional[bool] = None  # deactivate/reactivate, same convention as SupplierPatch

class BundleAvailableStock(BaseModel):
    """Computed available bundle count at one physical location."""
    location_id:   int
    location_name: str
    available:     int


class VariantOut(BaseModel):
    variant_id: int
    product_id: int
    PID: str
    variant_name: str
    sku: Optional[str] = None
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None
    is_default: bool
    is_deleted: bool
    include_in_ordering: bool
    is_phased_out: bool
    attributes: Optional[Dict[str, Any]] = None
    current_stock: List[CurrentStockOut] = []
    suppliers: List[VariantSupplierOut] = []
    cost_layers: List[CostLayerOut] = []
    barcodes: List[VariantBarcodeOut] = []
    uom_conversions: List[VariantUomConversionOut] = []
    bundle_components: List[BundleComponentOut] = []
    bundle_available_stock: List[BundleAvailableStock] = []
    resolved_barcode: str = ""
    class Config: from_attributes = True


# ── PRODUCTS ──────────────────────────────────────────────────────────────────
class ProductCreate(BaseModel):
    brand: str
    product_type: str = "Inventory"     # Inventory | Non-Inventory | Service
    description: Optional[str] = None
    base_uom_id: Optional[int] = None
    category_names: List[str] = []
    variants: List[VariantCreate]       # at least one required

class ProductUpdate(BaseModel):
    brand: Optional[str] = None
    product_type: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None        # Active | Inactive
    base_uom_id: Optional[int] = None
    category_names: Optional[List[str]] = None

class ProductOut(BaseModel):
    product_id: int
    brand: str
    product_type: str
    description: Optional[str] = None
    status: str
    is_deleted: bool
    base_uom_id: Optional[int] = None
    base_uom: Optional[UOMOut] = None
    categories: List[CategoryOut] = []
    variants: List[VariantOut] = []
    class Config: from_attributes = True


# ── POS CATALOG ───────────────────────────────────────────────────────────────

class POSStockEntry(BaseModel):
    location_id: int
    location_name: str
    quantity: Decimal


class POSUomConversionOut(BaseModel):
    """Priced UOM conversion exposed in the POS catalog for UOM selling."""
    from_uom_id:   int
    from_uom_code: str
    to_uom_id:     int
    to_uom_code:   str
    factor:        Decimal
    price:         Optional[Decimal]
    promo_price:   Optional[Decimal]


class POSVariantOut(BaseModel):
    variant_id: int
    PID: str
    variant_name: str
    sku: Optional[str] = None
    price: Optional[Decimal]        # resolved: own price or default sibling's price
    promo_price: Optional[Decimal]  # takes precedence over price for display if set
    attributes: Optional[Dict[str, Any]]
    barcodes: List[VariantBarcodeOut]
    stock: List[POSStockEntry]
    uom_conversions: List[POSUomConversionOut] = []  # only conversions with price set


class POSCatalogItemOut(BaseModel):
    product_id: int
    product_brand: str
    product_type: str
    variants: List[POSVariantOut]


# ── INVENTORY LEDGER ──────────────────────────────────────────────────────────
class LedgerEntryOut(BaseModel):
    ledger_id: int
    variant_id: int
    location_id: int
    qty_change: Decimal
    reason: str
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    occurred_at: datetime
    class Config: from_attributes = True


# ── LEDGER WITH CONTEXT (top-level browser) ──────────────────────────────────

class ProductBriefOut(BaseModel):
    product_id: int
    brand:      str
    class Config: from_attributes = True

class VariantBriefOut(BaseModel):
    variant_id:   int
    PID:          str
    variant_name: str
    sku:          Optional[str] = None
    product:      Optional[ProductBriefOut] = None
    class Config: from_attributes = True

class LocationBriefOut(BaseModel):
    location_id:   int
    location_name: str
    class Config: from_attributes = True

class LedgerEntryContextOut(BaseModel):
    ledger_id:      int
    variant_id:     int
    location_id:    int
    qty_change:     Decimal
    reason:         str
    reference_type: Optional[str] = None
    reference_id:   Optional[str] = None
    occurred_at:    datetime
    document_id:    Optional[str] = None
    variant:        Optional[VariantBriefOut]  = None
    location:       Optional[LocationBriefOut] = None
    class Config: from_attributes = True


# ── IMPORT UPSERT ─────────────────────────────────────────────────────────────

class ImportVariantRow(BaseModel):
    PID:          str
    variant_name: Optional[str] = None
    sku:          Optional[str] = None
    price:        Optional[Decimal] = None
    promo_price:  Optional[Decimal] = None
    is_default:   bool = False
    attributes:   Optional[Dict[str, Any]] = None

class ImportProductRow(BaseModel):
    brand:           str
    product_type:    str = "Inventory"
    description:     Optional[str] = None
    base_uom_id:     Optional[int] = None
    category_names:  List[str] = []
    variants:        List[ImportVariantRow]

class ImportPreviewVariant(BaseModel):
    PID:        str
    mode:       str  # "create" | "update"
    old_values: Optional[Dict[str, Any]] = None
    new_values: Dict[str, Any]
    diff_fields: List[str] = []

class ImportPreviewRow(BaseModel):
    brand:           str
    product_mode:    str  # "create" | "update"
    product_id:      Optional[int] = None
    variants:        List[ImportPreviewVariant]

class ImportPreviewResponse(BaseModel):
    rows: List[ImportPreviewRow]

class ImportConfirmRequest(BaseModel):
    rows: List[ImportProductRow]
    confirmed_pids: List[str]  # PIDs the user confirmed; others skipped


# ── USER REF (for transfer output) ───────────────────────────────────────────
class UserRefOut(BaseModel):
    user_id: int
    username: str
    class Config: from_attributes = True


# ── VARIANT PRICE HISTORY ─────────────────────────────────────────────────────
class VariantPriceHistoryOut(BaseModel):
    history_id:            int
    variant_id:            int
    old_price:             Optional[Decimal] = None
    new_price:             Optional[Decimal] = None
    old_promo_price:       Optional[Decimal] = None
    new_promo_price:       Optional[Decimal] = None
    changed_by_user_id:    Optional[int]     = None
    changed_by_username:   Optional[str]     = None
    changed_at:            datetime
    class Config: from_attributes = True


# ── VARIANT COST HISTORY ──────────────────────────────────────────────────────
class VariantCostHistoryOut(BaseModel):
    history_id:             int
    variant_id:             int
    supplier_id:            int
    supplier_name:          Optional[str]    = None
    old_gross_cost:         Optional[Decimal] = None
    new_gross_cost:         Optional[Decimal] = None
    old_supplier_discount:  Optional[Decimal] = None
    new_supplier_discount:  Optional[Decimal] = None
    changed_by_user_id:     Optional[int]     = None
    changed_by_username:    Optional[str]     = None
    changed_at:             datetime
    class Config: from_attributes = True


# ── SALES HISTORY ITEM (derived from sale_items + sales) ─────────────────────
class SalesHistoryItem(BaseModel):
    sale_pid:    Optional[str]      = None
    transaction_date: Optional[date] = None
    cashier:     Optional[str]      = None
    quantity:    Decimal
    unit_price:  Decimal
    line_total:  Decimal
    sale_status: str


# ── PURCHASE HISTORY ITEM (derived from receiving_details + shipments) ────────
class PurchaseHistoryItem(BaseModel):
    document_id:       Optional[str]      = None  # shipment.reference_number — the physical/supplier document reference, not shipment_pid
    received_at:       Optional[datetime] = None
    supplier_name:     Optional[str]      = None
    quantity_received: Decimal
    net_unit_cost:     Optional[Decimal]  = None
    qc_status:         Optional[str]      = None


# ── TRANSFERS ─────────────────────────────────────────────────────────────────
class TransferItemCreate(BaseModel):
    variant_id: int
    quantity_requested: Decimal
    quantity_released: Optional[Decimal] = None
    quantity_received: Optional[Decimal] = None

class TransferCreate(BaseModel):
    from_location_id: int
    to_location_id: int
    released_by_user_id: Optional[int] = None
    received_by_user_id: Optional[int] = None
    requested_by_user_id: Optional[int] = None
    released_by_employee_id: Optional[int] = None
    received_by_employee_id: Optional[int] = None
    transfer_pid: Optional[str] = None
    total_bundle_count: int = 0
    occurred_at: Optional[datetime] = None
    items: List[TransferItemCreate]

class TransferItemOut(BaseModel):
    transfer_item_id: int
    variant_id: int
    quantity_requested: Decimal
    quantity_released: Optional[Decimal] = None
    quantity_received: Optional[Decimal] = None
    variant: Optional[VariantWithProductRef] = None
    class Config: from_attributes = True

class TransferOut(BaseModel):
    transfer_id: int
    transfer_pid: Optional[str] = None
    from_location_id: int
    to_location_id: int
    total_bundle_count: int
    occurred_at: datetime
    status: str = "Posted"
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    from_location: Optional[LocationOut] = None
    to_location: Optional[LocationOut] = None
    released_by: Optional[UserRefOut] = None
    received_by: Optional[UserRefOut] = None
    requested_by: Optional[UserRefOut] = None
    released_by_employee: Optional[EmployeeRefOut] = None
    received_by_employee: Optional[EmployeeRefOut] = None
    items: List[TransferItemOut] = []
    class Config: from_attributes = True
