# inventory/router.py
from typing import List, Optional
from decimal import Decimal
from math import floor
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.exc import IntegrityError

from core.database import get_db
from core.audit import write_audit, _serialize
from auth.dependencies import get_current_user, require_permission
from auth.models import User
from inventory import models, schemas

router = APIRouter(
    prefix="/products",
    tags=["Products"],
    dependencies=[Depends(get_current_user)],
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_product(product_id: int, db: Session) -> models.Product:
    product = (
        db.query(models.Product)
        .options(
            selectinload(models.Product.base_uom),
            selectinload(models.Product.categories),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.suppliers)
                .selectinload(models.VariantSupplier.supplier),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.cost_layers),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.barcodes),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.uom_conversions),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.bundle_components)
                .selectinload(models.BundleComponent.component_variant),
        )
        .filter(
            models.Product.product_id == product_id,
            models.Product.is_deleted == False,
        )
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    _enrich_resolved_barcode([product])
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


def _compute_bundle_available(variant: models.Variant) -> list:
    """Compute available bundle count per physical location.

    For each physical location that any component has stock at, returns
    min(floor(comp_stock / comp_qty)) across all components.
    Returns a list of dicts suitable for BundleAvailableStock serialization.
    """
    if not variant.bundle_components:
        return []

    loc_ids: set[int] = set()
    for comp in variant.bundle_components:
        if comp.component_variant:
            for cs in comp.component_variant.current_stock:
                if cs.location and cs.location.location_type != "Virtual":
                    loc_ids.add(cs.location_id)

    result = []
    for loc_id in loc_ids:
        loc_name = str(loc_id)
        min_avail: int | None = None

        for comp in variant.bundle_components:
            if not comp.component_variant:
                min_avail = 0
                break
            comp_stock = next(
                (cs.quantity for cs in comp.component_variant.current_stock
                 if cs.location_id == loc_id),
                Decimal("0"),
            )
            for cs in comp.component_variant.current_stock:
                if cs.location_id == loc_id and cs.location:
                    loc_name = cs.location.location_name
            comp_qty = comp.quantity or Decimal("1")
            comp_avail = floor(float(comp_stock) / float(comp_qty))
            if min_avail is None or comp_avail < min_avail:
                min_avail = comp_avail

        if min_avail is not None:
            result.append({
                "location_id":   loc_id,
                "location_name": loc_name,
                "available":     min_avail,
            })

    return result


def _enrich_bundle_stock(products: list) -> None:
    """Attach computed bundle_available_stock to every bundle variant in-place."""
    for product in products:
        for variant in product.variants:
            if variant.bundle_components:
                variant.bundle_available_stock = _compute_bundle_available(variant)
            else:
                variant.bundle_available_stock = []


def _resolve_barcode(variant: "models.Variant") -> str:
    """Computed scannable value for a variant — never written to
    variant_barcodes, always evaluated fresh on read (see
    docs/pid_editability_fix.md Fix 2).

    Resolution order: the variant's explicit primary barcode at the
    product's base UOM, else the variant's own PID. The PID fallback
    applies only at the base UOM — no fallback exists for other UOMs."""
    base_uom_id = variant.product.base_uom_id if variant.product else None
    for bc in variant.barcodes:
        if bc.is_primary and bc.uom_id == base_uom_id:
            return bc.barcode
    return variant.PID


def _enrich_resolved_barcode(products: list) -> None:
    """Attach the computed resolved_barcode to every variant in-place."""
    for product in products:
        for variant in product.variants:
            variant.resolved_barcode = _resolve_barcode(variant)


def _check_pid_barcode_collision(pid: str, variant_id: Optional[int], db: Session) -> None:
    """App-level guard (Fix 3, docs/pid_editability_fix.md): a PID must never
    match another variant's explicit barcode — that barcode is the other
    variant's scannable identity and must stay unambiguous. variant_id is
    None when creating a brand-new variant (nothing yet to exclude)."""
    q = db.query(models.VariantBarcode).filter(models.VariantBarcode.barcode == pid)
    if variant_id is not None:
        q = q.filter(models.VariantBarcode.variant_id != variant_id)
    if q.first():
        raise HTTPException(status_code=400, detail="PID already in use as another variant's barcode")


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
# UOMs
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/uoms", response_model=List[schemas.UOMOut], dependencies=[Depends(require_permission("view_inventory"))])
def list_uoms(db: Session = Depends(get_db)):
    return db.query(models.UOM).filter(models.UOM.is_deleted == False).all()


