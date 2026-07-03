# Season ERP — Backend Work Order
**Created:** 2026-05-28  
**Status:** In progress  
**Source:** Audit report from CC session 2026-05-28

---

## How to use this file

- Work through batches in order. Complete and confirm each batch before starting the next.
- Mark items `[x]` as they are completed.
- After each batch, update `/docs/changelog.md` with what changed.
- This file lives at `/docs/backlog.md`.

---

## Batch 1 — One-liners and data integrity
> Do all four together in one commit.

- [x] **Alembic URL encoding bug** — `alembic/env.py:34`: replace raw `db_password` with `safe_password` (already computed via `quote_plus`) in `DATABASE_URL`. Passwords with special characters currently break migrations silently.
- [x] **`InvoiceOut.shipment_id` nullable mismatch** — `ap/schemas.py`: change `shipment_id: int` to `Optional[int]` to match the nullable column in the `SupplierInvoice` model. Currently, any invoice created without a shipment link fails schema validation on the response.
- [x] **`_consume_fifo` pre-flight check** — before consuming cost layers, verify `current_stocks.quantity >= requested quantity`. If layers and stock ever drift out of sync due to a failed partial transaction, the FIFO check currently passes while stock goes negative.
- [x] **Login attempt not logged for deactivated accounts** — `auth/router.py:112–113`: write a `LoginAttempt` record (with `success=False`) before returning 403 when `is_active = False`. Requirements §4.1 requires all failed attempts to be recorded regardless of reason.

---

## Batch 2 — Receiving correctness
> Most consequential bug group. All four items touch `confirm_shipment` — do in one transaction block.

- [x] **`quantity_rejected` ignored on receive** — `procurement/router.py:329`: change `qty = detail.quantity_actual` to `qty = detail.quantity_actual - detail.quantity_rejected`. Rejected units must be routed to the Quarantine virtual location via a separate `RECEIVE` ledger entry. Currently, full `quantity_actual` enters active stock and `quantity_rejected` is stored but never acted on.
- [x] **Non-Inventory/Service product guard** — check `product.product_type` before writing to `inventory_ledger`, `current_stocks`, and `cost_layers` in both `confirm_shipment` and `create_transfer`. `Non-Inventory` and `Service` variants must never generate ledger entries (Requirements §6.1).
- [x] **Auto-invoice creation on receive** — `confirm_shipment` must create a `SupplierInvoice` record in the same transaction, with `total_amount = quantity_declared × unit_cost` from the receiving detail. Due date = `invoice_date + supplier.terms days`. Requirements §9.1.
- [x] **Expose `received_at` and `inspected_at`** — add both fields to `ReceivingDetailCreate`, `ReceivingDetailOut`, and the `add_receiving_details` router. Currently both are always stored as NULL despite being in the model.

---

## Batch 3 — Transfer and PO correctness

- [x] **ADJUST ledger reason** — `inventory/transfers_router.py`: detect when either `from_location` or `to_location` is the Adjustment virtual location and write `ADJUST` as the ledger reason instead of `TRANSFER_OUT`/`TRANSFER_IN`. The `ADJUST` enum value currently exists but is dead code (Requirements §9.4).
- [x] **PO lifecycle enforcement** — `procurement/router.py:195–210`: enforce valid transitions only: `Draft → Open → Partially_Received → Closed | Cancelled`. Reject any other transition with HTTP 400. Currently any status value is accepted silently, including `Closed → Draft`.

---

## Batch 4 — AP completeness

