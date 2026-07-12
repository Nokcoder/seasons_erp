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
- [ ] Legacy `/products/import/*` endpoints (`inventory/router.py`) have no
  frontend caller and are orphaned dead code — decide whether to build
  a Catalogue import UI around them or remove them.

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

## Money-column export formatting — implemented (2026-07-04)

Two-step audit + fix: Step 1 inventoried every export/download feature in the app (18 found) and flagged 8 with mixed number/string money columns. Step 2 fixed those 8.

- [x] **Shared helper `frontend/src/lib/xlsxMoney.ts`** — `jsonToFormattedSheet()` (aoa_to_sheet + `.z` number-format stamping, replacing `json_to_sheet`) and `stampNumberFormat()` (lower-level, for worksheets built by other means). `MONEY_FORMAT`/`PCT_FORMAT` constants matching the backend `xlsxwriter` convention already used in `procurement/router.py`'s shipment invoice export.
- [x] **`CustomerAging.tsx`** — 5 AR Aging bucket columns no longer blank a real `0`.
- [x] **`CustomerARLedger.tsx`** — `Balance Due` no longer blanks on zero; `Total Amount` per-group subtotal now genuinely blank (`undefined`) instead of `''` on non-last rows.
- [x] **`CustomerDetail.tsx`** — `Credit Limit` genuinely blank when unset (was text label `'No Limit'`); `Debit`/`Credit` keyed off `row.type` instead of `> 0` so a real $0 entry on the applicable side is never hidden.
- [x] **`SupplierAging.tsx`** — same bucket fix as CustomerAging.tsx.
- [x] **`CustomerList.tsx`** — `Credit Limit` genuinely blank when null.
- [x] **`SaleDetail.tsx`** — `Disc %`, `Disc ₱`, `Net Unit Cost` genuinely blank on absence; also fixed `Receipt Total`/`Variance` (same bug, adjacent, not in the original per-file list but already flagged in Step 1).
- [x] **`SalesLedger.tsx`** — same `Disc %`/`Disc ₱`/`Net Unit Cost`/`Receipt Total`/`Variance`/`Unit Cost` fixes across all 3 sheets; negative return totals keep the existing plain-minus-sign convention.
- [x] **`Catalogue.tsx`** — `Promo Price`/`Gross Cost` genuinely blank on absence; also fixed `Price`, which can legitimately be `null` per `InvVariant.price: number | null` (missed by the Step 1 audit, which assumed it was always populated) — now guarded instead of silently coercing `null` to `₱0.00`.

Out of scope, untouched per instructions: backend `xlsxwriter` exports (Shipment Invoice, `import_hub` templates), and `ApLedger.tsx`/`CreditMemo.tsx`/`Returns.tsx` (already fully numeric in Step 1).

Not yet exercised by opening a generated file in Excel/LibreOffice to visually confirm the number formatting renders as expected — flagged for confirmation.

---

## PID editability + computed barcode resolver — implemented (2026-07-07)

Spec: `/docs/pid_editability_fix.md`. See `/docs/changelog.md` for detail.

- [x] **Unlock PID field on Product Detail** — `VariantUpdate` was missing `PID`, so the already-editable frontend field silently failed to persist. Added `PID` to the schema plus a uniqueness check (`PID already in use`) in `update_variant`.
- [x] **Computed barcode resolver** — `_resolve_barcode()`: explicit primary base-UOM `variant_barcodes` row, else falls back to `variant.PID`. Never written/materialized — resolved fresh on every read (`_load_product`, `list_products`, `get_variant`, `update_variant`). Exposed as `VariantOut.resolved_barcode`. Replaces an earlier same-day cascade/reprint-on-save design.
- [x] **Cross-namespace collision checks** — PID rename rejected if it matches another variant's explicit barcode; new explicit barcode rejected if it matches another variant's current PID.
- [x] **Import upsert confirmed unchanged** — still keys strictly off current `variants.PID`.
- All 5 smoke tests passed against the live stack (rename with/without explicit barcode, both collision directions, renamed-PID reuse via import).
- [x] **Reverse resolver** (scanned string → variant) — `GET /products/resolve?code=...`; wired into `Workstation.tsx`'s barcode-scan field with a PID fallback and "Item not found" flash.
- [x] **DB-level collision triggers** — migration `s9t0u1v2w3x4`, `BEFORE INSERT OR UPDATE` on `inventory.variants` and `inventory.variant_barcodes`. App-level check extended to `add_variant`/`create_product` (previously only `update_variant`/`add_barcode`).
- [x] **PID history confirmed still out of scope** — no such table/model exists.
- [~] **variant_id-aware import anchor** — redirected per user decision: legacy `/products/import/*` endpoints left untouched (no frontend page uses them); `variant_id` added to Catalogue export only. Audited `import_hub`'s PID-anchored entities instead — found and fixed a bug in `cost_confirm` (missing `None` guard threw a raw `AttributeError` instead of a clean row error on an unresolvable PID/supplier).
- All 10 smoke tests run against the live stack; tests 6–9 (full catalogue re-import round trip) not applicable given the above — substitute check run against the live `variant-prices` bulk import instead. See `/docs/changelog.md` for full detail.

---

## Receiving "Document ID" data-source fix — implemented (2026-07-08)

See `/docs/changelog.md` for detail.

- [x] **Inventory Ledger (`/stock/ledger`)** — `document_pid` for RECEIVE entries was resolving from `shipment_pid` (system-generated), corrected to `reference_number` (the actual "Document ID" field, per the label already used on Receiving Overview/Detail/Confirm). Link target (`reference_id` → shipment_id) was already correct and untouched.
- [x] **Variant Detail → Purchase History** — was displaying `shipment_pid` under a column literally labeled "Shipment PID," corrected to `reference_number` under "Document ID." Renamed `PurchaseHistoryItem.shipment_pid` → `.document_id` end to end (schema, API type, table).
- [x] **Confirmed untouched** — `shipment_pid` still drives the Shipment PID column on Receiving Overview and Shipment Detail; the internal `cost_layer` lookup inside `get_purchase_history` still joins on `shipment_pid` (not a display value, out of scope for this fix).
- [x] **Follow-up: `LedgerEntryContextOut.document_pid` renamed to `document_id`** — for consistency with `PurchaseHistoryItem.document_id` (same underlying value, both now the same field name) and because `document_pid` was a misleading name for a manually-entered reference number. Backend schema + `list_ledger`, frontend `api.ts` type + `Ledger.tsx` (3 usages). Confirmed zero remaining `document_pid` references in code.
- Verified live against real shipment data (Docker stack rebuilt) — both endpoints now return `reference_number` values instead of shipment PIDs; `net_unit_cost` still resolves correctly, confirming the untouched internal join wasn't broken.

---

> Note: the three sections below (payment audit gap fix, standalone payment reversal,
> bounce_pdc_check reversal gap) were logged together on 2026-07-09 as a backfill — all three
> were implemented and verified in the same session but only the bounce_pdc_check fix was
> explicitly requested to be logged; the other two were added retroactively since none had been
> documented yet.

## Payment audit gap fix — implemented (2026-07-08)

See `/docs/changelog.md` for detail.

- [x] **`record_customer_payment`** — no `write_audit()` call existed; added, folded into the
  existing single commit.
- [x] **`post_draft` tender-creation loop** — same gap, one `write_audit()` call added per tender,
  folded into the loop's existing single commit.
- Verified live: cross-referenced all 44 pre-fix `customer_payments` rows against `audit_log`
  (0 matches before the fix); created payments through both paths post-fix (matching `audit_log`
  rows in both cases); forced a mid-loop rollback to confirm the audit write and payment write
  can't exist independently.

---

## Standalone customer payment reversal — implemented (2026-07-09)

Design: `/docs/payment_correction_proposal.md`. See `/docs/changelog.md` for detail.

- [x] **Migration `t0u1v2w3x4y5`** — `reversed_at` / `reversed_reason` / `reversed_by_user_id` on
  `sales.customer_payments`. `docs/schema.dbml` updated.
