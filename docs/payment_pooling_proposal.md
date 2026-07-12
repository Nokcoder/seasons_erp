# Proposal: Pool Payment, Then Assign to Transactions

Status: **design only — not implemented**. Written for review against `backend/sales/router.py`,
`backend/sales/models.py`, `backend/sales/schemas.py`, `frontend/src/pages/customers/CustomerDetail.tsx`,
`frontend/src/pages/customers/CustomerARLedger.tsx`, `frontend/src/services/api.ts` as of
2026-07-11. Builds directly on the facts established in `docs/payment_pooling_verification.md` —
those are not re-derived here.

## 1. Problem

Two screens create customer payments today, and neither lets a user "pool then split":

- **`CustomerDetail.tsx` → "Record Payment"** calls `record_customer_payment`
  (`POST /sales/customers/{customer_id}/payment`) with no `sale_id`. This pools the entire amount
  (`unapplied_amount = payload.amount`) but has no UI path to ever tie it to a sale afterward.
- **`CustomerARLedger.tsx` → "Receive Payment"** calls the same endpoint but always passes exactly
  one `sale_id` (the row the user clicked), pre-filled with that row's `balance_due`. It can only
  ever pay one invoice per submission.

Neither screen can do "customer hands over ₱10,000, split it across their 3 oldest open
invoices in one action." The verification doc confirmed the two building blocks for that already
exist (`record_customer_payment` pools; `apply_unapplied_payment` assigns, repeatably) — this
proposal designs how they come together into one user-facing action, and fixes two problems the
verification pass surfaced that block doing that safely.

## 2. What the verification pass changes about this design (must read before §3+)

Two things from `docs/payment_pooling_verification.md` aren't just background — they reshape the
design directly:

### 2.1 The picker's data source is confirmed stale — this is a blocking dependency, not parallel work

`get_customer_ar_ledger_view` (`GET /sales/customers/ar-ledger`) is the confirmed correct *shape*
for a receipt picker (`customer_id` filter, `sale_id`, `sale_pid`, `balance_due`, `status`). But it
computes `balance_due` by reading `sale.balance_due` directly (`router.py:599`) instead of deriving
it fresh, unlike its sibling `get_ar_aging`, whose docstring says outright: *"Bridge-table
calculation (never reads sale.balance_due)"* (`router.py:397`).

This isn't a cosmetic inconsistency. `sale.balance_due` is provably not updated by every code path
that changes what a customer actually owes on an invoice: a `credit_to_account` return
(`router.py:3298`) adjusts `customer.outstanding_balance` but never touches `sale.balance_due` —
confirmed by grepping every `sale.balance_due =` assignment site in `router.py`; the return-disposition
handler isn't one of them. `get_ar_aging` accounts for this by subtracting
`SUM(sales_returns.grand_total WHERE disposition='credit_to_account')` per sale
(`router.py:494-503`); `get_customer_ar_ledger_view` does not. So today, a sale that's been
partially credited via a return can show a `balance_due` on the AR ledger view that's higher than
what the customer actually owes.

**Consequence for this design:** a payment-application picker built on that endpoint could let a
user apply payment against an amount that's already partly settled by a return, silently
overpaying/misapplying. **Fixing `get_customer_ar_ledger_view` to use the same bridge-table
derivation as `get_ar_aging`** (principal from `ar_ledger` SALE rows, minus non-AR-charge
`customer_payment_applied`, minus `credit_to_account` returns — the exact pattern at
`router.py:417-522`) **is a hard prerequisite, not optional cleanup.** It must land before or as
part of this flow, not as a follow-up ticket. It also fixes the same staleness for
`CustomerARLedger.tsx`'s existing table (today's users of that page are already looking at
potentially-wrong `balance_due`/`status` values) — one fix, two beneficiaries.

This is a backend-only, response-shape-compatible fix: same `CustomerARLedgerRowOut` fields, same
route, just correct arithmetic. No schema or frontend contract change.

### 2.2 A design decision the verification pass forces me to make explicitly, not leave implicit

