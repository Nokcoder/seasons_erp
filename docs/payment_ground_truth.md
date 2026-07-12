# Payment Ground Truth — Verification Pass (2026-07-10)

**Purpose**: this is a verification pass, not a redesign or a fix. It establishes what
currently exists in the code around payment modes, payment creation, duplicate-submission
protection, and frontend entry points, ahead of any future redesign discussion. Every claim
below is backed by a direct read of the live database and/or a `file:line` citation into the
codebase as it stood on 2026-07-10. Nothing in this document has been implemented or changed —
it is a record of what was found.

**Related tracking**: the gaps and corrections identified during this pass have been filed in
`docs/backlog.md` under three entries — "Payment creation has no duplicate-submission
protection," "The four-creation-paths finding — documentation correction," and (indirectly)
the earlier RBAC entries. `docs/customers_sales_process_flows.md` §3.2 and §5 were also
corrected in place as a result of this pass. This document is the complete, standalone verdict
those entries summarize and point back to.

---

## 1. Payment Modes — complete, live-queried list

Queried `sales.payment_modes` directly against the running database — **all 7 rows**, not a
sample:

```sql
SELECT payment_mode_id, name, is_physical, is_active, is_ar_charge, is_ar_credit,
       is_credit_memo, is_pdc, is_cash
FROM sales.payment_modes ORDER BY payment_mode_id;
```

| id | Name | is_physical | is_active | is_ar_charge | is_ar_credit | is_credit_memo | is_pdc | is_cash |
|---|---|---|---|---|---|---|---|---|
| 1 | Credit Memo | f | t | f | f | **t** | f | f |
| 2 | Store Credit | f | t | f | **t** | f | f | f |
| 3 | Cash | **t** | t | f | f | f | f | **t** |
| 4 | GCash | f | t | f | f | f | f | f |
| 5 | On-Date Check | **t** | t | f | f | f | f | f |
| 6 | Post-Dated Check | **t** | t | **t** | f | f | **t** | f |
| 7 | Charge | f | t | **t** | f | f | f | f |

Model definition confirming this is the complete column set — `backend/sales/models.py:21-36`:

```python
class PaymentMode(Base):
    __tablename__ = "payment_modes"
    __table_args__ = {"schema": "sales"}

    payment_mode_id = Column(Integer, primary_key=True)
    name            = Column(String(100), nullable=False)
    is_physical     = Column(Boolean, default=True, nullable=False)
    is_active       = Column(Boolean, default=True, nullable=False)
    is_ar_charge    = Column(Boolean, default=False, nullable=False)
    is_ar_credit    = Column(Boolean, default=False, nullable=False)
    is_credit_memo  = Column(Boolean, default=False, nullable=False, server_default='false')
    is_pdc          = Column(Boolean, default=False, nullable=False, server_default='false')
    is_cash         = Column(Boolean, default=False, nullable=False, server_default='false')
```

### Special handling per mode

**1 — Credit Memo** (`is_credit_memo`): Redemption lifecycle lives inside `post_draft`'s tender
loop (`router.py:2086-2148`). Requires the tender's `reference_number` to be the memo's `code`.
Memo `status` flips to `REDEEMED` unconditionally on first use (`:2141-2142`) — there is no
partial-remaining-balance concept; `credit_memos.amount` is never decremented, only `status`
changes. A `CreditMemoRedemption` row records the actual amount consumed. Full lifecycle
(issue/validate/redeem/cancel) documented in `docs/customers_sales_process_flows.md` §3.6.

**2 — Store Credit** (`is_ar_credit`): Tender amount is capped at
`min(tender.amount, abs(min(outstanding_balance, 0)))` during `post_draft` validation
(`:1855-1898`) — i.e. you can't tender more store credit than the customer actually has
sitting as a negative balance. Writes `ArLedger` reason `AR_CREDIT` (not `PAYMENT`) when used
(`:2174-2181`).

**3 — Cash** (`is_physical`, `is_cash`): Auto-populated as the default first tender row in the
POS Workstation (per `docs/backlog.md`'s "Cash default tender hardened" entry — resolved as
the mode named "Cash" first, else the first `is_physical=true` mode, else the first active
mode). Drives the Physical/Virtual collections split in `GET /sales/summary`. No lifecycle
beyond that.

**4 — GCash**: No flags set. Standard digital tender, no special handling anywhere.

**5 — On-Date Check** (`is_physical` only): **Not** `is_pdc` despite the name implying a
check. Confirmed via `record_customer_payment` (`router.py:957-962`): the requirement for
`check_number`/`check_date`/`bank_name` is gated strictly on `mode.is_pdc`, so this mode skips
that requirement entirely — it's treated as an ordinary same-day physical tender with no
deposit/bounce lifecycle.

