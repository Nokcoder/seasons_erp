# Proposal: Correction Mechanism for Standalone Customer Payments

Status: **design only — not implemented**. Written for review against `backend/sales/router.py`,
`backend/sales/models.py`, `backend/sales/schemas.py`, `backend/main.py` as of the payment-audit-gap
fix (2026-07-08).

## 1. Problem

`record_customer_payment` (`POST /sales/customers/{customer_id}/payment`) and `create_payment`
(`POST /sales/payments`) can create a `CustomerPayment` with a wrong amount, wrong mode, or wrong
reference — and there is no way to correct it. Unlike sales (`POST /sales/{id}/void`) or PDC checks
(`PATCH /sales/pdc/{id}/bounce`), payments have no reversal path. A miskeyed payment sits in the
ledger and in `customer.outstanding_balance` permanently.

## 2. Precedent survey (what the codebase already does)

| Endpoint | Reversal style | Permission | Partial support | Preserves original row |
|---|---|---|---|---|
| `POST /sales/{id}/void` | Full only. Writes one `ArLedger` `ADJUSTMENT` row for `-grand_total`; stock/FIFO/credit-memo redemptions reversed; sale flagged `status='Voided'`, `voided_at`, `void_reason` | `process_sale` (same as posting — no dedicated void permission) | No | Yes — sale row and its payments kept as-is |
| `PATCH /sales/pdc/{id}/bounce` | Full only. Reverses **every** `CustomerPaymentApplied` for that payment: writes offsetting `ArLedger` `PAYMENT` rows per affected sale, restores each sale's `balance_due`/`payment_status`, bumps `customer.outstanding_balance`, flags `check_status='BOUNCED'` | `manage_customers` (same as recording a payment) | No | Yes — payment row and applications kept, only `check_status` changes |
| `issue_credit_memo` / `cancel_credit_memo` | Two **separate** action keys for create vs. reverse, even though both are currently granted to the same roles | Split by design | N/A | Yes |

Takeaways I'm designing against:
- **Every reversal in this codebase is full, never partial.** There is no precedent anywhere for
  shrinking an amount in place.
- **Reversals never delete.** They add offsetting ledger rows and flip a status/timestamp field on
  the original record.
- **Permission convention is inconsistent.** Sale-void and PDC-bounce just reuse the create-time
  permission. Credit memos deliberately split issue/cancel into two action keys, even without
  using that split yet. No endpoint anywhere implements a maker-checker/approval step — that
  pattern doesn't exist in this codebase (only `ap.supplier_invoices.vetting_status`, which is an
  unrelated AP workflow, not a generic approval mechanism).
- **`bounce_pdc_check`'s per-application reversal loop is the closest existing analogue** to what a
  payment-correction endpoint needs to do, more so than `void_sale` (which reverses a whole sale,
  not a single payment).

## 3. A discovered inconsistency that shapes the design

`record_customer_payment` and `create_payment` both create a `CustomerPayment`, but they update
`customer.outstanding_balance` differently:

- `record_customer_payment`: reduces `outstanding_balance` by the **full** `payload.amount`,
  regardless of whether it was applied to a sale (router.py:987-989). Writes one `ArLedger` row,
  reason `PAYMENT`, `amount_change = -payload.amount` (router.py:978-985).
- `create_payment`: reduces `outstanding_balance` by `total_applied` only — the sum of amounts
  actually applied to sales (router.py:2672-2675). **It never writes an `ArLedger` row for the
  payment itself at all** — only `_apply_and_update` (called per application) does, presumably
  inside that helper.

Rather than re-deriving "how much should a reversal undo" from these two different creation
recipes (and risking drift if either recipe changes later, or if a future third creation path is
added), the reversal endpoint should be **origin-agnostic**: read the actual `auth.audit_log`-adjacent
source of truth — the `ArLedger` rows already tagged `reference_type='customer_payments'`,
`reference_id=str(payment_id)` — and negate exactly those. This also means the same endpoint can
safely reverse a tender-payment created inside `post_draft`'s loop (which writes its own `ArLedger`
row per tender, per the just-completed audit fix) without needing separate logic per origin.

This makes the mechanism correct by construction: it undoes whatever the ledger says this payment
actually did, not what a particular code path is supposed to have done.

## 4. Scope boundary: what this endpoint does NOT cover

