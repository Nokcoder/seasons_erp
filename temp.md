# Purchase Order (PO) System — Full Audit Report

This report documents the current state of everything related to creating and recording Purchase Orders in the Season ERP codebase, covering frontend UI, frontend API service layer, backend routes, backend models/schemas, PID generation, and known gaps. All claims are backed by file paths.

---

## 1. PURCHASE ORDER CREATION

### Current frontend state: STUB — not implemented

**File:** `frontend/src/pages/procurement/PurchaseOrders.tsx`

The live page is a placeholder with no form, no fields, and no API calls:

```tsx
export default function PurchaseOrders() {
  return (
    <div className="p-8">
      <h2 className="text-sm font-semibold t-text-1 mb-1">Purchase Orders</h2>
      <p className="text-xs t-text-4">Not yet implemented.</p>
    </div>
  )
}
```

There is no way to create a PO from the current UI. The nav tab and route exist (see `frontend/src/pages/Procurement.tsx`), but they lead to this stub.

### Archived prior design (not wired up)

**File:** `frontend/src/_archive/components/PurchaseOrders.tsx` (lines 1–408)

This file contains a previously built (but since archived/disconnected) implementation:

- **Modal-based "Create PO" form** with:
  - Supplier dropdown (required), populated via a `fetchSuppliers()` call
  - Target Delivery Date (optional date picker)
  - Product search field (keyword search with autocomplete, top 5 results, click-to-add)
  - Excel import button with a downloadable template, for bulk line-item entry
  - Line item table: PID, Name, Qty, Gross Cost, Discount %, Net Cost, Line Total, delete-row button — all qty/cost/discount fields are inline-editable
  - Grand Total computed client-side as `sum(qty × (unit_cost × (1 − discount)))`
- **Status progression in UI:** No explicit status dropdown. Instead, a "Confirm Order" button transitions the PO from Draft to a "Confirmed" state (note: this label doesn't match the current backend's `Open` status terminology — see Gaps section).
- **Cancel:** Not present. Neither the create modal nor the detail/view modal expose a cancel action.
- **API calls referenced (broken/outdated):**
  - `fetchSuppliers()` → intended to hit something like `GET /products/suppliers/all`
  - `fetchProducts()` → intended to hit something like `GET /products/`
  - `createPurchaseOrder(payload)` → constructs a malformed URL (`import.meta.env.VITE_API_URL/api/...`), not aligned with current `/procurement/orders` backend path.

**Conclusion on Section 1:**
- No working "create PO" UI exists today.
- Supplier dropdown population: only exists in the archived design, not the live one.
- Line items (variant + qty + unit_cost): fully editable in the archived design (qty, gross cost, discount inline in a table), but that design is disconnected and not reachable by users.
- Draft → Open progression: only conceptually present in the archive ("Confirm Order" button), and even then under a different terminology than the backend enum (`Confirmed` vs `Open`).
- Cancel from UI: not implemented anywhere, live or archived.

---

## 2. PO LISTING / INDEX PAGE

### Current frontend state: STUB — not implemented

Same stub component as above (`frontend/src/pages/procurement/PurchaseOrders.tsx`) serves as both the would-be list page and detail page. There is no functioning list view today.

**Nav/route wiring exists but points to the stub:**

`frontend/src/pages/Procurement.tsx`:
```tsx
<NavLink to="/procurement/purchase-orders" className={TAB_CLS}>Purchase Orders</NavLink>
...
<Route path="purchase-orders" element={<PurchaseOrders />} />
```

### Archived prior design

**File:** `frontend/src/_archive/components/PurchaseOrders.tsx`

The archived list view shows 5 columns:
- PO Number (formatted `PO-{id:05d}`, clickable)
- Supplier name (`po.supplier?.name`)
- Target Delivery date (or "Unscheduled" if absent)
- Total Value (right-aligned, currency-formatted)
- Status badge (DRAFT = gray, CONFIRMED = blue, otherwise green)

**Filtering/search:** No filter or search UI is present in the archive — sorting is newest-first, presumably from the backend default order. There is no status filter (Draft/Open/Partially_Received/Closed/Cancelled) anywhere in the archived list.

**Row → detail navigation:** Rows are clickable (`onClick={() => setViewPO(po)}`) and open a detail modal (not a separate page/route).

**Conclusion on Section 2:**
- No PO list page exists in the live app.
- No status filtering or search capability exists, even in the archived design.
- The archived design uses a modal for "detail" rather than a dedicated detail page/route.

---

