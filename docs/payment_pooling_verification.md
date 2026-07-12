# Payment Pooling — Fact Verification

Verified directly against current code (not session memory) on 2026-07-11.

## 1. `apply_unapplied_payment` — signature, behavior, repeatability

**Location:** `backend/sales/router.py:2900` — `POST /sales/payments/{payment_id}/apply`

**Signature:**
```python
def apply_unapplied_payment(
    payment_id: int,
    payload: schemas.ManualPaymentApplyIn,   # { sale_id: int, amount_applied: Decimal }
    db: Session = Depends(get_db),
    _actor: AuthUser = Depends(require_permission("manage_customers")),
) -> schemas.CustomerPaymentOut
```
(`ManualPaymentApplyIn` — `backend/sales/schemas.py:464-467` — has exactly two fields: `sale_id`, `amount_applied`.)

**Behavior, per call:**
1. Loads the payment fresh via `_load_payment(payment_id, db)`.
2. Reads `payment.unapplied_amount` (a persisted column, `sales.customer_payments.unapplied_amount`, `Numeric(15,2)`, default 0 — `backend/sales/models.py:237`) as the remaining pool.
3. Rejects if `amount_applied <= 0` or `amount_applied > unapplied` (400).
4. Validates the target sale exists, is `Posted`, and has `balance_due > 0` (400 otherwise).
5. Caps the amount at the sale's `balance_due`.
6. Applies it (`_apply_and_update`), decrements `payment.unapplied_amount -= amount_applied`, adjusts the customer's `outstanding_balance`, and **commits**.

**Verdict — yes, confirmed repeatable:** `unapplied_amount` is a real DB column that is read fresh at the top of each call and persisted via `db.commit()` at the end. Nothing about the endpoint restricts it to a single use — it can be called N times against the same `payment_id`, each time naming a different `sale_id`, and each call will:
- see the pool reduced by the prior call(s),
- reject once the pool is exhausted (`amount_applied > unapplied` → 400),
- reject if less than the full requested amount remains but the caller doesn't lower the ask (no partial-fill — it's all-or-400 on the pool check, though the *sale* side is capped/partial via `balance_due`).

So: **one call per sale, repeated against the same `payment_id`, sequentially splitting the pooled amount across several sales, is exactly what this endpoint already supports as written.** No new endpoint or signature change would be needed for that pattern.

One caveat worth flagging for the design phase (not a signature issue, just a behavioral note): there's no locking/idempotency-key protection on this endpoint (unlike `create_payment`, which does check `idempotency_key`), so two concurrent calls against the same `payment_id` could both read the same stale `unapplied_amount` and over-apply before either commits. Sequential calls (the use case asked about) are unaffected.

## 2. Endpoint(s) for "this customer's open/unpaid receipts to choose from"

Two candidate endpoints exist. **Neither is named `get_ar_aging` for this purpose alone — there are two, and one fits much better than the other.**

### `GET /sales/customers/aging` — `get_ar_aging` (`backend/sales/router.py:389`)
- Params: `search: Optional[str]` only — **no `customer_id` filter**, only a name-substring `search`.
- Returns `List[AgingRowOut]`, one row per outstanding invoice, fields:
  `customer_id, customer_name, invoice_id (=sale_id), invoice_date, due_date, current_amt, days_1_30, days_31_60, days_61_90, days_91_plus`.
- No `sale_pid` (user-facing document/receipt number) — only the internal `sale_id` as `invoice_id`.
- No single "outstanding amount" field — it's pre-bucketed into aging columns; a caller would have to sum the 5 bucket columns to get the open balance.
- Purpose per its own docstring: an aging **report** (bucketed by days overdue), not a picker feed.
- **Not sufficient as-is** for a "pick a receipt" UI: can't filter by `customer_id` directly, no document number, no single balance field, no status label.

### `GET /sales/customers/ar-ledger` — `get_customer_ar_ledger_view` (`backend/sales/router.py:546`)
- Params: `customer_id, date_from, date_to, status[], search, limit, cursor` — **does support `customer_id` filtering**.
- Permission: `view_ar_ledger` (different from `manage_customers` on the aging/apply endpoints).
- Returns `List[CustomerARLedgerRowOut]`, one row per Posted sale with a customer, fields:
  `sale_id, sale_pid, customer_id, customer_name, transaction_date, due_date, grand_total, balance_due, status ("Open"|"Partial"|"Paid"|"Overdue")`.
- Has the real document number (`sale_pid`), a direct `balance_due`, and a `status` the UI can filter/badge on (e.g. request `status=["Open","Partial","Overdue"]` to get exactly the unpaid set).
- **This is the endpoint that's actually sufficient as-is** for "show this customer's open/unpaid receipts to choose from" — it already gives `sale_id` (to pass as `ManualPaymentApplyIn.sale_id`), `sale_pid` (to display), and `balance_due`/`status` (to filter/display), scoped to one customer via `customer_id`.

**Verdict:** use `/sales/customers/ar-ledger?customer_id=...&status=Open&status=Partial&status=Overdue` for the picker, not `/sales/customers/aging`. The aging endpoint remains useful for the bucketed-aging report use case but would need a `customer_id` param and a document number added before it could serve a receipt-picker.

## 3. `create_payment` frontend callers — re-confirmed zero

**Location:** `backend/sales/router.py:2746` — `POST /sales/payments`, body `schemas.CustomerPaymentCreate`.

Searched `frontend/src` for any reference to `CustomerPaymentCreate`, `/sales/payments` (POST), `payments/${...}` apply calls, and `ManualPaymentApply`. Findings:
- `frontend/src/services/api.ts:658` — `GET /sales/customers/${id}/payments` (list, not create).
- `frontend/src/services/api.ts:742` — `GET /sales/customers/ar-ledger/${saleId}/payments` (list, not create).
- `frontend/src/services/api.ts:1641-1644` — `/ap/payments` (a different module — AP payments, not sales `create_payment`).
- No match anywhere for a POST to `/sales/payments` or `/sales/payments/{id}/apply`.

**Verdict — still holds:** `create_payment` (and `apply_unapplied_payment`) have **zero callers in the frontend**. `api.ts` has no wrapper function for either endpoint, and no page/component calls them directly. Nothing has changed on this since it was last checked this session.
