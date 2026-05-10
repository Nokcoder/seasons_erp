from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from typing import List, Dict, Optional
from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime
from core.database import get_db
from inventory import models, schemas

from auth.dependencies import require_permission

router = APIRouter(prefix="/api/transfers", tags=["Stock Transfers"])


# ==========================================
# PAYLOAD BLUEPRINTS (Pydantic Schemas)
# ==========================================
class TransferActionPayload(BaseModel):
    items: Dict[int, Decimal]  # { item_id: qty } -> Used for Releasing

class UnexpectedItemPayload(BaseModel):
    product_id: int
    received_qty: Decimal
    bundling: Optional[str] = None

class TransferReceivePayload(BaseModel):
    items: Dict[int, Decimal]  # { item_id: qty } -> Expected items
    unexpected_items: List[UnexpectedItemPayload] = []  # Brand new rows

class TransferHeaderUpdate(BaseModel):
    document_id: Optional[str] = None
    released_by_id: Optional[int] = None
    received_by_id: Optional[int] = None


# ==========================================
# GET ROUTES (Reading Data)
# ==========================================
@router.get("/users/all", response_model=List[schemas.UserSchema])
def get_all_users(db: Session = Depends(get_db)):
    return db.query(models.User).filter(models.User.is_active == True).all()

@router.get("/locations/all", response_model=List[schemas.TransferLocationSchema])
def get_all_locations(db: Session = Depends(get_db)):
    return db.query(models.Location).all()

# Add this schema near your other Pydantic schemas at the top
class LocationCreate(BaseModel):
    name: str
    parent_location_id: Optional[int] = None
    type: Optional[str] = "BIN"

# Add this route beneath your get("/locations/all") route
@router.post("/locations", response_model=schemas.TransferLocationSchema)
def create_location(payload: LocationCreate, db: Session = Depends(get_db)):
    new_loc = models.Location(
        name=payload.name,
        parent_location_id=payload.parent_location_id,
        type=payload.type,
        is_active=True
    )
    db.add(new_loc)
    db.commit()
    db.refresh(new_loc)
    return new_loc


# The payload schema for an update
class LocationUpdate(BaseModel):
    name: str


# The update route
@router.put("/locations/{location_id}", response_model=schemas.TransferLocationSchema)
def update_location(location_id: int, payload: LocationUpdate, db: Session = Depends(get_db)):
    db_loc = db.query(models.Location).filter(models.Location.location_id == location_id).first()

    if not db_loc:
        raise HTTPException(status_code=404, detail="Location not found")

    db_loc.name = payload.name
    db.commit()
    db.refresh(db_loc)
    return db_loc




@router.get("/", response_model=List[schemas.StockTransferSchema])
def get_transfers(db: Session = Depends(get_db)):
    return db.query(models.StockTransfer).options(
        selectinload(models.StockTransfer.from_location),
        selectinload(models.StockTransfer.to_location),
        selectinload(models.StockTransfer.released_by),
        selectinload(models.StockTransfer.received_by)
    ).order_by(models.StockTransfer.transfer_date.desc()).all()

@router.get("/{transfer_id}", response_model=schemas.StockTransferSchema)
def get_transfer(transfer_id: int, db: Session = Depends(get_db)):
    transfer = db.query(models.StockTransfer).filter(models.StockTransfer.transfer_id == transfer_id).options(
        selectinload(models.StockTransfer.from_location),
        selectinload(models.StockTransfer.to_location),
        selectinload(models.StockTransfer.released_by),
        selectinload(models.StockTransfer.received_by),
        selectinload(models.StockTransfer.items).selectinload(models.StockTransferItem.product)
    ).first()

    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer Document not found")
    return transfer


# ==========================================
# POST/PUT ROUTES (Actioning Data)
# ==========================================

# 1. CREATE TRANSFER (And auto-process if admin)
@router.post("/", response_model=schemas.StockTransferSchema)
def create_transfer(payload: schemas.StockTransferCreate, db: Session = Depends(get_db)):
    new_transfer = models.StockTransfer(
        document_id=payload.document_id,
        transfer_date=datetime.utcnow(),
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        released_by_id=payload.released_by_id,
        received_by_id=payload.received_by_id,
        bundle_count=payload.bundle_count,
        status="COMPLETED" if payload.is_direct else "REQUESTED",
        has_discrepancy=False
    )
    db.add(new_transfer)
    db.flush()

    for item in payload.items:
        db.add(models.StockTransferItem(
            transfer_id=new_transfer.transfer_id,
            product_id=item.product_id,
            bundling=item.bundling,
            requested_qty=item.requested_qty,
            released_qty=item.requested_qty if payload.is_direct else None,
            received_qty=item.requested_qty if payload.is_direct else None
        ))

        if payload.is_direct:
            from_stock = db.query(models.CurrentStock).filter_by(
                product_id=item.product_id, location_id=payload.from_location_id
            ).first()
            if from_stock:
                from_stock.quantity -= item.requested_qty
            else:
                db.add(models.CurrentStock(product_id=item.product_id, location_id=payload.from_location_id, quantity=-item.requested_qty))

            to_stock = db.query(models.CurrentStock).filter_by(
                product_id=item.product_id, location_id=payload.to_location_id
            ).first()
            if to_stock:
                to_stock.quantity += item.requested_qty
            else:
                db.add(models.CurrentStock(product_id=item.product_id, location_id=payload.to_location_id, quantity=item.requested_qty))

    db.commit()
    return get_transfer(new_transfer.transfer_id, db)


