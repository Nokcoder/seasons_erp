# Proposal: Reversal Mechanism for Sales Returns

Status: **design only — not implemented**. Written for review against `backend/sales/router.py`,
`backend/sales/models.py`, `backend/sales/schemas.py`, `backend/main.py`,
`docs/returns_ground_truth.md`, and the already-implemented `POST /sales/payments/{id}/reverse`
(`docs/payment_correction_proposal.md`) as of 2026-07-11.

## 1. Problem

`create_return` (`POST /sales/returns`) and `create_return_and_exchange`
(`POST /sales/returns/exchange`) can be run against the wrong sale, the wrong items, or the wrong
disposition — and, like standalone payments before `reverse_payment` existed, there is no way to
undo one. A miskeyed return sits in stock, cost layers, and the customer's AR ledger permanently.
This proposal designs the same correction mechanism `void_sale` and `reverse_payment` already
provide for their respective records, for `SalesReturn`.

## 2. Investigation: what a return actually does today (file:line, not assumed)

All return processing funnels through the shared helper `_do_return`
(`backend/sales/router.py:3237-3437`, does not commit — callers commit), backing both
`create_return` (`:3534-3576`) and `create_return_and_exchange` (`:3440-3531`). Confirmed
precisely, in order:

1. **`SalesReturn` + `SalesReturnItem` rows** (`:3320-3346`) — the header and one line per
   returned item, `return_pid` generated as `RET-{return_id:05d}` (`:3335`).
2. **Inventory** (`:3347-3375`), per line, skipped entirely for `Non-Inventory`/`Service` product
   types (`:3353-3354`, matches the sale-side check):
   - `InventoryLedger` row, `reason=RETURN_IN`, `qty_change=+quantity`,
     `reference_type="sales_returns"`, `reference_id=str(return_id)` (`:3355-3362`).
   - `_upsert_stock(db, variant_id, location_id, +quantity)` (`:3363`) — `current_stocks` delta,
     same helper `void_sale` uses (`:1762-1777`).
   - If the line has a `cost_layer_id` (i.e. it references the exact original `SaleItem`, not a
     blind return): the specific `CostLayer` row is locked (`with_for_update`) and
     `quantity_remaining = min(quantity_remaining + quantity, original_quantity)` (`:3364-3375`)
     — restores the *exact* layer the sale consumed from, upper-capped.
3. **AR ledger + customer balance** (`:3377-3399`) — fires only if `customer` is resolved
   (linked sale has a `customer_id`, or a blind return names one) **and** `disposition` is either
   `credit_to_account` or `cash_refund`. Both branches write the **identical** entry:
   `ArLedger(customer_id, amount_change=-grand_total, reason="RETURN", reference_type="sales_returns",
   reference_id=str(return_id))`, then `customer.outstanding_balance -= grand_total`. A return with
   no customer, or `disposition=None`, writes neither — inventory-only.
4. **Cash-refund `CustomerPayment` pair — "path 4"** (`:3401-3435`), fires only when
   `disposition == 'cash_refund'` **and** `payload.sale_id is not None` (blind cash refunds don't
   get one — nothing to tie it to). Finds the sale's largest non-AR-charge tender's payment mode,
   then creates:
   - `CustomerPayment(amount=-grand_total, unapplied_amount=0, notes=f"Cash refund for return
     #{return_id}")` — **no `return_id` column exists on `CustomerPayment`**; this `notes` string
     is the only link, and it's fully system-generated (never user-supplied, never edited
     afterward — an exact string match is reliable here, just not a real foreign key).
   - `CustomerPaymentApplied(payment_id, sale_id=payload.sale_id, amount_applied=-grand_total)`,
     inserted **directly** (`:3431-3435`) — **not** via `_apply_and_update`, so `sale.balance_due`
     is **never touched** by this write. This is load-bearing for §4.1 below.
5. **`create_return_and_exchange`'s additional step** (`:3488-3505`): after `_do_return` runs, it
   creates one more `Sale` row — `status="Draft"`, `origin_sale_id=<original sale_id>`,
   all amounts zeroed. This is an empty shell; the cashier fills it in and posts it later through
   the normal draft→post flow, entirely separate from the return itself. A guard
   (`:3470-3480`) blocks creating a second exchange while `Sale.origin_sale_id == this sale AND
   status != 'Voided'` already has a row — `_attach_exchange` (`:3219-3234`) uses the identical
   condition to resolve `SalesReturnOut.exchange_sale_id` for display. This reuse is exploited in
   §5.

