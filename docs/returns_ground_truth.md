# Returns Ground Truth — Verification Pass (2026-07-10)

**Purpose**: verification only, no fixes implemented. This builds directly on
`docs/payment_ground_truth.md`'s discovery of a fourth payment-creation path living inside
returns logic, and investigates the returns flow end-to-end: stock impact, effect on the
original sale, the refund/payment path's integrity, credit-based returns, audit coverage, and
what prior documentation already says. Every claim is backed by a direct code read and/or
`file:line` citation as of 2026-07-10.

**Related documents**: `docs/payment_ground_truth.md` (the payment-side companion to this
document — read that first for the full payment-modes/creation-paths/idempotency picture);
`docs/customers_sales_process_flows.md` §2.4 (existing Returns/Exchanges section, written
earlier this session, now cross-checked and extended here); `docs/backlog.md` (all new gaps
below are filed there, cited inline). **`docs/customers_section_verification.md`** (2026-07-10)
is a later, separate verification pass covering voids/returns/charge-payments/PDC together —
it cites this document rather than re-deriving the returns findings, and notes the one
supersession (idempotency, below).

---

## 1. Stock/Inventory Impact

All return processing funnels through the shared helper `_do_return`
(`backend/sales/router.py:3033-3232`, does not commit — callers commit), backing both
`create_return` (`:3308-3329`) and `create_return_and_exchange` (`:3236-3306`).

### Normal (non-bundle) inventory items — correct, and via a *different* mechanism than the sale

For each returned line where a `sale_item_id` is given, the original `SaleItem.cost_layer_id`
is read directly (`:3099`) — **not** re-derived via a fresh FIFO lookup. Stock impact
(`:3142-3170`):

1. `InventoryLedger` entry, `reason=RETURN_IN`, `qty_change=+quantity` (`:3150-3157`).
2. `_upsert_stock(db, variant_id, location_id, +quantity)` (`:3158`).
3. If `cost_layer_id` is known: the exact original `CostLayer` row is locked
   (`with_for_update`) and `quantity_remaining = min(quantity_remaining + quantity,
   original_quantity)` (`:3159-3170`) — restoring the *specific* layer the sale consumed from,
   capped so it can never exceed what was originally there.

This is a targeted, precise restoration — a different (and more precise) mechanism than the
sale's own FIFO *consumption* logic (`_consume_fifo_for_sale`, which searches oldest-first
across layers). A return doesn't need to search; it already knows exactly which layer to
credit back, because the original `SaleItem` recorded it.

Non-Inventory/Service items are skipped entirely (`:3148-3149`, matches the same
`product_type` check used at sale time) — no ledger, no stock, consistent with the sale side.

### Bundle items — **a real gap found, reachable through the normal UI**

This required checking how a bundle sale's `SaleItem` rows actually look, since that
determines what a later return receives. At sale time (`post_draft`, `:1961-1997`), a bundle
line explodes into per-component `InventoryLedger`/`CurrentStock` writes (**no `SaleItem` row
per component**), and then creates exactly **one `SaleItem` at the bundle-variant level**,
explicitly commented *"revenue at bundle price, no cost data"* (`:1987-1996`) —
`variant_id` = the bundle's own variant_id, **`cost_layer_id` is never set** (defaults to
`None`).

Consequences for a return referencing that `sale_item_id`:

- `cost_layer_id = si.cost_layer_id` (`:3099`) → `None`, always, for a bundle line.
- The stock-impact block (`:3142-3170`) loads `variant_obj` by `v["variant_id"]` — the
  **bundle** variant — and checks only `product_type in ("Non-Inventory", "Service")`
  (`:3148`). A bundle's product is ordinarily `product_type = "Inventory"` (bundling is a
  variant-level concept via `bundle_components`, independent of `product_type`), so this check
  does **not** skip it.
- Result: `InventoryLedger(reason=RETURN_IN, variant_id=<bundle variant>, ...)` and
  `_upsert_stock(db, <bundle variant>, ...)` fire directly against the **bundle variant** —
  which, per `docs/requirements.md` §6.5, *"the bundle variant itself holds no stock"* (its
  available quantity is always derived from its components). This credits phantom stock to a
  variant that structurally never accumulates real stock through any other path in the system.
- The actual **component** stock that was deducted at sale time is **never restored** — there
  is no bundle-explosion equivalent anywhere in `_do_return`. Grepped the entire function for
  "bundle" — zero matches.
