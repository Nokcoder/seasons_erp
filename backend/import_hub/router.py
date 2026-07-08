# import_hub/router.py
from __future__ import annotations
import io
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from typing import List, Optional

import xlsxwriter
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import get_current_user, require_permission
from auth.models import User
from inventory import models as inv_models
from sales import models as sales_models
from import_hub import schemas

router = APIRouter(
    prefix="/import",
    tags=["Import"],
    dependencies=[Depends(get_current_user)],
)

# ── helpers ───────────────────────────────────────────────────────────────────

def _blank(v: Optional[str]) -> bool:
    return v is None or str(v).strip() == ""

def _dec(v: Optional[str]) -> Optional[Decimal]:
    if _blank(v):
        return None
    try:
        return Decimal(str(v).strip())
    except InvalidOperation:
        return None

def _int_val(v: Optional[str]) -> Optional[int]:
    if _blank(v):
        return None
    try:
        return int(str(v).strip())
    except (ValueError, TypeError):
        return None

def _truthy(v: Optional[str]) -> bool:
    return str(v or "").strip().lower() in ("true", "yes", "1")

def _xlsx_response(wb_func, filename: str) -> StreamingResponse:
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {"in_memory": True})
    wb_func(wb)
    wb.close()
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

def _write_template(wb: xlsxwriter.Workbook, sheet_name: str,
                    headers: List[str], sample: List) -> None:
    ws  = wb.add_worksheet(sheet_name)
    hdr = wb.add_format({"bold": True, "bg_color": "#1f2937", "font_color": "#f3f4f6",
                          "border": 1, "border_color": "#374151"})
    smp = wb.add_format({"font_color": "#9ca3af", "italic": True})
    for i, h in enumerate(headers):
        ws.write(0, i, h, hdr)
        ws.set_column(i, i, max(len(h) + 4, 16))
    for i, v in enumerate(sample):
        ws.write(1, i, v, smp)


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/customers/template")
def customer_template():
    def build(wb):
        _write_template(wb, "Customers",
            ["customer_name", "credit_limit", "terms_days"],
            ["Acme Corporation", "50000", "30"])
    return _xlsx_response(build, "customers_import_template.xlsx")


@router.post("/customers/preview", response_model=schemas.ImportPreviewResponse)
def customer_preview(
    payload: schemas.CustomerPreviewRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_customers")),
):
    valid, errors = [], []
    creates = updates = noops = 0

    for row in payload.rows:
        anchor = row.customer_name.strip() if row.customer_name else ""
        if not anchor:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor="", error="customer_name is required"))
            continue

        existing = db.query(sales_models.Customer).filter(
            sales_models.Customer.customer_name.ilike(anchor),
            sales_models.Customer.is_deleted == False,
        ).first()

        new_credit = None
        clear_credit = _truthy(row.credit_limit) is False and str(row.credit_limit or "").strip().lower() == "no limit"
        if not clear_credit and not _blank(row.credit_limit):
            new_credit = _dec(row.credit_limit)
            if new_credit is None:
                errors.append(schemas.ImportErrorRow(
                    row_number=row.row_number, anchor=anchor,
                    error=f"credit_limit '{row.credit_limit}' is not a valid number"))
                continue

        new_terms = _int_val(row.terms_days)

        if existing:
            old = {"credit_limit": str(existing.credit_limit) if existing.credit_limit is not None else None,
                   "terms_days": existing.terms_days}
            nv: dict = {}
            diff: list = []
            if clear_credit and existing.credit_limit is not None:
                nv["credit_limit"] = None; diff.append("credit_limit")
            elif new_credit is not None and new_credit != existing.credit_limit:
                nv["credit_limit"] = str(new_credit); diff.append("credit_limit")
            if new_terms is not None and new_terms != existing.terms_days:
                nv["terms_days"] = new_terms; diff.append("terms_days")
            if not nv:
                noops += 1
                valid.append(schemas.ImportDiffRow(
                    row_number=row.row_number, anchor=anchor, mode="noop",
                    old_values=old, new_values=old, diff_fields=[]))
            else:
                updates += 1
                valid.append(schemas.ImportDiffRow(
                    row_number=row.row_number, anchor=anchor, mode="update",
                    old_values=old, new_values={**old, **nv}, diff_fields=diff))
        else:
            creates += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="create",
                old_values=None,
                new_values={"customer_name": anchor,
                            "credit_limit": str(new_credit) if new_credit else None,
                            "terms_days": new_terms if new_terms is not None else 0},
                diff_fields=[]))

    return schemas.ImportPreviewResponse(
        valid_rows=valid, error_rows=errors,
        summary=schemas.ImportSummary(creates=creates, updates=updates,
                                      noops=noops, errors=len(errors)))


