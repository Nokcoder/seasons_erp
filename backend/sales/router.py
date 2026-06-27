# sales/router.py
from __future__ import annotations
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import random
import re
import string
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql import func

from core.audit import write_audit, _serialize
from core.database import get_db
from auth.dependencies import get_current_user, require_permission, has_action
from auth.models import User as AuthUser
from sales import models, schemas
from inventory import models as inv_models
from inventory.models import Location
from settings.models import SystemSetting


def _normalize_search(q: str) -> str:
    return re.sub(r'[-_\s]', '', q).lower()


def normalize_search(q: str) -> str:
    return re.sub(r'[-_\s]', '', q).lower()


def _get_allow_negative_stock(db: Session) -> bool:
    row = db.query(SystemSetting).filter_by(key="allow_negative_stock").first()
    return row.value == "true" if row else False


def _generate_memo_code(db: Session, max_attempts: int = 5) -> str:
    chars = string.ascii_uppercase + string.digits
    for _ in range(max_attempts):
        suffix = ''.join(random.choices(chars, k=6))
        code = f"CM-{suffix}"
        if not db.query(models.CreditMemo).filter_by(code=code).first():
            return code
    raise HTTPException(status_code=500, detail="Could not generate unique memo code")

router = APIRouter(
    prefix="/sales",
    tags=["Sales"],
    dependencies=[Depends(get_current_user)],
)


# ═══════════════════════════════════════════════════════════════════════════════
# SHIFTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/shifts", response_model=List[schemas.ShiftOut])
def list_shifts(db: Session = Depends(get_db)):
    """List all shifts (active and inactive)."""
    return (
        db.query(models.Shift)
        .order_by(models.Shift.shift_id)
        .all()
    )