- [x] **`_recalculate_invoice_status` uses wrong amount** — `ap/router.py:55`: when `amended_amount` is set, compare `total_applied` against `amended_amount` instead of `total_amount`. Currently payments are marked Paid against the wrong figure whenever an amendment exists (Requirements §10.1).
- [x] **Expose `amended_amount` and `amendment_notes` in `InvoiceOut`** — both fields are in the model but absent from the response schema.
- [x] **`PATCH /ap/invoices/{id}` amendment endpoint** — new endpoint to set `amended_amount` and `amendment_notes` on an existing invoice. Requirements §10.1.
- [x] **`POST /ap/ledger` manual entry endpoint** — allow manual `CREDIT_MEMO` and `ADJUSTMENT` entries. Required for supplier return recoveries and free replacement stock scenarios (Requirements §9.3, §10.4).

---

## Batch 5 — Missing endpoints

- [x] **UOM CRUD** — `GET /products/uoms`, `POST /products/uoms`, `PATCH /products/uoms/{id}`
- [x] **Category CRUD** — `GET /products/categories`, `POST /products/categories`, `PATCH /products/categories/{id}`
- [x] **`GET /products/variants/{id}` standalone** — with price NULL fallback: if `variant.price` is NULL, return price from the sibling variant where `is_default = true` (Requirements §6.2).
- [x] **`GET /products/variants/{id}/stock`** — return stock levels for a variant across all locations, excluding virtual locations (Requirements §9.7).
- [x] **`GET /transfers/locations/{id}`** — single location detail endpoint.
- [x] **`PUT /procurement/orders/{id}/items/{item_id}`** — update a PO line item (Requirements §8.2).
- [x] **User management endpoints** — deactivate user, change roles, change password (Requirements §4.1).

---

## Batch 6 — Stubs
> Do last. JWT touches every route; audit log touches every write.

- [x] **JWT enforcement** — replace the stub in `auth/dependencies.py:get_current_user()` with real JWT decoding. Apply `require_permission()` to all protected routes across all modules. Currently only one endpoint uses it and it checks roles on the wrong user entirely.
- [x] **Audit log writes** — write an `audit_log` record on every significant INSERT, UPDATE, and DELETE across all modules. `old_values` and `new_values` as JSONB. Records are immutable — never update or delete them (Requirements §4.3).

---

## Implemented under v2 schema (2026-05-29)

The following items were previously out of scope. Schema v2.0 was approved and all items below have been fully implemented. See `/docs/sales_backlog.md` for the detailed work order.

- ~~Sales module~~ — **complete** (Batches 1–12 of `/docs/sales_backlog.md`): models, POS catalog, draft lifecycle, posting, reading, voiding, customer payments, sales returns, supplier returns, auth + audit wiring.
- ~~Customer returns module~~ — **complete** (`POST /sales/returns`, `GET /sales/returns`, `GET /sales/returns/{id}`).
- ~~Settings module (registers, payment methods)~~ — **complete** (`/sales/registers`, `/sales/payment-modes`). Shift management and register open/close reconciliation remain out of scope.

---

## Completed in recent sessions (2026-06-03 / 2026-06-04)

The following were implemented and verified. See `/docs/changelog.md` for detail.