@router.post("/customers/confirm", response_model=schemas.ImportConfirmResponse)
def customer_confirm(
    payload: schemas.CustomerConfirmRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_customers")),
):
    written = skipped = 0
    errors = []

    anchor_set = set(payload.confirmed_anchors)
    for row in payload.rows:
        anchor = (row.customer_name or "").strip()
        if anchor not in anchor_set:
            skipped += 1
            continue
        try:
            existing = db.query(sales_models.Customer).filter(
                sales_models.Customer.customer_name.ilike(anchor),
                sales_models.Customer.is_deleted == False,
            ).first()
            clear_credit = str(row.credit_limit or "").strip().lower() == "no limit"
            new_credit = None if clear_credit else _dec(row.credit_limit)
            new_terms  = _int_val(row.terms_days)

            if existing:
                if clear_credit:
                    existing.credit_limit = None
                elif new_credit is not None:
                    existing.credit_limit = new_credit
                if new_terms is not None:
                    existing.terms_days = new_terms
            else:
                db.add(sales_models.Customer(
                    customer_name=anchor,
                    credit_limit=new_credit,
                    terms_days=new_terms if new_terms is not None else 0,
                    outstanding_balance=Decimal("0"),
                    is_deleted=False,
                ))
            written += 1
        except Exception as e:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error=str(e)))

    db.commit()
    return schemas.ImportConfirmResponse(written=written, skipped=skipped, errors=errors)


# ═══════════════════════════════════════════════════════════════════════════════
# SUPPLIERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/suppliers/template")
def supplier_template():
    def build(wb):
        _write_template(wb, "Suppliers",
            ["supplier_code", "supplier_name", "terms", "bank_account_name",
             "contact_person", "phone", "email", "address"],
            ["SUP-001", "Acme Supplies Ltd", "30", "Acme Bank Account",
             "Jane Smith", "+63 912 345 6789", "jane@acme.com", "123 Main St"])
    return _xlsx_response(build, "suppliers_import_template.xlsx")


@router.post("/suppliers/preview", response_model=schemas.ImportPreviewResponse)
def supplier_preview(
    payload: schemas.SupplierPreviewRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_suppliers")),
):
    valid, errors = [], []
    creates = updates = noops = 0

    for row in payload.rows:
        anchor = (row.supplier_code or "").strip()
        if not anchor:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor="", error="supplier_code is required"))
            continue

        existing = db.query(inv_models.Supplier).filter(
            inv_models.Supplier.supplier_code == anchor,
            inv_models.Supplier.is_deleted == False,
        ).first()

        if not existing and _blank(row.supplier_name):
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error="supplier_name is required when creating a new supplier"))
            continue

        new_terms = _int_val(row.terms)

        if existing:
            old = {"supplier_name": existing.supplier_name,
                   "terms": existing.terms,
                   "bank_account_name": existing.bank_account_name}
            nv = {}
            diff = []
            for field, new_val in [
                ("supplier_name", row.supplier_name),
                ("terms", str(new_terms) if new_terms is not None else None),
                ("bank_account_name", row.bank_account_name),
                ("contact_person", row.contact_person),
                ("phone", row.phone),
                ("email", row.email),
                ("address", row.address),
            ]:
                if _blank(new_val):
                    continue
                old_val = getattr(existing, field)
                display_old = str(old_val) if old_val is not None else None
                display_new = new_val.strip() if isinstance(new_val, str) else new_val
                if display_new != display_old:
                    nv[field] = display_new
                    diff.append(field)

            if not nv:
                noops += 1
                valid.append(schemas.ImportDiffRow(
                    row_number=row.row_number, anchor=anchor, mode="noop",
                    old_values=old, new_values=old, diff_fields=[]))
            else:
                updates += 1
                valid.append(schemas.ImportDiffRow(
                    row_number=row.row_number, anchor=anchor, mode="update",
                    old_values=old, new_values={**old, **nv}, diff_fields=diff))
        else:
            creates += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="create",
                old_values=None,
                new_values={"supplier_code": anchor,
                            "supplier_name": (row.supplier_name or "").strip(),
                            "terms": new_terms or 0},
                diff_fields=[]))

    return schemas.ImportPreviewResponse(
        valid_rows=valid, error_rows=errors,
        summary=schemas.ImportSummary(creates=creates, updates=updates,
                                      noops=noops, errors=len(errors)))


