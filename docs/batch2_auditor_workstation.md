# Sales Audit Interface Specification

## Session Context Header

A sticky bar at the top of the page containing the following
fields. Values persist between transactions but never lock —
the auditor can change any field at any time without an unlock
step. Fields do not reset after posting.

- **Sale Date** — date picker, defaults to today, editable
- **Shift** — dropdown from `GET /sales/shifts`,
  filtered to is_active = true
- **Location** — dropdown of active physical locations
- **Register** — dropdown of active registers filtered by
  selected Location, filtered to is_active = true
- **Cashier/Employee** — dropdown from `GET /auth/employees`
  filtered to is_active = true. Sources from auth.employees
  directly — not from users or roles.
- **Customer** — optional search field. Defaults to walk-in
  (customer_id = null). Auditor can search by customer name
  and select. When a customer is selected, their outstanding
  balance and credit limit are shown as informational text
  below the field — no enforcement, display only.
- **Sale PID** — receipt serial number

### Sale PID Behavior
Two modes toggled by a small button next to the field:
- **Auto** — increments from the last posted sale_pid on
  load. On mount, fetches the highest existing sale_pid from
  the DB and initializes to the next value.
- **Manual** — clears the field for free-text entry.

After a successful post, Sale PID auto-increments if in
Auto mode. Header values persist — no reset between
transactions.

---

## Layout

Two-panel layout. Header sits fixed above both panels.
- **Left Panel** — Item Search
- **Right Panel** — Active Cart / Basket Grid

---

## Left Panel — Item Search

Single keyword search box following ui_standards §1.
Searches across: brand, variant name, PID, barcode, SKU,
and category.

- Results appear as scrollable cards below the search box
- Each card shows: brand, variant name, PID, and effective
  price
- **Promo price indicator** — if the variant has an active
  promo_price, the card shows both prices: promo_price in
  a highlighted color and the original price struck through.
  Example: ~~₱120.00~~ **₱95.00**
- Clicking a result adds it to the basket
- Panel does not close, collapse, or refresh after a click
- Results stay visible until a new search is executed

---

## Right Panel — Basket Grid

Spreadsheet-style grid. All numeric fields follow
ui_standards §10 — clicking into any field immediately
selects the existing value for replacement.

Columns:

| Column | Type | Description |
|---|---|---|
| Item | Read-only | Brand + Variant Name + PID |
| Unit Price | Editable | Pre-filled with promo_price if active, otherwise variant.price. When promo_price is active, cell is visually highlighted (e.g. accent color background or badge) to distinguish from tag price |
| Qty | Editable | Defaults to 1 |
| Disc % | Editable | Nullable line discount percentage |
| Disc ₱ | Editable | Nullable line discount flat amount |
| Line Total | Read-only | (unit_price × (1 - disc_pct/100) - disc_flat) × qty |

### Discount Logic
- Both discount columns independent, can be filled
  simultaneously
- Percent applied first, flat applied after
- Either or both can be null

### Fill-Down Behavior
Applies to Disc % and Disc ₱ columns independently:
- Single click on filled cell → copies value to next row
- Double-click → copies value to all rows below to last item
- Drag handle → fills to whichever row auditor drags to

---

## Cart Footer

Displayed below the basket grid in order:

1. **Subtotal** — sum of all line totals (read-only)
2. **Cart Disc %** — percent discount on subtotal
   (editable, nullable)
3. **Cart Disc ₱** — flat discount after percent
   (editable, nullable)
4. **Discount Amount** — resolved flat discount value
   (read-only, computed)
5. **Grand Total** — subtotal - discount amount (read-only)
6. **Receipt Total** — pre-filled with Grand Total, auditor
   overrides with actual receipt amount. Stores to
   receipt_grand_total (editable)
7. **Variance** — receipt_grand_total - grand_total.
   Warning color when non-zero. Stores to audit_variance
   (read-only)

---

## Tender Section

Below the footer. Supports multiple split-payment rows.

### Default behavior
- First tender row auto-populates with Cash payment mode
  on new cart initialization
- Amount field defaults to the current Grand Total
- As additional tender rows are added, amounts are not
  auto-split — auditor enters manually

### Per row fields
- **Payment Mode** — dropdown from
  `GET /sales/payment-modes`, filtered to is_active = true
- **Amount** — editable, follows ui_standards §10
- **Reference Number** — shown only when selected payment
  mode has is_physical = false (digital/card payments only).
  Hidden for cash and physical payment modes. Free text —
  used for GCash reference numbers, card approval codes,
  bank transfer IDs, etc.

### Validation
- Add Tender Row button appends a new row
- Rows can be removed individually
- Running total of all tender rows displayed and compared
  against Receipt Total

---

## Draft Tray

Collapsible tray (sidebar or bottom drawer) showing the
auditor's open Draft sales.

- Shows up to 5 most recent open Drafts
- Each entry shows: Sale PID (or "Unsaved"), item count,
  grand total
- Clicking an entry loads it into the active cart
- Prompts confirmation if current cart has items

---

## Action Buttons

- **Save Draft** — saves current cart as Draft. Does not
  post, does not touch inventory or ledger.
- **Post** — validates all required session context fields
  including Register, then posts the sale. On success:
  clears basket, increments Sale PID if in Auto mode,
  header values persist.
- **Void** — visible only when a Draft is loaded. Voids
  the Draft and removes from tray.
- **New** — clears basket, starts fresh cart. Prompts
  confirmation if current cart has items.

---

## General Notes

- Walk-in is the default — customer_id = null unless
  auditor explicitly selects a customer
- Credit limit is informational only — no enforcement
  on the workstation
- Register is required on Post — validate before submit
- All requests carry JWT from auth context (Batch 1)
- Follow existing component and folder structure

---

## Numeric Input Behavior
All numeric fields follow ui_standards §10 — clicking
into a field immediately selects the existing value so
the auditor can type to replace without erasing first.

---

## Quality Assurance (Smoke Test)

1. Set session header — shift, location, register, cashier.
   Confirm values persist after posting without locking.
2. Search for a variant with an active promo_price. Confirm
   card shows strikethrough original price and highlighted
   promo price. Confirm Unit Price cell is visually
   distinguished in the basket.
3. Add two items. Apply line discount to one. Apply cart
   discount. Override Receipt Total to create a variance.
4. Confirm first tender row defaults to Cash with Grand
   Total pre-filled. Add a second tender row with a digital
   payment mode. Confirm Reference Number field appears
   for digital, hidden for cash.
5. Select a customer from the search field. Confirm
   outstanding balance and credit limit show as
   informational text. Confirm customer_id is sent on post.
6. Post the sale. Confirm it appears in the Sales Ledger
   with correct values including customer reference.
7. Report back with completed checklist and any decisions
   made.