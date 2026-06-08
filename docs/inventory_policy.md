# Inventory Policy

## Overview
System-wide inventory behavior policies configurable by Admin
and Manager roles via Settings. Policies are stored in the
`system_settings` table as key-value pairs. All policy checks
are enforced at the backend — the frontend reads policy state
to adjust UI accordingly but the backend is the authoritative
source.

---

## Schema

### system_settings table
```sql
CREATE TABLE system_settings (
  key varchar PRIMARY KEY,
  value varchar NOT NULL,
  updated_at timestamp,
  updated_by_user_id int REFERENCES auth.users(user_id)
);
```

Seeded on first run with default values:
```sql
INSERT INTO system_settings (key, value) VALUES
  ('allow_negative_stock', 'false');
```

---

## Policy: Allow Negative Stock

### Key
`allow_negative_stock`

### Values
- `'false'` (default) — insufficient stock blocks sales and
  transfers with HTTP 400
- `'true'` — sales and transfers post regardless of stock
  level, current_stocks.quantity can go negative

### Scope
Applies to both:
- Sale posting (`post_draft` in sales/router.py)
- Transfer posting (`POST /transfers/` in stock movement)

### Behavior when enabled
- Stock deduction proceeds even if result would be negative
- `current_stocks.quantity` updated normally, can go below 0
- No error raised for insufficient stock
- Inventory ledger entries created as normal
- Sale and transfer records created as normal

### Behavior when disabled (default)
- Current behavior preserved
- HTTP 400 returned when stock would go negative
- Transaction blocked, form state preserved with error message

### Policy check implementation
Backend reads `system_settings` where `key = 'allow_negative_stock'`
on each sale post and transfer post. Cache this value in the
request context — do not query per line item.

---

## Settings UI

### Location
Settings page → new tab: **Inventory Policy**
Tab order: insert after Appearance tab.

### Inventory Policy tab contents

#### Allow Negative Stock
- Toggle switch — On / Off
- Default: Off
- Label: "Allow Negative Stock"
- Description: "When enabled, sales and transfers will post
  even if stock levels would go below zero. Useful for
  after-the-fact auditor encoding where stock counts may
  not be current."
- Changing the toggle immediately writes to system_settings
  via PATCH /settings/inventory-policy
- Shows last updated timestamp and updated by user name

---

## Catalogue — Negative Stock visibility

### Total Stock column — sortable
- Click Total Stock column header to sort ascending
  (negative values bubble to top)
- Click again to sort descending
- Click again to clear sort (default order)
- Applies to the computed Total Stock column (sum of
  physical locations only)

### Per-location stock columns — sortable
- Same sort behavior when individual location columns
  are visible via the column picker

### Negative Stock filter
- Add "Negative Stock" as a filter option in the catalogue
  filter panel under Status filters
- When selected: shows only variants where at least one
  physical location has current_stocks.quantity < 0
- Can be combined with other filters (keyword, category,
  supplier, etc.)
- Works with existing export — filter to negative stock,
  export to XLSX for team review and action

---

## Backend Implementation Notes

### system_settings endpoint
- GET /settings/inventory-policy — returns current policy values
- PATCH /settings/inventory-policy — updates policy values
  Requires Admin or Manager role.

### post_draft modification (sales/router.py)
Current code raises HTTP 400 on insufficient stock.
Modify to:
1. Read allow_negative_stock from system_settings at start
   of post_draft
2. If allow_negative_stock = true: skip stock sufficiency
   check entirely, proceed with deduction
3. If allow_negative_stock = false: existing behavior,
   raise HTTP 400 on insufficient stock

### Transfer post modification
Same pattern as post_draft:
1. Read allow_negative_stock from system_settings
2. If true: skip stock sufficiency check
3. If false: existing HTTP 400 behavior

### Negative stock catalogue filter (backend)
Add optional query parameter to GET /products/:
- `negative_stock=true` — filter to variants where any
  location has current_stocks.quantity < 0
- Join current_stocks, filter WHERE quantity < 0,
  return distinct variant_ids

### Stock sort (backend)
Add optional query parameter to GET /products/:
- `sort_by=total_stock&sort_dir=asc|desc`
- Total stock computed as SUM of physical location
  current_stocks (Virtual excluded)
- Applied after all other filters

---

## Future Policy Flags
Additional inventory policy settings to be added here
as needed. Examples for future consideration:
- allow_oversell_non_inventory (skip stock check for
  Non-Inventory product types entirely)
- low_stock_threshold (trigger warning at X units)
- reorder_point (trigger reorder suggestion at X units)