@router.post("/uoms", response_model=schemas.UOMOut, status_code=201)
def create_uom(payload: schemas.UOMCreate, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_uoms"))):
    if db.query(models.UOM).filter(
        models.UOM.uom_code == payload.uom_code.upper()
    ).first():
        raise HTTPException(status_code=400, detail="UOM code already exists")
    uom = models.UOM(uom_code=payload.uom_code.upper(), uom_name=payload.uom_name)
    db.add(uom)
    db.commit()
    db.refresh(uom)
    return uom


@router.patch("/uoms/{uom_id}", response_model=schemas.UOMOut)
def update_uom(uom_id: int, payload: schemas.UOMUpdate, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_uoms"))):
    uom = db.query(models.UOM).filter(
        models.UOM.uom_id == uom_id, models.UOM.is_deleted == False
    ).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")
    if payload.uom_name is not None:
        uom.uom_name = payload.uom_name
    db.commit()
    db.refresh(uom)
    return uom


@router.delete("/uoms/{uom_id}", status_code=204)
def delete_uom(uom_id: int, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_uoms"))):
    """Hard-delete a UOM. Blocked if any product, barcode, or conversion references it."""
    uom = db.query(models.UOM).filter(models.UOM.uom_id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")

    product_count = db.query(models.Product).filter(
        models.Product.base_uom_id == uom_id,
        models.Product.is_deleted == False,
    ).count()
    barcode_count = db.query(models.VariantBarcode).filter(
        models.VariantBarcode.uom_id == uom_id
    ).count()
    conv_count = db.query(models.VariantUomConversion).filter(
        (models.VariantUomConversion.from_uom_id == uom_id) |
        (models.VariantUomConversion.to_uom_id   == uom_id)
    ).count()

    total = product_count + barcode_count + conv_count
    if total > 0:
        parts = []
        if product_count: parts.append(f"{product_count} product base UOM")
        if barcode_count: parts.append(f"{barcode_count} barcode(s)")
        if conv_count:    parts.append(f"{conv_count} UOM conversion(s)")
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete '{uom.uom_code}': referenced by {', '.join(parts)}",
        )

    db.delete(uom)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# CATEGORIES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/categories", response_model=List[schemas.CategoryOut], dependencies=[Depends(require_permission("view_inventory"))])
def list_categories(db: Session = Depends(get_db)):
    return (
        db.query(models.ProductCategory)
        .filter(models.ProductCategory.is_deleted == False)
        .all()
    )


@router.post("/categories", response_model=schemas.CategoryOut, status_code=201)
def create_category(payload: schemas.CategoryCreate, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_categories"))):
    if db.query(models.ProductCategory).filter(
        models.ProductCategory.category_name == payload.category_name
    ).first():
        raise HTTPException(status_code=400, detail="Category name already exists")
    if payload.parent_category_id:
        if not db.query(models.ProductCategory).filter(
            models.ProductCategory.category_id == payload.parent_category_id,
            models.ProductCategory.is_deleted == False,
        ).first():
            raise HTTPException(status_code=404, detail="Parent category not found")
    cat = models.ProductCategory(
        category_name=payload.category_name,
        parent_category_id=payload.parent_category_id,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/categories/{category_id}", response_model=schemas.CategoryOut)
def update_category(
    category_id: int, payload: schemas.CategoryUpdate, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_categories"))):
    cat = db.query(models.ProductCategory).filter(
        models.ProductCategory.category_id == category_id,
        models.ProductCategory.is_deleted == False,
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(cat, key, value)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_categories"))):
    """Hard-delete a category. Blocked if any products are linked or child categories exist."""
    cat = db.query(models.ProductCategory).filter(
        models.ProductCategory.category_id == category_id,
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    # Count products linked via junction table
    from sqlalchemy import text
    product_count = db.execute(
        text("SELECT COUNT(*) FROM inventory.product_category_links WHERE category_id = :cid"),
        {"cid": category_id},
    ).scalar() or 0

    child_count = db.query(models.ProductCategory).filter(
        models.ProductCategory.parent_category_id == category_id,
        models.ProductCategory.is_deleted == False,
    ).count()

    total = product_count + child_count
    if total > 0:
        parts = []
        if product_count: parts.append(f"{product_count} product(s)")
        if child_count:   parts.append(f"{child_count} child categor{'y' if child_count == 1 else 'ies'}")
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete '{cat.category_name}': referenced by {', '.join(parts)}",
        )

    db.delete(cat)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/", response_model=List[schemas.ProductOut], dependencies=[Depends(require_permission("view_inventory"))])
def list_products(
    db: Session = Depends(get_db),
    negative_stock: bool = Query(default=False),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="asc"),
    ordering_only: bool = Query(default=False),
):
    q = (
        db.query(models.Product)
        .options(
            selectinload(models.Product.base_uom),
            selectinload(models.Product.categories),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.suppliers)
                .selectinload(models.VariantSupplier.supplier),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.cost_layers),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.barcodes),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.uom_conversions),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.bundle_components)
                .selectinload(models.BundleComponent.component_variant)
                .selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
        )
        .filter(models.Product.is_deleted == False)
    )

    if negative_stock:
        neg_product_ids_sq = (
            db.query(models.Variant.product_id)
            .join(models.CurrentStock,
                  models.CurrentStock.variant_id == models.Variant.variant_id)
            .join(models.Location,
                  models.Location.location_id == models.CurrentStock.location_id)
            .filter(
                models.CurrentStock.quantity < 0,
                models.Location.location_type != "Virtual",
                models.Variant.is_deleted == False,
            )
            .distinct()
            .subquery()
        )
        q = q.filter(models.Product.product_id.in_(neg_product_ids_sq))

    if ordering_only:
        orderable_product_ids_sq = (
            db.query(models.Variant.product_id)
            .filter(
                models.Variant.is_deleted == False,
                models.Variant.include_in_ordering == True,
            )
            .distinct()
            .subquery()
        )
        q = q.filter(models.Product.product_id.in_(orderable_product_ids_sq))

    products = q.all()
    _enrich_bundle_stock(products)
    _enrich_resolved_barcode(products)

    if sort_by == "total_stock":
        def _phys_total(p: models.Product) -> Decimal:
            total = Decimal("0")
            for v in p.variants:
                if not v.is_deleted:
                    for cs in v.current_stock:
                        if cs.location and cs.location.location_type != "Virtual":
                            total += cs.quantity
            return total
        products = sorted(products, key=_phys_total, reverse=(sort_dir == "desc"))

    return products


@router.get("/pos-catalog", response_model=List[schemas.POSCatalogItemOut])
def get_pos_catalog(db: Session = Depends(get_db)):
    """Full product/variant catalog for POS frontend caching.

    Returns all Active, non-deleted products and their non-deleted variants.
    Each variant includes barcodes and stock levels at non-virtual locations only.
    Price falls back to the default sibling's price when variant.price is NULL.
    promo_price is returned as-is; the frontend should display it instead of price
    when set (Requirements §6.2, §9.7).
    """
    products = (
        db.query(models.Product)
        .options(
            selectinload(models.Product.variants)
                .selectinload(models.Variant.barcodes),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.uom_conversions)
                .selectinload(models.VariantUomConversion.from_uom),
            selectinload(models.Product.variants)
                .selectinload(models.Variant.uom_conversions)
                .selectinload(models.VariantUomConversion.to_uom),
        )
        .filter(
            models.Product.is_deleted == False,
            models.Product.status == "Active",
        )
        .all()
    )

    result = []
    for product in products:
        active_variants = [v for v in product.variants if not v.is_deleted]
        if not active_variants:
            continue

        # Price fallback value — used when a variant's own price is NULL
        default_price = next(
            (v.price for v in active_variants if v.is_default and v.price is not None),
            None,
        )

        pos_variants = []
        for v in active_variants:
            resolved_price = v.price if v.price is not None else default_price
            non_virtual_stock = [
                cs for cs in v.current_stock
                if cs.location and cs.location.location_type != "Virtual"
            ]
            priced_uom_convs = [
                schemas.POSUomConversionOut(
                    from_uom_id=uc.from_uom_id,
                    from_uom_code=uc.from_uom.uom_code if uc.from_uom else str(uc.from_uom_id),
                    to_uom_id=uc.to_uom_id,
                    to_uom_code=uc.to_uom.uom_code if uc.to_uom else str(uc.to_uom_id),
                    factor=uc.factor,
                    price=uc.price,
                    promo_price=uc.promo_price,
                )
                for uc in v.uom_conversions
                if uc.price is not None
            ]
            pos_variants.append(schemas.POSVariantOut(
                variant_id=v.variant_id,
                PID=v.PID,
                variant_name=v.variant_name,
                sku=v.sku,
                price=resolved_price,
                promo_price=v.promo_price,
                attributes=v.attributes,
                barcodes=[
                    schemas.VariantBarcodeOut.model_validate(bc)
                    for bc in v.barcodes
                ],
                stock=[
                    schemas.POSStockEntry(
                        location_id=cs.location_id,
                        location_name=cs.location.location_name,
                        quantity=cs.quantity,
                    )
                    for cs in non_virtual_stock
                ],
                uom_conversions=priced_uom_convs,
            ))

        result.append(schemas.POSCatalogItemOut(
            product_id=product.product_id,
            product_brand=product.brand,
            product_type=product.product_type,
            variants=pos_variants,
        ))

    return result


