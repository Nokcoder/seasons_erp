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

- [ ] **Alembic URL encoding bug** — `alembic/env.py:34`: replace raw `db_password` with `safe_password` (already computed via `quote_plus`) in `DATABASE_URL`. Passwords with special characters currently break migrations silently.
- [ ] **`InvoiceOut.shipment_id` nullable mismatch** — `ap/schemas.py`: change `shipment_id: int` to `Optional[int]` to match the nullable column in the `SupplierInvoice` model. Currently, any invoice created without a shipment link fails schema validation on the response.
- [ ] **`_consume_fifo` pre-flight check** — before consuming cost layers, verify `current_stocks.quantity >= requested quantity`. If layers and stock ever drift out of sync due to a failed partial transaction, the FIFO check currently passes while stock goes negative.
- [ ] **Login attempt not logged for deactivated accounts** — `auth/router.py:112–113`: write a `LoginAttempt` record (with `success=False`) before returning 403 when `is_active = False`. Requirements §4.1 requires all failed attempts to be recorded regardless of reason.

---

## Batch 2 — Receiving correctness
> Most consequential bug group. All four items touch `confirm_shipment` — do in one transaction block.

- [ ] **`quantity_rejected` ignored on receive** — `procurement/router.py:329`: change `qty = detail.quantity_actual` to `qty = detail.quantity_actual - detail.quantity_rejected`. Rejected units must be routed to the Quarantine virtual location via a separate `RECEIVE` ledger entry. Currently, full `quantity_actual` enters active stock and `quantity_rejected` is stored but never acted on.
- [ ] **Non-Inventory/Service product guard** — check `product.product_type` before writing to `inventory_ledger`, `current_stocks`, and `cost_layers` in both `confirm_shipment` and `create_transfer`. `Non-Inventory` and `Service` variants must never generate ledger entries (Requirements §6.1).
- [ ] **Auto-invoice creation on receive** — `confirm_shipment` must create a `SupplierInvoice` record in the same transaction, with `total_amount = quantity_declared × unit_cost` from the receiving detail. Due date = `invoice_date + supplier.terms days`. Requirements §9.1.
- [ ] **Expose `received_at` and `inspected_at`** — add both fields to `ReceivingDetailCreate`, `ReceivingDetailOut`, and the `add_receiving_details` router. Currently both are always stored as NULL despite being in the model.

---

## Batch 3 — Transfer and PO correctness

- [ ] **ADJUST ledger reason** — `inventory/transfers_router.py`: detect when either `from_location` or `to_location` is the Adjustment virtual location and write `ADJUST` as the ledger reason instead of `TRANSFER_OUT`/`TRANSFER_IN`. The `ADJUST` enum value currently exists but is dead code (Requirements §9.4).
- [ ] **PO lifecycle enforcement** — `procurement/router.py:195–210`: enforce valid transitions only: `Draft → Open → Partially_Received → Closed | Cancelled`. Reject any other transition with HTTP 400. Currently any status value is accepted silently, including `Closed → Draft`.

---

## Batch 4 — AP completeness

- [ ] **`_recalculate_invoice_status` uses wrong amount** — `ap/router.py:55`: when `amended_amount` is set, compare `total_applied` against `amended_amount` instead of `total_amount`. Currently payments are marked Paid against the wrong figure whenever an amendment exists (Requirements §10.1).
- [ ] **Expose `amended_amount` and `amendment_notes` in `InvoiceOut`** — both fields are in the model but absent from the response schema.
- [ ] **`PATCH /ap/invoices/{id}` amendment endpoint** — new endpoint to set `amended_amount` and `amendment_notes` on an existing invoice. Requirements §10.1.
- [ ] **`POST /ap/ledger` manual entry endpoint** — allow manual `CREDIT_MEMO` and `ADJUSTMENT` entries. Required for supplier return recoveries and free replacement stock scenarios (Requirements §9.3, §10.4).

---

## Batch 5 — Missing endpoints

- [ ] **UOM CRUD** — `GET /products/uoms`, `POST /products/uoms`, `PATCH /products/uoms/{id}`
- [ ] **Category CRUD** — `GET /products/categories`, `POST /products/categories`, `PATCH /products/categories/{id}`
- [ ] **`GET /products/variants/{id}` standalone** — with price NULL fallback: if `variant.price` is NULL, return price from the sibling variant where `is_default = true` (Requirements §6.2).
- [ ] **`GET /products/variants/{id}/stock`** — return stock levels for a variant across all locations, excluding virtual locations (Requirements §9.7).
- [ ] **`GET /transfers/locations/{id}`** — single location detail endpoint.
- [ ] **`PUT /procurement/orders/{id}/items/{item_id}`** — update a PO line item (Requirements §8.2).
- [ ] **User management endpoints** — deactivate user, change roles, change password (Requirements §4.1).

---

## Batch 6 — Stubs
> Do last. JWT touches every route; audit log touches every write.

- [ ] **JWT enforcement** — replace the stub in `auth/dependencies.py:get_current_user()` with real JWT decoding. Apply `require_permission()` to all protected routes across all modules. Currently only one endpoint uses it and it checks roles on the wrong user entirely.
- [ ] **Audit log writes** — write an `audit_log` record on every significant INSERT, UPDATE, and DELETE across all modules. `old_values` and `new_values` as JSONB. Records are immutable — never update or delete them (Requirements §4.3).

---

## Out of scope (do not implement until v2 schema is issued)

- Sales module
- Customer returns module
- Full RMA workflow
- Reporting and analytics layer
- Bulk Excel import
- Settings module (registers, shifts, payment methods)