- [x] **New RBAC action `reverse_customer_payment`** — `customers_list` program, granted to ADMIN
  + STORE_MANAGER only (not CASHIER), same tier as `cancel_credit_memo`.
- [x] **`POST /sales/payments/{payment_id}/reverse`** — origin-agnostic reversal (reads and negates
  the payment's actual `ArLedger` rows rather than re-deriving the amount from business rules),
  restores linked sales' `balance_due`/`payment_status`, full reversal only (no partial-amount
  correction — see proposal §7), excludes already-reversed / bounced-PDC / credit-memo-mode
  payments. First call site to populate `write_audit()`'s `old_values`.
- Verified live: functional reversal (ledger, balance, sale, payment flags, audit — all confirmed);
  all three precondition rejections; permission enforcement (CASHIER 403, STORE_MANAGER/ADMIN 200);
  forced-failure atomicity test confirmed no partial persistence.

---

## bounce_pdc_check reversal gap — implemented (2026-07-09)

See `/docs/changelog.md` for detail.

- [x] **Fix** — bounce only reversed `CustomerPaymentApplied`-linked amounts, permanently
  understating `outstanding_balance` for any PDC payment with a nonzero `unapplied_amount` at
  bounce time (fully or partially unapplied). Now derives the AR/balance reversal from the
  payment's actual `ArLedger` rows (same technique as the reversal endpoint above); sale-level
  `balance_due`/`payment_status` restoration unchanged.
- [x] **Retroactive correction** — the one live-affected record (`payment_id=52`, a test payment,
  $75.00 unresolved) re-processed through the fixed endpoint; `outstanding_balance` corrected with
  a proper audit trail.
- Verified live: fully-unapplied case (previously broken, now correct), fully-applied case
  (regression — unchanged), partial-application case (both ledger entries reversed, sale restored).
- **Discovered here, fixed below**: `apply_unapplied_payment` was found to double-count AR impact
  when applying previously-unapplied credit to a sale (wrote a second `ArLedger` entry / balance
  reduction for money already accounted for at the payment's creation). See the follow-up entry
  immediately below — fixed in the same commit but undocumented/unverified until 2026-07-09's
  follow-up audit.

---

## apply_unapplied_payment double-counting — fixed (2026-07-09, follow-up audit)

See `/docs/changelog.md` for full detail. Landed in the same commit as the two entries above
(`5a32d05`) but wasn't called out in the commit message or verified live at the time.

- [x] **Fix** — `apply_unapplied_payment` now derives how much of the amount being applied is
  already reflected in the payment's `ArLedger` rows (origin-agnostic, same technique as
  `reverse_customer_payment`/`bounce_pdc_check`) instead of unconditionally writing a new ledger
  entry and reducing `outstanding_balance` every time. Only the genuinely-new portion moves the
  ledger/balance; the `CustomerPaymentApplied` row and sale balance update always happen regardless.
- Verified live: record_customer_payment-originated unapplied amount applied across two calls
  (single creation-time ledger entry, no double-count on either apply); create_payment-originated
  partial-application regression (creation counts only the applied portion, later apply of the
  remainder still counts fresh); mixed partial case (already-applied + still-unapplied on the same
  payment); reasoning-only check against real data (`payment_id=44`, not applied live). Test
  payments cleaned up via the real reversal endpoint, not raw deletes — customer/sale balances
  confirmed back to exact pre-test baselines.

---

## RBAC / Access Control — audit findings, not yet remediated (2026-07-09)

Full investigation done via a live-code audit this session (grep/read across every backend
router and every frontend page — not a design review, an inventory of what actually runs).
**Nothing has been fixed.** This section exists so a future session doesn't have to re-run the
whole investigation from scratch — see the full action-by-action table first.

**Full reference**: a complete action inventory (program, backend gate file:line, frontend
gate file:line, which of the 6 roles hold it, per-action notes) was produced as a Claude
artifact this session: https://claude.ai/code/artifact/e33b961f-66f0-4365-a0a2-f539d7abbb94
That artifact is the source of truth for exact file:line citations — this backlog entry is a
summary/pointer, not a duplicate of it.

*Correction (2026-07-09, filed alongside the severity triage below): the original pass through
this audit stated "54 actions seeded" / "25/54 enforced" / "29 ungated" throughout this entry
and the linked artifact. A recount directly against `backend/main.py`'s `ACTIONS` list found
**57** entries, not 54 — an arithmetic error in the original roll-up, not a defect in the
per-action analysis itself (the artifact's action-by-action table was independently re-verified
against the corrected count and found complete/correct; only the summary totals were wrong).
Corrected below: 57 seeded, 25 enforced, **32** ungated. The artifact has been updated to match.*

- [ ] **Headline gap** — 57 actions are seeded in `auth.actions` (`backend/main.py`
  `_seed_rbac()`), but only 25 have an actual backend check (`require_permission(...)` as a
  FastAPI dependency, or an inline `has_action(...)` call — 23 + 2 respectively). The other 32
  exist purely as grantable catalogue rows with zero backend enforcement anywhere. For any of
  those 32, an authenticated user of *any* role can call the underlying endpoint directly
  (e.g. via a raw request with their own valid token) regardless of whether their role holds
  the action — the frontend may hide the button, but nothing backend-side stops the call.

- [ ] **Two dead components likely explain part of the gap**:
  - `frontend/src/components/Can.tsx` — a reusable role-gate component (`<Can roles={[...]}>`),
    fully built and documented, but grepping the entire frontend shows it is never imported
    anywhere outside its own docstring example. Zero call sites.
  - `backend/auth/dependencies.py`'s `require_program()` — a program-level enforcement
    dependency (parallel to `require_permission()`), defined but never attached to any route.
    All program-level gating today happens frontend-only (nav hiding via `program_keys`); no
    backend route rejects a request purely for lacking a program.

- [ ] **Specific mismatch patterns found** (file:line evidence in the linked artifact §4):
  - **STORE_MANAGER sees UI it can't actually use** — `Catalogue.tsx:19` and `Detail.tsx:19`
    both define `CAN_EDIT = ['ADMIN','STORE_MANAGER','WAREHOUSE_MANAGER']`, a hardcoded
    role-name array left over from before the action-key system existed. STORE_MANAGER is in
    that array but does not hold `manage_products` (confirmed against `main.py`'s
    `STORE_MANAGER` grant list). Concretely: `Catalogue.tsx:592-598`'s "+ New Product" button
    and all of `Detail.tsx`'s product/variant field-edit surface are visible to STORE_MANAGER
    and 403 on submit. `manage_products` is the first confirmed instance of this pattern, not
    necessarily the only one — the artifact's §4b is the full writeup.
  - **Backend looser than frontend implies, variant sub-entity CRUD** — `add_variant`,
    `update_variant`, `delete_variant`, and every barcode/UOM-conversion/bundle-component/
    variant-supplier-link CRUD endpoint under a variant (plus UOM CRUD, Category CRUD,
    `update_location`) have no `require_permission` at all — only the router-level
    `get_current_user` (any authenticated user). This is currently invisible in practice
    because the roles that can reach these controls in the UI already hold broad permissions
    elsewhere, but it's structurally a real gap, not a UI-only cosmetic issue — see artifact §4a.
  - **Partial enforcement within one entity** — `manage_locations` gates `POST
    /transfers/locations` (create) but not `PUT /transfers/locations/{id}` (update) —
    `transfers_router.py:284`. Same permission concept, same Settings tab, asymmetric
    enforcement.
  - **Design doc overstates actual coverage** — `docs/rbac_programs_actions.md` states
    *"Backend: require_permission() enforces action-level access on every write and sensitive
    read endpoint."* Actual measured coverage this session: 25/57. The doc should either be
    updated to reflect reality or treated purely as historical design intent, not current state.
  - **`cashiering_mode` divergence** — the design doc specs `cashiering_mode` as an action_key
    under the `sales_workstation` program. It was implemented instead as a role-level boolean
    flag (`roles.is_cashiering_mode`, set via `PATCH /auth/roles/{id}/cashiering-mode`) and
    never added to the actual `ACTIONS` seed in `main.py`. Not a bug, just a spec/implementation
    divergence worth knowing about before trusting the design doc's action list at face value.

