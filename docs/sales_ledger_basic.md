# Sales Ledger

## Route
`/sales/ledger`

## Access
Admin and Manager roles only.

## Overview
The auditor's primary view of all sales. Shows a revenue and
profit summary dashboard above the table, followed by header
data per sale with full drill-down to line items, tender
records, and cost data. Supports filtering, sorting, export,
and direct actions on individual sales.

All data via React Query per ui_standards §4.
Skeleton loaders per ui_standards §5.
Transactional data stale time 30 seconds.
Reference data stale time 10 minutes.

The Sales Ledger page must fully respect the active color
scheme selected in Settings → Appearance. All components
on this page — dashboard cards, table, filter panel, badges
— must use theme CSS variables, not hardcoded colors.

---

## Dashboard — Revenue & Profit Summary

Displayed at the top of the Sales Ledger page above the
table. Syncs in real time with all active ledger filters.
All values computed server-side via GET /sales/summary.
Skeleton loaders while fetching per ui_standards §5.

Three large cards displayed in a row:

---

### Card 1 — Revenue

Shows how Total Revenue is composed. All components
line up visually within one card to show the relationship:
┌─────────────────────────────────────┐
│ REVENUE                             │
│                                     │
│ Merchandise Gross      ₱ 50,000.00  │
│ Cart Discounts       - ₱  2,000.00  │
│ Non-Merch Revenue    + ₱  1,500.00  │
│ Variances            + ₱    200.00  │
│ ─────────────────────────────────── │
│ Total Revenue          ₱ 49,700.00  │
└─────────────────────────────────────┘
**Merchandise Gross**
Sum of subtotal_amount for all Posted sales in filter.
Tooltip: "Total value of merchandise sold before discounts."

**Cart Discounts**
Sum of discount_amount for all Posted sales in filter.
Displayed as negative — represents value given away.
Tooltip: "Total discounts applied at cart level."

**Non-Merchandise Revenue**
Sum of line totals for sale_items where parent product
product_type is Service or Non-Inventory.
Tooltip: "Revenue from services, delivery charges, and
non-stock items."

**Variances**
Sum of audit_variance for all Posted sales in filter.
Positive = collected more than computed. Negative = less.
Tooltip: "Net difference between money tendered entered
by auditors and system-computed grand totals."

**Total Revenue**
= Merchandise Gross - Cart Discounts
  + Non-Merchandise Revenue + Variances
Primary highlighted value in the card.


### Receipt Total / Variance behavior
- Receipt Total is display only — shows grand_total as
  computed by the system. Not editable by the auditor.
- Variance = SUM(all tender amounts) - grand_total
  Stored to audit_variance on post.
  Positive variance = over-tendered (change given)
  Negative variance = under-tendered (balance still due)
- Change Due — displayed in tender section when
  total tendered exceeds grand total:
  Change Due = total_tendered - grand_total
- Balance Due — displayed when total tendered is less
  than grand total:
  Balance Due = grand_total - total_tendered
- Backend sets receipt_grand_total = grand_total on
  all auditor posts — field reserved for cashier page

  
---

### Card 2 — Profitability

Shows gross profit where cost is known, and flags revenue
where cost is unknown. Both in one card.

┌─────────────────────────────────────┐
│ PROFITABILITY                       │
│                                     │
│ Gross Profit           ₱ 18,000.00  │
│ ───────────────────────────────---- │
│ Uncosted Revenue       ₱  5,000.00  │
└─────────────────────────────────────┘

**Gross Profit**
Computed from Posted sales where ALL line items have
cost_source = 'fifo' or 'supplier_list'.
= SUM of (line_total - (net_unit_cost × qty))
  for fully costed sales only.
Tooltip: "Gross profit (revenue minus cost of goods sold)
calculated only for sales where complete cost data is
available. Sales with missing cost data are excluded."

**Uncosted Revenue**
Sum of grand_total for Posted sales where ANY line item
has cost_source = 'none'.
Tooltip: "Revenue from sales where cost data is incomplete.
Profit cannot be calculated for these sales. Confirm
shipment costs to include these in gross profit."

No coverage percentage shown — removed as inaccurate.

---

### Card 3 — Collections

Payment mode breakdown showing physical vs virtual split.
┌─────────────────────────────────────┐
│ COLLECTIONS                         │
│                                     │
│ Cash              ₱ 30,000.00  Physical │
│ GCash             ₱ 12,000.00  Virtual  │
│ Maya              ₱  5,000.00  Virtual  │
│ Visa              ₱  2,700.00  Virtual  │
│ ─────────────────────────────────── │
│ Total Physical        ₱ 30,000.00  │
│ Total Virtual         ₱ 19,700.00  │
│ Total Collected       ₱ 49,700.00  │
└─────────────────────────────────────┘
Each active payment mode that appears in the filtered
period gets its own row showing total amount collected
via that mode. Labeled Physical or Virtual based on
payment_modes.is_physical.

