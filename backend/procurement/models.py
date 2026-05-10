# procurement/models.py
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Boolean, text, Numeric
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class PurchaseOrder(Base):
    __tablename__ = 'purchase_orders'
    __table_args__ = {"schema": "procurement"}

    po_id = Column(Integer, primary_key=True)
    document_id = Column(String(100), unique=True)
    supplier_id = Column(Integer, ForeignKey('inventory.suppliers.supplier_id'))

    date_drafted = Column(DateTime(timezone=True), server_default=text("NOW()"))

    # --- ADD THIS NEW LINE ---
    target_delivery_date = Column(DateTime(timezone=True))

    payment_terms = Column(String(100))
    total_value = Column(Numeric(12, 2), default=0)
    status = Column(String(50), default='DRAFT')

    # Relationships
    items = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")
    supplier = relationship("Supplier", primaryjoin="PurchaseOrder.supplier_id == Supplier.supplier_id")


class PurchaseOrderItem(Base):
    __tablename__ = 'purchase_order_items'
    __table_args__ = {"schema": "procurement"}

    po_item_id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey('procurement.purchase_orders.po_id', ondelete="CASCADE"))
    product_id = Column(Integer, ForeignKey('inventory.products.product_id'))

    requested_qty = Column(Numeric(12, 2), nullable=False)
    unit_gross_cost = Column(Numeric(12, 2))
    discount = Column(Numeric(5, 4), default=0)
    net_cost = Column(Numeric(12, 2))

    # Relationships
    purchase_order = relationship("PurchaseOrder", back_populates="items")
    product = relationship("Product", primaryjoin="PurchaseOrderItem.product_id == Product.product_id")


class InboundShipment(Base):
    __tablename__ = "inbound_shipments"
    __table_args__ = {"schema": "procurement"}

    shipment_id = Column(Integer, primary_key=True)
    logistics_name = Column(String(255))
    logistics_doc_id = Column(String(100))
    van_number = Column(String(100))

    date_loaded = Column(DateTime(timezone=True))
    date_sealed = Column(DateTime(timezone=True))
    date_arrived = Column(DateTime(timezone=True))

    collected_by_id = Column(Integer, ForeignKey("auth.users.user_id"))
    status = Column(String(50), default='IN_TRANSIT')

    collected_by = relationship("User", primaryjoin="InboundShipment.collected_by_id == User.user_id")
    goods_receipts = relationship("GoodsReceipt", backref="shipment")
    # Add this inside your InboundShipment class:


class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"
    __table_args__ = {"schema": "procurement"}

    grn_id = Column(Integer, primary_key=True)
    # shipment_id is optional for local receiving
    shipment_id = Column(Integer, ForeignKey("procurement.inbound_shipments.shipment_id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))

    rcv_document_id = Column(String(100))  # "Stock Receiving Form #"
    van_number = Column(String(100), nullable=True)
    bundle_count = Column(Integer, default=0)

    date_collected = Column(DateTime(timezone=True))  # "Date Checked"
    location_id = Column(Integer, ForeignKey("inventory.locations.location_id"), nullable=True)
    checked_by_id = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)

    status = Column(String(50), default='DRAFT')  # Changed default to DRAFT
    has_discrepancy = Column(Boolean, default=False)

    supplier = relationship("Supplier", primaryjoin="GoodsReceipt.supplier_id == Supplier.supplier_id")
    checked_by = relationship("User", primaryjoin="GoodsReceipt.checked_by_id == User.user_id")
    items = relationship("GoodsReceiptItem", backref="receipt", cascade="all, delete-orphan")

# ... your other columns above ...
    status = Column(String(50), default='DRAFT')
    has_discrepancy = Column(Boolean, default=False)

    # --- MAKE SURE THESE 4 RELATIONSHIP LINES EXIST ---
    supplier = relationship("Supplier", primaryjoin="GoodsReceipt.supplier_id == Supplier.supplier_id")
    checked_by = relationship("User", primaryjoin="GoodsReceipt.checked_by_id == User.user_id")
    location = relationship("Location", primaryjoin="GoodsReceipt.location_id == Location.location_id") # <-- THIS FIXES THE UNKNOWN LOCATION!
    items = relationship("GoodsReceiptItem", backref="receipt", cascade="all, delete-orphan")

class GoodsReceiptItem(Base):
    __tablename__ = "goods_receipt_items"
    __table_args__ = {"schema": "procurement"}

    grn_item_id = Column(Integer, primary_key=True)
    grn_id = Column(Integer, ForeignKey("procurement.goods_receipts.grn_id", ondelete="CASCADE"))
    product_id = Column(Integer, ForeignKey("inventory.products.product_id"))

    bundling = Column(String(100))
    expected_qty = Column(Numeric(12, 2), default=0)
    received_qty = Column(Numeric(12, 2), nullable=False)

    unit_gross_cost = Column(Numeric(12, 2))
    discount = Column(Numeric(5, 4), default=0)
    net_cost = Column(Numeric(12, 2))

    product = relationship("Product", primaryjoin="GoodsReceiptItem.product_id == Product.product_id")