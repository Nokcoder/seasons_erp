# Bulk Excel Import Specification

## Overview

A centralised import hub for loading data into the system from XLSX files.
Covers entity types that do not yet have dedicated import support. Entity
types that already have inline import (Products, Transfers, Receiving) are
not moved — their existing forms remain the canonical entry point. This
spec only covers the new hub and new entity types.

All behaviour follows ui_standards §2 (PID as anchor, diff modal,
row-by-row confirm or bulk confirm all, blank = no change).

---

## Navigation

A top-level "Import" item under Settings, visible to Admin only.
Route: `/settings/import`

Alternatively, the import hub can live at `/admin/import` if
restricted to Admin role only is preferred. Either is acceptable;
confirm with CC at implementation time.

---

## Import Hub — `/settings/import`

### Layout

Single page. Left sidebar lists entity types. Main area shows the
selected import form with:
- Brief description of the entity type and its anchor key
- Download Template button — generates a pre-filled header XLSX with
  one sample row
- Upload XLSX input — accepts `.xlsx` and `.xls`
- Validation results panel — shown after upload, before confirmation
- Diff modal (per ui_standards §2) — shown before any writes

### Error handling

- Row-level errors: shown inline in the validation results panel.
  Each failed row shows the row number, the anchor value (if any),
  and a plain-English reason. Failed rows do not block other rows.
- Fatal errors (wrong file format, missing required sheet, unreadable
  file): shown as a banner, no rows processed.
- Partial success: clearly state how many rows succeeded and how
  many failed. Offer to download a failure report as XLSX.

---

## Supported Entity Types

### 1. Customers

**Anchor:** `customer_name` (unique within the system).

Since customers have no user-facing PID, the anchor is customer_name.
If a customer with this exact name exists → update mode.
If no match → create mode.

**Template columns:**

| Column | Required | Notes |
|---|---|---|
| customer_name | Yes | Unique. Update anchor. |
| credit_limit | No | Leave blank = no limit (null). |
| terms_days | No | 0 = COD. Blank = no change (update) or 0 (create). |

**Create rules:**
- `customer_name` required.
- `outstanding_balance` always initialised to 0. Never imported.
- `is_deleted` always initialised to false. Never imported.

**Update rules:**
- Blank `credit_limit` = no change (does not overwrite an existing limit
  with null — use the literal string "no limit" to clear it).
- Blank `terms_days` = no change.

**Diff modal columns:** customer_name, credit_limit, terms_days.

---

### 2. Suppliers

**Anchor:** `supplier_code` (unique, stable identifier).

**Template columns:**

| Column | Required | Notes |
|---|---|---|
| supplier_code | Yes | Unique anchor. Never changed on update. |
| supplier_name | Yes (create) | Blank on update = no change. |
| terms | No | Payment terms in days. Blank = no change or 0. |
| bank_account_name | No | |
| contact_person | No | |
| phone | No | |
| email | No | |
| address | No | |

**Create rules:**
- `supplier_code` and `supplier_name` required.
- `is_deleted` always false. Never imported.

**Update rules:**
- `supplier_code` itself is never updated — it is the anchor.

**Diff modal columns:** supplier_name, terms, bank_account_name.

---

### 3. Opening Stock Balances

**Purpose:** Load initial stock levels at system setup, or correct
balances after a physical count. Each row sets `current_stocks.quantity`
for a specific variant at a specific location via a stock adjustment
(ADJUST reason), not a direct write.

**Anchor:** `PID` + `location_name` composite.

**Template columns:**

| Column | Required | Notes |
|---|---|---|
| PID | Yes | Variant identifier. |
| location_name | Yes | Must match an existing active physical location. |
| quantity | Yes | New stock level (not a delta — this is the target quantity). |
| notes | No | Written to audit log. |

**Behaviour:**
- For each row: compute the delta = `quantity - current_stocks.quantity`.
- Write an `inventory_ledger` entry with reason `ADJUST` and `qty_change = delta`.
- Write a `current_stocks` upsert for the new quantity.
- If `delta = 0`: skip (no-op, no ledger entry written).
- No cost layers are created or modified — this is a stock count correction,
  not a receiving event.

**Diff modal columns:** PID, location_name, current_qty (from DB), new_qty
(from file), delta.

**Restrictions:**
- Virtual locations (Quarantine, Adjustment) cannot be targets.
- Bundle variants are excluded — they hold no stock.
- Non-Inventory and Service variants are excluded.

---

### 4. Variant Price Update

**Purpose:** Bulk update `variants.price` and `variants.promo_price`
across many variants at once. Each price change is recorded in
`variant_price_history` per the existing pricing rules.

**Anchor:** `PID`.

**Template columns:**

| Column | Required | Notes |
|---|---|---|
| PID | Yes | Variant anchor. |
| price | No | New base price. Blank = no change. |
| promo_price | No | New promo price. Blank = no change. |
| clear_promo | No | `true` / `yes` = sets promo_price to null. |

**Rules:**
- `price` cannot be set to 0 or negative.
- `promo_price` cannot exceed `price`.
- Setting `clear_promo = true` clears the promo price even if
  `promo_price` column is blank.
