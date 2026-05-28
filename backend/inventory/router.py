# inventory/router.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.exc import IntegrityError

from core.database import get_db
from inventory import models, schemas

router = APIRouter(prefix="/products", tags=["Products"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_product(product_id: int, db: Session) -> models.Product:
    product = (
        db.query(models.Product)
        .options(
            selectinload(models.Product.categories),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.suppliers)
                .selectinload(models.VariantSupplier.supplier),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.cost_layers),
        )
        .filter(
            models.Product.product_id == product_id,
            models.Product.is_deleted == False,
        )
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def _enforce_single_default(product_id: int, new_default_id: int, db: Session) -> None:
    """Unset is_default on every other variant for this product, then set it on new_default_id."""
    (
        db.query(models.Variant)
        .filter(
            models.Variant.product_id == product_id,
            models.Variant.variant_id != new_default_id,
            models.Variant.is_deleted == False,
        )
        .update({"is_default": False}, synchronize_session="fetch")
    )


def _resolve_categories(names: List[str], db: Session) -> List[models.ProductCategory]:
    cats = []
    for name in names:
        cat = (
            db.query(models.ProductCategory)
            .filter(models.ProductCategory.category_name.ilike(name.strip()))
            .first()
        )
        if not cat:
            cat = models.ProductCategory(category_name=name.strip())
            db.add(cat)
        cats.append(cat)
    return cats


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/", response_model=List[schemas.ProductOut])
def list_products(db: Session = Depends(get_db)):
    return (
        db.query(models.Product)
        .options(
            selectinload(models.Product.categories),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.suppliers)
                .selectinload(models.VariantSupplier.supplier),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.cost_layers),
        )
        .filter(models.Product.is_deleted == False)
        .all()
    )