@router.post("/suppliers/confirm", response_model=schemas.ImportConfirmResponse)
def supplier_confirm(
    payload: schemas.SupplierConfirmRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_suppliers")),
):
    written = skipped = 0
    errors = []
    anchor_set = set(payload.confirmed_anchors)

    for row in payload.rows:
        anchor = (row.supplier_code or "").strip()
        if anchor not in anchor_set:
            skipped += 1
            continue
        try:
            existing = db.query(inv_models.Supplier).filter(
                inv_models.Supplier.supplier_code == anchor,
            ).first()
            new_terms = _int_val(row.terms)

            if existing:
                for attr, val in [
                    ("supplier_name", row.supplier_name),
                    ("bank_account_name", row.bank_account_name),
                    ("contact_person", row.contact_person),
                    ("phone", row.phone),
                    ("email", row.email),
                    ("address", row.address),
                ]:
                    if not _blank(val):
                        setattr(existing, attr, val.strip())
                if new_terms is not None:
                    existing.terms = new_terms
            else:
                db.add(inv_models.Supplier(
                    supplier_code=anchor,
                    supplier_name=(row.supplier_name or "").strip(),
                    terms=new_terms or 0,
                    bank_account_name=row.bank_account_name or None,
                    contact_person=row.contact_person or None,
                    phone=row.phone or None,
                    email=row.email or None,
                    address=row.address or None,
                    is_deleted=False,
                ))
            written += 1
        except Exception as e:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error=str(e)))

    db.commit()
    return schemas.ImportConfirmResponse(written=written, skipped=skipped, errors=errors)


# ═══════════════════════════════════════════════════════════════════════════════
# OPENING STOCK BALANCES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/stock-balances/template")
def stock_template():
    def build(wb):
        _write_template(wb, "Stock Balances",
            ["PID", "location_name", "quantity", "notes"],
            ["WID-001", "Atrium", "100", "Opening balance"])
    return _xlsx_response(build, "stock_balances_import_template.xlsx")


@router.post("/stock-balances/preview", response_model=schemas.ImportPreviewResponse)
def stock_preview(
    payload: schemas.StockBalancePreviewRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    valid, errors = [], []
    creates = updates = noops = 0

    for row in payload.rows:
        anchor = f"{row.PID}|{row.location_name}"
        pid = (row.PID or "").strip()
        loc_name = (row.location_name or "").strip()

        if not pid:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error="PID is required"))
            continue
        if not loc_name:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error="location_name is required"))
            continue

        qty = _dec(row.quantity)
        if qty is None or qty < 0:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"quantity '{row.quantity}' is not a valid non-negative number"))
            continue

        variant = db.query(inv_models.Variant).filter(
            inv_models.Variant.PID == pid,
            inv_models.Variant.is_deleted == False,
        ).first()
        if not variant:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"PID '{pid}' not found"))
            continue
        if variant.product.product_type in ("Non-Inventory", "Service"):
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"'{pid}' is a Non-Inventory/Service variant — no stock tracking"))
            continue
        if variant.bundle_components:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"'{pid}' is a bundle variant — bundles hold no physical stock"))
            continue

        location = db.query(inv_models.Location).filter(
            inv_models.Location.location_name.ilike(loc_name),
            inv_models.Location.is_deleted == False,
            inv_models.Location.status == "Active",
        ).first()
        if not location:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"Location '{loc_name}' not found or inactive"))
            continue
        if location.location_type == "Virtual":
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"'{loc_name}' is a virtual location — cannot set stock directly"))
            continue

        cs = db.query(inv_models.CurrentStock).filter_by(
            variant_id=variant.variant_id, location_id=location.location_id
        ).first()
        current_qty = cs.quantity if cs else Decimal("0")
        delta = qty - current_qty

        if delta == 0:
            noops += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="noop",
                old_values={"quantity": str(current_qty)},
                new_values={"quantity": str(qty)},
                diff_fields=[]))
        else:
            updates += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="update",
                old_values={"quantity": str(current_qty)},
                new_values={"quantity": str(qty), "delta": str(delta)},
                diff_fields=["quantity"]))

    return schemas.ImportPreviewResponse(
        valid_rows=valid, error_rows=errors,
        summary=schemas.ImportSummary(creates=creates, updates=updates,
                                      noops=noops, errors=len(errors)))


