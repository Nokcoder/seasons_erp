import io
import xlsxwriter
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, case
from datetime import datetime, date
from typing import Optional
from decimal import Decimal

from core.database import get_db

# Import models/schemas
from sales import models as sales_models
from sales import schemas as sales_schemas
from inventory import models as inventory_models
from auth import models as auth_models

router = APIRouter(prefix="/sales", tags=["sales"])


# ---------------------------------------------------------
# SHARED HELPER: Unified logic for receipt calculation
# ---------------------------------------------------------
def _format_sale_detail(sale, items_query):
    formatted_items = []
    for item, product in items_query:
        # Use Decimal for strict financial math
        price = Decimal(str(item.price))
        qty = Decimal(str(item.qty))
        pct = Decimal(str(item.discount_pct or 0)) / 100
        flat = Decimal(str(item.discount_flat or 0))
        cost = Decimal(str(item.net_cost or 0))

        line_total = (price - (price * pct + flat)) * qty
        margin = line_total - (cost * qty)

        formatted_items.append({
            "product_id": product.product_id,
            "brand": product.brand or "",
            "sku": product.sku or "",
            # THE FIX: Safely check the first variant for is_inventory, defaulting to True
            "is_inventory": product.variants[0].is_inventory if getattr(product, "variants", None) and len(
                product.variants) > 0 else True,
            "product_name": product.name,
            "pid": product.pid,
            "qty": item.qty,
            "price": float(item.price),
            "discount_pct": item.discount_pct,
            "discount_flat": item.discount_flat,
            "net_cost": item.net_cost,
            "line_total": float(line_total),
            "margin": float(margin)
        })

    return {
        "header": {
            "sales_id": sale.sales_id,
            "document_id": sale.document_id,
            "date": sale.date,
            "created_at": sale.created_at,
            "shift": sale.shift,
            "sales_invoice_id": sale.sales_invoice_id,
            "customer_name": sale.customer_name or "Walk-in",
            "register_id": sale.register_id,
            "total_amount": float(sale.total_amount or 0.0),

            # --- THE MISSING LINE: We forgot to send the legacy discount field! ---
            "discount_amount": float(getattr(sale, "discount_amount", 0.0) or 0.0),
            # ----------------------------------------------------------------------

            "basket_discount_amount": float(getattr(sale, "basket_discount_amount", 0.0) or 0.0),
            "service_charge": float(getattr(sale, "service_charge", 0.0) or 0.0),
            "delivery_charge": float(getattr(sale, "delivery_charge", 0.0) or 0.0),
            "location_name": sale.location.name if sale.location else "Unknown",
            "cashier_name": sale.cashier.username if sale.cashier else "Unknown",
            "payments": [{"method": p.method, "amount": float(p.amount)} for p in sale.payments],
            "transaction_type": getattr(sale, "transaction_type", "SALE"),
            "manual_adjustment_amount": float(getattr(sale, "manual_adjustment_amount", 0.0) or 0.0),
            "adjustment_reason": getattr(sale, "adjustment_reason", None),
            "linked_receipt_id": getattr(sale, "linked_receipt_id", None)
        },
        "items": formatted_items
    }


# ---------------------------------------------------------
# 1. CREATE SALE (POST) - Used by the POS
# ---------------------------------------------------------
@router.post("", status_code=status.HTTP_201_CREATED)
def create_sale(payload: sales_schemas.SaleCreatePayload, db: Session = Depends(get_db)):
    try:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        generated_doc_id = f"POS-{payload.header.location_id}-{timestamp}"

        # Create the Sales Header
        db_header = sales_models.SalesHeader(
            document_id=generated_doc_id,
            date=payload.header.date,
            shift=payload.header.shift,
            sales_invoice_id=payload.header.sales_invoice_id,
            delivery_receipt_id=payload.header.delivery_receipt_id,

            subtotal_amount=payload.header.subtotal_amount,
            discount_amount=payload.header.discount_amount,
            tax_amount=payload.header.tax_amount,
            total_amount=payload.header.total_amount,

            basket_discount_amount=getattr(payload.header, 'basket_discount_amount', 0.0),
            service_charge=payload.header.service_charge,
            delivery_charge=payload.header.delivery_charge,

            transaction_type=payload.header.transaction_type,
            manual_adjustment_amount=payload.header.manual_adjustment_amount,
            adjustment_reason=payload.header.adjustment_reason,
            linked_receipt_id=payload.header.linked_receipt_id,

            customer_name=payload.header.customer_name,
            customer_id=payload.header.customer_id,
            register_id=payload.header.register_id,
            location_id=payload.header.location_id,
            cashier_id=payload.header.cashier_id,
            idempotency_key=payload.header.idempotency_key
        )

        db.add(db_header)
        db.flush()

        for item in payload.items:
            db_item = sales_models.SalesItem(
                sales_id=db_header.sales_id,
                product_id=item.product_id,
                qty=item.qty,
                price=item.price,
                discount_pct=item.discount_pct,
                discount_flat=item.discount_flat,
                net_cost=item.net_cost
            )
            db.add(db_item)

            current_stock = db.query(inventory_models.CurrentStock).filter(
                inventory_models.CurrentStock.product_id == item.product_id,
                inventory_models.CurrentStock.location_id == payload.header.location_id
            ).first()

            if current_stock:
                current_stock.quantity -= item.qty
            else:
                new_stock = inventory_models.CurrentStock(
                    product_id=item.product_id,
                    location_id=payload.header.location_id,
                    quantity=-item.qty
                )
                db.add(new_stock)

            ledger_entry = inventory_models.InventoryLedger(
                product_id=item.product_id,
                location_id=payload.header.location_id,
                qty_change=-item.qty,
                reason=inventory_models.LedgerReason.SALE,
                ref_table="sales_headers",
                ref_pk=db_header.document_id
            )
            db.add(ledger_entry)

        for payment in payload.payments:
            db_payment = sales_models.SalesPayment(
                sales_id=db_header.sales_id,
                method=payment.method,
                amount=payment.amount
            )
            db.add(db_payment)

        db.commit()
        db.refresh(db_header)

        return {"message": "Sale completed successfully", "document_id": db_header.document_id}

    except Exception as e:
        db.rollback()
        print(f"Checkout Error: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while processing the sale.")


