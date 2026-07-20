# inventory/models.py
import enum
from sqlalchemy import (Column, Integer, BigInteger, String, Boolean, Numeric,
                         ForeignKey, Text, DateTime, Table, Index,
                         UniqueConstraint, Enum as SAEnum)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func, text
from core.database import Base

# NOTE: the tenant_id columns below use
#   server_default=text("current_setting('app.tenant_id', true)::integer")
# so an INSERT that omits tenant_id auto-fills it from the per-request GUC (set
# by get_db's after_begin listener, Phase 2 step 2). Admin/seed paths that set
# tenant_id explicitly override this; contextless inserts get NULL → rejected by
# the NOT NULL constraint (fail closed).
from auth.models import User, Employee


# ==========================================
# 1. ENUMS
# ==========================================
class LedgerReason(enum.Enum):
    RECEIVE      = "RECEIVE"
    SALE         = "SALE"
    RETURN_IN    = "RETURN_IN"
    RETURN_OUT   = "RETURN_OUT"
    TRANSFER_IN  = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    ADJUST       = "ADJUST"


# ==========================================
# 2. UNITS OF MEASURE
# ==========================================
class UOM(Base):
    __tablename__ = "uoms"
    __table_args__ = (
        UniqueConstraint("tenant_id", "uom_code", name="uq_uoms_tenant_code"),
        {"schema": "inventory"},
    )

    uom_id    = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    uom_code  = Column(String(50), nullable=False)
    uom_name  = Column(String(255))
    is_deleted = Column(Boolean, default=False)


# ==========================================
# 3. PRODUCT CATEGORIES
# ==========================================
class ProductCategory(Base):
    __tablename__ = "product_categories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "category_name", name="uq_categories_tenant_name"),
        {"schema": "inventory"},
    )

    category_id       = Column(Integer, primary_key=True)
    tenant_id         = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    category_name     = Column(String(255), nullable=False)
    parent_category_id = Column(Integer, ForeignKey("inventory.product_categories.category_id"))
    is_deleted        = Column(Boolean, default=False)


# Many-to-many bridge (product ↔ category)
product_category_links = Table(
    "product_category_links",
    Base.metadata,
    Column("tenant_id", Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
           server_default=text("current_setting('app.tenant_id', true)::integer")),
    Column("product_id",  Integer, ForeignKey("inventory.products.product_id",
           ondelete="CASCADE"), primary_key=True),
    Column("category_id", Integer, ForeignKey("inventory.product_categories.category_id",
           ondelete="CASCADE"), primary_key=True),
    schema="inventory",
)


# ==========================================
# 4. LOCATIONS
# ==========================================
class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "location_name", name="uq_locations_tenant_name"),
        {"schema": "inventory"},
    )

    location_id        = Column(Integer, primary_key=True)
    tenant_id          = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    location_name      = Column(String(255), nullable=False)
    location_type      = Column(
        SAEnum("Warehouse", "Store", "Bin", "Virtual",
               name="location_type", schema="inventory"),
        nullable=False,
    )
    parent_location_id = Column(Integer, ForeignKey("inventory.locations.location_id"))
    address            = Column(Text)
    status             = Column(
        SAEnum("Active", "Inactive", name="location_status", schema="inventory"),
        default="Active",
    )
    is_system          = Column(Boolean, default=False, nullable=False)
    is_deleted         = Column(Boolean, default=False)


# ==========================================
# 5. PRODUCTS  (the master shell — no PID here)
# ==========================================
class Product(Base):
    __tablename__ = "products"
    __table_args__ = {"schema": "inventory"}

    product_id   = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    brand        = Column(String(255), nullable=False)
    product_type = Column(
        SAEnum("Inventory", "Non-Inventory", "Service",
               name="product_type", schema="inventory"),
        nullable=False,
        default="Inventory",
    )
    description  = Column(Text)
    base_uom_id  = Column(Integer, ForeignKey("inventory.uoms.uom_id"))
    status       = Column(
        SAEnum("Active", "Inactive", name="product_status", schema="inventory"),
        default="Active",
    )
    is_deleted   = Column(Boolean, default=False)

    base_uom   = relationship("UOM")
    categories = relationship("ProductCategory",
                              secondary="inventory.product_category_links")
    variants   = relationship("Variant", back_populates="product",
                              cascade="all, delete-orphan")