@router.post("/shifts", response_model=schemas.ShiftOut, status_code=201)
def create_shift(
    payload: schemas.ShiftCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_sales_settings")),
):
    shift = models.Shift(
        shift_name=payload.shift_name,
        is_active=payload.is_active,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


@router.patch("/shifts/{shift_id}", response_model=schemas.ShiftOut)
def update_shift(
    shift_id: int,
    payload: schemas.ShiftPatch,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_sales_settings")),
):
    shift = (
        db.query(models.Shift)
        .filter(models.Shift.shift_id == shift_id)
        .first()
    )
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    if payload.shift_name is not None:
        shift.shift_name = payload.shift_name
    if payload.is_active is not None:
        shift.is_active = payload.is_active

    db.commit()
    db.refresh(shift)
    return shift


# ═══════════════════════════════════════════════════════════════════════════════
# PAYMENT MODES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/payment-modes", response_model=List[schemas.PaymentModeOut])
def list_payment_modes(db: Session = Depends(get_db)):
    """List all payment modes (active and inactive)."""
    return (
        db.query(models.PaymentMode)
        .order_by(models.PaymentMode.payment_mode_id)
        .all()
    )


@router.post("/payment-modes", response_model=schemas.PaymentModeOut, status_code=201)
def create_payment_mode(
    payload: schemas.PaymentModeCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_sales_settings")),
):
    mode = models.PaymentMode(
        name=payload.name,
        is_physical=payload.is_physical,
        is_active=payload.is_active,
        is_ar_charge=payload.is_ar_charge,
        is_ar_credit=payload.is_ar_credit,
        is_credit_memo=payload.is_credit_memo,
        is_pdc=payload.is_pdc,
        is_cash=payload.is_cash,
    )
    db.add(mode)
    db.commit()
    db.refresh(mode)
    return mode


@router.patch("/payment-modes/{payment_mode_id}", response_model=schemas.PaymentModeOut)
def update_payment_mode(
    payment_mode_id: int,
    payload: schemas.PaymentModePatch,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_sales_settings")),
):
    mode = (
        db.query(models.PaymentMode)
        .filter(models.PaymentMode.payment_mode_id == payment_mode_id)
        .first()
    )
    if not mode:
        raise HTTPException(status_code=404, detail="Payment mode not found")

    if payload.name is not None:
        mode.name = payload.name
    if payload.is_physical is not None:
        mode.is_physical = payload.is_physical
    if payload.is_active is not None:
        mode.is_active = payload.is_active
    if payload.is_ar_charge is not None:
        mode.is_ar_charge = payload.is_ar_charge
    if payload.is_ar_credit is not None:
        mode.is_ar_credit = payload.is_ar_credit
    if payload.is_credit_memo is not None:
        mode.is_credit_memo = payload.is_credit_memo
    if payload.is_pdc is not None:
        mode.is_pdc = payload.is_pdc
    if payload.is_cash is not None:
        mode.is_cash = payload.is_cash

    db.commit()
    db.refresh(mode)
    return mode


# ═══════════════════════════════════════════════════════════════════════════════
# CASH REGISTERS
# ═══════════════════════════════════════════════════════════════════════════════

def _load_register(register_id: int, db: Session) -> models.CashRegister:
    register = (
        db.query(models.CashRegister)
        .options(selectinload(models.CashRegister.location))
        .filter(models.CashRegister.register_id == register_id)
        .first()
    )
    if not register:
        raise HTTPException(status_code=404, detail="Register not found")
    return register


@router.get("/registers", response_model=List[schemas.CashRegisterOut])
def list_registers(db: Session = Depends(get_db)):
    """List all registers (active and inactive)."""
    return (
        db.query(models.CashRegister)
        .options(selectinload(models.CashRegister.location))
        .order_by(models.CashRegister.register_id)
        .all()
    )


@router.post("/registers", response_model=schemas.CashRegisterOut, status_code=201)
def create_register(
    payload: schemas.CashRegisterCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_sales_settings")),
):
    location = (
        db.query(Location)
        .filter(
            Location.location_id == payload.location_id,
            Location.is_deleted == False,
            Location.status == "Active",
        )
        .first()
    )
    if not location:
        raise HTTPException(
            status_code=400,
            detail="Location not found or is not Active",
        )

    register = models.CashRegister(
        name=payload.name,
        location_id=payload.location_id,
        is_active=payload.is_active,
    )
    db.add(register)
    db.commit()
    db.refresh(register)
    return _load_register(register.register_id, db)


@router.patch("/registers/{register_id}", response_model=schemas.CashRegisterOut)
def update_register(
    register_id: int,
    payload: schemas.CashRegisterPatch,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_sales_settings")),
):
    register = _load_register(register_id, db)

    if payload.location_id is not None:
        location = (
            db.query(Location)
            .filter(
                Location.location_id == payload.location_id,
                Location.is_deleted == False,
                Location.status == "Active",
            )
            .first()
        )
        if not location:
            raise HTTPException(
                status_code=400,
                detail="Location not found or is not Active",
            )
        register.location_id = payload.location_id

    if payload.name is not None:
        register.name = payload.name
    if payload.is_active is not None:
        register.is_active = payload.is_active

    db.commit()
    return _load_register(register_id, db)


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMERS
# ═══════════════════════════════════════════════════════════════════════════════

def _overdue_customer_ids(db: Session, customer_ids: list[int]) -> set[int]:
    """Per docs/customers_ar.md: a customer is overdue when they carry a
    positive outstanding_balance AND have at least one Posted sale whose
    due_date (= transaction_date + terms_days) has passed without being fully paid.
    """
    if not customer_ids:
        return set()
    today = datetime.now(timezone.utc).date()
    rows = (
        db.query(models.Sale.customer_id)
        .filter(
            models.Sale.customer_id.in_(customer_ids),
            models.Sale.status == "Posted",
            models.Sale.payment_status != "Paid",
            models.Sale.due_date.isnot(None),
            models.Sale.due_date < today,
        )
        .distinct()
        .all()
    )
    return {row[0] for row in rows}


def _attach_overdue_flags(db: Session, customers: list[models.Customer]) -> list[models.Customer]:
    overdue_ids = _overdue_customer_ids(db, [c.customer_id for c in customers])
    for c in customers:
        c.is_overdue = c.customer_id in overdue_ids and (c.outstanding_balance or Decimal("0")) > Decimal("0")
    return customers


def _load_customer(customer_id: int, db: Session) -> models.Customer:
    """Load by id regardless of is_deleted — the Customer Detail page (and the
    Reactivate action routed through PATCH) must be able to load inactive
    customers too. Soft-delete status is exposed via CustomerOut.is_deleted."""
    customer = (
        db.query(models.Customer)
        .filter(models.Customer.customer_id == customer_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.get("/customers", response_model=List[schemas.CustomerOut])
def list_customers(
    search: Optional[str] = None,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
):
    """List customers; optionally filter by name substring.

    By default only active (non-deleted) customers are returned. Pass
    include_deleted=true so the UI's Status filter (Active/Inactive/Both)
    can show inactive customers too.
    """
    q = db.query(models.Customer).order_by(models.Customer.customer_name)
    if not include_deleted:
        q = q.filter(models.Customer.is_deleted == False)
    if search:
        q = q.filter(models.Customer.customer_name.ilike(f"%{normalize_search(search)}%"))
    return _attach_overdue_flags(db, q.all())


@router.post("/customers", response_model=schemas.CustomerOut, status_code=201)
def create_customer(
    payload: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    customer = models.Customer(
        customer_name=payload.customer_name,
        credit_limit=payload.credit_limit,
        terms_days=payload.terms_days,
        outstanding_balance=Decimal("0"),
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/customers/aging", response_model=List[schemas.AgingRowOut])
def get_ar_aging(
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """AR Aging Report — one row per outstanding invoice, sorted customer_name ASC,
    invoice_date ASC.

    Bridge-table calculation (never reads sale.balance_due):
      outstanding = ar_ledger SALE amount_change
                  - SUM(customer_payment_applied.amount_applied WHERE NOT is_ar_charge)
                  - SUM(sales_returns.grand_total WHERE disposition='credit_to_account')
    Only invoices with outstanding > 0 are emitted.
    """
    today = datetime.now(timezone.utc).date()
    zero  = Decimal("0")

    # 1. Active customers (optional name filter)
    q = db.query(models.Customer).filter(models.Customer.is_deleted == False)
    if search:
        q = q.filter(models.Customer.customer_name.ilike(f"%{normalize_search(search)}%"))
    customers = q.order_by(models.Customer.customer_name).all()
    if not customers:
        return []

    customer_ids = [c.customer_id for c in customers]
    customer_map = {c.customer_id: c for c in customers}

    # 2. AR-exposed SALE entries for these customers only (avoids full-table scan)
    ar_sale_rows = (
        db.query(
            models.ArLedger.customer_id,
            models.ArLedger.reference_id,
            models.ArLedger.amount_change,
        )
        .filter(
            models.ArLedger.reason == "SALE",
            models.ArLedger.reference_type == "sales",
            models.ArLedger.customer_id.in_(customer_ids),
        )
        .all()
    )
    if not ar_sale_rows:
        return []

    parsed = [
        (cid, int(ref_id), amount_change)
        for cid, ref_id, amount_change in ar_sale_rows
        if ref_id and ref_id.isdigit()
    ]
    if not parsed:
        return []

    # 3. Fetch transaction_date from Sale and exclude voided sales in one query.
    #    Using sale.transaction_date (the business date, Manila-local) rather than
    #    ar_ledger.occurred_at (UTC system timestamp) ensures correct aging for
    #    backdated sales and avoids the UTC/PHT midnight drift.
    all_sale_ids = [sale_id for _, sale_id, _ in parsed]
    sale_date_rows = (
        db.query(models.Sale.sale_id, models.Sale.transaction_date)
        .filter(
            models.Sale.sale_id.in_(all_sale_ids),
            models.Sale.status != "Voided",
        )
        .all()
    )
    transaction_date_by_id = {sid: td for sid, td in sale_date_rows}

    invoice_rows = [
        {
            "customer_id":  cid,
            "sale_id":      sale_id,
            "principal":    amount_change,
            "invoice_date": transaction_date_by_id[sale_id],
        }
        for cid, sale_id, amount_change in parsed
        if sale_id in transaction_date_by_id
    ]
    if not invoice_rows:
        return []

    active_sale_ids = [r["sale_id"] for r in invoice_rows]

    # 4. Payment offsets — non-AR-charge tenders only
    payments_by_sale_id = dict(
        db.query(
            models.CustomerPaymentApplied.sale_id,
            func.sum(models.CustomerPaymentApplied.amount_applied),
        )
        .join(
            models.CustomerPayment,
            models.CustomerPaymentApplied.payment_id == models.CustomerPayment.payment_id,
        )
        .join(
            models.PaymentMode,
            models.CustomerPayment.payment_mode_id == models.PaymentMode.payment_mode_id,
        )
        .filter(
            models.CustomerPaymentApplied.sale_id.in_(active_sale_ids),
            models.PaymentMode.is_ar_charge == False,
        )
        .group_by(models.CustomerPaymentApplied.sale_id)
        .all()
    )

    # 5. Return credit offsets — credit_to_account returns only
    returns_by_sale_id = dict(
        db.query(models.SalesReturn.sale_id, func.sum(models.SalesReturn.grand_total))
        .filter(
            models.SalesReturn.sale_id.in_(active_sale_ids),
            models.SalesReturn.disposition == "credit_to_account",
        )
        .group_by(models.SalesReturn.sale_id)
        .all()
    )

    # 6. Build per-invoice result rows
    result: list[schemas.AgingRowOut] = []
    for row in invoice_rows:
        cid          = row["customer_id"]
        sale_id      = row["sale_id"]
        principal    = row["principal"]
        invoice_date = row["invoice_date"]

        customer = customer_map.get(cid)
        if customer is None or invoice_date is None:
            continue

        outstanding = (
            principal
            - payments_by_sale_id.get(sale_id, zero)
            - returns_by_sale_id.get(sale_id, zero)
        )
        if outstanding <= zero:
            continue

        due_date     = invoice_date + timedelta(days=customer.terms_days)
        days_overdue = (today - due_date).days

        result.append(schemas.AgingRowOut(
            customer_id=cid,
            customer_name=customer.customer_name,
            invoice_id=sale_id,
            invoice_date=invoice_date,
            due_date=due_date,
            current_amt  = outstanding if days_overdue <= 0        else zero,
            days_1_30    = outstanding if 1  <= days_overdue <= 30 else zero,
            days_31_60   = outstanding if 31 <= days_overdue <= 60 else zero,
            days_61_90   = outstanding if 61 <= days_overdue <= 90 else zero,
            days_91_plus = outstanding if days_overdue > 90        else zero,
        ))

    result.sort(key=lambda r: (r.customer_name, r.invoice_date))
    return result


@router.get("/customers/ar-ledger", response_model=List[schemas.CustomerARLedgerRowOut])
def get_customer_ar_ledger_view(
    customer_id: Optional[int] = None,
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
    status:      List[str] = Query(default=[]),
    search:      Optional[str] = None,
    limit:       int = 200,
    cursor:      int = 0,
    db: Session = Depends(get_db),
):
    """Invoice-level AR ledger — one row per Posted sale with a linked customer,
    sorted customer_name ASC then transaction_date ASC."""
    today = datetime.now(timezone.utc).date()
    zero  = Decimal("0")

    q = (
        db.query(models.Sale)
        .join(models.Customer, models.Sale.customer_id == models.Customer.customer_id)
        .options(selectinload(models.Sale.customer))
        .filter(
            models.Sale.status == "Posted",
            models.Sale.customer_id.isnot(None),
            models.Customer.is_deleted == False,
        )
        .order_by(
            models.Customer.customer_name.asc(),
            models.Sale.transaction_date.asc(),
            models.Sale.sale_id.asc(),
        )
    )

    if customer_id:
        q = q.filter(models.Sale.customer_id == customer_id)
    if date_from:
        q = q.filter(models.Sale.transaction_date >= date_from)
    if date_to:
        q = q.filter(models.Sale.transaction_date <= date_to)
    if search:
        q = q.filter(models.Customer.customer_name.ilike(f"%{normalize_search(search)}%"))

    raw_rows = q.limit(2000).all()

    norm_search = normalize_search(search) if search else None
    result: list[schemas.CustomerARLedgerRowOut] = []
    for sale in raw_rows:
        customer = sale.customer

        if norm_search and norm_search not in normalize_search(customer.customer_name):
            continue

        terms = customer.terms_days or 0
        due   = sale.transaction_date + timedelta(days=terms)
        bal   = sale.balance_due or zero
        total = sale.grand_total  or zero

        if bal <= zero:
            st = "Paid"
        elif due < today and bal > zero:
            st = "Overdue"
        elif zero < bal < total:
            st = "Partial"
        else:
            st = "Open"

        if status and st not in status:
            continue

        result.append(schemas.CustomerARLedgerRowOut(
            sale_id=sale.sale_id,
            sale_pid=sale.sale_pid or "",
            customer_id=customer.customer_id,
            customer_name=customer.customer_name,
            transaction_date=sale.transaction_date,
            due_date=due,
            grand_total=total,
            balance_due=bal,
            status=st,
        ))

    return result[cursor: cursor + limit]


@router.get("/customers/ar-ledger/{sale_id}/payments", response_model=List[schemas.ARLedgerPaymentRowOut])
def get_ar_ledger_sale_payments(
    sale_id: int,
    db: Session = Depends(get_db),
):
    """Return all payments applied to a specific sale, ordered by payment date."""
    rows = (
        db.query(models.CustomerPaymentApplied)
        .join(
            models.CustomerPayment,
            models.CustomerPaymentApplied.payment_id == models.CustomerPayment.payment_id,
        )
        .join(
            models.PaymentMode,
            models.CustomerPayment.payment_mode_id == models.PaymentMode.payment_mode_id,
        )
        .options(
            selectinload(models.CustomerPaymentApplied.payment)
            .selectinload(models.CustomerPayment.payment_mode)
        )
        .filter(
            models.CustomerPaymentApplied.sale_id == sale_id,
            models.PaymentMode.is_ar_charge == False,
        )
        .order_by(
            models.CustomerPayment.payment_date.asc(),
            models.CustomerPaymentApplied.apply_id.asc(),
        )
        .all()
    )
    return [
        schemas.ARLedgerPaymentRowOut(
            payment_id=r.payment_id,
            payment_date=(r.payment.payment_date.date()
                          if r.payment.payment_date else date.today()),
            payment_mode=r.payment.payment_mode.name,
            reference_number=r.payment.reference_number,
            amount_applied=r.amount_applied,
        )
        for r in rows
    ]


@router.get("/customers/{customer_id}", response_model=schemas.CustomerOut)
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = _load_customer(customer_id, db)
    _attach_overdue_flags(db, [customer])
    return customer


@router.patch("/customers/{customer_id}", response_model=schemas.CustomerOut)
def update_customer(
    customer_id: int,
    payload: schemas.CustomerPatch,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    customer = _load_customer(customer_id, db)

    if payload.customer_name is not None:
        customer.customer_name = payload.customer_name
    if payload.credit_limit is not None:
        customer.credit_limit = payload.credit_limit
    if payload.terms_days is not None:
        customer.terms_days = payload.terms_days

    # Editing (or explicitly Reactivating, which the UI routes through this
    # same PATCH with an empty body) always brings the customer back to Active.
    customer.is_deleted = False

    db.commit()
    db.refresh(customer)
    _attach_overdue_flags(db, [customer])
    return customer


@router.delete("/customers/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Soft-delete. Rejected if the customer carries an unpaid balance."""
    customer = _load_customer(customer_id, db)

    if (customer.outstanding_balance or Decimal("0")) > Decimal("0"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete customer with outstanding balance of "
                f"{customer.outstanding_balance}. Settle all balances first."
            ),
        )

    customer.is_deleted = True
    db.commit()


@router.get("/customers/{customer_id}/ar-ledger", response_model=List[schemas.ArLedgerOut])
def get_customer_ar_ledger(
    customer_id: int,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    reason: Optional[str] = None,
    limit: int = 50,
    cursor: Optional[int] = None,
    db: Session = Depends(get_db),
):
    _load_customer(customer_id, db)  # 404 guard
    q = (
        db.query(models.ArLedger)
        .filter(models.ArLedger.customer_id == customer_id)
        .order_by(models.ArLedger.occurred_at.desc(), models.ArLedger.ar_ledger_id.desc())
    )
    if date_from:
        q = q.filter(models.ArLedger.occurred_at >= date_from)
    if date_to:
        q = q.filter(models.ArLedger.occurred_at <= date_to)
    if reason:
        q = q.filter(models.ArLedger.reason == reason)
    if cursor:
        q = q.filter(models.ArLedger.ar_ledger_id < cursor)
    return q.limit(limit).all()


@router.get("/customers/{customer_id}/sales", response_model=List[schemas.SaleOut])
def get_customer_sales(
    customer_id: int,
    limit: int = 10,
    cursor: Optional[int] = None,
    db: Session = Depends(get_db),
):
    _load_customer(customer_id, db)
    q = (
        db.query(models.Sale)
        .options(selectinload(models.Sale.items).selectinload(models.SaleItem.variant))
        .filter(
            models.Sale.customer_id == customer_id,
            models.Sale.status.in_(["Posted", "Voided"]),
        )
        .order_by(models.Sale.transaction_date.desc(), models.Sale.sale_id.desc())
    )
    if cursor:
        q = q.filter(models.Sale.sale_id < cursor)
    result = []
    for sale in q.limit(limit).all():
        out = schemas.SaleOut.model_validate(sale)
        out.items = _collapse_items(sale.items)
        out.payments = []
        result.append(out)
    return result


@router.get("/customers/{customer_id}/payments", response_model=List[schemas.CustomerPaymentOut])
def get_customer_payments(
    customer_id: int,
    limit: int = 10,
    cursor: Optional[int] = None,
    db: Session = Depends(get_db),
):
    _load_customer(customer_id, db)
    q = (
        db.query(models.CustomerPayment)
        .options(selectinload(models.CustomerPayment.applications))
        .filter(models.CustomerPayment.customer_id == customer_id)
        .order_by(models.CustomerPayment.payment_date.desc(), models.CustomerPayment.payment_id.desc())
    )
    if cursor:
        q = q.filter(models.CustomerPayment.payment_id < cursor)
    return q.limit(limit).all()


@router.post("/customers/{customer_id}/payment", response_model=schemas.CustomerPaymentOut, status_code=201)
def record_customer_payment(
    customer_id: int,
    payload: schemas.RecordPaymentIn,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Record a standalone customer payment — reduces outstanding_balance via AR ledger."""
    customer = _load_customer(customer_id, db)

    mode = db.query(models.PaymentMode).filter(
        models.PaymentMode.payment_mode_id == payload.payment_mode_id,
        models.PaymentMode.is_active == True,
    ).first()
    if not mode:
        raise HTTPException(status_code=400, detail="Payment mode not found or inactive")
    if mode.is_pdc:
        if not (payload.check_number and payload.check_date and payload.bank_name):
            raise HTTPException(
                status_code=400,
                detail="PDC payment requires check_number, check_date, and bank_name.",
            )

    payment = models.CustomerPayment(
        customer_id=customer_id,
        payment_mode_id=payload.payment_mode_id,
        amount=payload.amount,
        reference_number=payload.reference_number,
        notes=payload.notes,
        payment_date=payload.payment_date or datetime.now(timezone.utc),
        unapplied_amount=Decimal("0") if payload.sale_id else payload.amount,
    )
    if mode.is_pdc:
        payment.check_number = payload.check_number
        payment.check_date   = payload.check_date
        payment.bank_name    = payload.bank_name
        payment.check_status = "IN_VAULT"
    db.add(payment)
    db.flush()

    if payload.sale_id:
        sale = db.query(models.Sale).filter(
            models.Sale.sale_id == payload.sale_id,
            models.Sale.customer_id == customer_id,
        ).first()
        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found for this customer")
        db.add(models.CustomerPaymentApplied(
            payment_id=payment.payment_id,
            sale_id=payload.sale_id,
            amount_applied=payload.amount,
        ))
        new_balance = max(Decimal("0"), (sale.balance_due or Decimal("0")) - payload.amount)
        sale.balance_due = new_balance
        if new_balance <= Decimal("0"):
            sale.payment_status = "Paid"
        elif new_balance < (sale.grand_total or Decimal("0")):
            sale.payment_status = "Partial"
        else:
            sale.payment_status = "Unpaid"

    db.add(models.ArLedger(
        customer_id=customer_id,
        amount_change=-payload.amount,
        reason="PAYMENT",
        reference_type="customer_payments",
        reference_id=str(payment.payment_id),
        notes=payload.notes,
    ))

    customer.outstanding_balance = (
        (customer.outstanding_balance or Decimal("0")) - payload.amount
    )

    db.commit()
    return _load_payment(payment.payment_id, db)


@router.get("/ar-ledger", response_model=List[schemas.ArLedgerOut])
def get_ar_ledger(
    customer_id: Optional[int] = None,
    reason: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = 100,
    cursor: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Global AR ledger across all customers."""
    q = (
        db.query(models.ArLedger)
        .order_by(models.ArLedger.occurred_at.desc(), models.ArLedger.ar_ledger_id.desc())
    )
    if customer_id:
        q = q.filter(models.ArLedger.customer_id == customer_id)
    if reason:
        q = q.filter(models.ArLedger.reason == reason)
    if date_from:
        q = q.filter(models.ArLedger.occurred_at >= date_from)
    if date_to:
        q = q.filter(models.ArLedger.occurred_at <= date_to)
    if cursor:
        q = q.filter(models.ArLedger.ar_ledger_id < cursor)
    return q.limit(limit).all()


# ═══════════════════════════════════════════════════════════════════════════════
# PDC VAULT
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/pdc", response_model=schemas.PDCMaturityResponse)
def get_pdc_vault(
    status: Optional[str] = Query(None, description="IN_VAULT | DEPOSITED | BOUNCED"),
    bank_name: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    as_of: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """PDC vault — list and summarise post-dated cheques by maturity."""
    today = as_of or _ph_today()
    status_filter = status or "IN_VAULT"

    pdc_mode_ids = [
        m.payment_mode_id
        for m in db.query(models.PaymentMode).filter(
            models.PaymentMode.is_pdc == True
        ).all()
    ]

    empty_summary = schemas.PDCMaturitySummary(
        maturing_today=Decimal("0"),
        maturing_next_7_days=Decimal("0"),
        total_uncleared=Decimal("0"),
        total_overdue=Decimal("0"),
    )
    if not pdc_mode_ids:
        return schemas.PDCMaturityResponse(summary=empty_summary, entries=[])

    # Summary is always computed against IN_VAULT regardless of status filter
    in_vault = (
        db.query(models.CustomerPayment)
        .filter(
            models.CustomerPayment.payment_mode_id.in_(pdc_mode_ids),
            models.CustomerPayment.check_status == "IN_VAULT",
        )
        .all()
    )
    next_7 = today + timedelta(days=7)
    summary = schemas.PDCMaturitySummary(
        maturing_today=sum(
            (p.amount for p in in_vault if p.check_date == today),
            Decimal("0"),
        ),
        maturing_next_7_days=sum(
            (p.amount for p in in_vault if p.check_date and today <= p.check_date <= next_7),
            Decimal("0"),
        ),
        total_uncleared=sum((p.amount for p in in_vault), Decimal("0")),
        total_overdue=sum(
            (p.amount for p in in_vault if p.check_date and p.check_date < today),
            Decimal("0"),
        ),
    )

    q = (
        db.query(models.CustomerPayment)
        .options(selectinload(models.CustomerPayment.applications).joinedload(models.CustomerPaymentApplied.sale))
        .filter(
            models.CustomerPayment.payment_mode_id.in_(pdc_mode_ids),
            models.CustomerPayment.check_status == status_filter,
        )
    )
    if bank_name:
        q = q.filter(models.CustomerPayment.bank_name.ilike(f"%{bank_name}%"))
    if date_from:
        q = q.filter(models.CustomerPayment.check_date >= date_from)
    if date_to:
        q = q.filter(models.CustomerPayment.check_date <= date_to)
    payments = q.order_by(models.CustomerPayment.check_date.asc()).all()

    customer_ids = {p.customer_id for p in payments if p.customer_id}
    customer_map: dict[int, str] = {}
    if customer_ids:
        rows = db.query(models.Customer).filter(
            models.Customer.customer_id.in_(customer_ids)
        ).all()
        customer_map = {c.customer_id: c.customer_name for c in rows}

    entries = [
        schemas.PDCEntryOut(
            payment_id=p.payment_id,
            customer_id=p.customer_id or 0,
            customer_name=customer_map.get(p.customer_id, "Unknown") if p.customer_id else "Unknown",
            check_number=p.check_number or "",
            check_date=p.check_date,
            bank_name=p.bank_name or "",
            check_status=p.check_status or "",
            amount=p.amount,
            payment_date=p.payment_date.date() if p.payment_date else None,
            days_until_maturity=(p.check_date - today).days if p.check_date else 0,
            sale_ids=[a.sale_id for a in p.applications],
            sale_refs=[a.sale.sale_pid or f"SALE-{a.sale_id:05d}" for a in p.applications],
        )
        for p in payments
    ]
    return schemas.PDCMaturityResponse(summary=summary, entries=entries)


@router.patch("/pdc/{payment_id}/deposit", response_model=schemas.CustomerPaymentOut)
def deposit_pdc_check(
    payment_id: int,
    payload: schemas.PDCDepositIn,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Mark a PDC cheque as deposited and update its payment date to the actual deposit date."""
    payment = (
        db.query(models.CustomerPayment)
        .options(
            selectinload(models.CustomerPayment.payment_mode),
            selectinload(models.CustomerPayment.applications),
        )
        .filter(models.CustomerPayment.payment_id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if not payment.payment_mode.is_pdc:
        raise HTTPException(status_code=400, detail="Payment is not a PDC payment")
    if payment.check_status != "IN_VAULT":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot deposit check with status '{payment.check_status}'",
        )

    payment.check_status = "DEPOSITED"
    payment.payment_date = datetime(
        payload.deposited_at.year,
        payload.deposited_at.month,
        payload.deposited_at.day,
        tzinfo=timezone.utc,
    )

    write_audit(db, "sales.customer_payments", str(payment_id), "UPDATE",
                actor_user_id=_actor.user_id,
                new_values={"check_status": "DEPOSITED",
                            "deposited_at": str(payload.deposited_at)})
    db.commit()
    return _load_payment(payment_id, db)


@router.patch("/pdc/{payment_id}/bounce", response_model=schemas.CustomerPaymentOut)
def bounce_pdc_check(
    payment_id: int,
    payload: schemas.PDCBounceIn,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Mark a PDC cheque as bounced and reverse all applied payments against their sales."""
    payment = (
        db.query(models.CustomerPayment)
        .options(
            selectinload(models.CustomerPayment.payment_mode),
            selectinload(models.CustomerPayment.applications),
        )
        .filter(models.CustomerPayment.payment_id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if not payment.payment_mode.is_pdc:
        raise HTTPException(status_code=400, detail="Payment is not a PDC payment")
    if payment.check_status != "IN_VAULT":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot bounce check with status '{payment.check_status}'",
        )

    customer = None
    if payment.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.customer_id == payment.customer_id
        ).first()

    reversal_base = f"PDC reversal — check #{payment.check_number} bounced"
    reversal_notes = (
        f"{reversal_base}. {payload.bounce_notes}"
        if payload.bounce_notes
        else reversal_base
    )

    for apply in payment.applications:
        sale = db.query(models.Sale).filter(
            models.Sale.sale_id == apply.sale_id
        ).first()
        if not sale:
            continue

        new_balance = (sale.balance_due or Decimal("0")) + apply.amount_applied
        sale.balance_due = new_balance
        gt = sale.grand_total or Decimal("0")
        if new_balance >= gt:
            sale.payment_status = "Unpaid"
        elif new_balance > Decimal("0"):
            sale.payment_status = "Partial"
        else:
            sale.payment_status = "Paid"

        # Positive PAYMENT entry reverses the original credit in the AR ledger.
        # The original payment wrote amount_change = -applied (reducing debt).
        # This reversal writes +applied (restoring debt), net effect = zero.
        db.add(models.ArLedger(
            customer_id=payment.customer_id,
            amount_change=apply.amount_applied,
            reason="PAYMENT",
            reference_type="customer_payments",
            reference_id=str(payment.payment_id),
            notes=reversal_notes,
        ))

        if customer:
            customer.outstanding_balance = (
                (customer.outstanding_balance or Decimal("0")) + apply.amount_applied
            )

    payment.check_status = "BOUNCED"
    if customer:
        customer.has_bounced_check = True

    write_audit(db, "sales.customer_payments", str(payment_id), "UPDATE",
                actor_user_id=_actor.user_id,
                new_values={"check_status": "BOUNCED",
                            "bounce_notes": payload.bounce_notes})
    db.commit()
    return _load_payment(payment_id, db)


@router.patch("/customers/{customer_id}/clear-bounced-flag",
              response_model=schemas.CustomerOut)
def clear_bounced_flag(
    customer_id: int,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Manually clear a customer's has_bounced_check flag once the situation is resolved."""
    customer = _load_customer(customer_id, db)
    customer.has_bounced_check = False
    write_audit(db, "sales.customers", str(customer_id), "UPDATE",
                actor_user_id=_actor.user_id,
                new_values={"has_bounced_check": False})
    db.commit()
    db.refresh(customer)
    return customer


# ═══════════════════════════════════════════════════════════════════════════════
# DRAFTS
# ═══════════════════════════════════════════════════════════════════════════════

def _load_draft(sale_id: int, db: Session) -> models.Sale:
    sale = (
        db.query(models.Sale)
        .options(
            selectinload(models.Sale.items)
                .selectinload(models.SaleItem.variant),
        )
        .filter(
            models.Sale.sale_id == sale_id,
            models.Sale.status == "Draft",
        )
        .first()
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Draft not found")
    return sale


def _line_total(
    unit_price: Decimal,
    quantity: Decimal,
    discount_pct: Decimal | None,
    discount_flat: Decimal | None,
) -> Decimal:
    pct  = discount_pct  or Decimal("0")
    flat = discount_flat or Decimal("0")
    raw  = (unit_price * (1 - pct / 100) - flat) * quantity
    return max(Decimal("0"), raw).quantize(Decimal("0.01"))


def _build_sale_items(
    items_in: List[schemas.SaleLineItemIn],
) -> List[models.SaleItem]:
    result = []
    for item in items_in:
        factor    = item.uom_factor or Decimal("1")
        uom_qty   = item.quantity          # qty in the selected UOM (what the user entered)
        base_qty  = uom_qty * factor       # base units to deduct from stock / FIFO
        # line_total is always UOM price × UOM qty, independent of the base conversion
        lt = _line_total(item.unit_price, uom_qty, item.discount_pct, item.discount_flat)
        result.append(models.SaleItem(
            variant_id=item.variant_id,
            quantity=base_qty,     # base units — correct for FIFO and inventory ledger
            unit_price=item.unit_price,
            discount_pct=item.discount_pct,
            discount_flat=item.discount_flat,
            line_total=lt,
        ))
    return result


def _recalculate_totals(sale: models.Sale) -> None:
    """Recompute subtotal, discount_amount, grand_total, and balance_due."""
    subtotal = sum((item.line_total for item in sale.items), Decimal("0"))
    sale.subtotal_amount = subtotal

    merch_subtotal = sum(
        item.line_total for item in sale.items
        if item.variant and item.variant.product
        and item.variant.product.product_type == 'Inventory'
    )
    sale.merchandise_subtotal = merch_subtotal

    cart_pct_amt  = subtotal * (sale.cart_discount_pct  or Decimal("0")) / 100
    cart_flat_amt = sale.cart_discount_flat or Decimal("0")
    sale.discount_amount = (cart_pct_amt + cart_flat_amt).quantize(Decimal("0.01"))

    sale.grand_total = max(
        Decimal("0"),
        subtotal - sale.discount_amount + (sale.tax_amount or Decimal("0")),
    )
    sale.balance_due = sale.grand_total


@router.post("/drafts", response_model=schemas.SaleOut, status_code=201)
def create_draft(
    payload: schemas.SaleCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("process_sale")),
):
    """Create a draft sale. No stock is deducted and no ledger entries are written."""
    # Idempotency: return existing sale if the key is already in use
    if payload.idempotency_key:
        existing = (
            db.query(models.Sale)
            .options(
                selectinload(models.Sale.items)
                    .selectinload(models.SaleItem.variant),
            )
            .filter(models.Sale.idempotency_key == payload.idempotency_key)
            .first()
        )
        if existing:
            return existing

    # Validate location: must exist, be Active, and not soft-deleted
    if not db.query(Location).filter(
        Location.location_id == payload.location_id,
        Location.is_deleted == False,
        Location.status == "Active",
    ).first():
        raise HTTPException(status_code=400, detail="Location not found or is not Active")

    # Validate register (optional)
    if payload.register_id is not None:
        if not db.query(models.CashRegister).filter(
            models.CashRegister.register_id == payload.register_id,
            models.CashRegister.is_active == True,
        ).first():
            raise HTTPException(
                status_code=400, detail="Register not found or is not active"
            )

    # Validate customer (optional)
    if payload.customer_id is not None:
        if not db.query(models.Customer).filter(
            models.Customer.customer_id == payload.customer_id,
            models.Customer.is_deleted == False,
        ).first():
            raise HTTPException(status_code=404, detail="Customer not found")

    sale = models.Sale(
        transaction_date=_ph_today(),
        location_id=payload.location_id,
        register_id=payload.register_id,
        customer_id=payload.customer_id,
        employee_id=payload.employee_id,
        shift_id=payload.shift_id,
        origin_sale_id=payload.origin_sale_id,
        sale_pid=payload.sale_pid,
        cart_discount_pct=payload.cart_discount_pct,
        cart_discount_flat=payload.cart_discount_flat,
        discount_amount=payload.discount_amount,
        tax_amount=payload.tax_amount,
        receipt_grand_total=payload.receipt_grand_total,
        idempotency_key=payload.idempotency_key,
        status="Draft",
        payment_status="Unpaid",
        subtotal_amount=Decimal("0"),
        grand_total=Decimal("0"),
        balance_due=Decimal("0"),
    )
    db.add(sale)
    db.flush()  # materialise sale_id before attaching items

    sale.items = _build_sale_items(payload.items)
    _recalculate_totals(sale)
    db.commit()
    return _load_draft(sale.sale_id, db)


@router.get("/drafts", response_model=List[schemas.SaleOut])
def list_drafts(
    location_id: Optional[int] = None,
    register_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List open drafts; optionally filter by location or register."""
    q = (
        db.query(models.Sale)
        .options(
            selectinload(models.Sale.items)
                .selectinload(models.SaleItem.variant),
        )
        .filter(models.Sale.status == "Draft")
        .order_by(models.Sale.sale_id.desc())
    )
    if location_id is not None:
        q = q.filter(models.Sale.location_id == location_id)
    if register_id is not None:
        q = q.filter(models.Sale.register_id == register_id)
    return q.all()


@router.get("/drafts/{sale_id}", response_model=schemas.SaleOut)
def get_draft(sale_id: int, db: Session = Depends(get_db)):
    return _load_draft(sale_id, db)


@router.patch("/drafts/{sale_id}", response_model=schemas.SaleOut)
def update_draft(
    sale_id: int,
    payload: schemas.SalePatch,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("process_sale")),
):
    """Update header fields and/or replace line items on an open draft."""
    sale = _load_draft(sale_id, db)

    if payload.register_id is not None:
        if not db.query(models.CashRegister).filter(
            models.CashRegister.register_id == payload.register_id,
            models.CashRegister.is_active == True,
        ).first():
            raise HTTPException(
                status_code=400, detail="Register not found or is not active"
            )
        sale.register_id = payload.register_id

    if payload.customer_id is not None:
        if not db.query(models.Customer).filter(
            models.Customer.customer_id == payload.customer_id,
            models.Customer.is_deleted == False,
        ).first():
            raise HTTPException(status_code=404, detail="Customer not found")
        sale.customer_id = payload.customer_id

    if payload.employee_id is not None:
        sale.employee_id = payload.employee_id
    if payload.shift_id is not None:
        sale.shift_id = payload.shift_id
    if payload.cart_discount_pct is not None:
        sale.cart_discount_pct = payload.cart_discount_pct
    if payload.cart_discount_flat is not None:
        sale.cart_discount_flat = payload.cart_discount_flat
    if payload.discount_amount is not None:
        sale.discount_amount = payload.discount_amount
    if payload.tax_amount is not None:
        sale.tax_amount = payload.tax_amount
    if payload.receipt_grand_total is not None:
        sale.receipt_grand_total = payload.receipt_grand_total

    if payload.items is not None:
        # Full replacement: cascade="all, delete-orphan" removes the old rows
        sale.items = _build_sale_items(payload.items)

    _recalculate_totals(sale)
    db.commit()
    return _load_draft(sale_id, db)


@router.delete("/drafts/{sale_id}", status_code=204)
def delete_draft(
    sale_id: int,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("process_sale")),
):
    """Soft-delete a draft by setting status = Voided. No stock or ledger impact."""
    sale = _load_draft(sale_id, db)
    sale.status = "Voided"
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# POST SALE — helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _load_sale(sale_id: int, db: Session) -> models.Sale:
    """Load any sale (any status) with items, variant refs, product info, and payments eager-loaded."""
    sale = (
        db.query(models.Sale)
        .options(
            selectinload(models.Sale.items)
                .selectinload(models.SaleItem.variant)
                .selectinload(inv_models.Variant.product),
            selectinload(models.Sale.payments_applied)
                .selectinload(models.CustomerPaymentApplied.payment)
                .selectinload(models.CustomerPayment.payment_mode),
        )
        .filter(models.Sale.sale_id == sale_id)
        .first()
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    # Attach payments list; also populate payment_mode_name / payment_mode_is_physical
    payments = [pa.payment for pa in (sale.payments_applied or []) if pa.payment]
    for p in payments:
        mode = getattr(p, "payment_mode", None)
        p.payment_mode_name        = mode.name        if mode else None
        p.payment_mode_is_physical = mode.is_physical if mode is not None else True
    sale.payments = payments
    return sale


def _upsert_stock(
    db: Session,
    variant_id: int,
    location_id: int,
    delta: Decimal,
) -> None:
    """Atomically apply a stock delta via PostgreSQL INSERT … ON CONFLICT DO UPDATE."""
    tbl = inv_models.CurrentStock.__table__
    db.execute(
        pg_insert(tbl)
        .values(variant_id=variant_id, location_id=location_id, quantity=delta)
        .on_conflict_do_update(
            constraint="uq_current_stocks_variant_location",
            set_={"quantity": tbl.c.quantity + delta},
        )
    )


def _consume_fifo_for_sale(
    db: Session,
    variant_id: int,
    location_id: int,
    qty: Decimal,
    allow_negative: bool = False,
) -> list[tuple[int | None, Decimal, Decimal, Decimal, Decimal, str]]:
    """Consume FIFO cost layers for a sale outbound movement.

    Returns a list of (layer_id, qty_taken, gross_cost, supplier_discount,
    net_unit_cost, cost_source) tuples. Never raises on missing cost data —
    falls back to supplier_list then none per costing policy.
    Raises HTTP 400 on insufficient stock unless allow_negative is True.
    """
    stock = (
        db.query(inv_models.CurrentStock)
        .filter_by(variant_id=variant_id, location_id=location_id)
        .first()
    )
    available_stock = stock.quantity if stock else Decimal("0")
    if not allow_negative and available_stock < qty:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient stock for variant {variant_id} at location "
                f"{location_id}: need {qty}, available {available_stock}"
            ),
        )

    layers = (
        db.query(inv_models.CostLayer)
        .filter(
            inv_models.CostLayer.variant_id == variant_id,
            inv_models.CostLayer.location_id == location_id,
            inv_models.CostLayer.quantity_remaining > 0,
        )
        .order_by(inv_models.CostLayer.created_at.asc())
        .with_for_update()
        .all()
    )

    layer_total = sum(lay.quantity_remaining for lay in layers)

    # Level 1 — FIFO layers cover the full quantity
    if layer_total >= qty:
        result: list[tuple[int | None, Decimal, Decimal, Decimal, Decimal, str]] = []
        remaining = qty
        for lay in layers:
            if remaining <= 0:
                break
            take = min(lay.quantity_remaining, remaining)
            lay.quantity_remaining -= take
            result.append((
                lay.layer_id, take,
                lay.gross_cost, lay.supplier_discount, lay.net_unit_cost,
                "fifo",
            ))
            remaining -= take
        return result

    # Level 2 — no covering layers; fall back to primary supplier list cost
    vs = (
        db.query(inv_models.VariantSupplier)
        .filter_by(variant_id=variant_id, is_primary=True)
        .first()
    )
    if vs:
        gross = vs.gross_cost or Decimal("0")
        disc  = vs.supplier_discount or Decimal("0")
        net   = gross * (Decimal("1") - disc / Decimal("100"))
        return [(None, qty, gross, disc, net, "supplier_list")]

    # Level 3 — no cost data at all
    return [(None, qty, Decimal("0"), Decimal("0"), Decimal("0"), "none")]


def _collapse_items(items: list) -> list[schemas.SaleItemOut]:
    """Collapse FIFO-split SaleItem rows to one display line per variant.

    The collapsed row carries the first split's sale_item_id (a stable
    anchor for returns), and sums quantity + line_total across splits.
    """
    grouped: dict[int, list] = defaultdict(list)
    for item in items:
        grouped[item.variant_id].append(item)

    collapsed = []
    for variant_id, rows in grouped.items():
        first = rows[0]
        collapsed.append(schemas.SaleItemOut(
            sale_item_id=first.sale_item_id,
            sale_id=first.sale_id,
            variant_id=variant_id,
            cost_layer_id=None,
            quantity=sum(r.quantity for r in rows),
            unit_price=first.unit_price,
            discount_pct=first.discount_pct,
            discount_flat=first.discount_flat,
            line_total=sum(r.line_total for r in rows),
            gross_cost=first.gross_cost,
            supplier_discount=first.supplier_discount,
            net_unit_cost=first.net_unit_cost,
            cost_source=first.cost_source,
            variant=(
                schemas.VariantRefOut(
                    variant_id=first.variant.variant_id,
                    PID=first.variant.PID,
                    variant_name=first.variant.variant_name,
                    product_brand=(first.variant.product.brand if getattr(first.variant, "product", None) else None),
                    product_type=(first.variant.product.product_type if getattr(first.variant, "product", None) else None),
                )
                if first.variant else None
            ),
        ))
    return collapsed


# ═══════════════════════════════════════════════════════════════════════════════
# POST SALE — endpoint
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/drafts/{sale_id}/post", response_model=schemas.SaleOut)
def post_draft(
    sale_id: int,
    payload: schemas.SalePostRequest,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("process_sale")),
):
    """Convert a Draft to a Posted sale.

    All stock movements, ledger writes, and AR updates are committed in a
    single database transaction (Requirements §13.1–§13.8).
    """
    sale = _load_draft(sale_id, db)
    allow_negative = _get_allow_negative_stock(db)

    # ── 1. Idempotency ──────────────────────────────────────────────────────────
    # A Posted sale sharing this key means a previous post succeeded on a
    # retry — return it without reprocessing anything.
    if sale.idempotency_key:
        already = (
            db.query(models.Sale)
            .filter(
                models.Sale.idempotency_key == sale.idempotency_key,
                models.Sale.status == "Posted",
                models.Sale.sale_id != sale_id,
            )
            .first()
        )
        if already:
            loaded = _load_sale(already.sale_id, db)
            out = schemas.SaleOut.model_validate(loaded)
            out.items = _collapse_items(loaded.items)
            return out

    if not sale.items:
        raise HTTPException(
            status_code=400, detail="Cannot post a sale with no line items"
        )

    # ── 2. Load customer (if any) ───────────────────────────────────────────────
    customer = None
    if sale.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.customer_id == sale.customer_id,
            models.Customer.is_deleted == False,
        ).first()
        if not customer:
            raise HTTPException(
                status_code=400, detail="Customer not found or has been deleted"
            )

    # ── 3. Credit limit check (credit customers only) ───────────────────────────
    if (customer
            and customer.terms_days > 0
            and customer.credit_limit is not None):
        current_bal = customer.outstanding_balance or Decimal("0")
        if current_bal + sale.grand_total > customer.credit_limit:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Sale would exceed credit limit "
                    f"(limit {customer.credit_limit}, "
                    f"outstanding {current_bal}, "
                    f"sale total {sale.grand_total})"
                ),
            )

    # ── 4. Validate payment modes and collect AR flags ────────────────────────
    tender_modes: dict[int, models.PaymentMode] = {}
    for tender in payload.tenders:
        mode = db.query(models.PaymentMode).filter(
            models.PaymentMode.payment_mode_id == tender.payment_mode_id,
            models.PaymentMode.is_active == True,
        ).first()
        if not mode:
            raise HTTPException(
                status_code=400,
                detail=f"Payment mode {tender.payment_mode_id} not found or inactive",
            )
        if mode.is_ar_charge and not customer:
            raise HTTPException(
                status_code=400,
                detail=f"Payment mode '{mode.name}' requires a registered customer",
            )
        if mode.is_ar_credit and not customer:
            raise HTTPException(
                status_code=400,
                detail=f"Payment mode '{mode.name}' requires a registered customer",
            )
        if mode.is_pdc:
            if not (tender.check_number and tender.check_date and tender.bank_name):
                raise HTTPException(
                    status_code=400,
                    detail="PDC payment requires check_number, check_date, and bank_name.",
                )
        tender_modes[tender.payment_mode_id] = mode

    # AR Credit validation: total AR Credit tenders must not exceed available credit
    if customer:
        available_credit = Decimal("0")
        current_bal = customer.outstanding_balance or Decimal("0")
        if current_bal < Decimal("0"):
            available_credit = abs(current_bal)
        total_ar_credit_tendered = sum(
            t.amount for t in payload.tenders
            if tender_modes[t.payment_mode_id].is_ar_credit
        )
        if total_ar_credit_tendered > available_credit:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"AR Credit tender total {total_ar_credit_tendered} "
                    f"exceeds available credit {available_credit}"
                ),
            )

    # ── 5. Capture draft items and clear them ──────────────────────────────────
    # Record all line fields before the rows are deleted.
    # quantity is already in BASE units (UOM factor was applied in _build_sale_items).
    # line_total is already the correct revenue amount (UOM price × UOM qty).
    draft_items = [
        (item.variant_id, item.quantity, item.unit_price,
         item.discount_pct, item.discount_flat, item.line_total)
        for item in sale.items
    ]
    db.query(models.SaleItem).filter(
        models.SaleItem.sale_id == sale.sale_id
    ).delete(synchronize_session="fetch")
    db.flush()

    # ── 6. Process each line item ──────────────────────────────────────────────
    new_items: list[models.SaleItem] = []
    inventory_variant_ids: set[int] = set()
    ref_id = str(sale.sale_id)

    for variant_id, qty, unit_price, disc_pct, disc_flat, item_line_total in draft_items:
        variant_obj = (
            db.query(inv_models.Variant)
            .options(selectinload(inv_models.Variant.product))
            .filter(
                inv_models.Variant.variant_id == variant_id,
                inv_models.Variant.is_deleted == False,
            )
            .first()
        )
        if not variant_obj:
            raise HTTPException(
                status_code=400, detail=f"Variant {variant_id} not found"
            )

        product_type = variant_obj.product.product_type
        if product_type == 'Inventory':
            inventory_variant_ids.add(variant_id)

        # ── Non-Inventory / Service: revenue recorded, no stock movement ────────
        if product_type in ("Non-Inventory", "Service"):
            new_items.append(models.SaleItem(
                sale_id=sale.sale_id,
                variant_id=variant_id,
                quantity=qty,
                unit_price=unit_price,
                discount_pct=disc_pct,
                discount_flat=disc_flat,
                line_total=item_line_total,
            ))
            continue

        # ── Bundle: explode to components for stock movement ────────────────────
        components = (
            db.query(inv_models.BundleComponent)
            .filter(inv_models.BundleComponent.bundle_variant_id == variant_id)
            .all()
        )
        if components:
            for comp in components:
                comp_v = (
                    db.query(inv_models.Variant)
                    .options(selectinload(inv_models.Variant.product))
                    .filter_by(variant_id=comp.component_variant_id)
                    .first()
                )
                if (not comp_v or
                        comp_v.product.product_type in ("Non-Inventory", "Service")):
                    continue
                comp_qty = qty * comp.quantity
                _consume_fifo_for_sale(
                    db, comp.component_variant_id, sale.location_id, comp_qty,
                    allow_negative=allow_negative,
                )
                db.add(inv_models.InventoryLedger(
                    variant_id=comp.component_variant_id,
                    location_id=sale.location_id,
                    qty_change=-comp_qty,
                    reason=inv_models.LedgerReason.SALE,
                    reference_type="sales",
                    reference_id=ref_id,
                ))
                _upsert_stock(db, comp.component_variant_id, sale.location_id, -comp_qty)

            # One SaleItem at the bundle level — revenue at bundle price, no cost data
            new_items.append(models.SaleItem(
                sale_id=sale.sale_id,
                variant_id=variant_id,
                quantity=qty,
                unit_price=unit_price,
                discount_pct=disc_pct,
                discount_flat=disc_flat,
                line_total=item_line_total,
            ))
            continue

        # ── Regular Inventory: FIFO split into one SaleItem row per layer ───────
        splits = _consume_fifo_for_sale(db, variant_id, sale.location_id, qty,
                                        allow_negative=allow_negative)
        db.add(inv_models.InventoryLedger(
            variant_id=variant_id,
            location_id=sale.location_id,
            qty_change=-qty,
            reason=inv_models.LedgerReason.SALE,
            reference_type="sales",
            reference_id=ref_id,
        ))
        _upsert_stock(db, variant_id, sale.location_id, -qty)
        for layer_id, qty_taken, gross_cost, supplier_discount, net_cost, cost_source in splits:
            # Proportional share of the item's total revenue for this FIFO layer.
            # Handles UOM conversions (qty in base units ≠ qty billed at UOM price)
            # and fixes disc_flat which must be distributed, not applied per split.
            split_lt = (
                (item_line_total * qty_taken / qty).quantize(Decimal("0.01"))
                if qty > 0
                else Decimal("0")
            )
            new_items.append(models.SaleItem(
                sale_id=sale.sale_id,
                variant_id=variant_id,
                cost_layer_id=layer_id,
                quantity=qty_taken,
                unit_price=unit_price,
                discount_pct=disc_pct,
                discount_flat=disc_flat,
                line_total=split_lt,
                gross_cost=gross_cost,
                supplier_discount=supplier_discount,
                net_unit_cost=net_cost,
                cost_source=cost_source,
            ))

    for item in new_items:
        db.add(item)
    db.flush()  # assign sale_item_ids before further use

    # ── 7. Recalculate totals from final SaleItem rows ─────────────────────────
    subtotal = sum(item.line_total for item in new_items)
    merchandise_subtotal = sum(
        item.line_total for item in new_items
        if item.variant_id in inventory_variant_ids
    )
    cart_pct_amt  = subtotal * (sale.cart_discount_pct  or Decimal("0")) / 100
    cart_flat_amt = sale.cart_discount_flat or Decimal("0")
    sale.discount_amount = (cart_pct_amt + cart_flat_amt).quantize(Decimal("0.01"))
    grand_total = max(
        Decimal("0"),
        subtotal - sale.discount_amount + (sale.tax_amount or Decimal("0")),
    )

    # ── 8. receipt_grand_total / audit_variance ────────────────────────────────
    # receipt_grand_total = grand_total (auditor workstation; cashier page reserved)
    sale.receipt_grand_total = grand_total
    # audit_variance = total tendered - grand_total (positive = change given, negative = shortfall)
    total_tendered_raw = sum(t.amount for t in payload.tenders)
    audit_variance = total_tendered_raw - grand_total

    # ── 9. AR ledger: SALE event ───────────────────────────────────────────────
    if customer:
        db.add(models.ArLedger(
            customer_id=sale.customer_id,
            amount_change=grand_total,
            reason="SALE",
            reference_type="sales",
            reference_id=ref_id,
        ))
    db.flush()

    # ── 10. Apply tendered payments ────────────────────────────────────────────
    # All tender types (including AR_CHARGE/AR_CREDIT) count toward satisfying
    # the sale's balance_due. Only standard (non-AR) tenders reduce the
    # customer's outstanding_balance — AR_CREDIT draws from existing credit
    # implicitly; AR_CHARGE leaves the obligation on the AR account.
    remaining_balance = grand_total
    total_applied = Decimal("0")
    standard_applied = Decimal("0")  # used for outstanding_balance update

    for tender in payload.tenders:
        mode = tender_modes[tender.payment_mode_id]

        # ── Credit memo pre-redemption validation ──────────────────────────
        validated_memo = None
        if mode.is_credit_memo:
            memo_code = tender.reference_number
            if not memo_code:
                raise HTTPException(
                    status_code=400,
                    detail="Credit Memo tender requires a memo code in reference_number",
                )
            validated_memo = (
                db.query(models.CreditMemo)
                .filter(models.CreditMemo.code == memo_code)
                .with_for_update()
                .first()
            )
            if not validated_memo:
                raise HTTPException(status_code=400, detail="Credit memo not found")
            today = schemas._ph_today()
            if validated_memo.status != "ACTIVE" or validated_memo.valid_until < today:
                reason = (validated_memo.status
                          if validated_memo.status != "ACTIVE" else "EXPIRED")
                raise HTTPException(
                    status_code=400,
                    detail=f"Credit memo cannot be redeemed: {reason}",
                )

        amount_to_apply = min(tender.amount, remaining_balance)
        unapplied = tender.amount - amount_to_apply

        payment = models.CustomerPayment(
            customer_id=sale.customer_id,
            payment_mode_id=tender.payment_mode_id,
            amount=tender.amount,
            reference_number=tender.reference_number,
            unapplied_amount=unapplied,
        )
        if mode.is_pdc:
            payment.check_number = tender.check_number
            payment.check_date   = tender.check_date
            payment.bank_name    = tender.bank_name
            payment.check_status = "IN_VAULT"
        db.add(payment)
        db.flush()  # need payment_id for the applied row

        if amount_to_apply > 0:
            db.add(models.CustomerPaymentApplied(
                payment_id=payment.payment_id,
                sale_id=sale.sale_id,
                amount_applied=amount_to_apply,
            ))
            total_applied += amount_to_apply
            remaining_balance -= amount_to_apply

            if validated_memo:
                validated_memo.status = "REDEEMED"
                db.add(models.CreditMemoRedemption(
                    memo_id=validated_memo.memo_id,
                    sale_id=sale.sale_id,
                    amount_redeemed=amount_to_apply,
                    redeemed_by_user_id=_actor.user_id,
                ))

            if customer:
                if mode.is_ar_charge:
                    # AR Charge: deferred payment — the customer is paying on
                    # credit, so no separate ledger entry is written here; the
                    # SALE entry already recorded the full receivable obligation.
                    # Writing an AR_CHARGE entry too would double-count it.
                    pass
                elif mode.is_ar_credit:
                    # AR Credit: draws from accumulated credit balance
                    db.add(models.ArLedger(
                        customer_id=sale.customer_id,
                        amount_change=-amount_to_apply,
                        reason="AR_CREDIT",
                        reference_type="customer_payments",
                        reference_id=str(payment.payment_id),
                    ))
                    # Does NOT count in standard_applied; the SALE entry
                    # offset against existing credit handles the net balance
                else:
                    # Standard cash/digital payment
                    db.add(models.ArLedger(
                        customer_id=sale.customer_id,
                        amount_change=-amount_to_apply,
                        reason="PAYMENT",
                        reference_type="customer_payments",
                        reference_id=str(payment.payment_id),
                    ))

            if not mode.is_ar_charge and not mode.is_ar_credit:
                standard_applied += amount_to_apply

    # ── 11. Compute balance_due and payment_status ─────────────────────────────
    # standard_applied excludes AR Charge (deferred credit) and AR Credit tenders.
    # balance_due and payment_status must reflect only cash/card actually collected
    # so that AR-charged sales are not incorrectly marked Paid.
    balance_due = max(grand_total - standard_applied, Decimal("0"))
    if standard_applied == 0:
        payment_status = "Unpaid"
    elif balance_due <= 0:
        payment_status = "Paid"
    else:
        payment_status = "Partial"

    # ── 12. Update customer.outstanding_balance ────────────────────────────────
    # Net effect: +grand_total (from SALE obligation) - standard_applied (cash/card)
    # AR_CREDIT draws from existing negative balance (SALE offset handles it)
    # AR_CHARGE remains as open obligation (not subtracted)
    if customer:
        customer.outstanding_balance = (
            (customer.outstanding_balance or Decimal("0"))
            + grand_total
            - standard_applied
        )

    # ── 13. Finalise sale header ───────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    sale.sale_pid        = sale.sale_pid or f"SALE-{sale.sale_id:05d}"
    sale.posted_at       = now
    sale.transaction_date = payload.transaction_date
    sale.status          = "Posted"
    sale.subtotal_amount      = subtotal
    sale.merchandise_subtotal = merchandise_subtotal
    sale.grand_total          = grand_total
    sale.balance_due     = balance_due
    sale.payment_status  = payment_status
    sale.audit_variance  = audit_variance

    # due_date only for credit customers (terms_days > 0)
    if customer and customer.terms_days > 0:
        sale.due_date = sale.transaction_date + timedelta(days=customer.terms_days)

    db.commit()

    # ── Return the posted sale with items collapsed to one row per variant ──────
    loaded = _load_sale(sale.sale_id, db)
    write_audit(db, "sales.sales", str(sale.sale_id), "UPDATE",
                actor_user_id=_actor.user_id,
                new_values=_serialize(loaded))
    db.commit()
    out = schemas.SaleOut.model_validate(loaded)
    out.items = _collapse_items(loaded.items)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# READING SALES
# ═══════════════════════════════════════════════════════════════════════════════

# Both `Sale.transaction_date` and `SalesReturn.return_date` are plain calendar
# Date columns (no time/timezone). date_from/date_to query params are coerced
# to plain dates as txn_date_from/txn_date_to and compared directly.
_PH_TZ = timezone(timedelta(hours=8))


def _ph_today() -> date:
    """Today's calendar date in Manila local time (UTC+8).

    The container/DB run in UTC, so naive `date.today()` / `CURRENT_DATE`
    misclassify the ~00:00-08:00 PHT window as "yesterday". Used as the
    default `transaction_date` for new drafts and posted sales.
    """
    return datetime.now(_PH_TZ).date()


def _ph_day_bounds(date_from: Optional[datetime], date_to: Optional[datetime]):
    """Anchor naive date_from/date_to to PH-local midnight and return a
    half-open [start, end) UTC-comparable range covering full local day(s)."""
    start = date_from.replace(tzinfo=_PH_TZ) if (date_from and date_from.tzinfo is None) else date_from
    end = None
    if date_to is not None:
        anchored = date_to.replace(tzinfo=_PH_TZ) if date_to.tzinfo is None else date_to
        end = anchored + timedelta(days=1)
    return start, end


@router.get("/", response_model=schemas.SalesListResponse)
def list_sales(
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    location_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    customer_id: Optional[int] = None,
    payment_status: Optional[str] = None,
    shift_id: Optional[int] = None,
    register_id: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    has_variance: bool = False,
    has_uncosted: bool = False,
    cursor: Optional[int] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """List sales, newest first. Returns paginated results with summary totals.

    cursor is a sale_id — returns sales with sale_id < cursor (older).
    has_variance filters to sales where audit_variance != 0.
    has_uncosted filters to sales with any sale_item where cost_source = 'none'.
    """
    if status:
        status_filter = [status]
    else:
        status_filter = ["Posted", "Voided"]

    q = (
        db.query(models.Sale)
        .options(
            selectinload(models.Sale.items)
                .selectinload(models.SaleItem.variant)
                .selectinload(inv_models.Variant.product),
        )
        .filter(models.Sale.status.in_(status_filter))
        .order_by(models.Sale.transaction_date.desc(), models.Sale.sale_id.desc())
    )
    txn_date_from = date_from.date() if date_from else None
    txn_date_to = date_to.date() if date_to else None
    if txn_date_from is not None:
        q = q.filter(models.Sale.transaction_date >= txn_date_from)
    if txn_date_to is not None:
        q = q.filter(models.Sale.transaction_date <= txn_date_to)
    if location_id is not None:
        q = q.filter(models.Sale.location_id == location_id)
    if employee_id is not None:
        q = q.filter(models.Sale.employee_id == employee_id)
    if customer_id is not None:
        q = q.filter(models.Sale.customer_id == customer_id)
    if payment_status is not None:
        q = q.filter(models.Sale.payment_status == payment_status)
    if shift_id is not None:
        q = q.filter(models.Sale.shift_id == shift_id)
    if register_id is not None:
        q = q.filter(models.Sale.register_id == register_id)
    if search:
        q = q.filter(models.Sale.sale_pid.ilike(f"%{normalize_search(search)}%"))
    if has_variance:
        q = q.filter(
            models.Sale.audit_variance.isnot(None),
            models.Sale.audit_variance != Decimal("0"),
        )
    if has_uncosted:
        uncosted_sale_ids = (
            db.query(models.SaleItem.sale_id)
            .filter(models.SaleItem.cost_source == "none")
            .distinct()
            .subquery()
        )
        q = q.filter(models.Sale.sale_id.in_(uncosted_sale_ids))

    all_sales = q.all()

    # ── Build sale rows ────────────────────────────────────────────────────
    combined: list[schemas.SaleOut] = []
    for sale in all_sales:
        out = schemas.SaleOut.model_validate(sale)
        out.items = _collapse_items(sale.items)
        out.payments = []
        out.non_merchandise_revenue = sum(
            (item.line_total for item in sale.items
             if getattr(item, 'variant', None) and getattr(item.variant, 'product', None)
             and item.variant.product.product_type in ("Service", "Non-Inventory")),
            Decimal("0"),
        )
        combined.append(out)

    # ── Query and append return rows (only for Posted / unfiltered status) ─
    include_returns = (not status or status == "Posted") and not has_variance and not has_uncosted
    if include_returns:
        rq = db.query(models.SalesReturn)
        if txn_date_from is not None:
            rq = rq.filter(models.SalesReturn.return_date >= txn_date_from)
        if txn_date_to is not None:
            rq = rq.filter(models.SalesReturn.return_date <= txn_date_to)
        if location_id is not None:
            rq = rq.filter(models.SalesReturn.location_id == location_id)
        if customer_id is not None:
            rq = rq.filter(models.SalesReturn.customer_id == customer_id)
        if shift_id is not None:
            rq = rq.filter(models.SalesReturn.shift_id == shift_id)
        if register_id is not None:
            rq = rq.filter(models.SalesReturn.register_id == register_id)
        if search:
            rq = rq.filter(models.SalesReturn.return_pid.ilike(f"%{search}%"))
        all_returns = rq.all()

        for r in all_returns:
            gt = r.grand_total or Decimal("0")
            combined.append(schemas.SaleOut(
                sale_id=-r.return_id,  # negative sentinel — never matches a real sale_id
                sale_pid=r.return_pid,
                transaction_date=r.return_date.date() if isinstance(r.return_date, datetime) else r.return_date,
                posted_at=None,
                location_id=r.location_id,
                register_id=None,
                customer_id=r.customer_id,
                employee_id=None,
                shift_id=None,
                origin_sale_id=r.sale_id,
                created_by_user_id=r.created_by_user_id,
                subtotal_amount=gt,
                cart_discount_pct=None,
                cart_discount_flat=None,
                discount_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                grand_total=-gt,
                receipt_grand_total=None,
                audit_variance=None,
                due_date=None,
                payment_status="Paid",
                balance_due=Decimal("0"),
                status="Return",
                voided_at=None,
                void_reason=None,
                idempotency_key=None,
                items=[],
                payments=[],
                row_type="return",
                return_id=r.return_id,
            ))

    # ── Sort combined list by transaction_date descending ──────────────────
    def _sort_key(x: schemas.SaleOut):
        d = x.transaction_date
        if d is None:
            return date.min
        return d

    combined.sort(key=_sort_key, reverse=True)

    # ── Totals (sales subtotals/discounts exclude return rows) ─────────────
    sale_rows = [r for r in combined if r.row_type == "sale"]
    totals = schemas.SaleTotals(
        count=len(combined),
        subtotal=sum((s.subtotal_amount or Decimal("0")) for s in sale_rows),
        discount=sum((s.discount_amount or Decimal("0")) for s in sale_rows),
        grand_total=sum((s.grand_total or Decimal("0")) for s in combined),
        receipt_total=sum((s.receipt_grand_total or Decimal("0")) for s in sale_rows if s.receipt_grand_total is not None) or None,
        variance=sum((s.audit_variance or Decimal("0")) for s in sale_rows if s.audit_variance is not None) or None,
    )

    # ── Paginate (cursor not supported for mixed list; always return first N) ─
    page = combined[:limit]
    next_cursor = None

    return schemas.SalesListResponse(items=page, totals=totals, next_cursor=next_cursor)


@router.get("/{sale_id}/items", response_model=List[schemas.SaleItemOut])
def get_sale_items(sale_id: int, db: Session = Depends(get_db)):
    """Return raw sale_items rows, one per FIFO layer split.

    For audit and COGS queries. Includes full cost snapshot per split row.
    """
    loaded = _load_sale(sale_id, db)
    return loaded.items


# ═══════════════════════════════════════════════════════════════════════════════
# VOID SALE
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/{sale_id}/void", response_model=schemas.SaleOut)
def void_sale(
    sale_id: int,
    payload: schemas.SaleVoidRequest,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("process_sale")),
):
    """Void a Posted sale.

    All reversals happen in a single transaction:
    - Stock restored via RETURN_IN ledger entries (Requirements §13.7)
    - FIFO cost layers restored in reverse insertion order for regular inventory
    - AR ADJUSTMENT written for -grand_total
    - customer.outstanding_balance updated transactionally
    Payment records are preserved; the AR ADJUSTMENT covers the full reversal.

    Bundle component layers are restored through the inventory ledger reversal;
    their individual cost-layer quantities are not tracked in sale_items and
    therefore cannot be restored on a per-layer basis.
    """
    sale = _load_sale(sale_id, db)

    # ── 1. Gate: only Posted sales may be voided ───────────────────────────────
    if sale.status != "Posted":
        raise HTTPException(
            status_code=400,
            detail=(
                "Sale is already voided"
                if sale.status == "Voided"
                else "Only Posted sales can be voided; use DELETE /sales/drafts/{id} for drafts"
            ),
        )

    now = datetime.now(timezone.utc)
    ref_id = str(sale.sale_id)

    # ── 2. Reverse stock movements ─────────────────────────────────────────────
    # Use the authoritative SALE ledger entries to identify every variant that
    # had stock deducted — covers both regular inventory and bundle components.
    sale_entries = (
        db.query(inv_models.InventoryLedger)
        .filter(
            inv_models.InventoryLedger.reference_type == "sales",
            inv_models.InventoryLedger.reference_id == ref_id,
            inv_models.InventoryLedger.reason == inv_models.LedgerReason.SALE,
        )
        .all()
    )

    for entry in sale_entries:
        return_qty = -entry.qty_change   # entry.qty_change was negative
        db.add(inv_models.InventoryLedger(
            variant_id=entry.variant_id,
            location_id=entry.location_id,
            qty_change=return_qty,
            reason=inv_models.LedgerReason.RETURN_IN,
            reference_type="sales",
            reference_id=ref_id,
        ))
        _upsert_stock(db, entry.variant_id, entry.location_id, return_qty)

    # ── 3. Restore FIFO cost layers (regular inventory only) ───────────────────
    # Iterate in reverse sale_item_id order (most recently consumed layer first).
    # Capped at original_quantity to guard against any data drift.
    fifo_items = (
        db.query(models.SaleItem)
        .filter(
            models.SaleItem.sale_id == sale.sale_id,
            models.SaleItem.cost_layer_id.isnot(None),
        )
        .order_by(models.SaleItem.sale_item_id.desc())
        .all()
    )

    for item in fifo_items:
        layer = (
            db.query(inv_models.CostLayer)
            .filter(inv_models.CostLayer.layer_id == item.cost_layer_id)
            .with_for_update()
            .first()
        )
        if layer:
            layer.quantity_remaining = min(
                layer.quantity_remaining + item.quantity,
                layer.original_quantity,
            )

    # ── 3.5. Reverse any credit memo redemptions for this sale ────────────────
    cm_redemptions = (
        db.query(models.CreditMemoRedemption)
        .filter(models.CreditMemoRedemption.sale_id == sale.sale_id)
        .all()
    )
    for redemption in cm_redemptions:
        memo = (
            db.query(models.CreditMemo)
            .filter(models.CreditMemo.memo_id == redemption.memo_id)
            .with_for_update()
            .first()
        )
        if memo and memo.status == "REDEEMED":
            memo.status = "ACTIVE"
        db.delete(redemption)

    # ── 4 & 5. AR ledger + customer balance ────────────────────────────────────
    customer = None
    if sale.customer_id:
        customer = (
            db.query(models.Customer)
            .filter(models.Customer.customer_id == sale.customer_id)
            .first()
        )

    if customer:
        db.add(models.ArLedger(
            customer_id=sale.customer_id,
            amount_change=-sale.grand_total,
            reason="ADJUSTMENT",
            reference_type="sales",
            reference_id=ref_id,
        ))
        # Reverse the net AR impact that posting created.
        # outstanding_balance was increased by (grand_total − total_applied) at post
        # time; voiding subtracts grand_total, leaving −total_applied as a credit
        # balance if the sale was paid.
        customer.outstanding_balance = (
            (customer.outstanding_balance or Decimal("0")) - sale.grand_total
        )

    # ── 6. Mark the sale Voided ────────────────────────────────────────────────
    sale.status     = "Voided"
    sale.voided_at  = now
    sale.void_reason = payload.void_reason

    # ── 7. Payment records are intentionally preserved ─────────────────────────
    # customer_payments and customer_payment_applied rows are kept as the
    # historical record of what was tendered.  The AR ADJUSTMENT above is the
    # single reversal entry per Requirements §13.7.

    db.commit()

    loaded = _load_sale(sale.sale_id, db)
    write_audit(db, "sales.sales", str(sale_id), "UPDATE",
                actor_user_id=_actor.user_id,
                new_values=_serialize(loaded))
    db.commit()
    out = schemas.SaleOut.model_validate(loaded)
    out.items = _collapse_items(loaded.items)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMER PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════════

def _load_payment(payment_id: int, db: Session) -> models.CustomerPayment:
    payment = (
        db.query(models.CustomerPayment)
        .options(selectinload(models.CustomerPayment.applications))
        .filter(models.CustomerPayment.payment_id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


def _apply_and_update(
    db: Session,
    sale: models.Sale,
    payment_id: int,
    amount_to_apply: Decimal,
    customer_id: Optional[int],
) -> None:
    """Create a CustomerPaymentApplied row, update the sale's balance/status,
    and write an AR PAYMENT ledger entry.  Does NOT update outstanding_balance —
    the caller handles that so it can batch multiple applications.
    """
    db.add(models.CustomerPaymentApplied(
        payment_id=payment_id,
        sale_id=sale.sale_id,
        amount_applied=amount_to_apply,
    ))
    sale.balance_due = max(sale.balance_due - amount_to_apply, Decimal("0"))
    sale.payment_status = "Paid" if sale.balance_due <= 0 else "Partial"

    if customer_id:
        db.add(models.ArLedger(
            customer_id=customer_id,
            amount_change=-amount_to_apply,
            reason="PAYMENT",
            reference_type="customer_payments",
            reference_id=str(payment_id),
        ))


@router.post("/payments", response_model=schemas.CustomerPaymentOut, status_code=201)
def create_payment(
    payload: schemas.CustomerPaymentCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Record a customer payment and apply it to one or more sales.

    `applications` is optional; an unapplied payment is valid and can be
    applied later via POST /sales/payments/{id}/apply.
    """
    # Validate customer
    customer = None
    if payload.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.customer_id == payload.customer_id,
            models.Customer.is_deleted == False,
        ).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

    # Validate payment mode
    if not db.query(models.PaymentMode).filter(
        models.PaymentMode.payment_mode_id == payload.payment_mode_id,
        models.PaymentMode.is_active == True,
    ).first():
        raise HTTPException(
            status_code=400, detail="Payment mode not found or inactive"
        )

    # Total applications must not exceed the payment amount
    if payload.applications:
        total_requested = sum(a.amount_applied for a in payload.applications)
        if total_requested > payload.amount:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Total applications ({total_requested}) exceed "
                    f"payment amount ({payload.amount})"
                ),
            )

    # Create the payment (unapplied_amount starts as the full amount)
    payment = models.CustomerPayment(
        customer_id=payload.customer_id,
        payment_mode_id=payload.payment_mode_id,
        amount=payload.amount,
        reference_number=payload.reference_number,
        unapplied_amount=payload.amount,
    )
    db.add(payment)
    db.flush()  # materialise payment_id

    total_applied = Decimal("0")

    for app in payload.applications:
        sale = db.query(models.Sale).filter(
            models.Sale.sale_id == app.sale_id,
            models.Sale.status == "Posted",
        ).first()
        if not sale:
            raise HTTPException(
                status_code=400,
                detail=f"Sale {app.sale_id} not found or not in Posted status",
            )
        if app.amount_applied > (sale.balance_due or Decimal("0")):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Amount applied ({app.amount_applied}) exceeds "
                    f"balance due on sale {app.sale_id} ({sale.balance_due})"
                ),
            )

        _apply_and_update(
            db, sale, payment.payment_id, app.amount_applied, payload.customer_id
        )
        total_applied += app.amount_applied

    payment.unapplied_amount = payment.amount - total_applied

    if customer and total_applied > 0:
        customer.outstanding_balance = (
            (customer.outstanding_balance or Decimal("0")) - total_applied
        )

    db.commit()
    payment_loaded = _load_payment(payment.payment_id, db)
    write_audit(db, "sales.customer_payments", str(payment.payment_id), "INSERT",
                actor_user_id=_actor.user_id,
                new_values=_serialize(payment_loaded))
    db.commit()
    return payment_loaded


@router.get("/payments", response_model=List[schemas.CustomerPaymentOut])
def list_payments(
    customer_id: Optional[int] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    """List customer payments, newest first. Filter by customer_id and/or date range."""
    q = (
        db.query(models.CustomerPayment)
        .options(selectinload(models.CustomerPayment.applications))
        .order_by(models.CustomerPayment.payment_id.desc())
    )
    if customer_id is not None:
        q = q.filter(models.CustomerPayment.customer_id == customer_id)
    if date_from is not None:
        q = q.filter(models.CustomerPayment.payment_date >= date_from)
    if date_to is not None:
        q = q.filter(models.CustomerPayment.payment_date <= date_to)
    return q.all()


@router.get("/payments/{payment_id}", response_model=schemas.CustomerPaymentOut)
def get_payment(payment_id: int, db: Session = Depends(get_db)):
    """Get a single payment with its application detail."""
    return _load_payment(payment_id, db)


@router.post("/payments/{payment_id}/apply", response_model=schemas.CustomerPaymentOut)
def apply_unapplied_payment(
    payment_id: int,
    payload: schemas.ManualPaymentApplyIn,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    """Manually apply unapplied credit from a payment to a sale.

    Requires manage_customers permission — not available to floor cashier roles.
    """
    payment = _load_payment(payment_id, db)

    unapplied = payment.unapplied_amount or Decimal("0")
    if payload.amount_applied <= 0:
        raise HTTPException(
            status_code=400, detail="amount_applied must be positive"
        )
    if payload.amount_applied > unapplied:
        raise HTTPException(
            status_code=400,
            detail=(
                f"amount_applied ({payload.amount_applied}) exceeds "
                f"unapplied balance ({unapplied})"
            ),
        )

    sale = db.query(models.Sale).filter(
        models.Sale.sale_id == payload.sale_id,
        models.Sale.status == "Posted",
    ).first()
    if not sale:
        raise HTTPException(
            status_code=400,
            detail=f"Sale {payload.sale_id} not found or not in Posted status",
        )
    if not sale.balance_due or sale.balance_due <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Sale {payload.sale_id} has no outstanding balance",
        )

    # Cap at sale balance_due so the caller doesn't need to know the exact figure
    amount_to_apply = min(payload.amount_applied, sale.balance_due)

    _apply_and_update(
        db, sale, payment_id, amount_to_apply, payment.customer_id
    )
    payment.unapplied_amount = unapplied - amount_to_apply

    if payment.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.customer_id == payment.customer_id,
        ).first()
        if customer:
            customer.outstanding_balance = (
                (customer.outstanding_balance or Decimal("0")) - amount_to_apply
            )

    db.commit()
    return _load_payment(payment_id, db)


# ═══════════════════════════════════════════════════════════════════════════════
# SALES RETURNS
# ═══════════════════════════════════════════════════════════════════════════════



def _load_return(return_id: int, db: Session) -> models.SalesReturn:
    ret = (
        db.query(models.SalesReturn)
        .options(
            selectinload(models.SalesReturn.items)
                .selectinload(models.SalesReturnItem.variant),
        )
        .filter(models.SalesReturn.return_id == return_id)
        .first()
    )
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    _attach_exchange(ret, db)
    return ret


def _attach_exchange(ret: models.SalesReturn, db: Session) -> None:
    """Attach exchange_sale_pid / exchange_sale_id as Python attributes."""
    if ret.sale_id:
        exchange = (
            db.query(models.Sale.sale_id, models.Sale.sale_pid)
            .filter(
                models.Sale.origin_sale_id == ret.sale_id,
                models.Sale.status != "Voided",
            )
            .first()
        )
        ret.exchange_sale_pid = exchange.sale_pid if exchange else None
        ret.exchange_sale_id  = exchange.sale_id  if exchange else None
    else:
        ret.exchange_sale_pid = None
        ret.exchange_sale_id  = None


def _do_return(
    payload: schemas.SalesReturnCreate,
    current_user: models.User,
    db: Session,
) -> models.SalesReturn:
    """Core return logic: creates SalesReturn + items + ledger entries.
    Does NOT commit — caller is responsible for commit/rollback.
    Returns the unflushed SalesReturn ORM object (return_id is available after flush).
    """
    is_blind = payload.sale_id is None
    resolved_return_date = payload.return_date if payload.return_date is not None else _ph_today()

    if is_blind:
        if not has_action(current_user, "process_blind_returns", db):
            raise HTTPException(status_code=403, detail="Missing permission: process_blind_returns")
        if payload.location_id is None:
            raise HTTPException(status_code=400, detail="location_id is required for blind returns")

    sale = None
    customer = None
    if not is_blind:
        sale = db.query(models.Sale).filter(
            models.Sale.sale_id == payload.sale_id,
            models.Sale.status == "Posted",
        ).first()
        if not sale:
            raise HTTPException(
                status_code=400,
                detail=f"Sale {payload.sale_id} not found or not in Posted status",
            )
        if sale.customer_id:
            customer = db.query(models.Customer).filter(
                models.Customer.customer_id == sale.customer_id,
            ).first()

    if is_blind and payload.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.customer_id == payload.customer_id,
            models.Customer.is_deleted == False,
        ).first()

    location_id = payload.location_id if payload.location_id is not None else sale.location_id
    if not db.query(Location).filter(
        Location.location_id == location_id, Location.is_deleted == False,
    ).first():
        raise HTTPException(status_code=400, detail="Return location not found")

    if not payload.items:
        raise HTTPException(status_code=400, detail="Return must have at least one item")

    validated: list[dict] = []
    for item in payload.items:
        cost_layer_id = None
        if item.sale_item_id is not None:
            si = db.query(models.SaleItem).filter(
                models.SaleItem.sale_item_id == item.sale_item_id,
            ).first()
            if not si:
                raise HTTPException(status_code=400, detail=f"SaleItem {item.sale_item_id} not found")
            if si.variant_id != item.variant_id:
                raise HTTPException(status_code=400, detail=f"Variant mismatch on SaleItem {item.sale_item_id}")
            if item.quantity > si.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Return quantity ({item.quantity}) exceeds sold quantity ({si.quantity})",
                )
            cost_layer_id = si.cost_layer_id
            # Use actual paid-per-unit price (post-discount) from original sale line
            unit_paid = si.line_total / si.quantity
            line_total = (unit_paid * item.quantity).quantize(Decimal("0.01"))
        else:
            # Blind return: caller supplies the price
            line_total = (item.quantity * item.unit_price).quantize(Decimal("0.01"))
        validated.append({
            "variant_id": item.variant_id,
            "sale_item_id": item.sale_item_id,
            "cost_layer_id": cost_layer_id,
            "quantity": item.quantity,
            "line_total": line_total,
        })

    grand_total = sum(v["line_total"] for v in validated)

    sales_return = models.SalesReturn(
        sale_id=payload.sale_id,
        location_id=location_id,
        return_date=resolved_return_date,
        reason=payload.reason,
        grand_total=grand_total,
        disposition=payload.disposition,
        customer_id=customer.customer_id if customer else None,
        created_by_user_id=current_user.user_id,
        shift_id=payload.shift_id,
        register_id=payload.register_id,
    )
    db.add(sales_return)
    db.flush()
    sales_return.return_pid = f"RET-{sales_return.return_id:05d}"
    ref_id = str(sales_return.return_id)

    for v in validated:
        db.add(models.SalesReturnItem(
            return_id=sales_return.return_id,
            sale_item_id=v["sale_item_id"],
            variant_id=v["variant_id"],
            cost_layer_id=v["cost_layer_id"],
            quantity=v["quantity"],
            line_total=v["line_total"],
        ))
        variant_obj = (
            db.query(inv_models.Variant)
            .options(selectinload(inv_models.Variant.product))
            .filter(inv_models.Variant.variant_id == v["variant_id"])
            .first()
        )
        if not variant_obj or variant_obj.product.product_type in ("Non-Inventory", "Service"):
            continue
        db.add(inv_models.InventoryLedger(
            variant_id=v["variant_id"],
            location_id=location_id,
            qty_change=v["quantity"],
            reason=inv_models.LedgerReason.RETURN_IN,
            reference_type="sales_returns",
            reference_id=ref_id,
        ))
        _upsert_stock(db, v["variant_id"], location_id, v["quantity"])
        if v["cost_layer_id"] is not None:
            layer = (
                db.query(inv_models.CostLayer)
                .filter(inv_models.CostLayer.layer_id == v["cost_layer_id"])
                .with_for_update()
                .first()
            )
            if layer:
                layer.quantity_remaining = min(
                    layer.quantity_remaining + v["quantity"],
                    layer.original_quantity,
                )

    if payload.disposition == 'credit_to_account' and customer:
        db.add(models.ArLedger(
            customer_id=customer.customer_id,
            amount_change=-grand_total,
            reason="RETURN",
            reference_type="sales_returns",
            reference_id=ref_id,
        ))
        customer.outstanding_balance = (
            (customer.outstanding_balance or Decimal("0")) - grand_total
        )

    elif payload.disposition == 'cash_refund' and customer:
        db.add(models.ArLedger(
            customer_id=customer.customer_id,
            amount_change=-grand_total,
            reason="RETURN",
            reference_type="sales_returns",
            reference_id=ref_id,
        ))
        customer.outstanding_balance = (
            (customer.outstanding_balance or Decimal("0")) - grand_total
        )

    if payload.disposition == 'cash_refund' and payload.sale_id is not None:
        largest_tender_row = (
            db.query(models.CustomerPayment.payment_mode_id)
            .join(models.CustomerPaymentApplied,
                  models.CustomerPayment.payment_id == models.CustomerPaymentApplied.payment_id)
            .join(models.PaymentMode,
                  models.CustomerPayment.payment_mode_id == models.PaymentMode.payment_mode_id)
            .filter(
                models.CustomerPaymentApplied.sale_id == payload.sale_id,
                models.PaymentMode.is_ar_charge == False,
                models.PaymentMode.is_ar_credit == False,
            )
            .order_by(models.CustomerPaymentApplied.amount_applied.desc())
            .first()
        )
        if largest_tender_row is not None:
            neg_payment = models.CustomerPayment(
                customer_id=sales_return.customer_id,
                payment_mode_id=largest_tender_row.payment_mode_id,
                amount=-grand_total,
                payment_date=datetime(
                    resolved_return_date.year,
                    resolved_return_date.month,
                    resolved_return_date.day,
                ),
                notes=f"Cash refund for return #{sales_return.return_id}",
                unapplied_amount=Decimal("0"),
            )
            db.add(neg_payment)
            db.flush()
            db.add(models.CustomerPaymentApplied(
                payment_id=neg_payment.payment_id,
                sale_id=payload.sale_id,
                amount_applied=-grand_total,
            ))

    return sales_return


@router.post("/returns/exchange", response_model=schemas.ExchangeResult, status_code=201)
def create_return_and_exchange(
    payload: schemas.SalesReturnCreate,
    register_id:  Optional[int] = None,
    shift_id:     Optional[int] = None,
    employee_id:  Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: AuthUser = Depends(require_permission("process_returns")),
):
    """Process a return and atomically create a linked exchange Draft sale.

    The return is created with the same mechanics as POST /returns.
    The exchange draft carries origin_sale_id = original sale_id, inherits
    customer_id and location_id, and is pre-populated with a Store Credit
    tender equal to the return value (via idempotency_key encoded reference).
    Returns { sales_return, exchange_draft }.
    """
    if not payload.sale_id:
        raise HTTPException(status_code=400, detail="sale_id is required for exchange flow")

    # Guard: only one active exchange per original sale
    existing = (
        db.query(models.Sale.sale_id)
        .filter(
            models.Sale.origin_sale_id == payload.sale_id,
            models.Sale.status != "Voided",
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="An exchange sale already exists for this sale")

    sales_return = _do_return(payload, current_user, db)

    # Load original sale for exchange defaults
    orig_sale = db.query(models.Sale).filter(
        models.Sale.sale_id == payload.sale_id
    ).first()

    exchange = models.Sale(
        transaction_date=_ph_today(),
        location_id=orig_sale.location_id,
        customer_id=orig_sale.customer_id,
        employee_id=employee_id,
        register_id=register_id,
        shift_id=shift_id,
        origin_sale_id=payload.sale_id,
        status="Draft",
        subtotal_amount=Decimal("0"),
        discount_amount=Decimal("0"),
        tax_amount=Decimal("0"),
        grand_total=Decimal("0"),
        balance_due=Decimal("0"),
    )
    db.add(exchange)
    db.flush()

    db.commit()

    ret_loaded = _load_return(sales_return.return_id, db)
    write_audit(db, "sales.sales_returns", str(sales_return.return_id), "INSERT",
                actor_user_id=current_user.user_id, new_values=_serialize(ret_loaded))
    db.commit()

    exc_loaded = _load_sale(exchange.sale_id, db)
    out = schemas.SaleOut.model_validate(exc_loaded)
    out.items = []
    out.payments = []

    return schemas.ExchangeResult(sales_return=ret_loaded, exchange_draft=out)


@router.post("/returns", response_model=schemas.SalesReturnOut, status_code=201)
def create_return(
    payload: schemas.SalesReturnCreate,
    db: Session = Depends(get_db),
    current_user: AuthUser = Depends(require_permission("process_returns")),
):
    """Create a sales return (return-only, no exchange draft).

    For linked returns (sale_id provided): location defaults to the original
    sale's location; each item may reference the exact SaleItem row for precise
    FIFO layer restoration.
    For blind returns (no sale_id): location_id is required and the caller must
    hold the process_blind_returns permission.
    """
    sales_return = _do_return(payload, current_user, db)
    db.commit()
    ret_loaded = _load_return(sales_return.return_id, db)
    write_audit(db, "sales.sales_returns", str(sales_return.return_id), "INSERT",
                actor_user_id=current_user.user_id, new_values=_serialize(ret_loaded))
    db.commit()
    return ret_loaded


@router.get("/returns", response_model=List[schemas.SalesReturnOut])
def list_returns(
    sale_id:     Optional[int] = None,
    customer_id: Optional[int] = None,
    location_id: Optional[int] = None,
    date_from:   Optional[datetime] = None,
    date_to:     Optional[datetime] = None,
    search:      Optional[str] = None,
    has_exchange: bool = False,
    limit:       int = 100,
    cursor:      Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List sales returns, newest first."""
    q = (
        db.query(models.SalesReturn)
        .options(
            selectinload(models.SalesReturn.items)
                .selectinload(models.SalesReturnItem.variant),
        )
        .order_by(models.SalesReturn.return_id.desc())
    )
    if sale_id is not None:
        q = q.filter(models.SalesReturn.sale_id == sale_id)
    if customer_id is not None:
        q = q.filter(models.SalesReturn.customer_id == customer_id)
    if location_id is not None:
        q = q.filter(models.SalesReturn.location_id == location_id)
    if date_from is not None:
        q = q.filter(models.SalesReturn.return_date >= date_from)
    if date_to is not None:
        q = q.filter(models.SalesReturn.return_date <= date_to)
    if search:
        q = q.filter(models.SalesReturn.return_pid.ilike(f"%{normalize_search(search)}%"))
    if has_exchange:
        exchange_sale_ids_sq = (
            db.query(models.Sale.origin_sale_id)
            .filter(
                models.Sale.origin_sale_id.isnot(None),
                models.Sale.status != "Voided",
            )
            .subquery()
        )
        q = q.filter(models.SalesReturn.sale_id.in_(exchange_sale_ids_sq))
    if cursor is not None:
        q = q.filter(models.SalesReturn.return_id < cursor)

    rows = q.limit(limit).all()
    for ret in rows:
        _attach_exchange(ret, db)
    return rows


@router.get("/returns/{return_id}", response_model=schemas.SalesReturnOut)
def get_return(return_id: int, db: Session = Depends(get_db)):
    """Get a single sales return with its line items and exchange_sale_pid."""
    return _load_return(return_id, db)


@router.get("/sale/{sale_id}/items-for-return", response_model=List[schemas.SaleItemOut])
def get_items_for_return(sale_id: int, db: Session = Depends(get_db)):
    """Return collapsed sale_items for a Posted sale, annotated with already-returned quantities.

    Used by the Return New page to pre-populate the return form.
    Returns items with an extra 'already_returned' field attached.
    """
    sale = db.query(models.Sale).filter(
        models.Sale.sale_id == sale_id,
        models.Sale.status == "Posted",
    ).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found or not Posted")

    items = (
        db.query(models.SaleItem)
        .options(selectinload(models.SaleItem.variant))
        .filter(models.SaleItem.sale_id == sale_id)
        .all()
    )

    # Compute already-returned qty per variant from prior returns
    from sqlalchemy import text
    already_ret = db.execute(text("""
        SELECT sri.variant_id, COALESCE(SUM(sri.quantity), 0) AS returned_qty
        FROM sales.sales_return_items sri
        JOIN sales.sales_returns sr ON sr.return_id = sri.return_id
        WHERE sr.sale_id = :sale_id
        GROUP BY sri.variant_id
    """), {"sale_id": sale_id}).fetchall()
    ret_map = {r.variant_id: r.returned_qty for r in already_ret}

    collapsed = _collapse_items(items)
    # Attach already_returned to each item
    for item in collapsed:
        item.already_returned = float(ret_map.get(item.variant_id, 0))
    return collapsed


# ═══════════════════════════════════════════════════════════════════════════════
# SALES SUMMARY — dashboard metrics, same filters as list_sales
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/summary", response_model=schemas.SalesSummaryResponse)
def get_sales_summary(
    date_from:      Optional[datetime] = None,
    date_to:        Optional[datetime] = None,
    location_id:    Optional[int]      = None,
    shift_id:       Optional[int]      = None,
    register_id:    Optional[int]      = None,
    employee_id:    Optional[int]      = None,
    customer_id:    Optional[int]      = None,
    status:         Optional[str]      = None,
    db: Session = Depends(get_db),
):
    """Compute revenue and profit dashboard metrics for the filtered sale scope."""
    status_list = [status] if status else ["Posted"]

    zero = Decimal("0")

    # ── 1. Base sale IDs for the filter scope ─────────────────────────────────
    base_q = (
        db.query(models.Sale.sale_id)
        .filter(models.Sale.status.in_(status_list))
    )
    txn_date_from = date_from.date() if date_from else None
    txn_date_to = date_to.date() if date_to else None
    if txn_date_from is not None: base_q = base_q.filter(models.Sale.transaction_date >= txn_date_from)
    if txn_date_to is not None:   base_q = base_q.filter(models.Sale.transaction_date <= txn_date_to)
    if location_id:   base_q = base_q.filter(models.Sale.location_id == location_id)
    if shift_id:      base_q = base_q.filter(models.Sale.shift_id == shift_id)
    if register_id:   base_q = base_q.filter(models.Sale.register_id == register_id)
    if employee_id:   base_q = base_q.filter(models.Sale.employee_id == employee_id)
    if customer_id:   base_q = base_q.filter(models.Sale.customer_id == customer_id)

    base_sale_ids = [r.sale_id for r in base_q.all()]

    # ── Returns total — filtered by return_date window ────────────────────────
    # Computed before the early-return so that a date window containing returns
    # but no Posted sales still reports the correct returns figure.
    ret_q = db.query(
        func.coalesce(func.sum(models.SalesReturn.grand_total), zero)
    )
    if txn_date_from is not None:
        ret_q = ret_q.filter(models.SalesReturn.return_date >= txn_date_from)
    if txn_date_to is not None:
        ret_q = ret_q.filter(models.SalesReturn.return_date <= txn_date_to)
    if location_id:
        ret_q = ret_q.filter(models.SalesReturn.location_id == location_id)
    if customer_id:
        ret_q = ret_q.filter(models.SalesReturn.customer_id == customer_id)
    returns_total = ret_q.scalar() or zero

    # ── Cash refund total — for Collections display deduction ─────────────────
    refund_q = db.query(
        func.coalesce(func.sum(models.SalesReturn.grand_total), zero)
    ).filter(models.SalesReturn.disposition == 'cash_refund')
    if txn_date_from is not None:
        refund_q = refund_q.filter(models.SalesReturn.return_date >= txn_date_from)
    if txn_date_to is not None:
        refund_q = refund_q.filter(models.SalesReturn.return_date <= txn_date_to)
    if location_id:
        refund_q = refund_q.filter(models.SalesReturn.location_id == location_id)
    if customer_id:
        refund_q = refund_q.filter(models.SalesReturn.customer_id == customer_id)
    cash_refunds_total = refund_q.scalar() or zero

    if not base_sale_ids:
        return schemas.SalesSummaryResponse(
            merchandise_gross=zero, cart_discounts=zero,
            non_merchandise_revenue=zero, variances=zero, returns_total=returns_total,
            cash_refunds_total=cash_refunds_total,
            total_revenue=-returns_total, gross_profit=zero, uncosted_revenue=zero,
            collections=[], total_physical=zero, total_virtual=zero, total_collected=zero,
        )

    # ── 2. Merchandise gross, cart discounts, variances ───────────────────────
    agg = db.query(
        func.coalesce(func.sum(models.Sale.merchandise_subtotal), zero),
        func.coalesce(func.sum(models.Sale.discount_amount),      zero),
        func.coalesce(func.sum(models.Sale.audit_variance),       zero),
    ).filter(models.Sale.sale_id.in_(base_sale_ids)).first()

    merchandise_gross = agg[0] or zero
    cart_discounts    = agg[1] or zero
    variances_sum     = agg[2] or zero

    # ── 3. Non-merchandise revenue (Service + Non-Inventory line items) ───────
    non_merch = db.query(
        func.coalesce(func.sum(models.SaleItem.line_total), zero)
    ).join(
        inv_models.Variant,
        models.SaleItem.variant_id == inv_models.Variant.variant_id,
    ).join(
        inv_models.Product,
        inv_models.Variant.product_id == inv_models.Product.product_id,
    ).filter(
        models.SaleItem.sale_id.in_(base_sale_ids),
        inv_models.Product.product_type.in_(["Service", "Non-Inventory"]),
    ).scalar() or zero

    # ── 4. Total revenue ───────────────────────────────────────────────────────
    total_revenue = merchandise_gross - returns_total - cart_discounts + non_merch + variances_sum

    # ── 5. Sale IDs that contain at least one uncosted item ───────────────────
    uncosted_sq = (
        db.query(models.SaleItem.sale_id)
        .filter(
            models.SaleItem.sale_id.in_(base_sale_ids),
            models.SaleItem.cost_source == "none",
        )
        .distinct()
        .subquery()
    )

    # ── 7. Gross profit — fully costed sales only ─────────────────────────────
    gross_profit = db.query(
        func.coalesce(
            func.sum(
                models.SaleItem.line_total
                - func.coalesce(models.SaleItem.net_unit_cost, zero)
                  * models.SaleItem.quantity
            ),
            zero,
        )
    ).filter(
        models.SaleItem.sale_id.in_(base_sale_ids),
        ~models.SaleItem.sale_id.in_(uncosted_sq),
        models.SaleItem.cost_source.in_(["fifo", "supplier_list"]),
    ).scalar() or zero

    # ── 8. Uncosted revenue — revenue from sales with missing cost data ───────
    uncosted_revenue = db.query(
        func.coalesce(func.sum(models.Sale.grand_total), zero)
    ).filter(
        models.Sale.sale_id.in_(uncosted_sq),
    ).scalar() or zero

    # ── 9. Collections — per payment mode breakdown ───────────────────────────
    from sqlalchemy import text as sa_text
    coll_rows = db.execute(sa_text("""
        SELECT pm.name, pm.is_physical, COALESCE(SUM(cpa.amount_applied), 0) AS amount
        FROM sales.customer_payment_applied cpa
        JOIN sales.customer_payments cp ON cp.payment_id = cpa.payment_id
        JOIN sales.payment_modes pm ON pm.payment_mode_id = cp.payment_mode_id
        WHERE cpa.sale_id = ANY(:sale_ids)
        GROUP BY pm.payment_mode_id, pm.name, pm.is_physical
        ORDER BY SUM(cpa.amount_applied) DESC
    """), {"sale_ids": base_sale_ids}).fetchall()

    collections = [
        schemas.CollectionEntry(
            payment_mode=r.name,
            amount=Decimal(str(r.amount)),
            is_physical=r.is_physical,
        )
        for r in coll_rows
    ]
    total_physical  = sum(Decimal(str(r.amount)) for r in coll_rows if r.is_physical)
    total_virtual   = sum(Decimal(str(r.amount)) for r in coll_rows if not r.is_physical)
    total_collected = total_physical + total_virtual

    return schemas.SalesSummaryResponse(
        merchandise_gross=merchandise_gross,
        cart_discounts=cart_discounts,
        non_merchandise_revenue=non_merch,
        variances=variances_sum,
        returns_total=returns_total,
        cash_refunds_total=cash_refunds_total,
        total_revenue=total_revenue,
        gross_profit=gross_profit,
        uncosted_revenue=uncosted_revenue,
        collections=collections,
        total_physical=total_physical,
        total_virtual=total_virtual,
        total_collected=total_collected,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# NEXT PID
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/next-pid")
def get_next_pid(db: Session = Depends(get_db)):
    """Return the next sale PID based on the highest existing SALE-NNNNN value."""
    from sqlalchemy import text
    row = db.execute(text("""
        SELECT MAX(CAST(SUBSTRING(sale_pid FROM 6) AS INTEGER))
        FROM sales.sales
        WHERE sale_pid ~ '^SALE-[0-9]+$'
    """)).scalar()
    n = (row or 0) + 1
    return {"next_pid": f"SALE-{n:05d}"}


# ═══════════════════════════════════════════════════════════════════════════════
# CREDIT MEMOS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/credit-memos/validate", response_model=schemas.CreditMemoValidateOut)
def validate_credit_memo(
    code: str = Query(..., description="Memo code to validate"),
    db: Session = Depends(get_db),
):
    today = schemas._ph_today()
    memo = (
        db.query(models.CreditMemo)
        .filter(models.CreditMemo.code == code)
        .first()
    )
    if not memo:
        return schemas.CreditMemoValidateOut(code=code, is_valid=False,
                                             invalid_reason="NOT_FOUND")
    if memo.status == "REDEEMED":
        return schemas.CreditMemoValidateOut(
            memo_id=memo.memo_id, code=code, amount=memo.amount,
            valid_until=memo.valid_until, status=memo.status,
            is_valid=False, invalid_reason="REDEEMED",
        )
    if memo.status == "CANCELLED":
        return schemas.CreditMemoValidateOut(
            memo_id=memo.memo_id, code=code, amount=memo.amount,
            valid_until=memo.valid_until, status=memo.status,
            is_valid=False, invalid_reason="CANCELLED",
        )
    if memo.valid_until < today:
        return schemas.CreditMemoValidateOut(
            memo_id=memo.memo_id, code=code, amount=memo.amount,
            valid_until=memo.valid_until, status=memo.status,
            is_valid=False, invalid_reason="EXPIRED",
        )
    return schemas.CreditMemoValidateOut(
        memo_id=memo.memo_id, code=code, amount=memo.amount,
        valid_until=memo.valid_until, status="ACTIVE",
        is_valid=True, invalid_reason=None,
    )


@router.get("/credit-memos", response_model=List[schemas.CreditMemoListOut])
def list_credit_memos(
    keyword: Optional[str] = Query(None),
    status: Optional[List[str]] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    issued_by_user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    q = db.query(models.CreditMemo)
    if keyword:
        kw = f"%{normalize_search(keyword)}%"
        q = q.filter(
            models.CreditMemo.code.ilike(kw)
            | models.CreditMemo.notes.ilike(kw)
        )
    if status:
        q = q.filter(models.CreditMemo.status.in_(status))
    if date_from:
        q = q.filter(models.CreditMemo.issued_at >= date_from)
    if date_to:
        q = q.filter(models.CreditMemo.issued_at <= date_to)
    if issued_by_user_id:
        q = q.filter(models.CreditMemo.issued_by_user_id == issued_by_user_id)

    memos = q.order_by(models.CreditMemo.issued_at.desc(),
                       models.CreditMemo.memo_id.desc()).all()

    # Batch-fetch redemption sale_ids in one query
    memo_ids = [m.memo_id for m in memos]
    redemption_map: dict[int, int] = {}
    if memo_ids:
        redemption_map = dict(
            db.query(
                models.CreditMemoRedemption.memo_id,
                models.CreditMemoRedemption.sale_id,
            )
            .filter(models.CreditMemoRedemption.memo_id.in_(memo_ids))
            .all()
        )

    result = []
    for m in memos:
        return_pid = None
        if m.return_id and m.sales_return:
            return_pid = m.sales_return.return_pid
        issued_by_name = None
        if m.issued_by:
            issued_by_name = getattr(m.issued_by, "full_name", None) or getattr(m.issued_by, "username", None)
        result.append(schemas.CreditMemoListOut(
            memo_id=m.memo_id,
            code=m.code,
            amount=m.amount,
            status=m.status,
            issued_at=m.issued_at,
            valid_until=m.valid_until,
            issued_by_user_id=m.issued_by_user_id,
            issued_by_name=issued_by_name,
            return_id=m.return_id,
            return_pid=return_pid,
            notes=m.notes,
            redeemed_sale_id=redemption_map.get(m.memo_id),
        ))
    return result


@router.post("/credit-memos", response_model=schemas.CreditMemoOut, status_code=201)
def issue_credit_memo(
    payload: schemas.CreditMemoCreate,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    today = schemas._ph_today()
    valid_until = payload.valid_until or (today + timedelta(days=30))
    if valid_until <= today:
        raise HTTPException(status_code=400, detail="valid_until must be in the future")

    code = _generate_memo_code(db)
    memo = models.CreditMemo(
        code=code,
        amount=payload.amount,
        status="ACTIVE",
        issued_at=today,
        valid_until=valid_until,
        issued_by_user_id=_actor.user_id,
        return_id=payload.return_id,
        notes=payload.notes,
    )
    db.add(memo)
    db.commit()
    db.refresh(memo)

    issued_by_name = None
    if memo.issued_by:
        issued_by_name = getattr(memo.issued_by, "full_name", None) or getattr(memo.issued_by, "username", None)
    return schemas.CreditMemoOut(
        memo_id=memo.memo_id,
        code=memo.code,
        amount=memo.amount,
        status=memo.status,
        issued_at=memo.issued_at,
        valid_until=memo.valid_until,
        issued_by_user_id=memo.issued_by_user_id,
        issued_by_name=issued_by_name,
        return_id=memo.return_id,
        return_pid=None,
        notes=memo.notes,
        cancelled_by_user_id=None,
        cancelled_at=None,
        redemptions=[],
    )


@router.get("/credit-memos/{memo_id}", response_model=schemas.CreditMemoOut)
def get_credit_memo(
    memo_id: int,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    memo = (
        db.query(models.CreditMemo)
        .options(selectinload(models.CreditMemo.redemptions))
        .filter(models.CreditMemo.memo_id == memo_id)
        .first()
    )
    if not memo:
        raise HTTPException(status_code=404, detail="Credit memo not found")

    return_pid = None
    if memo.return_id and memo.sales_return:
        return_pid = memo.sales_return.return_pid
    issued_by_name = None
    if memo.issued_by:
        issued_by_name = getattr(memo.issued_by, "full_name", None) or getattr(memo.issued_by, "username", None)
    return schemas.CreditMemoOut(
        memo_id=memo.memo_id,
        code=memo.code,
        amount=memo.amount,
        status=memo.status,
        issued_at=memo.issued_at,
        valid_until=memo.valid_until,
        issued_by_user_id=memo.issued_by_user_id,
        issued_by_name=issued_by_name,
        return_id=memo.return_id,
        return_pid=return_pid,
        notes=memo.notes,
        cancelled_by_user_id=memo.cancelled_by_user_id,
        cancelled_at=memo.cancelled_at,
        redemptions=[schemas.CreditMemoRedemptionOut.model_validate(r)
                     for r in memo.redemptions],
    )


@router.post("/credit-memos/{memo_id}/cancel", response_model=schemas.CreditMemoOut)
def cancel_credit_memo(
    memo_id: int,
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
):
    memo = (
        db.query(models.CreditMemo)
        .filter(models.CreditMemo.memo_id == memo_id)
        .with_for_update()
        .first()
    )
    if not memo:
        raise HTTPException(status_code=404, detail="Credit memo not found")
    if memo.status != "ACTIVE":
        raise HTTPException(
            status_code=400,
            detail=f"Only ACTIVE memos can be cancelled (current status: {memo.status})",
        )
    now = datetime.now(timezone.utc)
    memo.status = "CANCELLED"
    memo.cancelled_by_user_id = _actor.user_id
    memo.cancelled_at = now
    db.commit()
    db.refresh(memo)

    issued_by_name = None
    if memo.issued_by:
        issued_by_name = getattr(memo.issued_by, "full_name", None) or getattr(memo.issued_by, "username", None)
    return schemas.CreditMemoOut(
        memo_id=memo.memo_id,
        code=memo.code,
        amount=memo.amount,
        status=memo.status,
        issued_at=memo.issued_at,
        valid_until=memo.valid_until,
        issued_by_user_id=memo.issued_by_user_id,
        issued_by_name=issued_by_name,
        return_id=memo.return_id,
        return_pid=None,
        notes=memo.notes,
        cancelled_by_user_id=memo.cancelled_by_user_id,
        cancelled_at=memo.cancelled_at,
        redemptions=[],
    )


# ═══════════════════════════════════════════════════════════════════════════════
# GET SINGLE SALE  — registered last so all static routes match first
# (GET /payments, GET /returns, etc. must not be caught by this wildcard)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{sale_id}", response_model=schemas.SaleOut)
def get_sale(sale_id: int, db: Session = Depends(get_db)):
    """Return a single sale with line items collapsed to one display row per variant."""
    loaded = _load_sale(sale_id, db)
    out = schemas.SaleOut.model_validate(loaded)
    out.items = _collapse_items(loaded.items)
    # payments already attached by _load_sale
    return out
