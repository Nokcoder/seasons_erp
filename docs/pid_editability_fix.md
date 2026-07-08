# PID Editability, Barcode Resolution & Import Anchor — Fix Batch

## Overview
This batch makes PID editable on Product Detail with clean-break
rename behavior (no history tracking), introduces a computed barcode
resolver (forward and reverse) so the PID-as-barcode fallback is
never written or synced, closes the cross-namespace collision gap
with a DB-level trigger, and makes the bulk import anchor
variant_id-aware so PID edits survive round-trip exports without
creating duplicates. Supersedes all prior drafts of this fix batch.
References `/docs/inventory_catalogue.md` (Product Detail, Catalogue
export) and `/docs/ui_standards.md` §2 (import upsert) and §8
(UOM/bundle concepts). Implement in order. Do not modify working
functionality.

---

## Fix 1 — Unlock PID field on Product Detail

- On `/inventory/:variant_id`, PID becomes inline-editable like every
  other field on the page. No separate edit mode; Save button appears
  on change, same as the rest of the form.
- Uniqueness validation checks PID against current `variants.PID`
  values only. No history table — a renamed PID is immediately free
  for reuse on any other variant.
- The entire Save on this page is one transaction. If any field in
  the save (including PID) fails validation, the whole save rolls
  back — no partial application of unrelated field changes.

## Fix 2 — Computed barcode resolver (forward and reverse)

**Forward direction — variant → scannable value.** Computed at read
time wherever a scannable value is displayed (Product Detail, label
printing, catalogue export). Never written or materialized.
  1. Look up the variant's product's `base_uom_id`
     (`variant → product → base_uom_id`).
  2. Check `variant_barcodes` for a row on this variant where
     `is_primary = true` and `uom_id = base_uom_id`.
  3. If found, return that barcode value.
  4. If not found, return `variants.PID` as the computed fallback.
  Fallback applies ONLY at the base UOM — any other UOM has no PID
  fallback; no explicit row means no scannable value for that pack
  size.

**Reverse direction — scanned string → variant.** Required for POS
scan lookup and receiving/transfer/warehouse count scans. Given a
scanned string:
  1. Check `variant_barcodes` for a row where `barcode` matches the
     scanned string. If found, resolve to that variant.
  2. If no match, check `variants.PID` for a current, non-deleted
     variant matching the scanned string. If found, resolve to that
     variant.
  3. If neither matches, return "item not found."
  A PID that has been renamed away from is not matched by either
  step — scanning an old, renamed-away PID returns no result, unless
  a different variant has since been assigned that value as its
  current PID, in which case it correctly resolves to that variant
  instead.

- On PID rename save: if the resolver currently falls back to PID for
  this variant (no explicit primary base-UOM barcode), show: "This
  item has no barcode on file — its scannable code will change to
  match the new PID. Reprint any physical labels currently in use."
  If an explicit primary base-UOM barcode exists, no warning — the
  barcode is unaffected.

## Fix 3 — Cross-namespace collision enforcement (DB trigger + app check)

- App-level check at save time (Product Detail and import) for a
  clean validation-error message: reject if the new PID matches any
  other variant's explicit `variant_barcodes.barcode`, or if a new
  explicit barcode matches any other variant's current PID.
- DB-level enforcement (the actual guarantee, closes the race
  condition and any write path that bypasses app validation):
  - `BEFORE INSERT OR UPDATE` trigger on `variants`: reject if
    `NEW.PID` exists anywhere in `variant_barcodes.barcode`.
  - `BEFORE INSERT OR UPDATE` trigger on `variant_barcodes`: reject
    if `NEW.barcode` exists anywhere in `variants.PID`.
- Plain PID-vs-PID uniqueness is already covered by the existing
  UNIQUE constraint on `variants.PID` — no new logic needed there.
- Collision handling differs by context:
  - **Product Detail single save**: whole save rolls back (per Fix 1).
  - **Bulk import**: only the offending row fails. It appears in the
    diff modal as a failed row with the collision reason shown; all
    other rows in the batch commit normally. Import handler must
    catch the trigger-level rejection per-row, not let it abort the
    whole batch.

## Fix 4 — No backward-compatible PID lookup

- No new tables, no PID history, no fallback resolution for old PID
  values anywhere — imports, barcode scans, or search.
- Import upsert logic is otherwise unchanged: see Fix 5 for the one
  addition (variant_id-aware anchor).

## Fix 5 — variant_id-aware import anchor

- Add `variant_id` as:
  - An available column in the Catalogue "Additional Fields" export
    toggle.
  - An optional column in the Product Catalogue import template.
- Anchor precedence on import:
  1. If a row has `variant_id` populated:
     - If it matches an existing, non-deleted variant → match on
       `variant_id`. PID in that row is now just another diffed
       field, shown in the diff modal as "PID: OLD → NEW" like any
       other change.
     - If it does NOT match any existing, non-deleted variant (typo,
       stale export, deleted record) → row-level error ("variant_id
       not found"). Do NOT fall back to PID-anchor for this row — do
       not silently create a new variant.
  2. If `variant_id` is blank or absent, fall back to current
     behavior exactly: PID as anchor, found → update, not found →
     create.
- This keeps external import sources (supplier feeds, anything with
  no knowledge of your internal variant_id) working exactly as before
  — they simply can't rename PID through that channel, which is
  correct since they never had visibility into it being renameable.

---

## Smoke tests
1. Rename a variant's PID with no explicit barcode. Confirm the
   forward resolver returns the new PID immediately, no row written
   to `variant_barcodes`, reprint warning appeared on save.
2. Rename a variant's PID that has an explicit primary base-UOM
   barcode. Confirm no warning, barcode unchanged.
3. Attempt to set an explicit barcode equal to another variant's
   current PID — confirm app-level rejection.
4. Attempt to rename a PID to match another variant's explicit
   barcode — confirm app-level rejection.
5. Bypass app validation directly at the DB layer (e.g. a raw insert)
   to confirm the trigger independently rejects both collision
   directions.
6. Export the catalogue with `variant_id` included, edit a PID value
   in the file, re-import. Confirm it updates the existing variant
   rather than creating a duplicate, and the diff modal shows the PID
   change.
7. Import a row with a `variant_id` that doesn't exist (or points to a
   soft-deleted variant). Confirm it fails as a row-level error and
   does not fall back to creating via PID.
8. Import a batch where one row has a PID/barcode collision. Confirm
   only that row fails in the diff modal and all other rows commit.
9. Re-import a spreadsheet using a PID that was since renamed away
   (no `variant_id` column present). Confirm it creates a new variant
   and the old PID is freely reusable elsewhere.
10. Rename variant A's PID from `PID-001` to `PID-002` (no explicit
    barcode on A). Scan `PID-001` — confirm "item not found." Then
    assign `PID-001` as variant B's new PID and scan again — confirm
    it now correctly resolves to variant B.

## Out of scope
- No changes to `inventory_ledger`, `cost_layers`, `transfer_items`,
  or any other table referencing `variant_id` — a PID rename has zero
  impact on historical records.
- No audit-log changes — `old_values`/`new_values` on UPDATE already
  captures PID renames.
- UOM seed data / can't-delete-to-zero rule is a separate fix, not
  part of this batch.