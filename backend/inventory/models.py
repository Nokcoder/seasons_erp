from sqlalchemy import Column, Integer, String, Boolean, Numeric, ForeignKey, Text, Table, DateTime, BigInteger, Enum as SQLEnum, FetchedValue, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from core.database import Base
from auth.models import User

# --- 1. ENUMS ---
class LedgerReason(enum.Enum):
    RECEIVE = 'RECEIVE'
    SALE = 'SALE'
    TRANSFER_IN = 'TRANSFER_IN'
    TRANSFER_OUT = 'TRANSFER_OUT'
    ADJUST = 'ADJUST'

# --- 2. THE MANY-TO-MANY BRIDGE ---
product_category_association = Table(
    'product_category_link',
    Base.metadata,
    Column('product_id', Integer, ForeignKey('inventory.products.product_id', ondelete="CASCADE"), primary_key=True),
    Column('category_id', Integer, ForeignKey('inventory.product_categories.category_id', ondelete="CASCADE"), primary_key=True),
    schema='inventory'
)

# --- 3. SUPPORTING TABLES ---
class Supplier(Base):
    __tablename__ = "suppliers"
    __table_args__ = {"schema": "inventory"}

    supplier_id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    contact_person = Column(String(255))
    contact_notes = Column(Text)
    phone = Column(String(50))
    email = Column(String(255))
    address = Column(Text)
    payment_terms = Column(String(100))
    banking_details = Column(Text)
    registered_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)

class ProductCategory(Base):
    __tablename__ = "product_categories"
    __table_args__ = {"schema": "inventory"}

    category_id = Column(Integer, primary_key=True)
    category_name = Column(String(255), unique=True, nullable=False)
    parent_category_id = Column(Integer, ForeignKey('inventory.product_categories.category_id'))
    is_deleted = Column(Boolean, default=False)

class UOM(Base):
    __tablename__ = "uoms"
    __table_args__ = {"schema": "inventory"}

    uom_id = Column(Integer, primary_key=True)
    uom_code = Column(String(50), unique=True, nullable=False)
    uom_name = Column(String(255))
    is_deleted = Column(Boolean, default=False)

# --- 4. MASTER PRODUCT TABLE ---
class Product(Base):
    __tablename__ = "products"
    __table_args__ = {"schema": "inventory"}

    product_id = Column(Integer, primary_key=True)
    pid = Column(String(50), unique=True)
    sku = Column(String(50), unique=True)
    name = Column(String(100), nullable=False)
    brand = Column(String(50))
    description = Column(Text)
    variant = Column(String(100))
    is_bundle = Column(Boolean, default=False)
    units_per_bundle = Column(Integer, default=1)

    # --- NEW: CUSTOMER PRICING ---
    tag_price = Column(Numeric(12, 2))
    price_discount = Column(Numeric(5, 4), default=0)
    # FetchedValue() tells Python: "Don't write to this, the database calculates it!"
    net_price = Column(Numeric(12, 2), FetchedValue())

    # --- NEW: SUPPLIER COSTING ---
    gross_cost = Column(Numeric(12, 2))
    cost_discount = Column(Numeric(5, 4), default=0)
    net_cost = Column(Numeric(12, 2), FetchedValue())

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    base_uom_id = Column(Integer, ForeignKey("inventory.uoms.uom_id"))

    # Relationships
    categories = relationship("ProductCategory", secondary="inventory.product_category_link")
    current_stock = relationship("CurrentStock", backref="product")
    vendors = relationship("ProductSupplier", back_populates="product", cascade="all, delete-orphan")
    price_history = relationship("PriceHistory", backref="product", order_by="desc(PriceHistory.changed_at)")
    cost_layers = relationship("CostLayer", backref="product", order_by="asc(CostLayer.received_at)") # NEW!
# --- 5. LEDGERS & HISTORY ---
class PriceHistory(Base):
    __tablename__ = "price_history"
    __table_args__ = {"schema": "inventory"}

    history_id = Column(BigInteger, primary_key=True)
    product_id = Column(Integer, ForeignKey("inventory.products.product_id", ondelete="CASCADE"))

    old_tag_price = Column(Numeric(12, 2))
    new_tag_price = Column(Numeric(12, 2))
    old_net_price = Column(Numeric(12, 2))
    new_net_price = Column(Numeric(12, 2))

    old_gross_cost = Column(Numeric(12, 2))
    new_gross_cost = Column(Numeric(12, 2))
    old_net_cost = Column(Numeric(12, 2))
    new_net_cost = Column(Numeric(12, 2))

    changed_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