- **Credit-Memo-mode payments are excluded (v1).** `CreditMemoRedemption` is keyed by `sale_id`,
  not `payment_id` — there's no reliable way to trace a redemption back to the specific payment
  being reversed if a sale had multiple credit-memo tenders. Reversing the `ArLedger`/balance
  impact while leaving the memo permanently `REDEEMED` would be a silent correctness gap, not a
  fix. The endpoint should reject with 400 if `payment.payment_mode.is_credit_memo`. Restoring a
  wrongly-redeemed memo remains a manual/separate fix until `CreditMemoRedemption` gets a
  `payment_id` column.
- **Already-bounced PDC payments are excluded.** `bounce_pdc_check` already performs a full
  reversal of a PDC payment's AR/balance impact. Running this endpoint afterward would double
  reverse. Reject with 400 if `check_status == 'BOUNCED'`.
- **Voided sales' tender-payments don't need this endpoint** — `void_sale` already reverses the
  whole sale (all tenders included) in one clean sweep and explicitly preserves payment rows as
  history. This endpoint is for correcting a payment on its own, not for re-voiding an
  already-voided sale.
- **No partial correction.** See §7.

## 5. Proposed endpoint

```
POST /sales/payments/{payment_id}/reverse
```

Chosen over nesting under `/customers/{customer_id}/payments/{payment_id}/reverse` because the
payment is already uniquely addressable by `payment_id` alone (see `GET/PATCH` on `/pdc/{payment_id}`
for precedent — PDC endpoints don't nest under customer either).

### Request

```python
class PaymentReversalRequest(BaseModel):
    reversal_reason: str   # required, non-empty — mirrors SaleVoidRequest.void_reason
```

### Response

`schemas.CustomerPaymentOut`, extended with three new nullable fields (see §6) so the frontend can
show reversal state directly on the existing payment record — no new response schema needed.

### Preconditions (400 if violated)

1. Payment exists (404 if not).
2. `payment.reversed_at is None` — not already reversed.
3. `payment.check_status != 'BOUNCED'`.
4. `not payment.payment_mode.is_credit_memo`.

### Transaction body (single `db.commit()`, `write_audit()` folded in before it — per the
atomicity requirement this whole fix line of work is about)

1. Snapshot `old_values = _serialize(payment)` before any mutation (for the audit row).
2. Query `ArLedger` where `reference_type='customer_payments' AND reference_id=str(payment_id)`.
   For each row found, `db.add()` an offsetting `ArLedger` row:
   `reason='ADJUSTMENT'`, `amount_change=-row.amount_change`,
   `reference_type='customer_payments'`, `reference_id=str(payment_id)`,
   `notes=f"Reversal of payment #{payment_id} ({row.reason}): {reversal_reason}"`.
   Accumulate `total_delta = sum(-row.amount_change for row in rows)`.
3. If `payment.customer_id`: `customer.outstanding_balance += total_delta`.
4. For each `CustomerPaymentApplied` row where `payment_id == this payment` (0, 1, or many —
   handles both `record_customer_payment`'s single optional `sale_id` and `create_payment`'s
   multi-sale `applications`): reload the sale, `sale.balance_due += apply.amount_applied`,
   recompute `payment_status` with the same three-branch logic `bounce_pdc_check` already uses
   (`>= grand_total → Unpaid`, `> 0 → Partial`, else `Paid`). **Do not delete the
   `CustomerPaymentApplied` row** — it stays as the historical record of what was originally
   applied, exactly as `bounce_pdc_check` leaves it.
5. Flag the payment header: `reversed_at = now()`, `reversed_reason = reversal_reason`,
   `reversed_by_user_id = _actor.user_id`.
6. `write_audit(db, "sales.customer_payments", str(payment_id), "UPDATE", actor_user_id=_actor.user_id, old_values=old_values, new_values=_serialize(payment))` — called **before** `db.commit()`, not after, so audit and reversal land in the same transaction (this is the exact defect the parent fix just closed for creation; a new endpoint must not reintroduce it).

   Note: this is the first call site in `sales/router.py` to actually populate `old_values` — every
   existing `write_audit()` call only passes `new_values`. `old_values` is already part of the
   function signature and the `audit_log` schema; using it here isn't a new pattern, just the first
   use of an existing, unused parameter. For a correction feature specifically, capturing the
   pre-reversal `amount`/`reference_number` alongside the reversal reason is the difference between
   "we know it got reversed" and "we know what it was corrected from."
7. `db.commit()`.

## 6. DB changes