@router.post("/stock-balances/confirm", response_model=schemas.ImportConfirmResponse)
def stock_confirm(
    payload: schemas.StockBalanceConfirmRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    written = skipped = 0
    errors = []
    anchor_set = set(payload.confirmed_anchors)

    for row in payload.rows:
        anchor = f"{(row.PID or '').strip()}|{(row.location_name or '').strip()}"
        if anchor not in anchor_set:
            skipped += 1
            continue
        try:
            pid = row.PID.strip()
            loc_name = row.location_name.strip()
            qty = _dec(row.quantity)
            if qty is None:
                raise ValueError(f"Invalid quantity: {row.quantity}")

            variant = db.query(inv_models.Variant).filter_by(PID=pid).first()
            location = db.query(inv_models.Location).filter(
                inv_models.Location.location_name.ilike(loc_name)
            ).first()
            if not variant or not location:
                raise ValueError("Variant or location not found")

            cs = db.query(inv_models.CurrentStock).filter_by(
                variant_id=variant.variant_id, location_id=location.location_id
            ).first()
            current_qty = cs.quantity if cs else Decimal("0")
            delta = qty - current_qty

            if delta == 0:
                skipped += 1
                continue

            # Write ADJUST ledger entry
            notes_suffix = f" — {row.notes.strip()}" if row.notes and row.notes.strip() else ""
            db.add(inv_models.InventoryLedger(
                variant_id=variant.variant_id,
                location_id=location.location_id,
                qty_change=delta,
                reason=inv_models.LedgerReason.ADJUST,
                reference_type="bulk_import",
                reference_id=f"stock_balance{notes_suffix}",
            ))

            # Upsert current_stocks
            tbl = inv_models.CurrentStock.__table__
            stmt = (
                pg_insert(tbl)
                .values(variant_id=variant.variant_id,
                        location_id=location.location_id, quantity=qty)
                .on_conflict_do_update(
                    constraint="uq_current_stocks_variant_location",
                    set_={"quantity": qty},
                )
            )
            db.execute(stmt)
            written += 1
        except Exception as e:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error=str(e)))

    db.commit()
    return schemas.ImportConfirmResponse(written=written, skipped=skipped, errors=errors)


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANT PRICES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variant-prices/template")
def price_template():
    def build(wb):
        _write_template(wb, "Variant Prices",
            ["PID", "price", "promo_price", "clear_promo"],
            ["WID-001", "599.00", "499.00", ""])
    return _xlsx_response(build, "variant_prices_import_template.xlsx")