# ==========================================
# 6. VARIANTS  (the atomic SKU — PID lives here)
# ==========================================
class Variant(Base):
    __tablename__ = "variants"
    __table_args__ = (
        UniqueConstraint("tenant_id", "PID", name="uq_variants_tenant_pid"),
        {"schema": "inventory"},
    )

    variant_id  = Column(Integer, primary_key=True, index=True)
    tenant_id   = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    product_id  = Column(Integer, ForeignKey("inventory.products.product_id",
                          ondelete="CASCADE"), nullable=False)
    PID         = Column(String(50), nullable=False)
    variant_name = Column(String(100), nullable=False, default="Default")
    sku         = Column(String(100), index=True, nullable=True)
    is_default  = Column(Boolean, default=False, nullable=False)
    attributes  = Column(JSONB, nullable=True)
    price       = Column(Numeric(15, 2), nullable=True)
    promo_price = Column(Numeric(15, 2), nullable=True)
    is_deleted          = Column(Boolean, default=False)
    include_in_ordering = Column(Boolean, nullable=False, default=True, server_default="TRUE")
    is_phased_out       = Column(Boolean, nullable=False, default=False, server_default="FALSE")

    product          = relationship("Product", back_populates="variants")
    current_stock    = relationship("CurrentStock", back_populates="variant")
    suppliers        = relationship("VariantSupplier", back_populates="variant")
    cost_layers      = relationship("CostLayer", back_populates="variant")
    barcodes         = relationship("VariantBarcode", back_populates="variant")
    uom_conversions  = relationship("VariantUomConversion", back_populates="variant")
    bundle_components = relationship(
        "BundleComponent",
        foreign_keys="[BundleComponent.bundle_variant_id]",
        back_populates="bundle_variant",
        cascade="all, delete-orphan",
    )


# ==========================================
# 7. VARIANT BARCODES
# ==========================================
class VariantBarcode(Base):
    __tablename__ = "variant_barcodes"
    __table_args__ = (
        UniqueConstraint("tenant_id", "barcode", name="uq_barcodes_tenant_barcode"),
        {"schema": "inventory"},
    )

    barcode_id = Column(BigInteger, primary_key=True)
    tenant_id  = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id = Column(Integer, ForeignKey("inventory.variants.variant_id",
                         ondelete="CASCADE"), nullable=False)
    barcode    = Column(String(100), nullable=False)
    uom_id     = Column(Integer, ForeignKey("inventory.uoms.uom_id"))
    is_primary = Column(Boolean, default=False)

    variant = relationship("Variant", back_populates="barcodes")
    uom     = relationship("UOM")


# ==========================================
# 8. VARIANT UOM CONVERSIONS
# ==========================================
class VariantUomConversion(Base):
    __tablename__ = "variant_uom_conversions"
    __table_args__ = {"schema": "inventory"}

    tenant_id            = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                   server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id           = Column(Integer, ForeignKey("inventory.variants.variant_id",
                                   ondelete="CASCADE"), primary_key=True)
    from_uom_id          = Column(Integer, ForeignKey("inventory.uoms.uom_id"), primary_key=True)
    to_uom_id            = Column(Integer, ForeignKey("inventory.uoms.uom_id"), primary_key=True)
    factor               = Column(Numeric(15, 4), nullable=False)
    is_warehouse_bundle  = Column(Boolean, default=False, nullable=False)
    price                = Column(Numeric(15, 2), nullable=True)
    promo_price          = Column(Numeric(15, 2), nullable=True)

    variant  = relationship("Variant", back_populates="uom_conversions")
    from_uom = relationship("UOM", foreign_keys=[from_uom_id])
    to_uom   = relationship("UOM", foreign_keys=[to_uom_id])


# ==========================================
# 9. BUNDLE COMPONENTS  (composite PK)
# ==========================================
class BundleComponent(Base):
    __tablename__ = "bundle_components"
    __table_args__ = {"schema": "inventory"}

    tenant_id            = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                   server_default=text("current_setting('app.tenant_id', true)::integer"))
    bundle_variant_id    = Column(Integer, ForeignKey("inventory.variants.variant_id",
                                   ondelete="CASCADE"), primary_key=True)
    component_variant_id = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                                  primary_key=True)
    quantity             = Column(Numeric(15, 4), nullable=False, default=1)

    bundle_variant    = relationship("Variant", foreign_keys=[bundle_variant_id],
                                     back_populates="bundle_components")
    component_variant = relationship("Variant", foreign_keys=[component_variant_id])


# ==========================================
# 10. SUPPLIERS
# ==========================================
class Supplier(Base):
    __tablename__ = "suppliers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "supplier_code", name="uq_suppliers_tenant_code"),
        {"schema": "inventory"},
    )

    supplier_id       = Column(Integer, primary_key=True)
    tenant_id         = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                            server_default=text("current_setting('app.tenant_id', true)::integer"))
    supplier_code     = Column(String(100), nullable=False)
    supplier_name     = Column(String(255), nullable=False)
    bank_account_name = Column(String(255))
    terms             = Column(Integer, default=0)   # payment terms in days
    is_deleted        = Column(Boolean, default=False)

    # Preserved fields (not in schema but kept per project requirement)
    contact_person = Column(String(255))
    phone          = Column(String(50))
    email          = Column(String(255))
    address        = Column(Text)
    contact_notes  = Column(Text)
    registered_at  = Column(DateTime(timezone=True), server_default=func.now())


