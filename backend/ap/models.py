# ap/models.py
from sqlalchemy import (Column, Integer, BigInteger, String, Text, Numeric,
                         DateTime, Date, ForeignKey, Enum as SAEnum)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


# ==========================================
# 1. SUPPLIER INVOICES
# ==========================================
class SupplierInvoice(Base):
    __tablename__ = "supplier_invoices"
    __table_args__ = {"schema": "ap"}

    invoice_id     = Column(Integer, primary_key=True)
    supplier_id    = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))
    shipment_id    = Column(Integer, ForeignKey("procurement.inventory_shipments.shipment_id"))
    invoice_number = Column(String(100))
    invoice_date   = Column(Date)
    due_date       = Column(Date)   # Derived: invoice_date + suppliers.terms days
    total_amount      = Column(Numeric(15, 2))
    amended_amount    = Column(Numeric(15, 2))
    amendment_notes   = Column(Text)
    status         = Column(
        SAEnum("Unpaid", "Partial", "Paid", name="invoice_status", schema="ap"),
        default="Unpaid",
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    supplier         = relationship("Supplier")
    shipment         = relationship("InventoryShipment")
    invoice_payments = relationship("InvoicePayment", back_populates="invoice")


# ==========================================
# 2. SUPPLIER PAYMENTS
# ==========================================
class SupplierPayment(Base):
    __tablename__ = "supplier_payments"
    __table_args__ = {"schema": "ap"}

    payment_id       = Column(Integer, primary_key=True)
    supplier_id      = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))
    amount           = Column(Numeric(15, 2), nullable=False)
    payment_date     = Column(DateTime(timezone=True))
    reference_number = Column(String(100))
    payment_method   = Column(String(100))

    supplier         = relationship("Supplier")
    invoice_payments = relationship("InvoicePayment", back_populates="payment")


# ==========================================
# 3. INVOICE PAYMENTS  (bridge — composite PK)
# ==========================================
class InvoicePayment(Base):
    __tablename__ = "invoice_payments"
    __table_args__ = {"schema": "ap"}

    invoice_id     = Column(Integer, ForeignKey("ap.supplier_invoices.invoice_id"),
                             primary_key=True)
    payment_id     = Column(Integer, ForeignKey("ap.supplier_payments.payment_id"),
                             primary_key=True)
    amount_applied = Column(Numeric(15, 2), nullable=False)

    invoice = relationship("SupplierInvoice", back_populates="invoice_payments")
    payment = relationship("SupplierPayment", back_populates="invoice_payments")


# ==========================================
# 4. AP LEDGER  (immutable — mirrors inventory_ledger pattern)
# ==========================================
class ApLedger(Base):
    __tablename__ = "ap_ledger"
    __table_args__ = {"schema": "ap"}

    ap_ledger_id   = Column(BigInteger, primary_key=True)
    supplier_id    = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))
    amount_change  = Column(Numeric(15, 2), nullable=False)
    reason         = Column(
        SAEnum("INVOICE", "PAYMENT", "CREDIT_MEMO", "ADJUSTMENT",
               name="ap_reason", schema="ap"),
        nullable=False,
    )
    reference_type = Column(String(100))
    reference_id   = Column(String(100))
    occurred_at    = Column(DateTime(timezone=True), server_default=func.now())

    supplier = relationship("Supplier")
