# sales/models.py
from sqlalchemy import (Column, Integer, BigInteger, String, Boolean, Numeric,
                         Date, DateTime, ForeignKey, UniqueConstraint,
                         Enum as SAEnum)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text
from core.database import Base


# ==========================================
# 1. PAYMENT MODES
# ==========================================
class PaymentMode(Base):
    __tablename__ = "payment_modes"
    __table_args__ = {"schema": "sales"}

    payment_mode_id = Column(Integer, primary_key=True)
    name            = Column(String(100), nullable=False)
    is_physical     = Column(Boolean, default=True, nullable=False)
    is_active       = Column(Boolean, default=True, nullable=False)
    is_ar_charge    = Column(Boolean, default=False, nullable=False)
    is_ar_credit    = Column(Boolean, default=False, nullable=False)


# ==========================================
# 2. CASH REGISTERS
# ==========================================
class CashRegister(Base):
    __tablename__ = "cash_registers"
    __table_args__ = {"schema": "sales"}

    register_id = Column(Integer, primary_key=True)
    name        = Column(String(100), nullable=False)
    location_id = Column(Integer, ForeignKey("inventory.locations.location_id"),
                         nullable=False)
    is_active   = Column(Boolean, default=True, nullable=False)

    location = relationship("Location")


# ==========================================
# 3. CUSTOMERS
# ==========================================
class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = {"schema": "sales"}

    customer_id         = Column(Integer, primary_key=True)
    customer_name       = Column(String(255), nullable=False)
    credit_limit        = Column(Numeric(15, 2), nullable=True)
    terms_days          = Column(Integer, default=0, nullable=False)
    outstanding_balance = Column(Numeric(15, 2), default=0, nullable=False)
    is_deleted          = Column(Boolean, default=False, nullable=False)


# ==========================================
# 4. AR LEDGER  (immutable — never updated or deleted)
# ==========================================
class ArLedger(Base):
    __tablename__ = "ar_ledger"
    __table_args__ = {"schema": "sales"}

    ar_ledger_id   = Column(BigInteger, primary_key=True)
    customer_id    = Column(Integer, ForeignKey("sales.customers.customer_id"),
                            nullable=True)
    amount_change  = Column(Numeric(15, 2), nullable=False)
    reason         = Column(
        SAEnum("SALE", "PAYMENT", "RETURN", "ADJUSTMENT", "AR_CHARGE", "AR_CREDIT",
               name="ar_reason", schema="sales"),
        nullable=False,
    )
    reference_type = Column(String(100))
    reference_id   = Column(String(100))
    notes          = Column(String(500), nullable=True)
    occurred_at    = Column(DateTime(timezone=True), server_default=func.now())

    customer = relationship("Customer")


# ==========================================
# 5. SHIFTS  (reference lookup for sales tagging)
# ==========================================
class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = {"schema": "sales"}

    shift_id   = Column(Integer, primary_key=True)
    shift_name = Column(String(100), nullable=False)
    is_active  = Column(Boolean, default=True, nullable=False)