Total Physical = sum of all is_physical = true amounts.
Total Virtual = sum of all is_physical = false amounts.
Total Collected = Total Physical + Total Virtual.

Tooltip on Virtual: "Digital payments collected but not
physically in the cash drawer."

### Backend endpoint — GET /sales/summary
Accepts same filter parameters as GET /sales/.
Returns:
```json
{
  "merchandise_gross": 0.00,
  "cart_discounts": 0.00,
  "non_merchandise_revenue": 0.00,
  "variances": 0.00,
  "total_revenue": 0.00,
  "gross_profit": 0.00,
  "uncosted_revenue": 0.00,
  "collections": [
    {
      "payment_mode": "Cash",
      "amount": 0.00,
      "is_physical": true
    }
  ],
  "total_physical": 0.00,
  "total_virtual": 0.00,
  "total_collected": 0.00
}
```

---

## Page 1 — Sales Ledger (`/sales/ledger`)

### Layout
Full-width page. Dashboard cards at top. Filter panel on
the left. Table on the right. Column picker and Export
controls top right of table.

### Filter Panel (left)
All filters apply simultaneously to both dashboard and
table in real time:
- Keyword search bar per ui_standards §1 — searches:
  Sale PID, cashier name, customer name
- Date range filter
- Location filter (dropdown of active locations)
- Shift filter (dropdown of active shifts)
- Register filter (dropdown of active registers)
- Cashier filter (dropdown of active employees)
- Customer filter (dropdown of active customers,
  includes walk-in option)
- Sale Status filter: Draft / Posted / Voided
  (default: Posted only)
- Payment Status filter: Unpaid / Partial / Paid
- Variance filter: All / Has Variance (audit_variance ≠ 0)
- Cost Source filter: All / Has Uncosted Items
  (any sale_item with cost_source = 'none')

### Table Column Picker
A ⚙ button top right of table opens a column visibility
checklist per ui_standards §6.

Permanently visible (cannot be hidden):
- Sale PID
- Date
- Grand Total

Toggleable columns:
- Shift
- Location
- Register
- Cashier
- Customer
- Subtotal Amount
- Cart Discount %
- Cart Discount ₱
- Discount Amount
- Tax Amount
- Grand Total breakdown separator
- Total Tendered
- Variance (audit_variance = total_tendered - grand_total,
  warning color when non-zero)
- Payment Status
- Sale Status
- Actions

Column selection persists in localStorage per user.

### Table (one row per sale)
Sortable columns — click header to sort ascending,
click again descending. Default sort: Date descending.

Each sale row has an expand toggle (▶) on the left.
Clicking expands the row inline to show the tender
breakdown as sub-rows:

▼ SALE-001  06/03  AM  Store  Juan  ₱500  ₱500  ₱0  Paid  Posted
└ Cash          ₱300          Physical
└ GCash         ₱200  REF-9123456  Virtual

Sub-rows show: Payment Mode, Amount, Reference Number,
Money Type (Physical / Virtual).

Collapsed by default. Only one row needs to be expanded
at a time — expanding a new row collapses the previous.

### Summary Row
Pinned at bottom of visible table:
- Total Subtotal
- Total Discount
- Total Grand Total
- Total Receipt Total
- Total Variance
Computed from current filtered result set.

---

## Export

Two-sheet XLSX export of current filtered result set.

### Sheet 1 — Tender Breakdown
One row per tender entry. Sale header fields repeat on
each tender row.

Columns:
Sale PID, Date, Shift, Location, Register, Cashier,
Customer, Grand Total, Receipt Total, Variance,
Payment Status, Sale Status, Payment Mode, Amount,
Reference Number, Money Type (Physical / Virtual)

This sheet answers: how was each sale paid, and what
is the physical vs virtual split?

### Sheet 2 — Line Item Detail
One row per sale item. Sale header fields repeat on
each line item row.

Columns:
Sale PID, Date, Cashier, Brand, Variant Name, PID,
Qty, Unit Price, Disc %, Disc ₱, Line Total,
Net Unit Cost, Cost Source, Product Type

This sheet answers: what was sold, at what price,
and at what cost?

Export button top right. Both sheets always included.
File named: `sales_export_{date_from}_{date_to}.xlsx`

---

## Page 2 — Sale Detail (`/sales/ledger/:sale_id`)

Full page view of a single sale. Read-only except for
actions. All data via React Query per ui_standards §4.

### Header Section (read-only)
- Sale PID
- Date
- Shift
- Location
- Register
- Cashier (employee name)
- Customer (name or "Walk-in" — clickable if customer
  exists, links to Customer Detail page)
- Subtotal
- Cart Discount % and Cart Discount ₱
- Discount Amount
- Grand Total
- Receipt Total
- Variance (warning color when non-zero)
- Payment Status
- Sale Status
- Void Reason (shown only if voided)
- Created By (user who encoded the sale)

### Line Items Table
Columns: Brand, Variant Name, PID, Qty, Unit Price,
Disc %, Disc ₱, Line Total, Net Unit Cost, Cost Source