# ---------------------------------------------------------
# 2. GET DASHBOARD DATA (GET) - Crash-Proof Decimal Math
# ---------------------------------------------------------
@router.get("", response_model=sales_schemas.SalesDashboardResponse)
def get_sales_dashboard(
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
        shift: Optional[str] = None,
        register_id: Optional[str] = None,
        db: Session = Depends(get_db)
):
    query = db.query(sales_models.SalesHeader).join(
        inventory_models.Location, sales_models.SalesHeader.location_id == inventory_models.Location.location_id
    ).join(
        auth_models.User, sales_models.SalesHeader.cashier_id == auth_models.User.user_id
    )

    if start_date: query = query.filter(sales_models.SalesHeader.date >= start_date)
    if end_date: query = query.filter(sales_models.SalesHeader.date <= end_date)

    if shift: query = query.filter(sales_models.SalesHeader.shift == shift)
    if register_id: query = query.filter(sales_models.SalesHeader.register_id == register_id)

    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(
            sales_models.SalesHeader.document_id.ilike(search_term),
            sales_models.SalesHeader.sales_invoice_id.ilike(search_term),
            sales_models.SalesHeader.customer_name.ilike(search_term),
            sales_models.SalesHeader.register_id.ilike(search_term)
        ))

    sales = query.order_by(sales_models.SalesHeader.created_at.desc()).all()

    # Safety filter to prevent Python TypeErrors
    def to_dec(val):
        return Decimal(str(val)) if val else Decimal('0.00')

    # 1. STRICT DECIMAL AGGREGATION
    total_collected = sum(to_dec(sale.total_amount) for sale in sales)

    header_logistics = sum(
        to_dec(getattr(sale, 'service_charge', 0)) +
        to_dec(getattr(sale, 'delivery_charge', 0))
        for sale in sales
    )

    total_basket_discounts = sum(
        to_dec(getattr(sale, 'discount_amount', 0)) +
        to_dec(getattr(sale, 'basket_discount_amount', 0))
        for sale in sales
    )
    net_discrepancies = sum(to_dec(getattr(sale, 'manual_adjustment_amount', 0)) for sale in sales)

    # 2. PURE ITEM REVENUE (NO PRORATING)
    item_gross = sales_models.SalesItem.price * sales_models.SalesItem.qty
    item_discount_total = ((sales_models.SalesItem.price * (
            func.coalesce(sales_models.SalesItem.discount_pct, 0) / 100)) + func.coalesce(
        sales_models.SalesItem.discount_flat, 0)) * sales_models.SalesItem.qty
    item_net_revenue = item_gross - item_discount_total
    total_item_cost = func.coalesce(sales_models.SalesItem.net_cost, 0) * sales_models.SalesItem.qty

    # kpi_query = db.query(
    #     # --- THE FIX: Removed "- total_item_cost" so it calculates Gross Revenue, not Profit ---
    #     func.sum(case(
    #         (((inventory_models.Product.is_inventory.is_(True)) | (inventory_models.Product.is_inventory.is_(None))) & (
    #                 sales_models.SalesItem.net_cost > 0), item_net_revenue),
    #         else_=0
    #     )).label("margined_net_sales"),
    kpi_query = db.query(
        # SURGICAL FIX: Changed Product.is_inventory to ProductVariant.is_inventory
        func.sum(case(
            (((inventory_models.ProductVariant.is_inventory.is_(True)) | (
                inventory_models.ProductVariant.is_inventory.is_(None))) & (
                     sales_models.SalesItem.net_cost > 0), item_net_revenue - total_item_cost),
            else_=0
        )).label("margined_net_sales"),

        func.sum(case(
            (((inventory_models.ProductVariant.is_inventory.is_(True)) | (
                inventory_models.ProductVariant.is_inventory.is_(None))) & (
                     (sales_models.SalesItem.net_cost == 0) | (sales_models.SalesItem.net_cost.is_(None))),
             item_net_revenue),
            else_=0
        )).label("unmargined_gross_sales"),

        func.sum(case(
            (inventory_models.ProductVariant.is_inventory.is_(False), item_net_revenue),
            else_=0
        )).label("item_based_logistics")

    ).select_from(sales_models.SalesHeader).join(
        sales_models.SalesItem, sales_models.SalesHeader.sales_id == sales_models.SalesItem.sales_id
    ).join(
        inventory_models.Product, sales_models.SalesItem.product_id == inventory_models.Product.product_id
    ).outerjoin(
        # THE MISSING LINK: Join the Variant table so we can check is_inventory!
        inventory_models.ProductVariant,
        inventory_models.Product.product_id == inventory_models.ProductVariant.product_id
    )

    if start_date: kpi_query = kpi_query.filter(sales_models.SalesHeader.date >= start_date)
    if end_date: kpi_query = kpi_query.filter(sales_models.SalesHeader.date <= end_date)

    # SURGICAL FIX 1: Add these two missing lines so the Math Cards match the Table!
    if shift: kpi_query = kpi_query.filter(sales_models.SalesHeader.shift == shift)
    if register_id: kpi_query = kpi_query.filter(sales_models.SalesHeader.register_id == register_id)

    if search:
        kpi_query = kpi_query.filter(or_(
            sales_models.SalesHeader.document_id.ilike(search_term),
            sales_models.SalesHeader.sales_invoice_id.ilike(search_term)
        ))

    kpi_result = kpi_query.first()

    # COMBINE Header-Level Fees with Item-Level Fees securely
    item_logistics = to_dec(kpi_result.item_based_logistics if kpi_result else 0)
    final_logistics_total = header_logistics + item_logistics

    # 3. Format the Response
    formatted_sales = []
    for sale in sales:
        formatted_sales.append({
            "sales_id": sale.sales_id,
            "document_id": sale.document_id,
            "date": sale.date,
            "created_at": sale.created_at,
            "shift": sale.shift,
            "sales_invoice_id": sale.sales_invoice_id,
            "customer_name": sale.customer_name,
            "register_id": sale.register_id,
            "total_amount": float(sale.total_amount or 0.0),

            "basket_discount_amount": float(getattr(sale, "basket_discount_amount", 0.0) or 0.0),
            "service_charge": float(getattr(sale, "service_charge", 0.0) or 0.0),
            "delivery_charge": float(getattr(sale, "delivery_charge", 0.0) or 0.0),

            "location_name": sale.location.name if sale.location else "Unknown",
            "cashier_name": sale.cashier.username if sale.cashier else "Unknown",
            "payments": [{"method": p.method, "amount": float(p.amount)} for p in sale.payments],
            "transaction_type": getattr(sale, "transaction_type", "SALE"),
            "manual_adjustment_amount": float(getattr(sale, "manual_adjustment_amount", 0.0) or 0.0),
            "linked_receipt_id": getattr(sale, "linked_receipt_id", None),
            "adjustment_reason": getattr(sale, "adjustment_reason", None)
        })

    return {
        "kpis": {
            "total_collected": float(total_collected),
            "margined_net_sales": float(kpi_result.margined_net_sales or 0) if kpi_result else 0.0,
            "unmargined_gross_sales": float(kpi_result.unmargined_gross_sales or 0) if kpi_result else 0.0,

            # Satisfy the Pydantic Schema requirements
            "margined_revenue": 0.0,
            "pure_margin": 0.0,

            "total_basket_discounts": float(total_basket_discounts),
            "logistics_total": float(final_logistics_total),
            "net_discrepancies": float(net_discrepancies)
        },
        "sales": formatted_sales
    }


