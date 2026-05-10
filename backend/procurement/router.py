from sqlalchemy.orm import joinedload, selectinload
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from datetime import datetime

from core.database import get_db
from inventory import models as inv_models
from procurement.models import PurchaseOrder, PurchaseOrderItem, InboundShipment, GoodsReceipt, GoodsReceiptItem
from inventory.models import Product, CurrentStock, InventoryLedger, LedgerReason

router = APIRouter(prefix="/api/procurement", tags=["Procurement"])


# --- UNIFIED SCHEMAS ---

class SupplierCreate(BaseModel):
    name: str
    contact_person: str | None = None
    contact_notes: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    payment_terms: str | None = None
    banking_details: str | None = None


class SupplierUpdate(BaseModel):
    name: str | None = None
    contact_person: str | None = None
    contact_notes: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    payment_terms: str | None = None
    banking_details: str | None = None
    is_active: bool | None = None


class POItemCreate(BaseModel):
    product_id: int | None = None
    pid: str
    brand: str | None = None
    name: str | None = None
    sku: str | None = None
    bundling: str | None = None
    requested_qty: float
    unit_gross_cost: float
    discount: float = 0.0


class POCreate(BaseModel):
    supplier_id: int
    document_id: str | None = None
    target_delivery_date: datetime | None = None
    payment_terms: str | None = None
    items: List[POItemCreate]


class ShipmentCreate(BaseModel):
    logistics_name: str | None = None
    logistics_doc_id: str | None = None
    van_number: str | None = None
    collected_by_id: int | None = None
    status: str = 'IN_TRANSIT'


class ShipmentUpdate(BaseModel):
    status: str | None = None


class GRNItemCreate(BaseModel):
    pid: str
    product_id: int | None = None
    bundles: float = 0
    received_qty: float


class GRNCreate(BaseModel):
    supplier_id: int
    shipment_id: int | None = None
    rcv_document_id: str | None = None
    van_number: str | None = None
    bundle_count: int = 0
    date_checked: str | None = None
    location_id: int | None = None
    checked_by_id: int | None = None
    items: List[GRNItemCreate]


# --- SUPPLIER ROUTES ---

@router.get("/suppliers")
def get_suppliers(db: Session = Depends(get_db)):
    return db.query(inv_models.Supplier).order_by(inv_models.Supplier.name).all()


@router.post("/suppliers")
def create_supplier(supplier: SupplierCreate, db: Session = Depends(get_db)):
    new_supplier = inv_models.Supplier(**supplier.model_dump(exclude_unset=True))
    db.add(new_supplier)
    db.commit()
    db.refresh(new_supplier)
    return new_supplier


# --- PURCHASE ORDER ROUTES ---

@router.get("/orders")
def get_purchase_orders(db: Session = Depends(get_db)):
    return db.query(PurchaseOrder).options(selectinload(PurchaseOrder.supplier)).order_by(
        PurchaseOrder.po_id.desc()).all()


@router.post("/orders")
def create_purchase_order(po: POCreate, db: Session = Depends(get_db)):
    new_po = PurchaseOrder(
        supplier_id=po.supplier_id,
        document_id=po.document_id,
        target_delivery_date=po.target_delivery_date,
        payment_terms=po.payment_terms,
        status='DRAFT'
    )
    db.add(new_po)
    db.flush()
    grand_total = 0.0
    for item in po.items:
        prod_id = item.product_id or db.query(Product.product_id).filter(Product.pid == item.pid).scalar()
        if not prod_id: raise HTTPException(status_code=400, detail=f"Product {item.pid} not found")
        net = item.unit_gross_cost * (1 - item.discount)
        grand_total += (net * item.requested_qty)
        db.add(PurchaseOrderItem(po_id=new_po.po_id, product_id=prod_id, requested_qty=item.requested_qty,
                                 unit_gross_cost=item.unit_gross_cost, discount=item.discount, net_cost=net))
    new_po.total_value = grand_total
    db.commit()
    return {"message": "PO Created", "po_id": new_po.po_id}


# --- SHIPMENT ROUTES ---

@router.get("/shipments")
def get_shipments(db: Session = Depends(get_db)):
    return db.query(InboundShipment).options(selectinload(InboundShipment.collected_by)).all()


# --- GOODS RECEIPT (GRN) ROUTES ---

@router.get("/receipts")
def get_all_receipts(db: Session = Depends(get_db)):
    return db.query(GoodsReceipt).options(
        joinedload(GoodsReceipt.supplier),
        joinedload(GoodsReceipt.location),
        joinedload(GoodsReceipt.checked_by),
        joinedload(GoodsReceipt.items).joinedload(GoodsReceiptItem.product)
    ).order_by(GoodsReceipt.grn_id.desc()).all()


