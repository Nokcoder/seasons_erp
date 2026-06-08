# Supplier Management

## Route
`/procurement/suppliers`

## Access
Admin and Manager roles only.

## Navigation
Procurement section in the nav has two sub-items:
- Suppliers (active — this page)
- Purchase Orders (placeholder stub — not yet implemented)

## Overview
Central management of all suppliers. Supplier Code is the
stable anchor — it never changes even if the supplier name
changes. Used as the join key in all spreadsheet imports
involving suppliers.

---

## Schema Addition Required
Before implementation, add to inventory.suppliers:
- supplier_code varchar UNIQUE NOT NULL

Migration must apply before any frontend work. Update ORM
model and all schemas. supplier_code is user-assigned at
creation and read-only after save.

Also update the variant supplier link import template
(Sheet 3 in the product import XLSX) to use supplier_code
instead of supplier_name as the anchor column.

---

## Page — Suppliers (`/procurement/suppliers`)

### Table Columns
- Supplier Code
- Supplier Name
- Bank Account Name
- Payment Terms (days — e.g. 0 = COD, 30 = Net 30)
- Status (Active / Inactive)
- Actions (Edit, Deactivate / Reactivate)

### Filters
- Keyword search bar per ui_standards §1 — searches
  supplier_code and supplier_name
- Status toggle: Active / Inactive / Both (default: Active)

### CRUD
- Create — inline form or modal. Fields: Supplier Code
  (required, unique), Supplier Name (required), Bank Account
  Name (optional), Payment Terms in days (required, default 0)
- Edit — same fields, Supplier Code read-only
- Deactivate — sets is_deleted to true. Deactivated suppliers
  dimmed but visible with Reactivate option.
- Reactivate — sets is_deleted to false
- No hard deletes

### Global Impact
Deactivated suppliers (is_deleted = true) must be excluded
from all supplier dropdowns system-wide:
- Receiving form supplier dropdown
- Variant supplier link add form on Product Detail page
- New Product creation form supplier section
- Any future procurement forms

### Data Fetching
All data via React Query per ui_standards §4.
Skeleton loaders per ui_standards §5.
Stale time: 10 minutes (reference data).