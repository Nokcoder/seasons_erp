# backend/sales/router.py
import io
import xlsxwriter
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, case
from datetime import datetime, date
from typing import Optional

from core.database import get_db

# Import models/schemas
from sales import models as sales_models
from sales import schemas as sales_schemas
from inventory import models as inventory_models
from auth import models as auth_models

router = APIRouter()


# ---------------------------------------------------------
# 1. CREATE SALE (POST) - Used by the POS
# ---------------------------------------------------------
@router.post("/api/sales", status_code=status.HTTP_201_CREATED)
def create_sale(payload: sales_schemas.SaleCreatePayload, db: Session = Depends(get_db)):
    try:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        generated_doc_id = f"POS-{payload.header.location_id}-{timestamp}"

        # 2. Create the Sales Header
        db_header = sales_models.SalesHeader(
            document_id=generated_doc_id,
            date=payload.header.date,
            shift=payload.header.shift,
            sales_invoice_id=payload.header.sales_invoice_id,
            delivery_receipt_id=payload.header.delivery_receipt_id,

            # The new math breakdown
            subtotal_amount=payload.header.subtotal_amount,
            discount_amount=payload.header.discount_amount,
            tax_amount=payload.header.tax_amount,
            total_amount=payload.header.total_amount,

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
# 2. GET DASHBOARD DATA (GET) - Used by SalesLedger.tsx
# ---------------------------------------------------------
@router.get("/api/sales", response_model=sales_schemas.SalesDashboardResponse)
def get_sales_dashboard(
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
        db: Session = Depends(get_db)
):
    # Base Query for headers
    query = db.query(sales_models.SalesHeader).join(
        inventory_models.Location, sales_models.SalesHeader.location_id == inventory_models.Location.location_id
    ).join(
        auth_models.User, sales_models.SalesHeader.cashier_id == auth_models.User.user_id
    )

    # Apply Filters
    if start_date:
        query = query.filter(sales_models.SalesHeader.date >= start_date)
    if end_date:
        query = query.filter(sales_models.SalesHeader.date <= end_date)

    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(
            sales_models.SalesHeader.document_id.ilike(search_term),
            sales_models.SalesHeader.sales_invoice_id.ilike(search_term),
            sales_models.SalesHeader.customer_name.ilike(search_term),
            sales_models.SalesHeader.register_id.ilike(search_term)
        ))

    sales = query.order_by(sales_models.SalesHeader.created_at.desc()).all()

    # KPI Calculation Query
    item_discount_calc = (sales_models.SalesItem.price * (
                sales_models.SalesItem.discount_pct / 100)) + sales_models.SalesItem.discount_flat

    kpi_query = db.query(
        func.sum(sales_models.SalesHeader.total_amount).label("gross_sales"),
        func.sum(
            case(
                (sales_models.SalesItem.net_cost > 0,
                 (
                             sales_models.SalesItem.price - item_discount_calc - sales_models.SalesItem.net_cost) * sales_models.SalesItem.qty),
                else_=0
            )
        ).label("net_sales"),
        func.sum(
            case(
                ((sales_models.SalesItem.net_cost == 0) | (sales_models.SalesItem.net_cost.is_(None)),
                 (sales_models.SalesItem.price - item_discount_calc) * sales_models.SalesItem.qty),
                else_=0
            )
        ).label("partial_gross")
    ).select_from(sales_models.SalesHeader).join(
        sales_models.SalesItem, sales_models.SalesHeader.sales_id == sales_models.SalesItem.sales_id
    )

    if start_date:
        kpi_query = kpi_query.filter(sales_models.SalesHeader.date >= start_date)
    if end_date:
        kpi_query = kpi_query.filter(sales_models.SalesHeader.date <= end_date)

    kpi_result = kpi_query.first()

    # Format the Response
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
            "total_amount": sale.total_amount,
            "location_name": sale.location.name if sale.location else "Unknown",
            "cashier_name": sale.cashier.username if sale.cashier else "Unknown",
            "payments": [{"method": p.method, "amount": p.amount} for p in sale.payments]
        })

    return {
        "kpis": {
            "gross_sales": float(kpi_result.gross_sales or 0),
            "net_sales": float(kpi_result.net_sales or 0),
            "partial_gross": float(kpi_result.partial_gross or 0)
        },
        "sales": formatted_sales
    }


