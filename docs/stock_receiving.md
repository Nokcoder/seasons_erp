# Stock Receiving

## Route
`/stock/receiving`

## Access
Admin and Manager roles only.

## Overview
Receiving logs inventory arriving from suppliers. It operates
as a two-stage process. The two stages do not block each other —
warehouse staff record quantities immediately on arrival, office
staff confirm cost details separately at their own pace.

Only accepted inventory is recorded. Rejected items simply do
not appear on the form. No rejection tracking, no QC status,
no Quarantine routing.

---

## Two-Stage Workflow

### Stage 1 — Physical Arrival
Recorded by warehouse staff immediately when goods arrive.
Records quantities only. Stock enters the system immediately
and is visible in stock counts. Status: Pending Confirmation.
Cost layers are not yet created at this stage.

### Stage 2 — Cost Confirmation
Recorded by office staff after the fact. Adds cost details
to the existing shipment. Creates FIFO cost layers and updates
supplier cost. Status moves to Confirmed. No stock movement
happens at Stage 2 — only cost data is committed.

Stock from Stage 1 shipments is available immediately and
can be sold before Stage 2 is complete. This is an accepted
operational tradeoff for speed.

---

## Pages

### 1. New Receiving (`/stock/receiving/new`)

Stage 1 form. Records physical arrival — quantities only.

#### Header Fields
- Supplier (required — dropdown of active suppliers,
  supplier_code as anchor)
- Document ID (supplier's delivery reference number, required)
- PO Link (optional — dropdown of open POs for selected
  supplier)
- Date Received (defaults to today, editable)
- Received By (auto-fills logged-in user, editable)
- Destination Location (required — dropdown of active
  physical locations, Virtual excluded)

#### Line Item Grid
Columns: Brand, Variant, PID, Bundle Count, Qty Received

Item search:
- Standard multi-keyword search panel on the left per
  ui_standards §1
- Searches across: brand, variant name, PID, SKU, barcode
- Click to add — panel stays open, does not refresh after
  click

XLSX import:
- Download Template button — blank XLSX with headers:
  PID, variant_name, qty_received. PID is leftmost column.
- Upload button alongside Download Template — parsed rows
  append to grid
- PID is the anchor per ui_standards §2

Bundle Count ↔ Qty Received mechanic per ui_standards §8.

#### On Save (Stage 1 post)
- Stock immediately added to destination location via
  inventory ledger
- Stock visible in current_stocks and catalogue immediately
- Flagged as Pending Confirmation in:
  - Product Detail stock section
  - Inventory Ledger (reference links back to shipment)
  - Receiving Overview status column
- Cost layers NOT created at this stage

#### Actions
- Save Receipt — posts Stage 1, stock enters system
- Discard

---

### 2. Cost Confirmation (`/stock/receiving/:shipment_id/confirm`)

Stage 2 form. Accessible from Receiving Overview by clicking
a Pending Confirmation shipment.

#### Header (read-only from Stage 1)
Shipment PID, Supplier, Document ID, Date Received,
Received By, Destination Location.

#### Additional Header Field
- Inspected By (editable — person who verified cost details)

#### Line Item Grid
Columns: Brand, Variant, PID, Qty Received (read-only from
Stage 1), Unit Cost, Line Total (computed: Qty × Unit Cost)

- Unit Cost editable per line item
- Line Total auto-computes on Unit Cost entry

#### On Confirm (Stage 2 post)
- Cost layer created per line item for FIFO
  (net_unit_cost = Unit Cost as entered)
- supplier_cost on variant_suppliers auto-updated with
  confirmed unit cost for the matched supplier
- Status moves to Confirmed
- No stock movement — quantities already committed in Stage 1

#### Actions
- Confirm Costs — completes Stage 2
- Cancel — returns to overview without saving

---

### 3. Receiving Overview (`/stock/receiving`)

One row per shipment.

#### Table Columns
- Shipment PID
- Supplier
- Document ID
- Date Received
- Destination Location
- PO Reference
- Status (Pending Confirmation / Confirmed)
- Actions (View, Confirm Costs — contextual per status)

#### Filters
- Keyword search bar per ui_standards §1 — searches
  Shipment PID, Supplier, Document ID
- Supplier filter
- Status filter (Pending Confirmation / Confirmed)
- Date range filter

#### Export
XLSX export of current filtered result set.

#### Actions
- + New Receipt button (top right)

---

### 4. Shipment Detail (`/stock/receiving/:shipment_id`)

Read-only view of a confirmed shipment.

#### Header (read-only)
Shipment PID, Supplier, Document ID, Date Received,
Received By, Inspected By, Destination Location,
PO Reference, Status.

#### Line Items Table
Columns: Brand, Variant, PID, SKU, Bundle Count,
Qty Received, Unit Cost, Line Total.

#### Actions
- Export to XLSX

---

## Pending Confirmation Indicator
Stock from Stage 1 shipments is flagged system-wide:
- Product Detail stock section shows a warning indicator
  next to stock quantities from unconfirmed shipments
- Inventory Ledger shows unconfirmed entries with a
  Pending badge
- Receiving Overview Status column clearly shows
  Pending Confirmation vs Confirmed

---

## Data Fetching
All data via React Query per ui_standards §4.
Skeleton loaders on all sections per ui_standards §5.
Reference data (suppliers, locations) stale time 10 minutes.
Transactional data (shipments) stale time 30 seconds.