@router.post("/receipts")
def create_goods_receipt(grn: GRNCreate, db: Session = Depends(get_db)):
    new_grn = GoodsReceipt(
        supplier_id=grn.supplier_id,
        rcv_document_id=grn.rcv_document_id,
        van_number=grn.van_number,
        bundle_count=grn.bundle_count,
        date_collected=grn.date_checked,
        location_id=grn.location_id,
        checked_by_id=grn.checked_by_id,
        status='DRAFT'
    )
    db.add(new_grn)
    db.flush()

    for item in grn.items:
        prod_id = item.product_id or db.query(Product.product_id).filter(Product.pid == item.pid).scalar()
        db_item = GoodsReceiptItem(
            grn_id=new_grn.grn_id,
            product_id=prod_id,
            bundling=str(item.bundles),
            received_qty=item.received_qty
        )
        db.add(db_item)
    db.commit()
    return {"message": "GRN Draft Saved!", "grn_id": new_grn.grn_id}


@router.put("/receipts/{grn_id}")
def update_goods_receipt(grn_id: int, grn: GRNCreate, db: Session = Depends(get_db)):
    db_grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_id == grn_id).first()
    if not db_grn or db_grn.status != 'DRAFT':
        raise HTTPException(status_code=400, detail="Cannot edit confirmed record.")

    db_grn.supplier_id = grn.supplier_id
    db_grn.rcv_document_id = grn.rcv_document_id
    db_grn.van_number = grn.van_number
    db_grn.bundle_count = grn.bundle_count
    db_grn.date_collected = grn.date_checked
    db_grn.location_id = grn.location_id
    db_grn.checked_by_id = grn.checked_by_id

    db.query(GoodsReceiptItem).filter(GoodsReceiptItem.grn_id == grn_id).delete()
    for item in grn.items:
        prod_id = item.product_id or db.query(Product.product_id).filter(Product.pid == item.pid).scalar()
        db.add(GoodsReceiptItem(grn_id=grn_id, product_id=prod_id, bundling=str(item.bundles),
                                received_qty=item.received_qty))

    db.commit()
    return {"message": "GRN Updated"}


@router.put("/receipts/{grn_id}/confirm")
def confirm_goods_receipt(grn_id: int, db: Session = Depends(get_db)):
    grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_id == grn_id).first()
    if not grn or grn.status != 'DRAFT':
        raise HTTPException(status_code=400, detail="GRN not in draft status.")

    for item in grn.items:
        stock = db.query(CurrentStock).filter(CurrentStock.location_id == grn.location_id,
                                              CurrentStock.product_id == item.product_id).first()
        if stock:
            stock.quantity += item.received_qty
        else:
            db.add(CurrentStock(location_id=grn.location_id, product_id=item.product_id, quantity=item.received_qty))

        db.add(InventoryLedger(
            product_id=item.product_id, location_id=grn.location_id,
            qty_change=item.received_qty, reason=LedgerReason.RECEIVE,
            ref_table='goods_receipts', ref_pk=str(grn.grn_id)
        ))

    grn.status = 'CONFIRMED'
    db.commit()
    return {"message": "Confirmed"}


@router.put("/receipts/{grn_id}/void")
def void_goods_receipt(grn_id: int, db: Session = Depends(get_db)):
    grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_id == grn_id).first()
    if not grn or grn.status != 'CONFIRMED':
        raise HTTPException(status_code=400, detail="Can only void confirmed records.")

    for item in grn.items:
        stock = db.query(CurrentStock).filter(CurrentStock.location_id == grn.location_id,
                                              CurrentStock.product_id == item.product_id).first()
        if stock: stock.quantity -= item.received_qty

        db.add(InventoryLedger(
            product_id=item.product_id, location_id=grn.location_id,
            qty_change=-item.received_qty, reason=LedgerReason.ADJUST,
            ref_table='goods_receipts', ref_pk=str(grn.grn_id)
        ))

    grn.status = 'VOIDED'
    db.commit()
    return {"message": "Voided"}


@router.delete("/receipts/{grn_id}")
def delete_goods_receipt(grn_id: int, db: Session = Depends(get_db)):
    grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_id == grn_id).first()
    if not grn or grn.status != 'DRAFT':
        raise HTTPException(status_code=400, detail="Can only delete drafts.")
    db.delete(grn)
    db.commit()
    return {"message": "Deleted"}