- Pricing fields must never be modified by cost or receiving operations
  (Requirements §7) — this import is the only authorised price write path.
- Each changed price triggers a `variant_price_history` record.

**Diff modal columns:** PID, variant_name, old_price, new_price,
old_promo_price, new_promo_price.

---

### 5. Variant Cost Update

**Purpose:** Bulk update `variant_suppliers.gross_cost` and
`supplier_discount` for a supplier-variant relationship. Each change
is recorded in `variant_cost_history`.

**Anchor:** `PID` + `supplier_code` composite.

**Template columns:**

| Column | Required | Notes |
|---|---|---|
| PID | Yes | Variant anchor. |
| supplier_code | Yes | Supplier anchor. The supplier link must already exist. |
| gross_cost | No | New gross cost. Blank = no change. |
| supplier_discount | No | New discount percentage (0–100). Blank = no change. |

**Rules:**
- The variant-supplier link must already exist. This import does not
  create new supplier links — use the Product Detail page for that.
- `gross_cost` cannot be set to 0 or negative.
- `supplier_discount` must be between 0 and 100 inclusive.
- Each changed cost triggers a `variant_cost_history` record.
- Does not modify `variants.price` or `variants.promo_price`
  (Requirements §7).

**Diff modal columns:** PID, supplier_code, old_gross_cost, new_gross_cost,
old_discount, new_discount.

---

## Backend Endpoints

All endpoints live under `/import/` prefix, require `manage_products`
or specific per-entity permissions, and follow the two-step pattern:

### Step 1 — Validate + Preview

`POST /import/{entity}/preview`

Accepts the parsed rows (JSON). Performs all validation. Returns:
- `valid_rows`: list of rows that passed validation with diff data
  (old values from DB, new values from file)
- `error_rows`: list of rows with errors; each has row number, anchor
  value, and error message
- `summary`: counts of creates, updates, no-ops, errors

No writes. Safe to call repeatedly.

### Step 2 — Confirm

`POST /import/{entity}/confirm`

Accepts confirmed PIDs/anchors (the subset the user approved in the
diff modal). Performs all writes in a single transaction per batch.
Returns count of rows written and any errors that occurred during write
(e.g. a concurrent DB conflict).

### Entity paths

| Entity | Preview | Confirm | Permission |
|---|---|---|---|
| Customers | `POST /import/customers/preview` | `POST /import/customers/confirm` | `manage_customers` |
| Suppliers | `POST /import/suppliers/preview` | `POST /import/suppliers/confirm` | `manage_suppliers` |
| Stock Balances | `POST /import/stock-balances/preview` | `POST /import/stock-balances/confirm` | `manage_products` |
| Variant Prices | `POST /import/variant-prices/preview` | `POST /import/variant-prices/confirm` | `manage_products` |
| Variant Costs | `POST /import/variant-costs/preview` | `POST /import/variant-costs/confirm` | `manage_products` |

### Template download

`GET /import/{entity}/template`

Returns a prebuilt XLSX with correct headers and one sample row.
Generated server-side so it always reflects the current schema.

---

## Import Hub UI Detail

### Entity sidebar

Sidebar items:
- Customers
- Suppliers
- Opening Stock Balances
- Variant Prices
- Variant Costs

Clicking an item loads that entity's import form in the main area.
URL: `/settings/import/{entity}` — shareable and bookmarkable.

### Import form (per entity)

```
┌──────────────────────────────────────────────────────┐
│  [Entity name]                                       │
│  Brief description. Anchor: [anchor field].          │
│                                                      │
│  [Download Template]   [Upload XLSX ▲]               │
│                                                      │
│  ── Validation Results ───────────────────────────── │
│  {N} rows ready · {N} errors                        │
│                                                      │
│  Errors:                                             │
│  Row 3 · PID "WID-999" not found                    │
│  Row 7 · price "−100" is not a valid price          │
│                                                      │
│  [Download Error Report]  [Review & Confirm →]      │
└──────────────────────────────────────────────────────┘
```

"Review & Confirm →" is disabled until at least one valid row exists.
Clicking it opens the diff modal (ui_standards §2).

After confirmation, show a success banner:
`{N} records updated, {N} created. {N} skipped (no change).`

---

## Existing Import Forms — Not Moved

The following already have inline import forms on their respective pages.
They are **not** moved to the hub. The hub is additive only.

| Entity | Location | Anchor |
|---|---|---|
| Products & Variants | `/inventory/new` (NewProduct.tsx) | PID |
| Transfer Line Items | `/stock/transfers/new` (TransferNew.tsx) | PID |
| Receiving Details | `/stock/receiving/new` (ReceivingNew.tsx) | PID |

Future consideration: if the product import grows complex enough, it may
be consolidated into the hub. Out of scope for this spec.

---

## Out of Scope for This Spec

- Importing sales (historical encoding belongs to the auditor workstation).
- Importing purchase orders (POs are created manually or via workflow).
- Importing inventory transfers (transfers are operational documents, not
  data corrections).
- Scheduled or API-driven imports (all imports are manual and interactive).
- Image or attachment imports.