**A return never touches the original `Sale`.** Grepped `_do_return`'s entire body for any write
to `sale.balance_due`, `sale.status`, or `sale.payment_status` (already confirmed in
`docs/returns_ground_truth.md` §2) — zero matches. So unlike a payment reversal or a sale void,
return-reversal has **no original-sale `balance_due` restoration step at all** — the return never
put anything there to take back.

## 3. Precedent survey — the origin-agnostic negate-the-ledger technique

| Endpoint | What it reads to know what to undo | Never re-derives from business rules |
|---|---|---|
| `void_sale` (`:2580-2727`) | `InventoryLedger WHERE reference_type='sales' AND reference_id=sale_id` for stock; `SaleItem.cost_layer_id` for FIFO; writes one `ArLedger ADJUSTMENT` for `-grand_total` | Yes — restores stock/layers from the ledger rows the sale actually wrote, not from re-running sale logic backwards |
| `reverse_payment` (`:3071-3183`) | `ArLedger WHERE reference_type='customer_payments' AND reference_id=payment_id` | Yes — `docs/payment_correction_proposal.md` §3's whole rationale: `record_customer_payment` and `create_payment` disagree on ledger shape, so reversal reads what was *actually written*, not which recipe created it |
| `bounce_pdc_check` | Same technique, PDC-specific | Yes |

**This is the established, load-bearing pattern in this codebase**, and it is what makes §5's
design safe to build without first fixing the bundle-return bug (investigation point 5, resolved
here):

For a bundle-line return, `docs/returns_ground_truth.md` §1 confirms what was *actually* written:
one `InventoryLedger(RETURN_IN, variant_id=<bundle variant>, ...)` row crediting phantom stock to
a variant that should hold none, **and nothing else** — the real component stock deducted at sale
time is never touched by the return (the bug is an *omission*, not a wrong value on a real write).
An origin-agnostic reversal that reads `InventoryLedger WHERE reference_type='sales_returns' AND
reference_id=return_id` and writes the exact negation:
- **Correctly cancels the phantom bundle-variant stock** — the only thing the return actually
  wrote, so the only thing there is to undo.
- **Does not, and should not, restore component stock** — the return never touched it, so there is
  nothing for a reversal of *that return* to restore. Component stock remains exactly as short
  after reversal as it was after the original (buggy) return — reversal does not make the
  pre-existing bug worse, and does not silently paper over it either.
- Net effect: reversing a bundle-affected return returns the system to *precisely* its
  pre-return-bug state for everything the return actually wrote (customer balance, ArLedger,
  bundle-variant phantom stock), which is exactly what a reversal is supposed to do. It does not,
  and is not expected to, fix the separate, still-open bundle-return gap — that remains exactly as
  filed in `docs/backlog.md`, untouched by this proposal.

**Verdict for investigation point 5: confirmed, not assumed.** The negate-what-was-actually-written
design is safe for buggy bundle returns without needing that bug fixed first, for the same
structural reason it's safe for `create_payment`/`record_customer_payment`'s accounting divergence.

## 4. Two things the investigation surfaced that shape the design

### 4.1 `reverse_payment` cannot be reused for the cash-refund `CustomerPayment` (path 4) — confirmed, not assumed

Design goal 3 asked whether `reverse_payment` can be called internally for the path-4 payment.
**It cannot, and calling it would introduce a new corruption bug**, not just fail to help:

- `reverse_payment`'s `balance_due` restoration step (`:3157-3172`) assumes every
  `CustomerPaymentApplied` row it finds was created by `_apply_and_update`, which *did* reduce
  `sale.balance_due` at creation for `mode_reduces_balance` modes — so restoring means *adding
  back* `apply.amount_applied`.
- The path-4 payment's `CustomerPaymentApplied` row was inserted **directly** (§2 point 4,
  `:3431-3435`), bypassing `_apply_and_update` entirely — `sale.balance_due` was **never touched**
  at creation.