# ---------------------------------------------------------
# 3. EXPORT EXCEL (GET) - Used by the Export Button
# ---------------------------------------------------------
@router.get("/api/sales/export")
def export_sales_excel(
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
        db: Session = Depends(get_db)
):
    header_query = db.query(sales_models.SalesHeader).join(
        inventory_models.Location, sales_models.SalesHeader.location_id == inventory_models.Location.location_id
    ).join(
        auth_models.User, sales_models.SalesHeader.cashier_id == auth_models.User.user_id
    )

    item_query = db.query(
        sales_models.SalesHeader, sales_models.SalesItem, inventory_models.Product
    ).join(
        sales_models.SalesItem, sales_models.SalesHeader.sales_id == sales_models.SalesItem.sales_id
    ).join(
        inventory_models.Product, sales_models.SalesItem.product_id == inventory_models.Product.product_id
    ).join(
        inventory_models.Location, sales_models.SalesHeader.location_id == inventory_models.Location.location_id
    )

    if start_date:
        header_query = header_query.filter(sales_models.SalesHeader.date >= start_date)
        item_query = item_query.filter(sales_models.SalesHeader.date >= start_date)
    if end_date:
        header_query = header_query.filter(sales_models.SalesHeader.date <= end_date)
        item_query = item_query.filter(sales_models.SalesHeader.date <= end_date)
    if search:
        search_term = f"%{search}%"
        header_query = header_query.filter(or_(
            sales_models.SalesHeader.document_id.ilike(search_term),
            sales_models.SalesHeader.sales_invoice_id.ilike(search_term),
            sales_models.SalesHeader.customer_name.ilike(search_term)
        ))
        item_query = item_query.filter(or_(
            sales_models.SalesHeader.document_id.ilike(search_term),
            sales_models.SalesHeader.sales_invoice_id.ilike(search_term),
            inventory_models.Product.name.ilike(search_term)
        ))

    headers = header_query.order_by(sales_models.SalesHeader.created_at.desc()).all()
    items = item_query.order_by(sales_models.SalesHeader.created_at.desc()).all()

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {'in_memory': True})

    bold = workbook.add_format({'bold': True, 'bg_color': '#D3D3D3', 'border': 1})
    money = workbook.add_format({'num_format': '₱#,##0.00', 'border': 1})
    date_fmt = workbook.add_format({'num_format': 'yyyy-mm-dd', 'border': 1})
    border = workbook.add_format({'border': 1})

    ws1 = workbook.add_worksheet("Sales Overview")
    ws1_cols = ["Invoice ID", "System Doc ID", "Date", "Register", "Location", "Cashier", "Customer", "Total Amount"]
    for col_num, col_name in enumerate(ws1_cols):
        ws1.write(0, col_num, col_name, bold)
        ws1.set_column(col_num, col_num, 15)

    for row_num, h in enumerate(headers, 1):
        ws1.write(row_num, 0, h.sales_invoice_id or "N/A", border)
        ws1.write(row_num, 1, h.document_id, border)
        ws1.write_datetime(row_num, 2, h.date, date_fmt)
        ws1.write(row_num, 3, h.register_id, border)
        ws1.write(row_num, 4, h.location.name, border)
        ws1.write(row_num, 5, h.cashier.username, border)
        ws1.write(row_num, 6, h.customer_name or "Walk-in", border)
        ws1.write_number(row_num, 7, float(h.total_amount), money)

    ws2 = workbook.add_worksheet("Item Details")
    ws2_cols = ["Invoice ID", "Date", "Location", "PID", "Item Name", "Qty", "Unit Price", "Discount", "Net Cost",
                "Ext Price", "Margin"]
    for col_num, col_name in enumerate(ws2_cols):
        ws2.write(0, col_num, col_name, bold)
        ws2.set_column(col_num, col_num, 15)

    for row_num, (h, i, p) in enumerate(items, 1):
        total_item_discount = (float(i.price) * (float(i.discount_pct) / 100)) + float(i.discount_flat)
        ext_price = (float(i.price) - total_item_discount) * i.qty
        margin = ext_price - (float(i.net_cost) * i.qty) if i.net_cost else 0

        ws2.write(row_num, 0, h.sales_invoice_id or h.document_id, border)
        ws2.write_datetime(row_num, 1, h.date, date_fmt)
        ws2.write(row_num, 2, h.location.name, border)
        ws2.write(row_num, 3, p.pid, border)
        ws2.write(row_num, 4, p.name, border)
        ws2.write_number(row_num, 5, i.qty, border)
        ws2.write_number(row_num, 6, float(i.price), money)
        ws2.write_number(row_num, 7, float(i.discount), money)
        ws2.write_number(row_num, 8, float(i.net_cost) if i.net_cost else 0, money)
        ws2.write_number(row_num, 9, ext_price, money)
        ws2.write_number(row_num, 10, margin, money)

    workbook.close()
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=Sales_Report.xlsx"}
    )

