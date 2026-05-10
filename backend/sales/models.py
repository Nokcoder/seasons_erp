# backend/sales/models.py
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Date, Numeric, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base

# --- IMPORTS FOR RELATIONSHIPS ---
from inventory.models import Location, Product
from auth.models import User


# ==========================================
# 1. NEW: POS SETTINGS & CUSTOMERS
# ==========================================
class PosSettings(Base):
    __tablename__ = "pos_settings"
    __table_args__ = {'schema': 'sales'}

    setting_id = Column(Integer, primary_key=True)
    is_vat_enabled = Column(Boolean, default=False)
    vat_rate = Column(Numeric(5, 4), default=0.1200)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = {'schema': 'sales'}

    customer_id = Column(Integer, primary_key=True)
    company_name = Column(String(255))
    contact_person = Column(String(255))
    max_payment_term = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)


# ==========================================
# 2. UPGRADED: SALES HEADER
# ==========================================
class SalesHeader(Base):
    __tablename__ = "sales_headers"
    __table_args__ = {'schema': 'sales'}

    sales_id = Column(Integer, primary_key=True, index=True)
    document_id = Column(String, unique=True, index=True, nullable=False)

    # Original Base Info
    date = Column(Date, nullable=False)
    shift = Column(String, nullable=False)
    sales_invoice_id = Column(String, nullable=True)
    delivery_receipt_id = Column(String, nullable=True)
    register_id = Column(String, nullable=False)

    # NEW: Financial Breakdown
    subtotal_amount = Column(Numeric(12, 2), default=0.00)
    discount_amount = Column(Numeric(12, 2), default=0.00)
    tax_amount = Column(Numeric(12, 2), default=0.00)
    total_amount = Column(Numeric(12, 2), nullable=False)  # Your original Grand Total

    # UPGRADED: Customer Tracking
    customer_name = Column(String, nullable=True)  # Kept! Used for walk-in fallbacks
    customer_id = Column(Integer, ForeignKey("sales.customers.customer_id"), nullable=True)  # NEW

    # NEW: State Management
    status = Column(String(20), default='Posted')
    idempotency_key = Column(String(100), unique=True, nullable=True)

    # Original Foreign Keys
    location_id = Column(Integer, ForeignKey("inventory.locations.location_id"), nullable=False)
    cashier_id = Column(Integer, ForeignKey("auth.users.user_id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # --- RELATIONSHIPS ---
    items = relationship("SalesItem", back_populates="header", cascade="all, delete-orphan")
    payments = relationship("SalesPayment", back_populates="header", cascade="all, delete-orphan")

    # Kept your recent fixes!
    location = relationship(Location)
    cashier = relationship(User)
    customer = relationship(Customer)  # NEW


# ==========================================
# 3. UNCHANGED: SALES ITEMS & PAYMENTS
# ==========================================
class SalesItem(Base):
    __tablename__ = "sales_items"
    __table_args__ = {'schema': 'sales'}

    item_id = Column(Integer, primary_key=True, index=True)
    sales_id = Column(Integer, ForeignKey("sales.sales_headers.sales_id"), nullable=False)
    product_id = Column(Integer, ForeignKey("inventory.products.product_id"), nullable=False)

    qty = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    discount_pct = Column(Numeric(5, 2), default=0.00)
    discount_flat = Column(Numeric(10, 2), default=0.00)
    net_cost = Column(Numeric(10, 2), nullable=False)

    header = relationship("SalesHeader", back_populates="items")


class SalesPayment(Base):
    __tablename__ = "sales_payments"
    __table_args__ = {'schema': 'sales'}

    payment_id = Column(Integer, primary_key=True, index=True)
    sales_id = Column(Integer, ForeignKey("sales.sales_headers.sales_id"), nullable=False)

    method = Column(String, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)

    header = relationship("SalesHeader", back_populates="payments")


# ==========================================
# 4. NEW: SALES RETURNS
# ==========================================
class SalesReturn(Base):
    __tablename__ = "sales_returns"
    __table_args__ = {'schema': 'sales'}

    return_id = Column(Integer, primary_key=True)
    sale_id = Column(Integer, ForeignKey("sales.sales_headers.sales_id"))
    return_date = Column(DateTime, default=datetime.utcnow)
    reason = Column(String(255))
    grand_total = Column(Numeric(12, 2))


class SalesReturnItem(Base):
    __tablename__ = "sales_return_items"
    __table_args__ = {'schema': 'sales'}

    return_item_id = Column(Integer, primary_key=True)
    return_id = Column(Integer, ForeignKey("sales.sales_returns.return_id"))
    product_id = Column(Integer, ForeignKey("inventory.products.product_id"))
    quantity = Column(Integer, nullable=False)
    line_total = Column(Numeric(12, 2), nullable=False)


