# Inventory — Product Catalogue, Detail, and Creation Pages

## Access
- Read (Catalogue): All authenticated users
- Create / Edit: Admin and Manager roles only

---

## Page 1 — Product Catalogue (`/inventory`)

### Layout
Full-width table view. Filter panel on the left. Table on the right.
Export and column picker controls on the top right.
All data fetched via React Query per ui_standards §4.

### Filter Panel (left)
All filters apply simultaneously and update the table in real time:
- Keyword search — follows ui_standards §1. Searches across: brand,
  variant name, PID, SKU, barcode, category
- Category — dropdown of active categories, supports parent/child
  hierarchy display
- Product Type — multi-select: Inventory, Non-Inventory, Service
- Status — toggle: Active / Inactive / Both (default: Active only)
- Supplier — dropdown of active suppliers
- Dynamic attribute filters — system reads all unique attribute keys
  across all variants and generates a filter dropdown per key
  automatically. Only keys that exist in the data appear.

### Table (one row per variant)
Follows ui_standards §6 for column visibility, sorting, and default
variant emphasis.

Permanently visible columns (cannot be hidden):
- Brand
- Variant Name (with "Default" badge and bold weight for default
  variant; muted appearance for non-default siblings)
- PID

Toggleable columns (via ⚙ column picker, top right):
- SKU
- Product Type
- Category (primary category)
- Price (inherited price shown greyed out on non-default variants)
- Promo Price (with visual indicator when active)
- Total Stock (sum of physical location quantities only;
  Virtual locations excluded)
- Status
- Actions (View, Edit)

Dynamic location columns:
- Column picker has two groups: Physical Locations and Virtual
  Locations
- Checked locations appear as individual stock columns
- Virtual location columns visually distinguished (italicized header,
  muted color)
- Total Stock column always visible regardless of selections
- Column selection persists in localStorage per user

Sortable columns:
- Click header to sort ascending, click again for descending
- Sortable by: Brand, Variant Name, PID, SKU, Category

### Export
- Export button top right, exports current filtered result set
- Base export includes all visible table columns
- Additional Fields toggle panel before export allows inclusion of:
  cost layers (net_unit_cost, FIFO layers), supplier details
  (gross_cost, supplier_discount, supplier_sku), attributes,
  barcodes, UOM conversions
- Format: XLSX

### Actions
- Clicking a row or View navigates to Product Detail page
- Edit navigates directly to Product Detail page
- New Product button (top right, Admin/Manager only) navigates to
  Product Creation page

---

## Page 2 — Product Detail (`/inventory/:variant_id`)

### Layout
Full page. All fields inline editable. Page is simultaneously view
and edit — no separate edit mode. Save button appears when any field
is modified. All data fetched via React Query per ui_standards §4.
Skeleton loaders shown while data loads per ui_standards §5.

Follows ui_standards §7 for variant structure, price inheritance,
and supplier link inheritance.

### Product Header Section (shared across all variants)
- Brand (editable)
- Product type (editable, dropdown)
- Description (editable, text area)
- Base UOM (editable, dropdown)
- Categories (editable, multi-select from active categories)
- Status (editable, toggle Active/Inactive)

### Sibling Variants Panel
Table of all variants under the same product.
- Current variant pre-expanded
- Other variants collapsible — click to expand
- Add Variant button at bottom of panel

Each expanded variant row contains the following sections:

#### Variant Fields
- Variant name (editable)
- PID (editable)
- SKU (editable)
- is_default toggle (marking true automatically unmarks previous
  default)
- Attributes (dynamic key-value list, add/remove rows)

#### Pricing Section
- Price (editable; non-default variants show inherited value greyed
  out with "Reset to default" option if no override set)
- Promo Price (editable, nullable — clear to deactivate promo;
  same inheritance behavior as Price)

#### Price History
- Flat list of price changes, latest 10 shown, load more
- Columns: Date, Old Price, New Price, Old Promo Price,
  New Promo Price, Changed By
- Populated from variant_price_history
- Automatically recorded by backend on price or promo_price save

#### Barcodes Section
- Table: Barcode value, UOM, Is Primary, Actions
- Add, edit, remove inline
- At most one is_primary per variant

#### UOM Conversions Section
- Table: From UOM, To UOM, Factor, Warehouse Bundle, Actions
- Add, edit, remove inline
- Warehouse Bundle column shows Yes/No badge
- Toggle button per row to set/unset is_warehouse_bundle
- At most one is_warehouse_bundle per variant

#### Bundle Components Section
- Only visible when variant has bundle components
- Table: Variant Name, PID, Quantity, Actions
- Add, edit, remove inline

#### Supplier Links Section
- Table: Supplier Name, Supplier SKU, Gross Cost, Supplier Discount %,
  Is Primary, Actions
- Add, edit, remove inline
- At most one is_primary per variant
- Supplier SKU pre-fills from variant's internal SKU per
  ui_standards §3
