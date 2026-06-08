# Stock Movement Module

## Navigation
Top-level section in the nav. Accessible to Admin and Manager roles
only. All data fetched via React Query per ui_standards §4. Skeleton
loaders shown while data loads per ui_standards §5.

## Sub-pages
1. Transfers — Create, Overview, Detail
2. Receiving — Supplier Declaration, Warehouse Count, Reconciliation,
   Overview
3. Inventory Ledger — standalone browser

---

## Section 1 — Transfers

### 1a. Create Transfer (/stock/transfers/new)

#### Header Fields
- Transfer PID (auto-generated on post)
- From Location (dropdown of all active locations including Virtual)
- To Location (dropdown of all active locations including Virtual)
- Date (defaults to today, editable for backdating)
- Requested By (auto-fills with logged-in user, editable)
- Remarks (optional text field)

#### Line Item Grid
Columns: Brand, Variant, PID, Current Stock at Source, Bundle Count,
Qty

- Item search via standard multi-keyword search panel (left panel,
  same pattern as workstation). Searches across: brand, variant name,
  PID, SKU, barcode. Follows ui_standards §1. Click to add to grid.
  Panel stays open and does not refresh after click.
- XLSX import option with downloadable blank template. Follows
  ui_standards §2 — PID as anchor, upsert behavior. Template headers:
  PID, variant_name, quantity. Imported rows append to the grid.
- Bundle Count and Qty are linked fields per line item per the Bundle
  Count Mechanic defined in ui_standards §8:
  - If variant has is_warehouse_bundle conversion: both fields active
  - User enters Bundle Count → Qty = bundle_count × factor (auto-fills)
  - User enters Qty → Bundle Count = ceil(qty / factor) (auto-fills,
    always rounds up — fractions count as 1 whole bundle)
  - If no warehouse bundle conversion exists: Bundle Count hidden,
    Qty only
- Current Stock at Source updates dynamically when From Location
  changes

#### Actions
- Save Draft — saves without posting, no ledger entries created
- Post — validates all fields, creates inventory ledger entries,
  deducts from source location, adds to destination location.
  Logged-in user auto-fills requested_by_user_id and
  released_by_user_id. received_by_user_id left nullable for future
  multi-step workflow.
- Discard — clears the form

### 1b. Transfer Overview (/stock/transfers)

List of all transfer instances. One row per transfer.

#### Table Columns
- Transfer PID
- From Location → To Location
- Date
- Requested By
- Total Bundle Count (informational)
- Status (Draft / Posted — future: Released, Received)
- Actions (View)

#### Filters
- Multi-keyword search bar (global standard, ui_standards §1)
- Location filter (From or To)
- Date range
- Status filter

#### Export
XLSX export of current filtered result set.

### 1c. Transfer Detail (/stock/transfers/:transfer_id)

Deep dive into a specific transfer.

#### Header
All header fields read-only: Transfer PID, From, To, Date,
Requested By, Released By, Remarks, Status.

#### Line Items Table
Columns: Brand, Variant, PID, Bundle Count, Qty Requested,
Qty Released, Qty Received (nullable for now),
Current Stock at Destination.

#### Actions
- Void (Draft only) — cancels the transfer, no ledger impact
- Export line items to XLSX

---

## Section 2 — Receiving

### 2a. Supplier Declaration (/stock/receiving/new)

Recorded by receiving clerk or equivalent role.

