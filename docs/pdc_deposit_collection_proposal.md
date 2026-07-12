# Proposal: PDC Deposit as the Collection Event

Status: **design only — not implemented**. Written for review against `backend/sales/router.py`
as of 2026-07-12, post every PDC/void-guard fix shipped earlier this session
(`docs/changelog.md` "2026-07-11 — Fix: reverse_payment on an already-voided sale left it
contradictorily stateful" and the deposit→bounce transition fix before it).

## 1. Problem

Confirmed by a dedicated verification pass (this session, prior turn): depositing — even a check
that clears without incident — never marks a PDC-tendered sale as collected, anywhere in this
codebase. `Sale.balance_due`/`payment_status`, `customer.outstanding_balance`, and the Customer
Transaction Ledger's independently-derived status are all permanently `Unpaid`/uncollected for a
PDC-only-tendered sale, forever, unless some unrelated later payment or return credit happens to
be applied against it. Confirmed genuinely new — not a documented design boundary; two prior
investigations this session (`docs/changelog.md` 2026-07-09; `docs/customers_sales_process_flows.md`
§3.5, "verified live 2026-07-10") examined this exact mechanism and concluded only that deposit
*doesn't corrupt anything* — neither asked whether it's *missing* a necessary positive effect.

This proposal designs Option A from that verification: **deposit itself is the collection event.**

## 2. Investigation

### 2.1 `post_draft`'s current PDC handling — re-verified against current code

`router.py:2244-2352`, the tender loop, per tender:

- `mode.is_pdc` → `CustomerPayment` gets `check_number`/`check_date`/`bank_name`/
  `check_status="IN_VAULT"` (`:2292-2296`).
- A `CustomerPaymentApplied(payment_id, sale_id, amount_applied)` row is created unconditionally
  for whatever portion of the tender the sale's remaining balance absorbs (`:2304-2311`) — this
  exists today, for every PDC tender, regardless of anything this proposal changes.
- Because `mode.is_ar_charge` is `True` for the live "Post-Dated Check" payment mode: the
  `if mode.is_ar_charge: pass` branch fires (`:2322-2328`) — **zero** `ArLedger` rows written.
  `amount_to_apply` is excluded from `standard_applied` (`:2350-2351`) — `balance_due` and
  `payment_status` computed at `:2357-2363` as if the tender never happened.
- `customer.outstanding_balance += grand_total - standard_applied` (`:2365-2374`) — the full
  `grand_total` stays an open receivable, PDC or not.

Confirmed, not assumed: `is_ar_charge=True` on PDC is itself intentional and correct *at this
point in time* — a postdated check shouldn't count as collected merely by being handed over, it
can still bounce (`docs/payment_ground_truth.md` §6 already documents this as deliberate, "composes
correctly with the bounce logic"). The gap is specifically the missing transition once the check
actually clears.

### 2.2 The load-bearing question — `bounce_pdc_check`'s reversal mechanism

`router.py:1403-1460`. Two structurally distinct halves, confirmed by direct read:

- **`ArLedger` reversal (`:1403-1432`) is *already* origin-agnostic.** It queries
  `ArLedger WHERE reference_type='customer_payments' AND reference_id=str(payment_id)` and negates
  whatever it finds — no mode check anywhere in this half. Today, for PDC, this query finds **zero
  rows** (per §2.1), so it correctly no-ops on `outstanding_balance`. **This half needs no code
  change at all.** Once deposit writes a real row (§3), this same unmodified query will find it and
  reverse it correctly, automatically — proven by the query's own filter, not assumed.
- **`balance_due`/`payment_status` restoration (`:1434-1460`) is *not* origin-agnostic — this is
  the actual bug.** It's gated by a static, mode-only flag:
  ```python
  mode_reduces_balance = not (
      payment.payment_mode.is_ar_charge or payment.payment_mode.is_ar_credit
  )
  if mode_reduces_balance:
      # restore balance_due/payment_status per application
  ```
  For PDC, `mode_reduces_balance` is `False` unconditionally — bounce **never** restores
  `balance_due`, regardless of whether the check was ever deposited (regardless of whether
  `balance_due` was ever actually reduced in the first place). This is correct *today* only
  because deposit never reduces it either. The moment deposit does (§3), this static rule stops
  distinguishing "bounced from `IN_VAULT`, nothing was ever collected, restoring would double-count
  a debit that's already there" from "bounced from `DEPOSITED`, the collection this proposal adds
  really did happen and must be undone."

**Recommended mechanism, confirmed to work without any mode-based conditional**: replace the
mode-flag with a check on the *same* `ledger_entries` list already fetched two lines above for the
`ArLedger`-negation loop — specifically, whether any of those entries carries `reason == "PAYMENT"`:
```python
restore_balance = any(e.reason == "PAYMENT" for e in ledger_entries)
if restore_balance:
    # restore balance_due/payment_status per application — unchanged logic otherwise
```
Traced through every mode this touches, not assumed:
- **Standard tender (Cash/GCash), bounce/reversal today**: writes `reason="PAYMENT"` at post time
  (`:2340-2348`) → `ledger_entries` contains it → `restore_balance=True`. Unchanged from current
  behavior (`mode_reduces_balance` was already `True` here).
- **AR Credit (Store Credit) tender**: writes `reason="AR_CREDIT"`, *not* `"PAYMENT"`
  (`:2331-2337`) — and, same as `is_ar_charge`, is excluded from `standard_applied`, so it never
  reduced `balance_due` either. `reason`-based check correctly gives `restore_balance=False` here
  too — **this is why the check must specifically test `reason == "PAYMENT"`, not merely "any row
  exists."** A bare "did this payment write *any* `ArLedger` row" check would incorrectly restore
  balance_due for AR Credit reversals, a regression the mode-flag currently prevents by accident.
  Confirmed by reading the AR Credit branch, not assumed.
- **PDC, bounced from `IN_VAULT` (never deposited)**: no deposit-time write ever happened →
  `ledger_entries` empty → `restore_balance=False`. Correctly no-ops, same as today.
- **PDC, bounced from `DEPOSITED`**: deposit wrote a `reason="PAYMENT"` row (§3) →
  `ledger_entries` contains it → `restore_balance=True`. Correctly restores — the new, needed
  behavior.

No mode-based conditional required anywhere in this function once this lands — exactly what §2.2
of the request asked to confirm.

**A second call site shares the identical pattern and the identical exposure.** `reverse_payment`
(`router.py:3211-3236`) has byte-for-byte the same `mode_reduces_balance` static check, same
comment, same structure. Critically, `reverse_payment` has **no PDC-specific rejection** — it only
rejects an already-`BOUNCED` payment (`:3162-3166`) or `is_credit_memo` mode (`:3167-3175`); nothing
stops it from being called on an `IN_VAULT` or `DEPOSITED` PDC payment today. Once deposit writes a
real `ArLedger` row, a `DEPOSITED` PDC payment reversed via the *generic* `reverse_payment` endpoint
instead of `bounce_pdc_check` would hit the exact same stale-static-flag bug if only `bounce_pdc_check`
were fixed. **Both functions need the identical `reason == "PAYMENT"` fix**, not just the one named
in the request — flagging this as a necessary companion, not scope creep, since it's the same bug
in the same shared pattern, reachable through a second door.

### 2.3 Backfill — live data, precise, not a headline number

Raw query — every `DEPOSITED` PDC payment today:

| payment_id | customer | amount | linked sale | sale status | sale balance_due | existing `PAYMENT`-reason ArLedger row? |
|---|---|---|---|---|---|---|
| 7 | Suntech (1) | ₱600 | SALE-00007 | Posted | **0.00** | **Yes** |
| 8 | Suntech (1) | ₱600 | SALE-00008 | Posted | **0.00** | **Yes** |
| 9 | Suntech (1) | ₱600 | SALE-00009 | Posted | **0.00** | **Yes** |
| 10 | Suntech (1) | ₱600 | SALE-00010 | Posted | **0.00** | **Yes** |
| 11 | *(none)* | ₱600 | SALE-00011 | Posted | **0.00** | No |
| 91 | O'Hotel (3) | ₱100 | SALE-00074 | **Voided** | 100.00 | No |
| 95 | O'Hotel (3) | ₱50 | SALE-00078 | Posted | 50.00 | No |

**7 payments, ₱3,150.00 raw total — but that number overstates the actual gap and must not be
quoted as-is.** Traced each row individually rather than assumed uniform:

- **Payments 7, 8, 9, 10 (₱2,400) already have a `reason="PAYMENT"` `ArLedger` row and
  `balance_due=0.00`/`Paid`.** This is only possible if "Post-Dated Check" had `is_ar_charge=False`
  at the time these sales were posted — i.e. these predate whatever later reconfigured the payment
  mode to `is_ar_charge=True` (`docs/payment_ground_truth.md` §"data-integrity observation" already
  notes the flag was "evidently set via the mode's own PATCH endpoint at some point," untracked by
  any seed function or audit log). These sales are **already correct** under this proposal's target
  end-state; nothing to backfill.
- **Payment 11 (₱600, no customer) also already shows `balance_due=0.00`/`Paid`** — via the same
  historical `standard_applied` path (that computation isn't gated on `customer` existing), even
  though it has zero `ArLedger` rows at all (those *are* gated on `customer`, and this payment has
  none). Already correct; a naive "no existing `PAYMENT` row" filter alone would incorrectly
  re-flag this one — confirmed by checking `sale.balance_due` directly, not inferred.
- **Payment 91 (₱100)'s linked sale is `Voided`.** `void_sale` already wrote its own full
  `-grand_total` `ArLedger ADJUSTMENT` and closed out that sale's AR impact independently of the
  PDC bug. Touching it now would recreate exactly the "act on an already-voided sale" contradiction
  this session's void-guard fix was built to prevent (`docs/backlog.md` "Void-after-reversal
  investigation" entry) — this is also the same payment 91 already flagged as a permanent,
  uncleanable historical artifact in `docs/backlog.md`'s PDC verification entry, "set before the
  void-guard existed."
- **Payment 95 (₱50) is the only row that actually needs backfilling**: `DEPOSITED`, `Posted`
  linked sale, `balance_due=50.00` still open, and genuinely zero `ArLedger` effect recorded for it
  under the current `is_ar_charge=True` regime.

**Precise backfill scope: 1 payment, ₱50.00, one customer (O'Hotel, customer_id=3).** The correct,
safe selection filter for a migration (or a startup-time idempotent pass, matching this codebase's
`_seed_*` convention) is the conjunction of all three signals traced above, not any single one:
`check_status='DEPOSITED'` AND linked sale `status='Posted'` AND `sale.balance_due > 0` AND no
existing `reason='PAYMENT'` `ArLedger` row for `reference_type='customer_payments'`/this
`payment_id`.

### 2.4 The deposit-time `ArLedger` entry — mirrors the standard-tender shape exactly

Matching what a standard tender already writes at post time (`:2340-2348`), just deferred to
deposit time and scoped to what deposit already knows: one row,
`ArLedger(customer_id=payment.customer_id, amount_change=-payment.amount, reason="PAYMENT",
reference_type="customer_payments", reference_id=str(payment_id))`. Uses `payment.amount` (the
full tendered amount), not `amount_applied` — same "write for the full amount regardless of
application state" convention `record_customer_payment` already uses and that
`apply_unapplied_payment`'s `already_reduced`/`surplus` math is already built to reconcile against
(`docs/payment_pooling_proposal.md` §5). `balance_due`/`payment_status` restoration, per linked
sale, uses `apply.amount_applied` per `CustomerPaymentApplied` row (there is normally exactly one,
tied to the sale the check was tendered on at `post_draft` time) — same shape `_apply_and_update`
already uses for every other mode.

## 3. Proposed changes

### 3.1 `deposit_pdc_check` (`router.py:1312-1353`)

After the existing preconditions (`check_status == 'IN_VAULT'`, `_reject_if_linked_to_voided_sale`
— both unchanged, already run before any mutation), in the same transaction as the existing
`check_status`/`payment_date` writes:

1. `db.add(models.ArLedger(customer_id=payment.customer_id, amount_change=-payment.amount,
   reason="PAYMENT", reference_type="customer_payments", reference_id=str(payment_id)))` — only if
   `payment.customer_id` is set (matches every other conditional `ArLedger` write in this file).
2. If `payment.customer_id`: `customer.outstanding_balance -= payment.amount`.
3. For each `payment.applications` row: `sale.balance_due = max(sale.balance_due -
   apply.amount_applied, Decimal("0"))`; recompute `payment_status` with the same
   `Paid`/`Partial`/`Unpaid` three-branch logic every other restore site uses.
4. Existing `check_status = "DEPOSITED"` / `payment_date` update, existing single `db.commit()`
   (design goal 4 — already single-commit today; this only adds writes inside the same
   transaction, doesn't restructure it).

### 3.2 `bounce_pdc_check` (`router.py:1357-1471`) and `reverse_payment` (`router.py:3130-3247`)

Both: replace the static `mode_reduces_balance = not (payment.payment_mode.is_ar_charge or
payment.payment_mode.is_ar_credit)` with `restore_balance = any(e.reason == "PAYMENT" for e in
ledger_entries)`, computed from the `ledger_entries` list each function already fetches for the
`ArLedger`-negation loop directly above — no new query. Everything else in both functions is
unchanged: the `ArLedger`-negation loop, the void-guard call, the `check_status`/`reversed_at`
flagging, the single-commit structure.

## 4. Backfill recommendation

**Backfill the one genuinely-affected row (payment 95, ₱50.00), do not touch payments 7/8/9/10/11.**

Reasoning: 7/8/9/10 are already correct (predate the flag change, already have their own
`PAYMENT` `ArLedger` row and `balance_due=0`) — running any backfill logic against them that isn't
gated on "no existing `PAYMENT` row" would double-write. Payment 11 is already correct via a
different historical mechanism and has no customer to attribute a new ledger row to regardless.
Payment 91's sale is Voided — already fully and independently closed out by `void_sale`; backfilling
it would recreate the exact contradiction this session's void-guard fix exists to prevent. Only
payment 95 is a live, `Posted`-sale, currently-open, genuinely-uncollected-on-paper case — a single
manual correction (or a narrowly-scoped, idempotent one-time script gated on the same four-part
filter from §2.3) is proportionate; a general-purpose backfill migration is not needed for a
₱50.00, one-row gap, and writing one risks being the thing that touches 7/8/9/10/11 incorrectly if
its filter is even slightly looser than the one derived here.

## 5. Composition with the void-guard (design goal 5) — confirmed, no regression

`_reject_if_linked_to_voided_sale` already runs in `deposit_pdc_check` before any mutation
(`:1338`, current code) — the new writes in §3.1 land after it, inheriting the same protection with
no change needed. `bounce_pdc_check`/`reverse_payment` already call it too (`:1388`, `:3176`) —
unaffected by the `mode_reduces_balance` → `restore_balance` swap, since the guard runs earlier in
both functions, independent of that computation. No new interaction introduced: a sale voided
*before* deposit still can't be deposited into (guard fires first); a sale voided *after* deposit
still can't have that deposit's payment bounced or reversed (guard fires first there too, exactly
as today).

No schema or migration changes — every field this touches (`ArLedger`, `Sale.balance_due`,
`Sale.payment_status`, `Customer.outstanding_balance`) already exists and is already written by
the identical code shape elsewhere in this file. No permission changes — `deposit_pdc_check`/
`bounce_pdc_check`/`reverse_payment` keep their current `manage_customers`/`reverse_customer_payment`
gates.

## 6. Open questions for you

1. §4's backfill recommendation (fix payment 95 alone, leave 7/8/9/10/11 untouched) — confirm, or
   is there a reason to also investigate/correct 7/8/9/10/11's history (e.g. determine exactly when
   and by whom `is_ar_charge` was flipped on the PDC payment mode, in case that reveals a broader
   misconfiguration beyond these five rows)?

   **Decided:** confirmed — fix exactly the one payment that genuinely needs it (payment 95,
   ₱50.00), not a blanket migration across all 7 `DEPOSITED` payments. The other six stay
   untouched: four (7/8/9/10) already carry their own correct `ArLedger` entry, one (11) is
   already `Paid` via a separate historical mechanism, and one (91) is deliberately preserved
   elsewhere in `docs/changelog.md` as historical evidence of an unrelated, already-fixed past
   bug — not something this proposal should disturb.

2. This proposal makes deposit itself the collection event (Option A from the verification pass).
   That was the option asked to be designed here, but it's worth re-confirming explicitly given the
   real accounting weight: is "submitted to the bank" the right trigger, or would this business
   prefer a distinct "confirmed cleared" step (Option B from the verification) before money counts
   as collected? This design doesn't build Option B — flagging that the choice is being finalized
   by proceeding with this proposal, not re-litigated.

   **Decided:** Option A reconfirmed. The small real-world dollar impact found during the §2.3
   backfill investigation (one ₱50.00 row) doesn't change the underlying reasoning for treating
   deposit as the collection event — that reasoning was about what "submitted to the bank" means
   accounting-wise, not about how much money currently happens to be affected.

3. §2.2's `reason == "PAYMENT"` fix to `reverse_payment` touches a function with real production
   surface (any non-PDC payment reversal also flows through it) — confirm no objection to bundling
   that fix into this same change, given it shares the exact bug pattern and is reachable for a
   PDC payment today.

   **Decided:** bundle it. `reverse_payment` carries the identical `mode_reduces_balance` bug and
   is already live-reachable on PDC payments today (nothing blocks calling it instead of
   `bounce_pdc_check`) — shipping the `bounce_pdc_check` fix alone and leaving `reverse_payment`
   with the matching gap would just relocate the bug to the other door, not close it.