Cost Source display:
- 'fifo' — neutral badge "FIFO"
- 'supplier_list' — muted badge "List Price"
- 'none' — warning badge "No Cost" in warning color

### Tender Section
Columns: Payment Mode, Amount, Reference Number,
Money Type (Physical / Virtual badge)
Total Physical and Total Virtual shown separately.
Grand total tendered at bottom.

### Actions
**Posted sales:**
- Void — confirmation modal requiring void reason.
  On confirm: status → Voided, inventory ledger reversed,
  AR ledger reversed if customer sale,
  payment status → Unpaid.

**Draft sales:**
- Edit — navigates to workstation with draft loaded
- Post — posts draft directly from ledger view
- Void — voids and removes draft

**Voided sales:**
- Read-only, no actions

### Export
Single sale export to XLSX — same two-sheet structure
as the full ledger export, filtered to this sale only.

---

## Sales Nav Integration

Sales section in nav has two sub-items:
- New Sale → `/sales/new`
- Sales Ledger → `/sales/ledger`

---

## Backend Notes for CC

### Endpoints needed
- `GET /sales/` — list with all filters, sort by date desc
  default, cursor-based pagination per ui_standards §5
- `GET /sales/summary` — dashboard metrics per spec above,
  same filters as GET /sales/, computed server-side
- `GET /sales/next-pid` — returns next available sale_pid
- `GET /sales/:sale_id` — full detail with eager-load:
  employee, location, shift, register, customer,
  sale_items → variant → product, customer_payments
- `POST /sales/:sale_id/void` — requires void_reason,
  reverses inventory and AR ledger entries

### Summary totals
Backend computes summary totals for current filtered result
set and returns alongside paginated rows.

### cost_source on line items
Ensure cost_source returned on all sale detail responses.

### Register dropdown fetch reliability
The register dropdown on the workstation occasionally fails
to fetch options. Ensure the GET /sales/registers endpoint
is stable — add retry logic or confirm the React Query
retry configuration is applied to this query.


## Returns

### Return Form (`/sales/returns/new`)

Accessible from:
- Sale Detail page → Process Return button
- Standalone via nav (for blind returns)

#### Header Fields
- Original Sale Reference (optional — search by Sale PID.
  If blank, this is a blind return)
- Return Date (defaults to today, editable)
- Return Location (dropdown of active physical locations —
  where stock goes back)
- Customer (auto-populated if original sale had a customer.
  Editable for blind returns.)
- Disposition:
  - Cash Refund (default — available for all)
  - Credit to Account (only available when a registered
    customer is selected. Walk-ins cannot use this option.)
- Reason (free text, optional)

#### Line Item Grid
When original sale is referenced:
- All sale line items loaded with quantity fields defaulting
  to 0
- Auditor enters return quantity per item
- Max returnable quantity per item =
  original_qty - SUM(already_returned_qty on prior returns)
- Items with quantity 0 excluded from return
- Items fully returned on prior returns shown as greyed out
  with "Fully Returned" label — not editable
- If all items are fully returned, block new return with
  message: "All items on this sale have already been
  returned."

When no original sale referenced (blind return):
- Item search panel on left per ui_standards §1
- Auditor searches and adds items manually
- No quantity cap — no original sale to reference against

#### Return Total
Computed as sum of (unit_price × return_qty) per line item.
Read-only. Displayed at bottom of grid.

#### On Post
1. sales_returns row created with disposition
2. sales_return_items rows created per returned line item
3. inventory_ledger RETURN_IN entry per item at return
   location
4. current_stocks updated at return location
5. If disposition = credit_to_account:
   - AR ledger entry: reason = RETURN,
     amount_change = negative (customer has credit)
   - customers.outstanding_balance updated transactionally
6. If disposition = cash_refund:
   - No AR entry — cash settled at counter
7. Original sale flagged — return badge shown in ledger

---

### Return Guard on Original Sale

The Sale Detail page tracks returnable quantities:
- Returns section lists all linked returns with:
  Return PID, Date, Items, Quantities, Return Total,
  Disposition
- Per line item on the original sale, shows:
  Qty Sold, Qty Returned, Qty Still Returnable
- Process Return button disabled if all items fully returned

---

### Returns in Sales Ledger

- Sale rows show a return badge when linked returns exist
- Return Total shown as a separate column (toggleable)
  displaying the sum of all return values for that sale
- Blind returns appear as standalone rows in the ledger
  with type indicator "Blind Return"
- Returns reduce Merchandise Gross in the Revenue dashboard
  card per the dashboard spec

---

### Return Credit Policy

**Registered customers:**
- Cash Refund: settled at counter, no AR entry
- Credit to Account: AR credit posted, available on
  future sales via AR Credit payment mode

**Walk-in customers:**
- Cash Refund only — no credit to account option
- No credit carried forward under any circumstances
- If customer wants to apply return value toward a new
  purchase, auditor processes return (cash refund) then
  processes new sale — customer tenders the difference
  between new sale total and return value