@router.post("/variant-prices/preview", response_model=schemas.ImportPreviewResponse)
def price_preview(
    payload: schemas.VariantPricePreviewRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    valid, errors = [], []
    creates = updates = noops = 0

    for row in payload.rows:
        anchor = (row.PID or "").strip()
        if not anchor:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor="", error="PID is required"))
            continue

        variant = db.query(inv_models.Variant).filter(
            inv_models.Variant.PID == anchor,
            inv_models.Variant.is_deleted == False,
        ).first()
        if not variant:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"PID '{anchor}' not found"))
            continue

        clear_promo = _truthy(row.clear_promo)
        new_price = None if _blank(row.price) else _dec(row.price)
        new_promo  = None if _blank(row.promo_price) else _dec(row.promo_price)

        if new_price is not None and new_price <= 0:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"price must be greater than 0"))
            continue
        if new_promo is not None and new_promo < 0:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"promo_price cannot be negative"))
            continue
        effective_price = new_price if new_price is not None else variant.price
        if new_promo is not None and effective_price is not None and new_promo > effective_price:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"promo_price ({new_promo}) cannot exceed price ({effective_price})"))
            continue

        old = {"price": str(variant.price) if variant.price is not None else None,
               "promo_price": str(variant.promo_price) if variant.promo_price is not None else None}
        nv = {}
        diff = []
        if new_price is not None and new_price != variant.price:
            nv["price"] = str(new_price); diff.append("price")
        if clear_promo and variant.promo_price is not None:
            nv["promo_price"] = None; diff.append("promo_price")
        elif new_promo is not None and new_promo != variant.promo_price:
            nv["promo_price"] = str(new_promo); diff.append("promo_price")

        if not nv:
            noops += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="noop",
                old_values=old, new_values=old, diff_fields=[]))
        else:
            updates += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="update",
                old_values=old, new_values={**old, **nv}, diff_fields=diff))

    return schemas.ImportPreviewResponse(
        valid_rows=valid, error_rows=errors,
        summary=schemas.ImportSummary(creates=creates, updates=updates,
                                      noops=noops, errors=len(errors)))


@router.post("/variant-prices/confirm", response_model=schemas.ImportConfirmResponse)
def price_confirm(
    payload: schemas.VariantPriceConfirmRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    written = skipped = 0
    errors = []
    anchor_set = set(payload.confirmed_anchors)

    for row in payload.rows:
        anchor = (row.PID or "").strip()
        if anchor not in anchor_set:
            skipped += 1
            continue
        try:
            variant = db.query(inv_models.Variant).filter_by(PID=anchor).first()
            if not variant:
                raise ValueError(f"PID '{anchor}' not found")

            clear_promo = _truthy(row.clear_promo)
            new_price = None if _blank(row.price) else _dec(row.price)
            new_promo  = None if _blank(row.promo_price) else _dec(row.promo_price)

            old_price = variant.price
            old_promo = variant.promo_price

            if new_price is not None:
                variant.price = new_price
            if clear_promo:
                variant.promo_price = None
            elif new_promo is not None:
                variant.promo_price = new_promo

            if variant.price != old_price or variant.promo_price != old_promo:
                db.add(inv_models.VariantPriceHistory(
                    variant_id=variant.variant_id,
                    old_price=old_price,
                    new_price=variant.price,
                    old_promo_price=old_promo,
                    new_promo_price=variant.promo_price,
                    changed_by_user_id=_actor.user_id,
                ))
            written += 1
        except Exception as e:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error=str(e)))

    db.commit()
    return schemas.ImportConfirmResponse(written=written, skipped=skipped, errors=errors)


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANT COSTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variant-costs/template")
def cost_template():
    def build(wb):
        _write_template(wb, "Variant Costs",
            ["PID", "supplier_code", "gross_cost", "supplier_discount"],
            ["WID-001", "SUP-001", "450.00", "10"])
    return _xlsx_response(build, "variant_costs_import_template.xlsx")