# ==========================================
# 11. VARIANT SUPPLIERS
# ==========================================
class VariantSupplier(Base):
    __tablename__ = "variant_suppliers"
    __table_args__ = (
        UniqueConstraint("variant_id", "supplier_id", name="uq_variant_suppliers"),
        {"schema": "inventory"},
    )

    id                = Column(Integer, primary_key=True)
    tenant_id         = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id        = Column(Integer, ForeignKey("inventory.variants.variant_id",
                                ondelete="CASCADE"), nullable=False)
    supplier_id       = Column(Integer, ForeignKey("inventory.suppliers.supplier_id",
                                ondelete="CASCADE"), nullable=False)
    supplier_sku      = Column(String(100))
    gross_cost        = Column(Numeric(15, 2))
    supplier_discount = Column(Numeric(5, 2), default=0)
    is_primary        = Column(Boolean, default=False)

    variant  = relationship("Variant", back_populates="suppliers")
    supplier = relationship("Supplier")


# ==========================================
# 12. INVENTORY TRANSFERS  (no status — recorded after the fact)
# ==========================================
class InventoryTransfer(Base):
    __tablename__ = "inventory_transfers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "transfer_pid", name="uq_transfers_tenant_pid"),
        {"schema": "inventory"},
    )

    transfer_id                = Column(Integer, primary_key=True)
    tenant_id                  = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                        server_default=text("current_setting('app.tenant_id', true)::integer"))
    transfer_pid               = Column(String(100))
    from_location_id           = Column(Integer, ForeignKey("inventory.locations.location_id"))
    to_location_id             = Column(Integer, ForeignKey("inventory.locations.location_id"))
    released_by_user_id        = Column(Integer, ForeignKey("auth.users.user_id"))
    received_by_user_id        = Column(Integer, ForeignKey("auth.users.user_id"))
    requested_by_user_id       = Column(Integer, ForeignKey("auth.users.user_id"))
    released_by_employee_id    = Column(Integer, ForeignKey("auth.employees.employee_id"), nullable=True)
    received_by_employee_id    = Column(Integer, ForeignKey("auth.employees.employee_id"), nullable=True)
    total_bundle_count         = Column(Integer, default=0)
    occurred_at                = Column(DateTime(timezone=True), server_default=func.now())
    status                     = Column(String(20), default="Posted", nullable=False)
    voided_at                  = Column(DateTime(timezone=True), nullable=True)
    void_reason                = Column(String(500), nullable=True)

    from_location           = relationship("Location", foreign_keys=[from_location_id])
    to_location             = relationship("Location", foreign_keys=[to_location_id])
    released_by             = relationship("User", foreign_keys=[released_by_user_id])
    received_by             = relationship("User", foreign_keys=[received_by_user_id])
    requested_by            = relationship("User", foreign_keys=[requested_by_user_id])
    released_by_employee    = relationship("Employee", foreign_keys=[released_by_employee_id])
    received_by_employee    = relationship("Employee", foreign_keys=[received_by_employee_id])
    items                   = relationship("InventoryTransferItem", back_populates="transfer",
                                           cascade="all, delete-orphan")


# ==========================================
# 13. INVENTORY TRANSFER ITEMS
# ==========================================
class InventoryTransferItem(Base):
    __tablename__ = "inventory_transfer_items"
    __table_args__ = {"schema": "inventory"}

    transfer_item_id   = Column(Integer, primary_key=True)
    tenant_id          = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                 server_default=text("current_setting('app.tenant_id', true)::integer"))
    transfer_id        = Column(Integer, ForeignKey("inventory.inventory_transfers.transfer_id",
                                 ondelete="CASCADE"))
    variant_id         = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                                nullable=False)
    quantity_requested = Column(Numeric(15, 4), nullable=False)
    quantity_released  = Column(Numeric(15, 4), nullable=True)
    quantity_received  = Column(Numeric(15, 4), nullable=True)

    transfer = relationship("InventoryTransfer", back_populates="items")
    variant  = relationship("Variant", lazy="select")


