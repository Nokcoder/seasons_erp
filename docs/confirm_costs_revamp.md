# Confirm Costs — Revamp Spec
`/docs/confirm_costs_revamp.md`

## Overview

The Cost Confirmation window (Stage 2 of the receiving workflow) is
being redesigned from a bare-bones unit-cost entry form into a full
supplier transaction recording window. This document defines the new
behaviour for the backend, the frontend confirm-costs page, and the
downstream XLSX export on the Shipment Detail page.

This spec extends `/docs/stock_receiving.md`. Read that doc first.

---

## What Changes

| Area | Before | After |
|---|---|---|
| Cost entry | Single `unit_cost` field per line, user-entered | `gross_cost` + `discount_pct` per line, auto-filled from records |
| Invoice details | None | Invoice number, invoice date (user-entered); due date computed |
| Auto-fill source | None | Most recent confirmed cost layer for variant + supplier; falls back to variant_suppliers record |
| Record updates on confirm | cost_layers + variant_suppliers.gross_cost | cost_layers + variant_suppliers (gross_cost + supplier_discount) |
| Export | None | XLSX export on Shipment Detail page (confirmed shipments only) |

---

## Part 1 — Backend

### 1.1 Auto-fill Endpoint

```
GET /procurement/shipment-cost-autofill?shipment_id={id}
```

For each `receiving_detail` row in the shipment, resolve costs in
this order:

1. **Most recent cost layer** for that `variant_id` + shipment's
   `supplier_id` — join `cost_layers → inventory_shipments` on
   `shipment_id` to get `supplier_id`. Take the row with the
   latest `created_at`. Use its `gross_cost` and
   `supplier_discount` as `discount_pct`.
2. **variant_suppliers record** for the matching
   (`variant_id`, `supplier_id`) — use `gross_cost` and
   `supplier_discount`.
3. If neither exists, return nulls for that line.

Response shape (one entry per `receiving_detail`):
```json
[
  {
    "detail_id": 12,
    "variant_id": 7,
    "gross_cost": 95.50,
    "discount_pct": 10.00,
    "net_unit_cost": 85.95,
    "source": "cost_layer" | "variant_suppliers" | "none"
  }
]
```

`net_unit_cost` is always server-computed:
`gross_cost × (1 − discount_pct / 100)`

### 1.2 Updated confirm-costs Endpoint

```
POST /procurement/shipments/:id/confirm-costs
```

**Old payload:** `unit_cost` per line (direct, caller-supplied).
**New payload:**

```python
class ConfirmCostsItem(BaseModel):
    detail_id: int
    gross_cost: Decimal
    discount_pct: Decimal = Decimal('0')
    # net_unit_cost is always server-computed — never accepted from caller

class ConfirmCostsPayload(BaseModel):
    invoice_number: str
    invoice_date: date
    items: List[ConfirmCostsItem]
```

**On confirm, for each item:**
- Compute `net_unit_cost = gross_cost × (1 − discount_pct / 100)`
- Write `cost_layer`:
  - `net_unit_cost` = computed value
  - `gross_cost` = as supplied
  - `supplier_discount` = `discount_pct`
  - `original_quantity` = `quantity_actual` from `receiving_detail`
  - `quantity_remaining` = same as `original_quantity`
- Update `variant_suppliers` for the matching
  (`variant_id`, `supplier_id`):
  - Set `gross_cost` and `supplier_discount = discount_pct`
  - If no record exists for this supplier + variant, create one

**Invoice and AP:**
- Compute `due_date`:
  - `inventory_shipments.date_received + timedelta(days=supplier.payment_terms)`
  - If `supplier.payment_terms` is null, `due_date` = null
- Write/update `supplier_invoice`:
  - `invoice_number`, `invoice_date`, `due_date`
  - `total_amount` = sum of (`quantity_actual × net_unit_cost`) across all lines
- Write `ap_ledger` entry (same as current behaviour)
- Set `inventory_shipments.is_confirmed = true`

### 1.3 XLSX Export Endpoint

```
GET /procurement/shipments/:id/export
```

Only callable for confirmed shipments (`is_confirmed = true`).
Returns an XLSX file with two sheets.

**Sheet 1 — Invoice Summary**

| Field | Value |
|---|---|
| Shipment PID | from inventory_shipments |
| Supplier | supplier.name |
| Invoice Number | from supplier_invoice |
| Invoice Date | from supplier_invoice |
| Date Received | from inventory_shipments |
| Due Date | from supplier_invoice (blank if null) |
| Total Amount | from supplier_invoice |

One header row, one data row.

**Sheet 2 — Line Items**

Columns: PID, Variant Name, Brand, Qty Received, Gross Cost,
Discount %, Net Unit Cost, Line Total

One row per `receiving_detail`, sorted by PID ascending.
Line Total = `quantity_actual × net_unit_cost` (from cost_layer).

Filename: `{shipment_pid}_invoice.xlsx`

---

