# Stock Transfers

## Route
`/stock/transfers`

## Access
Admin and Manager roles only.

## Overview
Transfers move stock between locations. A transfer posts immediately —
no draft state. The spreadsheet import serves as the planning tool
before posting. Virtual locations (Quarantine, Adjustment) are
excluded from normal transfer flows.

---

## Pages

### 1. Create Transfer (`/stock/transfers/new`)

#### Header Fields
- From Location (required — dropdown of active physical locations
  only, Virtual locations excluded)
- To Location (required — dropdown of active physical locations
  only, Virtual locations excluded)
- Date (defaults to today, editable for backdating)
- Requested By (auto-fills logged-in user, editable)
- Remarks (optional free text)

#### Line Item Grid
Columns: Brand, Variant, PID, Current Stock at Source,
Bundle Count, Qty

Item search:
- Standard multi-keyword search panel on the left per
  ui_standards §1
- Searches across: brand, variant name, PID, SKU, barcode
- Click to add to grid — panel stays open, does not refresh
  after click

XLSX import:
- Download Template button — blank XLSX with headers:
  PID, variant_name, quantity. PID is leftmost column.
- Upload button alongside Download Template — parsed rows
  append to the line item grid
- PID is the anchor — matched variants added, unrecognized
  PIDs show inline error per ui_standards §2

Bundle Count ↔ Qty mechanic per ui_standards §8:
- Variant with is_warehouse_bundle conversion: both Bundle
  Count and Qty fields active and linked
- Bundle Count entered → Qty = bundle_count × factor
- Qty entered → Bundle Count = ceil(qty / factor), always
  rounds up
- No warehouse bundle conversion: Bundle Count hidden,
  Qty field only
- Current Stock at Source updates dynamically when From
  Location changes

#### Actions
- Post Transfer — validates all fields, creates inventory
  ledger entries, deducts from source location, adds to
  destination location. Auto-fills requested_by_user_id
  and released_by_user_id with logged-in user.
  received_by_user_id left nullable for future multi-step
  workflow. On insufficient stock, shows inline error
  preserving all form state.
- Cancel — clears form and navigates back to overview

#### No Draft State
Transfers post immediately. No Save Draft button. The
downloaded XLSX template serves as the planning/draft tool.

---

### 2. Transfer Overview (`/stock/transfers`)

One row per transfer.

#### Table Columns
- Transfer PID
- From Location → To Location
- Date
- Requested By
- Total Bundle Count (informational)
- Status (Posted / Voided)
- Actions (View)

#### Filters
- Keyword search bar per ui_standards §1 — searches
  Transfer PID, location name, requested by
- Location filter (From or To)
- Date range filter
- Status filter (Posted / Voided)

#### Export
XLSX export of current filtered result set.

#### Actions
- + New Transfer button (top right)

---

### 3. Transfer Detail (`/stock/transfers/:transfer_id`)

Read-only view of a specific transfer.

#### Header (read-only)
Transfer PID, From Location, To Location, Date, Requested By,
Released By, Remarks, Status.

#### Line Items Table
Columns: Brand, Variant, PID, SKU, Bundle Count, Qty Requested,
Qty Released, Qty Received (nullable — reserved for future
multi-step workflow), Current Stock at Destination.

Backend must eager-load: TransferItem → variant → product
to resolve Brand correctly.

#### Actions
- Void (Posted only) — voids the transfer, reverses inventory
  ledger entries, status moves to Voided
- Export line items to XLSX

---

## Data Fetching
All data via React Query per ui_standards §4.
Skeleton loaders on all sections per ui_standards §5.
Reference data (locations) stale time 10 minutes.
Transactional data (transfers) stale time 30 seconds.