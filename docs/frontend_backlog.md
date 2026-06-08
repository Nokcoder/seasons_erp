# Season ERP — Frontend Work Order
**Created:** 2026-05-29
**Status:** Ready to build
**Stack:** React + Vite + Tailwind CSS
**Prerequisite:** Backend sales module (all 12 batches in `/docs/sales_backlog.md`) fully complete.

---

## How to use this file

- Work through batches in order. Complete and confirm each batch before starting the next.
- Mark items `[x]` as they are completed.
- After each batch, update `/docs/changelog.md` with what changed.
- Wait for confirmation before moving to the next batch.
- Do not run any git commands.

---

## Batch 1 — Foundation and routing

- [x] **Project setup** — Vite + React 19 + Tailwind v4 via `@tailwindcss/vite`. No new scaffolding needed.
- [x] **Auth context** — `AuthContext` provides `{ user, token, login, logout }` globally. Token stored in `localStorage.erp_token`, user object in `localStorage.erp_user`. Token expiry checked on init; expired tokens cleared automatically.
- [x] **Protected routes** — `ProtectedRoute` renders `<Outlet />` when token is present, otherwise redirects to `/login`. Global 401 handler clears state if the backend rejects a token mid-session.
- [x] **Role context** — `AuthUser.roles` array populated from JWT `roles` claim. `Can` component renders children only when the user holds one of the specified roles; accepts optional `fallback`.
- [x] **API service layer** — `src/services/api.ts` is the single source of truth. Central `request()` wrapper handles auth headers, 401 event dispatch, and error extraction. Exports `get`, `post`, `patch`, `del` helpers plus module-namespaced API objects (`authApi`, etc.).
- [x] **App shell** — `AppShell` renders a fixed top nav bar. Nav items are filtered by the user's roles — CASHIER sees only Sales; WAREHOUSE_STAFF sees only Inventory; etc. Username and role badge shown in the top-right with a Sign out button.
- [x] **Login page** — username/password form at `/login`. Redirects away if already authenticated. Error shown inline on bad credentials. Auto-redirects to `/sales` on success.

---

## Batch 2 — Sales encoding workstation
> See requirements §18 for full behavioral spec. **Complete — 2026-05-30.**

- [x] **Route** — `/sales/new`
- [x] **Session header bar** — date, shift, location, register, cashier, Sale PID with auto/manual toggle. Lock/unlock affordance freezes all header fields between transactions.
- [x] **Item search panel** — persistent left panel; keyword search against cached POS catalog (product name, variant name, PID, barcode); results stay visible after click; clicking adds to cart or increments qty.
- [x] **Cart table** — spreadsheet-style with item label, unit price, qty, Disc %, Disc ₱, line total (read-only), delete button. Line total formula: `(unit_price × (1 − disc_pct/100) − disc_flat) × qty`.
- [x] **Discount fill-down** — each filled discount cell shows a ⬇ handle: single click fills the next row, double-click fills all rows below, drag (mouseenter during mousedown) fills rows as cursor passes over them. Both Disc % and Disc ₱ are independent.
- [x] **Cart footer** — subtotal, Cart Disc %, Cart Disc ₱, Discount Amount, Grand Total, Receipt Total (editable override), Variance (green/red when non-zero).
- [x] **Payment tender section** — add/remove rows; each row has payment mode selector, amount, and optional reference number; running total and balance due shown.
- [x] **Draft tray** — collapsible panel showing up to 5 most recent open drafts (Sale PID, item count, grand total); click to load into cart with confirmation guard.
- [ ] **Post sale button** — validates required fields, sends idempotency key, submits to `POST /sales/drafts/{id}/post`. On success: clears workstation, auto-increments receipt number.
- [x] **Draft queue** — accessible from the workstation. Lists all open drafts for the current location. Click to resume a draft and load it back into the workstation.
- [x] **POS catalog cache** — on workstation load, fetch `GET /products/pos-catalog` once and cache locally. Item search resolves against the local cache — no per-search API call.

---

## Batch 3 — Sales list and detail

