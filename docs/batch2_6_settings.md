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
4. Record Payment — modal from Customer Detail

---

## Page 1 — Customer List (`/customers`)

### Layout
Full-width table view. Filter panel left. Table right.
All data via React Query per ui_standards §4.
Skeleton loaders per ui_standards §5.

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
- Terms (COD / Net 15 / Net 30 — derived from terms_days)
- Credit Limit (shows "No Limit" if null)
- Outstanding Balance (warning color when > 0,
  accent color when negative = customer has credit)
- Status (Active / Inactive)
- Actions (View)

### Sorting
- Sortable by: Customer Name, Outstanding Balance, Terms

### Actions
- + New Customer button (top right)
- Clicking a row navigates to Customer Detail page

### Export
XLSX export of current filtered result set.

---

## Page 2 — Customer Detail (`/customers/:customer_id`)

Full page. All fields inline editable. Save button appears
on modification. All data via React Query per ui_standards §4.

### Header Section
- Customer Name (editable)
- Credit Limit (editable, nullable — null = no limit)
- Terms Days (editable — 0 = COD, 15 = Net 15, 30 = Net 30)
- Outstanding Balance (read-only — computed from ar_ledger.
  Positive = customer owes. Negative = customer has credit.
  Warning color when positive. Accent color when negative.)
- Available Credit (read-only — shown only when
  outstanding_balance < 0. This is the amount the customer
  can use via AR Credit payment modes on future sales.
  Available Credit = ABS(outstanding_balance) when negative.)
- Status (editable, toggle Active/Inactive)

### AR Ledger Section
Running ledger of all transactions for this customer.

Table columns:
- Date
- Type (SALE / PAYMENT / RETURN / ADJUSTMENT /
  AR_CHARGE / AR_CREDIT)
- Reference (clickable — links to source document)
- Amount Change (positive = owes more, negative = reduced)
- Running Balance (cumulative)

Filters:
- Date range
- Type filter (multi-select)

Load More pagination per ui_standards §5.

### Sales History Section
Flat list of sales linked to this customer.
Columns: Sale PID, Date, Grand Total, Payment Status,
Sale Status. Latest 10, load more.
Clicking navigates to Sale Detail in Sales Ledger.

### Payments Section
Flat list of payments recorded for this customer.
Columns: Date, Payment Mode, Amount, Reference Number,
Unapplied Amount. Latest 10, load more.

### Returns Section
Flat list of returns linked to this customer.
Columns: Return PID, Date, Items Returned, Credit Amount.
Latest 10, load more.
Clicking navigates to Return Detail.

### Actions
- **Record Payment** — opens payment recording modal
- **Deactivate / Reactivate** — toggles is_deleted
- **New Sale** — navigates to workstation with this
  customer pre-selected

---

## Payment Recording

Modal from Customer Detail → Record Payment.

### Fields
- Payment Date (defaults to today, editable)
- Payment Mode (dropdown of active payment modes —
  excludes is_ar_charge and is_ar_credit modes,
  those are only used at point of sale)
- Amount (required, follows ui_standards §10)
- Reference Number (shown only for is_physical = false
  payment modes)
- Notes (optional)

### On save
- customer_payments row created
- ar_ledger row created: reason = PAYMENT,
  amount_change = negative (reduces balance)
- customers.outstanding_balance updated transactionally
- Excess payment (overpayment) recorded as credit —
  outstanding_balance goes negative, customer has credit

---

## Page 3 — AR Ledger (`/customers/ledger`)

Standalone view of all AR movements across all customers.

### Filter Panel
- Keyword search bar per ui_standards §1 — searches
  customer name, reference ID
- Customer filter
- Type filter: SALE / PAYMENT / RETURN / ADJUSTMENT /
  AR_CHARGE / AR_CREDIT (multi-select)
- Date range filter
- Balance filter: Outstanding / Credit / All

### Table Columns
- Date
- Customer Name
- Type
- Reference (clickable)
- Amount Change
- Notes

### Export
XLSX export of current filtered result set.

---

## Customer Creation

Modal from + New Customer on Customer List.

### Fields
- Customer Name (required)
- Credit Limit (optional — blank = no limit)
- Terms Days (required — default 0 = COD)

### On save
- New customer created with outstanding_balance = 0
- Immediately available in workstation customer search

---

## Workstation Integration

### When customer is selected
- Customer name shown in session header
- Outstanding Balance shown as informational text
- Credit Limit shown as informational text (no enforcement)
- If outstanding_balance < 0: Available Credit shown
  (e.g. "₱500 credit available")
- AR Credit payment modes become available in tender section
  with available credit as the maximum allowed amount

### On sale post with AR Charge mode
- AR ledger entry: reason = AR_CHARGE,
  amount_change = positive (customer owes more)
- customers.outstanding_balance updated transactionally
- balance_due on sale updated

### On sale post with AR Credit mode
- Validates amount does not exceed available credit
- AR ledger entry: reason = AR_CREDIT,
  amount_change = negative (reduces balance)
- customers.outstanding_balance updated transactionally

### On sale void
- All AR entries from that sale reversed
- outstanding_balance updated transactionally

---

## Return Credit Policy

### Registered customer returns
- Credit posted to AR account as negative outstanding_balance
- Available as AR Credit payment mode on future sales
- Credit stays on account indefinitely

### Walk-in returns
- Cash refund processed same day
- No credit carried forward
- If customer wants to apply credit toward a new purchase,
  the new sale must be processed on the same day before
  they leave — auditor processes return then immediately
  processes new sale
- No account, no future credit under any circumstances

---

## Schema additions required

Add to sales.payment_modes:
- is_ar_charge boolean default false
- is_ar_credit boolean default false

No other migrations needed — all customer and AR tables
already exist in the schema.

---

## Data Fetching
All data via React Query per ui_standards §4.
Reference data stale time 10 minutes.
Transactional data (balances, ledger) stale time 30 seconds.
outstanding_balance invalidated immediately after any
payment or sale post affecting that customer.