Three new nullable columns on `sales.customer_payments`, mirroring the naming already used on
`sales.sales` (`voided_at` / `void_reason`) rather than inventing a new vocabulary:

```
reversed_at            TIMESTAMPTZ  NULL
reversed_reason        VARCHAR(500) NULL
reversed_by_user_id    INTEGER      NULL  REFERENCES auth.users(user_id)
```

No boolean `is_reversed` flag — state is inferred from `reversed_at IS NOT NULL`, matching how
`Sale` has no separate `is_voided` boolean either. All three columns are nullable and backward
compatible; no backfill needed (existing rows simply read as "not reversed"). Requires an Alembic
migration and a `docs/schema.dbml` update per the project's schema-of-record convention.

`ArLedger.reason` reuses the existing `ADJUSTMENT` enum value (same one `void_sale` uses for its
reversal) — no enum migration needed. Alternative: add a dedicated `PAYMENT_REVERSAL` value for
cleaner reporting later; flagging as an option, not recommending it for v1 since it adds a
migration for a purely cosmetic gain.

`schemas.CustomerPaymentOut` gains:
```python
reversed_at:         Optional[datetime] = None
reversed_reason:     Optional[str]      = None
reversed_by_user_id: Optional[int]      = None
```

## 7. Full reversal only — partial correction explicitly out of scope

Every reversal mechanism in this codebase (`void_sale`, `bounce_pdc_check`, `cancel_credit_memo`)
is all-or-nothing. There's no precedent for shrinking an amount in place, and building one here is
materially riskier than it looks:

- A payment can be split across multiple sales via `CustomerPaymentApplied`. Reducing `amount` by
  a delta requires deciding *which* application(s) absorb the cut, then cascading a
  `balance_due`/`payment_status` recompute per affected sale — essentially `bounce_pdc_check`'s
  loop, but for an arbitrary partial delta instead of the whole amount, with an allocation
  decision that has no unambiguous default (proportional? most-recent-first? user-selected?).
- The two creation paths already disagree on what `outstanding_balance` reflects (§3) — a partial
  edit would need to correctly re-derive the *new* target state under whichever recipe applies,
  compounding that same inconsistency instead of routing around it the way the full-reversal design
  does.

**Recommendation:** "correcting a wrong amount" = reverse the wrong payment in full via this
endpoint (with a reason like *"amount entered incorrectly, see payment #46 for correct entry"*),
then record a new, correct payment through the existing `record_customer_payment` / `create_payment`
endpoints. This is exactly how the codebase already handles corrections elsewhere — sales corrections
go through return + new sale, not in-place edits — so it's not a new philosophy, just applying the
existing one to payments. Both the reversal and the replacement payment carry their own
`write_audit()` trail, and the reversal's `reversed_reason` can reference the replacement for a
reader piecing together history later.

## 8. Permission

Two options, both consistent with *some* existing convention — flagging for a decision rather than
picking silently:

**Option A (recommended): new action `reverse_customer_payment`**, granted to `ADMIN` +
`STORE_MANAGER` only (same tier as `cancel_credit_memo` and `manage_pdc`), not granted to
`CASHIER`. Matches the `issue_credit_memo`/`cancel_credit_memo` split — both are "undo a thing that
already moved money/AR," and that pair is the closest financial-reversal precedent in this
codebase. Costs one more row in the `ACTIONS` seed list in `main.py` and one more RBAC checkbox in
Settings; doesn't change who can do it today (STORE_MANAGER already gets both `manage_customers`
and `cancel_credit_memo`) but allows tightening it later without touching `manage_customers`
(which also gates ordinary, non-reversing customer edits).

**Option B: reuse `manage_customers`.** Matches `bounce_pdc_check`/`deposit_pdc_check`, which
already treat "reverse a payment's effect" as within the scope of "manage customers." Zero new
permission plumbing. Weaker separation — anyone who can edit a customer record can also reverse
any payment.

No approval/maker-checker step is recommended either way — nothing in this codebase implements
that pattern, and introducing it here alone (while `void_sale` and `bounce_pdc_check` remain
single-actor) would be an inconsistent one-off rather than a real control.

## 9. Open questions for you

1. Option A or B on permission (§8)?
2. Reuse `ADJUSTMENT` as the `ArLedger` reason, or add a dedicated `PAYMENT_REVERSAL` enum value (§6)?
3. Any objection to excluding Credit-Memo-mode payments from this endpoint for v1 (§4)?