- [x] **Two-stage receiving workflow** — `POST /shipments/{id}/receive` (Stage 1, ledger only) and `POST /shipments/{id}/confirm-costs` (Stage 2, cost layers + invoice). Frontend: `ReceivingNew.tsx` calls Stage 1 on save; `ReceivingConfirm.tsx` calls Stage 2.
- [x] **Non-blocking FIFO fallback + `cost_source`** — `_consume_fifo_for_sale` no longer blocks on missing cost layers. Falls back to `supplier_list` then `none`. `cost_source` column added to `sales.sale_items`. Migration `n6o7p8q9r0s1`.
- [x] **Allow Negative Stock policy** — `settings.system_settings` table + `GET/PATCH /settings/inventory-policy`. Stock balance check skipped in `post_draft` and `create_transfer` when `allow_negative_stock = true`. Settings page Inventory Policy tab.
- [x] **Bundle stock policy** — Bundle variants blocked from Transfer and Receiving item search and XLSX import. Backend computes `bundle_available_stock` per physical location via component FIFO. Catalogue shows computed count in amber with tooltip.
- [x] **Auditor Workstation updates** — Lock/unlock removed; cashier sources from employees; customer search with balance display; promo price indicators; Cash auto-populate in tender; conditional reference number; global numeric onFocus select.
- [x] **Customers & AR module** — `GET/POST /sales/customers`, `GET /sales/customers/{id}/ar-ledger`, `/sales`, `/payments`, `POST /sales/customers/{id}/payment`, `GET /sales/ar-ledger`. Frontend: `CustomerList`, `CustomerDetail`, `CustomerARLedger` pages.
- [x] **Sales Ledger** — `GET /sales/` with `has_variance`, `has_uncosted`, cursor pagination, `SalesListResponse` with totals. `SalesLedger.tsx` with full filter panel, summary row, customer/cashier display. `SaleDetail.tsx` with cost_source badges, tender section, void modal.
- [x] **Sales Ledger dashboard** — `GET /sales/summary` endpoint (merchandise gross, cart discounts, non-merch revenue, variances, total revenue, known profit, partial gross sales, coverage pct). Dashboard card rows synced with scope filters in real time.
- [x] **Sale PID auto-increment** — `GET /sales/next-pid` uses `MAX(CAST(SUBSTRING...))` on conforming PIDs. Workstation fetches on mount and invalidates after every post.
- [x] **Sales Ledger redirect fix** — `GET /sales/` trailing slash added to prevent FastAPI 307 redirect stripping the `/api/` prefix.

---

## Known gaps (identified during implementation — address when instructed)

- [x] **Transfer FIFO under negative stock** — `_consume_fifo` in `transfers_router.py` now consumes all available layers then appends a synthetic zero-cost entry for any uncovered remainder when `allow_negative = True`. Transfers no longer block on depleted layers when the policy is enabled.
- [x] **Pre-policy `cost_source = NULL`** — Migration `p8q9r0s1t2u3` backfilled `cost_source = 'fifo'` for 7 rows where `cost_source IS NULL AND cost_layer_id IS NOT NULL`. Remaining 6 NULL rows are Non-Inventory/Service or bundle-level items with no cost tracking — correctly left as NULL. Known Profit on the dashboard now includes these backfilled rows.
- [x] **Non-standard sale PIDs in DB** — Won't fix. Renaming PIDs that appear on physical receipts would break the paper trail. `GET /sales/next-pid` already ignores non-conforming PIDs correctly. Display in the Ledger is acceptable as-is.
- [x] **CustomerDetail running balance** — Fixed in `CustomerDetail.tsx`. Running balance now correctly computed by starting from `outstanding_balance` and subtracting each `amount_change` as we walk backwards through the descending AR ledger, giving the true balance after each historical transaction.
- [x] **`confirm_shipment` (old one-step endpoint)** — `POST /shipments/{id}/confirm` replaced with a 410 Gone stub that directs callers to the two-stage workflow. Old function body removed. `ReceivingDetail.tsx` updated: editable reconciliation fields removed (Stage 1 quantities are already locked in the DB); "Confirm Receipt" button replaced with read-only status badge + "Confirm Costs →" navigation to `ReceivingConfirm`.

---

## RMA workflow — implemented (2026-06-04)

Spec: `/docs/rma_workflow.md`

