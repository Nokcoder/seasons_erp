# Customers & Accounts Receivable

## Navigation
Top-level section in the nav labeled "Customers".
Covers customer management and AR in one section.

## Access
Admin and Manager roles only for create/edit/payment recording.
All authenticated users can view customer profiles and balances.

## Sub-pages
1. Customer List — `/customers`
2. Customer Detail — `/customers/:customer_id`
3. AR Ledger — `/customers/ledger`
4. Aging Report — `/customers/aging`
5. Credit Memo — `/customers/credit-memo`
6. Record Payment — modal or sub-page from Customer Detail

---

## Page 1 — Customer List (`/customers`)

### Layout
Full-width table view. Filter panel on the left. Table on
the right. Follows same layout pattern as Product Catalogue.
All data via React Query per ui_standards §4. Skeleton
loaders per ui_standards §5.

### Filter Panel (left)
- Keyword search bar per ui_standards §1 — searches
  customer name
- Status filter: Active / Inactive / Both (default: Active)
- Balance filter:
  - All
  - Has Outstanding Balance (outstanding_balance > 0)
  - Overdue (outstanding_balance > 0 and terms_days exceeded)
  - Has Credit (outstanding_balance < 0 — customer is owed)

### Table Columns
- Customer Name
- Terms (COD / Net 15 / Net 30 etc — derived from terms_days)
- Credit Limit (shows "No Limit" if null)
- Outstanding Balance (highlighted in warning color when > 0,
  accent color when negative = customer has credit)
- Status (Active / Inactive)
- Actions (View)

### Sorting
- Sortable by: Customer Name, Outstanding Balance, Terms
- Click header to sort ascending, click again descending

### Actions
- + New Customer button (top right)
- Clicking a row navigates to Customer Detail page

### Export
XLSX export of current filtered result set.

---

## Page 2 — Customer Detail (`/customers/:customer_id`)

Full page dedicated to the customer. All fields inline
editable. Save button appears when any field is modified.
All data via React Query per ui_standards §4.

### Header Section
- Customer Name (editable)
- Credit Limit (editable, nullable — null = no limit)
- Terms Days (editable — 0 = COD, 15 = Net 15, 30 = Net 30)
- Outstanding Balance (read-only — computed from ar_ledger.
  Positive = customer owes. Negative = customer has credit.
  Warning color when positive. Accent color when negative.)
- Available Credit (read-only — shown only when
  outstanding_balance < 0. Represents the amount the customer
  can apply via AR Credit payment modes on future sales.
  Available Credit = ABS(outstanding_balance) when negative.)
- Status (editable, toggle Active/Inactive)

### AR Ledger Section
Running ledger of all transactions for this customer.

Table columns:
- Date
- Type (SALE / PAYMENT / RETURN / ADJUSTMENT /
  AR_CHARGE / AR_CREDIT)
- Reference (clickable — links to source document)
- Amount Change (positive = owes more, negative = balance
  reduced)
- Running Balance (cumulative)

Filters:
- Date range
- Type filter (multi-select)

Load More pagination — never unbounded per ui_standards §5.

### Sales History Section
Flat list of all sales linked to this customer.
Columns: Sale PID, Date, Grand Total, Payment Status,
Sale Status.
Latest 10 shown, load more. Clicking a row navigates
to the sale detail in the Sales Ledger.

### Payments Section
Flat list of all payments recorded for this customer.
Columns: Date, Payment Mode, Amount, Reference Number,
Unapplied Amount.
Latest 10 shown, load more.

### Returns Section
Flat list of all returns linked to this customer.
Columns: Return PID, Date, Items Returned, Credit Amount.
Latest 10 shown, load more.
Clicking a row navigates to Return Detail.

### Actions
- **Record Payment** — opens payment recording form
- **Deactivate / Reactivate** — toggles is_deleted
- **New Sale** — navigates to workstation with this
  customer pre-selected in the session header

---

## Payment Recording

Accessible from the Customer Detail page via
Record Payment button. Opens as a modal or inline form.

### Fields
- Payment Date (defaults to today, editable)
- Payment Mode (dropdown from active payment modes —
  excludes modes where is_ar_charge = true or
  is_ar_credit = true — those are point-of-sale only)