`apply_unapplied_payment` is confirmed safe for **repeated sequential calls** against one
`payment_id` (fresh read + commit each call), but has **no row lock**, so two calls racing against
the same `payment_id` could both read the same `unapplied_amount` and over-apply. The naive version
of "select several receipts, call this once per receipt" would call it N times from the frontend —
sequentially (safe, simpler, one round trip per receipt) or in parallel (faster, but reopens the
exact race the verification doc flagged).

§4 below resolves this by *not* making the new flow call `apply_unapplied_payment` at all — see
§4.3. That sidesteps the concurrency question for this feature rather than answering it with a
locking change, but §4.3 states explicitly what that means for the endpoint's other, standalone use.

## 3. Endpoint shape

**No new route.** `POST /sales/payments` (`create_payment`, `CustomerPaymentCreate` body) already
has the exact shape this flow needs — one `CustomerPayment` plus a
`List[{sale_id, amount_applied}]` of `applications`, applied in a loop, inside one transaction,
one `db.commit()` (`router.py:2746-2863`). This is the composite "pool + assign N" endpoint the
design goals ask for; it already exists, and per the verification doc it currently has **zero
frontend callers** — so there is no regression risk in changing its internals. See §5 for why it
can't be used *as-is* and what has to change first.

### Request — extend `CustomerPaymentCreate` to field-parity with `RecordPaymentIn`

Today `CustomerPaymentCreate` (`schemas.py:419-425`) is missing everything both existing "Record
Payment" modals already collect except amount/mode/reference:

```python
class CustomerPaymentCreate(BaseModel):
    customer_id: Optional[int] = None
    payment_mode_id: int
    amount: Decimal
    reference_number: Optional[str] = None
    idempotency_key: Optional[str] = None
    applications: List[PaymentApplicationIn] = []   # sale_id, amount_applied — already exists

    # NEW — bring to parity with RecordPaymentIn (schemas.py:470-483)
    payment_date: Optional[datetime] = None
    collection_receipt_no: Optional[str] = None
    notes: Optional[str] = None
    check_number: Optional[str] = None   # PDC — required when mode.is_pdc
    check_date: Optional[date] = None
    bank_name: Optional[str] = None
```

`PaymentApplicationIn` (`schemas.py:413-416`, `{sale_id, amount_applied}`) is already identical in
shape to `ManualPaymentApplyIn` — no change needed there.

### Response

Unchanged — `schemas.CustomerPaymentOut`, already includes `.applications[]` and
`.unapplied_amount`, which is everything the frontend needs to render a post-submit summary.

## 4. The atomicity decision (design goal 4)

### 4.1 Option A — full end-to-end atomicity via the fixed `create_payment` (recommended)

One `POST /sales/payments` call, one transaction, one commit. The frontend computes the proposed
`applications` array client-side (§6), the user reviews/edits it, and submission is a single
request. If any application fails validation (stale `balance_due`, sale not `Posted`, etc.) the
**whole transaction rolls back** — no payment row, no partial applications, nothing to reconcile.
The user sees one error and retries against refreshed data.

**Why recommended:** this project's own conventions already treat "financial write + its
consequences" as one atomic unit — `CLAUDE.md`'s stock-movement rule (`inventory_ledger` +
`current_stocks` "in the same transaction") is the same principle applied to a different subsystem,
and every reversal mechanism surveyed in `docs/payment_correction_proposal.md` (§2 there) is
all-or-nothing, never partial. A payment silently half-applied across receipts — with the cashier
unsure which of 5 receipts actually got paid — is a worse failure mode here than in most flows,
because it's money, it's customer-facing, and untangling it later means correcting individual
`CustomerPaymentApplied` rows by hand (no reversal endpoint exists for a single application, only
for a whole payment — see `docs/payment_correction_proposal.md` §7).

### 4.2 Option B — orchestrate the two existing endpoints, accept partial completion

Frontend calls `record_customer_payment` with no `sale_id` (pools, already atomic, zero backend
changes), then loops `POST /sales/payments/{id}/apply` once per selected receipt, sequentially.
Cheaper to build (no `create_payment` fixes needed), but a failure on receipt 3 of 5 leaves a real
payment on file, 2 receipts paid, 3 still open, and the UI must honestly report a mixed
success/failure result and let the user decide whether to retry the remainder — a materially worse
support/reconciliation story for a cash-handling flow, for a saving that's mostly backend-side.