- Calling `reverse_payment` on it would still run the restoration loop (its mode is a normal
  non-AR-charge tender, so `mode_reduces_balance=True`) and compute `sale.balance_due +=
  apply.amount_applied` — but `apply.amount_applied` is **negative** (`-grand_total`), so this
  would *decrease* `balance_due` by `grand_total` for a value that was never increased in the
  first place. A brand-new corruption, in the same family as the `is_ar_charge`/`balance_due` bug
  fixed earlier this session, self-inflicted by naively reusing the wrong tool.
- Separately, `reverse_payment` also queries `ArLedger WHERE reference_type='customer_payments'`
  for this `payment_id` — but this payment's only ledger effect was already written under
  `reference_type='sales_returns'` (§2 point 3, tagged to the *return*, not the payment). That
  query would find **zero rows**, so calling `reverse_payment` would silently do nothing on the
  ledger side while actively corrupting `balance_due` on the sale side. Worst of both outcomes.

**Conclusion: return-reversal needs its own, much simpler, targeted logic for this payment** — not
a reuse of `reverse_payment`, and not a re-implementation of its `balance_due` logic either.
Because the return's *only* `ArLedger`/`outstanding_balance` effect is already fully reversed by
negating the `reference_type='sales_returns'` rows (§5), and `sale.balance_due` was never touched
by this payment to begin with, the *entire* correction needed for path 4 is: **flip
`reversed_at`/`reversed_reason`/`reversed_by_user_id` directly on the `CustomerPayment` row** — the
same three columns `reverse_payment` uses, set directly rather than through that endpoint — so it
stops being counted live (§4.2) and is visible as reversed in payment history. No `ArLedger` write,
no `balance_due` touch, no double-reversal risk.

**Finding this payment**: no FK exists (`CustomerPayment` has no `return_id` column) — locate it
via `CustomerPayment.notes == f"Cash refund for return #{return_id}"`, which is exact and reliable
because that string is system-generated at creation and never user-edited (§2 point 4). Flagged as
an open question (§10) whether a real FK is worth adding instead.

### 4.2 The bridge-table `SUM`s this session just fixed need a `reversed_at` filter, or reversal will silently not "take" in the picker/aging views

Investigation point 3, traced precisely, not assumed. `get_ar_aging` (`:389-542`) and
`get_customer_ar_ledger_view` (`:546-...`, fixed earlier tonight to use the same technique) both
compute a per-sale `returns_by_sale_id` term:

```python
returns_by_sale_id = dict(
    db.query(models.SalesReturn.sale_id, func.sum(models.SalesReturn.grand_total))
    .filter(
        models.SalesReturn.sale_id.in_(active_sale_ids),
        models.SalesReturn.disposition == "credit_to_account",
    )
    .group_by(models.SalesReturn.sale_id)
    .all()
)
```