# ==========================================
# 6. SALES  (header)
# ==========================================
class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = {"schema": "sales"}

    sale_id            = Column(Integer, primary_key=True)
    # NULL until the draft is posted; unique constraint still enforced on non-null values
    sale_pid           = Column(String(100), unique=True, nullable=True)
    # User-controlled, backdatable date the transaction actually occurred.
    # Set when the draft is created (defaults to today) and editable until posting.
    # This is the canonical date for AR aging, AR ledger filters, and sales filters.
    # Server-side default computes "today" in Manila local time (UTC+8) — the
    # container/DB run in UTC, and a naive CURRENT_DATE would misclassify the
    # ~00:00-08:00 PHT window as "yesterday". Application code always sets
    # this explicitly on creation; the default is a safety net only.
    transaction_date   = Column(Date, nullable=False,
                                server_default=text("(now() AT TIME ZONE 'Asia/Manila')::date"))
    # Stamped to now() at the moment the draft is posted; NULL for drafts/voided-drafts.
    posted_at          = Column(DateTime(timezone=True), nullable=True)
    location_id        = Column(Integer, ForeignKey("inventory.locations.location_id"),
                                nullable=False)
    register_id        = Column(Integer, ForeignKey("sales.cash_registers.register_id"),
                                nullable=True)
    customer_id        = Column(Integer, ForeignKey("sales.customers.customer_id"),
                                nullable=True)
    employee_id        = Column(Integer, ForeignKey("auth.employees.employee_id"),
                                nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("auth.users.user_id"),
                                nullable=True)
    shift_id           = Column(Integer, ForeignKey("sales.shifts.shift_id"),
                                nullable=True)
    origin_sale_id     = Column(Integer, ForeignKey("sales.sales.sale_id"),
                                nullable=True)

    subtotal_amount       = Column(Numeric(15, 2), default=0)
    merchandise_subtotal  = Column(Numeric(15, 2), nullable=False, server_default='0')
    cart_discount_pct     = Column(Numeric(5, 2), nullable=True)
    cart_discount_flat  = Column(Numeric(15, 2), nullable=True)
    discount_amount     = Column(Numeric(15, 2), default=0)
    tax_amount          = Column(Numeric(15, 2), default=0)
    grand_total         = Column(Numeric(15, 2), default=0)
    receipt_grand_total = Column(Numeric(15, 2), nullable=True)
    audit_variance      = Column(Numeric(15, 2), nullable=True)

    due_date       = Column(Date, nullable=True)
    payment_status = Column(
        SAEnum("Unpaid", "Partial", "Paid", name="sale_payment_status", schema="sales"),
        default="Unpaid",
    )
    balance_due = Column(Numeric(15, 2), default=0)

    status = Column(
        SAEnum("Draft", "Posted", "Voided", name="sale_status", schema="sales"),
        default="Draft",
    )
    voided_at       = Column(DateTime(timezone=True), nullable=True)
    void_reason     = Column(String(500), nullable=True)
    idempotency_key = Column(String(255), unique=True, nullable=True)

    location   = relationship("Location")
    register   = relationship("CashRegister")
    customer   = relationship("Customer")
    employee   = relationship("Employee")
    shift      = relationship("Shift")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    items      = relationship("SaleItem", back_populates="sale",
                              cascade="all, delete-orphan")
    payments_applied = relationship("CustomerPaymentApplied", back_populates="sale")


# ==========================================
# 7. SALE ITEMS  (one row per FIFO cost layer consumed)
# ==========================================
class SaleItem(Base):
    __tablename__ = "sale_items"
    __table_args__ = (
        UniqueConstraint("sale_id", "variant_id", "cost_layer_id",
                         name="uq_sale_items_sale_variant_layer"),
        {"schema": "sales"},
    )

    sale_item_id      = Column(Integer, primary_key=True)
    sale_id           = Column(Integer, ForeignKey("sales.sales.sale_id",
                                ondelete="CASCADE"), nullable=False)
    variant_id        = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                               nullable=False)
    cost_layer_id     = Column(BigInteger, ForeignKey("inventory.cost_layers.layer_id"),
                               nullable=True)

    quantity       = Column(Numeric(15, 4), nullable=False)
    unit_price     = Column(Numeric(15, 2), nullable=False)
    discount_pct   = Column(Numeric(5, 2), nullable=True)
    discount_flat  = Column(Numeric(15, 2), nullable=True)
    line_total     = Column(Numeric(15, 2), nullable=False)

    # Cost snapshot — locked at time of sale; never updated after posting
    gross_cost        = Column(Numeric(15, 2), nullable=True)
    supplier_discount = Column(Numeric(5, 2), nullable=True)
    net_unit_cost     = Column(Numeric(15, 2), nullable=True)
    cost_source       = Column(String(20), nullable=True)  # 'fifo' | 'supplier_list' | 'none'

    sale       = relationship("Sale", back_populates="items")
    variant    = relationship("Variant")
    cost_layer = relationship("CostLayer")


# ==========================================
# 8. CUSTOMER PAYMENTS
# ==========================================
class CustomerPayment(Base):
    __tablename__ = "customer_payments"
    __table_args__ = {"schema": "sales"}

    payment_id       = Column(Integer, primary_key=True)
    customer_id      = Column(Integer, ForeignKey("sales.customers.customer_id"),
                              nullable=True)
    payment_mode_id  = Column(Integer, ForeignKey("sales.payment_modes.payment_mode_id"),
                              nullable=False)
    amount           = Column(Numeric(15, 2), nullable=False)
    payment_date     = Column(DateTime(timezone=True), server_default=func.now())
    reference_number = Column(String(100), nullable=True)
    notes            = Column(String(500), nullable=True)
    unapplied_amount = Column(Numeric(15, 2), default=0, nullable=False)

    customer     = relationship("Customer")
    payment_mode = relationship("PaymentMode")
    applications = relationship("CustomerPaymentApplied", back_populates="payment")