@router.post("/variant-costs/preview", response_model=schemas.ImportPreviewResponse)
def cost_preview(
    payload: schemas.VariantCostPreviewRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    valid, errors = [], []
    creates = updates = noops = 0

    for row in payload.rows:
        pid = (row.PID or "").strip()
        sup = (row.supplier_code or "").strip()
        anchor = f"{pid}|{sup}"

        if not pid or not sup:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error="PID and supplier_code are both required"))
            continue

        variant = db.query(inv_models.Variant).filter(
            inv_models.Variant.PID == pid, inv_models.Variant.is_deleted == False
        ).first()
        if not variant:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"PID '{pid}' not found"))
            continue

        supplier = db.query(inv_models.Supplier).filter(
            inv_models.Supplier.supplier_code == sup,
            inv_models.Supplier.is_deleted == False,
        ).first()
        if not supplier:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"Supplier code '{sup}' not found"))
            continue

        vs = db.query(inv_models.VariantSupplier).filter_by(
            variant_id=variant.variant_id, supplier_id=supplier.supplier_id
        ).first()
        if not vs:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error=f"No supplier link exists for '{pid}' + '{sup}'. Create the link first in the Product Detail page."))
            continue

        new_cost = None if _blank(row.gross_cost) else _dec(row.gross_cost)
        new_disc = None if _blank(row.supplier_discount) else _dec(row.supplier_discount)

        if new_cost is not None and new_cost <= 0:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error="gross_cost must be greater than 0"))
            continue
        if new_disc is not None and (new_disc < 0 or new_disc > 100):
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor,
                error="supplier_discount must be between 0 and 100"))
            continue

        old = {"gross_cost": str(vs.gross_cost) if vs.gross_cost is not None else None,
               "supplier_discount": str(vs.supplier_discount) if vs.supplier_discount is not None else None}
        nv = {}
        diff = []
        if new_cost is not None and new_cost != vs.gross_cost:
            nv["gross_cost"] = str(new_cost); diff.append("gross_cost")
        if new_disc is not None and new_disc != vs.supplier_discount:
            nv["supplier_discount"] = str(new_disc); diff.append("supplier_discount")

        if not nv:
            noops += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="noop",
                old_values=old, new_values=old, diff_fields=[]))
        else:
            updates += 1
            valid.append(schemas.ImportDiffRow(
                row_number=row.row_number, anchor=anchor, mode="update",
                old_values=old, new_values={**old, **nv}, diff_fields=diff))

    return schemas.ImportPreviewResponse(
        valid_rows=valid, error_rows=errors,
        summary=schemas.ImportSummary(creates=creates, updates=updates,
                                      noops=noops, errors=len(errors)))


@router.post("/variant-costs/confirm", response_model=schemas.ImportConfirmResponse)
def cost_confirm(
    payload: schemas.VariantCostConfirmRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    written = skipped = 0
    errors = []
    anchor_set = set(payload.confirmed_anchors)

    for row in payload.rows:
        pid = (row.PID or "").strip()
        sup = (row.supplier_code or "").strip()
        anchor = f"{pid}|{sup}"
        if anchor not in anchor_set:
            skipped += 1
            continue
        try:
            variant = db.query(inv_models.Variant).filter_by(PID=pid).first()
            if not variant:
                raise ValueError(f"PID '{pid}' not found")
            supplier = db.query(inv_models.Supplier).filter_by(supplier_code=sup).first()
            if not supplier:
                raise ValueError(f"Supplier code '{sup}' not found")
            vs = db.query(inv_models.VariantSupplier).filter_by(
                variant_id=variant.variant_id, supplier_id=supplier.supplier_id
            ).first()
            if not vs:
                raise ValueError("Supplier link not found")

            new_cost = None if _blank(row.gross_cost) else _dec(row.gross_cost)
            new_disc = None if _blank(row.supplier_discount) else _dec(row.supplier_discount)

            old_cost = vs.gross_cost
            old_disc = vs.supplier_discount

            if new_cost is not None:
                vs.gross_cost = new_cost
            if new_disc is not None:
                vs.supplier_discount = new_disc

            if vs.gross_cost != old_cost or vs.supplier_discount != old_disc:
                db.add(inv_models.VariantCostHistory(
                    variant_id=variant.variant_id,
                    supplier_id=supplier.supplier_id,
                    old_gross_cost=old_cost,
                    new_gross_cost=vs.gross_cost,
                    old_supplier_discount=old_disc,
                    new_supplier_discount=vs.supplier_discount,
                    changed_by_user_id=_actor.user_id,
                ))
            written += 1
        except Exception as e:
            errors.append(schemas.ImportErrorRow(
                row_number=row.row_number, anchor=anchor, error=str(e)))

    db.commit()
    return schemas.ImportConfirmResponse(written=written, skipped=skipped, errors=errors)
