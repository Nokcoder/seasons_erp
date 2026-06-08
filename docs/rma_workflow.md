# RMA Workflow Specification

## Overview

RMA (Return Merchandise Authorization) covers two related flows:

1. **Return-only** — customer returns items from a previous sale and receives
   a credit or refund. No replacement items issued.
2. **Exchange** — customer returns items and receives replacement items in
   the same transaction. The return credit is applied against the exchange
   total; the customer pays only the net difference.

Supplier returns (§15) are already fully implemented and are out of scope
for this document.

---

## Scope of Implementation

### What already exists
- `POST /sales/returns` — creates a `sales_returns` record, restores
  stock via `RETURN_IN` ledger entries, writes AR RETURN entry,
  updates `customer.outstanding_balance`.
- `sales.origin_sale_id` FK — self-referential nullable FK on the `sales`
  table. Already accepted by `POST /sales/drafts`.
- Blind returns — `POST /sales/returns` with no `sale_id` is already
  supported for `process_blind_returns` role.

### What is missing
- **RMA screen** — no unified UI for initiating returns or exchanges from
  a specific sale.
- **Exchange flow** — no UI path to create a linked exchange sale from a
  return. `origin_sale_id` is accepted by the backend but never set in
  practice.
- **Credit tender** — no mechanism for the workstation to automatically
  reflect return credit against an exchange total in the tender section.

---

## Data Model

No new tables required. All data fits the existing schema:

| Table | Field | Usage |
|---|---|---|
| `sales.sales_returns` | `sale_id` | Links return to original sale |
| `sales.sales_returns` | `return_pid` | System-generated `RET-{id:05d}` |
| `sales.sales_return_items` | `sale_item_id` | Links item to exact FIFO row |
| `sales.sales_return_items` | `cost_layer_id` | FIFO restoration target |
| `sales.sales` | `origin_sale_id` | Exchange sale → original sale FK |
| `sales.ar_ledger` | `reason = 'RETURN'` | Return credit entry |
| `sales.customer_payments` | `unapplied_amount` | Holds excess return credit |

---

## Return-Only Flow

### Entry points
- Sale Detail page (`/sales/ledger/:sale_id`) → "Return / Exchange" button.
- Sales Ledger — Actions column → "Return" on any Posted sale.

### Page: Return Processing (`/sales/returns/new?sale_id=X`)

A dedicated return entry page. Not inside the workstation.

#### Header section (read-only, derived from original sale)
- Original Sale PID
- Original Sale Date
- Location (return destination — defaults to original sale's location,
  editable)
- Customer (pre-filled from original sale, if any)
- Reason (free text, optional)

#### Line items table

Pre-populated from the original sale's collapsed items:
- Brand, Variant, PID
- Original Qty Sold (from `sale_items.quantity`, collapsed by variant)
- Return Qty (editable, 1–original qty, defaults to full qty)
- Unit Price (from original sale, read-only)
- Return Line Total (Return Qty × Unit Price, computed)

Only items from a Posted, non-voided sale can be returned.
Quantities already returned in prior returns are shown and deducted
from the available-to-return quantity.

#### Footer
- Return Subtotal (sum of return line totals)
- **Action buttons**:
  - **Return Only** — posts the return immediately.
  - **Exchange** — posts the return, then opens the workstation with the
    exchange pre-initialised (see Exchange Flow below).

### Processing (Return-Only)

`POST /sales/returns` is called with the selected items. No changes to
this existing endpoint are required. The return:
1. Restores stock via `RETURN_IN` ledger entries at the return location.
2. Restores FIFO `quantity_remaining` on the original cost layers.
3. Writes `ar_ledger` RETURN entry (`amount_change = -return.grand_total`).
4. Updates `customer.outstanding_balance` if customer is linked.

---

## Exchange Flow

An exchange is a return immediately followed by a new sale. The two
documents are linked via `origin_sale_id` on the exchange sale.

### Sequence

1. Staff clicks **Exchange** on the Return Processing page.
2. System posts the return (same as Return-Only above).
3. System creates an Exchange Draft sale with:
   - `origin_sale_id` = original sale's `sale_id`
   - `customer_id` = original sale's `customer_id` (if any)
   - `location_id` = return destination location
   - `register_id`, `shift_id`, `employee_id` = inherited from current
     workstation session header
   - Items: empty (staff adds replacement items manually)
   - A pre-applied credit tender row for the return amount
     (see Credit Application below)
4. Workstation opens with the exchange draft loaded.
5. Staff searches for and adds replacement items.
6. Staff adjusts or removes the credit tender row as needed.
7. Staff posts the exchange via the normal Post flow.

### Backend: `POST /sales/returns/exchange`

A new combined endpoint that atomically:
1. Creates the `sales_returns` record and all return mechanics (same
   as `POST /sales/returns`).
2. Creates an exchange Draft sale with `origin_sale_id` set.
3. Returns `{ return: SalesReturnOut, exchange_draft: SaleOut }`.

