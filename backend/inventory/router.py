# inventory/router.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from core.database import get_db
from inventory import models, schemas
import math

router = APIRouter(prefix="/api/products", tags=["Products"])

# 1. READ ALL (For the Dashboard)
@router.get("/", response_model=List[schemas.ProductSchema])
def get_products(db: Session = Depends(get_db)):
    return db.query(models.Product).options(
        selectinload(models.Product.categories),
        selectinload(models.Product.current_stock).selectinload(models.CurrentStock.location),
        selectinload(models.Product.cost_layers),
        selectinload(models.Product.price_history)
    ).all()

# 2. READ SINGLE (For the Detail Page)
@router.get("/{product_id}", response_model=schemas.ProductSchema)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.product_id == product_id).options(
        selectinload(models.Product.categories),
        selectinload(models.Product.current_stock).selectinload(models.CurrentStock.location),
        selectinload(models.Product.cost_layers),
        selectinload(models.Product.price_history)
    ).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# 3. CREATE

@router.post("/", response_model=schemas.ProductSchema) # <--- FIXED PREFIX
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):
    # 1. Create the base product
    db_product = models.Product(**product.dict())
    db.add(db_product)
    db.flush()  # Flush to instantly get the new product_id from the database

    # 2. Create the Genesis Price History record if prices were provided
    if product.tag_price is not None or product.net_price is not None:
        initial_history = models.PriceHistory(
            product_id=db_product.product_id,
            new_tag_price=product.tag_price,
            new_net_price=product.net_price,
            changed_at=datetime.utcnow()
        )
        db.add(initial_history)

    # 3. Commit everything together
    db.commit()
    db.refresh(db_product)
    return db_product