# ---------------------------------------------------------
# 3. DETAILS & EXPORT (Unified Routes)
# ---------------------------------------------------------
@router.get("/detail/{sales_id}", response_model=sales_schemas.SaleDeepDetailResponse)
def get_sale_details(sales_id: int, db: Session = Depends(get_db)):
    sale = db.query(sales_models.SalesHeader).filter(sales_models.SalesHeader.sales_id == sales_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    items = db.query(sales_models.SalesItem, inventory_models.Product).join(
        inventory_models.Product, sales_models.SalesItem.product_id == inventory_models.Product.product_id
    ).filter(sales_models.SalesItem.sales_id == sales_id).all()

    return _format_sale_detail(sale, items)


@router.get("/document/{document_id}", response_model=sales_schemas.SaleDeepDetailResponse)
def get_sale_by_document(document_id: str, db: Session = Depends(get_db)):
    sale = db.query(sales_models.SalesHeader).filter(
        or_(
            sales_models.SalesHeader.document_id.ilike(document_id),
            sales_models.SalesHeader.sales_invoice_id.ilike(document_id)
        )
    ).first()

    if not sale:
        raise HTTPException(status_code=404, detail=f"Receipt '{document_id}' not found in database.")

    items = db.query(sales_models.SalesItem, inventory_models.Product).join(
        inventory_models.Product, sales_models.SalesItem.product_id == inventory_models.Product.product_id
    ).filter(sales_models.SalesItem.sales_id == sale.sales_id).all()

    return _format_sale_detail(sale, items)


@router.get("/export")
def export_sales_excel(
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
        shift: Optional[str] = None,
        register_id: Optional[str] = None,
        db: Session = Depends(get_db)
):
    header_query = db.query(sales_models.SalesHeader).join(
        inventory_models.Location, sales_models.SalesHeader.location_id == inventory_models.Location.location_id
    )
    if start_date: header_query = header_query.filter(sales_models.SalesHeader.date >= start_date)
    if end_date: header_query = header_query.filter(sales_models.SalesHeader.date <= end_date)

    if shift: header_query = header_query.filter(sales_models.SalesHeader.shift == shift)
    if register_id: header_query = header_query.filter(sales_models.SalesHeader.register_id == register_id)

    if search:
        search_term = f"%{search}%"
        header_query = header_query.filter(or_(
            sales_models.SalesHeader.document_id.ilike(search_term),
            sales_models.SalesHeader.sales_invoice_id.ilike(search_term),
            sales_models.SalesHeader.customer_name.ilike(search_term)
        ))

    headers = header_query.order_by(sales_models.SalesHeader.created_at.desc()).all()

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {'in_memory': True})

    bold = workbook.add_format({'bold': True, 'bg_color': '#EFEFEF', 'border': 1})
    money = workbook.add_format({'num_format': '₱#,##0.00', 'border': 1})
    date_fmt = workbook.add_format({'num_format': 'yyyy-mm-dd', 'border': 1})
    border = workbook.add_format({'border': 1})

    ws1 = workbook.add_worksheet("Sales Overview")

    ws1_cols = [
        "Invoice ID", "System Doc ID", "Date", "Location", "Customer",
        "Subtotal", "Item Discounts", "Basket Discount", "Service Charge", "Delivery Charge", "Adj. Overrides",
        "Total Collected"
    ]
    for col_num, col_name in enumerate(ws1_cols):
        ws1.write(0, col_num, col_name, bold)
        ws1.set_column(col_num, col_num, 15)

    for row_num, h in enumerate(headers, 1):
        ws1.write(row_num, 0, h.sales_invoice_id or "N/A", border)
        ws1.write(row_num, 1, h.document_id, border)
        ws1.write_datetime(row_num, 2, h.date, date_fmt)
        ws1.write(row_num, 3, h.location.name if h.location else "Unknown", border)
        ws1.write(row_num, 4, h.customer_name or "Walk-in", border)

        ws1.write_number(row_num, 5, float(h.subtotal_amount or 0.0), money)
        ws1.write_number(row_num, 6, float(h.discount_amount or 0.0), money)
        ws1.write_number(row_num, 7, float(getattr(h, 'basket_discount_amount', 0.0) or 0.0), money)
        ws1.write_number(row_num, 8, float(getattr(h, 'service_charge', 0.0) or 0.0), money)
        ws1.write_number(row_num, 9, float(getattr(h, 'delivery_charge', 0.0) or 0.0), money)
        ws1.write_number(row_num, 10, float(h.manual_adjustment_amount or 0.0), money)
        ws1.write_number(row_num, 11, float(h.total_amount or 0.0), money)

    workbook.close()
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Audited_Sales_Report.xlsx"}
    )


# ---------------------------------------------------------
# 4. SETTINGS
# ---------------------------------------------------------
@router.get("/settings")
def get_pos_settings(db: Session = Depends(get_db)):
    settings = db.query(sales_models.PosSettings).first()
    if not settings:
        return {"is_vat_enabled": False, "vat_rate": 0.12}
    return {"is_vat_enabled": settings.is_vat_enabled, "vat_rate": float(settings.vat_rate)}