#### Header Fields
- Shipment PID (auto-generated on save)
- Supplier (dropdown of active suppliers)
- Document ID (supplier's delivery reference number)
- PO Link (optional — dropdown of open POs for selected supplier)
- Date Received (defaults to today, editable)
- Received By (auto-fills logged-in user, editable)

#### Line Item Grid
Columns: Brand, Variant, PID, Bundle Count, Qty Declared, Breakage

- Item search via standard multi-keyword search panel (left panel).
  Searches across: brand, variant name, PID, SKU, barcode.
  Follows ui_standards §1.
- XLSX import with downloadable blank template. Follows ui_standards
  §2 — PID as anchor, upsert behavior. Template headers:
  PID, variant_name, qty_declared, breakage.
- Bundle Count ↔ Qty Declared linked via is_warehouse_bundle
  conversion per ui_standards §8.
- Breakage field per line item — records damaged units noted at
  delivery time. Informational at this stage.

#### Actions
- Save — saves the supplier declaration. Status: Pending.
- Discard

### 2b. Warehouse Count (/stock/receiving/:shipment_id/count)

Recorded by warehouse staff, separate from Phase 1a.

#### Header (read-only)
Shipment PID, Supplier, Document ID, Date Received, Received By.

#### Line Item Grid
Columns: Brand, Variant, PID, Qty Declared (read-only from Phase 1a),
Bundle Count, Qty Actual, Qty Rejected, QC Status

- QC Status per line item: Pending, Passed, Failed, Partially Passed
- Inspected By (auto-fills logged-in user, editable)
- Inspection Date (defaults to today, editable)
- Bundle Count ↔ Qty Actual linked via is_warehouse_bundle conversion
  per ui_standards §8.

#### Actions
- Save Count — saves warehouse count. Status: Counted.
- Discard

### 2c. Reconciliation (/stock/receiving/:shipment_id/reconcile)

Links Phase 1a and 1b. Accessible after both phases are complete.

#### Discrepancy Table
Columns: Brand, Variant, PID, Qty Declared, Qty Actual, Qty Rejected,
Variance (Actual - Declared), QC Status, Disposition

- Variance highlighted in warning color when non-zero
- Disposition options per line: Accept, Reject, Partial Accept
- Rejected items automatically routed to Quarantine Virtual location
  via inventory ledger on post
- Option to trigger supplier return for rejected items — creates a
  draft supplier return record pre-filled with rejected line items

#### Actions
- Post Reconciliation — creates all inventory ledger entries for
  accepted quantities at the designated receiving location.
  Quarantine entries created for rejected quantities.
  Status: Closed.
- Export reconciliation report to XLSX

### 2d. Receiving Overview (/stock/receiving)

List of all shipment instances.

#### Table Columns
- Shipment PID
- Supplier
- Document ID
- Date Received
- PO Reference
- Status (Pending / Counted / Closed)
- Actions (View, Count, Reconcile — contextual per status)

#### Filters
- Multi-keyword search bar (global standard, ui_standards §1)
- Supplier filter
- Status filter
- Date range

#### Export
XLSX export of current filtered result set.

---

## Section 3 — Inventory Ledger (/stock/ledger)

Standalone browser of all non-sale inventory movements.

### Scope
Pulls from inventory.inventory_ledger. Excludes SALE reason —
that belongs to the Sales Ledger. Shows:
- RECEIVE
- TRANSFER_IN
- TRANSFER_OUT
- RETURN_IN
- RETURN_OUT
- ADJUST

### Table Columns
- Date
- Brand
- Variant Name
- PID
- Location
- Reason
- Qty Change (positive = inbound, negative = outbound)
- Reference Type
- Reference ID (clickable — links to the source document)

### Filters
- Multi-keyword search bar (global standard, ui_standards §1 —
  searches brand, variant name, PID, reference ID)
- Location filter
- Reason filter (multi-select)
- Date range filter
- Variant/product filter

### Export
XLSX export of current filtered result set including all columns.

---

## Bundle Count Mechanic

The Bundle Count Mechanic is defined as a global standard in
ui_standards §8 and applies to all quantity entry fields across
transfers and receiving. Refer to ui_standards §8 for the full
specification.

Summary:
- Each variant may have at most one UOM conversion where
  is_warehouse_bundle = true
- When present: Bundle Count and Qty fields shown side by side,
  linked via the conversion factor
- When absent: Bundle Count hidden, Qty field only
- Fractions always round UP to next whole bundle

---

## XLSX Import Templates

All import templates downloadable from their respective forms.
Templates generated by the backend based on current schema.
All imports follow ui_standards §2 — upsert standard.

Transfer import headers: PID, variant_name, quantity
Receiving import headers: PID, variant_name, qty_declared, breakage

---

## Access Control
All stock movement pages: Admin and Manager roles only.
Warehouse Count phase (2b): additionally accessible to Warehouse
Staff role if defined — defer to role configuration in Settings.