### 4.3 Recommendation: Option A. This also resolves §2.2's concurrency question by construction.

Because all application happens server-side, inside the loop `create_payment` already has, within
one transaction, there is no concurrent (or even sequential multi-request) calling of
`apply_unapplied_payment` in this flow's critical path **at all**. The race the verification doc
flagged for that endpoint simply doesn't arise here.

`apply_unapplied_payment` itself is untouched by this proposal and keeps its current, verified
behavior: safe for sequential repeated calls, no row lock against concurrent ones. It remains
available for its own standalone use — e.g., a manager applying more of an already-pooled, already
existing credit to a new invoice next week, a genuinely time-separated action, not a rapid
multi-call burst. **Explicit decision: do not add locking to `apply_unapplied_payment` as part of
this work.** It's a real gap only if something calls it concurrently/automatedly in the future
(e.g. a bulk "auto-apply all pools" job, which nothing here proposes); flagging it as a known,
low-priority latent limitation rather than in-scope.

## 5. Required fixes before `create_payment` can be reused (not optional — part of this proposal)

Beyond the field-parity additions in §3, `create_payment`'s accounting **must change** to match
`record_customer_payment`'s convention, or the two screens will silently disagree about what a
customer's `outstanding_balance` means the moment a payment is only partially applied.

**Current `create_payment` behavior:** writes one `ArLedger` `PAYMENT` row *per application*
(via `_apply_and_update`'s default `ledger_amount=amount_to_apply`), and reduces
`customer.outstanding_balance` by `total_applied` only (`router.py:2832-2843`). A ₱10,000 payment
with ₱6,000 applied leaves `outstanding_balance` reduced by only ₱6,000 — the ₱4,000 sitting in
`unapplied_amount` is, at that moment, **not reflected anywhere as collected**, even though the
customer handed over the full ₱10,000. `record_customer_payment` doesn't have this gap: it always
writes one `ArLedger` row for the *full* `payload.amount` and reduces `outstanding_balance` by the
full amount, regardless of application (`router.py:1019-1030`) — `apply_unapplied_payment`'s own
code comment (`router.py:2944-2952`) confirms this is deliberate: *"record_customer_payment writes
one ArLedger entry for the FULL payment amount at creation regardless of application... so a
payment's unapplied remainder can already be 'paid for' in the ledger before this endpoint ever
runs."*

**The fix**, so `create_payment`-originated payments reconcile correctly with
`apply_unapplied_payment`'s existing `already_reduced`/`already_applied`/`surplus` math
(`router.py:2953-2967`) exactly the way `record_customer_payment`-originated ones already do:

1. In `create_payment`'s application loop, call `_apply_and_update` with `ledger_amount=Decimal("0")`
   explicitly — suppress the per-application `ArLedger` write. `CustomerPaymentApplied` rows and
   `sale.balance_due`/`payment_status` updates still happen exactly as today; only the ledger write
   moves.
2. After the loop, write **one** `ArLedger` row: `amount_change=-payload.amount`,
   `reason="PAYMENT"`, `reference_type="customer_payments"`, `reference_id=str(payment.payment_id)`
   — identical shape to `record_customer_payment`'s write (`router.py:1019-1026`).
3. Change `customer.outstanding_balance -= total_applied` to `customer.outstanding_balance -=
   payload.amount` (full amount).

I checked this doesn't break `apply_unapplied_payment`'s later reconciliation for a
`create_payment`-originated payment: with the fix, `already_reduced` (from the single full-amount
ledger row) equals `-payload.amount`, and `already_applied` (from `CustomerPaymentApplied` rows,
unaffected by the ledger-write change) equals `total_applied`. `surplus = max(0, payload.amount -
total_applied)` — exactly the unapplied remainder, same shape `record_customer_payment`'s path
already produces. Without this fix (i.e., naively adding the full-amount row on top of the
existing per-application rows instead of replacing them), `surplus` would double-count and cause
`apply_unapplied_payment` to silently under-post the ledger on a later call — confirmed by working
through the arithmetic, not left as an assumption.

4. Add the same PDC handling `record_customer_payment` has (`router.py:967-972`, `985-989`):
   require `check_number`/`check_date`/`bank_name` when `mode.is_pdc`, set `check_status='IN_VAULT'`.

None of this needs a DB migration — every column involved (`unapplied_amount`, PDC fields,
`idempotency_key`) already exists on `sales.customer_payments`; this is a Pydantic schema + router
logic change only.

## 6. Sequence / flow (`CustomerDetail.tsx`)

1. User clicks **Record Payment**. Modal opens with today's fields (date, mode, amount, reference,
   receipt no., notes, PDC fields when applicable) — unchanged.