# 2. RELEASE TRANSFER (Warehouse puts it on the truck)
@router.put("/{transfer_id}/release", response_model=schemas.StockTransferSchema)
def release_transfer(transfer_id: int, payload: TransferActionPayload, db: Session = Depends(get_db)):
    transfer = db.query(models.StockTransfer).filter(models.StockTransfer.transfer_id == transfer_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    for item in transfer.items:
        if item.item_id in payload.items:
            item.released_qty = payload.items[item.item_id]

            from_stock = db.query(models.CurrentStock).filter(
                models.CurrentStock.product_id == item.product_id,
                models.CurrentStock.location_id == transfer.from_location_id
            ).first()

            if from_stock:
                from_stock.quantity -= item.released_qty
            else:
                db.add(models.CurrentStock(product_id=item.product_id, location_id=transfer.from_location_id, quantity=-item.released_qty))

    transfer.status = "IN_TRANSIT"
    db.commit()
    return get_transfer(transfer_id, db)


# 3. RECEIVE TRANSFER (Destination signs for it and checks discrepancies)
@router.put("/{transfer_id}/receive", response_model=schemas.StockTransferSchema)
def receive_transfer(transfer_id: int, payload: TransferReceivePayload, db: Session = Depends(get_db)):
    transfer = db.query(models.StockTransfer).filter(models.StockTransfer.transfer_id == transfer_id).first()
    discrepancy_found = False

    for item in transfer.items:
        if item.item_id in payload.items:
            item.received_qty = payload.items[item.item_id]

            if item.received_qty != item.released_qty:
                discrepancy_found = True

            to_stock = db.query(models.CurrentStock).filter(
                models.CurrentStock.product_id == item.product_id,
                models.CurrentStock.location_id == transfer.to_location_id
            ).first()

            if to_stock:
                to_stock.quantity += item.received_qty
            elif item.received_qty > 0:
                new_stock = models.CurrentStock(product_id=item.product_id, location_id=transfer.to_location_id, quantity=item.received_qty)
                db.add(new_stock)

    for un_item in payload.unexpected_items:
        discrepancy_found = True
        new_row = models.StockTransferItem(
            transfer_id=transfer.transfer_id,
            product_id=un_item.product_id,
            bundling=un_item.bundling,
            requested_qty=0,
            released_qty=0,
            received_qty=un_item.received_qty
        )
        db.add(new_row)

        to_stock = db.query(models.CurrentStock).filter(
            models.CurrentStock.product_id == un_item.product_id,
            models.CurrentStock.location_id == transfer.to_location_id
        ).first()

        if to_stock:
            to_stock.quantity += un_item.received_qty
        else:
            db.add(models.CurrentStock(product_id=un_item.product_id, location_id=transfer.to_location_id, quantity=un_item.received_qty))

    transfer.has_discrepancy = discrepancy_found
    transfer.status = "COMPLETED"
    db.commit()

    return get_transfer(transfer_id, db)


# --- UPDATE TRANSFER HEADER (Admin Only) ---
class TransferHeaderUpdate(BaseModel):
    document_id: Optional[str] = None
    released_by_id: Optional[int] = None
    received_by_id: Optional[int] = None


@router.put("/{transfer_id}/header", response_model=schemas.StockTransferSchema)
def update_transfer_header(transfer_id: int, payload: TransferHeaderUpdate, db: Session = Depends(get_db)):
    transfer = db.query(models.StockTransfer).filter(models.StockTransfer.transfer_id == transfer_id).first()

    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    # Only update what was provided
    if payload.document_id is not None:
        transfer.document_id = payload.document_id
    if payload.released_by_id is not None:
        transfer.released_by_id = payload.released_by_id
    if payload.received_by_id is not None:
        transfer.received_by_id = payload.received_by_id

    db.commit()
    # Return the full nested object using our existing GET function
    return get_transfer(transfer_id, db)


@router.put("/{transfer_id}/header", response_model=schemas.StockTransferSchema)
def update_transfer_header(
        transfer_id: int,
        payload: TransferHeaderUpdate,
        db: Session = Depends(get_db),
        user: models.User = Depends(require_permission("edit_transfer_header"))  # BOUNCER ATTACHED!
):
    transfer = db.query(models.StockTransfer).filter(models.StockTransfer.transfer_id == transfer_id).first()

    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    if payload.document_id is not None:
        transfer.document_id = payload.document_id
    if payload.released_by_id is not None:
        transfer.released_by_id = payload.released_by_id
    if payload.received_by_id is not None:
        transfer.received_by_id = payload.received_by_id

    db.commit()
    return get_transfer(transfer_id, db)  # Re-fetch to return the full nested object