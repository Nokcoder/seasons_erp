# Accounts Receivable — Aging Report

## Route
`/customers/aging`

## Access
Admin and Manager roles only.

## Overview
A grand table showing outstanding balances per customer
bucketed by how overdue they are. Primary tool for
understanding total AR exposure and identifying customers
that need collection action.

Due date per sale = transaction_date + customer.terms_days
Aging bucket = today - due_date (days past due)

All data via React Query per ui_standards §4.
Skeleton loaders per ui_standards §5.
All components use theme CSS variables only.

---

## Page Layout
Full-width table. Filter panel left. Table right.
Summary totals row pinned at bottom.
Export control top right.

---

## Filter Panel (left)

- Keyword search bar per ui_standards §1 — searches
  customer name
- Balance filter toggle:
  - Outstanding only (default) — customers where
    outstanding_balance > 0
  - All active customers — includes zero balance
- Aging bucket filter — multi-select to show only
  customers with amounts in specific buckets:
  - Current
  - 1-30 days
  - 31-60 days
  - 61-90 days
  - 90+ days

---

## Table

One row per customer. Sortable columns.

### Columns
- Customer Name (sortable)
- Terms (COD / Net 15 / Net 30 — from terms_days)
- Current — amount not yet due
  (due_date >= today)
- 1-30 Days — amount 1 to 30 days past due
  (due_date between today-30 and today-1)
- 31-60 Days — amount 31 to 60 days past due
- 61-90 Days — amount 61 to 90 days past due
- 90+ Days — amount more than 90 days past due
  (due_date < today-90)
- Total Outstanding — sum of all buckets
  (sortable, warning color when > 0)

### Color coding
- Current — neutral
- 1-30 days — subtle warning
- 31-60 days — moderate warning
- 61-90 days — strong warning
- 90+ days — critical warning color

### Row interaction
Clicking a row navigates to Customer Detail
at /customers/:customer_id

### Summary row
Pinned at bottom of table — column totals:
- Total Current
- Total 1-30
- Total 31-60
- Total 61-90
- Total 90+
- Grand Total Outstanding

---

## Aging Calculation

Per customer, per unpaid/partial sale:
1. due_date = transaction_date + customer.terms_days
2. days_overdue = today - due_date
3. If days_overdue <= 0: amount goes to Current bucket
4. If 1 <= days_overdue <= 30: goes to 1-30 bucket
5. If 31 <= days_overdue <= 60: goes to 31-60 bucket
6. If 61 <= days_overdue <= 90: goes to 61-90 bucket
7. If days_overdue > 90: goes to 90+ bucket

Amount per sale in bucket = sale.balance_due
(not grand_total — only the unpaid portion)

Only Posted sales with payment_status != Paid
are included in aging calculations.

---

## Backend Endpoint

GET /customers/aging

Returns one row per customer with outstanding balance:
```json
[
  {
    "customer_id": 1,
    "customer_name": "ABC Corp",
    "terms_days": 30,
    "current": 5000.00,
    "days_1_30": 2000.00,
    "days_31_60": 1500.00,
    "days_61_90": 0.00,
    "days_90_plus": 500.00,
    "total_outstanding": 9000.00
  }
]
```

Query parameters:
- include_zero_balance=true/false (default false)
- search= customer name keyword

All aging computed server-side from Posted unpaid/partial
sales. Never computed on frontend.

---

## Export

XLSX export of current filtered result set.
One sheet — same columns as the table including
all aging buckets and total outstanding.
Summary totals row included at bottom.
File named: ar_aging_{today}.xlsx

---

## Nav Integration

Customers section in nav has three sub-items:
- Customer List → /customers
- Aging Report → /customers/aging
- AR Ledger → /customers/ledger