- [x] **`_do_return` helper** — extracted return creation logic from `create_return` into a shared function that creates the return without committing. Both `create_return` and `create_return_and_exchange` call it.
- [x] **`POST /sales/returns/exchange`** — atomically creates a return + exchange Draft sale linked via `origin_sale_id`. Returns `{ sales_return, exchange_draft }`. Registered before `GET /returns/{id}`.
- [x] **`GET /sales/returns` enhanced** — added `search`, `location_id`, `has_exchange`, `cursor`, `limit` filter params. Attaches `exchange_sale_pid` / `exchange_sale_id` to every row via `_attach_exchange()`.
- [x] **`GET /sales/returns/{id}` enhanced** — now returns `exchange_sale_pid` / `exchange_sale_id`.
- [x] **`GET /sales/sale/{id}/items-for-return`** — returns collapsed sale items annotated with `already_returned` qty. Used by ReturnNew to pre-populate and validate return quantities.
- [x] **`SalesReturnOut` schema** — added `exchange_sale_pid`, `exchange_sale_id`.
- [x] **`ExchangeResult` schema** — `{ sales_return: SalesReturnOut, exchange_draft: SaleOut }`.
- [x] **`already_returned` on `SaleItemOut`** — nullable field set only by `items-for-return` endpoint.
- [x] **Store Credit payment mode** — seeded on startup via `_seed_store_credit()` in `main.py`. `is_physical = false`, `is_active = true`.
- [x] **`Returns.tsx`** — RMA list page at `/sales/returns`. Filter panel (keyword, date, location, customer, has_exchange). Table with original sale link, exchange sale link, return total. XLSX export.
- [x] **`ReturnNew.tsx`** — Return processing page at `/sales/returns/new?sale_id=X`. Pre-populated from original sale via `items-for-return`. Editable return quantities. "Return Only" and "Exchange →" action buttons. Exchange navigates to workstation with exchange draft state.
- [x] **`ReturnDetail.tsx`** — Read-only return detail. Shows original sale link and exchange sale link if created.
- [x] **`SaleDetail.tsx`** — "Return / Exchange" button added for Posted sales. Navigates to ReturnNew.
- [x] **`Sales.tsx`** — "Returns" tab added to sub-nav. Routes for `/returns`, `/returns/new`, `/returns/:returnId`.

---

## Sales module fixes — implemented (2026-06-05)