## 3. PO DETAIL VIEW

### Current frontend state: STUB — not implemented

Same stub file as Sections 1 and 2. There is no detail view reachable today.

### Archived prior design

**File:** `frontend/src/_archive/components/PurchaseOrders.tsx` (lines 221–295, detail modal)

**Header fields shown:**
- PO Number + status badge (e.g., "PO-00001 [DRAFT]")
- Supplier name
- Target Delivery date (or "N/A")

**Line items table:**
```
Columns: PID/Product | Qty | Net Cost | Total
Data: product.name, product.pid, item.requested_qty,
      item.unit_gross_cost × (1 − discount), line_total
```

**Totals:** Grand Total displayed in a table footer, summing all line totals.

**received_quantity:** NOT shown anywhere in the archived detail view. There is no column or field displaying how much of each line has been received — this concept is entirely absent from the archived frontend design (receiving is treated as a wholly separate workflow via the Shipments/Receiving UI).

**Status badge:** Shown in the header next to the PO number.

**Action buttons:**
- "Close" (dismisses modal)
- "Confirm Order" — visible only when `status === 'DRAFT'`, calls an `updateStatus(po.po_id, 'CONFIRMED')` function
- A disabled "Awaiting Delivery..." button when `status === 'CONFIRMED'`, with a tooltip reading "Next step: Log via Incoming Containers"
- No Edit or Cancel buttons anywhere in the detail modal — once drafted, the archived UI treats most fields as read-only aside from the status push-button.

**Conclusion on Section 3:**
- No working PO detail view exists today.
- The archived design never surfaces `received_quantity` per line — this is a UI gap even in the legacy design, separate from the backend gap noted in Section 5.
- `total_amount`/grand total computation in the archive is done **client-side** using `unit_cost × (1 − discount)`, which does NOT match how the current backend computes/stores `total_amount` (gross `unit_cost × ordered_quantity`, no discount field at all in the current schema). This is a meaningful mismatch if the archived UI were ever reconnected as-is.

---

## 4. BACKEND — ROUTES & SCHEMA

### Backend routes — fully implemented

**File:** `backend/procurement/router.py` (873 lines)

Router registration (lines 21–25):
```python
router = APIRouter(
    prefix="/procurement",
    tags=["Procurement"],
    dependencies=[Depends(get_current_user)],
)
```

**PO endpoints (lines 153–296):**

| Method | Path | Handler | Description | Models |
|---|---|---|---|---|
| GET | `/orders` | `list_purchase_orders()` | List all POs, eager-loaded with supplier, location, items | Response: `List[POOut]` |
| GET | `/orders/{po_id}` | `get_purchase_order()` | Get single PO with all relationships | Response: `POOut` |
| POST | `/orders` | `create_purchase_order()` | Create a new PO in Draft status | Request: `POCreate`, Response: `POOut` (201) |
| PUT | `/orders/{po_id}/items/{po_item_id}` | `update_po_item()` | Edit a line item's qty/cost (only while PO is Draft or Open) | Request: `POItemUpdate`, Response: `POOut` |
| PATCH | `/orders/{po_id}/status` | `update_po_status()` | Transition PO status | Request: `POStatusUpdate`, Response: `POOut` |

**Status transition rules (lines 218–224):**
```python
_PO_TRANSITIONS: dict[str, set[str]] = {
    "Draft":              {"Open", "Cancelled"},
    "Open":               {"Partially_Received", "Closed", "Cancelled"},
    "Partially_Received": {"Closed", "Cancelled"},
    "Closed":             set(),
    "Cancelled":          set(),
}
```
This matches the requirements doc's lifecycle exactly: `Draft → Open → Partially_Received → Closed | Cancelled`. Invalid transitions return HTTP 400 with the list of valid next statuses (lines 280–289). Audit-trail logging of before/after values happens on each transition.

**Permission guard:** `require_permission("manage_purchase_orders")` is applied to POST `/orders` (line 177) and PATCH `/orders/{po_id}/status` (line 278). Note per `CLAUDE.md`'s documented architecture, `get_current_user()` is currently a stub that returns the first DB user rather than decoding the JWT, so this permission check is not a real enforcement boundary yet — this is a known systemic issue, not specific to POs.

**Shipment endpoints (related, lines 303–462)** — these are the actual receiving workflow, separate from the PO CRUD above:

| Method | Path | Handler | Description |
|---|---|---|---|
| GET | `/shipments` | `list_shipments()` | List all shipments |
| GET | `/shipments/{shipment_id}` | `get_shipment()` | Get shipment detail |
| POST | `/shipments` | `create_shipment()` | Create shipment from a supplier, optionally linked to a PO |
| POST | `/shipments/{shipment_id}/details` | `add_receiving_details()` | Add receiving-detail rows (QC data entry) |
| PATCH | `/shipments/{shipment_id}/discrepancy` | `update_shipment_discrepancy()` | Update discrepancy tracking fields |
| POST | `/shipments/{shipment_id}/receive` | `receive_shipment()` | Stage 1: writes ledger entries + updates `current_stocks` |
| POST | `/shipments/{shipment_id}/confirm-costs` | `confirm_costs()` | Stage 2: creates cost layers + supplier invoice + AP ledger entry |
| POST | `/shipments/{shipment_id}/confirm` | `confirm_shipment_deprecated()` | Deprecated; returns HTTP 410 |

**Auto-advance PO on shipment creation (lines 343–347):**
```python
# auto-advance PO to Open if it is still in Draft
if payload.po_id:
    po = db.query(proc_models.PurchaseOrder).filter_by(po_id=payload.po_id).first()
    if po and po.status == "Draft":
        po.status = "Open"
```
This is the one place a PO's status is changed automatically based on downstream activity (creating a shipment against it).

**Stage 1 receive (lines 467–505):** Writes `InventoryLedger` rows (reason=`RECEIVE`) and upserts `current_stocks`. Does NOT create cost layers and does NOT mark the shipment confirmed. Also — critically — does NOT touch `PurchaseOrderItem.received_quantity` (see Gaps section).

**Stage 2 confirm-costs (lines 510–655):** Creates `CostLayer` rows from caller-supplied `unit_cost`, updates `VariantSupplier.gross_cost`, builds `SupplierInvoiceItem` rows from the linked PO (if any), creates a `SupplierInvoice` with due date `invoice_date + supplier.terms`, writes an `ApLedger` entry (reason=`INVOICE`), and sets `inventory_shipments.is_confirmed = true`.

### Backend models — fully implemented, matches DBML exactly

**File:** `backend/procurement/models.py` (126 lines)

**PurchaseOrder (lines 12–37):**
```python
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = {"schema": "procurement"}

    po_id                 = Column(Integer, primary_key=True)
    po_pid                = Column(String(100), unique=True, nullable=False)
    supplier_id           = Column(Integer, ForeignKey("inventory.suppliers.supplier_id"))
    location_id           = Column(Integer, ForeignKey("inventory.locations.location_id"))
    order_date            = Column(DateTime(timezone=True), server_default=func.now())
    expected_arrival_date = Column(Date)
    status                = Column(
        SAEnum("Draft", "Open", "Partially_Received", "Closed", "Cancelled",
               name="po_status", schema="procurement"),
        default="Draft",
    )
    total_amount          = Column(Numeric(15, 2), default=0)
    created_by_user_id    = Column(Integer, ForeignKey("auth.users.user_id"))
    created_at            = Column(DateTime(timezone=True), server_default=func.now())
    updated_at            = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items      = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")
    supplier   = relationship("Supplier")
    location   = relationship("Location")
    created_by = relationship("User")
```

**PurchaseOrderItem (lines 43–56):**
```python
class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    __table_args__ = {"schema": "procurement"}

    po_item_id        = Column(Integer, primary_key=True)
    po_id             = Column(Integer, ForeignKey("procurement.purchase_orders.po_id", ondelete="CASCADE"))
    variant_id        = Column(Integer, ForeignKey("inventory.variants.variant_id"))
    ordered_quantity  = Column(Numeric(15, 4), nullable=False)
    received_quantity = Column(Numeric(15, 4), default=0)
    unit_cost         = Column(Numeric(15, 2), nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    variant        = relationship("Variant")
```

**Comparison against `/docs/schema.dbml` (lines 183–204):** Exact match — every column, type, FK, and enum value lines up. No discrepancies found.

### Backend Pydantic schemas — fully implemented

**File:** `backend/procurement/schemas.py` (239 lines)