# ==========================================
# 14. INVENTORY LEDGER  (immutable event log)
# ==========================================
class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"
    __table_args__ = (
        Index("ix_ledger_tenant_variant",  "tenant_id", "variant_id"),
        Index("ix_ledger_tenant_occurred", "tenant_id", "occurred_at"),
        {"schema": "inventory"},
    )

    ledger_id      = Column(BigInteger, primary_key=True)
    tenant_id      = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                             server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id     = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                             nullable=False)
    location_id    = Column(Integer, ForeignKey("inventory.locations.location_id"),
                             nullable=False)
    qty_change     = Column(Numeric(15, 4), nullable=False)
    reason         = Column(SAEnum(LedgerReason, name="ledger_reason", schema="inventory"),
                             nullable=False)
    reference_type = Column(String(100))
    reference_id   = Column(String(100))
    occurred_at    = Column(DateTime(timezone=True), server_default=func.now())

    variant  = relationship("Variant",  foreign_keys=[variant_id],  lazy="joined")
    location = relationship("Location", foreign_keys=[location_id], lazy="joined")


# ==========================================
# 15. CURRENT STOCKS  (materialized running total)
# ==========================================
class CurrentStock(Base):
    __tablename__ = "current_stocks"
    __table_args__ = (
        UniqueConstraint("variant_id", "location_id",
                         name="uq_current_stocks_variant_location"),
        {"schema": "inventory"},
    )

    stock_id     = Column(BigInteger, primary_key=True)
    tenant_id    = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                          server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id   = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                          nullable=False)
    location_id  = Column(Integer, ForeignKey("inventory.locations.location_id"),
                          nullable=False)
    quantity     = Column(Numeric(15, 4), default=0)
    last_updated = Column(DateTime(timezone=True), server_default=func.now(),
                          onupdate=func.now())

    variant  = relationship("Variant", back_populates="current_stock")
    location = relationship("Location")


# ==========================================
# 16. COST LAYERS  (FIFO buckets, per variant per location)
# ==========================================
class CostLayer(Base):
    __tablename__ = "cost_layers"
    __table_args__ = (
        Index("ix_cost_layers_tenant_variant", "tenant_id", "variant_id"),
        {"schema": "inventory"},
    )

    layer_id          = Column(BigInteger, primary_key=True)
    tenant_id         = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id        = Column(Integer, ForeignKey("inventory.variants.variant_id",
                                ondelete="CASCADE"), nullable=False)
    # FK to procurement schema — resolved at runtime after all models are imported
    shipment_id       = Column(Integer,
                               ForeignKey("procurement.inventory_shipments.shipment_id"),
                               nullable=True)
    location_id       = Column(Integer, ForeignKey("inventory.locations.location_id"),
                                nullable=False)
    original_quantity = Column(Numeric(15, 4), nullable=False)
    quantity_remaining = Column(Numeric(15, 4), nullable=False)
    gross_cost        = Column(Numeric(15, 2), nullable=False)
    supplier_discount = Column(Numeric(5, 2), default=0)
    net_unit_cost     = Column(Numeric(15, 2), nullable=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    variant  = relationship("Variant", back_populates="cost_layers")
    location = relationship("Location")
    # InventoryShipment relationship resolved by string — requires procurement
    # models to be imported before any query is made (handled in main.py)
    shipment = relationship("InventoryShipment")


# ==========================================
# 17. VARIANT PRICE HISTORY  (immutable)
# ==========================================
class VariantPriceHistory(Base):
    __tablename__ = "variant_price_history"
    __table_args__ = {"schema": "inventory"}

    history_id         = Column(BigInteger, primary_key=True)
    tenant_id          = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id         = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                                nullable=False)
    old_price          = Column(Numeric(15, 2), nullable=True)
    new_price          = Column(Numeric(15, 2), nullable=True)
    old_promo_price    = Column(Numeric(15, 2), nullable=True)
    new_promo_price    = Column(Numeric(15, 2), nullable=True)
    changed_by_user_id = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    changed_at         = Column(DateTime(timezone=True), server_default=func.now(),
                                nullable=False)

    variant    = relationship("Variant")
    changed_by = relationship("User")


# ==========================================
# 18. VARIANT COST HISTORY  (immutable)
# ==========================================
class VariantCostHistory(Base):
    __tablename__ = "variant_cost_history"
    __table_args__ = {"schema": "inventory"}

    history_id             = Column(BigInteger, primary_key=True)
    tenant_id              = Column(Integer, ForeignKey("platform.tenants.tenant_id"), nullable=False,
                                    server_default=text("current_setting('app.tenant_id', true)::integer"))
    variant_id             = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                                    nullable=False)
    supplier_id            = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"),
                                    nullable=False)
    old_gross_cost         = Column(Numeric(15, 2), nullable=True)
    new_gross_cost         = Column(Numeric(15, 2), nullable=True)
    old_supplier_discount  = Column(Numeric(5, 2), nullable=True)
    new_supplier_discount  = Column(Numeric(5, 2), nullable=True)
    changed_by_user_id     = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    changed_at             = Column(DateTime(timezone=True), server_default=func.now(),
                                    nullable=False)

    variant    = relationship("Variant")
    supplier   = relationship("Supplier")
    changed_by = relationship("User")