@router.get("/{product_id}", response_model=schemas.ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    return _load_product(product_id, db)


@router.post("/", response_model=schemas.ProductOut, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    if not payload.variants:
        raise HTTPException(status_code=400, detail="At least one variant is required")

    product = models.Product(
        name=payload.name,
        product_type=payload.product_type,
        description=payload.description,
        base_uom_id=payload.base_uom_id,
    )

    if payload.category_names:
        product.categories = _resolve_categories(payload.category_names, db)

    db.add(product)
    db.flush()  # get product_id

    defaults = [v for v in payload.variants if v.is_default]
    if len(defaults) > 1:
        db.rollback()
        raise HTTPException(status_code=400, detail="Only one variant may have is_default=true")

    # auto-assign default to first variant if none is marked
    if not defaults:
        payload.variants[0].is_default = True

    for v in payload.variants:
        # ensure PID is unique
        if db.query(models.Variant).filter(models.Variant.PID == v.PID).first():
            db.rollback()
            raise HTTPException(status_code=400, detail=f"PID '{v.PID}' already exists")
        db.add(models.Variant(
            product_id=product.product_id,
            PID=v.PID,
            variant_name=v.variant_name,
            sku=v.sku,
            price=v.price,
            promo_price=v.promo_price,
            is_default=v.is_default,
            attributes=v.attributes,
        ))

    db.commit()
    return _load_product(product.product_id, db)


@router.put("/{product_id}", response_model=schemas.ProductOut)
def update_product(
    product_id: int,
    payload: schemas.ProductUpdate,
    db: Session = Depends(get_db),
):
    product = _load_product(product_id, db)
    data = payload.model_dump(exclude_unset=True)

    if "category_names" in data:
        product.categories = _resolve_categories(data.pop("category_names") or [], db)

    for key, value in data.items():
        setattr(product, key, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Database error")

    return _load_product(product_id, db)


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = _load_product(product_id, db)
    product.is_deleted = True
    # cascade soft-delete to all active variants
    (
        db.query(models.Variant)
        .filter(
            models.Variant.product_id == product_id,
            models.Variant.is_deleted == False,
        )
        .update({"is_deleted": True}, synchronize_session="fetch")
    )
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/{product_id}/variants", response_model=schemas.ProductOut, status_code=201)
def add_variant(
    product_id: int,
    payload: schemas.VariantCreate,
    db: Session = Depends(get_db),
):
    product = _load_product(product_id, db)

    if db.query(models.Variant).filter(models.Variant.PID == payload.PID).first():
        raise HTTPException(status_code=400, detail=f"PID '{payload.PID}' already exists")

    new_variant = models.Variant(
        product_id=product.product_id,
        PID=payload.PID,
        variant_name=payload.variant_name,
        sku=payload.sku,
        price=payload.price,
        promo_price=payload.promo_price,
        is_default=payload.is_default,
        attributes=payload.attributes,
    )
    db.add(new_variant)
    db.flush()  # get variant_id before enforcing exclusivity

    if payload.is_default:
        _enforce_single_default(product.product_id, new_variant.variant_id, db)

    db.commit()
    return _load_product(product_id, db)


@router.put("/variants/{variant_id}", response_model=schemas.VariantOut)
def update_variant(
    variant_id: int,
    payload: schemas.VariantUpdate,
    db: Session = Depends(get_db),
):
    variant = (
        db.query(models.Variant)
        .filter(models.Variant.variant_id == variant_id, models.Variant.is_deleted == False)
        .first()
    )
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")

    updates = payload.model_dump(exclude_unset=True)

    if updates.get("is_default") is True:
        _enforce_single_default(variant.product_id, variant.variant_id, db)
    elif updates.get("is_default") is False and variant.is_default:
        # Unsetting the current default would leave the product with no default.
        raise HTTPException(
            status_code=400,
            detail="Cannot unset the only default variant — promote another variant first",
        )

    for key, value in updates.items():
        setattr(variant, key, value)

    try:
        db.commit()
        db.refresh(variant)
        return variant
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Database error")


@router.delete("/variants/{variant_id}", status_code=204)
def delete_variant(variant_id: int, db: Session = Depends(get_db)):
    variant = (
        db.query(models.Variant)
        .filter(models.Variant.variant_id == variant_id, models.Variant.is_deleted == False)
        .first()
    )
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")
    if variant.is_default:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default variant — promote another variant first",
        )
    variant.is_deleted = True
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# INVENTORY LEDGER
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}/ledger", response_model=List[schemas.LedgerEntryOut])
def get_variant_ledger(
    variant_id: int,
    location_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Returns the full ledger for a variant, optionally filtered by location."""
    q = (
        db.query(models.InventoryLedger)
        .filter(models.InventoryLedger.variant_id == variant_id)
    )
    if location_id is not None:
        q = q.filter(models.InventoryLedger.location_id == location_id)

    entries = q.order_by(models.InventoryLedger.occurred_at.desc()).all()

    if not entries and not db.query(models.Variant).filter(
        models.Variant.variant_id == variant_id
    ).first():
        raise HTTPException(status_code=404, detail="Variant not found")

    return entries


# ═══════════════════════════════════════════════════════════════════════════════
# SUPPLIERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/suppliers/all", response_model=List[schemas.SupplierOut])
def list_suppliers(db: Session = Depends(get_db)):
    return (
        db.query(models.Supplier)
        .filter(models.Supplier.is_deleted == False)
        .all()
    )


@router.get("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def get_supplier(supplier_id: int, db: Session = Depends(get_db)):
    supplier = (
        db.query(models.Supplier)
        .filter(models.Supplier.supplier_id == supplier_id, models.Supplier.is_deleted == False)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.post("/suppliers", response_model=schemas.SupplierOut, status_code=201)
def create_supplier(payload: schemas.SupplierCreate, db: Session = Depends(get_db)):
    supplier = models.Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
):
    supplier = (
        db.query(models.Supplier)
        .filter(models.Supplier.supplier_id == supplier_id, models.Supplier.is_deleted == False)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(supplier, key, value)

    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
    supplier = (
        db.query(models.Supplier)
        .filter(models.Supplier.supplier_id == supplier_id, models.Supplier.is_deleted == False)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    supplier.is_deleted = True
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANT BARCODES
# ═══════════════════════════════════════════════════════════════════════════════

def _get_variant_or_404(variant_id: int, db: Session) -> models.Variant:
    v = db.query(models.Variant).filter(
        models.Variant.variant_id == variant_id,
        models.Variant.is_deleted == False,
    ).first()
    if not v:
        raise HTTPException(status_code=404, detail="Variant not found")
    return v


@router.get("/variants/{variant_id}/barcodes", response_model=List[schemas.VariantBarcodeOut])
def list_barcodes(variant_id: int, db: Session = Depends(get_db)):
    _get_variant_or_404(variant_id, db)
    return (
        db.query(models.VariantBarcode)
        .filter(models.VariantBarcode.variant_id == variant_id)
        .all()
    )


@router.post("/variants/{variant_id}/barcodes",
             response_model=schemas.VariantBarcodeOut, status_code=201)
def add_barcode(
    variant_id: int,
    payload: schemas.VariantBarcodeCreate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)

    if db.query(models.VariantBarcode).filter(
        models.VariantBarcode.barcode == payload.barcode
    ).first():
        raise HTTPException(status_code=400, detail="Barcode already exists")

    if payload.is_primary:
        db.query(models.VariantBarcode).filter(
            models.VariantBarcode.variant_id == variant_id,
        ).update({"is_primary": False}, synchronize_session="fetch")

    bc = models.VariantBarcode(
        variant_id=variant_id,
        barcode=payload.barcode,
        uom_id=payload.uom_id,
        is_primary=payload.is_primary,
    )
    db.add(bc)
    db.commit()
    db.refresh(bc)
    return bc


@router.put("/variants/{variant_id}/barcodes/{barcode_id}",
            response_model=schemas.VariantBarcodeOut)
def update_barcode(
    variant_id: int,
    barcode_id: int,
    payload: schemas.VariantBarcodeUpdate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    bc = db.query(models.VariantBarcode).filter(
        models.VariantBarcode.barcode_id == barcode_id,
        models.VariantBarcode.variant_id == variant_id,
    ).first()
    if not bc:
        raise HTTPException(status_code=404, detail="Barcode not found")

    updates = payload.model_dump(exclude_unset=True)

    if updates.get("is_primary") is True:
        db.query(models.VariantBarcode).filter(
            models.VariantBarcode.variant_id == variant_id,
            models.VariantBarcode.barcode_id != barcode_id,
        ).update({"is_primary": False}, synchronize_session="fetch")

    for key, value in updates.items():
        setattr(bc, key, value)

    db.commit()
    db.refresh(bc)
    return bc


@router.delete("/variants/{variant_id}/barcodes/{barcode_id}", status_code=204)
def delete_barcode(variant_id: int, barcode_id: int, db: Session = Depends(get_db)):
    _get_variant_or_404(variant_id, db)
    bc = db.query(models.VariantBarcode).filter(
        models.VariantBarcode.barcode_id == barcode_id,
        models.VariantBarcode.variant_id == variant_id,
    ).first()
    if not bc:
        raise HTTPException(status_code=404, detail="Barcode not found")
    db.delete(bc)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANT UOM CONVERSIONS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}/uom-conversions",
            response_model=List[schemas.VariantUomConversionOut])
def list_uom_conversions(variant_id: int, db: Session = Depends(get_db)):
    _get_variant_or_404(variant_id, db)
    return (
        db.query(models.VariantUomConversion)
        .filter(models.VariantUomConversion.variant_id == variant_id)
        .all()
    )


@router.post("/variants/{variant_id}/uom-conversions",
             response_model=schemas.VariantUomConversionOut, status_code=201)
def add_uom_conversion(
    variant_id: int,
    payload: schemas.VariantUomConversionCreate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)

    exists = db.query(models.VariantUomConversion).filter(
        models.VariantUomConversion.variant_id == variant_id,
        models.VariantUomConversion.from_uom_id == payload.from_uom_id,
        models.VariantUomConversion.to_uom_id == payload.to_uom_id,
    ).first()
    if exists:
        raise HTTPException(
            status_code=400,
            detail="Conversion for this from/to UOM pair already exists — use PUT to update",
        )

    conv = models.VariantUomConversion(
        variant_id=variant_id,
        from_uom_id=payload.from_uom_id,
        to_uom_id=payload.to_uom_id,
        factor=payload.factor,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@router.put("/variants/{variant_id}/uom-conversions/{from_uom_id}/{to_uom_id}",
            response_model=schemas.VariantUomConversionOut)
def update_uom_conversion(
    variant_id: int,
    from_uom_id: int,
    to_uom_id: int,
    payload: schemas.VariantUomConversionUpdate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    conv = db.query(models.VariantUomConversion).filter(
        models.VariantUomConversion.variant_id == variant_id,
        models.VariantUomConversion.from_uom_id == from_uom_id,
        models.VariantUomConversion.to_uom_id == to_uom_id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="UOM conversion not found")

    conv.factor = payload.factor
    db.commit()
    db.refresh(conv)
    return conv


@router.delete("/variants/{variant_id}/uom-conversions/{from_uom_id}/{to_uom_id}",
               status_code=204)
def delete_uom_conversion(
    variant_id: int,
    from_uom_id: int,
    to_uom_id: int,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    conv = db.query(models.VariantUomConversion).filter(
        models.VariantUomConversion.variant_id == variant_id,
        models.VariantUomConversion.from_uom_id == from_uom_id,
        models.VariantUomConversion.to_uom_id == to_uom_id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="UOM conversion not found")
    db.delete(conv)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANT SUPPLIERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}/suppliers",
            response_model=List[schemas.VariantSupplierOut])
def list_variant_suppliers(variant_id: int, db: Session = Depends(get_db)):
    _get_variant_or_404(variant_id, db)
    return (
        db.query(models.VariantSupplier)
        .options(selectinload(models.VariantSupplier.supplier))
        .filter(models.VariantSupplier.variant_id == variant_id)
        .all()
    )


@router.post("/variants/{variant_id}/suppliers",
             response_model=schemas.VariantSupplierOut, status_code=201)
def add_variant_supplier(
    variant_id: int,
    payload: schemas.VariantSupplierCreate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)

    if not db.query(models.Supplier).filter(
        models.Supplier.supplier_id == payload.supplier_id,
        models.Supplier.is_deleted == False,
    ).first():
        raise HTTPException(status_code=404, detail="Supplier not found")

    if db.query(models.VariantSupplier).filter(
        models.VariantSupplier.variant_id == variant_id,
        models.VariantSupplier.supplier_id == payload.supplier_id,
    ).first():
        raise HTTPException(
            status_code=400, detail="Supplier already linked to this variant"
        )

    if payload.is_primary:
        db.query(models.VariantSupplier).filter(
            models.VariantSupplier.variant_id == variant_id,
        ).update({"is_primary": False}, synchronize_session="fetch")

    vs = models.VariantSupplier(
        variant_id=variant_id,
        supplier_id=payload.supplier_id,
        supplier_sku=payload.supplier_sku,
        gross_cost=payload.gross_cost,
        supplier_discount=payload.supplier_discount,
        is_primary=payload.is_primary,
    )
    db.add(vs)
    db.commit()
    db.refresh(vs)

    return (
        db.query(models.VariantSupplier)
        .options(selectinload(models.VariantSupplier.supplier))
        .filter(models.VariantSupplier.id == vs.id)
        .first()
    )


@router.put("/variants/{variant_id}/suppliers/{vs_id}",
            response_model=schemas.VariantSupplierOut)
def update_variant_supplier(
    variant_id: int,
    vs_id: int,
    payload: schemas.VariantSupplierUpdate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    vs = db.query(models.VariantSupplier).filter(
        models.VariantSupplier.id == vs_id,
        models.VariantSupplier.variant_id == variant_id,
    ).first()
    if not vs:
        raise HTTPException(status_code=404, detail="Variant supplier link not found")

    updates = payload.model_dump(exclude_unset=True)

    if updates.get("is_primary") is True:
        db.query(models.VariantSupplier).filter(
            models.VariantSupplier.variant_id == variant_id,
            models.VariantSupplier.id != vs_id,
        ).update({"is_primary": False}, synchronize_session="fetch")

    for key, value in updates.items():
        setattr(vs, key, value)

    db.commit()

    return (
        db.query(models.VariantSupplier)
        .options(selectinload(models.VariantSupplier.supplier))
        .filter(models.VariantSupplier.id == vs_id)
        .first()
    )


@router.delete("/variants/{variant_id}/suppliers/{vs_id}", status_code=204)
def delete_variant_supplier(
    variant_id: int,
    vs_id: int,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    vs = db.query(models.VariantSupplier).filter(
        models.VariantSupplier.id == vs_id,
        models.VariantSupplier.variant_id == variant_id,
    ).first()
    if not vs:
        raise HTTPException(status_code=404, detail="Variant supplier link not found")
    db.delete(vs)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# BUNDLE COMPONENTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}/bundle-components",
            response_model=List[schemas.BundleComponentOut])
def list_bundle_components(variant_id: int, db: Session = Depends(get_db)):
    _get_variant_or_404(variant_id, db)
    return (
        db.query(models.BundleComponent)
        .filter(models.BundleComponent.bundle_variant_id == variant_id)
        .all()
    )


@router.post("/variants/{variant_id}/bundle-components",
             response_model=schemas.BundleComponentOut, status_code=201)
def add_bundle_component(
    variant_id: int,
    payload: schemas.BundleComponentCreate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)

    if payload.component_variant_id == variant_id:
        raise HTTPException(
            status_code=400, detail="A variant cannot be a component of itself"
        )

    # validate component variant exists and is not soft-deleted
    if not db.query(models.Variant).filter(
        models.Variant.variant_id == payload.component_variant_id,
        models.Variant.is_deleted == False,
    ).first():
        raise HTTPException(status_code=404, detail="Component variant not found")

    if db.query(models.BundleComponent).filter(
        models.BundleComponent.bundle_variant_id == variant_id,
        models.BundleComponent.component_variant_id == payload.component_variant_id,
    ).first():
        raise HTTPException(
            status_code=400, detail="Component already in this bundle — use PUT to update"
        )

    bc = models.BundleComponent(
        bundle_variant_id=variant_id,
        component_variant_id=payload.component_variant_id,
        quantity=payload.quantity,
    )
    db.add(bc)
    db.commit()
    db.refresh(bc)
    return bc


@router.put("/variants/{variant_id}/bundle-components/{component_variant_id}",
            response_model=schemas.BundleComponentOut)
def update_bundle_component(
    variant_id: int,
    component_variant_id: int,
    payload: schemas.BundleComponentUpdate,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    bc = db.query(models.BundleComponent).filter(
        models.BundleComponent.bundle_variant_id == variant_id,
        models.BundleComponent.component_variant_id == component_variant_id,
    ).first()
    if not bc:
        raise HTTPException(status_code=404, detail="Bundle component not found")

    bc.quantity = payload.quantity
    db.commit()
    db.refresh(bc)
    return bc


@router.delete("/variants/{variant_id}/bundle-components/{component_variant_id}",
               status_code=204)
def delete_bundle_component(
    variant_id: int,
    component_variant_id: int,
    db: Session = Depends(get_db),
):
    _get_variant_or_404(variant_id, db)
    bc = db.query(models.BundleComponent).filter(
        models.BundleComponent.bundle_variant_id == variant_id,
        models.BundleComponent.component_variant_id == component_variant_id,
    ).first()
    if not bc:
        raise HTTPException(status_code=404, detail="Bundle component not found")
    db.delete(bc)
    db.commit()