- Since `cost_layer_id` is `None` for the bundle-level `SaleItem`, the cost-layer restoration
  step (`:3159-3170`, gated on `cost_layer_id is not None`) never fires either — so even if
  component stock restoration existed, cost layers wouldn't be touched by this path as written.

**Confirmed reachable through the UI, not just a theoretical API edge case**:
`get_items_for_return` (`router.py:3395-3434`, backs the Return New page) returns every
`SaleItem` for the sale with no bundle exclusion (`:3412-3417`), and
`frontend/src/pages/sales/ReturnNew.tsx` has no bundle-related filtering either (grepped, zero
matches). A user can select a bundle line on the return form today and trigger this.

---

## 2. Original Sale Impact — a return is a fully separate record

Grepped `_do_return`'s entire body for any write to `sale.balance_due`, `sale.status`, or
`sale.payment_status` — **zero matches**. Confirmed: a return never touches any of these three
fields on the original `Sale` row. The sale stays `status = "Posted"` forever (there is no
"partially returned" or any other post-return status), and its `balance_due`/`payment_status`
remain exactly what they were at posting time (or after any subsequent payment activity),
completely independent of how many returns are later processed against it.

The relationship between a return and its sale is purely referential (`SalesReturn.sale_id`,
a nullable FK) and is *reconstructed by readers*, not reflected on the `Sale` row itself:
- `get_items_for_return` computes `already_returned` qty per variant by summing
  `sales_return_items` joined through `sales_returns.sale_id` (`:3419-3428`) — used only to
  pre-populate/validate the return form, not stored anywhere on `Sale`.
- `get_ar_aging` and `_build_customer_transaction_ledger` (documented in
  `docs/customers_sales_process_flows.md` §1.5, §6) separately factor in
  `sales_returns.grand_total` (aging, `credit_to_account` only) or the negative
  `CustomerPaymentApplied` row (transaction ledger / aging's payments-applied term, `cash_refund`
  — see §3 below) to derive an effective "what's still owed" figure, without ever writing that
  figure back onto `Sale`.

This is a clean, simple answer: **no, the sale's own status/balance_due/payment_status never
change; the return is entirely separate**, related only by foreign key.

---

## 3. The Refund/Payment Path — full findings (path 4 from the payment ground-truth pass)

Full detail already established in `docs/payment_ground_truth.md` §2 ("Path 4"); repeated here
in full per your instruction not to make you cross-reference, plus one addition specific to
this pass (return-level idempotency, which the payment doc didn't cover since it's about the
*return*, not the payment row).

### What triggers it

`payload.disposition == 'cash_refund' and payload.sale_id is not None` (`router.py:3196`) — a
linked (non-blind) return processed with `cash_refund` disposition. Blind refunds
(`sale_id is None`) never reach this branch.

### What writes the `CustomerPayment` row, exactly

1. Finds the largest non-AR-charge, non-AR-credit tender originally applied to the sale
   (`:3197-3210` — joins `CustomerPayment` → `CustomerPaymentApplied` → `PaymentMode`, filters
   `is_ar_charge=False` and `is_ar_credit=False`, orders by `amount_applied desc`).
2. If found, creates a **negative** `CustomerPayment` — `amount = -grand_total`,
   `unapplied_amount = 0`, `payment_mode_id` = the tender found above (`:3212-3223`).
3. Creates a matching negative `CustomerPaymentApplied` — `amount_applied = -grand_total`,
   against the same `sale_id` (`:3226-3230`).

### `write_audit()` coverage — **NO**, confirmed gap, same class as the ones fixed elsewhere this session

Neither the negative `CustomerPayment` nor its `CustomerPaymentApplied` row gets a dedicated
audit call. The only two `write_audit` calls anywhere near this code are in the *callers*
(`create_return` at `:3324`, `create_return_and_exchange` at `:3295`), and both are for the
`sales.sales_returns` table specifically — they audit the return record, not this payment
side-effect. This is the exact same shape of gap as the payment-audit issue fixed on
2026-07-08 for `record_customer_payment` and `post_draft`'s tender loop (see
`docs/changelog.md` "2026-07-08 — Fix: payment audit gap") — just never checked here until
now. **Candidate for the same fix technique**: add a `write_audit(db, "sales.customer_payments",
..., "INSERT", ...)` call for `neg_payment`, folded into the same commit as the rest of
`_do_return`'s caller.

### `ArLedger`/`outstanding_balance` accounting — correct, does NOT repeat the `apply_unapplied_payment` double-counting bug

