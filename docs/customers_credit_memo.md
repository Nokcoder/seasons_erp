# Credit Memo

## Route
`/customers/credit-memo`

## Access
Admin and Manager roles only — issuing, viewing, and cancelling.

## Overview
A credit memo is a store-issued document with a fixed monetary value,
redeemable as a payment mode at the POS. Issued primarily during
walk-in customer returns where no customer account exists to hold a
credit balance. Acts as a physical voucher — all-or-nothing redemption.

All data via React Query per ui_standards §4.
Skeleton loaders per ui_standards §5.
All components use theme CSS variables only.

---

## Data Model

### credit_memos
```
memo_id          SERIAL PK
code             VARCHAR(20) UNIQUE NOT NULL   -- short alphanumeric, QR-encodable
amount           NUMERIC(15,2) NOT NULL
status           ENUM('ACTIVE','REDEEMED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE'
issued_at        DATE NOT NULL                 -- defaults to today (Manila local)
valid_until      DATE NOT NULL                 -- defaults to issued_at + 30 days
issued_by_user_id INT FK → users
return_id        INT FK → sales_returns NULLABLE  -- linked return if applicable
notes            VARCHAR(500) NULLABLE
cancelled_by_user_id INT FK → users NULLABLE
cancelled_at     TIMESTAMP NULLABLE
```

### credit_memo_redemptions
```
redemption_id    SERIAL PK
memo_id          INT FK → credit_memos NOT NULL
sale_id          INT FK → sales NOT NULL
amount_redeemed  NUMERIC(15,2) NOT NULL
redeemed_at      TIMESTAMP NOT NULL            -- system timestamp
redeemed_by_user_id INT FK → users NOT NULL
```

### payment_modes (new flag)
```
is_credit_memo   BOOLEAN NOT NULL DEFAULT FALSE
```
One payment mode row should be seeded with is_credit_memo = TRUE,
name = 'Credit Memo', is_physical = FALSE.

---

## Status Lifecycle

ACTIVE → REDEEMED     (on successful POS redemption)
ACTIVE → EXPIRED      (checked at redemption time — valid_until < today)
ACTIVE → CANCELLED    (manual action by Admin or Manager)

REDEEMED, EXPIRED, and CANCELLED are terminal states.
No transitions out of terminal states.

Expiry is not computed on a schedule — it is checked at the moment
of redemption. The Credit Memo list page derives display status from
status field; if status = ACTIVE and valid_until < today, display
as EXPIRED but do not auto-update the database record.

---

## Page Layout

Full-width page. Filter controls top. Table below.
Issue Credit Memo button top right (Admin/Manager only).
Export control top right alongside issue button.

---

## Filters

- Keyword search — searches memo code and notes
- Status filter — multi-select: Active, Redeemed, Expired, Cancelled
  (default: Active only)
- Date range filter — filters by issued_at
- Issued By filter — dropdown of users

---

## Table

One row per credit memo. Default sort: issued_at DESC.

### Columns
| Column | Source |
|---|---|
| Memo Code | code |
| Issued Date | issued_at (MMM DD, YYYY) |
| Valid Until | valid_until (MMM DD, YYYY) — warning color when expiring within 7 days |
| Amount | amount — right-aligned currency |
| Status | status badge — color coded (see below) |
| Issued By | issued_by_user.name |
| Return Ref | return_id → SalesReturn PID, clickable if present |
| Actions | Cancel button (ACTIVE only, Admin/Manager only) |

### Status badge colors
- ACTIVE — success/green
- REDEEMED — neutral/muted
- EXPIRED — warning/amber
- CANCELLED — danger/red

### Row interaction
Clicking a row opens the Credit Memo Detail panel or page showing
full details including redemption history if redeemed.

---

## Credit Memo Detail

### Header fields
- Memo Code
- Status badge
- Amount
- Issued Date
- Valid Until
- Issued By
- Linked Return (clickable link to return detail if return_id present)
- Notes
- Cancelled By / Cancelled At (shown only if CANCELLED)

### Redemption section
Shown only when status = REDEEMED.
- Sale PID (clickable link to Sale Detail)
- Redeemed At
- Redeemed By
- Amount Redeemed

### Actions
- Cancel button (ACTIVE only, Admin/Manager only)
  Confirmation modal: "Cancel this credit memo? This cannot be undone."
  On confirm: status → CANCELLED, cancelled_by and cancelled_at recorded.

---

## Issue Credit Memo

Modal triggered by Issue Credit Memo button.

### Fields
- Amount (required — numeric, > 0)
- Valid Until (required — date picker, defaults to today + 30 days)
- Linked Return (optional — search by Return PID)
- Notes (optional — free text)

### On Submit
1. Generate unique memo code — short alphanumeric (e.g. CM-XXXXXX)
2. Insert credit_memos row with status = ACTIVE
3. Close modal, refresh table
4. Print prompt — offer to print the physical memo (see Print Layout below)

---

## Print Layout

Triggered after issue or from detail view on ACTIVE memos.
Single thermal/A5 print sheet:

```
┌─────────────────────────────────┐
│         CREDIT MEMO             │
│                                 │
│  Code:      CM-XXXXXX           │
│  Amount:    ₱ 1,000.00          │
│  Valid Until: MMM DD, YYYY      │
│                                 │
│  [QR CODE]                      │
│                                 │
│  Issued by: [Store Name]        │
│  Date: MMM DD, YYYY             │
└─────────────────────────────────┘
```

QR code encodes the memo code string only.
Print triggered via window.print() with a dedicated print stylesheet.

---

## POS Integration (Workstation)

When a cashier selects Credit Memo as the payment mode on a tender row:

1. A code input field appears below the payment mode selector
2. Cashier scans QR or types the memo code manually
3. On code entry (blur or Enter):
   - System calls GET /credit-memos/validate?code=CM-XXXXXX
   - Backend checks: exists, status = ACTIVE, valid_until >= today
   - If valid: amount auto-fills the tender amount field (locked, not editable)
   - If invalid: inline error message (Expired / Cancelled / Not Found)
4. Cashier cannot proceed to post if the code field is empty when
   Credit Memo mode is selected
5. On sale post:
   - credit_memos.status → REDEEMED
   - credit_memo_redemptions row inserted
   - Sale recorded normally with Credit Memo as tender

---

## Backend Endpoints

```
GET    /credit-memos                     List with filters
POST   /credit-memos                     Issue new memo (Admin/Manager)
GET    /credit-memos/{memo_id}           Detail with redemption history
POST   /credit-memos/{memo_id}/cancel    Cancel memo (Admin/Manager)
GET    /credit-memos/validate            Validate code at POS (all authenticated)
```

### GET /credit-memos/validate
Query param: code=CM-XXXXXX
Returns:
```json
{
  "memo_id": 1,
  "code": "CM-XXXXXX",
  "amount": 1000.00,
  "valid_until": "2025-07-15",
  "status": "ACTIVE",
  "is_valid": true,
  "invalid_reason": null
}
```
invalid_reason values: "EXPIRED", "CANCELLED", "REDEEMED", "NOT_FOUND"

---

## Export

XLSX export of current filtered result set.
Columns: Memo Code, Issued Date, Valid Until, Amount, Status,
Issued By, Return Ref, Redeemed In Sale (if applicable).
File named: credit_memos_{today}.xlsx

---

## Nav Integration

Customers section in nav has four sub-items:
- Customer List    → /customers
- Aging Report     → /customers/aging
- AR Ledger        → /customers/ledger
- Credit Memo      → /customers/credit-memo
