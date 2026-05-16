# inventory/schemas.py
from pydantic import BaseModel
from typing import List, Optional, Any
from decimal import Decimal
from datetime import datetime
from auth.schemas import UserSchema


# --- 1. INPUT SCHEMAS (The Catching Mitts for POST and PUT requests) ---

class ProductCreate(BaseModel):
    pid: str
    name: str
    is_bundle: bool = False
    sku: Optional[str] = None
    brand: Optional[str] = None
    variant: Optional[str] = None
    description: Optional[str] = None
    category_text: Optional[str] = None

    tag_price: Optional[Decimal] = None
    net_price: Optional[Decimal] = None
    price_discount: Optional[Decimal] = Decimal('0.0000')
    gross_cost: Optional[Decimal] = None
    cost_discount: Optional[Decimal] = Decimal('0.0000')
    units_per_bundle: int = 1
    categories: Optional[str] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    brand: Optional[str] = None
    variant: Optional[str] = None
    description: Optional[str] = None

    tag_price: Optional[Decimal] = None
    net_price: Optional[Decimal] = None
    category_text: Optional[str] = None

    price_discount: Optional[Decimal] = None
    gross_cost: Optional[Decimal] = None
    cost_discount: Optional[Decimal] = None
    is_active: Optional[bool] = None
    units_per_bundle: int = 1
    categories: Optional[str] = None


# --- 2. OUTPUT SCHEMAS (The Blueprints for GET requests to React) ---

class CategorySchema(BaseModel):
    category_id: int
    category_name: str
    class Config: from_attributes = True

class LocationSchema(BaseModel):
    location_id: int
    name: str
    class Config: from_attributes = True

class CurrentStockSchema(BaseModel):
    quantity: Decimal
    location: LocationSchema
    class Config: from_attributes = True

class SupplierBasicSchema(BaseModel):
    name: str
    class Config: from_attributes = True

class ProductSupplierSchema(BaseModel):
    vendor_sku: Optional[str] = None
    vendor_cost: Optional[Decimal] = None
    lead_time_days: Optional[int] = None
    is_primary: bool
    supplier: SupplierBasicSchema
    class Config: from_attributes = True

class PriceHistorySchema(BaseModel):
    history_id: int
    old_tag_price: Optional[Decimal] = None
    new_tag_price: Optional[Decimal] = None
    old_net_price: Optional[Decimal] = None
    new_net_price: Optional[Decimal] = None
    old_gross_cost: Optional[Decimal] = None
    new_gross_cost: Optional[Decimal] = None
    old_net_cost: Optional[Decimal] = None
    new_net_cost: Optional[Decimal] = None
    changed_at: datetime
    class Config: from_attributes = True

class CostLayerSchema(BaseModel):
    layer_id: int
    unit_cost: Decimal
    original_qty: Decimal
    remaining_qty: Decimal
    received_at: datetime
    class Config: from_attributes = True

class ProductSchema(BaseModel):
    product_id: int
    pid: str
    name: str
    sku: Optional[str] = None
    brand: Optional[str] = None
    variant: Optional[str] = None
    description: Optional[str] = None

    tag_price: Optional[Decimal] = None
    price_discount: Optional[Decimal] = None
    net_price: Optional[Decimal] = None
    gross_cost: Optional[Decimal] = None
    cost_discount: Optional[Decimal] = None
    net_cost: Optional[Decimal] = None

    units_per_bundle: int = 1

    categories: List[CategorySchema] = []
    current_stock: List[CurrentStockSchema] = []
    vendors: List[ProductSupplierSchema] = []  # <--- THE FIX
    price_history: List[PriceHistorySchema] = []
    cost_layers: List[CostLayerSchema] = []

    class Config: from_attributes = True


# --- 3. SYSTEM SCHEMAS ---


# --- 4. LOGISTICS SCHEMAS (Transfers) ---

class TransferLocationSchema(BaseModel):
    location_id: int
    name: str
    class Config: from_attributes = True

class StockTransferItemSchema(BaseModel):
    item_id: int
    product_id: int
    bundling: Optional[str] = None

    # THE THREE TRUTHS
    requested_qty: Decimal
    released_qty: Optional[Decimal] = None
    received_qty: Optional[Decimal] = None

    product: Optional[ProductSchema] = None
    class Config: from_attributes = True

class StockTransferSchema(BaseModel):
    transfer_id: int
    document_id: Optional[str] = None
    transfer_date: datetime
    bundle_count: int

    # STATE MACHINE
    status: str
    has_discrepancy: bool

    from_location: Optional[TransferLocationSchema] = None
    to_location: Optional[TransferLocationSchema] = None
    released_by: Optional[UserSchema] = None
    received_by: Optional[UserSchema] = None
    items: List[StockTransferItemSchema] = []

    class Config: from_attributes = True


# --- 5. LOGISTICS INPUT SCHEMAS (For Creating Transfers) ---

class TransferItemCreate(BaseModel):
    product_id: int
    bundling: Optional[str] = None
    requested_qty: Decimal

class StockTransferCreate(BaseModel):
    document_id: Optional[str] = None
    from_location_id: int
    to_location_id: int
    released_by_id: int
    received_by_id: int
    bundle_count: int = 0
    is_direct: bool = False # Needed for the two-button setup!
    items: List[TransferItemCreate]