# 4. UPDATE
@router.put("/{product_id}", response_model=schemas.ProductSchema)
def update_product(product_id: int, product_update: schemas.ProductUpdate, db: Session = Depends(get_db)):
    db_product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    update_data = product_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_product, key, value)

    try:
        db.commit()
        return get_product(product_id, db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Database error (likely a duplicate SKU).")


@router.get("/{product_id}/ledger/{location_id}")  # <--- FIXED PREFIX AND INDENTATION
def get_item_ledger(product_id: int, location_id: int, db: Session = Depends(get_db)):
        # 1. Fetch Context (Header Info)
        product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
        location = db.query(models.Location).filter(models.Location.location_id == location_id).first()

        # Get current stock at this specific location
        stock = db.query(models.CurrentStock).filter(
            models.CurrentStock.product_id == product_id,
            models.CurrentStock.location_id == location_id
        ).first()

        if not product or not location:
            raise HTTPException(status_code=404, detail="Product or Location not found")

        # 2. Fetch Outbound Movements (Leaving this location)
        outbound = db.query(models.StockTransfer, models.StockTransferItem). \
            join(models.StockTransferItem). \
            filter(
            models.StockTransfer.from_location_id == location_id,
            models.StockTransferItem.product_id == product_id,
            models.StockTransfer.status.in_(["IN_TRANSIT", "COMPLETED"])
        ).all()

        # 3. Fetch Inbound Movements (Entering this location)
        inbound = db.query(models.StockTransfer, models.StockTransferItem). \
            join(models.StockTransferItem). \
            filter(
            models.StockTransfer.to_location_id == location_id,
            models.StockTransferItem.product_id == product_id,
            models.StockTransfer.status == "COMPLETED"
        ).all()

        ledger_entries = []

        # Format Outbound
        for transfer, item in outbound:
            qty = item.released_qty if item.released_qty is not None else item.requested_qty
            if qty:
                ledger_entries.append({
                    "timestamp": transfer.transfer_date,
                    "movement_type": "TRANSFER_OUT",
                    "document_id": transfer.document_id or f"TRN-{transfer.transfer_id}",
                    "transfer_id": transfer.transfer_id,
                    "quantity": -float(qty)  # Negative for leaving
                })

        # Format Inbound
        for transfer, item in inbound:
            qty = item.received_qty if item.received_qty is not None else item.requested_qty
            if qty:
                ledger_entries.append({
                    "timestamp": transfer.transfer_date,
                    "movement_type": "TRANSFER_IN",
                    "document_id": transfer.document_id or f"TRN-{transfer.transfer_id}",
                    "transfer_id": transfer.transfer_id,
                    "quantity": float(qty)  # Positive for arriving
                })

        # 4. Sort chronologically (newest first)
        ledger_entries.sort(key=lambda x: x["timestamp"], reverse=True)

        return {
            "pid": product.pid,
            "product_name": product.name,
            "location_name": location.name,
            "current_qty": float(stock.quantity) if stock else 0.0,
            "units_per_bundle": product.units_per_bundle or 1,
            "ledger": ledger_entries
        }


# 1. Define what the frontend will send us after it parses the Excel file
class ProductImportRow(BaseModel):
    pid: str
    brand: str | None = None
    name: str | None = None
    variant: str | None = None
    sku: str | None = None
    tag_price: float | None = None
    net_price: float | None = None
    categories: str | None = None
    units_per_bundle: int | None = None
    gross_cost: float | None = None
    cost_discount: float | None = None


# 2. The Preview Endpoint
@router.post("/products/import-preview")
def preview_product_import(rows: List[ProductImportRow], db: Session = Depends(get_db)):
    from inventory.models import Product

    preview_results = {
        "new_items": [],
        "updates": [],
        "errors": []
    }

    for row in rows:
        if not row.pid:
            continue

        existing_product = db.query(Product).filter(Product.pid == row.pid).first()

        if existing_product:
            # It exists! Let's check if they changed anything important
            changes = {}
            if existing_product.tag_price != row.tag_price:
                changes['price'] = {'old': existing_product.tag_price, 'new': row.tag_price}
            if existing_product.name != row.name:
                changes['name'] = {'old': existing_product.name, 'new': row.name}

            if changes:
                preview_results["updates"].append({
                    "pid": row.pid,
                    "product_name": existing_product.name,
                    "changes": changes
                })
        else:
            # It's a brand new item!
            preview_results["new_items"].append({
                "pid": row.pid,
                "name": row.name,
                "price": row.tag_price
            })

    return preview_results


def is_valid(value):
    """Helper to check if an Excel cell actually has data (not None or NaN)"""
    if value is None: return False
    if isinstance(value, float) and math.isnan(value): return False
    if isinstance(value, str) and value.strip() == "": return False
    return True


@router.post("/products/import-confirm")
def confirm_product_import(rows: List[ProductImportRow], db: Session = Depends(get_db)):
    from inventory.models import Product
    count_new = 0
    count_updated = 0

    for row in rows:
        if not is_valid(row.pid):
            continue

        existing = db.query(Product).filter(Product.pid == row.pid).first()

        if existing:
            # ONLY update fields if they have valid data in the Excel sheet
            if is_valid(row.name): existing.name = row.name
            if is_valid(row.brand): existing.brand = row.brand
            if is_valid(row.variant): existing.variant = row.variant
            if is_valid(row.sku): existing.sku = row.sku
            if is_valid(row.tag_price): existing.tag_price = row.tag_price
            if is_valid(row.categories): existing.categories = row.categories
            if is_valid(row.units_per_bundle): existing.units_per_bundle = row.units_per_bundle
            if is_valid(row.gross_cost): existing.gross_cost = row.gross_cost
            if is_valid(row.cost_discount): existing.cost_discount = row.cost_discount
            count_updated += 1
        else:
            # Create brand new product
            new_product = Product(
                pid=row.pid,
                name=row.name or "Unnamed Item",
                brand=row.brand,
                variant=row.variant,
                sku=row.sku,
                tag_price=row.tag_price or 0.0,
                categories=row.categories,
                units_per_bundle=row.units_per_bundle or 1,
                gross_cost=row.gross_cost or 0.0,
                cost_discount=row.cost_discount or 0.0,
                is_active=True
            )
            db.add(new_product)
            count_new += 1

    db.commit()
    return {"message": f"Successfully imported {count_new} new items and updated {count_updated} items."}