- Amount (required, follows ui_standards §10)
- Reference Number (shown only for is_physical = false
  payment modes per workstation standard)
- Notes (optional free text)

### Application
After recording a payment:
- customer_payments row created
- ar_ledger row created: reason = PAYMENT,
  amount_change = negative value (reduces balance)
- customers.outstanding_balance updated transactionally
- If payment exceeds outstanding balance, excess recorded
  as negative outstanding_balance (customer has credit)

### No forced application to specific invoices
Payments reduce the overall customer balance via the
AR ledger. No requirement to apply against a specific
sale — the ledger tracks the net balance automatically.

---

## Page 3 — AR Ledger (`/customers/ledger`)

Invoice-level master-detail view of all outstanding and settled
sales per customer. The master row shows one sale per line.
Expanding a row reveals the payment transactions applied to it.

### Layout
Full-width table. Filter controls top. Table below.
Export control top right.

### Filters
- Keyword search bar per ui_standards §1 — searches customer name.
  Normalize per ui_standards §11.
- Customer filter — dropdown of active customers
- Date range filter — filters by Issue Date (transaction_date)
- Status filter — multi-select: Open, Partial, Paid, Overdue
  (default: all except Paid)

### Master Row (one per Posted sale with linked customer)

Pre-sorted: customer_name ASC, transaction_date ASC.
No user-controlled column sorting.

#### Columns (in order)
- Expand toggle — chevron icon (▶ collapsed, ▼ expanded).
  Clicking expands the row to show payment detail rows below.
  Each row manages its expanded state independently.
- Customer Name — show only on first row of customer group;
  blank for subsequent rows. Clickable → /customers/:customer_id
- Invoice # — sale PID. Clickable → /sales/ledger/:sale_id
- Issue Date — sale.transaction_date (MMM DD, YYYY)
- Due Date — transaction_date + customer.terms_days (MMM DD, YYYY),
  computed server-side
- Total Amount — sale.grand_total, right-aligned currency
- Balance Due — sale.balance_due, right-aligned currency,
  blank when 0
- Status — badge, color coded:
  Open → blue
  Partial → orange
  Paid → green
  Overdue → red
- Actions — context-aware buttons:
  If balance_due > 0: primary [ Receive Payment ] button
  Always: secondary [ View Invoice ] link → /sales/ledger/:sale_id
- Subtotal — far right, per-customer sum of all Balance Due values.
  Show only on first row of customer group; blank for subsequent rows.

#### Status derivation (server-side)
- due_date = transaction_date + customer.terms_days
- If balance_due = 0 → Paid
- If due_date < today and balance_due > 0 → Overdue
- If 0 < balance_due < grand_total and not overdue → Partial
- If balance_due = grand_total and not overdue → Open

Only Posted sales with a linked customer are included.
Walk-in sales (no customer_id) are excluded.

### Detail Rows (payment history per sale)

Rendered below the master row when expanded.
Fetched on first expand — not loaded until needed.
Source: customer_payments joined to customer_payment_applied
where sale_id matches. One row per payment event.

#### Detail columns (in order)
- (empty — aligns with Expand toggle column)
- Payment Date — customer_payments.payment_date (MMM DD, YYYY)
- Payment Mode — payment_modes.name
- Reference Number — customer_payments.reference_number
  (blank if null)
- Amount Applied — customer_payment_applied.amount_applied,
  displayed as negative (e.g. −₱ 20,000.00), right-aligned,
  muted/italic style to distinguish from master rows
- (remaining columns empty)

If no payments exist yet, show a single muted row:
"No payments recorded for this invoice."

### Receive Payment modal

Triggered by [ Receive Payment ] button on any master row.
Pre-populates with the selected sale's customer and balance due.

Fields:
- Customer (read-only — pre-filled from master row)
- Invoice # (read-only — pre-filled from master row)
- Payment Date (defaults to today Manila time, editable)
- Payment Mode (dropdown — excludes is_ar_charge and
  is_ar_credit modes — POS only)