```python
class POItemCreate(BaseModel):
    variant_id: int
    ordered_quantity: Decimal
    unit_cost: Decimal          # gross cost per unit at time of ordering

class POItemUpdate(BaseModel):
    ordered_quantity: Optional[Decimal] = None
    unit_cost: Optional[Decimal] = None

class POItemOut(BaseModel):
    po_item_id: int
    variant_id: int
    ordered_quantity: Decimal
    received_quantity: Decimal
    unit_cost: Decimal
    variant: Optional[VariantRefOut] = None
    class Config: from_attributes = True

class POCreate(BaseModel):
    po_pid: Optional[str] = None        # Auto-generated if omitted
    supplier_id: int
    location_id: Optional[int] = None
    expected_arrival_date: Optional[date] = None
    created_by_user_id: Optional[int] = None
    items: List[POItemCreate]           # Must have at least 1 item

class POStatusUpdate(BaseModel):
    status: str     # Draft | Open | Partially_Received | Closed | Cancelled

class POOut(BaseModel):
    po_id: int
    po_pid: str
    supplier_id: int
    location_id: Optional[int] = None
    status: str
    total_amount: Decimal
    order_date: datetime
    expected_arrival_date: Optional[date] = None
    created_at: datetime
    supplier: Optional[SupplierRefOut] = None
    location: Optional[LocationRefOut] = None
    items: List[POItemOut] = []
    class Config: from_attributes = True
```

Fields accepted on create vs. the ORM model: `POCreate` intentionally omits `order_date`, `status`, `total_amount`, `created_at`, `updated_at` — all of these are server-defaulted/computed, which is correct. `POItemUpdate` and `POStatusUpdate` each expose exactly the fields they should and nothing more.

### `total_amount` computation

**File:** `backend/procurement/router.py`, lines 199–210 (on create) and 261–267 (on item update)

```python
grand_total = Decimal('0')
for item in payload.items:
    grand_total += item.unit_cost * item.ordered_quantity
    # ... add item to DB ...
po.total_amount = grand_total
```
```python
all_items = db.query(proc_models.PurchaseOrderItem).filter(...).all()
po.total_amount = sum(i.ordered_quantity * i.unit_cost for i in all_items)
```

This is computed server-side, recalculated on both initial creation and any line-item update, and persisted to the `total_amount` column. It correctly matches the requirements doc's definition: "sum of `(ordered_quantity × unit_cost)` across all line items." There is no discount field anywhere in the current schema/model/router, which is a deliberate simplification relative to the archived frontend design (see Section 1 and Gaps).

### PO_PID generation

**File:** `backend/procurement/router.py`, lines 182–197

```python
po = proc_models.PurchaseOrder(
    # po_pid is NOT NULL; use caller-supplied value or a unique placeholder.
    # If auto-generating, we need po_id first — replace after flush.
    po_pid=payload.po_pid or f"_tmp_{uuid4().hex}",
    # ... other fields ...
)
db.add(po)
db.flush()  # get po_id

if not payload.po_pid:
    po.po_pid = f"PO-{po.po_id:06d}"
```

Pattern: `PO-{po_id:06d}` (e.g. `PO-000001`, `PO-000042`). Process: insert with a temporary UUID-based placeholder to satisfy the `NOT NULL UNIQUE` constraint, flush to obtain the auto-incremented `po_id`, then overwrite with the final formatted PID if the caller didn't supply their own. This mirrors the same after-flush ID-dependent pattern used for `sale_pid` generation in the sales module.

---

## 5. GAPS & STUBS

### Frontend

1. **No working PO creation, list, or detail UI.** `frontend/src/pages/procurement/PurchaseOrders.tsx` is a literal one-line "Not yet implemented" stub. The nav tab and route both resolve to it (`frontend/src/pages/Procurement.tsx`).
2. **Archived design is disconnected and partially incompatible.** `frontend/src/_archive/components/PurchaseOrders.tsx` has a full create/list/detail implementation, but:
   - Its status vocabulary (`DRAFT`/`CONFIRMED`) doesn't match the current backend enum (`Draft`/`Open`/`Partially_Received`/`Closed`/`Cancelled`).
   - Its API call construction is broken/outdated (malformed URL building, wrong endpoint paths).
   - It computes grand total client-side using a per-line discount that doesn't exist in the current schema (`unit_cost × (1 − discount)`), whereas the backend stores/computes plain `ordered_quantity × unit_cost` with no discount concept.
   - It never displays `received_quantity` per line at all.
3. **No PO-related TypeScript interfaces or API functions exist in `frontend/src/services/api.ts`.** Searched for `purchase_order`, `PurchaseOrder`, `/procurement/orders`, `po_pid` — none found. Only shipment/receiving endpoints are wired (`stockApi.shipments.*` — list, get, create, addDetails, receive, confirmCosts, confirm (deprecated), updateDiscrepancy). There is no `purchaseOrderApi` object, no `POCreate`/`POOut`/`POStatusUpdate`/`POItemCreate`/`POItemOut` interfaces — meaning even if the UI were rebuilt, there is currently zero typed API surface to call the existing, fully functional backend PO routes.
4. **No status filtering or search on the (archived) list view**, and none planned in any code seen.