# GET POS Settings
@router.get("/api/sales/settings")
def get_pos_settings(db: Session = Depends(get_db)):
    settings = db.query(sales_models.PosSettings).first()
    if not settings:
        return {"is_vat_enabled": False, "vat_rate": 0.12}
    return {"is_vat_enabled": settings.is_vat_enabled, "vat_rate": float(settings.vat_rate)}


# Add this route to backend/sales/router.py

@router.get("/api/sales/detail/{sales_id}", response_model=sales_schemas.SaleDeepDetailResponse)
def get_sale_details(sales_id: int, db: Session = Depends(get_db)):
    # 1. Fetch the Master Header
    sale = db.query(sales_models.SalesHeader).filter(
        sales_models.SalesHeader.sales_id == sales_id
    ).first()

    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    # 2. Fetch and Format the Line Items
    items_query = db.query(
        sales_models.SalesItem,
        inventory_models.Product
    ).join(
        inventory_models.Product,
        sales_models.SalesItem.product_id == inventory_models.Product.product_id
    ).filter(
        sales_models.SalesItem.sales_id == sales_id
    ).all()

    formatted_items = []
    for item, product in items_query:
        # MDAS: (Price * %) + Flat
        discount_from_pct = float(item.price) * (float(item.discount_pct or 0) / 100)
        total_discount_amount = discount_from_pct + float(item.discount_flat or 0)

        line_total = (float(item.price) - total_discount_amount) * item.qty
        margin = line_total - (float(item.net_cost) * item.qty)

        formatted_items.append({
            "product_name": product.name,
            "pid": product.pid,
            "qty": item.qty,
            "price": item.price,
            # Pass the raw breakdown values
            "discount_pct": item.discount_pct,
            "discount_flat": item.discount_flat,
            "net_cost": item.net_cost,
            "line_total": line_total,
            "margin": margin
        })

    # 3. Format the Header for the response
    header_dict = {
        "sales_id": sale.sales_id,
        "document_id": sale.document_id,
        "date": sale.date,
        "created_at": sale.created_at,
        "shift": sale.shift,
        "sales_invoice_id": sale.sales_invoice_id,
        "customer_name": sale.customer_name or "Walk-in",
        "register_id": sale.register_id,
        "total_amount": sale.total_amount,
        "location_name": sale.location.name if sale.location else "Unknown",
        "cashier_name": sale.cashier.username if sale.cashier else "Unknown",
        "payments": [{"method": p.method, "amount": p.amount} for p in sale.payments]
    }

    return {
        "header": header_dict,
        "items": formatted_items
    }