- Non-default variants show inherited supplier links greyed out
  with override option per ui_standards §7

#### Cost History
- Flat list of cost changes, latest 10 shown, load more
- Columns: Date, Supplier, Old Gross Cost, New Gross Cost,
  Old Discount, New Discount, Changed By
- Populated from variant_cost_history
- Automatically recorded by backend on gross_cost or
  supplier_discount save

#### Stock Section
- Total physical stock (sum, Virtual excluded)
- Location breakdown table — same dynamic column picker as catalogue
- Virtual location stock shown separately below, clearly labeled

#### Sales History
- Flat list, latest 10 shown, load more
- Columns: Sale PID, Date, Cashier, Quantity Sold, Unit Price,
  Line Total, Sale Status
- Derived from sale_items joined to sales

#### Purchase History
- Flat list, latest 10 shown, load more
- Columns: Shipment PID, Date, Supplier, Quantity Received,
  Net Unit Cost, QC Status
- Derived from receiving_details joined to inventory_shipments

---

## Page 3 — Product Creation (`/inventory/new`)

### Layout
Single form page. Two sections: Product Info and Variants.
All data fetched via React Query per ui_standards §4.

### Product Info Section
- Brand (required)
- Product type (required, dropdown: Inventory / Non-Inventory /
  Service)
- Description (optional, text area)
- Base UOM (required, dropdown of active UOMs)
- Categories (optional, multi-select from active categories)

### Variants Section
At least one variant (the default) must be created before saving.

Fields per variant row:
- Variant name (required)
- PID (required, must be unique)
- SKU (optional)
- Price (required)
- Promo Price (optional)
- Attributes (dynamic key-value builder — add/remove pairs)
- Barcodes (add/remove rows: barcode value, UOM, is_primary)
- UOM Conversions (add/remove rows: from UOM, to UOM, factor,
  is_warehouse_bundle)
- Is Bundle toggle — when enabled, component selector appears:
  search and select component variants with quantities
- Supplier link (optional — select supplier, enter Supplier SKU
  (auto-fills from SKU per ui_standards §3), Gross Cost,
  Supplier Discount %)

Additional variants added via Add Variant button. One must be
marked default.

### Import Section
Follows ui_standards §2 — Upsert Standard.

- Download Template button — generates blank XLSX with all headers.
  Headers: brand, product_type, base_uom_code, variant_name, PID,
  price, description, sku, promo_price, category, attributes,
  barcode, barcode_uom, is_primary_barcode, from_uom, to_uom,
  conversion_factor, is_warehouse_bundle, supplier_name,
  supplier_sku, gross_cost, supplier_discount
- Template includes one sample row as guidance
- Upload and Import — accepts filled XLSX
- PID is the anchor key — existing PID triggers update mode,
  new PID triggers create mode
- Diff modal shown before applying updates per ui_standards §2
- Supplier links optional per row — blank supplier columns skipped
- Failed rows do not block successful rows

---

## Backend Notes for CC

### Migrations
Both history tables (variant_price_history, variant_cost_history)
already applied and confirmed live. No further migrations needed
for this spec.

### Backend behavior required
- Price/promo_price save → auto-insert to variant_price_history
- gross_cost/supplier_discount save → auto-insert to
  variant_cost_history
- Stock totals exclude Virtual location types from physical totals
- Virtual stock queryable separately
- All list endpoints support cursor-based pagination
- Variant list endpoint returns all siblings when queried by
  product_id

### Performance
- All endpoints used by this module must support React Query's
  caching pattern — consistent query keys, proper cache headers
- Variant detail endpoint must eager-load: bundle_components,
  barcodes, uom_conversions, supplier_links, sibling variants

---

## Spec Status
Brand: replaces product name throughout
Filters: all active (keyword, category, product type, status,
  supplier, dynamic attributes)
Export: visible columns + optional additional fields toggle
Column picker: all columns toggleable, location columns grouped
Sortable: Brand, Variant Name, PID, SKU, Category
Default variant: bold + Default badge in catalogue and detail
Price inheritance: default variant → siblings, greyed out with
  override option
Supplier link inheritance: same pattern as price
Supplier SKU auto-fill: from variant SKU per ui_standards §3
UOM Conversions: is_warehouse_bundle column and toggle added
Barcodes and UOM Conversions: available at creation time
Import: upsert standard per ui_standards §2
Performance: React Query throughout per ui_standards §4 and §5
History sections: load more pattern, never unbounded

#### UOM Conversions Section
- Table: From UOM, To UOM, Factor, Warehouse Bundle, Price, 
  Promo Price, Actions
- Price (optional) — selling price when this variant is sold
  in this UOM. If null, system falls back to variant base
  price × factor.
- Promo Price (optional) — promo price for this UOM. If null,
  no promo applies for this UOM.
- Add, edit, remove inline
- Warehouse Bundle column shows Yes/No badge
- Toggle button per row to set/unset is_warehouse_bundle
- At most one is_warehouse_bundle per variant