# ==========================================
# 9. CUSTOMER PAYMENT APPLIED  (bridge — payment ↔ sale)
# ==========================================
class CustomerPaymentApplied(Base):
    __tablename__ = "customer_payment_applied"
    __table_args__ = {"schema": "sales"}

    apply_id       = Column(Integer, primary_key=True)
    payment_id     = Column(Integer, ForeignKey("sales.customer_payments.payment_id"),
                            nullable=False)
    sale_id        = Column(Integer, ForeignKey("sales.sales.sale_id"),
                            nullable=False)
    amount_applied = Column(Numeric(15, 2), nullable=False)
    applied_at     = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("CustomerPayment", back_populates="applications")
    sale    = relationship("Sale", back_populates="payments_applied")


# ==========================================
# 10. SALES RETURNS
# ==========================================
class SalesReturn(Base):
    __tablename__ = "sales_returns"
    __table_args__ = {"schema": "sales"}

    return_id          = Column(Integer, primary_key=True)
    # Generated at creation time; nullable at model level to avoid constraint
    # violations during construction before the PID is computed
    return_pid         = Column(String(100), unique=True, nullable=True)
    sale_id            = Column(Integer, ForeignKey("sales.sales.sale_id"),
                                nullable=True)
    location_id        = Column(Integer, ForeignKey("inventory.locations.location_id"),
                                nullable=False)
    return_date        = Column(Date, nullable=False)
    reason             = Column(String(500), nullable=True)
    grand_total        = Column(Numeric(15, 2), default=0)
    disposition        = Column(String(20), nullable=True)
    customer_id        = Column(Integer, ForeignKey("sales.customers.customer_id"),
                                nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("auth.users.user_id"),
                                nullable=True)

    sale       = relationship("Sale")
    location   = relationship("Location")
    customer   = relationship("Customer", foreign_keys=[customer_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    items      = relationship("SalesReturnItem", back_populates="sales_return",
                              cascade="all, delete-orphan")


# ==========================================
# 11. SALES RETURN ITEMS
# ==========================================
class SalesReturnItem(Base):
    __tablename__ = "sales_return_items"
    __table_args__ = {"schema": "sales"}

    return_item_id = Column(Integer, primary_key=True)
    return_id      = Column(Integer, ForeignKey("sales.sales_returns.return_id",
                             ondelete="CASCADE"), nullable=False)
    # Nullable for blind returns (no original sale_item to reference)
    sale_item_id   = Column(Integer, ForeignKey("sales.sale_items.sale_item_id"),
                            nullable=True)
    variant_id     = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                            nullable=False)
    cost_layer_id  = Column(BigInteger, ForeignKey("inventory.cost_layers.layer_id"),
                            nullable=True)
    quantity       = Column(Numeric(15, 4), nullable=False)
    line_total     = Column(Numeric(15, 2), nullable=False)

    sales_return = relationship("SalesReturn", back_populates="items")
    sale_item    = relationship("SaleItem")
    variant      = relationship("Variant")
    cost_layer   = relationship("CostLayer")


# ==========================================
# 12. SUPPLIER RETURNS
# ==========================================
class SupplierReturn(Base):
    __tablename__ = "supplier_returns"
    __table_args__ = {"schema": "sales"}

    return_id           = Column(Integer, primary_key=True)
    return_pid          = Column(String(100), unique=True, nullable=True)
    supplier_id         = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"),
                                 nullable=False)
    # Source location — typically the virtual Quarantine location
    location_id         = Column(Integer, ForeignKey("inventory.locations.location_id"),
                                 nullable=False)
    status              = Column(
        SAEnum("Draft", "Shipped", "Credit_Received",
               name="supplier_return_status", schema="sales"),
        default="Draft",
    )
    total_credit_amount = Column(Numeric(15, 2), default=0)
    created_by_user_id  = Column(Integer, ForeignKey("auth.users.user_id"),
                                 nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    supplier   = relationship("Supplier")
    location   = relationship("Location")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    items      = relationship("SupplierReturnItem", back_populates="supplier_return",
                              cascade="all, delete-orphan")


# ==========================================
# 13. SUPPLIER RETURN ITEMS
# ==========================================
class SupplierReturnItem(Base):
    __tablename__ = "supplier_return_items"
    __table_args__ = {"schema": "sales"}

    return_item_id       = Column(Integer, primary_key=True)
    return_id            = Column(Integer, ForeignKey("sales.supplier_returns.return_id",
                                   ondelete="CASCADE"), nullable=False)
    variant_id           = Column(Integer, ForeignKey("inventory.variants.variant_id"),
                                  nullable=False)
    cost_layer_id        = Column(BigInteger, ForeignKey("inventory.cost_layers.layer_id"),
                                  nullable=True)
    quantity             = Column(Numeric(15, 4), nullable=False)
    unit_credit_expected = Column(Numeric(15, 2), nullable=True)

    supplier_return = relationship("SupplierReturn", back_populates="items")
    variant         = relationship("Variant")
    cost_layer      = relationship("CostLayer")
