# Season ERP — Sales Module Work Order
**Created:** 2026-05-29
**Status:** Complete — all 12 batches verified live 2026-05-29
**Prerequisite:** Backend v1 backlog (`/docs/backlog.md`) fully complete.

---

## How to use this file

- Work through batches in order. Complete and confirm each batch before starting the next.
- Mark items `[x]` as they are completed.
- After each batch, update `/docs/changelog.md` with what changed.
- Wait for confirmation before moving to the next batch.
- Do not run any git commands.

---

## Batch 1 — Models and migrations
> Build all SQLAlchemy models and ensure tables are created on startup. No router logic yet.

- [x] **`sales/models.py`** — create models for: `PaymentMode`, `CashRegister`, `Customer`, `ArLedger`, `Sale`, `SaleItem`, `CustomerPayment`, `CustomerPaymentApplied`, `SalesReturn`, `SalesReturnItem`, `SupplierReturn`, `SupplierReturnItem`
- [x] **`main.py`** — mount the sales schema; ensure `create_all()` creates all new tables on startup
- [x] **`sales/schemas.py`** — create Pydantic schemas for all models: `...Create`, `...Out`, and any patch schemas needed
- [x] **Verify** — `Shift` model added; `shift_id` and `origin_sale_id` columns added to `Sale`; all schemas updated. App must be started with Docker to confirm table creation in the database.

---

## Batch 2 — Sales settings endpoints
> Simple CRUD. No business logic dependencies.

- [x] **`GET /sales/payment-modes`** — list all payment modes
- [x] **`POST /sales/payment-modes`** — create a payment mode
- [x] **`PATCH /sales/payment-modes/{id}`** — update or deactivate (`is_active = false`)
- [x] **`GET /sales/registers`** — list all registers
- [x] **`POST /sales/registers`** — create a register; validate `location_id` exists and is Active
- [x] **`PATCH /sales/registers/{id}`** — update or deactivate (`is_active = false`)
- [x] **`GET /sales/shifts`** — list all shifts
- [x] **`POST /sales/shifts`** — create a shift
- [x] **`PATCH /sales/shifts/{id}`** — update or deactivate a shift

---

## Batch 3 — Customer endpoints
> Master data. No sale logic yet.

- [x] **`GET /sales/customers`** — list customers; support search by name; exclude `is_deleted`
- [x] **`POST /sales/customers`** — create a customer; set `outstanding_balance = 0`
- [x] **`GET /sales/customers/{id}`** — get customer detail
- [x] **`PATCH /sales/customers/{id}`** — update customer fields
- [x] **`DELETE /sales/customers/{id}`** — soft-delete (`is_deleted = true`); reject if customer has unpaid balance

---

## Batch 4 — POS catalog endpoint
> Read-only. Powers local caching on the frontend.

- [x] **`GET /products/pos-catalog`** — return all active products and variants with: `variant_id`, `PID`, barcodes, `price`, `promo_price` (takes precedence if set), `attributes`, `variant_name`, `product_name`, and `current_stocks` per location
- [x] Price resolution: if `variant.price` is NULL, return price from the sibling variant where `is_default = true`
- [x] Exclude `is_deleted` products, variants, and `Inactive` products
- [x] Exclude stock quantities for virtual locations (Quarantine, Adjustment)

---

## Batch 5 — Draft sale lifecycle
> The parking/cart functionality. No stock movement yet.

- [x] **`POST /sales/drafts`** — create a draft sale with `status = 'Draft'`. No `sale_pid` assigned. No stock deducted. No ledger written. Accepts: `location_id`, `register_id`, `customer_id` (optional), `employee_id`, `idempotency_key`, and line items (`variant_id`, `quantity`, `unit_price`).
- [x] **`GET /sales/drafts`** — list open drafts; support filter by `location_id` and `register_id`
- [x] **`GET /sales/drafts/{id}`** — get a single draft with line items
- [x] **`PATCH /sales/drafts/{id}`** — update line items, customer, or header fields
- [x] **`DELETE /sales/drafts/{id}`** — soft-delete a draft (`status = 'Voided'`). No stock or ledger impact.

---

## Batch 6 — Posting a sale
> The most critical endpoint. All logic runs in one transaction.

- [x] **`POST /sales/drafts/{id}/post`** — convert draft to Posted sale. Full transaction:
  1. Idempotency check — if a Posted sale with the same `idempotency_key` exists, return it without reprocessing
  2. Credit limit check — for credit customers: reject with HTTP 400 if `outstanding_balance + grand_total > credit_limit`
  3. Non-Inventory/Service guard — skip ledger entries for those product types
  4. Bundle explosion — explode bundle variants into components before stock deduction
  5. FIFO consumption — consume cost layers at `sale.location_id` oldest-first per variant; pre-flight check against `current_stocks` first
  6. Write `sale_items` — one row per FIFO layer split, with cost snapshot (`gross_cost`, `supplier_discount`, `net_unit_cost`) copied from the layer
  7. Write `inventory_ledger` with reason `SALE` (negative `qty_change`) per variant; update `current_stocks` — same transaction
  8. Calculate totals: `subtotal_amount`, `grand_total`, `balance_due`, `due_date` (credit customers only), `audit_variance`
  9. Apply tendered payments: create `customer_payments` and `customer_payment_applied` rows; recalculate `balance_due` and `payment_status`
  10. Write `ar_ledger` with reason `SALE` and `amount_change = grand_total`
  11. Update `customer.outstanding_balance` transactionally
  12. Assign `sale_pid`, set `status = 'Posted'`, set `posted_at = now()`, and stamp `transaction_date`