class Location(Base):
    __tablename__ = "locations"
    __table_args__ = {"schema": "inventory"}

    location_id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    parent_location_id = Column(Integer, ForeignKey('inventory.locations.location_id'))
    type = Column(String(50))
    is_active = Column(Boolean, default=True)

class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"
    __table_args__ = {"schema": "inventory"}

    ledger_id = Column(BigInteger, primary_key=True)
    product_id = Column(Integer, ForeignKey('inventory.products.product_id'), nullable=False)
    location_id = Column(Integer, ForeignKey('inventory.locations.location_id'), nullable=False)
    qty_change = Column(Numeric(12, 2), nullable=False)
    reason = Column(SQLEnum(LedgerReason, name="ledger_reason", schema="inventory"), nullable=False)
    ref_table = Column(String(100))
    ref_pk = Column(String(100))
    occurred_at = Column(DateTime(timezone=True), server_default=func.now())

class CurrentStock(Base):
    __tablename__ = "current_stocks"
    __table_args__ = {"schema": "inventory"}

    stock_id = Column(BigInteger, primary_key=True)
    product_id = Column(Integer, ForeignKey('inventory.products.product_id'), nullable=False)
    location_id = Column(Integer, ForeignKey('inventory.locations.location_id'), nullable=False)
    quantity = Column(Numeric(12, 2), default=0)

    location = relationship("Location")


class ProductSupplier(Base):
    """The Multi-Sourcing Bridge Table"""
    __tablename__ = "product_suppliers"
    __table_args__ = {"schema": "inventory"}

    sourcing_id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey('inventory.products.product_id', ondelete="CASCADE"))
    supplier_id = Column(Integer, ForeignKey('inventory.suppliers.supplier_id', ondelete="CASCADE"))

    # ERP Specifics
    vendor_sku = Column(String(100))
    vendor_cost = Column(Numeric(12, 2))
    lead_time_days = Column(Integer)
    is_primary = Column(Boolean, default=False)

    # Allow us to pull the supplier's actual name through the bridge
    supplier = relationship("Supplier")
    product = relationship("Product", back_populates="vendors")


class CostLayer(Base):
    __tablename__ = "cost_layers"
    __table_args__ = {"schema": "inventory"}

    layer_id = Column(BigInteger, primary_key=True)
    product_id = Column(Integer, ForeignKey("inventory.products.product_id"), nullable=False)

    unit_cost = Column(Numeric(12, 2), nullable=False)
    original_qty = Column(Numeric(12, 2), nullable=False)
    remaining_qty = Column(Numeric(12, 2), nullable=False)

    received_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    ref_table = Column(String(100))
    ref_pk = Column(String(100))


# --- ADD THESE TO THE BOTTOM OF inventory/models.py ---


class StockTransfer(Base):
    __tablename__ = "stock_transfers"
    __table_args__ = {"schema": "inventory"}

    transfer_id = Column(Integer, primary_key=True)
    document_id = Column(String(100))
    transfer_date = Column(DateTime(timezone=True), server_default=text("NOW()"))

    from_location_id = Column(Integer, ForeignKey("inventory.locations.location_id"))
    to_location_id = Column(Integer, ForeignKey("inventory.locations.location_id"))

    released_by_id = Column(Integer, ForeignKey("auth.users.user_id"))
    received_by_id = Column(Integer, ForeignKey("auth.users.user_id"))

    bundle_count = Column(Integer, default=0)

    # NEW: The State Machine & Discrepancy Flag
    status = Column(String(50), default='REQUESTED')
    has_discrepancy = Column(Boolean, default=False)

    from_location = relationship("Location", foreign_keys=[from_location_id])
    to_location = relationship("Location", foreign_keys=[to_location_id])
    released_by = relationship(User, foreign_keys=[released_by_id])
    received_by = relationship(User, foreign_keys=[received_by_id])
    items = relationship("StockTransferItem", backref="transfer", cascade="all, delete-orphan")


class StockTransferItem(Base):
    __tablename__ = "stock_transfer_items"
    __table_args__ = {"schema": "inventory"}

    item_id = Column(Integer, primary_key=True)
    transfer_id = Column(Integer, ForeignKey("inventory.stock_transfers.transfer_id", ondelete="CASCADE"))
    product_id = Column(Integer, ForeignKey("inventory.products.product_id"))
    bundling = Column(String(100))

    # NEW: The Three Truths
    requested_qty = Column(Numeric(12, 2), nullable=False)
    released_qty = Column(Numeric(12, 2), nullable=True)
    received_qty = Column(Numeric(12, 2), nullable=True)

    product = relationship("Product")