(`get_ar_aging` `:495-503`; `get_customer_ar_ledger_view`'s copy is structurally identical.)
**Neither has, nor currently could have, a `reversed_at` filter — that column doesn't exist yet.**
Once §6 adds it: without also adding `AND models.SalesReturn.reversed_at.is_(None)` here, a
reversed `credit_to_account` return would keep subtracting from `outstanding` **forever** — the
return's *actual* `ArLedger`/`outstanding_balance` effect would be correctly undone by §5's
reversal, but this bridge-table `SUM` would still count it, permanently understating every
affected invoice's displayed balance. **This must ship as part of this proposal, not as a
follow-up** — exactly the same "hard prerequisite, not parallel scope" relationship the AR-ledger
fix had to the payment-pooling picker earlier tonight.

**A second, pre-existing instance of the identical gap, found while tracing this** (not introduced
by this proposal, but surfaced by looking for the pattern): the `payments_by_sale_id` term right
next to it (`get_ar_aging` `:473-492`) filters `PaymentMode.is_ar_charge == False` but has **no**
`CustomerPayment.reversed_at`/`check_status` filter either — so a payment reversed via the
already-live `reverse_payment`, or bounced via `bounce_pdc_check`, is *also* still counted here
today, independent of anything this proposal touches. Recommending it be fixed in the same pass
(it's the same bug, in the query right next to the one being fixed, in a file already being
edited) rather than filed as a separate future item — but flagging explicitly since it's outside
this proposal's stated scope (returns), not silently bundling it in.

**Implementation note, precise on purpose** (a real landmine, not a minor detail): `check_status`
is nullable and only ever set for PDC payments. A naive `CustomerPayment.check_status != 'BOUNCED'`
filter would, under standard SQL `NULL` semantics, also **exclude every non-PDC payment** (`NULL !=
'BOUNCED'` evaluates to `NULL`, which a `WHERE` clause treats as false) — silently breaking the
aging report far worse than the bug being fixed. The correct form is
`or_(CustomerPayment.check_status.is_(None), CustomerPayment.check_status != 'BOUNCED')`, combined
with `CustomerPayment.reversed_at.is_(None)`.

## 5. Scope boundary: exchange-linked returns excluded from v1

Design goal 4. `create_return_and_exchange` returns are excluded — **reject with 400 if an active
exchange sale exists for this return.**

**Why, concretely traced**: `_attach_exchange` (`:3219-3234`) already computes exactly the
condition needed — a `Sale` with `origin_sale_id == ret.sale_id AND status != 'Voided'`. Three
states are possible for that paired sale at reversal time:

- **Still `Draft`** (cashier never finished the exchange) — `status != 'Voided'` is still true
  (Draft counts), so `exchange_sale_id` is populated and reversal is blocked. Matches intent: an
  abandoned draft still occupies the "one active exchange per sale" slot (`:3470-3480`'s own
  guard); the operator should delete it (`DELETE /sales/drafts/{id}`, already exists) before
  reversing the return that spawned it.
- **`Posted`** — the customer walked out with the exchanged item. Reversing the return underneath
  a completed exchange would let them keep both the original refund/credit *and* the new item,
  with no record connecting the two once the return says "never happened." Block it; the operator
  must `void_sale` the exchange first (existing mechanism, already reverses its own stock/AR
  impact cleanly), which flips its `status` to `Voided` — at which point `_attach_exchange` stops
  finding it, `exchange_sale_id` goes `null`, and the return becomes reversible.
- **`Voided`** — already excluded by `_attach_exchange`'s own filter, so `exchange_sale_id` is
  already `null` and reversal proceeds normally.

This is the same shape of decision `docs/payment_correction_proposal.md` §4 made for credit-memo
payments: *"the interaction is too cascading to safely automate in v1, exclude and point to the
existing single-purpose tool that already handles the linked record."* No new tracking or
cross-endpoint orchestration needed — the precondition reuses `_attach_exchange`'s existing
derivation verbatim.

**Recommendation**: reject with 400 and a message naming the concrete next step —
`"An active exchange sale (SALE-xxxxx) exists for this return; void it first."` when `Posted`, or
`"...; delete the draft first."` when `Draft` — rather than a generic refusal.

## 6. Proposed endpoint

```
POST /sales/returns/{return_id}/reverse
```

Matches `POST /sales/payments/{payment_id}/reverse`'s addressing convention (not nested under
`/customers/{id}` or `/sales/{sale_id}` — the return is already uniquely addressable).

### Request

```python
class ReturnReversalRequest(BaseModel):
    reversal_reason: str   # required, non-empty — mirrors PaymentReversalRequest
```

### Response

`schemas.SalesReturnOut`, extended with three new nullable fields (§6 DB changes) so the frontend
can show reversal state directly on the existing return record.

### Preconditions (400 unless noted)

1. Return exists (404 if not).
2. `ret.reversed_at is None` — not already reversed.
3. No active exchange sale — `_attach_exchange`-derived `exchange_sale_id is None` (§5).
4. `reversal_reason` non-empty (matches `reverse_payment`'s validation).

No precondition on the original sale's status. Unlike `reverse_payment` (which restores
`sale.balance_due` and therefore cares whether the sale is still `Posted`), a return never touched
`sale.balance_due` (§2) — its reversal has nothing sale-status-dependent to restore, so a return
against a since-voided sale is still safely reversible on its own terms.