- [x] **Receipt Total display-only** — input removed from workstation footer; `post_draft` sets `receipt_grand_total = grand_total`; `audit_variance = total_tendered - grand_total`.
- [x] **Change Due / Balance Due** — tender section shows "Change Due" (emerald) when over-tendered, "Balance Due" (red) when under, nothing when equal. Replaces old single "Balance Due" line.
- [x] **New ledger columns** — Subtotal Amount, Cart Disc %, Cart Disc ₱, Discount Amount, Tax Amount, Total Tendered, Variance. Old `subtotal`/`discount`/`receiptTotal` keys replaced. Summary row updated.
- [x] **Ledger date range defaults to today** — `dateFrom` and `dateTo` initialise to today on page load. *(2026-06-07: source already used a correct local-date helper, but the deployed frontend bundle was stale and still ran `toISOString()`, which returns the UTC date and shows yesterday's date for UTC+8 users — fixed by rebuilding `seasons_frontend`.)*
- [x] **Same-day query fix** — `sale_date < date_to + 1 day` (inclusive) in `list_sales` and `get_sales_summary`. Was previously `<= date_to` which excluded all intraday sales. *(2026-06-07: this naive-UTC range still misclassified PH-local "today" sales made before ~8am Manila time as "yesterday" since `sale_date` is stored in UTC. Added `_ph_day_bounds()` to anchor `date_from`/`date_to` to PH-local midnight (UTC+8) before computing the range — see changelog.)*
- [x] **Collections card alignment** — `<Tip>` moved to wrap label only; amount value is now a sibling in the flex row. Was `inline-block` wrapping the full flex div, breaking right-alignment.
- [x] **Payment mode name/is_physical fix** — `_load_sale` now eager-loads `payment → payment_mode`; sets `payment_mode_name` and `payment_mode_is_physical` on each payment; `CustomerPaymentOut` schema and TypeScript type extended; `SaleDetail.tsx` uses resolved values directly with modeMap fallback.
- [x] **Cash default tender hardened** — `cashModePID` tries name='cash' first, then first `is_physical=true` mode, then first active mode.

---

## Sales Ledger redesign — implemented (2026-06-04)

Per `/docs/sales_ledger_basic.md` Dashboard section and Page 1 spec.

- [x] **Dashboard redesign — three cards** — Revenue (composition table with tooltips), Profitability (Gross Profit + Uncosted Revenue, no coverage %), Collections (per payment mode with Physical/Virtual badges, Total Physical, Total Virtual, Total Collected).
- [x] **`SalesSummaryResponse` schema** — `known_profit` → `gross_profit`, `partial_gross_sales` → `uncosted_revenue`, `coverage_pct` removed. `CollectionEntry` added. New fields: `collections`, `total_physical`, `total_virtual`, `total_collected`.
- [x] **`get_sales_summary` endpoint** — collections computed via `customer_payment_applied → customer_payments → payment_modes` join grouped by mode.
- [x] **`VariantRefOut` extended** — `product_brand` and `product_type` added (optional). `_collapse_items` populates them when `Variant.product` is eager-loaded.
- [x] **selectinload chains** — `list_sales` and `_load_sale` now load `SaleItem.variant → Variant.product`.
- [x] **Column picker** — ⚙ button, `localStorage` persistence (`erp_ledger_cols`). Permanent: Sale PID, Date, Grand Total. Toggleable: all others. Default shows Location, Cashier, Customer, Receipt Total, Variance, statuses.
- [x] **Expandable tender sub-rows** — ▶/▼ per sale row, shows Payment Mode, Amount, Reference, Physical/Virtual badge. One expanded at a time.
- [x] **Two-sheet XLSX export (ledger)** — Sheet 1: Tender Breakdown (one row per tender); Sheet 2: Line Item Detail (one row per sale item with Brand, Product Type). File: `sales_export_{from}_{to}.xlsx`.
- [x] **Two-sheet XLSX export (sale detail)** — same structure, filtered to single sale.
- [x] **Sale Detail tender section** — Money Type column (Physical/Virtual badge), Total Physical and Total Virtual rows.
- [x] **Theme compliance** — all hardcoded colors in SalesLedger replaced with `t-*` variables.
- [x] **Register dropdown reliability** — `retry: 3` applied, error + retry UI added (previously completed, confirmed).

---

## Bulk Excel Import — implemented (2026-06-04)

Spec: `/docs/bulk_import.md`

- [x] **`import_hub/` backend module** — `schemas.py` (all request/response types), `router.py` (all endpoints), `__init__.py`. Mounted at `/import` prefix in `main.py`.
- [x] **Template endpoints** — `GET /import/{entity}/template` for all 5 entities. Generated server-side with `xlsxwriter`: header row (bold, dark background) + one sample row. Returns XLSX as StreamingResponse.
- [x] **Preview endpoints** — `POST /import/{entity}/preview` for all 5 entities. Validates rows, returns `{ valid_rows, error_rows, summary }`. No writes. Safe to call repeatedly.
- [x] **Confirm endpoints** — `POST /import/{entity}/confirm` for all 5 entities. Combined body: `{ confirmed_anchors, rows }`. Writes only approved anchors in a single transaction.
- [x] **Customers** — anchor: `customer_name`. Diff: credit_limit, terms_days. "no limit" string clears credit_limit. `outstanding_balance` always initialised to 0.
- [x] **Suppliers** — anchor: `supplier_code`. Diff: supplier_name, terms, bank_account_name, contact_person, phone, email, address. supplier_code never updated.
- [x] **Opening Stock Balances** — anchor: `PID|location_name`. Computes delta = new_qty − current_qty. Writes `ADJUST` ledger entry + upserts `current_stocks`. Virtual locations, bundle variants, and Non-Inventory/Service variants rejected.
- [x] **Variant Prices** — anchor: `PID`. Validates price > 0, promo ≤ price. `clear_promo` column clears promo_price. Writes `variant_price_history` for each change.
- [x] **Variant Costs** — anchor: `PID|supplier_code`. Requires existing supplier link. Validates cost > 0, discount 0–100. Writes `variant_cost_history` for each change.
- [x] **`ImportHub.tsx`** — entity sidebar (5 items), per-entity form (download template, upload XLSX, validation results panel, error chips, "Review & Confirm →" button, error report download). Lazy-loaded.
- [x] **`DiffModal`** — generic diff table: checkbox per row, anchor, mode badge, field / current / incoming columns. Confirm all / Deselect all. "Apply N rows" calls confirm endpoint.
- [x] **Settings.tsx** — "Import" tab added. `ImportHub` lazy-loaded with Suspense. Uses negative margin to break out of the Settings card padding.
- [x] **`api.ts`** — `ImportDiffRow`, `ImportErrorRow`, `ImportPreviewResponse`, `ImportConfirmResponse` types. `importApi` object: `downloadTemplate`, `preview`, `confirm`.

---

## Customer Transaction Ledger — implemented (2026-07-03)

- [x] **`GET /sales/customers/{id}/transaction-ledger`** — new endpoint scoped to Posted sales charged (in whole or in part) to the customer's AR balance via an AR Charge payment mode, plus every collection payment subsequently applied against those sales. Cash/non-credit sales excluded. Sorted oldest→newest with a server-computed running balance; ordinal `seq` used as the Load More cursor.
- [x] **`CustomerDetail.tsx`** — "Sales History" and "Payments" sections replaced with a single "Transaction Ledger" table (Date, Sales ID, Debit, Credit, Balance). The general "AR Ledger" section on the same page (all sales, not just AR-charge) was left in place at this point — see 2026-07-04 entry below, it's since been removed.
- [x] **Status column (2026-07-04)** — added `status` per row: SALE rows compare total collections applied to that specific `sale_id` against its AR-charged debit (`Paid` / `Partially Paid` / `Unpaid`); PAYMENT rows are always `Payment`. Computed in the same query as `running_balance`. Column order: Date, Sales ID, Status, Debit, Credit, Balance.
- Known gap: voided AR-charged sales are excluded from this ledger (their debt reversal isn't shown as a row here); returns credited to account against an AR-charged sale also don't appear as rows. Address if this ledger needs to reconcile 1:1 against `customer.outstanding_balance` in the future.
- [x] **Stale invalidation fixed (2026-07-04)** — `handleRecordPayment` was invalidating the dead `qk.customerPayments(cid)` query key (left over from the removed "Payments" section) instead of `qk.customerTransactionLedger(cid)`, so recording a payment didn't auto-refresh the Transaction Ledger until a full page reload. Now invalidates the correct key. Flagged during the 2026-07-03 diagnostic session, fixed here.
- [x] **AR Ledger section removed (2026-07-04)** — superseded by the Transaction Ledger. `GET /sales/customers/{customer_id}/ar-ledger` backend route deleted (confirmed zero other callers); the invoice-level `GET /sales/customers/ar-ledger` and `GET /sales/ar-ledger` routes are separate endpoints and were left untouched, as was the shared `ArLedgerOut` schema they still use.
- [x] **Transaction Ledger Excel export (2026-07-04)** — `GET /sales/customers/{customer_id}/transaction-ledger/export` returns the full unpaginated history (row-building logic shared with the paginated endpoint via `_build_customer_transaction_ledger`). Frontend builds the workbook client-side with `xlsx` (same library as every other export in the app): a statement header block (Customer Name, Terms, Credit Limit, Outstanding Balance, generation date — no address/contact fields exist on `Customer`) followed by the same Date/Sales ID/Status/Debit/Credit/Balance table shown on screen. Filename: `{customer_name}_transaction_ledger_{date}.xlsx`.

---

## Still out of scope (do not implement until explicitly instructed)

- Reporting and analytics layer
- Shift management and register open/close reconciliation
- UOM conversion enforcement on stock movements (conversions are reference data only)