### Backend

5. **`PurchaseOrderItem.received_quantity` is never updated anywhere in the codebase.** It is initialized to `0` at PO-item creation (`router.py` ~line 206) and is read by status-recalculation logic (`router.py` lines ~121–146, which checks `received_quantity >= ordered_quantity` to help decide PO status) — but nothing ever writes to it:
   - Stage 1 `receive_shipment()` (lines 467–505) writes to `InventoryLedger` and `current_stocks`, but never touches `purchase_order_items.received_quantity`.
   - Stage 2 `confirm_costs()` (lines 510–655) writes `CostLayer`, `SupplierInvoice`, `ApLedger` rows, but also never touches `received_quantity`.
   - The only place real received quantity is captured is `ReceivingDetail.quantity_actual` (per shipment line), which is never synced back to the corresponding `purchase_order_items` row via `po_item_id`.
   - **Practical effect:** a PO can never be legitimately or automatically driven into `Partially_Received` or `Closed` based on actual receiving activity, because the field the status logic depends on is permanently stuck at its default. The only automatic status change implemented is Draft → Open when a shipment is created against the PO (lines 343–347) — there is no automatic progression beyond that point.
6. **No TODO/FIXME/placeholder comments found** anywhere in `backend/procurement/router.py`, `models.py`, or `schemas.py`. The deprecated `/shipments/{id}/confirm` endpoint is an intentional, documented deprecation (HTTP 410 with a message), not a stub.
7. **No discount field exists anywhere in the PO backend** (`POItemCreate`, `POItemUpdate`, `PurchaseOrderItem` model) even though the archived frontend design assumes one. If the archived UI is ever reconnected, this needs to be reconciled — either add discount support to the backend schema/model, or strip it from the UI.
8. **`get_current_user()` is a known stub (documented in `CLAUDE.md`)** that returns the first DB user instead of decoding the JWT. This means the `require_permission("manage_purchase_orders")` guards on PO create/status-update endpoints are not real authorization checks yet. This is a system-wide issue, not unique to procurement, but it does mean PO write endpoints are not currently access-controlled in practice.

### Schema alignment

9. **No discrepancies** between `backend/procurement/models.py` and `/docs/schema.dbml` — all columns, types, foreign keys, and the `po_status` enum match exactly for both `purchase_orders` and `purchase_order_items`.

---

## Summary Table

| Area | Status | Key File(s) | Key Finding |
|---|---|---|---|
| PO Creation UI | Stub | `frontend/src/pages/procurement/PurchaseOrders.tsx` | "Not yet implemented"; archived design exists but disconnected and partly incompatible |
| PO List Page | Stub | Same | Route/nav exist, page is a stub; archived list has 5 columns, no filters |
| PO Detail Page | Stub | Same | Archived detail modal exists but never shows `received_quantity`; uses client-side discount math not in backend |
| Frontend API layer | Missing | `frontend/src/services/api.ts` | Zero PO interfaces/functions; only shipment endpoints wired |
| Backend routes | Complete | `backend/procurement/router.py` | 5 PO endpoints + 7 shipment endpoints, full status-transition validation |
| Backend models | Complete, matches DBML | `backend/procurement/models.py` | No discrepancies vs. schema.dbml |
| Backend schemas | Complete | `backend/procurement/schemas.py` | All Create/Update/Out schemas present and correctly scoped |
| `po_pid` generation | Implemented | `backend/procurement/router.py` (~182–197) | `PO-{po_id:06d}`, generated post-flush, same pattern as `sale_pid` |
| `total_amount` | Implemented, server-side | `backend/procurement/router.py` (~199–210, 261–267) | Recomputed on create and item update; no discount support |
| `received_quantity` sync | **Missing** | `backend/procurement/router.py` (receive/confirm-costs handlers) | Never written anywhere; blocks real Partially_Received/Closed progression |
| Discount support | **Missing in backend** | `backend/procurement/schemas.py`, `models.py` | Present only in archived frontend design — needs reconciliation if reused |
| Auth enforcement on PO writes | Weak (system-wide issue) | `auth/dependencies.py` (`get_current_user` stub) | Permission guards present but not actually enforced yet |

No changes have been made to any code — this is a read-only audit.
