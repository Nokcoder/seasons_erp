# Customers/Sales Verification Pass — Voids, Returns, Charge Payments, PDC (2026-07-10)

**Purpose**: a consolidated verification pass across four areas of the Customers/Sales
section — voids, returns, charge payments, and PDC payments — ahead of prioritizing what to
fix next. This is verification only; nothing found here has been fixed. Where this session
already established ground truth (`docs/returns_ground_truth.md`, `docs/payment_ground_truth.md`,
`docs/customers_sales_process_flows.md`), this document cites and reuses it rather than
re-deriving it. Every claim below is backed by a direct code read and/or a live test against
the running Docker stack (real sales created, posted, voided, reversed, bounced — not just
reasoned about) as of 2026-07-10.

**Verdict legend**:
- **CONFIRMED WORKING** — verified live, behaves correctly.
- **KNOWN GAP (already tracked)** — previously documented elsewhere; re-confirmed still present,
  not re-derived here.
- **NEW GAP FOUND** — not previously documented anywhere; found and live-verified this pass.

---

## 1. Voids (`void_sale`)

Previously only exercised indirectly (via the `sale_pid` fix's test coverage). Verified
directly this pass. Full narrative in `docs/customers_sales_process_flows.md` §2.3 (updated
2026-07-10 with this pass's findings).

### 1.1 Single-tender void — **CONFIRMED WORKING**

Test: customer 3 (O'Hotel, baseline `outstanding_balance=0.00`), sale 72, $100 grand_total, one
Cash tender of $40 (partial).

| Step | Expected | Observed |
|---|---|---|
| After post | `balance_due=60`, `payment_status=Partial`, `outstanding_balance=+60` | ✅ exact match |
| After void | `ArLedger ADJUSTMENT -100`, `outstanding_balance = 60-100 = -40` | ✅ exact match (`-40.00`) |
| Stock | one `RETURN_IN` `InventoryLedger` row mirroring the `SALE` row | ✅ (`ledger_id 100→101`, qty `-1→+1`) |

### 1.2 Multi-tender void — **CONFIRMED WORKING**

Test: sale 73, $100 grand_total, Cash $30 + GCash $20 (two different modes, two separate
`CustomerPayment` rows).

- Void wrote **exactly one** `ArLedger ADJUSTMENT -100.00` row and **exactly one**
  `InventoryLedger RETURN_IN` row — confirmed via direct query. The reversal is entirely
  tender-count-independent; it does not iterate or duplicate per tender.
- `outstanding_balance`: `10.00 → -90.00` (delta `-100`, matching `-grand_total`), correct
  regardless of two tenders being involved.

### 1.3 PDC-tender void interaction — **NEW GAP FOUND** (live-reproduced)

Test: sale 74 (PDC-tendered, $100, then voided) and sale 75 (same, voided, then bounce
attempted).

- Voiding does not touch the PDC `CustomerPayment` row at all — `check_status` stays
  `IN_VAULT`, still linked via `CustomerPaymentApplied` to the now-`Voided` sale.
- **`deposit_pdc_check` still succeeds (`200`)** against a payment whose sale is already
  `Voided` — no status check exists. Not financially harmful (deposit only touches
  `check_status`/`payment_date`), but semantically confusing: staff would see a check marked
  "deposited" with no indication the underlying sale/obligation was cancelled.
- **`bounce_pdc_check` also succeeds (`200`)** against a voided sale's PDC payment — and this
  one *is* harmful: sale 75 ended up with **`balance_due=200`** (double its `grand_total=100`)
  after the bounce, while still `Voided`. See §3 below — this isn't actually a void-specific
  bug; it reproduces identically on a normal, never-voided sale. The void interaction just makes
  it doubly confusing (a terminal-state record getting a nonsensical value written to it).

### 1.4 `write_audit` coverage of void's actual effects — **NEW FINDING (refines existing doc)**

`docs/customers_sales_process_flows.md` §5.2 previously listed `void_sale` as a bare ✅. Live
confirmed this pass: after voiding sale 72, `auth.audit_log` has **exactly one** row for it
(`sales.sales`, `UPDATE`) — no audit entry for the `InventoryLedger` reversal, the `CostLayer`
restoration, the `CreditMemoRedemption` reversal, the `ArLedger ADJUSTMENT` entry, or the
`outstanding_balance` change. Same shape of gap as the returns flow
(`docs/returns_ground_truth.md` §5), just not previously called out this precisely for
`void_sale`'s own coverage. Doc corrected in place.

### 1.5 `payment_status`/`balance_due` are not reset on void — **observed, not a backend defect**

Confirmed live: sale 72 stayed `balance_due=60`/`payment_status=Partial` after voiding.
`docs/requirements.md` §13.7 doesn't require these fields to change on void, so this isn't a
requirements violation. Worth knowing because `SaleDetail.tsx:245-248` renders `payment_status`
as an unconditional colored badge — a voided sale that was fully paid still shows a green
"Paid" badge next to "Voided." A UI-observable consequence, not a ledger/balance defect.

---

## 2. Returns

Already exhaustively documented in `docs/returns_ground_truth.md` (2026-07-10, same day, an
earlier pass). Not re-investigated from scratch — summarized and cross-checked for drift.

### 2.1 Confirmed correct (unchanged)

- **Stock/cost-layer reversal for normal (non-bundle) items** — restores the *exact* original
  `CostLayer` the sale consumed from (via `SaleItem.cost_layer_id`), a more precise mechanism
  than the sale's own FIFO consumption.
- **Original sale is never touched** — `sale.status`/`balance_due`/`payment_status` are never
  written by `_do_return`, confirmed by grep (zero matches). A return is purely a foreign-key
  reference, reconstructed by readers.
- **Refund/payment path (cash-refund negative `CustomerPayment`) `ArLedger` accounting** — does
  not repeat the `apply_unapplied_payment` double-counting bug; deliberately ledger-silent,
  correct design.

### 2.2 KNOWN GAP (already tracked) — confirmed still present, unchanged since the doc was written

- **Bundle returns credit phantom stock to the bundle variant, never restore component
  stock/cost layers.** `docs/returns_ground_truth.md` §1.
- **Near-total audit trail gap** — one write out of nine (the return header) is audited.
  `docs/returns_ground_truth.md` §5.
- **`disposition` unconstrained at the API layer** (`Optional[str]`, not an enum) — reachable
  via direct API use, not the current UI. `docs/returns_ground_truth.md` §4. Re-confirmed live
  this pass: `SalesReturnCreate.disposition` is still a plain `Optional[str]` in the current
  code.
- **Stale `credit_memo` doc reference** — `docs/schema.dbml:483`'s inline comment still lists a
  third `disposition` value (`credit_memo`) that was never implemented. Not yet corrected.

### 2.3 Superseded since the document was written — **fixed, not a gap anymore**

`docs/returns_ground_truth.md` §3 documented `SalesReturn` as having no idempotency-key
protection, the same day it was later fixed: `SalesReturn.idempotency_key` now exists
(`backend/sales/models.py:304`, `unique=True`), and `create_return`/`create_return_and_exchange`
both check for an existing return by key before processing. See `docs/changelog.md` "2026-07-10
— Duplicate-submission protection for CustomerPayment and SalesReturn" for the fix and its own
live verification. `docs/returns_ground_truth.md` has been annotated in place to mark this
section superseded rather than rewritten, preserving the historical record of what was found
and when.

**Nothing else has silently changed** — re-confirmed live/by code read this pass: the bundle
gap, the audit gap, and the unconstrained `disposition` field are all exactly as that document
described.

---

## 3. Charge Payments (`payment_mode_id=7`, `is_ar_charge=true`)

Not previously investigated this session beyond one line in `docs/payment_ground_truth.md` §1
("Central to the Customer Transaction Ledger feature"). Fully traced end-to-end this pass; full
narrative added to `docs/customers_sales_process_flows.md` §3.5a.

### 3.1 Creation path — **CONFIRMED: exclusively path 3 (`post_draft`'s tender loop)**

- Backend-enforced requirement: an `is_ar_charge` tender requires a registered customer
  (`router.py:1890-1894`), independent of the frontend's own pre-flight check in
  `Workstation.tsx`.
- The two standalone-payment screens (`CustomerDetail.tsx`'s "Record Payment",
  `CustomerARLedger.tsx`'s "Receive Payment") both explicitly filter `is_ar_charge`/
  `is_ar_credit` modes out of their payment-mode dropdowns (`CustomerDetail.tsx:62`,
  `CustomerARLedger.tsx:173`). Charge is not blocked at the API layer for those two endpoints,
  but has no UI path through them — the only real-world entry point is the POS Workstation at
  sale-posting time.

### 3.2 Transaction Ledger relationship — **traced fully**

`_build_customer_transaction_ledger` (`router.py:778-896`) scopes itself to exactly the Posted
sales that received an `is_ar_charge` tender. A Charge tender applied to a sale is what makes
that sale appear in the ledger at all:
- **Debit row** = the `is_ar_charge`-applied amount for that sale (from
  `CustomerPaymentApplied` summed per `sale_id`, filtered to `PaymentMode.is_ar_charge=True`).
- **Credit rows** = later collection payments applied against that same `sale_id`, via any
  non-`is_ar_charge` mode.
- `running_balance` is computed by iterating all such rows chronologically from zero — an
  independent, per-customer, per-invoice statement, not read from `Sale`/`Customer` columns.

### 3.3 `outstanding_balance`/`ArLedger` accounting — **CONFIRMED WORKING**

Live test: $100 sale, single Charge tender for the full amount.

| Field | Expected | Observed |
|---|---|---|
| `balance_due` | `100` (Charge excluded from `standard_applied`) | ✅ `100.00` |
| `payment_status` | `Unpaid` (design: an AR-charged sale must not read as `Paid`) | ✅ `Unpaid` |
| `ArLedger` rows for the Charge payment itself | none (obligation already booked by the `SALE` entry) | ✅ `0` rows |
| `outstanding_balance` delta from this sale | `+100` (`grand_total - standard_applied(0)`) | ✅ exact match |

Matches `docs/customers_sales_process_flows.md` §4.1's documented claim that the `AR_CHARGE`
reason code has zero writers by design — confirmed correct, not just "runs without error."

### 3.4 `reverse_customer_payment` interaction — **NEW GAP FOUND** (live-reproduced)

Question asked: is Charge wrongly caught by the credit-memo-mode restriction? **No** — `reverse_
payment`'s three guards (already-reversed, bounced-PDC, credit-memo-mode) correctly don't apply
to Charge, and it isn't blocked. But reversing a Charge payment hits a different, previously
undocumented bug:

Live test: sale 76, $100, single Charge tender, no void involved at all (still `Posted`).
Reversed the Charge `CustomerPayment` (payment_id 93) via `POST /sales/payments/{id}/reverse`.

| Field | Before reversal | After reversal | 
|---|---|---|
| `sale.status` | `Posted` | `Posted` (unchanged, as expected) |
| `sale.balance_due` | `100.00` | **`200.00`** ← corrupted |
| `customer.outstanding_balance` | `10.00` | `10.00` (correctly unchanged — no `ArLedger` rows existed to reverse) |

**Root cause**: `reverse_payment`'s balance-restore step
(`sale.balance_due = (sale.balance_due or 0) + apply.amount_applied`) assumes the tender
previously *reduced* `balance_due` — true for standard tenders, false for `is_ar_charge`/
`is_ar_credit` tenders (deliberately excluded from `standard_applied`, so never reduced it in
the first place). Adding it back on reversal double-counts. **This is not Charge-specific** — it
reproduces identically for PDC (also `is_ar_charge`) via `bounce_pdc_check`, confirmed
separately in §4 below, on a sale that was never voided either. The corruption is confined to
the `Sale` row's cached `balance_due`/`payment_status` — `get_ar_aging` and
`_build_customer_transaction_ledger` derive independently from source tables and were
confirmed unaffected (both still showed the correct `100.00` for the affected sales after this
test).

### 3.5 `write_audit` coverage — **CONFIRMED WORKING**

Charge payments go through the same unconditional per-tender `write_audit` call as every other
tender in `post_draft`'s loop (`router.py:2151`, `INSERT`) — no Charge-specific gap. Confirmed
via `auth.audit_log` query showing the `INSERT` row for the Charge payment's creation.

---

## 4. PDC Payments

`bounce_pdc_check`'s under-reversal bug was already found and fixed earlier this session
(`docs/changelog.md` "2026-07-09 — Fix: bounce_pdc_check under-reversed payments with unapplied
balance"). The deposit side had never been verified until this pass.

### 4.1 `deposit_pdc_check` lifecycle — **CONFIRMED WORKING**

Full read of `router.py:1180-1219`: requires `check_status == 'IN_VAULT'`, sets
`check_status='DEPOSITED'` and `payment_date` to the actual deposit date. That is the *entire*
effect — no `ArLedger` write, no `outstanding_balance` touch, no `sale.balance_due` touch.

This is correct, not incomplete: a PDC tender's full AR obligation is already booked by the
`SALE` ledger entry at post time (§4.1 of the process-flows doc), and `balance_due` is
deliberately never reduced by it either. There is nothing left for deposit to under- or
over-count — confirmed live (deposited a PDC check, `outstanding_balance` and the linked sale's
`balance_due` both unchanged before/after).

### 4.2 No under/over-counting bug at deposit specifically — **CONFIRMED, checked precisely**

Verified this is not just "runs without error" — traced the actual ledger math and confirmed
there is no ledger write of any kind at deposit time to get wrong. The bug class found in
`bounce_pdc_check` and `apply_unapplied_payment` (assuming AR impact based on origin/application
totals rather than reading the ledger) does not apply here because deposit touches no
AR-relevant field at all.

### 4.3 `write_audit` coverage — **CONFIRMED WORKING**

`auth.audit_log` confirmed to contain the `UPDATE` row for a live deposit action, alongside the
original `INSERT` from the payment's creation.

### 4.4 Interaction with the already-fixed bounce logic — **NEW GAP FOUND: the sequence is impossible, not just unverified**

The requested check — "deposit then later bounce, does the math still work end to end" — turns
out to be unperformable in the current system:

- **NEW GAP**: both `deposit_pdc_check` and `bounce_pdc_check` require `check_status ==
  'IN_VAULT'`. Once a check is `DEPOSITED`, there is no endpoint that can ever transition it to
  `BOUNCED` — confirmed by grepping every `check_status =` write site in the backend (exactly
  two, both gated on `IN_VAULT`). Live-reproduced: deposited a PDC check, then attempted to
  bounce it — rejected with `400 Cannot bounce check with status 'DEPOSITED'`.
- This is a genuine real-world workflow gap, not an edge case: a post-dated check realistically
  bounces *after* deposit (that's the point of depositing it — submitting it to the bank, which
  can then reject it), not while sitting in the vault. The only bounce path this system
  supports models the less common case.
- **What *is* still correct**: bouncing a check that never left `IN_VAULT` continues to work
  exactly as the 2026-07-09 fix left it — re-verified live, `total_delta=0` correctly computed
  for a PDC payment with no prior `ArLedger` rows (the normal case), `outstanding_balance`
  correctly left unchanged. The `balance_due` corruption bug (§3.4) is a distinct issue in the
  same function, not a regression of the 2026-07-09 fix.

---

## Summary Table

| Area | Verdict |
|---|---|
| Void — single-tender AR/stock reversal | ✅ CONFIRMED WORKING |
| Void — multi-tender AR/stock reversal | ✅ CONFIRMED WORKING |
| Void — PDC tender interaction | 🆕 NEW GAP — deposit/bounce still act on a voided sale's PDC check with no block |
| Void — audit coverage of actual effects | 🆕 NEW FINDING — header-only, same shape as returns; doc corrected |
| Void — `balance_due`/`payment_status` not reset | ℹ️ observed, not a backend defect (frontend displays it regardless) |
| Returns — stock/cost-layer, sale independence, refund-path accounting | ✅ CONFIRMED WORKING (per `returns_ground_truth.md`) |
| Returns — bundle phantom stock, audit gap, unconstrained `disposition` | 🔁 KNOWN GAP (already tracked), confirmed unchanged |
| Returns — idempotency | ✅ FIXED since `returns_ground_truth.md` was written — doc annotated |
| Charge — creation path, Transaction Ledger, accounting | ✅ CONFIRMED WORKING |
| Charge — `reverse_payment` interaction | 🆕 NEW GAP — corrupts `sale.balance_due` (shared root cause with PDC bounce) |
| Charge — audit coverage | ✅ CONFIRMED WORKING |
| PDC — deposit lifecycle and ledger math | ✅ CONFIRMED WORKING |
| PDC — audit coverage (deposit) | ✅ CONFIRMED WORKING |
| PDC — deposit→bounce sequencing | 🆕 NEW GAP — no `DEPOSITED → BOUNCED` path exists at all |

**Two new gaps stand out as the most consequential findings of this pass**, both centered on
the same root cause (`is_ar_charge` tenders being excluded from `standard_applied`, which
`reverse_payment`/`bounce_pdc_check`'s balance-restore logic doesn't account for):

1. Reversing or bouncing an `is_ar_charge`-mode payment (Charge or PDC) corrupts the linked
   sale's `balance_due` to double its `grand_total`, reproducible on a perfectly normal,
   never-voided sale — no void or unusual sequencing required.
2. A PDC check that has been deposited can never be marked bounced, foreclosing the most
   realistic real-world bounce scenario entirely.

Neither has been fixed as part of this pass, per instruction — both filed to `docs/backlog.md`
for prioritization.

---

## Live Test Artifacts

All tests run against customer 3 (O'Hotel), the shared scratch-test customer used repeatedly
this session for live verification — not a real business customer in this dataset.
`outstanding_balance` for this customer no longer reflects a coherent business state as a
result (ended this pass at `160.00`) and should not be read as meaningful; it is scratch data.

Sales created for this pass: 72, 73, 74, 75, 76 (Charge), 77 (PDC bounce, no void), 78 (PDC
deposit-then-bounce-attempt). Payments: 88–95. These were **not** cleaned up — several ended in
states with no proper-action reversal path (voided sales are terminal; several of the
`balance_due` corruptions and `BOUNCED`/`DEPOSITED` check statuses are themselves the
reproducible evidence for the two new gaps above) — deleting or hand-editing them via raw SQL
would have destroyed that evidence. Left in place, cited by ID above, matching this session's
established practice of citing exact live-affected records as evidence rather than manufacturing
synthetic reproductions after the fact.