- Amount (required — defaults to full balance_due,
  editable down but not above balance_due)
- Reference Number (shown for non-physical payment modes)
- Notes (optional)

On submit:
- Creates customer_payments row
- Creates customer_payment_applied row linking to the sale
- Updates sale.balance_due and sale.payment_status
- Updates customer.outstanding_balance
- Writes ar_ledger entry reason = PAYMENT
- Closes modal, refreshes master row and expanded detail rows
- Admin and Manager only

### Totals row
Sticky tfoot row pinned at bottom.
Sums Balance Due and Total Amount across all currently
visible filtered rows. Labeled "Total" in Customer Name column.

### Export
XLSX export of current filtered master rows (no detail rows).
Columns: Customer Name, Invoice #, Issue Date, Due Date,
Total Amount, Balance Due, Status.
Totals row included at bottom.
File named: ar_ledger_{today}.xlsx

### Backend Endpoints

#### GET /customers/ar-ledger (existing — no change to signature)
Returns master rows per spec above.

#### GET /customers/ar-ledger/:sale_id/payments (new)
Returns payment detail rows for one sale.
Called only when a row is first expanded.

Response per payment row:
```json
{
  "payment_id": 1,
  "payment_date": "2026-06-15",
  "payment_mode": "Cash",
  "reference_number": "RCPT-449",
  "amount_applied": 20000.00
}
```

#### POST /customers/:customer_id/payment (existing)
Used by the Receive Payment modal — no endpoint change needed.
Frontend must pass sale_id so the payment is applied to the
correct invoice via customer_payment_applied.
Verify the existing endpoint accepts and processes sale_id.

---

### Page 4 — Aging Report (`/customers/aging`)
See docs/customers_aging.md for full spec.

### Page 5 — Credit Memo (`/customers/credit-memo`)
See docs/customers_credit_memo.md for full spec.

---

## Customer Creation

Accessible via + New Customer on the Customer List page.
Opens as a modal or inline form.

### Fields
- Customer Name (required)
- Credit Limit (optional — leave blank for no limit)
- Terms Days (required — default 0 = COD)

### On save
- New customer record created with outstanding_balance = 0
- Customer immediately available in workstation
  customer search

---

## Workstation Integration

### When customer is selected
- customer_id sent in sale payload
- Outstanding Balance shown as informational text
- Credit Limit shown as informational text (no enforcement)
- If outstanding_balance < 0: Available Credit shown
  (e.g. "₱500.00 credit available")
- AR Credit payment modes become available in tender section
  with available credit amount as the maximum allowed

### On sale post — standard
- AR ledger entry: reason = SALE,
  amount_change = grand_total (positive — customer owes)
- outstanding_balance updated transactionally

### On sale post — with AR Charge tender row
- AR ledger entry: reason = AR_CHARGE,
  amount_change = tender row amount (positive — owes more)
- outstanding_balance updated transactionally
- balance_due on sale updated

### On sale post — with AR Credit tender row
- Validates amount does not exceed available credit
  before posting — inline error if exceeded
- AR ledger entry: reason = AR_CREDIT,
  amount_change = negative (reduces balance)
- outstanding_balance updated transactionally

### On sale post — with Credit Memo tender row
- Code input field appears when Credit Memo payment mode selected
- Cashier scans QR or types memo code manually
- System validates: exists, status = ACTIVE, valid_until >= today
- If valid: amount auto-fills (locked, not editable)
- If invalid: inline error (Expired / Cancelled / Not Found)
- On post: credit_memos.status → REDEEMED,
  credit_memo_redemptions row inserted
- standard_applied incremented by memo amount (treated as
  real payment, not deferred)

### On sale void
- All AR entries from that sale reversed via ADJUSTMENT
- outstanding_balance updated transactionally
- If sale was paid with Credit Memo: status → ACTIVE,
  redemption row deleted (memo reinstated)

---

## Return Credit Policy

### Registered customer returns
- Credit posted to AR account as negative outstanding_balance
- Available as AR Credit payment mode on future sales
- Credit stays on account indefinitely

### Walk-in returns
- Cash Refund disposition: AR entry written, negative
  CustomerPayment written to deduct from Collections.
  Customer encouraged to apply return value toward a
  new purchase on the same visit.