# ── MUST be registered before /{product_id} to avoid route shadowing ──────────
@router.get("/ledger", response_model=List[schemas.LedgerEntryContextOut], dependencies=[Depends(require_permission("view_stock_ledger"))])
def list_ledger(
    reason:      Optional[str] = None,
    location_id: Optional[int] = None,
    variant_id:  Optional[int] = None,
    date_from:   Optional[str] = None,
    date_to:     Optional[str] = None,
    limit:       int           = 50,
    cursor:      Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Top-level ledger browser. Excludes SALE reason. Cursor-based pagination.

    reason accepts a single value OR comma-separated list (e.g. RECEIVE,TRANSFER_IN).
    document_id is resolved via batch lookup against inventory_transfers and
    procurement.inventory_shipments so the frontend can display and link to source docs.
    """
    from procurement import models as proc_models

    q = (
        db.query(models.InventoryLedger)
        .filter(models.InventoryLedger.reason != "SALE")
    )
    if reason:
        reason_list = [r.strip() for r in reason.split(",") if r.strip()]
        if reason_list:
            q = q.filter(models.InventoryLedger.reason.in_(reason_list))
    if location_id is not None:
        q = q.filter(models.InventoryLedger.location_id == location_id)
    if variant_id is not None:
        q = q.filter(models.InventoryLedger.variant_id == variant_id)
    if date_from:
        q = q.filter(models.InventoryLedger.occurred_at >= date_from)
    if date_to:
        q = q.filter(models.InventoryLedger.occurred_at <= date_to + "T23:59:59")
    if cursor is not None:
        q = q.filter(models.InventoryLedger.ledger_id < cursor)

    entries = (
        q.order_by(models.InventoryLedger.ledger_id.desc())
         .limit(min(limit, 200))
         .all()
    )

    # ── Batch-resolve document PIDs for source-document linking ───────────────
    transfer_ids  = set()
    shipment_ids  = set()
    for e in entries:
        if e.reference_type == "inventory_transfer" and e.reference_id:
            transfer_ids.add(e.reference_id)
        elif e.reference_type == "inventory_shipments" and e.reference_id:
            shipment_ids.add(e.reference_id)

    transfer_pid_map: dict[str, str] = {}
    if transfer_ids:
        rows = (
            db.query(models.InventoryTransfer.transfer_id,
                     models.InventoryTransfer.transfer_pid)
            .filter(models.InventoryTransfer.transfer_id.in_(
                [int(x) for x in transfer_ids if x.isdigit()]
            ))
            .all()
        )
        transfer_pid_map = {str(r.transfer_id): r.transfer_pid or f"TRF-{r.transfer_id:06d}"
                            for r in rows}

    # Document ID = the physical/supplier document reference (reference_number),
    # not the system-generated shipment_pid — see docs/changelog.md.
    shipment_docid_map: dict[str, str] = {}
    if shipment_ids:
        rows = (
            db.query(proc_models.InventoryShipment.shipment_id,
                     proc_models.InventoryShipment.reference_number)
            .filter(proc_models.InventoryShipment.shipment_id.in_(
                [int(x) for x in shipment_ids if x.isdigit()]
            ))
            .all()
        )
        shipment_docid_map = {str(r.shipment_id): r.reference_number for r in rows}

    result = []
    for entry in entries:
        out = schemas.LedgerEntryContextOut.model_validate(entry)
        ref = entry.reference_id or ""
        if entry.reference_type == "inventory_transfer":
            out.document_id = transfer_pid_map.get(ref)
        elif entry.reference_type == "inventory_shipments":
            out.document_id = shipment_docid_map.get(ref)
        else:
            out.document_id = ref or None
        result.append(out)
    return result


@router.get("/resolve", response_model=schemas.BarcodeResolveOut)
def resolve_scanned_code(code: str, db: Session = Depends(get_db)):
    """Reverse barcode resolver (Fix 2, reverse direction — see
    docs/pid_editability_fix.md). Given a scanned string, resolves to the
    variant it identifies:
      1. An explicit variant_barcodes.barcode exact match, else
      2. A current, non-deleted variant whose PID exactly matches, else
      3. 404 "item not found".
    A PID that has been renamed away from matches neither step — unless a
    different variant has since taken that value as its own current PID."""
    bc = db.query(models.VariantBarcode).filter(models.VariantBarcode.barcode == code).first()
    if bc:
        variant = db.query(models.Variant).filter(
            models.Variant.variant_id == bc.variant_id,
            models.Variant.is_deleted == False,
        ).first()
        if variant:
            return schemas.BarcodeResolveOut(
                variant_id=variant.variant_id, PID=variant.PID,
                variant_name=variant.variant_name, product_id=variant.product_id,
                matched_via="barcode",
            )

    variant = db.query(models.Variant).filter(
        models.Variant.PID == code,
        models.Variant.is_deleted == False,
    ).first()
    if variant:
        return schemas.BarcodeResolveOut(
            variant_id=variant.variant_id, PID=variant.PID,
            variant_name=variant.variant_name, product_id=variant.product_id,
            matched_via="pid",
        )

    raise HTTPException(status_code=404, detail="item not found")


@router.get("/{product_id}", response_model=schemas.ProductOut, dependencies=[Depends(require_permission("view_inventory"))])
def get_product(product_id: int, db: Session = Depends(get_db)):
    return _load_product(product_id, db)


@router.post("/", response_model=schemas.ProductOut, status_code=201)
def create_product(
    payload: schemas.ProductCreate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    if not payload.variants:
        raise HTTPException(status_code=400, detail="At least one variant is required")

    product = models.Product(
        brand=payload.brand,
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
        try:
            _check_pid_barcode_collision(v.PID, None, db)
        except HTTPException:
            db.rollback()
            raise
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

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="PID already in use as another variant's barcode")
    write_audit(db, "inventory.products", str(product.product_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(product))
    db.commit()
    # Enrichment must happen after the final commit — expire_on_commit
    # discards the resolved_barcode set on any objects fetched earlier.
    return _load_product(product.product_id, db)


@router.put("/{product_id}", response_model=schemas.ProductOut)
def update_product(
    product_id: int,
    payload: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    product = _load_product(product_id, db)
    old = _serialize(product)
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

    write_audit(db, "inventory.products", str(product_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(product))
    db.commit()
    return _load_product(product_id, db)


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    product = _load_product(product_id, db)
    old = _serialize(product)
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
    write_audit(db, "inventory.products", str(product_id), "DELETE",
                actor_user_id=_actor.user_id, old_values=old,
                new_values={**old, "is_deleted": True})
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# VARIANTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}", response_model=schemas.VariantOut, dependencies=[Depends(require_permission("view_inventory"))])
def get_variant(variant_id: int, db: Session = Depends(get_db)):
    """Return a single variant. If price is NULL, falls back to the default
    sibling's price (Requirements §6.2)."""
    variant = (
        db.query(models.Variant)
        .options(
            selectinload(models.Variant.product),
            selectinload(models.Variant.current_stock)
                .selectinload(models.CurrentStock.location),
            selectinload(models.Variant.suppliers)
                .selectinload(models.VariantSupplier.supplier),
            selectinload(models.Variant.cost_layers),
            selectinload(models.Variant.barcodes),
            selectinload(models.Variant.uom_conversions),
            selectinload(models.Variant.bundle_components)
                .selectinload(models.BundleComponent.component_variant),
        )
        .filter(
            models.Variant.variant_id == variant_id,
            models.Variant.is_deleted == False,
        )
        .first()
    )
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")

    variant.resolved_barcode = _resolve_barcode(variant)
    out = schemas.VariantOut.model_validate(variant)
    if out.price is None:
        default_v = (
            db.query(models.Variant)
            .filter(
                models.Variant.product_id == variant.product_id,
                models.Variant.is_default == True,
                models.Variant.is_deleted == False,
            )
            .first()
        )
        if default_v:
            out.price = default_v.price
    return out


@router.get("/variants/{variant_id}/stock", response_model=List[schemas.CurrentStockOut], dependencies=[Depends(require_permission("view_inventory"))])
def get_variant_stock(variant_id: int, db: Session = Depends(get_db)):
    """Return stock levels for a variant across all non-virtual locations
    (Requirements §9.7)."""
    _get_variant_or_404(variant_id, db)
    return (
        db.query(models.CurrentStock)
        .join(models.Location,
              models.CurrentStock.location_id == models.Location.location_id)
        .options(selectinload(models.CurrentStock.location))
        .filter(
            models.CurrentStock.variant_id == variant_id,
            models.Location.location_type != "Virtual",
            models.Location.is_deleted == False,
        )
        .all()
    )


@router.post("/{product_id}/variants", response_model=schemas.ProductOut, status_code=201)
def add_variant(
    product_id: int,
    payload: schemas.VariantCreate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    product = _load_product(product_id, db)

    if db.query(models.Variant).filter(models.Variant.PID == payload.PID).first():
        raise HTTPException(status_code=400, detail=f"PID '{payload.PID}' already exists")
    _check_pid_barcode_collision(payload.PID, None, db)

    new_variant = models.Variant(
        product_id=product.product_id,
        PID=payload.PID,
        variant_name=payload.variant_name,
        sku=payload.sku,
        price=payload.price,
        promo_price=payload.promo_price,
        is_default=payload.is_default,
        attributes=payload.attributes,
        include_in_ordering=payload.include_in_ordering,
    )
    db.add(new_variant)
    db.flush()  # get variant_id before enforcing exclusivity

    if payload.is_default:
        _enforce_single_default(product.product_id, new_variant.variant_id, db)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="PID already in use as another variant's barcode")
    return _load_product(product_id, db)


@router.put("/variants/{variant_id}", response_model=schemas.VariantOut)
def update_variant(
    variant_id: int,
    payload: schemas.VariantUpdate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    """Update a variant. Also handles reactivation (is_deleted=false) — the
    lookup intentionally does not filter on is_deleted so a soft-deleted
    variant can still be found and reactivated, same convention as
    patch_supplier."""
    variant = (
        db.query(models.Variant)
        .filter(models.Variant.variant_id == variant_id)
        .first()
    )
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")

    old = _serialize(variant)
    updates = payload.model_dump(exclude_unset=True)

    if "PID" in updates:
        if updates["PID"] == variant.PID:
            del updates["PID"]
        else:
            new_pid = updates["PID"]
            dup_pid = (
                db.query(models.Variant)
                .filter(models.Variant.PID == new_pid, models.Variant.variant_id != variant.variant_id)
                .first()
            )
            if dup_pid:
                raise HTTPException(status_code=400, detail="PID already in use")
            # Cross-namespace: the resolver falls back to PID for any variant with
            # no explicit primary base-UOM barcode, so a renamed PID must not
            # collide with another variant's explicit barcode value either.
            _check_pid_barcode_collision(new_pid, variant.variant_id, db)

    if updates.get("is_default") is True:
        _enforce_single_default(variant.product_id, variant.variant_id, db)
    elif updates.get("is_default") is False and variant.is_default:
        raise HTTPException(
            status_code=400,
            detail="Cannot unset the only default variant — promote another variant first",
        )

    if updates.get("is_deleted") is True and variant.is_default:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default variant — promote another variant first",
        )

    # Record price history when price or promo_price actually changes
    new_price       = updates.get("price",       variant.price)
    new_promo_price = updates.get("promo_price",  variant.promo_price)
    price_changed       = "price"       in updates and new_price       != variant.price
    promo_changed       = "promo_price" in updates and new_promo_price != variant.promo_price
    if price_changed or promo_changed:
        db.add(models.VariantPriceHistory(
            variant_id         = variant_id,
            old_price          = variant.price,
            new_price          = new_price,
            old_promo_price    = variant.promo_price,
            new_promo_price    = new_promo_price,
            changed_by_user_id = _actor.user_id,
        ))

    for key, value in updates.items():
        setattr(variant, key, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Database error")

    db.refresh(variant)
    variant.resolved_barcode = _resolve_barcode(variant)
    write_audit(db, "inventory.variants", str(variant_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(variant))
    db.commit()
    return variant


@router.delete("/variants/{variant_id}", status_code=204)
def delete_variant(
    variant_id: int,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
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
    old = _serialize(variant)
    variant.is_deleted = True
    db.commit()
    write_audit(db, "inventory.variants", str(variant_id), "DELETE",
                actor_user_id=_actor.user_id, old_values=old,
                new_values={**old, "is_deleted": True})
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# IMPORT UPSERT — preview + confirm
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/import/preview", response_model=schemas.ImportPreviewResponse)
def import_preview(
    payload: List[schemas.ImportProductRow],
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("import_products"))):
    """Dry-run: compute diff between incoming rows and current DB state.
    Returns create/update mode per variant row plus changed fields."""
    rows = []
    for prod_row in payload:
        # Look up existing variants by PID
        variant_previews = []
        product_id = None
        product_mode = "create"

        for v_row in prod_row.variants:
            existing_v = (
                db.query(models.Variant)
                .filter(models.Variant.PID == v_row.PID)
                .first()
            )
            if existing_v:
                product_id = existing_v.product_id
                product_mode = "update"
                # Compute which fields changed
                diff_fields = []
                from decimal import Decimal as _Dec, ROUND_HALF_UP
                def _norm(v: object) -> str:
                    """Canonical string for diff comparison. Prices round to 2dp fixed notation."""
                    if v is None: return ""
                    if isinstance(v, _Dec):
                        try:
                            return str(v.quantize(_Dec("0.01"), rounding=ROUND_HALF_UP))
                        except Exception:
                            return str(v)
                    return str(v)

                old_vals: dict = {
                    "variant_name": existing_v.variant_name,
                    "sku":          existing_v.sku,
                    "price":        existing_v.price,
                    "promo_price":  existing_v.promo_price,
                    "is_default":   existing_v.is_default,
                    "attributes":   existing_v.attributes,
                }
                new_vals: dict = v_row.model_dump(exclude={"PID"})
                for field in old_vals:
                    incoming = new_vals.get(field)
                    # None / blank incoming = no change intended
                    if incoming is None:
                        continue
                    if _norm(incoming) != _norm(old_vals[field]):
                        diff_fields.append(field)
                # Serialise prices as strings for the response (Decimal not JSON-safe)
                old_vals_out = {k: (_norm(v) if isinstance(v, _Dec) else v) for k, v in old_vals.items()}
                new_vals_out = {k: (_norm(v) if isinstance(v, _Dec) else v) for k, v in new_vals.items() if v is not None}
                variant_previews.append(schemas.ImportPreviewVariant(
                    PID=v_row.PID, mode="update",
                    old_values=old_vals_out, new_values=new_vals_out, diff_fields=diff_fields,
                ))
            else:
                new_vals_create = {k: v for k, v in v_row.model_dump(exclude={"PID"}).items() if v is not None}
                variant_previews.append(schemas.ImportPreviewVariant(
                    PID=v_row.PID, mode="create",
                    old_values=None,
                    new_values=new_vals_create,
                    diff_fields=list(new_vals_create.keys()),
                ))

        rows.append(schemas.ImportPreviewRow(
            brand=prod_row.brand, product_mode=product_mode,
            product_id=product_id, variants=variant_previews,
        ))

    return schemas.ImportPreviewResponse(rows=rows)


@router.post("/import/confirm", response_model=List[schemas.ProductOut])
def import_confirm(
    payload: schemas.ImportConfirmRequest,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_products")),
):
    """Apply confirmed import rows. Upserts: update existing PIDs, create new ones."""
    created_updated: list[models.Product] = []
    confirmed_set = set(payload.confirmed_pids)

    for prod_row in payload.rows:
        # Only process variants that were confirmed
        confirmed_variants = [v for v in prod_row.variants if v.PID in confirmed_set]
        if not confirmed_variants:
            continue

        # Find or create product (keyed by first confirmed variant's existing product_id)
        existing_product = None
        for v_row in confirmed_variants:
            ev = db.query(models.Variant).filter(models.Variant.PID == v_row.PID).first()
            if ev:
                existing_product = db.query(models.Product).filter(
                    models.Product.product_id == ev.product_id
                ).first()
                break

        if existing_product:
            # Update product-level fields if provided
            existing_product.brand = prod_row.brand
            if prod_row.product_type:
                existing_product.product_type = prod_row.product_type
            if prod_row.description is not None:
                existing_product.description = prod_row.description
            if prod_row.base_uom_id is not None:
                existing_product.base_uom_id = prod_row.base_uom_id
            product = existing_product
        else:
            product = models.Product(
                brand=prod_row.brand,
                product_type=prod_row.product_type,
                description=prod_row.description,
                base_uom_id=prod_row.base_uom_id,
                status="Active",
            )
            db.add(product)
            db.flush()

        # Upsert categories
        if prod_row.category_names:
            cats = db.query(models.ProductCategory).filter(
                models.ProductCategory.category_name.in_(prod_row.category_names),
                models.ProductCategory.is_deleted == False,
            ).all()
            product.categories = cats

        # Upsert variants
        for v_row in confirmed_variants:
            existing_v = db.query(models.Variant).filter(models.Variant.PID == v_row.PID).first()
            if existing_v:
                if v_row.variant_name is not None:
                    existing_v.variant_name = v_row.variant_name
                if v_row.sku is not None:
                    existing_v.sku = v_row.sku
                if v_row.price is not None:
                    existing_v.price = v_row.price
                if v_row.promo_price is not None:
                    existing_v.promo_price = v_row.promo_price
                if v_row.attributes is not None:
                    existing_v.attributes = v_row.attributes
            else:
                new_v = models.Variant(
                    product_id=product.product_id,
                    PID=v_row.PID,
                    variant_name=v_row.variant_name or "Default",
                    sku=v_row.sku,
                    price=v_row.price,
                    promo_price=v_row.promo_price,
                    is_default=v_row.is_default,
                    attributes=v_row.attributes,
                )
                db.add(new_v)

        db.flush()
        created_updated.append(product)

    db.commit()
    return [_load_product(p.product_id, db) for p in created_updated]


# ═══════════════════════════════════════════════════════════════════════════════
# INVENTORY LEDGER — per variant
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}/ledger", response_model=List[schemas.LedgerEntryOut], dependencies=[Depends(require_permission("view_stock_ledger"))])
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
# HISTORY ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/variants/{variant_id}/price-history",
            response_model=List[schemas.VariantPriceHistoryOut],
            dependencies=[Depends(require_permission("view_inventory"))])
def get_price_history(
    variant_id: int,
    limit: int = 10,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    from auth.models import User as AuthUser
    _get_variant_or_404(variant_id, db)
    rows = (
        db.query(models.VariantPriceHistory)
        .filter(models.VariantPriceHistory.variant_id == variant_id)
        .order_by(models.VariantPriceHistory.changed_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    result = []
    for r in rows:
        username = None
        if r.changed_by_user_id:
            u = db.query(AuthUser).filter(AuthUser.user_id == r.changed_by_user_id).first()
            if u:
                username = u.username
        out = schemas.VariantPriceHistoryOut.model_validate(r)
        out.changed_by_username = username
        result.append(out)
    return result


@router.get("/variants/{variant_id}/cost-history",
            response_model=List[schemas.VariantCostHistoryOut],
            dependencies=[Depends(require_permission("view_inventory"))])
def get_cost_history(
    variant_id: int,
    limit: int = 10,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    from auth.models import User as AuthUser
    _get_variant_or_404(variant_id, db)
    rows = (
        db.query(models.VariantCostHistory)
        .filter(models.VariantCostHistory.variant_id == variant_id)
        .order_by(models.VariantCostHistory.changed_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    result = []
    for r in rows:
        username = None
        if r.changed_by_user_id:
            u = db.query(AuthUser).filter(AuthUser.user_id == r.changed_by_user_id).first()
            if u:
                username = u.username
        sup_name = None
        if r.supplier:
            sup_name = r.supplier.supplier_name
        out = schemas.VariantCostHistoryOut.model_validate(r)
        out.changed_by_username = username
        out.supplier_name = sup_name
        result.append(out)
    return result


@router.get("/variants/{variant_id}/sales-history",
            response_model=List[schemas.SalesHistoryItem],
            dependencies=[Depends(require_permission("view_inventory"))])
def get_sales_history(
    variant_id: int,
    limit: int = 10,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    from sales import models as sales_models
    from auth import models as auth_models
    _get_variant_or_404(variant_id, db)

    rows = (
        db.query(
            sales_models.Sale.sale_pid,
            sales_models.Sale.transaction_date,
            sales_models.Sale.employee_id,
            sales_models.SaleItem.quantity,
            sales_models.SaleItem.unit_price,
            sales_models.SaleItem.line_total,
            sales_models.Sale.status,
        )
        .join(sales_models.Sale,
              sales_models.SaleItem.sale_id == sales_models.Sale.sale_id)
        .filter(
            sales_models.SaleItem.variant_id == variant_id,
            sales_models.Sale.status.in_(["Posted", "Voided"]),
        )
        .order_by(sales_models.Sale.transaction_date.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []
    for r in rows:
        cashier = None
        if r.employee_id:
            emp = (
                db.query(auth_models.Employee)
                .filter(auth_models.Employee.employee_id == r.employee_id)
                .first()
            )
            if emp:
                cashier = f"{emp.first_name} {emp.last_name}"
        result.append(schemas.SalesHistoryItem(
            sale_pid=r.sale_pid,
            transaction_date=r.transaction_date,
            cashier=cashier,
            quantity=r.quantity,
            unit_price=r.unit_price,
            line_total=r.line_total,
            sale_status=r.status,
        ))
    return result


@router.get("/variants/{variant_id}/purchase-history",
            response_model=List[schemas.PurchaseHistoryItem],
            dependencies=[Depends(require_permission("view_inventory"))])
def get_purchase_history(
    variant_id: int,
    limit: int = 10,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    from procurement import models as proc_models
    _get_variant_or_404(variant_id, db)

    rows = (
        db.query(
            proc_models.InventoryShipment.shipment_pid,
            proc_models.InventoryShipment.reference_number,
            proc_models.ReceivingDetail.received_at,
            proc_models.ReceivingDetail.quantity_actual,
            proc_models.ReceivingDetail.quantity_rejected,
            proc_models.ReceivingDetail.qc_status,
            models.Supplier.supplier_name,
        )
        .join(proc_models.InventoryShipment,
              proc_models.ReceivingDetail.shipment_id == proc_models.InventoryShipment.shipment_id)
        .join(models.Supplier,
              proc_models.InventoryShipment.supplier_id == models.Supplier.supplier_id)
        .filter(proc_models.ReceivingDetail.variant_id == variant_id)
        .order_by(proc_models.ReceivingDetail.received_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []
    for r in rows:
        qty_received = (r.quantity_actual or 0) - (r.quantity_rejected or 0)
        # Try to find the matching cost layer for net_unit_cost
        cost_layer = (
            db.query(models.CostLayer)
            .join(proc_models.InventoryShipment,
                  models.CostLayer.shipment_id == proc_models.InventoryShipment.shipment_id)
            .filter(
                models.CostLayer.variant_id == variant_id,
                proc_models.InventoryShipment.shipment_pid == r.shipment_pid,
            )
            .first()
        )
        result.append(schemas.PurchaseHistoryItem(
            document_id=r.reference_number,
            received_at=r.received_at,
            supplier_name=r.supplier_name,
            quantity_received=qty_received,
            net_unit_cost=cost_layer.net_unit_cost if cost_layer else None,
            qc_status=r.qc_status.value if hasattr(r.qc_status, "value") else r.qc_status,
        ))
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# SUPPLIERS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/suppliers/all", response_model=List[schemas.SupplierOut], dependencies=[Depends(require_permission("view_suppliers"))])
def list_suppliers(
    include_deleted: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(models.Supplier)
    if not include_deleted:
        q = q.filter(models.Supplier.is_deleted == False)
    return q.order_by(models.Supplier.supplier_code).all()


@router.get("/suppliers/{supplier_id}", response_model=schemas.SupplierOut, dependencies=[Depends(require_permission("view_suppliers"))])
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
def create_supplier(
    payload: schemas.SupplierCreate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_suppliers")),
):
    existing = db.query(models.Supplier).filter(
        models.Supplier.supplier_code == payload.supplier_code
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Supplier code '{payload.supplier_code}' already in use")
    supplier = models.Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    write_audit(db, "inventory.suppliers", str(supplier.supplier_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(supplier))
    db.commit()
    return supplier


@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_suppliers")),
):
    supplier = (
        db.query(models.Supplier)
        .filter(models.Supplier.supplier_id == supplier_id, models.Supplier.is_deleted == False)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    old = _serialize(supplier)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(supplier, key, value)

    db.commit()
    db.refresh(supplier)
    write_audit(db, "inventory.suppliers", str(supplier_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(supplier))
    db.commit()
    return supplier


@router.patch("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def patch_supplier(
    supplier_id: int,
    payload: schemas.SupplierPatch,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_suppliers")),
):
    """Deactivate (is_deleted=true) or reactivate (is_deleted=false) a supplier.
    Also handles general field-level updates. supplier_code is excluded and never patched."""
    supplier = db.query(models.Supplier).filter(
        models.Supplier.supplier_id == supplier_id
    ).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    old = _serialize(supplier)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(supplier, key, value)
    db.commit()
    db.refresh(supplier)
    write_audit(db, "inventory.suppliers", str(supplier_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(supplier))
    db.commit()
    return supplier


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_suppliers")),
):
    supplier = (
        db.query(models.Supplier)
        .filter(models.Supplier.supplier_id == supplier_id, models.Supplier.is_deleted == False)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    old = _serialize(supplier)
    supplier.is_deleted = True
    db.commit()
    write_audit(db, "inventory.suppliers", str(supplier_id), "DELETE",
                actor_user_id=_actor.user_id, old_values=old,
                new_values={**old, "is_deleted": True})
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


@router.get("/variants/{variant_id}/barcodes", response_model=List[schemas.VariantBarcodeOut], dependencies=[Depends(require_permission("view_inventory"))])
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
    _get_variant_or_404(variant_id, db)

    if db.query(models.VariantBarcode).filter(
        models.VariantBarcode.barcode == payload.barcode
    ).first():
        raise HTTPException(status_code=400, detail="Barcode already exists")

    # Cross-namespace: this value must not collide with another variant's
    # current PID — that PID is that variant's computed fallback barcode.
    if db.query(models.Variant).filter(
        models.Variant.PID == payload.barcode,
        models.Variant.variant_id != variant_id,
    ).first():
        raise HTTPException(status_code=400, detail="Barcode already in use as another variant's PID")

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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Barcode already in use as another variant's PID")
    db.refresh(bc)
    return bc


@router.put("/variants/{variant_id}/barcodes/{barcode_id}",
            response_model=schemas.VariantBarcodeOut)
def update_barcode(
    variant_id: int,
    barcode_id: int,
    payload: schemas.VariantBarcodeUpdate,
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
def delete_barcode(variant_id: int, barcode_id: int, db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
            response_model=List[schemas.VariantUomConversionOut],
            dependencies=[Depends(require_permission("view_inventory"))])
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
        is_warehouse_bundle=payload.is_warehouse_bundle,
        price=payload.price,
        promo_price=payload.promo_price,
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
    _get_variant_or_404(variant_id, db)
    conv = db.query(models.VariantUomConversion).filter(
        models.VariantUomConversion.variant_id == variant_id,
        models.VariantUomConversion.from_uom_id == from_uom_id,
        models.VariantUomConversion.to_uom_id == to_uom_id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="UOM conversion not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, val in updates.items():
        setattr(conv, key, val)
    db.commit()
    db.refresh(conv)
    return conv


@router.delete("/variants/{variant_id}/uom-conversions/{from_uom_id}/{to_uom_id}",
               status_code=204)
def delete_uom_conversion(
    variant_id: int,
    from_uom_id: int,
    to_uom_id: int,
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
            response_model=List[schemas.VariantSupplierOut],
            dependencies=[Depends(require_permission("view_inventory"))])
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
    _actor: User = Depends(require_permission("manage_products"))):
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

    # Record cost history when gross_cost or supplier_discount actually changes
    new_gross   = updates.get("gross_cost",        vs.gross_cost)
    new_disc    = updates.get("supplier_discount",  vs.supplier_discount)
    cost_changed = "gross_cost"        in updates and new_gross != vs.gross_cost
    disc_changed = "supplier_discount" in updates and new_disc  != vs.supplier_discount
    if cost_changed or disc_changed:
        db.add(models.VariantCostHistory(
            variant_id            = variant_id,
            supplier_id           = vs.supplier_id,
            old_gross_cost        = vs.gross_cost,
            new_gross_cost        = new_gross,
            old_supplier_discount = vs.supplier_discount,
            new_supplier_discount = new_disc,
            changed_by_user_id    = _actor.user_id,
        ))

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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
            response_model=List[schemas.BundleComponentOut],
            dependencies=[Depends(require_permission("view_inventory"))])
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
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
    db: Session = Depends(get_db), _actor: User = Depends(require_permission("manage_products"))):
    _get_variant_or_404(variant_id, db)
    bc = db.query(models.BundleComponent).filter(
        models.BundleComponent.bundle_variant_id == variant_id,
        models.BundleComponent.component_variant_id == component_variant_id,
    ).first()
    if not bc:
        raise HTTPException(status_code=404, detail="Bundle component not found")
    db.delete(bc)
    db.commit()
