# inventory/schemas.py
from __future__ import annotations
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from decimal import Decimal
from datetime import datetime


# ── UOM ───────────────────────────────────────────────────────────────────────
class UOMOut(BaseModel):
    uom_id: int
    uom_code: str
    uom_name: Optional[str] = None
    class Config: from_attributes = True


# ── CATEGORY ─────────────────────────────────────────────────────────────────
class CategoryOut(BaseModel):
    category_id: int
    category_name: str
    parent_category_id: Optional[int] = None
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


# ── VARIANT UOM CONVERSIONS ───────────────────────────────────────────────────
class VariantUomConversionCreate(BaseModel):
    from_uom_id: int
    to_uom_id: int
    factor: Decimal

class VariantUomConversionUpdate(BaseModel):
    factor: Decimal

class VariantUomConversionOut(BaseModel):
    variant_id: int
    from_uom_id: int
    to_uom_id: int
    factor: Decimal
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

class BundleComponentOut(BaseModel):
    bundle_variant_id: int
    component_variant_id: int
    quantity: Decimal
    class Config: from_attributes = True


# ── SUPPLIER (reference) ──────────────────────────────────────────────────────
class SupplierRefOut(BaseModel):
    supplier_id: int
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

class SupplierOut(BaseModel):
    supplier_id: int
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

class VariantUpdate(BaseModel):
    variant_name: Optional[str] = None
    sku: Optional[str] = None
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None
    is_default: Optional[bool] = None
    attributes: Optional[Dict[str, Any]] = None

class VariantOut(BaseModel):
    variant_id: int
    PID: str
    variant_name: str
    sku: Optional[str] = None
    price: Optional[Decimal] = None
    promo_price: Optional[Decimal] = None
    is_default: bool
    is_deleted: bool
    attributes: Optional[Dict[str, Any]] = None
    current_stock: List[CurrentStockOut] = []
    suppliers: List[VariantSupplierOut] = []
    cost_layers: List[CostLayerOut] = []
    class Config: from_attributes = True


# ── PRODUCTS ──────────────────────────────────────────────────────────────────
class ProductCreate(BaseModel):
    name: str
    product_type: str = "Inventory"     # Inventory | Non-Inventory | Service
    description: Optional[str] = None
    base_uom_id: Optional[int] = None
    category_names: List[str] = []
    variants: List[VariantCreate]       # at least one required

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    product_type: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None        # Active | Inactive
    base_uom_id: Optional[int] = None
    category_names: Optional[List[str]] = None

class ProductOut(BaseModel):
    product_id: int
    name: str
    product_type: str
    description: Optional[str] = None
    status: str
    is_deleted: bool
    categories: List[CategoryOut] = []
    variants: List[VariantOut] = []
    class Config: from_attributes = True


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


# ── USER REF (for transfer output) ───────────────────────────────────────────
class UserRefOut(BaseModel):
    user_id: int
    username: str
    class Config: from_attributes = True


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
    transfer_pid: Optional[str] = None
    total_bundle_count: int = 0
    items: List[TransferItemCreate]

class TransferItemOut(BaseModel):
    transfer_item_id: int
    variant_id: int
    quantity_requested: Decimal
    quantity_released: Optional[Decimal] = None
    quantity_received: Optional[Decimal] = None
    class Config: from_attributes = True

class TransferOut(BaseModel):
    transfer_id: int
    transfer_pid: Optional[str] = None
    from_location_id: int
    to_location_id: int
    total_bundle_count: int
    occurred_at: datetime
    from_location: Optional[LocationOut] = None
    to_location: Optional[LocationOut] = None
    released_by: Optional[UserRefOut] = None
    received_by: Optional[UserRefOut] = None
    requested_by: Optional[UserRefOut] = None
    items: List[TransferItemOut] = []
    class Config: from_attributes = True