- [x] **Triaged by severity** — done below, in "RBAC severity triage — result of the 'not yet
  triaged' item above (2026-07-09)". Classification only, nothing remediated.

---

## create_payment split-commit — audit gap, not yet remediated (2026-07-09)

Found while writing `docs/customers_sales_process_flows.md` §3.1/"Known gaps" (Payment
lifecycle documentation pass). Not investigated further or fixed — flagging for a future
session.

- [x] **Resolved (2026-07-11)** — `create_payment` (`POST /sales/payments`,
  `backend/sales/router.py:2671-2762`)
  commits the payment row and its full financial effect (AR ledger entries via
  `_apply_and_update`, `customer.outstanding_balance`) in one transaction
  (`db.commit()` at `router.py:2756`), then calls `write_audit(...)` and commits a **second,
  separate** transaction (`router.py:2758-2761`). Every other mutating endpoint in this file
  folds its `write_audit()` call into the same single commit as the financial write — this is
  the only one that splits it into two. A crash or error between the two commits leaves a real,
  financially-effective payment (ledger already moved, `outstanding_balance` already reduced)
  with **no corresponding audit_log row** — silently reproducing the exact class of gap the
  2026-07-08 "Payment audit gap fix" (see `docs/changelog.md`) closed for
  `record_customer_payment` and `post_draft`'s tender loop, just via a different mechanism
  (split commit vs. a missing call entirely).
- [x] **Fixed exactly as recommended** — reordered to match this file's established
  convention: `write_audit(...)` now runs before the single `db.commit()`, the same way
  `record_customer_payment` does it (`router.py:1016-1019`), rather than committing twice.
  Landed as part of the "pool payment, then assign to transactions" feature
  (`docs/payment_pooling_proposal.md` §5/B.3, see `docs/changelog.md` 2026-07-11), which was
  already rewriting this endpoint's transaction tail for an unrelated accounting fix — folded
  this fix in rather than leaving a known atomicity gap in the exact endpoint that work was
  built around. Confirmed live: `auth.audit_log` shows the `INSERT` row for a new
  `create_payment`-originated payment, and a forced mid-loop failure left zero trace (no payment
  row despite the mid-transaction `db.flush()`, no ledger row) — full single-transaction
  atomicity, not just the audit ordering fix in isolation.
- Cross-reference: `docs/customers_sales_process_flows.md` §5 ("Audit Trail Coverage") already
  lists `create_payment` as ✅ audited — that's accurate (the audit row does get written), this
  entry is specifically about the transaction boundary around it, not about coverage existing
  or not.

---

## Sales Ledger (`GET /sales/`) cursor pagination is non-functional — not yet remediated (2026-07-09)

Found while filing the backlog entry for "the pagination bug" referenced during the
Customers/Sales process-flow documentation pass (`docs/customers_sales_process_flows.md`). An
earlier pass through that same doc flagged `list_payments`' total absence of pagination as the
closest candidate it could find, with an explicit caveat that it wasn't confirmed to be the
issue meant. A closer read of `list_sales` turned up a stronger, concretely verifiable bug in
the same area — filing that as the primary finding here; see the note at the bottom for how the
two relate.

- [ ] **Gap** — `list_sales` (`GET /sales/`, `backend/sales/router.py:2275-2444`, the main Sales
  Ledger listing endpoint) declares and documents a cursor-based pagination contract that the
  implementation never actually honors:
  - `cursor: Optional[int] = None` is declared as a parameter (`router.py:2289`) and documented
    in the function's own docstring — *"cursor is a sale_id — returns sales with sale_id <
    cursor (older)"* (`router.py:2296`) — but the parameter is **never referenced anywhere in
    the function body**. No filter is ever applied using it, for either the pure-sales case or
    the sales+returns "mixed list" case.
  - The main query has no SQL-level `LIMIT` at all — `all_sales = q.all()` (`router.py:2349`)
    fetches every row matching the current filters, unbounded, on every request.
  - Pagination is instead simulated by slicing the fully-materialized, already-sorted Python
    list: `page = combined[:limit]` (`router.py:2441`), immediately after a comment stating
    *"cursor not supported for mixed list; always return first N"* (`router.py:2440`) — worded
    as if this were a narrower limitation of the mixed sales+returns case specifically, when in
    fact `cursor` is unused in every case, mixed or not.
  - `next_cursor = None` is hardcoded on the response (`router.py:2442`) regardless of whether
    more rows exist beyond `page`. A client has no way to detect or reach truncated data.
  - **Visible symptom**: `frontend/src/pages/sales/SalesLedger.tsx` never sends a `cursor` and
    has no Load More / next-page UI at all (confirmed — no pagination-related state or controls
    in the file, only unrelated CSS `cursor-pointer`/`cursor-help` classes). Meanwhile the
    `totals` row in the same response (`router.py:2431-2438`) is computed from `combined` — the
    **full** filtered result set, before the `[:limit]` slice. So for any filter combination
    matching more than `limit` (default 100) sales, the Sales Ledger page displays only the
    first 100 rows while the totals bar above it silently reflects all of them — a visible
    totals-vs-visible-rows mismatch, with no way for the user to reach or even know about the
    missing rows.
- [ ] **Recommended fix shape** (not implemented) — either wire `cursor`/`limit` into an actual
  SQL-level filter + `LIMIT` (matching the working pattern already used elsewhere in this same
  file — `get_ar_ledger` at `router.py:1047-1049` and `list_returns` at `router.py:3375-3378`,
  both of which correctly do `if cursor: q = q.filter(id_col < cursor)` followed by
  `q.limit(limit).all()`) and set `next_cursor` from the actual last row returned, or
  — if unbounded "load everything, no paging" is the deliberate intent for this endpoint —
  remove the `cursor`/`next_cursor` parameters and the misleading docstring/comment entirely so
  the contract matches reality. Either is a real decision to make, not made here.
- **Related, smaller gap in the same area**: `list_payments` (`GET /sales/payments`,
  `router.py:2765-2785`) has no `cursor`/`limit` parameters at all — `return q.all()` — unlike
  every sibling list endpoint in this file. Less severe than the above (no misleading
  docstring/contract, no totals-mismatch symptom, just unbounded), but flagged here as the same
  class of issue in the same file, in case a future pass wants to fix both together.

---

## RBAC severity triage — result of the "not yet triaged" item above (2026-07-09)

