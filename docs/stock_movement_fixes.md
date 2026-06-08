# Stock Movement — Fix Batch

## Overview
This document covers fixes and missing features across the Stock
Movement module. All fixes reference existing specs in
`/docs/stock_transfers.md` and `/docs/stock_receiving.md`.
Implement in order. Do not modify working functionality.

---

## Fix 1 — Transfer Detail display bug

The inventory_ledger shows correct movement entries with IDs
but the Transfer Detail page is not displaying line items.
Data exists in the DB — this is a rendering/fetch issue only.

- Debug the frontend fetch and mapping in the Transfer Detail
  component
- Confirm Transfer Detail correctly displays all line items
  with: Brand, Variant, PID, SKU, Bundle Count, Qty Requested,
  Qty Released, Qty Received
- Backend must eager-load TransferItem → variant → product
  to resolve Brand correctly via:
  selectinload(TransferItem.variant).selectinload(Variant.product)
- Smoke test: view a posted transfer and confirm all line items
  render with correct values

---

## Fix 2 — Transfer employee tracking fields

Add two employee dropdown fields to the Create Transfer form.
These record the physical people who performed the transfer —
they may not have ERP accounts.

Fields to add:
- Released By — employee who physically released the stock
- Received By — employee who physically received the stock

Both are dropdowns sourced from auth.employees filtered to
is_active = true. Neither auto-fills. The auditor selects
them manually when encoding the transfer after the fact.

Schema check:
- If inventory_transfers.released_by_user_id and
  received_by_user_id currently reference auth.users, add
  two new nullable columns:
  released_by_employee_id int FK → auth.employees.employee_id
  received_by_employee_id int FK → auth.employees.employee_id
- Write and apply migration, update ORM model and schemas
- Keep existing user FK columns intact — do not remove them

Display:
- Transfer Detail header shows Released By and Received By
  as employee names (first + last)
- Transfer Overview does not need these columns

---

## Fix 3 — Transfer XLSX import fully functional

The XLSX import on Create Transfer must work end to end.

Download Template:
- PID as leftmost column
- Headers: PID, variant_name, quantity
- One sample row included

Upload:
- File input alongside Download Template button
- Parsed rows matched by PID and appended to line item grid
- Unrecognized PIDs show inline error per row
- Matched variants populate: Brand, Variant Name, current
  stock at source location
- Bundle Count and Qty fields active per ui_standards §8
  for variants with is_warehouse_bundle conversion

---

## Fix 4 — Receiving XLSX import

Add XLSX import to the New Receiving form. Same pattern as
transfer import.

Download Template:
- PID as leftmost column
- Headers: PID, variant_name, qty_received
- One sample row included

Upload:
- File input alongside Download Template button
- Parsed rows matched by PID and appended to line item grid
- Unrecognized PIDs show inline error per row
- Matched variants populate: Brand, Variant Name
- Bundle Count ↔ Qty Received mechanic per ui_standards §8

---

## Fix 5 — Receiving Phase 2 cost confirmation accessible

The Cost Confirmation page at
`/stock/receiving/:shipment_id/confirm` must be reachable
from the Receiving Overview.

- For shipments with status Pending Confirmation, show a
  "Confirm Costs" action button in the Actions column of
  the Receiving Overview
- Clicking navigates to the cost confirmation form per
  /docs/stock_receiving.md
- Cost confirmation form shows all line items from Stage 1
  with an editable Unit Cost field per line
- On confirm:
  - Cost layer created per line item for FIFO
  - net_unit_cost = Unit Cost as entered
  - supplier cost on variant_suppliers auto-updated with
    confirmed unit cost for the matched supplier
  - Status moves to Confirmed
  - No stock movement at this stage — quantities already
    committed in Stage 1

---

## Fix 6 — Receiving instance not recording details

The receive instance saves but line item details are not
visible on the Shipment Detail page.

- Query the DB directly — confirm whether line items are
  being saved to receiving_details with correct variant_id,
  qty_received values
- If data exists in DB: fix the frontend rendering — debug
  the fetch and mapping in Shipment Detail component
- If data not in DB: fix the backend receiving endpoint to
  correctly persist all line items including variant_id,
  qty_received, location_id, and shipment_id
- Smoke test: create a new receipt with 2 line items, post
  it, query DB directly and confirm both rows exist in
  receiving_details, then confirm they render on the
  Shipment Detail page

---

## Fix 7 — Inventory Ledger inactive

The Inventory Ledger page at /stock/ledger renders but shows
no data. The backend endpoint GET /products/ledger exists
and returns data correctly.

- Debug the React Query integration in Ledger.tsx
- Fix any useEffect conflicts resetting state before query
  data arrives
- Confirm ledger loads real movement data
- Confirm all filters work: reason, location, date range,
  variant keyword search
- Confirm Load More pagination appends correctly
- Smoke test: open ledger, confirm rows appear, apply a
  location filter, confirm results narrow correctly

---

## Fix 8 — PID leftmost on all download templates

Audit every downloadable XLSX template across the app.
PID must be the leftmost column on all templates.

Templates to audit and fix:
- Transfer import template
- Receiving import template
- Product import template (Sheet 1 — Variants)
- Product import template (Sheet 2 — UOM Conversions)
- Product import template (Sheet 3 — Supplier Links)

Fix any template where PID is not the leftmost column.

---

## Fix 9 — Receiving employee fields from auth.employees

On the New Receiving form and Cost Confirmation form,
Received By and Inspected By must be sourced from
auth.employees.

Schema check:
- If inventory_shipments currently stores received_by as
  a user FK, add new nullable columns:
  received_by_employee_id int FK → auth.employees.employee_id
  inspected_by_employee_id int FK → auth.employees.employee_id
- Write and apply migration, update ORM model and schemas
- Keep any existing user FK columns intact

UI:
- Both fields are dropdowns from auth.employees filtered
  to is_active = true
- Neither auto-fills — auditor selects manually
- Display employee full name (first + last) in dropdown
  and on Shipment Detail page

---

## Completion Criteria

Report back with:
- A completed checklist covering all 9 fixes
- DB query results for Fix 6 smoke test
- Any decisions made during implementation
- Any fixes that were blocked and why