## Part 2 — Frontend: Confirm Costs Page

Route: `/stock/receiving/:shipment_id/confirm`
File: `ReceivingConfirm.tsx`

### Layout

**Read-only header block** (from Stage 1 — no changes):
- Shipment PID
- Supplier
- Date Received
- Destination Location
- Document ID (if present)

**Invoice details block (new):**

| Field | Type | Notes |
|---|---|---|
| Invoice Number | Text input | Required |
| Invoice Date | Date picker | Required |
| Due Date | Read-only label | Computed: "DD MMM YYYY (Net X days)" — derived from Date Received + supplier.payment_terms. If payment_terms is null: "No payment terms on file" |

**Line items grid:**

| Column | Editable | Notes |
|---|---|---|
| PID | No | From variant |
| Variant Name | No | From variant |
| Brand | No | From variant → product |
| Qty Received | No | From Stage 1 receiving_detail.quantity_actual |
| Gross Cost | Yes | Auto-filled on load; user can override |
| Discount % | Yes | Auto-filled on load; user can override |
| Net Unit Cost | No | Client-computed: Gross Cost × (1 − Discount % / 100) |
| Line Total | No | Client-computed: Qty Received × Net Unit Cost |

- Numeric inputs follow ui_standards select-on-focus behaviour
- Each line shows a small source badge next to Gross Cost:
  - "Prior shipment" — filled from a previous cost layer
  - "Supplier record" — filled from variant_suppliers
  - "No prior data" — returned as null; field starts empty

**Footer:**
- Grand Total = sum of all Line Totals, right-aligned, currency-formatted
- **"Confirm & Record Invoice"** button (primary):
  - Disabled until: Invoice Number filled, Invoice Date filled,
    all lines have Gross Cost > 0
  - On click: POST confirm-costs payload, show success toast,
    navigate to Shipment Detail page
- **"Cancel"** button: returns to Receiving Overview without saving

### api.ts Changes

```typescript
interface ConfirmCostsItem {
  detail_id: number;
  gross_cost: number;
  discount_pct: number;
}

interface ConfirmCostsPayload {
  invoice_number: string;
  invoice_date: string; // ISO date string
  items: ConfirmCostsItem[];
}

interface CostAutofillItem {
  detail_id: number;
  variant_id: number;
  gross_cost: number | null;
  discount_pct: number | null;
  net_unit_cost: number | null;
  source: 'cost_layer' | 'variant_suppliers' | 'none';
}

// Add to stockApi or shipmentApi:
shipmentCostAutofill: (shipment_id: number) => Promise<CostAutofillItem[]>
  // GET /procurement/shipment-cost-autofill?shipment_id={id}

exportShipmentInvoice: (shipment_id: number) => Promise<Blob>
  // GET /procurement/shipments/{id}/export

// Update existing confirmCosts to use new ConfirmCostsPayload shape
```

---

## Part 3 — Shipment Detail Page

File: `ReceivingDetail.tsx` (or equivalent)
Route: `/stock/receiving/:shipment_id`

**For confirmed shipments only:**

- Add **"Export Invoice"** button to the page actions (top right)
  - Calls `exportShipmentInvoice(shipment_id)`
  - Triggers file download of the returned XLSX
  - Hidden for unconfirmed (Pending Confirmation) shipments

- Update the line items table to show additional columns when
  `is_confirmed = true`:
  - Gross Cost (from cost_layer)
  - Discount %  (from cost_layer.supplier_discount)
  - Net Unit Cost (from cost_layer.net_unit_cost)
  - These three columns are hidden for unconfirmed shipments;
    table stays as-is for Pending Confirmation status

---

## Validation Rules

| Rule | Scope |
|---|---|
| Invoice Number required | Frontend + backend |
| Invoice Date required | Frontend + backend |
| All lines must have Gross Cost > 0 | Frontend (button disabled); backend (400 if violated) |
| Discount % must be 0–100 | Frontend inline; backend (400 if violated) |
| Export only available for confirmed shipments | Backend returns 404 if called on unconfirmed |

---

## Data Flow Summary

```
Page load
  → GET /procurement/shipment-cost-autofill?shipment_id={id}
  → Pre-fill Gross Cost + Discount % per line
  → Compute and display Net Unit Cost + Line Total client-side
  → Display Due Date label from shipment.date_received + supplier.payment_terms

User edits costs, fills invoice fields

Confirm & Record Invoice
  → POST /procurement/shipments/:id/confirm-costs
      { invoice_number, invoice_date, items: [{ detail_id, gross_cost, discount_pct }] }
  → Server computes net_unit_cost per line
  → Writes: cost_layers, variant_suppliers update, supplier_invoice, ap_ledger
  → Sets is_confirmed = true
  → Navigate to Shipment Detail

Shipment Detail (confirmed)
  → Shows Gross Cost, Discount %, Net Unit Cost columns in line items table
  → "Export Invoice" button visible
  → Click → GET /procurement/shipments/:id/export → download XLSX
```