Callers who only want a return use the existing `POST /sales/returns`.
This endpoint is only for the combined return+exchange flow.

### Credit Application in Tender

When the exchange draft is created, the return credit is surfaced in
the tender section as a pre-filled row:
- Payment Mode: `"Store Credit"` (a new, non-physical-money payment mode
  created on setup — `is_physical = false`, `is_active = true`)
- Amount: `return.grand_total`
- Reference: `return.return_pid`

The cashier can reduce this amount, remove it, or leave it as-is.
If the exchange total is less than the credit, the excess remains as
`unapplied_amount` on the resulting `customer_payments` record and
appears as credit on the Customer Detail page.

If no customer is linked (walk-in exchange), the credit tender row is
still created — the refund logic is handled by the cashier manually
outside the system.

---

## Page: RMA List (`/sales/returns`)

A read-only ledger of all customer returns. Accessible from the Sales
sub-nav.

### Filter panel
- Keyword (return PID, original sale PID, customer name)
- Date range
- Location
- Has linked exchange (returns that spawned an exchange sale)

### Table columns
- Return PID
- Date
- Original Sale PID (clickable → Sale Detail)
- Customer (name or "Walk-in")
- Location
- Grand Total (return value)
- Exchange Sale PID (if exchange was created, clickable → Sale Detail)
- Actions: View

### Summary row
- Total return value for current filtered set.

---

## Page: Return Detail (`/sales/returns/:return_id`)

Read-only. Mirrors Sale Detail layout.

### Header
- Return PID
- Date
- Original Sale PID (clickable)
- Exchange Sale PID (if created, clickable)
- Customer
- Location
- Reason
- Grand Total

### Line items
Columns: Brand, Variant, PID, Qty Returned, Unit Price, Line Total.

---

## Backend Notes

### `POST /sales/returns/exchange`

```
Request body: same as SalesReturnCreate, plus nothing extra.
The endpoint determines the return value internally.

Response:
{
  "return": SalesReturnOut,
  "exchange_draft": SaleOut
}
```

Must be registered before `GET /sales/returns/:id` to avoid route
shadowing.

### Store Credit payment mode

Seeded on system setup as:
```
{ name: "Store Credit", is_physical: false, is_active: true }
```

Idempotent — only created if it does not already exist. Seeded in
`_seed_system_settings()` or equivalent startup function.

### `GET /sales/returns`

New endpoint (list of customer returns, newest first).

Filter params: `date_from`, `date_to`, `location_id`, `customer_id`,
`has_exchange` (boolean — returns with an exchange sale linked via
`origin_sale_id`), `search` (return PID prefix, original sale PID,
customer name).

Returns `List[SalesReturnOut]` with summary totals in a wrapper.

### `GET /sales/returns/:return_id`

Already exists as `GET /sales/returns/{id}`. Verify it returns
`exchange_sale_pid` if one was created (requires join on `sales` where
`origin_sale_id = return.sale_id`).

---

## Business Rules

1. Only **Posted** sales can have returns processed against them.
   Voided sales cannot be returned.

2. The sum of all return quantities for a given `sale_item_id` across all
   returns must not exceed the original `sale_items.quantity`.
   Enforce at `POST /sales/returns` time.

3. A return may be processed **without** a linked sale (blind return).
   The caller must have `process_blind_returns` permission.
   Blind returns cannot spawn an exchange (no `origin_sale_id` to link).

4. Credit limit is **not enforced** on exchange sales. The exchange is
   replacing returned goods, not extending new credit.

5. `origin_sale_id` is set at Draft creation time and is immutable.

6. The exchange draft's `location_id` defaults to the return destination
   location. The cashier may change it before posting.

7. Walk-in returns are allowed. If no `customer_id`, the credit tender
   row is still created in the exchange draft; the physical cash/credit
   handling is outside the system.

8. If an exchange sale is later voided, the `origin_sale_id` link is
   preserved for audit purposes. The return itself is not reversed by
   a void of the exchange.

9. A return can only spawn **one** exchange (enforced at
   `POST /sales/returns/exchange` — check that no exchange sale with
   `origin_sale_id = this.sale_id` already exists for the same return).

---

## Sales Nav Integration

Sales sub-nav gains a third item:
- New Sale → `/sales/new`
- Sales Ledger → `/sales/ledger`
- Returns → `/sales/returns`

---

## Schema Reference (existing — no new migrations needed)

`sales.sales.origin_sale_id int [ref: > sales.sale_id]` — already in schema.
`sales.sales_returns` and `sales.sales_return_items` — already in schema.

The only schema addition is a seeded **Store Credit** payment mode row.
No DDL migration required.

---

## Out of Scope for This Spec

- Warranty claims and repair tracking.
- Return reason codes / reason code analytics.
- Automated refund disbursement (cash back, bank transfer initiation).
- Partial quantity returns on UOM-sold items (e.g. returning 1 of 6 PCs
  sold as a BOX — deferred; stock is tracked in base units and partial
  UOM returns are complex).