This is the triage the RBAC audit entry above flagged as future work — classifying the 32
backend-ungated actions and the mismatch patterns by what they actually touch (money,
inventory, customer data) versus genuinely low-stakes read/reference operations, so a future
remediation pass has a priority order instead of a flat list. **Nothing fixed here** — this is
risk classification only. Full file:line evidence for every item below is in the RBAC audit
entry above and the linked artifact (https://claude.ai/code/artifact/e33b961f-66f0-4365-a0a2-f539d7abbb94);
not repeated here.

**Methodology**: for each ungated action, checked whether it's a *genuine open door* (no
permission of any kind protects the underlying endpoint — any authenticated user, any role, can
call it) versus a *mismatch* (the endpoint IS protected, just by a different/broader action key
than the one that's supposed to represent it — a UI/semantics problem, not a security hole).
Severity is driven primarily by genuine open doors that touch money or the core sellable-item
record; mismatches are generally lower risk today because a real permission already sits behind
them, even if it's the wrong-named one.

### HIGH — genuine open door, touches money or the core sellable-item record

- [ ] **`confirm_costs`** (Stage 2 receiving, `procurement/router.py:636` — the real endpoint
  behind the phantom `confirm_shipment` action key) — zero permission check. Creates
  `cost_layers` (locked permanently at receipt per this codebase's own principle — never
  corrected after the fact) **and** a `supplier_invoices` row plus an `INVOICE` entry in
  `ap_ledger` — i.e. any authenticated user can currently create real, permanent AP liabilities
  and lock in COGS-driving cost data.
- [ ] **`receive_shipment` / `add_receiving_details`** (Stage 1 receiving, `procurement/router.py:504`
  and `:396` — real endpoints behind the phantom `receive_transfer` action key) — zero
  permission check. Physically moves stock into the active, sellable system.
- [x] **`add_variant` / `update_variant` / `delete_variant` — resolved (2026-07-10)**
  (`inventory/router.py:842,879,949` — part of the "backend looser than frontend implies"
  mismatch pattern, not one of the 32 action-key entries itself, but the single most consequential
  open door found this session). All three now require `require_permission("manage_products")`,
  matching `update_product`/`delete_product` exactly. Verified live with a temporary CASHIER user
  (no `manage_products`) — all three endpoints return `403`. See the "Variant deactivation
  hardening" entry below and `docs/changelog.md` (2026-07-10) for the full scope of this pass
  (also added audit logging and a reactivation path, beyond just the permission gate).

### MEDIUM — real open door with narrower blast radius, or a mismatch with real operational impact

- [ ] **`create_shipment`** (`procurement/router.py:362`) — zero check; precursor record to the
  HIGH-severity `confirm_costs` step above.
- [ ] **`manage_uoms`** (`create_uom`/`update_uom`/`delete_uom`, `inventory/router.py:189,202,216`)
  — zero check; UOM conversion factors indirectly feed quantity math on stock movements.
- [ ] **`update_location`** (`transfers_router.py:284`, asymmetric — `create_location` IS gated,
  this isn't) — zero check on editing where stock is tracked as living.
- [ ] **Variant sub-entity CRUD** (barcodes, UOM conversions, bundle components,
  variant-supplier links) — zero check; narrower than the variant record itself, but bundle
  components feed stock-explosion math and variant-supplier links carry cost data.
- [ ] **STORE_MANAGER / `manage_products` UI mismatch** — not a security hole (STORE_MANAGER
  gets a clean 403, can't actually complete the action), but a real operational-correctness
  problem: a legitimate STORE_MANAGER sees an enabled "+ New Product" button and a fully
  editable product/variant form that predictably fail on submit. MEDIUM for user-facing
  breakage, not for exposure.
- [ ] **`manage_payment_modes` mismatch** — dormant today (the real endpoint is protected by
  `manage_sales_settings`, which every role holding the visible tab also holds), but flagged
  higher than its sibling mismatches (`manage_shifts`, `manage_registers`) because payment-mode
  flags (`is_ar_charge`/`is_ar_credit`/`is_credit_memo`) directly drive real AR/credit-memo
  financial behavior — worth getting right deliberately if this mismatch class is ever
  remediated, rather than incidentally.

### LOW — read-only, cosmetic, low-stakes, or no backend surface exists to protect

- [ ] All ungated **`view_*`** reads (`view_inventory`, `view_transfers`, `view_receiving`,
  `view_stock_ledger`, `view_suppliers`, `view_purchase_orders`, `view_invoices`,
  `view_ap_payments`, `view_ap_ledger`) and the mismatched **`view_ap_aging`** — read-only, and
  each already sits behind its own **program**-level nav gate for page reachability.
- [ ] All ungated **`export_*`** actions (`export_sales`, `export_returns`, `export_products`,
  `export_stock_ledger`, `export_ap_ledger`, `export_ap_aging`, `export_customer_aging`,
  `export_ar_ledger`) — purely cosmetic; every export is client-side reformatting of data the
  user already has legitimate read access to via the underlying (program-gated) page.
- [ ] **`import_products`** — fully phantom; the real import endpoints use different, already-
  protected keys (`manage_products`/`manage_suppliers`/`manage_customers`).
- [ ] **`manage_shifts` / `manage_registers` / `manage_pdc` / `view_customer_aging` /
  `view_credit_memos` mismatches** — all dormant for the same reason as `manage_payment_modes`
  above (a real permission already protects the actual endpoint); listed LOW rather than MEDIUM
  because what they gate is lower-stakes than payment-mode configuration specifically.
- [ ] **`manage_categories`** — zero check, but categories are explicitly "UI filtering only...
  do not affect stock or costing logic" per `docs/requirements.md` §5.4.
- [ ] **`manage_import`** (intentionally retired, see the RBAC entry above) and
  **`manage_appearance`** (no backend surface by design — client-only feature) — no risk, not
  really "ungated" so much as correctly scoped to nothing.

### Suggested remediation order, if/when this is picked up

1. HIGH tier first — these are the only items where an unauthenticated-by-role user can move
   real money (AP) or change live customer-facing prices today.
2. MEDIUM tier next, `manage_payment_modes` prioritized within it given what it touches.
3. LOW tier — arguably fine to leave as-is long-term for the cosmetic export/view items; the
   mismatch entries in this tier are more about eventually cleaning up the action-key model's
   internal consistency than closing an actual exposure.

---

## Payment creation has no duplicate-submission protection — resolved (2026-07-10)

Found during a ground-truth verification pass on payment creation and payment modes ahead of
future redesign work (verification only, nothing implemented in that pass). Full evidence in
that pass's findings; summarized here for tracking.

- [x] **Resolved** — `record_customer_payment` and `create_payment` both gained a client-supplied
  `idempotency_key` (nullable, unique, same shape as `sales.sales.idempotency_key`), an upfront
  existing-record check, and an `IntegrityError` safety net for the race window (mirroring the
  `sale_pid` race fix). `post_draft`'s tender loop was investigated and confirmed to already be
  covered — a duplicate post on the same draft 404s before the loop is reached — no new mechanism
  needed there. The fourth path, the cash-refund branch inside `_do_return`, is covered
  transitively by `SalesReturn`'s own new idempotency key (see the entry below) rather than
  needing a separate key of its own. See `docs/changelog.md` (2026-07-10) for full detail and live
  verification evidence.
- [x] **Original gap (now fixed)** — none of the four places in the codebase that create a
  `CustomerPayment` row had any duplicate-submission protection — no idempotency key, no
  uniqueness constraint, no in-code "does this already exist" check:
  - `record_customer_payment` (`POST /sales/customers/{id}/payment`, `backend/sales/router.py:964`)
  - `create_payment` (`POST /sales/payments`, `router.py:2713`)
  - `post_draft`'s tender-creation loop (`router.py:2113`)
  - the cash-refund negative-payment branch inside `_do_return` (`router.py:3196-3230`) — a
    fourth creation path not previously catalogued this session; found during the same
    verification pass.
  - Confirmed absent at every layer: the `CustomerPayment` model (`backend/sales/models.py:223-254`)
    has no `idempotency_key` column at all; neither `CustomerPaymentCreate`
    (`backend/sales/schemas.py:419-424`) nor `RecordPaymentIn` (`schemas.py:468-478`) accepts one
    in the request payload; and a live-DB check of `sales.customer_payments` shows only the
    primary key as a constraint — no unique index on `reference_number` or any field
    combination.
  - **Contrast with the established pattern in this same codebase**: `Sale.idempotency_key`
    (`models.py:170`, `unique=True`) already solves exactly this problem for sale posting (and
    was the mechanism this session's `sale_pid` investigation relied on). Payments have no
    equivalent.
  - **Concrete failure mode**: a double-click, a network retry, or a resubmitted form on any of
    the four paths above can create two separate, fully-valid `CustomerPayment` rows for what
    was meant to be one transaction — each independently writing to `ar_ledger` and reducing
    `customer.outstanding_balance` a second time. Nothing detects or prevents this today.
- [x] **Fix shape used** — a client-supplied `idempotency_key` on `CustomerPayment`, mirroring
  `Sale`'s, applied to `record_customer_payment` and `create_payment` (the two paths that create
  a genuinely standalone payment row); the fourth path (`_do_return`'s cash-refund branch) is
  covered transitively via `SalesReturn`'s own new key instead of a fifth, redundant key on that
  specific `CustomerPayment` row. See `docs/changelog.md` (2026-07-10).
- Cross-reference: the same verification pass also corrected the payment-creation-path count
  from three to four, and produced a payment-modes ground-truth table (7 modes, which have
  special lifecycle handling and which don't) — not duplicated here; see that pass's findings
  for the full picture if this entry is picked up.

---

## The four-creation-paths finding — documentation correction (2026-07-10)

Found during the same ground-truth verification pass as the idempotency-gap entry above,
filed separately since it's a distinct, standalone finding (a correction to prior
documentation) rather than a security/correctness gap in itself.

- [x] **Finding, corrected** — `docs/customers_sales_process_flows.md` §3 ("Payment
  Lifecycle"), written earlier this session, documented exactly **three** places a
  `CustomerPayment` row gets created: `record_customer_payment` (`backend/sales/router.py:964`),
  `create_payment` (`router.py:2713`), and `post_draft`'s tender-creation loop (`router.py:2113`).
  A direct grep of every `models.CustomerPayment(` instantiation in the backend (done as part of
  the payment ground-truth verification pass) found a **fourth**: the cash-refund
  negative-payment branch inside `_do_return` (`router.py:3196-3230`), gated by
  `disposition == 'cash_refund' and sale_id is not None`. It creates a negative `CustomerPayment`
  (`amount = -grand_total`) tied to the largest non-AR tender originally applied to the sale,
  plus a matching negative `CustomerPaymentApplied` row — this is how a cash refund shows up in
  payment history. It has no dedicated `write_audit` call.
  - Unlike the other three, this path is never presented to the user as "creating a payment" —
    it's an implicit side effect of choosing the (default) cash-refund disposition when
    processing a return in `frontend/src/pages/sales/ReturnNew.tsx`, not a dedicated payment
    entry screen.
  - `docs/customers_sales_process_flows.md` §3.2 has been corrected in place to describe all
    four paths (renamed to "A third and fourth de-facto creation path", with a dated correction
    note at the top of that section); §5's audit-coverage table also got a clarifying note that
    `create_return`'s ✅ audit coverage is for the `sales_returns` row only, not this payment
    side-effect.
- Cross-reference: this fourth path is also cited as evidence in the "Payment creation has no
  duplicate-submission protection" entry above — not duplicated there, this entry is the
  documentation-correction record; that one is the security/correctness gap record.

---

## Cash-refund negative payment may inflate Customer Aging — unverified, not yet checked (2026-07-10)

Found during the payment ground-truth verification pass (`docs/payment_ground_truth.md` §2,
"Path 4"), specifically while confirming whether the fourth payment-creation path's ledger
accounting was correct. **This is a static-analysis observation, not a reproduced bug** — it
was explicitly not tested against live data in that pass. Filing it as a flagged, unverified
finding rather than a confirmed defect, so it doesn't get lost, but a future pass should
reproduce it live before treating it as real.

- [ ] **Observation** — the cash-refund branch inside `_do_return`
  (`backend/sales/router.py:3196-3230`) creates a negative `CustomerPaymentApplied` row
  (`amount_applied = -grand_total`, `:3226-3230`) against the original sale, as a deliberately
  ledger-silent historical record (this part is confirmed correct — see
  `docs/payment_ground_truth.md` §2 for the full reasoning on why it does *not* double-count
  against `ar_ledger`/`outstanding_balance`).
  - `get_ar_aging` (`backend/sales/router.py:388-542`, documented in
    `docs/customers_sales_process_flows.md` §1.5) computes each invoice's outstanding amount as:
    `ar_ledger SALE amount − Σ customer_payment_applied.amount_applied (WHERE mode.is_ar_charge
    = False) − Σ sales_returns.grand_total (WHERE disposition = 'credit_to_account' only)`.
  - The cash-refund's negative application row satisfies `is_ar_charge = False` (its payment
    mode is deliberately chosen to be non-AR-charge/non-AR-credit, per `:3197-3210`), so it
    **is** included in the `Σ customer_payment_applied.amount_applied` term. But `cash_refund`
    disposition is explicitly **excluded** from the `returns_credit` term (which only counts
    `credit_to_account`).
  - Net effect, if this holds up under live testing: for a sale with a linked `cash_refund`
    return, the aging calculation would subtract a *negative* number from itself in the
    payments-applied term — arithmetically **adding `grand_total` back** to that invoice's
    computed outstanding amount. A customer's Customer Aging report could show an inflated
    "amount owed" for an invoice that was actually already resolved via a cash refund.
  - The same summation pattern (`CustomerPaymentApplied` filtered to `is_ar_charge = False`)
    appears in `_build_customer_transaction_ledger` (`router.py:778-898`) as well — worth
    checking both, not just aging, if this is picked up.
- [ ] **Not yet reproduced against live data.** Recommended next step for a future pass:
  create a test sale paid via a non-AR-charge tender, process a linked `cash_refund` return
  against it, and check `GET /sales/customers/aging` for that invoice — confirm whether the
  outstanding amount shown matches expectations or is inflated by the returned amount.
- Cross-reference: `docs/payment_ground_truth.md` §2 has the full path-4 writeup this finding
  came from; `docs/customers_sales_process_flows.md` §1.5 documents `get_ar_aging`'s formula in
  detail.

---

## Returns processing — four gaps found in ground-truth pass, not yet remediated (2026-07-10)

Found during a full end-to-end verification pass on returns (`docs/returns_ground_truth.md`),
prompted by the fourth payment-creation path discovered inside `_do_return` the same day
(`docs/payment_ground_truth.md`). Verification only — nothing implemented at the time. Full
reasoning and file:line evidence for all four items is in `docs/returns_ground_truth.md`;
summarized here for tracking. *(Update 2026-07-10: the idempotency item below has since been
remediated, alongside the payment-idempotency backlog item above; the other three — bundle
returns, audit trail coverage, unconstrained `disposition` — remain open.)*

- [ ] **Bundle returns credit phantom stock to the bundle variant and never restore component
  stock/cost layers.** A bundle sale's `SaleItem` is recorded at the bundle-variant level with
  no `cost_layer_id` (`backend/sales/router.py:1987-1996`, `"revenue at bundle price, no cost
  data"`); `_do_return` has no bundle-explosion equivalent (`:3033-3232`, zero references to
  "bundle" anywhere in the function), so returning a bundle line writes `InventoryLedger
  RETURN_IN` and a `CurrentStock` increment directly against the bundle variant — which per
  `docs/requirements.md` §6.5 should never hold stock — while the actual component stock
  deducted at sale time is never restored. Confirmed reachable through the normal Return New
  page (`get_items_for_return` and `ReturnNew.tsx` both have zero bundle filtering).
- [x] **`SalesReturn` has no idempotency protection — resolved (2026-07-10)**. `SalesReturn`
  gained a client-supplied `idempotency_key` (nullable, unique, same shape as
  `Sale.idempotency_key`). `create_return` and `create_return_and_exchange` both check for an
  existing return by key before calling `_do_return`, so a duplicate "Process Return" submission
  now returns the original return (and, for the exchange path, its paired exchange sale) instead
  of reversing stock, restoring cost layers, writing a second `ArLedger` entry, or creating a
  duplicate cash-refund payment a second time. An `IntegrityError` safety net (mirroring the
  `sale_pid` race fix) covers the race window between that check and the insert. Verified live
  against the actual `cash_refund` disposition path: double-submitted an identical return twice,
  confirmed exactly one `sales_returns` row, one `RETURN_IN` ledger entry, and one negative
  cash-refund `CustomerPayment` (not two). See `docs/changelog.md` (2026-07-10).
- [ ] **Audit trail coverage for returns is nearly nonexistent** — of nine distinct writes
  triggered by processing a return (return header, line items, inventory ledger, cost-layer
  restoration, AR ledger entry, balance update, the cash-refund payment pair, and the exchange
  draft sale), only the return header itself (`sales.sales_returns`) gets a `write_audit` call
  (`create_return` `:3324`, `create_return_and_exchange` `:3295`). The other eight — including
  real financial mutations (AR ledger, balance, the refund payment) — have none.
- [ ] **`disposition` is unconstrained at the API layer** (`backend/sales/schemas.py:518`, plain
  `Optional[str]`, not an enum/`Literal`) — `_do_return` only recognizes `'cash_refund'` and
  `'credit_to_account'`; any other value or `None` silently produces a return with zero
  financial impact (stock reverses, no AR entry, no balance change, no payment, no credit
  memo). Not reachable via the current UI (which only ever sends one of the two valid values),
  but reachable via direct API use. Separately: `docs/schema.dbml:483`'s inline comment lists a
  third value, `credit_memo`, that was never actually implemented anywhere in code — confirmed
  stale against `docs/changelog.md`'s "2026-06-06" entry, which documents the column as having
  been added with exactly two values. Worth fixing the doc regardless of whether the validation
  gap itself is addressed.
- **Not a gap, confirmed correct**: the fourth payment path's own `ArLedger`/`outstanding_balance`
  accounting (§3 of `docs/returns_ground_truth.md`) does *not* repeat the
  `apply_unapplied_payment` double-counting bug — it's deliberately ledger-silent and correctly
  avoids a second, different failure mode that would have occurred had it reused the shared
  `_apply_and_update` helper with a negative amount. Noted here so this pass isn't
  mischaracterized as having found a fifth double-counting bug — it didn't.

---

## Variant deactivation hardening — implemented (2026-07-10)

Closes the `add_variant`/`update_variant`/`delete_variant` permission gap flagged HIGH severity
in the RBAC audit above, and brings the same trio up to this session's established standard for
destructive/corrective actions (permission gate, `write_audit` coverage, reversibility).

- [x] **Permission gates** — `add_variant`, `update_variant`, `delete_variant` all now require
  `require_permission("manage_products")`, matching `update_product`/`delete_product` exactly.
- [x] **Audit logging** — `update_variant` gained a `write_audit` call (previously had none at all
  for any field update); `delete_variant` gained one matching `delete_product`/`delete_supplier`'s
  old/new-value shape.
- [x] **Reactivation** — `VariantUpdate` gained `is_deleted: Optional[bool]`, folded into the
  existing PUT endpoint (not a new route), same convention as `SupplierPatch`/`patch_supplier`.
  `update_variant`'s lookup no longer filters on `is_deleted`, so a soft-deleted variant can be
  found and reactivated. A guard prevents setting `is_deleted=true` on the default variant through
  this endpoint, mirroring `delete_variant`'s existing check.
- [x] **UI gap found and closed**: the Sibling Variants panel on `Detail.tsx` filtered deactivated
  variants out of the list entirely — a reactivate control would have had nowhere to live. Added
  a "Show inactive" toggle, an "Inactive" badge, and a row action that swaps between a
  `confirm()`-gated deactivate `×` (matching the existing barcode/UOM/bundle/supplier-link row
  convention, now with a confirmation dialog since deactivating a whole variant is more
  consequential than those) and a "Reactivate" link. Errors (e.g. the default-variant rejection)
  surface in a dedicated red error box rather than an unhandled failure.
- All 7 requested checks verified live against the Docker stack, including a real browser
  (Playwright/Chromium) driving the actual UI — not just direct API calls — for the
  deactivate → toggle → reactivate round trip and the default-variant rejection's error display.
  See `docs/changelog.md` (2026-07-10) for full verification detail.
- Temporary Playwright driver scripts and verification screenshots (session scratchpad only,
  never part of the repo) were deleted after the report was delivered.

---

## Voids/Charge-payments/PDC verification pass — both gaps resolved (2026-07-11)

Found during a consolidated verification pass across voids, returns, charge payments, and PDC
payments (`docs/customers_section_verification.md`, 2026-07-10; verification only, nothing
implemented at the time). Both gaps below were fixed the next day — see
`docs/changelog.md` "2026-07-11 — Fix: balance_due corruption on reverse/bounce of is_ar_charge
payments; new PDC deposit→bounce transition" for the fix and full live verification evidence.
Returns findings from the same original pass are not duplicated here — see the "Returns
processing" entry above and `docs/returns_ground_truth.md` (now annotated: the idempotency item
there is fixed, the other three remain open).

- [x] **`reverse_payment` / `bounce_pdc_check` corrupt `sale.balance_due` for `is_ar_charge`
  tenders (Charge, PDC) — resolved (2026-07-11)**. Both endpoints restored a linked sale's
  `balance_due` via `sale.balance_due = (sale.balance_due or 0) + apply.amount_applied`,
  assuming the tender previously *reduced* `balance_due` at post time — true for standard
  tenders, **false** for `is_ar_charge`/`is_ar_credit` tenders (deliberately excluded from
  `standard_applied`). Live-reproduced pre-fix on a never-voided `Posted` sale: reversing a
  fully-Charge-tendered $100 sale's payment left `balance_due=200`. Fixed: both endpoints now
  compute `mode_reduces_balance = not (payment.payment_mode.is_ar_charge or
  payment.payment_mode.is_ar_credit)` once per payment and skip the restore loop when false.
  **Forward-direction guard added proactively**: `_apply_and_update` (shared by `create_payment`/
  `apply_unapplied_payment`) and `record_customer_payment` previously reduced `balance_due`
  unconditionally on *application* too — safe only because the frontend filters
  `is_ar_charge`/`is_ar_credit` out of the relevant dropdowns, not because the backend enforced
  it. All three now carry the same `mode_reduces_balance` guard, tested live via direct API call
  (these mode/endpoint combinations have no UI path) alongside a standard-mode regression check.
  See `docs/changelog.md` (2026-07-11) for the full fix and 7-point live verification.
- [x] **No `DEPOSITED → BOUNCED` transition exists for PDC checks — resolved (2026-07-11)**.
  `deposit_pdc_check` and `bounce_pdc_check` both required `check_status == 'IN_VAULT'`, so a
  deposited check could never be marked bounced — foreclosing the realistic real-world sequence
  (a check bounces *after* being deposited/submitted to the bank). Fixed: `bounce_pdc_check`'s
  precondition relaxed to `check_status in ('IN_VAULT', 'DEPOSITED')`, reusing the same
  (now-corrected) reversal logic — confirmed safe since `deposit_pdc_check` only ever changes
  `check_status`/`payment_date`, nothing ledger- or balance-related. Live-verified: created a PDC
  payment, deposited it, bounced it — correct end state for `balance_due` (unchanged, not
  doubled), `ArLedger` (correctly zero rows), and `outstanding_balance` (unchanged), with full
  `write_audit` coverage across creation/deposit/bounce.
- [x] **Void-guard added (new, not originally filed as a separate item)**: `deposit_pdc_check`
  and `bounce_pdc_check` now reject with `400` if any sale the payment is applied to has
  `status == "Voided"` — closing the PDC-void interaction gap from
  `docs/customers_section_verification.md` §1.3. Live-verified: voided a PDC-tendered sale, then
  confirmed both deposit and bounce attempts on its check are rejected.
- **Confirmed unaffected / re-verified, not gaps**: void_sale's single- and multi-tender
  AR/stock reversal (`docs/customers_sales_process_flows.md` §2.3); `deposit_pdc_check`'s
  ledger math (genuinely nothing to under/over-count, not just "runs without error"); Charge
  payment creation, Transaction Ledger accounting, and audit coverage; the 2026-07-09
  `bounce_pdc_check` fix itself (still correct on the ledger-reading side — the new gap above is
  a distinct bug in the same function's `balance_due` restore step, not a regression).
- **Doc corrections**: `void_sale`'s audit coverage in `docs/customers_sales_process_flows.md`
  §5.2 was a bare ✅ — corrected to note it covers the `sales.sales` header row only, same shape
  as the returns gap. `docs/returns_ground_truth.md` §3 annotated in place: its documented
  `SalesReturn` idempotency gap was fixed the same day it was written (see "Duplicate-submission
  protection" entry above) — left unedited as historical record, marked superseded.
- **Cleanup attempted (2026-07-11)**: `customer.has_bounced_check` (stale from an earlier
  verification pass, customer 3) cleared via the proper `clear-bounced-flag` endpoint. The
  `balance_due=200` values already written to sales 75/76/77 by the pre-fix bug, and payment
  91's `DEPOSITED` status (set before the void-guard existed), could **not** be cleaned up —
  `reverse_payment`/`bounce_pdc_check` correctly refuse to act twice on an already-reversed/
  bounced payment, and no endpoint resets a sale's `balance_due` independently of the
  payment-application lifecycle. These remain as permanent, understood historical evidence of
  the pre-fix bug — the fix prevents recurrence, it does not retroactively repair these rows.

---

## Pool payment, then assign to transactions — implemented (2026-07-11)

Designed in `docs/payment_pooling_proposal.md` (built on `docs/payment_pooling_verification.md`'s
confirmed facts about `apply_unapplied_payment`, the AR-ledger picker source, and `create_payment`'s
zero frontend callers), decisions finalized in that doc's §10, implemented the same day. Full
details and live verification evidence in `docs/changelog.md` "2026-07-11 — Feature: pool payment,
then assign to transactions (customer payments)".

- [x] **`get_customer_ar_ledger_view` bridge-table fix — implemented (2026-07-11)**. Was reading
  `sale.balance_due` directly, stale relative to `credit_to_account` returns (which never touch
  that column). Now derives the same way `get_ar_aging` does. Live-verified against a fresh test
  return, and incidentally surfaced/fixed the same staleness already present in existing seed data
  from an earlier session's return, not just the newly-created test case.
- [x] **`create_payment` made atomic-and-correct — implemented (2026-07-11)**. Accounting fix (one
  full-amount `ArLedger` row instead of one per application, `outstanding_balance` reduced by the
  full amount immediately — matching `record_customer_payment`'s convention), PDC field support
  added, and the split-commit audit gap fixed (see the "create_payment split-commit" entry above,
  now marked resolved with a cross-reference to this work). Live-verified: single ledger row,
  correct balance drop, no double-count on a later `apply_unapplied_payment` call against the same
  payment's remaining pool, and full rollback (zero trace) on a forced mid-loop failure.
- [x] **`CustomerDetail.tsx` receipt-picker UI — implemented (2026-07-11)**. New section in the
  Record Payment modal: oldest-first default allocation, manual per-row override, "Select All /
  Apply to All Open Receipts" shortcut, running Applied/Remaining total, "Load more receipts" for
  customers with more than 200 open receipts, single-call submission via the newly-fixed
  `create_payment`. Playwright-verified end to end (default allocation, manual edit, select-all,
  submit, success banner) with zero browser console errors.
- **Decided, not a gap**: `CustomerARLedger.tsx`'s single-sale "Receive Payment" flow and
  `Workstation.tsx`'s POS tender loop were both explicitly left unchanged per the proposal's
  recommendation (§7, §E) — Playwright-confirmed both still work exactly as before.
- **Cleanup**: three test payments reversed via `POST /sales/payments/{id}/reverse`. One test
  `credit_to_account` return (₱600, clearly labeled in its `reason` field as a verification test)
  could **not** be cleaned up — no return-void/cancel endpoint exists in this codebase — and
  remains as a permanent, understood record, same pattern as the `balance_due=200`/payment-91
  cleanup limitations noted in the entry above. The temporary `test_pooling_verify` account used
  for API/browser verification was deactivated via `PATCH /auth/users/{id}/active`.

---

## `payments_by_sale_id` bridge-table gap — found and resolved same-day (2026-07-11)

**Not a pre-existing tracked item** — this gap was undiscovered until the return-reversal
investigation below traced the same query pattern for a different reason and found it right next
to the bug it was actually looking for. Filing and closing in the same entry since it was found,
fixed, and verified in a single pass; full detail and live evidence in
`docs/changelog.md` "2026-07-11 — Feature: sales return reversal mechanism".

- [x] **`get_ar_aging`/`get_customer_ar_ledger_view`'s `payments_by_sale_id` `SUM` never excluded
  reversed or bounced payments — resolved (2026-07-11)**. Filtered `PaymentMode.is_ar_charge ==
  False` but had no `CustomerPayment.reversed_at`/`check_status` filter at all, so a payment
  reversed via the already-live `POST /sales/payments/{id}/reverse`, or bounced via
  `bounce_pdc_check`, was still counted toward a sale's derived outstanding balance forever. Fixed
  by adding `CustomerPayment.reversed_at.is_(None)` and a NULL-safe `check_status != 'BOUNCED'`
  filter (`check_status` is nullable, only ever set for PDC payments — a bare `!=` would have
  silently excluded every non-PDC payment too under standard SQL `NULL` semantics; verified this
  precisely against live data — 104 real non-PDC payments would have been wrongly dropped by the
  naive form). Live-verified: reversing a normal payment flips its sale from `Paid`/`0.00` to
  `Open`/full balance in both bridge-table views.

---

## Sales return reversal mechanism — implemented (2026-07-11)

Designed in `docs/return_reversal_proposal.md` (built on the already-live `void_sale`/
`reverse_payment` precedent and a fresh investigation into what a return actually does across
inventory, cost layers, AR ledger, and the cash-refund payment path), decisions finalized in that
doc's §10, implemented the same day. Full details and live verification evidence in
`docs/changelog.md` "2026-07-11 — Feature: sales return reversal mechanism".

- [x] **`POST /sales/returns/{return_id}/reverse` — implemented (2026-07-11)**. Full reversal
  only, origin-agnostic (negates the actual `InventoryLedger`/`ArLedger` rows tagged to the
  return, same technique as `void_sale`/`reverse_payment`), single atomic transaction,
  `write_audit` with both `old_values`/`new_values` before the one commit. Confirmed live: exact
  restoration of stock/cost-layers/AR-ledger/`outstanding_balance` for a normal
  `credit_to_account` return; correct handling of the cash-refund `CustomerPayment` (path 4) via
  direct flag-flipping rather than reusing `reverse_payment` (confirmed reuse would have corrupted
  `sale.balance_due` — see `docs/return_reversal_proposal.md` §4.1); safe reversal of a return that
  hit the known bundle phantom-stock bug without needing that bug fixed first (component stock
  correctly left untouched, phantom bundle-variant stock correctly negated).
- [x] **Exchange-linked returns excluded from v1, with state-specific error messages —
  implemented (2026-07-11)**. Reuses `_attach_exchange`'s existing derivation as the reversal
  precondition — no new tracking. Live-verified both branches (`Draft` → "delete the draft first",
  `Posted` → "void it first") plus the unblock path (void the exchange, return becomes reversible).
- [x] **`reverse_return` permission — implemented (2026-07-11)**. New dedicated action, granted to
  `ADMIN` + `STORE_MANAGER` only, not `CASHIER` — confirmed `CASHIER` already holds
  `process_returns`, so reusing it for reversal would have been a bigger privilege inversion than
  the one `reverse_customer_payment` was already introduced to prevent on the payment side.
  Live-verified: `CASHIER` test account rejected with 403, `STORE_MANAGER` test account passed the
  permission gate.
- [x] **Bundled bridge-table fix** — see the `payments_by_sale_id` entry directly above, plus the
  matching `returns_by_sale_id` `reversed_at` filter (both `get_ar_aging` and
  `get_customer_ar_ledger_view`), shipped in the same pass per this proposal's §10 decision 2.
- **DB migration**: `sales.sales_returns` gains `reversed_at`/`reversed_reason`/
  `reversed_by_user_id`, mirroring `sales.customer_payments`'s existing three columns. No boolean
  flag, no enum migrations (`ArLedger.reason='ADJUSTMENT'` and `InventoryLedger.reason=
  'RETURN_OUT'` both already existed).
- **Cleanup**: all test returns reversed via the new endpoint; test sales voided via `void_sale`;
  temporary test accounts deactivated via `PATCH /auth/users/{id}/active`. One honest residual,
  **not** attributable to this work: after the full verification sequence, customer 2's
  `outstanding_balance` sat ₱200 below its pre-session baseline. **Correction**: originally
  attributed here to voiding a sale after its payment had already been reversed
  (`reverse_payment` → `void_sale`) — a dedicated follow-up investigation (see "Void-after-reversal
  investigation" entry below) proved that ordering nets to *exactly* zero and found the real cause
  instead: two other sales in the same cleanup pass were voided standalone with no payment ever
  reversed, each correctly leaving its own documented -₱100 credit (`void_sale`'s intended
  behavior, not a bug), summing to -₱200. The bundle-variant
  phantom `current_stocks` row created during check 5 remains at quantity `0` — correctly zeroed,
  not deleted, matching this schema's "never hard-delete" convention; this is the correct end
  state, not a cleanup gap.

---

## Void-after-reversal investigation → reverse_payment missing void-guard — found and fixed (2026-07-11)

Prompted by the unverified hypothesis in the return-reversal entry above (now corrected there).
Investigated precisely rather than assumed; disproved the original hypothesis and found a
different, real, narrower bug instead. Full trace, live evidence for every ordering tested, and
the fix are in `docs/changelog.md` "2026-07-11 — Fix: reverse_payment on an already-voided sale
left it contradictorily stateful".

- [x] **Disproved: `reverse_payment` → `void_sale` does NOT double-restore `balance_due`**.
  `void_sale` never touches `sale.balance_due` and never loops over `CustomerPaymentApplied` — a
  flat, unconditional `ArLedger ADJUSTMENT` for `-grand_total`, structurally incapable of the
  hypothesized per-application double-count. Live-verified for both a standard tender
  (`reverse_payment` → `void_sale`) and a PDC tender (`bounce_pdc_check` → `void_sale`): both net
  `outstanding_balance` to *exactly* zero delta.
- [x] **Confirmed and fixed: `void_sale` → `reverse_payment` (reverse order) left the sale
  contradictorily stateful — resolved (2026-07-11)**. `reverse_payment` had no check on the linked
  sale's status, unlike `deposit_pdc_check`/`bounce_pdc_check`, which both already call
  `_reject_if_linked_to_voided_sale` (`router.py:1252-1269`) for this exact reason. Live-reproduced
  pre-fix: a Voided sale ended up `balance_due=150.00`/`Unpaid` after its payment was reversed
  post-void. `outstanding_balance` itself nets correctly regardless of order — this is a
  `Sale`-record data-integrity bug, not a financial-ledger bug. Fixed by adding the same guard
  call `reverse_payment` was missing (same root pattern as this session's two earlier
  `mode_reduces_balance` fixes: check whether the thing being restored was already
  restored/reversed before restoring it again — a different pair of operations each time).
  Live-verified: rejects with `400` pre-mutation (sale/payment state completely untouched by the
  rejected call); normal `Posted`-sale case and the forward reverse-then-void order both unchanged.
- **Cleanup**: three sales (94, 96, 97) remain permanently in the contradictory state from this
  investigation and its fix's own pre-fix reproduction — no proper action exists to reset
  `balance_due` on an already-Voided sale (confirmed by checking every write site in
  `router.py`; the fix just shipped closes the one path that could have). Left as permanent
  historical evidence, same treatment as the earlier `balance_due=200` rows from the
  `mode_reduces_balance` fix. Temporary test accounts deactivated via
  `PATCH /auth/users/{id}/active`.

---

## PDC deposit as the collection event — implemented (2026-07-12)

Designed in `docs/pdc_deposit_collection_proposal.md` (built on the verification pass that first
confirmed deposit never marked anything collected), decisions finalized in that doc's §6,
implemented the same session. Full details and live verification evidence in
`docs/changelog.md` "2026-07-12 — Feature: PDC deposit as the collection event".

- [x] **`deposit_pdc_check` now writes the collection effect — implemented (2026-07-12)**. One
  `ArLedger` `PAYMENT` row, `outstanding_balance` reduction, `balance_due`/`payment_status`
  reduction per linked sale — same shape a standard tender writes at post time, deferred to
  deposit for PDC. Audit call upgraded to a real `old_values`/`new_values` snapshot. Live-verified
  end to end, including the Customer Transaction Ledger reflecting the sale as `Paid`.
- [x] **`bounce_pdc_check`/`reverse_payment` — origin-agnostic restore, both fixed together —
  implemented (2026-07-12)**. Both replaced a static `mode_reduces_balance` mode-flag with
  `any(e.reason == "PAYMENT" for e in ledger_entries)`, reusing the already-fetched ledger rows —
  no mode-based conditional anywhere. Confirmed correct for every mode via live tests: standard
  tender restores, `AR_CREDIT` correctly does not, PDC-from-`IN_VAULT` correctly no-ops,
  PDC-from-`DEPOSITED` correctly restores through *either* endpoint (`reverse_payment` had no
  PDC-specific rejection and was already reachable on a deposited check — bundled per the
  proposal's decision 3, not shipped as a follow-up).
- [x] **One-time backfill — implemented (2026-07-12)**. New idempotent `main.py` seeder,
  `_backfill_pdc_deposit_collection()`, re-deriving the proposal's four-part filter fresh on every
  startup rather than a hardcoded ID. Live data: of 7 `DEPOSITED` PDC payments, exactly 1 (payment
  95, ₱50.00) matched and was corrected; the other 6 were correctly left untouched (four already
  correct from before the PDC payment mode's `is_ar_charge` flag was set, one already `Paid` via
  that same pre-existing mechanism, one already `Voided` and independently closed out). Confirmed
  idempotent across a second startup.
- [x] **`_build_customer_transaction_ledger` fix — found live during verification, fixed same
  pass (2026-07-12)**. Named in the proposal's own §1 problem statement but not addressed by its
  §3 design — a third function with the identical static `is_ar_charge` exclusion, so a deposited
  PDC sale showed collected on the `Sale` row but still `"Unpaid"` in the Transaction Ledger.
  Confirmed with the user before fixing (outside the originally approved plan). Extended
  `collection_rows`' filter to also count a `DEPOSITED` PDC payment as a collection; a still-
  `IN_VAULT` one still correctly does not.
- **Found, flagged, not fixed — pre-existing, unrelated gap in `reverse_payment`'s `AR_CREDIT`
  handling.** Surfaced by this work's own regression test (reversing a Store Credit payment):
  `reverse_payment`'s `ArLedger`-negation loop (untouched by this proposal) adds back the full
  reversed amount to `outstanding_balance` regardless of `reason`, but `post_draft` deliberately
  never folds an `AR_CREDIT` row's amount into `outstanding_balance` in the first place (only the
  `SALE` row's own formula does — "the SALE entry offset against existing credit handles the net
  balance"). Reversing an `AR_CREDIT` payment therefore adds back money never separately counted.
  Different code path than anything this proposal changed; likely never exercised before since
  `reverse_payment` had zero callers prior to this session. Left a ₱40 residual on a real seed
  customer (test-caused, could not be cleaned up via any proper action — no endpoint adjusts
  `outstanding_balance` directly) — documented in `docs/changelog.md`, not investigated further.
- **Cleanup**: test payments reversed/bounced and test sales voided via proper endpoints; temporary
  test accounts deactivated via `PATCH /auth/users/{id}/active`. Payment 95 stays fixed (a real
  correction, not test data). The ₱40 `AR_CREDIT` residual above is the one exception, documented
  rather than force-corrected.

---

## Still out of scope (do not implement until explicitly instructed)

- Reporting and analytics layer
- Shift management and register open/close reconciliation
- UOM conversion enforcement on stock movements (conversions are reference data only)