### Transaction body (single `db.commit()`, `write_audit()` before it — per design goal 4, and
matching `reverse_payment`'s already-correct one-commit pattern rather than `create_return`'s own
two-commit tail, which this proposal does not otherwise touch)

1. `old_values = _serialize(ret)` before any mutation.
2. **Inventory reversal** — for each `SalesReturnItem` on this return (skip if the underlying
   variant's product is `Non-Inventory`/`Service`, same guard `_do_return` uses):
   - `InventoryLedger(qty_change=-quantity, reason=RETURN_OUT, reference_type="sales_returns",
     reference_id=str(return_id))` — `RETURN_OUT` already exists in `inventory.LedgerReason`
     (`inventory/models.py:20`), currently only used by supplier returns
     (`procurement/router.py:1065`, `reference_type="supplier_returns"` — no collision, disjoint
     `reference_type`). No enum migration needed.
   - `_upsert_stock(db, variant_id, location_id, -quantity)`.
   - If `cost_layer_id` is set: lock the layer (`with_for_update`) and
     `quantity_remaining = max(quantity_remaining - quantity, Decimal("0"))` — the exact inverse
     of `_do_return`'s restore step, lower-capped the same way that one is upper-capped.
3. **Customer-ledger reversal** — query `ArLedger WHERE reference_type='sales_returns' AND
   reference_id=str(return_id)`; for each row (0 or 1 in practice — §2 point 3 writes at most one),
   add an offsetting `ArLedger(amount_change=-row.amount_change, reason="ADJUSTMENT",
   reference_type="sales_returns", reference_id=str(return_id), notes=f"Reversal of return
   #{return_id}: {reversal_reason}")`; accumulate `total_delta`. If `ret.customer_id`:
   `customer.outstanding_balance -= total_delta` — mirrors `reverse_payment`'s
   `total_delta` accumulation exactly (`:3122-3145`), same sign convention.
4. **Cash-refund `CustomerPayment` (path 4), if one exists** — look up by
   `CustomerPayment.notes == f"Cash refund for return #{return_id}"` (§4.1). If found and not
   already reversed: set `reversed_at`/`reversed_reason`/`reversed_by_user_id` directly. **No**
   `ArLedger` write, **no** `sale.balance_due` touch (§4.1) — already fully covered by step 3.
5. Flag the return: `reversed_at = now()`, `reversed_reason = reversal_reason`,
   `reversed_by_user_id = _actor.user_id`.
6. `write_audit(db, "sales.sales_returns", str(return_id), "UPDATE", actor_user_id=_actor.user_id,
   old_values=old_values, new_values=_serialize(ret))` — before the commit, populating
   `old_values` (same first-real-use pattern `reverse_payment` established).
7. `db.commit()`.

## 7. Full reversal only — partial correction explicitly out of scope

Same rationale as `docs/payment_correction_proposal.md` §7: every reversal mechanism in this
codebase (`void_sale`, `bounce_pdc_check`, `reverse_payment`) is all-or-nothing, and a return adds
its own reason to keep it that way — a partial return-of-a-return would need to decide *which*
line items and *how much* of each to un-restore from inventory/cost layers, an allocation problem
with no unambiguous default, layered on top of the same problem `reverse_payment` already declined
to solve for payments. **Recommendation, matching the payment doc's own**: correcting a wrong
return = reverse it in full (reason referencing what was wrong), then process a new, correct return
through the existing endpoints. Both sides carry their own `write_audit` trail.

## 8. DB changes

Three new nullable columns on `sales.sales_returns`, mirroring `sales.sales`'s
`voided_at`/`void_reason` and `sales.customer_payments`'s `reversed_at`/`reversed_reason`/
`reversed_by_user_id` naming exactly (`docs/payment_correction_proposal.md` §6's precedent):

```sql
ALTER TABLE sales.sales_returns
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_reason VARCHAR(500),
    ADD COLUMN IF NOT EXISTS reversed_by_user_id INTEGER
        REFERENCES auth.users (user_id);
```

No boolean flag — state inferred from `reversed_at IS NOT NULL`, same convention used everywhere
else in this schema. Requires an Alembic migration (same shape as
`t0u1v2w3x4y5_add_reversal_fields_to_customer_payments.py`) and a `docs/schema.dbml` update.

`schemas.SalesReturnOut` gains:
```python
reversed_at:          Optional[datetime] = None
reversed_reason:      Optional[str]      = None
reversed_by_user_id:  Optional[int]      = None
```

Plus the `get_ar_aging`/`get_customer_ar_ledger_view` query changes from §4.2 (no schema/migration
impact — logic-only, same response shape).

`ArLedger.reason` reuses the existing `ADJUSTMENT` value (same as `void_sale`/`reverse_payment`'s
reversal entries) — no enum migration. `InventoryLedger.reason` reuses the existing `RETURN_OUT`
value (§6) — no enum migration either.

## 9. Permission

Same decision point `docs/payment_correction_proposal.md` §8 already framed for payment reversal —
**resolved the same way, and for a stronger reason here**:

**Recommended: new action `reverse_return`**, granted to `ADMIN` + `STORE_MANAGER` only, **not**
`CASHIER`. Confirmed precisely why reuse is unsafe: `create_return` is gated on `process_returns`
(`:3538`), and `CASHIER` **does** hold `process_returns` (`main.py:418`,
`_grant_actions("CASHIER", ["process_sale", "process_returns"])`) — unlike payments, where
`reverse_customer_payment` was already split out from `manage_customers` specifically because
`STORE_MANAGER` (not `CASHIER`) should hold it. Reusing `process_returns` for reversal would hand
every cashier the ability to reverse *any* return, a materially bigger privilege than creating one
— the exact inversion `reverse_customer_payment` was introduced to prevent on the payment side.
`ADMIN` gets it automatically (wildcard grant, `main.py:339-351`). Proposed seed entry:
`("reverse_return", "Reverse Return", "sales_returns")` — grouped under the `sales_returns`
program, matching `view_returns`/`export_returns`'s existing grouping (`main.py:235-236`), added to
`STORE_MANAGER`'s action list alongside `reverse_customer_payment` (`main.py:406`).

## 10. Open questions for you

1. §4.1's cash-refund payment lookup by exact `notes` string match — acceptable for v1, or should
   `sales.customer_payments` gain a real `return_id` FK now instead? The string match is reliable
   (system-generated, never edited) but architecturally a workaround; a real FK is a bigger change
   (migration + backfill consideration for existing path-4 payments) for cleaner traceability.

   **Decided:** notes-string match is acceptable for v1 — ship it as designed in §4.1. A real
   `return_id` FK on `sales.customer_payments` is tracked as future debt, not a v1 blocker.

2. §4.2's `payments_by_sale_id` fix (excluding reversed/bounced payments from the aging/AR-ledger
   `SUM`) is a pre-existing gap this investigation surfaced, not something this proposal's own
   scope requires touching. Fix it in the same pass as the `returns_by_sale_id` fix (same file,
   same bug shape, touched anyway), or file it separately and ship returns-reversal without it?

   **Decided:** bundle it into this same pass. It's a live, pre-existing bug in the same file
   already being edited for the `returns_by_sale_id` fix, not separate scope — both `SUM`s (in
   both `get_ar_aging` and `get_customer_ar_ledger_view`) get the `reversed_at`/`check_status`
   filtering together, including the NULL-semantics-safe form noted in §4.2.

3. §5's exchange-sale exclusion: any objection to the 400-with-specific-next-step message, or
   should reversing an exchange-linked return instead **cascade** into auto-voiding the paired
   exchange sale (more automated, but a bigger blast radius per action — two records change from
   one API call, which nothing else in this codebase's reversal precedent currently does)?

   **Decided:** reject with 400 and the specific next-step message (void the exchange sale first,
   or delete the draft first) — no cascade. Keeps exactly one record changed per reversal action,
   matching every other reversal in this codebase (`void_sale`, `reverse_payment`,
   `bounce_pdc_check` all touch one primary record plus its direct ledger consequences, never a
   second independent business record).

4. Confirm `reverse_return` as a new dedicated permission (§9) over reusing `process_returns`.

   **Decided:** confirmed — new dedicated permission `reverse_return`, granted to `ADMIN` +
   `STORE_MANAGER` only, not `CASHIER`, exactly as proposed in §9.
