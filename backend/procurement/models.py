# procurement/models.py
from sqlalchemy import (Column, Integer, String, Numeric, DateTime, Date,
                         Boolean, ForeignKey, Enum as SAEnum)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


# ==========================================
# 1. PURCHASE ORDERS
# ==========================================
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = {"schema": "procurement"}

    po_id                = Column(Integer, primary_key=True)
    po_pid               = Column(String(100), unique=True, nullable=False)
    supplier_id          = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))
    location_id          = Column(Integer, ForeignKey("inventory.locations.location_id"))
    order_date           = Column(DateTime(timezone=True), server_default=func.now())
    expected_arrival_date = Column(Date)
    status               = Column(
        SAEnum("Draft", "Open", "Partially_Received", "Closed", "Cancelled",
               name="po_status", schema="procurement"),
        default="Draft",
    )
    total_amount         = Column(Numeric(15, 2), default=0)
    created_by_user_id   = Column(Integer, ForeignKey("auth.users.user_id"))
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), server_default=func.now(),
                                  onupdate=func.now())

    items      = relationship("PurchaseOrderItem", back_populates="purchase_order",
                              cascade="all, delete-orphan")
    supplier   = relationship("Supplier")
    location   = relationship("Location")
    created_by = relationship("User")


# ==========================================
# 2. PURCHASE ORDER ITEMS
# ==========================================
class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    __table_args__ = {"schema": "procurement"}

    po_item_id         = Column(Integer, primary_key=True)
    po_id              = Column(Integer, ForeignKey("procurement.purchase_orders.po_id",
                                 ondelete="CASCADE"))
    variant_id         = Column(Integer, ForeignKey("inventory.variants.variant_id"))
    ordered_quantity   = Column(Numeric(15, 4), nullable=False)
    received_quantity  = Column(Numeric(15, 4), default=0)
    unit_cost          = Column(Numeric(15, 2), nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    variant        = relationship("Variant")


# ==========================================
# 3. INVENTORY SHIPMENTS
# ==========================================
class InventoryShipment(Base):
    __tablename__ = "inventory_shipments"
    __table_args__ = {"schema": "procurement"}

    shipment_id              = Column(Integer, primary_key=True)
    shipment_pid             = Column(String(100), unique=True)
    supplier_id              = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))
    po_id                    = Column(Integer, ForeignKey("procurement.purchase_orders.po_id"),
                                      nullable=True)
    reference_number         = Column(String(100))
    received_at              = Column(DateTime(timezone=True))
    received_by_user_id      = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    inspected_by_user_id     = Column(Integer, ForeignKey("auth.users.user_id"), nullable=True)
    received_by_employee_id  = Column(Integer, ForeignKey("auth.employees.employee_id"), nullable=True)
    inspected_by_employee_id = Column(Integer, ForeignKey("auth.employees.employee_id"), nullable=True)
    is_confirmed             = Column(Boolean, default=False, nullable=False)

    supplier             = relationship("Supplier")
    purchase_order       = relationship("PurchaseOrder")
    receiving_details    = relationship("ReceivingDetail", back_populates="shipment",
                                        cascade="all, delete-orphan")
    received_by_employee  = relationship("Employee", foreign_keys=[received_by_employee_id])
    inspected_by_employee = relationship("Employee", foreign_keys=[inspected_by_employee_id])


# ==========================================
# 4. RECEIVING DETAILS
# ==========================================
class ReceivingDetail(Base):
    __tablename__ = "receiving_details"
    __table_args__ = {"schema": "procurement"}

    detail_id          = Column(Integer, primary_key=True)
    shipment_id        = Column(Integer, ForeignKey("procurement.inventory_shipments.shipment_id",
                                 ondelete="CASCADE"))
    variant_id         = Column(Integer, ForeignKey("inventory.variants.variant_id"))
    location_id        = Column(Integer, ForeignKey("inventory.locations.location_id"))
    po_item_id         = Column(Integer, ForeignKey("procurement.purchase_order_items.po_item_id"),
                                nullable=True)
    received_at        = Column(DateTime(timezone=True))
    inspected_at       = Column(DateTime(timezone=True))
    quantity_ordered   = Column(Numeric(15, 4), default=0)
    quantity_declared  = Column(Numeric(15, 4), default=0)
    quantity_actual    = Column(Numeric(15, 4), nullable=False)
    quantity_rejected  = Column(Numeric(15, 4), default=0)
    qc_status          = Column(
        SAEnum("Pending", "Passed", "Failed", "Partially_Passed",
               name="qc_status", schema="procurement"),
        default="Pending",
    )
    is_deleted         = Column(Boolean, default=False)

    shipment  = relationship("InventoryShipment", back_populates="receiving_details")
    variant   = relationship("Variant")
    location  = relationship("Location")
    po_item   = relationship("PurchaseOrderItem")