2. New: once mode + amount are entered, fetch
   `salesApi.customerArLedger.list({ customer_id: cid, status: ['Open','Partial','Overdue'] })` —
   the now-fixed `get_customer_ar_ledger_view` (§2.1), already sorted `transaction_date ASC` i.e.
   oldest-first (`router.py:571-575`), so no separate sort step is needed.
3. **Default allocation, computed client-side, no backend involvement:** walk the sorted receipt
   list oldest→newest, greedily filling each row's `balance_due` from the entered payment amount
   until either the amount is exhausted or the list ends. Render each candidate row with an
   editable `amount_applied` and a running **Unapplied / Remaining** total. This is pure frontend
   UX state — the backend accepts whatever final `applications` array is submitted; it does not
   need its own auto-allocation logic.
4. User may edit any row's amount (clamped to that row's `balance_due` and to the remaining pool),
   deselect a row (amount → 0, dropped from the payload), or select additional/different rows —
   full manual override per design goal 2. Selecting zero rows leaves `applications: []`, which is
   already valid on `create_payment` today (design goal 3 — no schema change needed for this case).
5. Submit → **one** `POST /sales/payments` call:
   ```json
   {
     "customer_id": 123, "payment_mode_id": 4, "amount": 10000,
     "payment_date": "...", "reference_number": "...", "collection_receipt_no": "...",
     "notes": "...", "idempotency_key": "...",
     "applications": [
       { "sale_id": 501, "amount_applied": 4000 },
       { "sale_id": 507, "amount_applied": 6000 }
     ]
   }
   ```
6. Backend: create payment, loop applications (apply + per-sale `balance_due`/`payment_status`
   update, no per-application ledger write per §5), write one full-amount `ArLedger` row, reduce
   `outstanding_balance` by the full amount, single `db.commit()`, `write_audit()`.