**6 — Post-Dated Check** (`is_physical`, `is_ar_charge`, `is_pdc`): Full PDC vault lifecycle —
`check_status` enum (`IN_VAULT`/`DEPOSITED`/`BOUNCED`), `deposit_pdc_check`/`bounce_pdc_check`
endpoints. Requires `check_number`/`check_date`/`bank_name` at creation. Notably also
`is_ar_charge=true`: when used as a sale-time tender, it follows the AR-charge branch in
`post_draft` (writes nothing to `ar_ledger` at posting, since the sale's own `SALE` entry
already books the full obligation). This composes correctly with the bounce logic —
`bounce_pdc_check` reverses whatever `ArLedger` rows the payment actually has (`router.py`,
per `docs/changelog.md` "2026-07-09 — Fix: bounce_pdc_check under-reversed payments with
unapplied balance"); if none were ever written (the AR-charge case), there's nothing to
reverse in the ledger, and that's correct — the balance was never reduced for it in the first
place. Sale `balance_due`/`payment_status` restoration on bounce is independent of ledger
state (driven by `CustomerPaymentApplied`), so it still restores correctly regardless.

**7 — Charge** (`is_ar_charge`): The "charge to account" tender used for credit sales. Same
AR-charge branch as PDC. Central to the Customer Transaction Ledger feature
(`docs/backlog.md` "Customer Transaction Ledger — implemented (2026-07-03)").

### One data-integrity observation (found, not asked for, worth knowing)

`backend/main.py:112-138`'s `_seed_payment_mode_flags()` looks up modes by exact name
`"Post Dated Check"` / `"On Date Check"` (**no hyphens**), but the live rows are named
`"Post-Dated Check"` / `"On-Date Check"` (**with hyphens**) — so this seed function currently
silently no-ops for both, on every startup. The correct flags are present in the live DB
regardless (evidently set via the mode's own PATCH endpoint at some point), but this seed
function is not what's maintaining them today; it would not recover the correct state if the
flags were ever accidentally cleared.

---

## 2. Payment Creation Paths — confirmed: **four**, not three

Grepped every `models.CustomerPayment(` instantiation site in the entire backend:

```
backend\sales\router.py:964    → record_customer_payment
backend\sales\router.py:2113   → post_draft (tender loop)
backend\sales\router.py:2713   → create_payment
backend\sales\router.py:3212   → _do_return (cash-refund branch) — NOT previously catalogued this session
```

### Path 1 — `record_customer_payment`
`POST /sales/customers/{id}/payment`, `router.py:942-1020`. Writes **one `ArLedger` `PAYMENT`
entry for the full `payload.amount`, always** (`:1003-1010`), reduces `outstanding_balance` by
the full amount (`:1012-1014`), regardless of whether any of it is applied to a sale.
`write_audit` at `:1016`.

### Path 2 — `create_payment`
`POST /sales/payments`, `router.py:2671-2762`. Accepts a list of `applications`; writes an
`ArLedger` `PAYMENT` entry **only for each applied portion** via the shared `_apply_and_update`
helper (`:2744-2746`). Any unapplied remainder gets **zero** ledger entry at creation time.
`write_audit` at `:2758` — but in a **second, separate commit** from the payment's own commit
at `:2756` (see `docs/backlog.md` "create_payment split-commit — audit gap").

### Path 3 — `post_draft` tender loop
`router.py:2113`, inside `post_draft` (`:1789-2253`). Every tender at sale-posting time creates
a `CustomerPayment` row. `write_audit` at `:2128-2130`. AR ledger behavior follows the same
mode-flag branching as paths 1/2 (`AR_CHARGE` → nothing, `AR_CREDIT` → its own reason,
standard/credit-memo → `PAYMENT`).

### Path 4 — the cash-refund negative payment inside `_do_return` (newly surfaced)

`router.py:3196-3230`, inside the shared `_do_return` helper (`:3033-3232`, backs both
`create_return` and `create_return_and_exchange`).

**Trigger**: `payload.disposition == 'cash_refund' and payload.sale_id is not None` (`:3196`)
— i.e. only linked (non-blind) returns processed with cash-refund disposition. Blind cash
refunds (`sale_id is None`) never reach this branch at all.

**What it does, in order**:
1. Finds the largest non-AR-charge, non-AR-credit tender that was originally applied to the
   sale (`:3197-3210` — joins `CustomerPayment` → `CustomerPaymentApplied` → `PaymentMode`,
   filters `is_ar_charge=False` and `is_ar_credit=False`, orders by `amount_applied desc`).
2. If one exists, creates a **negative** `CustomerPayment` — `amount = -grand_total`,
   `unapplied_amount = 0`, `payment_mode_id` = the tender found above, `notes = "Cash refund
   for return #{return_id}"` (`:3212-3223`).
3. Creates a matching negative `CustomerPaymentApplied` — `amount_applied = -grand_total`,
   against the same `sale_id` (`:3226-3230`).

**Does it already have the same protections as the other three paths? A precise answer, not an
assumption:**

- **`write_audit` coverage: NO.** Neither the negative `CustomerPayment` nor the
  `CustomerPaymentApplied` row gets a dedicated audit call. The only `write_audit` calls in the
  callers (`create_return` at `:3324`, `create_return_and_exchange` at `:3295`) are both for
  the `sales.sales_returns` table — they audit the return, not this payment side-effect. This
  *is* a real, confirmed gap, matching the pattern of several other unaudited mutations found
  this session.

- **`ArLedger`/balance accounting: correct, and NOT a repeat of the `apply_unapplied_payment`
  double-counting bug class.** This required reading the full function, not just the negative-
  payment block in isolation. A few lines above (`:3172-3194`), for **both** `credit_to_account`
  and `cash_refund` dispositions (when a customer exists), `_do_return` already writes one
  `ArLedger` entry (`reason="RETURN"`, `amount_change=-grand_total`) and reduces
  `customer.outstanding_balance -= grand_total`. This is the actual, complete AR/balance impact
  of the return — done once, identically, regardless of disposition. The negative
  `CustomerPayment`/`CustomerPaymentApplied` pair created afterward for `cash_refund`
  specifically does **not** call `_apply_and_update`, does **not** write a second `ArLedger`
  entry, and does **not** touch `outstanding_balance` again. It is a deliberately
  ledger-silent, purely historical record — its only purpose is so the refund shows up in the
  customer's/sale's payment history. Since it bypasses `_apply_and_update` entirely, it also
  correctly avoids a second failure mode: had it gone through `_apply_and_update` with a
  *negative* amount, that helper's `sale.balance_due = max(sale.balance_due - amount, 0)` would
  have computed `balance_due - (-grand_total)`, i.e. **increased** `balance_due` — incorrectly
  suggesting the customer now owes more on the original sale because of an unrelated refund.
  The code's choice to hand-construct the rows instead of reusing the shared helper here is
  correct, not an oversight.

- **One downstream interaction found by static analysis, not live-tested this pass — flagged
  for a future check, not asserted as a confirmed bug.** Both `get_ar_aging`
  (`docs/customers_sales_process_flows.md` §1.5) and `_build_customer_transaction_ledger`
  derive their figures partly by summing `CustomerPaymentApplied.amount_applied` for a sale,
  filtered to `PaymentMode.is_ar_charge == False`. The negative application row from path 4
  satisfies that filter (its mode was deliberately chosen to be non-AR-charge/non-AR-credit) and
  would be included in those sums like any other application. Since `get_ar_aging`'s formula is
  `outstanding = ar_ledger SALE amount − Σ payments_applied − Σ returns_credit(credit_to_account
  only)`, and a `cash_refund` return is excluded from the `returns_credit` term (that term only
  counts `disposition = 'credit_to_account'`), a negative `-grand_total` entry inside
  `payments_applied` would arithmetically **add `grand_total` back** to that invoice's computed
  outstanding amount in the aging report — i.e. a sale with a linked cash refund could plausibly
  show inflated aging/outstanding figures for that specific invoice. This has **not** been
  reproduced against live data in this pass; it is a static-analysis observation worth a
  dedicated check before being treated as confirmed.

**Verdict on path 4 overall**: it is not "a fifth place carrying the same bugs fixed elsewhere
this session." Its core AR/balance accounting is correct and deliberately avoids the
double-counting failure mode this session fixed in `apply_unapplied_payment`. It does share
the audit-trail gap common to several other endpoints in this codebase (no `write_audit`), and
it has a plausible, not-yet-verified downstream interaction with the aging/transaction-ledger
readers worth checking separately.

---

## 3. Duplicate-Submission Protection — confirmed absent, across all four paths

- **Model**: `CustomerPayment` (`backend/sales/models.py:223-254`) has **no `idempotency_key`
  column** at all — contrast with `Sale.idempotency_key` (`models.py:170`, `unique=True`),
  this codebase's own established solution to exactly this problem, already relied on by the
  `sale_pid` investigation earlier this session.
- **Request schemas**: neither `CustomerPaymentCreate` (`schemas.py:419-424`, used by
  `create_payment`) nor `RecordPaymentIn` (`schemas.py:468-478`, used by
  `record_customer_payment`) accepts an `idempotency_key` field in the payload.
- **Database**: live `\d sales.customer_payments` shows only the primary key
  (`customer_payments_pkey` on `payment_id`) as a constraint — no unique index on
  `reference_number` or any field combination that could catch an accidental duplicate insert.
- **In-code logic**: no duplicate-detection check ("does an equivalent payment already exist")
  exists in any of the four creation functions — confirmed by direct read of each.
- **Path 4 specifically**: also has no protection of its own, though its exposure is somewhat
  narrower — it only fires once per `_do_return` call, gated by disposition + sale linkage, so
  a duplicate would require the *return itself* to be double-submitted, which is a separate
  question from double-submitting a standalone payment form.

**Concrete failure mode, all four paths**: a double-click, a network retry, or a resubmitted
form can create two separate, fully-valid `CustomerPayment` rows for what was meant to be one
transaction — each independently moving `ar_ledger` and `customer.outstanding_balance` a second
time. Nothing detects or prevents this today, on any of the four paths.

---

## 4. Frontend UI Entry Points — complete mapping

| Path | Reachable from the UI today? | Concrete entry point |
|---|---|---|
| Path 1 — `record_customer_payment` | **Yes — two separate entry points** | **(a)** `frontend/src/pages/customers/CustomerDetail.tsx` — "Record Payment" button (`:309`) opens the "Record Payment Modal" (`:466-539`) → `handleRecordPayment` (`:233`) → `salesApi.customers.recordPayment` (no `sale_id`; standalone/unapplied payment). **(b)** `frontend/src/pages/customers/CustomerARLedger.tsx` — per-invoice-row "Receive Payment" button (`:505`) opens the "Receive Payment" modal (`:559`) → `handlePaySubmit` (`:238`) → same `salesApi.customers.recordPayment` wrapper, this time passing `sale_id: recvSale.sale_id` (`:254-261`). Both routes go through the identical `api.ts:668-669` function. |
| Path 2 — `create_payment` | **No — definitively unreachable from the UI today** | Grepped the entire `frontend/src` tree for any wrapper targeting `POST /sales/payments` (plural) and for any reference to `CustomerPaymentCreate`'s shape (multi-sale `applications[]` array). Zero matches, in `api.ts` or anywhere else. The endpoint is fully implemented and functionally correct (verified earlier this session) but is currently orphaned — no UI screen, button, or component calls it. |
| Path 3 — `post_draft` tender loop | **Yes** | `frontend/src/pages/sales/Workstation.tsx` — the single POS/encoding screen (serves both floor cashier and auditor roles per `docs/requirements.md` §18). Tender rows held in `TenderRow` state (`:44`), submitted via `handlePost` (`:735`) → `salesApi.drafts.post` (`:800`). |
| Path 4 — `_do_return` cash-refund | **Yes, but implicitly — never presented as "creating a payment"** | `frontend/src/pages/sales/ReturnNew.tsx` — a `disposition` radio choice between `'cash_refund'` and `'credit_to_account'`, defaulting to `'cash_refund'` (`:61`, `:330-337`). Submitting a linked return with the default disposition selected triggers path 4 as a backend side effect. There is no dedicated "refund payment" screen or button — the user is choosing a return disposition, not initiating a payment, and the resulting negative `CustomerPayment` row is invisible to them at the point of creation. |

---

## Final Verdict — summary

1. **Payment modes**: 7 exist, live-confirmed. Three carry real behavioral lifecycles beyond a
   plain tender (Credit Memo, Store Credit, Post-Dated Check); Charge shares PDC's AR-charge
   branch; On-Date Check notably has *no* PDC-style lifecycle despite its name; Cash and GCash
   are plain. One dead/no-op seed function (`_seed_payment_mode_flags`) was found due to a
   naming mismatch against the live data — informational, not a functional problem today.

2. **Payment creation paths**: **four confirmed, not three.** The fourth — the cash-refund
   negative-payment branch inside `_do_return` — was not previously catalogued this session.
   Its core accounting is correct and deliberately structured to avoid the double-counting bug
   class fixed elsewhere this session; it does share the missing-`write_audit` gap common to
   several endpoints in this codebase, and has one plausible (not live-verified) downstream
   interaction with the aging/transaction-ledger readers worth a dedicated check.

3. **Duplicate-submission protection**: **absent on all four paths**, confirmed at the model
   layer, the request-schema layer, and the database-constraint layer, with no in-code
   duplicate-detection fallback anywhere. This directly contrasts with `Sale.idempotency_key`,
   this codebase's own working precedent for the same problem.

4. **Frontend entry points**: fully mapped. Path 1 has two real entry points (standalone and
   per-invoice). Path 2 has **zero** — `create_payment` is correct, working backend code with
   no UI caller at all today. Path 3 is the POS Workstation's tender submission. Path 4 is an
   implicit side effect of a return-disposition choice, never surfaced to the user as a payment
   action in its own right.

No redesign proposed. No code changed. This is the complete record of what was verified.