- [ ] **Route** — `/sales`
- [ ] **Sales list page** — paginated table of posted and voided sales. Columns: sale PID, date, shift, cashier, location, customer, grand total, receipt total, variance, payment status. Supports filter by date range, shift, location, cashier, customer, payment status.
- [ ] **Sale detail page** — route `/sales/{id}`. Shows full sale header, collapsed line items (one per variant), payment tender breakdown, variance, void status. Auditor role sees a Void button.
- [ ] **Void modal** — confirm void action, require void reason input. Submits to `POST /sales/{id}/void`.

---

## Batch 4 — Customer management

- [ ] **Route** — `/customers`
- [ ] **Customer list** — searchable table. Columns: name, credit limit, outstanding balance, terms days, status.
- [ ] **Customer detail** — route `/customers/{id}`. Shows customer info, outstanding balance, AR ledger history, linked sales.
- [ ] **Create/edit customer form** — name, credit limit, terms days.
- [ ] **Customer payments** — on the customer detail page, a section to record and view payments. Each payment: payment mode, amount, date, reference number. Applied payments shown per invoice/sale.

---

## Batch 5 — Settings pages

- [ ] **Route** — `/settings`
- [ ] **Payment modes** — list, create, edit, deactivate.
- [ ] **Cash registers** — list, create, edit, deactivate. Each register linked to a location.
- [ ] **Shifts** — list, create, edit, deactivate.
- [ ] **Locations** — list, create, edit, deactivate. Nested location tree display. System locations (Quarantine, Adjustment) shown as read-only.
- [ ] **UOMs** — list, create, edit.
- [ ] **Categories** — list, create, edit. Parent-child hierarchy display.

---

## Batch 6 — Inventory module

- [ ] **Route** — `/inventory`
- [ ] **Product list** — searchable, filterable by category and status. Shows product name, type, variant count, status.
- [ ] **Product detail** — route `/inventory/products/{id}`. Shows all variants, barcodes, UOM conversions, bundle components, supplier links.
- [ ] **Create/edit product form** — name, type, base UOM, category links, status.
- [ ] **Variant management** — add/edit/soft-delete variants within a product. Set default variant. Manage price and promo price.
- [ ] **Stock view** — per variant, show current stock across all active locations. Exclude virtual locations.
- [ ] **Inventory ledger view** — per variant, show ledger history with reason, qty change, reference, date.
- [ ] **Stock transfers** — list transfers, create new transfer, view transfer detail.
- [ ] **Stock adjustments** — UI shortcut for transfers involving the Adjustment virtual location.

---

## Batch 7 — Procurement module

- [ ] **Route** — `/procurement`
- [ ] **Supplier list** — searchable. Shows name, terms, primary contact.
- [ ] **Supplier detail** — route `/procurement/suppliers/{id}`. Shows supplier info, linked variants, PO history, AP balance.
- [ ] **Purchase order list** — filterable by status and supplier.
- [ ] **PO detail** — route `/procurement/orders/{id}`. Shows header, line items, received quantities, status.
- [ ] **Create PO form** — select supplier, location, expected arrival, add line items.
- [ ] **Receiving** — create shipment against a PO or standalone. Enter received, declared, actual, rejected quantities per line. QC status. Submit to confirm shipment.
- [ ] **Supplier returns** — list and create supplier returns. Status lifecycle: Draft → Shipped → Credit Received.

---

## Batch 8 — Accounts payable module

- [ ] **Route** — `/ap`
- [ ] **Invoice list** — filterable by supplier, status, due date range. Shows invoice number, supplier, total, amended total, due date, status.
- [ ] **Invoice detail** — shows linked shipment, payment history, amendment notes.
- [ ] **Record payment** — select supplier, amount, payment mode, reference number. Apply to one or more invoices.
- [ ] **AP ledger view** — per supplier, show full AP ledger history.
- [ ] **Payment forecasting view** — invoices grouped by due month. Shows total due per month.

---

## Batch 9 — Auth and user management

- [ ] **Route** — `/admin/users`
- [ ] **User list** — shows username, linked employee, roles, active status.
- [ ] **Create user form** — link to employee, set username, password, assign roles.
- [ ] **Edit user** — change roles, change password, deactivate/reactivate.

---

## Out of scope — do not build until instructed

- Reporting and analytics pages
- Sales returns UI (backend exists, frontend design pending)
- Bulk import UI
- Shift reconciliation
- Dashboard / home screen