7. Frontend gets back `CustomerPaymentOut`; invalidate `customer`, `customerTransactionLedger`,
   `customers`, and the AR ledger query keys; show a summary ("₱10,000 received — ₱10,000 applied
   across 2 receipts" or "...— ₱4,000 left unapplied").

**Permission note, not a design decision:** the picker fetch in step 2 requires `view_ar_ledger`,
while the modal itself is gated on `manage_customers` (`CustomerDetail.tsx:44`). Today's only role
with `manage_customers` (`STORE_MANAGER`) already also has `view_ar_ledger`
(`main.py:406-408`), so this isn't a live gap — just something to keep true if a new role is ever
granted `manage_customers` without `view_ar_ledger`.

## 7. `CustomerARLedger.tsx` — recommend: leave as single-sale, no upgrade

Its whole premise is "user clicked **Receive Payment** on one specific invoice row" — the amount
field is pre-filled from that row's `balance_due` and the flow is already atomic today
(`record_customer_payment` with a `sale_id` is one function, one transaction, one commit). Turning
it into a multi-select picker would just rebuild the new `CustomerDetail.tsx` flow a second time
with a different entry point, for no behavioral gain — a user who wants to split one payment
across several invoices already has that flow on the Customer Detail page.

Once §5's fix lands, `record_customer_payment` and the fixed `create_payment` produce *identical*
accounting for the single-application case (one full-amount `ArLedger` row, full-amount
`outstanding_balance` reduction, one `CustomerPaymentApplied` row). So this isn't "two divergent
recipes to maintain" — it's one recipe with two entry points, one of which (`record_customer_payment`)
happens to already be correct and working. **No change to `CustomerARLedger.tsx` or the endpoint
it calls.**

## 8. `create_payment` recommendation — do not deprecate

The brief for this proposal asked me to flag deprecate-vs-dead-code explicitly, so: **the opposite
call is correct here.** `create_payment` has zero callers today only because no screen was ever
built against it — its shape (atomic pool + N-application loop, single transaction) is exactly
what this feature needs, and per §4.3 it's what makes full atomicity free instead of requiring a
new endpoint. Recommendation: fix it per §5, extend its schema per §3, and make it the backing
endpoint for `CustomerDetail.tsx`'s new flow. Removing it would mean building a near-duplicate
endpoint from scratch for this feature; keeping it as unfixed dead code would leave a
known-inconsistent accounting path sitting in the codebase indefinitely. Fix-and-adopt is strictly
better than either.

## 9. Summary of required changes

| Area | Change | Migration? |
|---|---|---|
| `get_customer_ar_ledger_view` | Bridge-table `balance_due` derivation, matching `get_ar_aging` | No — logic only |
| `CustomerPaymentCreate` schema | Add `payment_date`, `collection_receipt_no`, `notes`, PDC fields | No — Pydantic only |
| `create_payment` | Suppress per-application ledger write; write one full-amount `ArLedger` row; reduce `outstanding_balance` by full amount; add PDC validation | No — router logic only |
| `CustomerDetail.tsx` | New receipt-picker section in Record Payment modal, client-side oldest-first default allocation with manual override, submit via `POST /sales/payments` | Frontend only |
| `CustomerARLedger.tsx` | **No change** | — |
| `apply_unapplied_payment` | **No change** — not called by this flow; locking gap explicitly deferred (§4.3) | — |

## 10. Open questions for you

1. §5's `create_payment` accounting fix changes behavior on an endpoint that, while currently
   uncalled from the frontend, is still a public API route — any objection to changing it in place
   rather than versioning it?

   **Decided:** change in place, no versioning — conditional on a caller-safety check that has now
   been run. Searched the entire repo (not just `frontend/src`) for any reference to
   `POST /sales/payments` / `create_payment` outside `backend/sales/router.py` itself: scripts,
   tests, cron jobs, Postman/HTTP collections, CI config, and docs. There is no automated test
   suite in this project (per `CLAUDE.md`) and no scripts/cron directory referencing the endpoint.
   Every non-implementation match is documentation (`docs/*.md`, `docs/requirements.md`,
   `docs/schema.dbml`) or the unrelated `POST /sales/payments/{id}/reverse` and
   `POST /sales/payments/{id}/apply` routes (different endpoints, not affected by this change) and
   their own Alembic migration/schema references. No external caller found — clean to change in
   place.

2. Is `status: ['Open','Partial','Overdue']` the right default filter for the picker (excluding
   `Paid`), or should `Overdue` receipts be visually distinguished/prioritized in the default
   allocation beyond just being oldest (and therefore usually already sorted first anyway)?

   **Decided:** filter stays `Open`/`Partial`/`Overdue`, sorted oldest-first, with no separate
   allocation-priority logic layered on top of that sort — oldest-first already puts most overdue
   receipts first in practice, and a second priority axis would just be a tie-breaker most of the
   time for extra complexity. Add a visual badge/indicator on `Overdue` rows specifically in the
   picker (matching the existing `Overdue` badge treatment already used elsewhere, e.g.
   `CustomerARLedger.tsx`'s status badges) so overdue receipts are still visually called out even
   though they don't get separate allocation-order logic.

3. Any cap on how many receipts a single payment can be split across, or is "however many are
   `Open`/`Partial`/`Overdue` for this customer" fine as an unbounded list (page/scroll if long)?

   **Decided:** no hard cap — unbounded list, with scroll/pagination in the picker UI for
   customers with many open receipts (consistent with this codebase's existing "Load More" /
   cursor-pagination convention elsewhere, e.g. `CustomerDetail.tsx`'s transaction ledger and
   returns sections). Add a **"select all" / "apply to all open receipts"** shortcut that runs the
   same oldest-first greedy allocation across the full filtered list in one step, rather than
   requiring the user to manually build up the `applications` array row by row when they intend to
   clear everything.

4. Confirm §4 (Option A, full atomicity) over §4.2 (Option B, partial-completion) — this is the
   one decision in this doc with a real cost trade-off (backend fix work now vs. weaker guarantees
   later), so flagging it as the one to actively confirm rather than assume.

   **Decided:** Option A (full atomicity via the fixed `create_payment`), confirmed.
