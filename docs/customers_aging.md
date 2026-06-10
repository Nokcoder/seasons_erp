# Accounts Receivable — Aging Report

## Route
`/customers/aging`

## Access
Admin and Manager roles only.

## Overview
A detailed table showing outstanding balances per invoice,
grouped by customer, bucketed by how overdue each invoice is.
Primary tool for understanding total AR exposure and
identifying customers that need collection action.

Due date per invoice = invoice_date + customer.terms_days
Aging bucket = today - due_date (days past due)

All data via React Query per ui_standards §4.
Skeleton loaders per ui_standards §5.
All components use theme CSS variables only.

---

## Page Layout
Full-width table. Filter controls top. Table below.
Totals row pinned at bottom of table.
Export control top right.

---

## Filters (top of page)

- Keyword search bar per ui_standards §1 — searches
  customer name only
- No bucket filter. No balance filter toggle.

---

## Table

One row per invoice. Pre-sorted server-side:
  customer_name ASC, then invoice_date ASC.
No user-controlled column sorting.

### Columns (in order)
- Customer — customer_name. Show name only on the first row
  of each customer group; leave blank for subsequent rows
  of the same customer (conditional rendering, no rowspan).
- Invoice # — invoice_id
- Invoice Date — date of the invoice (MMM DD, YYYY)
- Due Date — invoice_date + customer.terms_days (MMM DD, YYYY),
  computed server-side
- Current — amount if days_overdue <= 0, else blank
- 1–30 Days — amount if 1 <= days_overdue <= 30, else blank
- 31–60 Days — amount if 31 <= days_overdue <= 60, else blank
- 61–90 Days — amount if 61 <= days_overdue <= 90, else blank
- 90+ Days — amount if days_overdue > 90, else blank

All currency columns right-aligned.
Zero-value bucket cells display blank, not "0.00".

### Row interaction
No row click navigation. Rows are display-only.

### Totals row
Sticky <tfoot> row pinned at bottom of table.
Sums each of the five bucket columns across all currently
visible (filtered) rows. Labeled "Total" in the Customer
column. Always visible while scrolling.

---

## Aging Calculation

Per invoice (ar_ledger SALE entry) with outstanding balance > 0:
1. invoice_date = occurred_at of the ar_ledger SALE entry
2. due_date = invoice_date + customer.terms_days
3. days_overdue = today - due_date
4. outstanding_amount = ar_ledger SALE amount
   minus applied non-AR-charge payments
   minus linked credit-to-account return amounts
5. If days_overdue <= 0:  amount goes to Current
6. If 1-30:   goes to 1–30 Days bucket
7. If 31-60:  goes to 31–60 Days bucket
8. If 61-90:  goes to 61–90 Days bucket
9. If > 90:   goes to 90+ Days bucket

Only invoices where outstanding_amount > 0 are included.
Calculation is bridge-table based (ar_ledger + customer_payment_applied),
not from sale.balance_due.

---

## Backend Endpoint

GET /customers/aging

Returns one row per invoice with outstanding balance,
sorted by customer_name ASC then invoice_date ASC:
```json
[
  {
    "customer_id": 1,
    "customer_name": "ABC Corp",
    "invoice_id": 101,
    "invoice_date": "2025-01-15",
    "due_date": "2025-02-14",
    "current_amt": 0.00,
    "days_1_30": 2000.00,
    "days_31_60": 0.00,
    "days_61_90": 0.00,
    "days_91_plus": 500.00
  }
]
```

Query parameters:
- search= customer name keyword (optional)

All aging computed server-side.
Remove the three [AGING DEBUG] print() statements.
Remove include_zero_balance and bucket filter params.

---

## Export

XLSX export of the currently filtered rows (what is on screen).
One sheet — same columns as the table in the same order.
Totals row included at bottom of export.
Column headers match table headers exactly.
File named: ar_aging_{today}.xlsx

---

## Nav Integration

Customers section in nav has three sub-items:
- Customer List → /customers
- Aging Report → /customers/aging
- AR Ledger → /customers/ledger