- [x] **Response** — return full posted sale with line items collapsed to one display line per variant

---

## Batch 7 — Reading sales

- [x] **`GET /sales`** — list posted and voided sales; support filter by `date_range`, `location_id`, `employee_id`, `customer_id`, `payment_status`
- [x] **`GET /sales/{id}`** — get a single sale; line items collapsed to one per variant for display
- [x] **`GET /sales/{id}/items`** — raw `sale_items` rows including FIFO layer splits; for audit and COGS queries

---

## Batch 8 — Voiding a sale

- [x] **`POST /sales/{id}/void`** — void a posted sale. Requires `void_reason`. Full transaction:
  1. Reject if `status` is already `Voided`
  2. Reverse stock: write `inventory_ledger` with reason `RETURN_IN` per variant; update `current_stocks`
  3. Restore FIFO layers: increment `quantity_remaining` on consumed layers in reverse order
  4. Write `ar_ledger` with reason `ADJUSTMENT` and `amount_change = -grand_total`
  5. Update `customer.outstanding_balance` transactionally
  6. Set `status = 'Voided'`, record `voided_at` and `void_reason`
  7. Do not delete payment records — record reversal entries instead

---

## Batch 9 — Customer payments

- [x] **`POST /sales/payments`** — record a payment and apply to one or more sales. Full transaction:
  1. Create `customer_payments` record
  2. For each sale in the application list: create `customer_payment_applied`, recalculate `sales.balance_due` and `sales.payment_status`
  3. Set `customer_payments.unapplied_amount` to any remainder
  4. Write `ar_ledger` with reason `PAYMENT` and `amount_change = -amount_applied` per sale
  5. Update `customer.outstanding_balance` transactionally
- [x] **`GET /sales/payments`** — list payments; filter by `customer_id` and date range
- [x] **`GET /sales/payments/{id}`** — get a single payment with application detail
- [x] **`POST /sales/payments/{id}/apply`** — manually apply unapplied credit to a sale; requires `manage_payments` permission (not available to floor cashier role)

---

## Batch 10 — Sales returns

- [x] **`POST /sales/returns`** — create a return. Full transaction:
  1. Role check: if `sale_id` is omitted (blind return), caller must have `process_blind_returns` permission
  2. Resolve `location_id`: default to original sale's `location_id` if `sale_id` provided; required field if blind return
  3. Write `inventory_ledger` with reason `RETURN_IN` per item; update `current_stocks`
  4. Restore `cost_layer.quantity_remaining` for the referenced layer
  5. Write `ar_ledger` with reason `RETURN` and `amount_change = -grand_total`
  6. Update `customer.outstanding_balance` transactionally
  7. Assign `return_pid` (e.g. `RET-00045`)
  8. If this return is part of an exchange, set `origin_sale_id` on the new exchange sale
- [x] **`GET /sales/returns`** — list returns; filter by `sale_id`, `customer_id`, date range
- [x] **`GET /sales/returns/{id}`** — get a single return with line items

---

## Batch 11 — Supplier returns (sales module additions)

> Supplier return models were created in Batch 1. This batch adds the procurement-side endpoints.

- [x] **`POST /procurement/supplier-returns`** — create a supplier return in `Draft` status; validate stock exists in Quarantine location
- [x] **`PATCH /procurement/supplier-returns/{id}/status`** — advance status: `Draft → Shipped → Credit_Received`
  - On `Shipped`: write `inventory_ledger` with reason `RETURN_OUT` from Quarantine; update `current_stocks`
  - On `Credit_Received`: write `ap_ledger` with reason `CREDIT_MEMO`
- [x] **`GET /procurement/supplier-returns`** — list supplier returns
- [x] **`GET /procurement/supplier-returns/{id}`** — get detail with line items

---

## Batch 12 — Auth and audit wiring for sales module

- [x] Apply `require_permission()` guards to all sales write endpoints — refer to the role/permission map in `auth/dependencies.py`
- [x] Write `audit_log` entries on: sale posted, sale voided, return created, payment recorded
- [x] Ensure `process_blind_returns` permission exists in the permission map and is assigned to appropriate roles

---

## Out of scope — do not build until instructed

- Reporting and analytics
- UOM conversion enforcement on sales
- Bulk import
- Full RMA workflow
- Shift management and register open/close reconciliation