This required reading the whole function, not just the negative-payment block. A few lines
above (`:3172-3194`), for **both** `credit_to_account` and `cash_refund` dispositions (when a
customer exists), `_do_return` already writes the complete AR/balance impact of the return:

```python
if payload.disposition == 'credit_to_account' and customer:
    db.add(models.ArLedger(customer_id=customer.customer_id, amount_change=-grand_total,
                            reason="RETURN", reference_type="sales_returns", reference_id=ref_id))
    customer.outstanding_balance = (customer.outstanding_balance or Decimal("0")) - grand_total

elif payload.disposition == 'cash_refund' and customer:
    db.add(models.ArLedger(customer_id=customer.customer_id, amount_change=-grand_total,
                            reason="RETURN", reference_type="sales_returns", reference_id=ref_id))
    customer.outstanding_balance = (customer.outstanding_balance or Decimal("0")) - grand_total
```
(`:3172-3194`, identical logic in both branches)

The negative `CustomerPayment`/`CustomerPaymentApplied` pair created afterward for `cash_refund`
does **not** call `_apply_and_update` (the shared helper every other payment-application path
uses), does **not** write a second `ArLedger` entry, and does **not** touch
`outstanding_balance` again. It is a deliberately ledger-silent historical record — its only
purpose is so the refund shows up in payment history. Bypassing `_apply_and_update` here is
correct, not an oversight: had it gone through that helper with a *negative* amount, the
helper's `sale.balance_due = max(sale.balance_due - amount, 0)` would have computed
`balance_due - (-grand_total)`, i.e. **increased** `balance_due` — incorrectly suggesting the
customer now owes more on the original sale because of an unrelated refund.

**Does the assumption "this money was never counted before" always hold here?** Yes — unlike
`apply_unapplied_payment`'s bug (which assumed a payment's unapplied remainder was never
ledger-counted, when `record_customer_payment` sometimes counts it upfront), this code path
doesn't make an assumption at all in that sense — it deliberately writes the AR impact exactly
once (`:3172-3194`) regardless of disposition, and the payment-history row is structurally
incapable of double-counting because it never touches the ledger a second time. There is one
downstream interaction worth flagging separately (below), but it is not a double-counting bug
in `_do_return` itself.

### Interaction with `sale_pid`, idempotency — **fixed 2026-07-10, after this document was written**

*Superseded 2026-07-10: the gap described below was real at the time this document was
written, and was fixed later the same day. See `docs/changelog.md` "2026-07-10 —
Duplicate-submission protection for CustomerPayment and SalesReturn" for the fix and live
verification evidence. Left in place below, unedited, as the historical record of what was
found — read it as "what the gap was," not "current state."*

- `sale_pid`: untouched by returns — not relevant here (returns don't create or rename sales,
  except the exchange path, which creates a fresh empty Draft with the normal `sale_pid`
  assignment rules applying at its own post time).
- **`SalesReturn` has no `idempotency_key`** — checked the model
  (`backend/sales/models.py:279-309`) in full; no such column exists, unlike `Sale`'s
  (`models.py:170`, `unique=True`).
- `SalesReturn.return_pid` **is** `unique=True` (`models.py:286`), but this is safe by
  construction, not by an equivalent guard to the `sale_pid` fix: it's deterministically derived
  from the auto-incrementing primary key — `return_pid = f"RET-{return_id:05d}"`
  (`router.py:3130`) — so a collision is structurally impossible; there was never a bug class
  here to fix (returns are also never "voided," so there's no reuse-after-void scenario
  analogous to the `sale_pid` fix either).
- **Confirmed gap**: with no `idempotency_key` and no other duplicate-submission guard, a
  double-click or network retry on "Process Return" can create two separate `SalesReturn`
  records for the same physical event — each independently reversing stock, restoring cost
  layers, writing an `ArLedger` `RETURN` entry, and (for `cash_refund`) creating a duplicate
  negative payment. This is the same idempotency-gap class already filed in `docs/backlog.md`
  ("Payment creation has no duplicate-submission protection") — but for the *return* itself,
  not just the payment row inside it. Not previously filed; see the new backlog entry below.

---

## 4. Credit-Based Returns — no automatic link to the credit-memo lifecycle

`SalesReturnCreate.disposition` (`backend/sales/schemas.py:518`) is a **plain, unconstrained
string** — `disposition: Optional[str] = None   # 'cash_refund' or 'credit_to_account'` — not
an enum, not a `Literal`. `_do_return` only branches on exactly those two values
(`:3172`, `:3184`/`:3196`).