- Credit Memo: Admin or Manager may issue a Credit Memo
  for the return value. Redeemable on any future visit
  within the valid_until date. Memo linked to the return
  via return_id on credit_memos table.
- No open-ended credit account for walk-in customers.

---

## Schema Reference

### sales.customers (existing)
- customer_id int PK
- customer_name varchar
- credit_limit decimal(15,2) nullable
- terms_days int default 0
- outstanding_balance decimal(15,2)
- is_deleted boolean

### sales.ar_ledger (existing, immutable)
- ar_ledger_id bigint PK
- customer_id int FK → customers nullable
- amount_change decimal(15,2)
- reason enum(SALE, PAYMENT, RETURN, ADJUSTMENT,
  AR_CHARGE, AR_CREDIT) — enum expansion required
- reference_type varchar
- reference_id varchar
- occurred_at datetime

### sales.customer_payments (existing)
- payment_id int PK
- customer_id int FK → customers nullable
- payment_mode_id int FK → payment_modes
- amount decimal(15,2)
- payment_date datetime
- reference_number varchar
- unapplied_amount decimal(15,2) default 0

### sales.customer_payment_applied (existing)
- apply_id int PK
- payment_id int FK → customer_payments
- sale_id int FK → sales
- amount_applied decimal(15,2)
- applied_at datetime

### sales.payment_modes (additions required)
- is_ar_charge boolean default false
- is_ar_credit boolean default false
- is_credit_memo boolean default false  ← NEW

### sales.credit_memos (new)
- memo_id              serial PK
- code                 varchar(20) UNIQUE NOT NULL
- amount               decimal(15,2) NOT NULL
- status               enum('ACTIVE','REDEEMED','EXPIRED',
                        'CANCELLED') DEFAULT 'ACTIVE'
- issued_at            date NOT NULL
- valid_until          date NOT NULL  — defaults to issued_at + 30 days
- issued_by_user_id    int FK → users
- return_id            int FK → sales_returns NULLABLE
- notes                varchar(500) NULLABLE
- cancelled_by_user_id int FK → users NULLABLE
- cancelled_at         timestamp NULLABLE

### sales.credit_memo_redemptions (new)
- redemption_id       serial PK
- memo_id             int FK → credit_memos NOT NULL
- sale_id             int FK → sales NOT NULL
- amount_redeemed     decimal(15,2) NOT NULL
- redeemed_at         timestamp NOT NULL
- redeemed_by_user_id int FK → users NOT NULL

---

## Schema Migrations Required
1. Add is_ar_charge boolean default false to
   sales.payment_modes
2. Add is_ar_credit boolean default false to
   sales.payment_modes
3. Expand ar_reason enum to include AR_CHARGE and AR_CREDIT
4. Add is_credit_memo boolean default false to
   sales.payment_modes
5. Create sales.credit_memos table
6. Create sales.credit_memo_redemptions table
7. Seed one payment_modes row: name='Credit Memo',
   is_credit_memo=true, is_physical=false

---

## Store Identity
Any reference to the store name in printed output,
receipts, or documents must be read from a settings
table variable (e.g. settings.store_name). No store
name shall be hardcoded anywhere in the codebase.

---

## Data Fetching
All data via React Query per ui_standards §4.
Reference data stale time 10 minutes.
Transactional data (balances, ledger) stale time 30 seconds.
outstanding_balance invalidated immediately after any
payment or sale post affecting that customer.

---

## Access Control
- View customer list and detail: all authenticated users
- Create / edit customers: Admin and Manager only
- Record payments: Admin and Manager only
- Deactivate customers: Admin and Manager only
- Issue credit memos: Admin and Manager only
- Cancel credit memos: Admin and Manager only
- Validate credit memo code at POS: all authenticated users

#### Overdue definition
A customer is overdue when:
- outstanding_balance > 0 AND
- at least one linked Posted sale has
  (current_date - transaction_date) > customer.terms_days
  and payment_status != Paid
Overdue customers shown with warning color on outstanding
balance in both the list and detail page.