**`docs/schema.dbml:483` is stale**: its inline note reads
`disposition varchar [note: 'cash_refund | credit_memo | credit_to_account']` — three values,
including `credit_memo`. But the migration that actually added this column
(`docs/changelog.md`, "2026-06-06 — Return disposition, ledger fixes, workstation tender,
theme CSS") documents it as *"Adds `disposition VARCHAR(20)` (values: `cash_refund`,
`credit_to_account`)"* — **two** values. `credit_memo` was never implemented as a third
disposition; `schema.dbml`'s comment documenting it appears to be an error, not a dropped
feature (no code, migration, or other changelog entry anywhere references a `credit_memo`
disposition branch).

**`credit_to_account` does not create or touch a `CreditMemo` row at all.** It's a direct
`ArLedger`/`outstanding_balance` reduction (`:3172-3182`) — conceptually "apply this return's
value straight to the customer's account balance," entirely separate from the credit-memo
(store-credit-certificate) mechanism.

**Credit memos and returns relate only through an optional, fully manual link**:
`CreditMemoCreate.return_id: Optional[int] = None` (`schemas.py:617`) is caller-supplied — a
user issuing a credit memo via the Credit Memos page (`frontend/src/pages/customers/
CreditMemo.tsx`) *may* choose to reference a return, but nothing in `_do_return`,
`create_return`, or `create_return_and_exchange` ever populates this automatically. Confirmed
by grepping both `ReturnNew.tsx` and `ReturnDetail.tsx` for any credit-memo reference — zero
matches in either file. There is no "Issue Credit Memo" button or follow-up flow from
processing a return; if a business wants to give a customer a credit memo *because of* a
return, that's two entirely separate, manually-connected actions today.

**A real, reachable validation gap, distinct from the above**: since `disposition` is
unconstrained at the schema level, a direct API call (not the normal UI, which only ever sends
one of the two valid values via its two radio buttons — `ReturnNew.tsx:61,330-337`) could send
any other string, or omit `disposition` entirely. In either case, neither `if` branch
(`:3172`, `:3184`) matches — the return would process (stock reverses, `SalesReturn`/
`SalesReturnItem` rows created) with **zero financial impact**: no `ArLedger` entry, no
`outstanding_balance` change, no negative payment, no credit memo. The merchandise comes back
but no debt reduction or credit record of any kind is created for the customer. Not reachable
through the current frontend, but reachable via the API layer as written.

---

## 5. Audit Trail Coverage — full map for the returns flow

| Write | `write_audit()`? | Citation |
|---|---|---|
| `SalesReturn` (the return header) | ✅ | `create_return` `:3324`, `create_return_and_exchange` `:3295` — both `sales.sales_returns`, `INSERT` |
| `SalesReturnItem` (per line) | ❌ | No audit call anywhere near `:3133-3141` |
| `InventoryLedger` `RETURN_IN` entries | ❌ | No audit call near `:3150-3157` |
| `CostLayer.quantity_remaining` restoration | ❌ | No audit call near `:3159-3170` |
| `ArLedger` `RETURN` entry | ❌ | No audit call near `:3172-3194` |
| `customer.outstanding_balance` update | ❌ | Same block, no audit |
| Negative `CustomerPayment` (cash refund) | ❌ | Confirmed in §3 above |
| Negative `CustomerPaymentApplied` (cash refund) | ❌ | Confirmed in §3 above |
| Exchange Draft `Sale` creation (`create_return_and_exchange`) | ❌ | The only audit call in that function (`:3295`) is for the return, not the new draft sale row |

**Reading this table**: exactly one row out of nine gets an audit entry — the top-level
`SalesReturn` insert. Every other write triggered by processing a return (line items, stock
reversal, cost-layer restoration, AR ledger, balance update, and the cash-refund payment
side-effect) has no audit trail at all today.

---

## 6. Docs Check — what was already known

- **`docs/backlog.md:191`** (Customer Transaction Ledger entry, 2026-07-03): *"Known gap: voided
  AR-charged sales are excluded from this ledger... returns credited to account against an
  AR-charged sale also don't appear as rows."* — a related, previously-known limitation in a
  *reader* (the transaction ledger), not the same as anything found in this pass, but adjacent.
- **`docs/changelog.md`, "2026-06-06 — Return disposition, ledger fixes..."**: this is where
  the `disposition` column was added (two values, per that entry — confirming `schema.dbml`'s
  three-value note is stale, §4 above) and where the `credit_to_account` gating was first
  introduced — previously, per that same entry, *any* customer return wrote an AR entry
  regardless of disposition; the fix scoped it to `credit_to_account` only.
- **`docs/changelog.md`, "2026-06-11 — Cash refund return flow: AR entry, negative payment,
  Collections deduction"**: this is where the `cash_refund` branch and the negative-payment
  mechanism (path 4) were actually built — confirming this is deliberate, designed behavior,
  not an accidental side effect, and that it was specifically designed to net out correctly in
  `get_sales_summary`'s Collections figures.
- **`docs/changelog.md`, "2026-06-11 — AR Aging Report: per-invoice redesign..."**: *"Return
  credit offset now explicitly filters `disposition = 'credit_to_account'`; the old query
  summed all `sales_returns.grand_total` regardless of disposition, incorrectly offsetting
  cash-refund returns against the AR balance."* This is exactly the mechanism behind the
  aging-inflation risk already filed in `docs/backlog.md` ("Cash-refund negative payment may
  inflate Customer Aging") — that fix correctly excluded `cash_refund` from the
  `returns_credit` term, but (per this session's ground-truth pass) may not have accounted for
  the negative `CustomerPaymentApplied` row leaking into the *other* term
  (`payments_applied`) instead. Not re-derived here — see that backlog entry and
  `docs/payment_ground_truth.md` §2 for the full reasoning.
- No prior mention anywhere in either doc of: the bundle-return stock gap, the missing
  `SalesReturn.idempotency_key`, the missing `write_audit` coverage across the returns flow
  (beyond the return header itself), or the unconstrained `disposition` validation gap. All
  four are new findings from this pass.

---

## Final Verdict — summary

1. **Stock/inventory impact**: correct and precise for normal inventory items — restores the
   *exact* original cost layer rather than re-running FIFO, a different (and more accurate)
   mechanism than the sale's own consumption logic. **Confirmed real gap for bundle items**:
   bundle sales record their `SaleItem` at the bundle-variant level with no `cost_layer_id`;
   returns has no bundle-explosion logic, so returning a bundle line credits phantom stock to a
   variant that structurally never holds stock and never restores the actual component stock or
   cost layers. Reachable through the normal Return New page today.

2. **Original sale impact**: none. `sale.status`/`balance_due`/`payment_status` are never
   touched by a return — confirmed by grep, zero matches. A return is a fully separate record,
   related only by foreign key, with the relationship reconstructed by readers rather than
   reflected on the sale itself.

3. **Refund/payment path (path 4)**: triggered by `disposition == 'cash_refund'` on a linked
   return. **No `write_audit` coverage** — the same gap class fixed elsewhere this session,
   never checked here until now; a clear candidate for the same fix. **`ArLedger`/balance
   accounting is correct** and does not repeat the `apply_unapplied_payment` double-counting
   bug — the negative payment row is deliberately ledger-silent, and skipping the shared
   `_apply_and_update` helper here is the right call, not an oversight. **Idempotency: fixed
   2026-07-10** (superseded — was absent when this document was written; `SalesReturn` now has
   its own `idempotency_key`, same shape as `Sale`'s. See `docs/changelog.md` 2026-07-10.)

4. **Credit-based returns**: `credit_to_account` disposition never creates or touches a credit
   memo — it's a direct AR/balance reduction. Credit memos link to returns only through an
   optional, fully manual `return_id` field with zero automatic wiring or UI linkage in either
   direction. `docs/schema.dbml`'s documented third disposition value (`credit_memo`) was never
   actually implemented — a stale doc comment, not a missing feature. Separately, since
   `disposition` is unconstrained at the API layer, an unrecognized value or omission silently
   produces a return with zero financial impact — not reachable via the current UI, but
   reachable via direct API use.

5. **Audit trail**: one write out of nine in the entire returns flow is audited (the
   `SalesReturn` row itself). Line items, stock reversal, cost-layer restoration, the AR ledger
   entry, the balance update, and the cash-refund payment are all unaudited.

6. **Docs**: the `disposition`/AR-gating history and the cash-refund mechanism's deliberate
   design are both well-documented in `docs/changelog.md`. The bundle-return gap, the missing
   return-level idempotency key, the near-total lack of audit coverage beyond the return header,
   and the unconstrained-disposition validation gap are all new findings from this pass, not
   previously documented anywhere.

No fixes implemented. All new gaps above are candidates for the same fix techniques already
proven elsewhere this session (audit-trail wiring, idempotency keys) — filed to
`docs/backlog.md`, not applied.
