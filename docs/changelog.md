# Changelog

## 2026-07-23 — Receipt printing decoupled from `view_sales_ledger` (`print_receipts` permission)

`GET /sales/{sale_id}/receipt-data` — the sole data source for both the Workstation
post-sale print flow and SaleDetail's "Reprint receipt" — was gated on
`view_sales_ledger`, so a CASHIER (process_sale/process_returns only) got a Print
Receipt button that always 403'd, and STORE_MANAGER printed only as a side effect of
ledger access. The endpoint now requires a dedicated **`print_receipts`** action
(seeded under the **sales_workstation** program, so it renders as a toggleable
checkbox under POS Workstation in the Permission Matrix — CASHIER already has that
program). `tenancy/rbac_seed.py` grants it to **CASHIER** and **STORE_MANAGER** for
new tenants; ADMIN keeps the tenant-creation wildcard.

**Existing tenants (deploy note):** per the established seeding rules, a new
`action_key` is never backfilled onto existing roles — `print_receipts` must be
manually granted via Settings → Roles (ADMIN, CASHIER, STORE_MANAGER, and any custom
role that should print) or receipt printing 403s at checkout after this deploys. No
data migration; catalog row appears on next backend startup. `view_sales_ledger` no
longer implies print capability anywhere; `manage_print_templates` (template editing
+ receipt toggles) is unchanged and remains a separate axis.

## 2026-07-22 — Print templates moved to the database (server-side, shared across terminals)

Templates and function assignments moved off device-local `platformStore` into the
DB so a template designed on one terminal exists on every terminal (and survives a
browser-data clear). Built in phases:

**Phase 1 — schema (`aa77bb88cc99`).** `settings.print_templates` (UUID PK,
`tenant_id`, `name`, `doc_type` plain VARCHAR, `template` JSONB, audit fields,
`is_deleted`) and `settings.print_function_assignments` (`tenant_id`,
`function_key`, `template_id` FK, `UNIQUE(tenant_id, function_key)`). Both follow
the tenant/RLS recipe with the **hardened** `nullif(current_setting('app.tenant_id',
true), '')::integer` predicate — used for the `tenant_id` column default too. RLS
verified: three-way no-context probe (pristine/empty/RESET → 0 rows), cross-tenant
isolation, and WITH CHECK write rejection.

**Phase 2 — API (`/print`).** Reads auth-only (cashiers resolve at checkout):
`GET /print/templates`, `/templates/{id}`, `/functions`, `/functions/{key}/template`
(resolve — a soft-deleted assigned template returns `assigned:false`, HTTP 200, so
the client falls back to the built-in default; never 404/500). Writes gated on
`manage_print_templates`: `POST`/`PATCH`/`DELETE` (soft) templates, `PUT` assign.
`audit_log` written on every write (`_serialize` extended for UUID PKs). Permission
gates, cross-tenant isolation, and soft-delete-resolve all verified live. `POST`
returns a clean **409 Conflict** (not a raw 500) when the supplied `template_id`
already exists — RLS-scoped pre-check for a friendly message, plus an
`IntegrityError` safety net for a race / cross-tenant id collision.

**Phase 3 — frontend swap + offline cache.** `useTemplateLibrary` /
`useFunctionAssignments` now call `/print` (optimistic local state + async sync;
`useAssignedTemplate` resolves from the server). Checkout fallback chain:
**server → local read-through cache → built-in default** — every successful resolve
caches the template in `print-settings.json` per tenant+function; on a network
failure the cache serves it, and if the cache is empty too, the built-in default. A
failed save surfaces a red banner to the admin (never a silent success). Device-local
settings untouched (`receiptPrintingOverride`, `receiptAutoPrintOverride`, device
`printCalibration`); the per-template `calibrationOffsetXMm/YMm` rides along in the
template JSON to the server.

**Phase 4 — import action.** Admin "Import N local templates to the server" button
in Settings → Print Templates (only shown when device-local templates exist). Shows
a preview of exactly what will upload, **preserves existing UUIDs** (POST with
`template_id`), and is **idempotent + non-clobbering**: templates already on the
server (matched by id) are skipped, and assignments are **fill-only** (applied only
where the server has no assignment for that function), so a re-run changes nothing.
On a fully clean import the local keys are cleared. Verified: UUID preservation and
assignment idempotency live; 5/5 preview-logic checks (first run, idempotent re-run,
partial, dangling-target drop, non-clobber of a differing server assignment).

Build + lint clean; adapter round-trip + all Phase 1/2/4 checks pass.

## 2026-07-22 — Print designer: separate doc-id/date fields + positioning freedom + print calibration

**Part A — Document ID and Date as separate cells.** `receiptNo`/`salePid`/`date`
were already separate header sources and individually placeable via the new field
cells, but the default template still shipped a combined `documentMeta` block. The
default now uses **two separate field cells** (Receipt no. + Date) at independent
positions, so out-of-box they align to a pre-printed form's separate blanks. The
`documentMeta` composite block remains available in the palette.

**Part B — Positioning freedom + print calibration.**
- **Relaxed clamps.** Element X/Y was floored at 0 (drag/band clamps + `bounds="parent"`),
  so negative/off-paper positions were impossible via drag. Now elements and the row
  band can be positioned into a **bleed margin** (±20mm beyond the paper) for aligning
  to pre-printed stock; any element sitting off the paper is **outlined in red** in the
  designer (it will clip at print). The canvas gained bleed padding so off-paper
  elements stay visible/reachable. (Cells stay bounded to their band — the band moves
  for alignment.) The print page still clips at the paper edge (`.print-page`
  overflow:hidden) — nothing can print beyond the physical sheet.
- **Print calibration offset (the real alignment fix).** A per-template `calibration
  Offset X/Y (mm)` (designer toolbar) **plus** a per-terminal device offset (adjustable
  from the receipt preview bar, stored device-local in `platformStore` per tenant) —
  **added together** and applied to ALL elements at print time via one `translate` on
  the page content. Feed alignment varies by printer, so a device can correct globally
  (print a test, nudge X/Y, reprint) without touching the template or per-cell coords.
  Distinct from `gridOffsetX/Y` (designer snap grid only).
- **Physical limit (documented, not overridable):** printers enforce a hardware
  unprintable margin (~3–5mm, larger on the feed edge). `@page margin:0`, negative
  coords, and calibration cannot reclaim it — alignment works within the printable
  area only.

Build + lint clean. 3/3 checks (default split into separate field cells + no
documentMeta; calibration translate = template + terminal offset, additive, default
0; bleed clamp allows bounded negative/beyond + outside-paper detection). Deployed.

## 2026-07-22 — Print designer: header field cells + multi-page pagination

Two features. (A) **Header field cells** and (B) **pagination**.

**A — Header field cells.** Previously header data (date, customer, receipt no,
business name, totals) could only be placed via the four fixed composite blocks —
you couldn't drop just "Date" as a positioned, format-controllable cell. Added a
new `kind: 'field'` element: a positioned, drag/resize header-value cell using the
same binding editor as line-item cells (single or composed), now fed either
`RECEIPT_LINE_ITEM_SOURCES` (row cells) or `RECEIPT_HEADER_SOURCES` (fields) via a
shared `BindingEditor` component. Date-bound fields get a **date format** option
(As stored / MM/DD/YYYY / DD/MM/YYYY / Month D, YYYY / Mon D, YYYY) so the raw ISO
value fits a pre-printed "Date: ____" line. Palette gains "+ Field"; the adapter
and sample data expose the header keyed by source id for resolution.

**B — Pagination (replaces the interim maxRows cap-and-drop).** `TemplateRenderer`
now emits N paper-sized `.print-page` containers driven by CSS page breaks
(`break-after: page`, `break-inside: avoid`, `@page margin: 0`) — no react-to-print
change needed. Model (`pagination.js`, pure/tested):
- Same pre-printed stock every page: `bandTop`, band height, and
  `rowsPerPage = maxRows ?? floor((paperHeight − bandTop) / pitch)` are uniform.
  `maxRows` now means **rows per page** (overflow **spills** to the next page
  instead of vanishing); the inspector field is relabelled "Rows / page".
- `numPages = max(1, ceil(items / rowsPerPage))`; items chunk uniformly; each page
  restarts the row counter at `bandTop + n·pitch`.
- Per-element `pageScope` ('all' | 'first' | 'last') with smart defaults: header
  fields/blocks `all`, totals block and totals-valued fields `last`. Header values
  print on every page (each sheet self-identifies); totals only on the final page.
  Software draws no ruling/labels — only positioned value cells fill.
- On-screen preview shows N stacked sheets.
- Overlap guard: a designer **warning** when a last-page element (totals) sits
  inside the line-item band region (would misprint on a full last page).
- Edge cases handled: zero items → one page (totals shown); exact-multiple last
  page → no spurious trailing page; long composed Description clips in its cell.

Build + lint clean. 7/7 pure logic checks (rowsPerPage/pageCount, uniform chunking
with identical per-page row positions and nothing dropped, pageScope defaults +
filtering, band-overlap guard, date formats, header field resolution) and 4/4
server-render checks (`renderToStaticMarkup`: 4 items→1 page, 20→2, 25→3, 0→1 —
totals last-only, header/date on every page, first row at bandTop on each page, all
rows spilled). Deployed to the tunnel.

## 2026-07-21 — Print designer: line-item row band width, row-count indicator, ghost preview

Three follow-up fixes on the line-item row band (temporary `[LIR-*]` drag
diagnostics removed):

- **Band width is now an explicit, resizable property.** Previously the band was
  hardcoded to `paperWidth − x` (~200mm to the paper's right edge) with resizing
  disabled, so it claimed space it didn't own. Now the row stores an explicit
  `width` and the band resizes left/right like a text box (height stays tied to
  `repeatIntervalMm`). New rows default to the **cells' extent** (190mm for the
  default 4-cell row), not the full paper. The band's `minWidth` clamps to the
  cells' current extent, so it can never be shrunk narrower than its cells — the
  band always visually contains them; older rows with no stored width fall back to
  that extent. Added a **Width** field to the row inspector. (Band width is
  designer-only; print positions cells by their own `x`/`width` regardless.)
- **Row-count indicator now reflects `maxRows`.** The ghost slots were fixed at
  `min(pageFit − 1, 11)` and ignored `maxRows` entirely — setting it did nothing.
  Now the slot count = `maxRows` when set (declared − 1 ghosts), and when uncapped
  shows how many rows actually fit on the remaining page (real capacity against a
  pre-printed form). Hard-capped at 200 nodes.
- **Ghost rows now preview real content.** They were empty dashed outlines; they
  now render faded representative sample content (reusing `getSampleData`) resolved
  through each cell's binding, so the repeat preview is truthful — the editable row
  still shows binding labels, the ghosts show what the data will look like.

Build + lint clean; 4/4 logic checks (default width, band-width clamp, ghost-count
vs maxRows, ghost sample resolution). Deployed to the tunnel.

## 2026-07-21 — Print designer: line-item row usability fixes (selectable/draggable row, cell freedom, add-cell, keyboard delete)

Follow-up to the row-template pivot, fixing a live bug report that the Line Items
Row tool was unwieldy. Six issues addressed:

- **Row selectability + drag (root cause).** The band's cells occluded nearly the
  whole background, leaving only a ~10mm strip clickable, and the band was a plain
  `<div>` (not draggable). The band is now a react-rnd element with a dedicated
  **header grab-handle** ("⠿ Line item row") floating above it — the handle is
  both the click-to-select target and the drag handle (`dragHandleClassName`), so
  the whole row repositions like a text box while cells still drag independently.
  Inspector X/Y remain as precise entry. (`DesignerCanvas.jsx`, `designer.css`.)
- **Cell vertical freedom + snap.** Cells stay bounded to one row slot (height =
  `repeatIntervalMm`) — the max that keeps printed rows non-overlapping; raise the
  pitch for more room and the band grows live. Added a toolbar **"Snap to grid"**
  toggle (default on) governing *all* draggable elements (text, blocks, row, cells)
  uniformly — off = free ~0.1mm positioning for aligning to pre-printed forms.
- **Add cell.** New per-row **"+ Add cell"** button in the row inspector (deletion
  was previously the only cell op). New cells get a sensible default position (just
  right of existing cells, clamped to the band), size, and single-source binding.
- **Selection clarity.** The inspector now leads with a color-coded banner naming
  the selection — "Line item row" (teal), "Cell: <binding>" (indigo, via
  `describeBinding`), "Text box", or "Block: <name>" — so row-vs-cell (and which
  cell) is unmistakable, not just a subtle border color.
- **Keyboard delete (app-wide).** Delete/Backspace now removes any selected element
  (text box, data block, row, or cell), guarded so it never fires while typing in
  an input/textarea/select or editing a text box. Was previously toolbar-only.

Build + lint clean; shared resolution modules unchanged (10/10 logic checks still
pass). Deployed to the tunnel for live verification.

## 2026-07-21 — Print designer: row-template pivot (positioned repeating cells replace the table column editor)

Replaced the line-items **table** (a positioned block with a side-panel column
editor) with a positioned, repeating **row template** — cells you drag/resize
like text boxes, repeated at a fixed pitch per line item. Hard replacement, no
legacy path (safe: no real templates exist on any device yet). Pagination is
explicitly the NEXT phase — this only lays the row template + interim overflow.

- **Data model**: new element `{ kind: 'lineItemRow', x, y, repeatIntervalMm,
  maxRows, cells: [{ id, x, y, width, height, binding, align?, fontFamily?,
  fontSize?, color? }] }`. Cell `x/y` are relative to the row origin; `binding`
  is `{source}` or `{composed:{sources[],separator}}` (same shape the old columns
  used). `receiptSources.js` is unchanged — still the single source of truth for
  which line-item fields exist.
- **Resolution** (`columnResolution.js`): `resolveColumnValue` → `resolveBindingValue`
  (logic identical; it now resolves a cell binding, not a table column). Added
  `describeBinding` (designer labels) and `DEFAULT_LINE_ITEM_CELLS` /
  `DEFAULT_LINE_ITEM_ROW`. Removed `resolveTableColumns` and
  `DEFAULT_LINE_ITEM_COLUMNS`.
- **Removed entirely**: the TemplateDesigner column editor (add/remove/reorder/
  width UI), the `lineItemsTable` block (dropped from `blockTypes.js`), the
  table-rendering path + `<colgroup>` in TemplateRenderer, and the fake-table
  placeholder in DesignerCanvas.
- **Designer UX**: cells are react-rnd boxes reusing the exact text-box drag/
  resize interaction, bounded to their row band; selecting a cell (or the row)
  shows its editor in the inspector. Row band + faint ghost bands visualise the
  repeat pitch. Palette gains a "+ Line item row" action (one per template).
  Inspector: cell binding editor (single/composed + separator, reusing the old
  composed-source UI) and per-cell text style; row controls for
  `repeatIntervalMm` and `maxRows`.
- **Default receipt template** (`receiptResolution.js`): the Qty | Description
  (brand+description+sku+pid) | U/P | Amount table is now the equivalent 4-cell
  row at the BIR-style positions/widths, same bindings as before.
- **Adapter** (`receiptAdapter.js`): passes line items through raw (no column
  pre-resolution); TemplateRenderer resolves each cell per row. `sampleData.js`
  now supplies raw line-item rows so the designer's Preview resolves bindings.
- **Interim overflow (temporary, pre-pagination)**: a row renders `maxRows` items
  if set, else all items uncapped (can overflow the page). Flagged in code as a
  placeholder for the pagination phase.
- **Inspector overflow fix**: `.designer-inspector` gained `overflow-y:auto` +
  `min-height:0` so a tall inspector scroll-contains within its column instead of
  spilling `.designer-body` past the designer's fixed 100% height.

Tested: 28/28 pure+render (esbuild-bundled `renderToStaticMarkup`) — binding
resolution incl. the composed brand+description+sku+pid case against a real sale
row, default-template shape (lineItemRow present, no legacy table, 4 cells,
unique ids), adapter passes raw rows, repeat pitch renders each item at exactly
`y + i×repeatIntervalMm` (5 items → 60/66/72/78/84 mm), and the interim `maxRows`
cap. Overflow bug re-measured in real headless-Chrome at 3 viewports
(1200×800/1000×620/900×520): no horizontal page overflow in any state; selecting
the row/cell does **not** increase page vertical overflow (constant across
no-selection/row/cell), and at the 900px viewport the cell inspector
(scroll 430 > client 324) scroll-contains without spilling the page. Build + lint
clean. Not deployed to the tunnel yet.

## 2026-07-21 — Receipt printing Phase 4: Workstation/SaleDetail wiring + auto-print setting

Wired receipt printing into the app and added the opt-in auto-print axis.

- **Auto-print setting** (separate axis from receipts_enabled): tenant-wide KV
  `receipts_auto_print` (default false; GET auth-only / PATCH manage_print_templates,
  mirroring receipts_enabled) + per-terminal `receiptAutoPrintOverride` in
  platformStore (inherit/force-on/force-off, mirroring receiptPrintingOverride).
- **Pure logic**: `resolveShouldAutoPrint` (mirrors resolveShouldPrintReceipt) and
  `decideReceiptAction(shouldPrint, shouldAutoPrint)` → none | auto | button.
- **Shared `useTenantId`** (`lib/tenant.ts`): derives the tenant id from the JWT
  the same way Settings does, so a terminal resolves the template/settings it was
  configured with. `PrintPreview` gains `autoPrint`/`onAfterPrint`.
- **Workstation**: after a successful post, `decideReceiptAction` drives the UI —
  none → nothing; auto → `ReceiptPreviewModal` opens in auto-print mode (skips
  confirm); button → a Print Receipt button on the action row opens the modal for
  confirm-then-print.
- **SaleDetail**: an always-available "Reprint receipt" action (opens the modal,
  manual only) — independent of receipts_enabled and never auto-printed.

Tested: 8/8 unit (auto-print resolution + decision matrix), 5/5 backend
(auto-print GET/PATCH, independent of receipts_enabled), 5/5 browser harness
(terminal-override read both axes/directions; autoPrint fires; manual shows the
button). SaleDetail reprint verified unconditional by inspection. Not deployed to
the tunnel yet.

## 2026-07-20 — Receipt printing Phase 3: preview/print UI + general column-composition system

Built the receipt preview/print component and the generalized line-item column
system it renders through (no Workstation/SaleDetail wiring yet — Phase 4).

- **Data-source registry** (`receiptSources.js`): single source of truth for the
  header + lineItem scopes (only fields already in the Phase-1 receipt-data
  contract; VAT/buyer-TIN/business-style deferred).
- **Pure column resolution** (`columnResolution.js`): a lineItemsTable column is
  `{label, width, source}` or `{label, width, composed:{sources[],separator}}`;
  `resolveTableColumns` produces `{columns,rows}` for TemplateRenderer.
  `DEFAULT_LINE_ITEM_COLUMNS` = Qty | Description(composed brand+description+sku+pid) | U/P | Amount, per the BIR-style reference.
- **Adapter** (`receiptAdapter.js`): receipt-data + template → TemplateRenderer
  data, resolving columns generically via the registry (not hardcoded).
- **Inspector column editor** (`TemplateDesigner.jsx`): add/remove/reorder columns,
  width, single-vs-composed with an ordered source list + separator — reuses the
  existing `.designer-toolbar__field` styling.
- **TemplateRenderer**: `<colgroup>` mm widths so columns are resizable.
- **ReceiptPreviewModal.jsx**: fetches receipt-data, resolves template (or built-in
  default), adapts, renders in `PrintPreview` (react-to-print) for a cashier
  confirm-then-print. `salesApi.receiptData` added.

Tested in isolation: 23/23 pure (registry single+composed both scopes; adapter +
resolveTableColumns against a real sale's receipt-data; default template column
order/config) and 5/5 render (TemplateRenderer DOM: Qty/Description/U-P/Amount
header order, colgroup widths, composed Description cell).

## 2026-07-20 — Print designer: sidebar-overlap fix, draggable text boxes, whole-box text formatting

Three fixes to the print template editor, verified in a real browser (headless
Chromium layout measurement + Playwright on the deployed site).

**Sidebar overlap (`designer.css`).** `.designer-canvas-scroll` was `flex:1`
without `min-width:0`, and centered its oversized child with
`justify-content:center` — so a canvas wider than the middle column (narrow
window, or inspector open) overflowed left into the palette and made the canvas's
left edge unreachable. Added `min-width:0`; replaced `justify-content:center`
with `margin:0 auto` on `.designer-canvas` (centers when it fits, start-aligned +
scrollable when it doesn't).

**Text-box drag — edit-on-double-click (`DesignerCanvas.jsx`).** Text boxes used
the same react-rnd wrapper as data blocks but couldn't be dragged: the inner
`<textarea>` swallowed mousedown. Now the textarea is `readOnly` +
`pointer-events:none` by default (mousedown reaches react-rnd → drags like a data
block); a wrapper carries `onDoubleClick` (react-rnd doesn't forward it) to enter
edit mode (focus, re-enable pointer events, `disableDragging`); blur / empty-canvas
click exits.

**Whole-box text formatting.** Added `fontFamily` + `color` alongside the existing
`fontSize`/`align` (uniform per box). New `TEXT_DEFAULTS` + `FONT_FAMILY_OPTIONS`
(Arial, Times New Roman, Georgia, Courier New, Verdana) in `blockTypes.js` back
the `?? ` fallbacks so pre-existing templates render unchanged. Inspector "Text
box" section gains Font family + Color controls; both render sites
(`DesignerCanvas` preview and `TemplateRenderer` print output) apply all four
props identically. Also fixed a pre-existing unit mismatch: the designer preview
now renders `fontSize` in `pt` (was a bare px number) to match the print output —
existing text boxes appear ~33% larger in the editor, which is the preview finally
matching what prints.

Deployed to the tunnel; live E2E on test.lukosledger.com passed 11/11 (drag,
double-click edit, all four formatting controls, pt-accurate size, no errors).

## 2026-07-20 — Multitenancy Track A: house-wide RLS predicate hardening (all remaining clusters)

Migration `ff66aa77bb88` extends the auth hardening to every other
`tenant_isolation` policy via `ALTER POLICY`. Scope was taken from a live
`pg_policies` enumeration (not the migrations' original TABLES lists) to be
exhaustive: 47 policies referenced `app.tenant_id`, 3 already hardened (auth),
**44 re-pointed here** — ap (5), inventory (18), platform.document_sequences (1),
procurement (4), sales (15), settings (1). All now use
`tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer`, so the
predicate fails closed (zero rows) for NULL, RESET-induced '', and explicit ''
alike instead of throwing on the `::integer` cast.

Column-default fragility in `c9d0e1f2a3b4` (leaf tables) and `bb22cc33dd44`
(audit_log) is a separate INSERT-time vector and was deliberately left untouched
pending a separate decision.

## 2026-07-20 — Multitenancy Track A: harden auth-cluster RLS predicate against empty-string GUC

Follow-up migration `ee55ff66aa77` (auth RLS `cc33dd44ee55` was already applied,
so it is not rewritten). The tenant_isolation policy predicate on
`auth.users`/`employees`/`roles` was fail-closed for a NULL `app.tenant_id` but
would *throw* (`invalid input syntax for type integer: ""`) if the GUC were the
empty string — which is what a custom GUC becomes after `RESET app.tenant_id`
(as opposed to never being set). Re-pointed the policy (via `ALTER POLICY`,
USING + WITH CHECK) to:
`tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer`
so NULL and '' are both treated as "no context → zero rows", never reaching the
`::integer` cast when unset. Verified by a no-context probe triggered via `RESET`
(previously errored, now returns 0 rows).

**Flagged, NOT fixed:** the same fragile predicate exists in five other RLS
migrations (`d0e1f2a3b4c5` leaf pilot, `e1f2a3b4c5d6` inventory, `p1a2b3c4d5e6`
procurement/ap, `q2b3c4d5e6f7` sales/settings, `r3c4d5e6f7a8` document_sequences),
left unchanged pending a decision on a house-wide hardening pass.

## 2026-07-19 — Multitenancy Track A (auth subset): RLS on the auth cluster, login bootstrap, platform-owner identity

Progressed the auth-layer subset of Track A from the multitenancy roadmap. The
`erp_admin` connection-role question (roadmap item 1) was already resolved in an
earlier step — the app connects as the non-superuser `erp_app` and `erp_admin`
is confined to migrations/boot/signup — so this change delivers items 2 and 3.

**RLS on `auth.users` / `auth.employees` / `auth.roles`** (migration
`cc33dd44ee55`). ENABLE + FORCE ROW LEVEL SECURITY + a `tenant_isolation` policy
on each, using the house-standard predicate
`tenant_id = current_setting('app.tenant_id', true)::integer` (fail-closed: unset
context → zero rows). No column/constraint/default changes — the cluster already
carried `tenant_id` NOT NULL with composite uniques since Phase 1. `login_attempts`
and `audit_log` are deliberately excluded (both legitimately hold NULL-tenant rows).

**Login bootstrap** (`auth/router.py`). Login runs on `erp_app` with no JWT yet,
so it had no tenant context when reading `auth.users` — which RLS would now
reduce to zero rows. Reworked so login resolves `org_slug → tenant_id` against the
(intentionally un-RLS'd) `platform.tenants`, then `SET LOCAL app.tenant_id` and
stashes it on `db.info` (so the `after_begin` listener re-asserts context for the
post-commit `db.refresh(user)`), and only then reads the RLS'd `auth.users`.
Signup is unaffected: it runs as `erp_admin` (superuser → bypasses RLS) and sets
`tenant_id` explicitly.

**Platform-owner identity** (migration `dd44ee55ff66`, model
`tenancy.models.PlatformOwner`). Decision: a platform owner is a *separate*
identity, not a flag on `auth.users`. New `platform.platform_owners` table (no
`tenant_id`, no RLS, `erp_app` explicitly revoked from it) sits above the tenant
boundary. Schema/identity only — the platform-owner login endpoint and tenant-admin
API are Track B and not built here. Also corrected the stale "auth is NOT RLS'd"
comment on `auth.AuditLog`.

Migration chain is linear (`…→ bb22cc33dd44 → cc33dd44ee55 → dd44ee55ff66`, single
head). NOT YET APPLIED to the running DB and cross-tenant probe verification is
still pending — the instance is live behind the Cloudflare tunnel, so applying the
RLS migration and running probes is left as a gated next step rather than run
against live traffic automatically.

## 2026-07-19 — Print designer: fixed toolbar layout (wrapping, label breaks, action-button overflow)

Follow-up to the grid work below: the extra toolbar controls (Grid / Offset X / Offset Y) pushed
the toolbar past its width, and because `.designer-toolbar` was a single-line flex row
(`flex-wrap` unset → `nowrap`) with no `white-space` guards, the "← Back to templates" button wrapped
to 3 lines, the offset labels wrapped inconsistently (jagged row alignment), and the "Preview & Test
Print" button overflowed past the toolbar's white background onto the dark page.

CSS (`designer.css`): added `flex-wrap: wrap` to `.designer-toolbar` so it wraps to a second row
instead of overflowing; added `white-space: nowrap` to `.designer-toolbar__field` (keeps labels
like "Offset X (mm)" intact) and `white-space: nowrap` + `flex-shrink: 0` to
`.designer-toolbar__back`, `.designer-toolbar__preview-print`, and `.designer-toolbar__delete`.
Removed the competing `margin-left: auto` from both `.designer-toolbar__preview-print` and
`.designer-toolbar__delete` and introduced a new `.designer-toolbar__actions` wrapper
(`display: flex; gap: 12px; margin-left: auto`) that right-aligns both action buttons as one group.
JSX (`TemplateDesigner.jsx`): wrapped the Delete + Preview buttons in that `.designer-toolbar__actions`
div, replacing the two independent auto-margins with a single one on the wrapper.

Frontend built clean and deployed to the tunnel via `docker compose up --build -d frontend`; fresh
chunk hashes verified served, no stale bundle. Visual result across window widths not yet
eyeballed on-device.

## 2026-07-19 — Print designer: configurable grid (spacing + offset) and numeric Position & Size inputs

Added calibration controls to the print template designer so a template can be aligned to a
specific pre-printed form, where the blank fields to fill in rarely start exactly at the paper's
edge. Previously the grid was a hardcoded 5mm anchored at the paper's corner.

**`DesignerCanvas.jsx`.** Now takes `gridSpacingMm` / `gridOffsetXMm` / `gridOffsetYMm` props
(defaulting to 5 / 0 / 0). The visible grid is drawn via `backgroundSize` + `backgroundPosition`
so the offset shifts the grid origin. react-rnd's `dragGrid`/`resizeGrid` have no native offset
concept, so live drag/resize still snaps to spacing-from-0 for a smooth feel, and `onDragStop` /
`onResizeStop` re-snap the committed value against the true offset grid via a `snapToOffsetGrid`
helper. Added `minWidth`/`minHeight` of one grid cell plus a `Math.max(spacing, …)` clamp so an
element can't collapse to zero size.

**`TemplateDesigner.jsx`.** Toolbar gains Grid (mm) / Offset X / Offset Y inputs (read from the
template with `?? 5` / `?? 0` fallbacks, so pre-existing saved templates are unaffected). The
inspector, previously shown only for text boxes, now shows a "Position & size (mm)" section for
**any** selected element — numeric X / Y / Width / Height fields for precise placement — with the
existing font-size/alignment controls nested underneath for text boxes. The three grid values
persist on the template object through the normal `onChange` path.

Frontend built clean and deployed to the tunnel via `docker compose up --build -d frontend`;
fresh chunk hashes verified served, no stale bundle. Physical print output confirmed against a
real printer.

## 2026-07-14 — RBAC: closed settings-mutation gaps, retired phantom actions, tenant-scoped audit_log

Two closing items of the multi-tenancy Phase 2 work (full detail in `docs/Multitenancy.md`).

**Settings-mutation gaps + `receive_transfer`.** The shifts/registers/payment-modes mutation
endpoints were guarded by the coarse `manage_sales_settings`, while the frontend Settings screen
already gated those tabs by the granular `manage_shifts` / `manage_registers` /
`manage_payment_modes` — a front/back mismatch that let the API and UI disagree on who could act.
Narrowed the 6 endpoints to the granular keys; narrowed PDC deposit/bounce from `manage_customers`
→ `manage_pdc`. Two seeded actions that guarded **no distinct endpoint** were **retired** (migration
`aa11bb22cc33`, catalog 58→56): `receive_transfer` (transfers are single-step — `create_transfer`
records a completed transfer with `quantity_received` inline; there is no separate receive op) and
`manage_sales_settings` (superseded by the granular keys). No role lost real capability — every
holder already had the covering key. Verified real CASHIER → 403, ADMIN → works on all 8 re-keyed
endpoints. Enforcement now **44 of 56 actions**; the remaining 12 are decorative *by design*
(8 `export_*` and `manage_appearance` have no backend endpoint; 3 aging/credit-memo view keys are
enforced under adjacent `manage_*` keys). `auth/permissions.py` confirmed dead pre-RBAC code.

**`auth.audit_log` tenant_id — last piece of tenant scoping (migration `bb22cc33dd44`).** Added
`tenant_id` via a GUC `server_default` (`current_setting('app.tenant_id', true)::integer`), so all
40 `write_audit()` call sites auto-fill from the caller's `SET LOCAL` with zero code change and no
risk of a missed site (chosen over threading through `write_audit`). Nullable by design (`auth`
isn't RLS'd; system/boot writes have no tenant). Backfilled all 382 existing rows — actor rows via
`users.tenant_id`, the 18 null-actor rows attributed by the record they touched — **0 left NULL**.
FK to `platform.tenants` + `(tenant_id, occurred_at)` index; model mapped and drift-checked. Live
audited writes from both tenants land with the correct tenant (acme→5, default→1). **Tenant scoping
is now COMPLETE.**

## 2026-07-12 — Ops: rebuilt frontend — prior image predated the entire tooltip pass

Investigated a report that no tooltips were visible after "a stack rebuild." Root cause: no
rebuild had actually produced a new frontend image since **before** this work existed — the
running `season_erp-frontend` image was built 2026-07-12 01:10, while `Tooltip.tsx` wasn't written
until 11:51 and the Group 3/4 files not until 16:14 the same day (confirmed via `docker images`
timestamps vs. file mtimes). Docker's build context for the frontend service is a local-disk
`COPY . .` (`docker-compose.yml` → `frontend: build: ./frontend`), not git-based, so an actual
rebuild would have picked up the uncommitted source regardless of commit state — one just hadn't
run. Confirmed live pre-fix: the running site served the old pre-refactor `Tip` `<span>` markup
with zero `[role="tooltip"]` elements anywhere.

Ran `docker-compose up -d --build frontend`. Build output confirmed `Tooltip-CvEKy8PG.js` in the
new bundle; new image created 16:29:38 (after all source edits). Re-verified live against the
rebuilt stack: tooltip trigger `<button>` present in the DOM, hovering produces a real
`[role="tooltip"]` element, zero console errors, zero failed network requests, on both Sales
Ledger and Catalogue.

**Still open:** none of this work (foundation `Tooltip.tsx` + all 4 tooltip-copy groups) is
committed — `git log -1` is still `07b74cf`, predating all of it. It currently exists only as
uncommitted changes in this one working directory. Per project convention, commits are handled
manually by the user, not left to be done here — flagging so it isn't lost (e.g. to a future
`git checkout`/clean, or if this container is ever rebuilt from a fresh clone rather than this
same working directory).

## 2026-07-12 — Docs: track the Catalogue `variant_id` export-label inaccuracy

Added a new "Other Pre-Existing Inaccuracies Flagged (Not Tooltip-Copy Mismatches)" section to
`docs/inventory-tooltip-audit.md`, in the same table format as the "Pending Bug-Dependent
Tooltips" section, for the `Catalogue.tsx` Export Options "variant_id (for re-import anchoring)"
checkbox judgment call from the tooltip-copy pass: the label's stated purpose doesn't match actual
bulk-import behavior (anchors on PID, never `variant_id`), and no tooltip was added there since
one would either repeat the false claim or directly contradict the label sitting next to it. Kept
as a distinct tracked list from the bug-dependent one since this is a pre-existing label
inaccuracy, not new tooltip copy describing intended-vs-actual behavior. No code changes.

## 2026-07-12 — Feature: Inventory tooltip copy, Group 4 (Locations, UOMs, Categories, Import Hub) — pass complete

Final implementation group of the Inventory tooltip-copy pass — the Settings tabs
(`LocationsTab`/`UOMsTab`/`CategoriesTab` in `Settings.tsx`) and `ImportHub.tsx`'s inventory-relevant
entities (Suppliers, Opening Stock Balances, Variant Prices, Variant Costs). ~12 tooltip instances.
Highlights: Locations' "system" row label now explains Quarantine/Adjustment's purpose (previously
two unexplained permanent fixtures in every install); Categories' "Parent Category" tooltip states
plainly that the hierarchy is UI filtering only with zero effect on stock/costing/pricing (the
audit's top finding for that tab), and its "Parent" column header warns that indirect cycles
(picking a descendant as parent) aren't blocked, without asserting it's a "bug" — it's accurate,
defensive copy about a real gap, not a behavior mismatch requiring `TOOLTIP-TODO(bug)` treatment;
Import Hub's "Anchor" label finally defines the term that governs the entire create-vs-update
mechanics of every import (previously used with no definition anywhere in the UI).

Widened two shared local-header components' `cols` prop from `string[]` to `ReactNode[]`
(`Settings.tsx`'s `TableHead`, following the same pattern already applied to `Detail.tsx`'s
`HistoryTable` in Group 3) to carry `<Tooltip>`-wrapped column headers — switched their React
`key` from the column label to array index accordingly, since a `<Tooltip>` element can't itself
serve as a key. `TableHead` is shared by every Settings tab, not just the three touched here;
confirmed via the eslint/tsc baseline diff that no other tab was affected.

This closes out the 4-group Inventory tooltip-copy pass (Stock Transfers/Receiving → Ledger/POs/
Inventory Policy → Catalogue/NewProduct/Detail/Suppliers → this group), covering all 15 screens
cataloged in `docs/inventory-tooltip-audit.md`. Six tooltip instances across four underlying bugs
remain intentionally tied to *intended* rather than *actual* behavior, tracked in the audit doc's
"Pending Bug-Dependent Tooltips" section pending separate bug fixes — none of those bugs were
fixed in this pass, per scope.

Verified: `tsc --noEmit` and `eslint` on both files diffed against baseline — zero new
errors/warnings (fully identical output, not just line-shifted, since these two files' edits
didn't touch anything before the first inserted line in a way that shifted other pre-existing
findings). Live verification via headless Chromium: Locations' Status and system-row tooltips
against real seeded data (confirmed Adjustment and Quarantine are indeed the two system locations
per requirements §5.2), UOMs' Code header, Categories' Parent header, and Import Hub's Anchor
tooltip all rendered with correct copy and positioning. Zero console errors.

## 2026-07-12 — Feature: Inventory tooltip copy, Group 3 (Catalogue, New Product, Variant Detail, Suppliers)

Third implementation group of the Inventory tooltip-copy pass — the largest so far (~45 tooltip
instances across `Catalogue.tsx`, `NewProduct.tsx`, `Detail.tsx`, `Suppliers.tsx`), including the
two remaining bugs from the original 3-bug list, both of which turned out to need multiple
tracked tooltip instances:

- **Silent sub-entity save failures in variant creation** — `NewProduct.tsx`'s `handleSubmit` and
  `Detail.tsx`'s `handleAddVariantSubmit` (Add Variant modal) both wrap every per-sub-entity POST
  (supplier link, bundle components, barcodes, UOM conversions) in `.catch(() => {})`. Added an
  icon-only `<Tooltip>` (no visible label text to anchor to, so used the component's default
  info-icon trigger for the first time) next to each screen's Create button, describing atomic
  creation as the intended behavior. Tracked as bugs #4 and #5 in the audit doc.
- **`Detail.tsx`'s missing bundle-availability render** — `bundle_available_stock` is fetched by
  the API but never displayed; a bundle variant's "Total Physical" stat is always 0 with no
  substitute figure. Added a tooltip to the "Total Physical" label describing a buildable-quantity
  display as if it existed. Tracked as bug #6. Live-verified against a real bundle variant
  (`MLD0027-6S`'s component, PID `MLD0027`) — confirmed "Total Physical: 0.00" with nothing else
  shown, exactly the gap the audit and tooltip both describe.

Two elements were deliberately left without tooltips rather than risk writing something false —
logged as judgment calls, not implemented:
- Catalogue's "variant_id (for re-import anchoring)" export checkbox — its own pre-existing label
  already claims a re-import-anchoring purpose the bulk-import flow doesn't actually use (it
  anchors on PID). Added no tooltip that would repeat or contradict that existing claim.
- `Detail.tsx`'s supplier-link inheritance preview panel ("Inheriting from default variant...") —
  the audit flagged this as *unverified* whether the backend's costing fallback actually honors
  it. Skipped rather than assert confident-sounding behavior that might not be real.

Also fixed a self-inflicted type constraint: `Detail.tsx`'s local `HistoryTable` component's
`cols` prop was typed `string[]`; broadened to `ReactNode[]` (using array index instead of the
column label as the React `key`) so three history-table columns (Sales History's Status,
Purchase History's Net Unit Cost and QC Status) could carry a `<Tooltip>` instead of plain text.

Verified: `tsc --noEmit` and `eslint` on all 4 files diffed against baseline — zero new errors.
One incidental, benign lint change: refactoring Catalogue's Total Stock column header to inline
JSX (to attach a Tooltip) stopped routing that one column through the `SortTh` helper, which
removed one of three pre-existing `react-hooks/static-components` ("component created during
render") warnings for that file (6 → 5) — a side-effect reduction of a pre-existing issue, not a
regression. Live verification via headless Chromium across Catalogue, New Product, Suppliers, and
a real Variant Detail page (the bundle variant found in Group 1's verification) — all sampled
tooltips rendered with correct copy and positioning, zero console errors.

## 2026-07-12 — Feature: Inventory tooltip copy, Group 2 (Ledger, Purchase Orders, Inventory Policy)

Second implementation group of the Inventory tooltip-copy pass: `Ledger.tsx`, `PurchaseOrders.tsx`
(both the list page and its Create PO modal), `PurchaseOrderDetail.tsx`, and the Inventory Policy
tab in `Settings.tsx` — roughly 20 tooltip instances. Notable additions: the Ledger's reason-filter
row and Location filter previously had no label at all (only the Keyword search did) — added
"Movement Type" and "Location" labels so there was something to anchor the tooltip to, matching
the Keyword label already on the same toolbar; the Movement Type tooltip calls out that `SALE`
is deliberately absent from this screen's reason list (sales deductions only show in the Sales
Ledger), the audit's top finding for this screen. The Inventory Policy toggle's tooltip adds the
FIFO cost-layer caveat from requirements §9.9 that the existing static description didn't
mention — enabling "Allow Negative Stock" skips the stock-quantity check but transfers still
block on insufficient cost layers.

Plus one bug-dependent tooltip requested separately: `TransferNew.tsx`'s Remarks field (from
Group 1) is now tracked as bug #4 in the "Pending Bug-Dependent Tooltips" section — its value is
captured in state but never included in the POST payload, so the field's tooltip describes the
intended "saved with this transfer record" behavior with a `TOOLTIP-TODO(bug)` comment, matching
the treatment already given to `ReceivingNew.tsx`'s Qty Rejected/QC Status tooltips. No new
issues of this class surfaced during Group 2's own screens.

Verified: `tsc --noEmit` and `eslint` on all 5 touched files (`Ledger.tsx`, `PurchaseOrders.tsx`,
`PurchaseOrderDetail.tsx`, `Settings.tsx`, plus `TransferNew.tsx`'s Remarks addition) diffed
against a pre-change baseline — zero new errors/warnings. Live verification via headless Chromium:
Ledger's Movement Type/Location/Qty Change/Document ID tooltips against real ledger data, the
Create PO modal's Destination Location/Add Line Item/Gross Cost/Net Cost tooltips (the PO list was
empty in this environment — used the modal rather than writing a throwaway PO record into the
shared dev DB to test the Detail page's identical tooltip pattern), and the Inventory Policy
toggle's tooltip with the FIFO caveat visible in the note line. Zero browser console errors on any
of the 5 screens sampled.

## 2026-07-12 — Feature: Inventory tooltip copy, Group 1 (Stock Transfers + Receiving)

First implementation group of the Inventory tooltip-copy pass (`docs/inventory-tooltip-audit.md`),
using the shared `<Tooltip>` component. Covers all 7 Stock Transfers/Receiving screens:
`Transfers.tsx`, `TransferNew.tsx`, `TransferDetail.tsx`, `Receiving.tsx`, `ReceivingNew.tsx`,
`ReceivingDetail.tsx`, `ReceivingConfirm.tsx` — roughly 28 tooltip instances on the High/Medium-risk
elements the audit flagged (column headers, location pickers, status badges), prioritizing the
"single most consequential silent behavior" items (e.g. picking the virtual Adjustment location on
a transfer silently reclassifies it as a stock correction — `TransferNew.tsx`'s From/To Location
labels now say so).

Two tooltips (`ReceivingNew.tsx`'s Qty Rejected and QC Status column headers) describe the
*intended* behavior per requirements §9.1 rather than the screen's actual current behavior —
`handlePost` hardcodes `quantity_rejected: '0'` and `qc_status: 'Passed'` on submit regardless of
what's entered, a pre-existing bug (not fixed here, out of scope for this pass). Both are marked
with a `TOOLTIP-TODO(bug)` comment in code and tracked in the new "Pending Bug-Dependent Tooltips"
section at the top of `docs/inventory-tooltip-audit.md`, to be revisited once that bug is fixed.

Deliberately skipped: `TransferNew.tsx`'s Remarks field — its value is silently discarded on
submit (never included in the POST payload, a separate pre-existing bug not on the 3-bug list this
pass was scoped to) — adding tooltip copy describing it as a saved note would be actively
misleading, so it was left without one rather than expanding scope unilaterally.

Verified: `tsc --noEmit` and `eslint` on all 7 files diffed against a pre-change baseline — zero
new errors/warnings (only line-number shifts in pre-existing findings from the added import).
Live verification via headless Chromium against the running stack: all 4 sampled tooltips
(Transfers' Bundle Count, TransferNew's From Location, Receiving's Status, ReceivingNew's Qty
Rejected) rendered with correct copy and positioning, including a visible edge-avoidance flip on
Receiving's Status tooltip (trigger sits near the table's right edge). Zero browser console errors.

## 2026-07-12 — Feature: shared `<Tooltip>` component, foundation for the Inventory tooltip pass

Added `frontend/src/components/Tooltip.tsx` to replace the two ad-hoc hover-tooltip
implementations flagged in the Inventory tooltip audit (`SalesLedger.tsx`'s local `Tip`,
`Catalogue.tsx`'s inline `group/stock`/`group/bstock` CSS hover panels). Hover- and
`group-hover`-only, both originals were keyboard- and touch-inaccessible, and
`Catalogue.tsx`'s used hardcoded `gray-*` colors instead of the app's `t-*` theme
variables (silently broken in the light/carbon themes).

The new component: triggers on hover, focus, and tap/click (a single `<button>` element
covers all three natively); renders the panel into a `document.body` portal positioned
with `position: fixed` from a measured trigger rect, so it can't be clipped by a
scrollable/overflow-hidden ancestor the way an absolutely-positioned in-flow panel can;
flips top↔bottom and clamps left/right against the viewport edge (measure-then-place via
`useLayoutEffect`, closes on Escape/outside-click/scroll-reposition); accepts a `content`
node plus an optional dimmer `note` line for the richer two-part copy some audit entries
need; renders a default info-circle icon trigger when no `children` are given (no icon
library in this codebase, so it's an inline SVG). Fully theme-aware via `t-*` classes in
all three themes.

Migrated `SalesLedger.tsx` (7 call sites) and `Catalogue.tsx`'s `UomStockCell`/
`BundleStockCell` to it verbatim — same trigger text, same tooltip copy, same visual
language (dark card, dotted-underline trigger). Verified live against the running stack
(Playwright, headless Chromium): hover/focus/Escape/mouse-away/tap-only-without-hover all
open and close correctly; an edge-clipping stress test hovering all 7 Sales Ledger KPI
tooltips at a 480px viewport confirmed no panel ever renders with negative `left` or an
off-screen right edge; `BundleStockCell`'s tooltip (the one live-exercisable case in the
current seed data — no variant currently has a priced UOM conversion, so
`UomStockCell`'s breakdown path couldn't be exercised against real data this session,
though it shares the identical Tooltip integration) rendered with identical copy and
positioning to the pre-migration version. Zero new TypeScript or ESLint errors introduced
(diffed against a pre-change baseline); zero browser console errors during the live
verification pass.

Inventory screens themselves (Detail.tsx, NewProduct.tsx, Ledger.tsx, etc.) were
deliberately left untouched — this was foundation work only, per instruction. Tooltip
copy for those screens is the next step, using `docs/inventory-tooltip-audit.md` as the
source material.

## 2026-07-12 — Docs: Inventory tooltip audit (discovery pass, no code changes)

Produced `docs/inventory-tooltip-audit.md` ahead of a future tooltip-copy pass: every interactive
element across the Catalogue, Stock (Ledger/Transfers/Receiving), Procurement (Suppliers/POs),
and inventory-relevant Settings tabs (Locations/UOMs/Categories/Inventory Policy/Import Hub)
screens, cataloged against `docs/requirements.md`/`docs/schema.dbml` with business logic,
non-obvious behavior, domain terminology, and a confusion-risk rating. Confirmed no shared
`<Tooltip>` component exists — both current implementations (`SalesLedger.tsx`'s local `Tip`,
`Catalogue.tsx`'s inline `group/stock` hover pattern) are copy-pasted per-file.

Several real bugs and gaps were found incidentally while reading the code and are called out in
the doc's "Findings Beyond Tooltip Scope" section rather than fixed here (discovery-only pass, per
instruction) — most notably: `ReceivingNew.tsx` hardcodes `quantity_rejected: '0'` and
`qc_status: 'Passed'` on submit regardless of user input, so the documented Quarantine-routing
rule (requirements §9.1) never fires from that screen; `NewProduct.tsx` and `Detail.tsx`'s Add
Variant modal wrap every sub-entity POST (barcodes, UOM conversions, bundle components, supplier
links) in `.catch(() => {})`, silently swallowing failures; and `Detail.tsx` fetches
`bundle_available_stock` from the API but never renders it anywhere on the page.

## 2026-07-12 — Feature: PDC deposit as the collection event

Implements `docs/pdc_deposit_collection_proposal.md` (§2–§5, decisions finalized in §6) in full,
plus one gap discovered live during verification and fixed in the same pass. Before this,
depositing a postdated check — even one that clears without incident — never marked anything as
collected anywhere in this codebase: `Sale.balance_due`/`payment_status`, `customer.
outstanding_balance`, and the Customer Transaction Ledger's own derived status all stayed
permanently `Unpaid`/uncollected for a PDC-only-tendered sale, forever, unless some unrelated
later payment or return credit happened to be applied against it.

### `backend/sales/router.py` — `deposit_pdc_check` now writes the collection effect

Mirrors exactly what a standard tender writes at `post_draft` time, deferred to deposit time for
PDC: one `ArLedger(reason="PAYMENT", amount_change=-payment.amount)` row (if a customer is linked),
`customer.outstanding_balance -= payment.amount`, and per linked sale,
`balance_due = max(balance_due - amount_applied, 0)` /
`payment_status = "Paid" if balance_due <= 0 else "Partial"` — the same two-branch shape
`_apply_and_update` already uses for every other reducing-direction application (deliberately not
the three-branch `Paid`/`Partial`/`Unpaid` restore shape used by `bounce_pdc_check`/
`reverse_payment`, which *restore* balance upward and can legitimately land back at `Unpaid`;
deposit only ever reduces by a positive amount, so it never can). Single transaction, unchanged
structurally from the existing `check_status`/`payment_date` write. The existing `write_audit`
call was upgraded from a hand-built `new_values` dict to the `_serialize()`-based `old_values`/
`new_values` snapshot pattern already used by `reverse_payment`/`reverse_return`, so the audit
trail actually captures the new financial effect, not just `check_status`.

### `backend/sales/router.py` — `bounce_pdc_check` and `reverse_payment`, origin-agnostic restore

Both previously gated `balance_due` restoration on a static, mode-only flag
(`mode_reduces_balance = not (is_ar_charge or is_ar_credit)`) — correct only because deposit never
had a real effect to restore. Replaced in both with `restore_balance = any(e.reason == "PAYMENT"
for e in ledger_entries)`, reusing the `ledger_entries` list each function already fetches for its
`ArLedger`-negation loop — no new query, no mode-based conditional. Traced to confirm this is
correct for every mode: standard tenders (always have a `PAYMENT` row, unchanged), AR Credit
(writes `reason="AR_CREDIT"`, correctly still excluded — the specific case a bare "any row exists"
check would have gotten wrong), PDC bounced from `IN_VAULT` (no row, correctly no-ops), PDC
bounced from or reversed after `DEPOSITED` (deposit now writes one, correctly restores). Both
functions were sharing the identical bug — `reverse_payment` has no PDC-specific rejection, so a
`DEPOSITED` PDC payment was already reachable through it, not just through `bounce_pdc_check`.

### `backend/main.py` — one-time backfill, `_backfill_pdc_deposit_collection()`

New idempotent seeder, same convention as `_seed_payment_mode_flags()`. Re-derives the proposal's
four-part filter fresh on every startup rather than targeting a hardcoded `payment_id`: a
`DEPOSITED` PDC payment with no existing `reason='PAYMENT'` `ArLedger` row, applied to a still-
`Posted` sale with `balance_due` still open. Live data at implementation time: 7 payments showed
`DEPOSITED`, but only **1** matched this filter (payment 95, ₱50.00) — 4 already had their own
correct `ArLedger` row and `balance_due=0` (predating whatever earlier reconfigured the PDC
payment mode's `is_ar_charge` flag), 1 was already `Paid` via that same pre-existing mechanism, and
1's linked sale was already `Voided` (already independently closed out by `void_sale`, and the
same payment 91 already flagged elsewhere in this file as permanent historical evidence of an
unrelated past bug). The seeder correctly touched only payment 95, confirmed idempotent across a
second startup (re-ran, zero new rows).

### `backend/sales/router.py` — `_build_customer_transaction_ledger`, discovered live during verification

Not in the original proposal — found while verifying check 1 (below): this function computes its
*own*, independent per-sale `Paid`/`Partial`/`Unpaid` status from a `collection_rows` query
filtered by `PaymentMode.is_ar_charge == False` — the same static-flag exclusion pattern just fixed
twice above, in a third function neither the proposal's design (§3) nor the implementation plan
named. A deposited PDC sale showed `balance_due=0`/`Paid` on the `Sale` row itself but still
`"Unpaid"` in the Transaction Ledger, because this query never looks at `check_status` at all.
Confirmed with the user before fixing (out of the originally approved scope) — extended the filter
to also count a payment when `PaymentMode.is_pdc == True AND CustomerPayment.check_status ==
'DEPOSITED'`, alongside the existing `is_ar_charge == False` branch. A still-`IN_VAULT` PDC payment
still correctly does not count.

### Verified live (Docker stack, 2026-07-12)

1. **Deposit collection**: PDC-tendered sale, deposited — confirmed via SQL: one new `ArLedger`
   `PAYMENT` row, `balance_due` reduced to `0.00`/`Paid`, `outstanding_balance` reduced by the full
   payment amount, **and** the Transaction Ledger's own per-sale status flipped to `"Paid"` (after
   the bonus fix above — failed before it, confirmed the gap first, then confirmed the fix).
2. **Bounce from `IN_VAULT`**: PDC-tendered sale, bounced without ever depositing — confirmed zero
   new `ArLedger` rows and `balance_due` completely unchanged (nothing was ever collected).
3. **Bounce from `DEPOSITED`**: deposited, then bounced — confirmed the deposit-time `ArLedger` row
   correctly negated (two rows, `-X`/`+X`, both `reason="PAYMENT"`, matching `bounce_pdc_check`'s
   existing reversal-reason convention) and `balance_due`/`payment_status` restored to their exact
   pre-deposit values.
4. **`reverse_payment` on a deposited PDC payment** (the newly-reachable case): deposited, then
   reversed via the generic endpoint instead of `bounce_pdc_check` — confirmed `balance_due`
   correctly restored (previously would have been a silent no-op, corrupting nothing today only
   because deposit never had an effect to leave un-restored).
5. **Regression**: reversed a Cash payment — `balance_due` restored exactly as before. Reversed a
   Store Credit (`is_ar_credit`, writes `reason="AR_CREDIT"` not `"PAYMENT"`) payment — confirmed
   `balance_due` correctly *not* restored, the specific landmine the `reason`-based check exists to
   avoid.
6. **Void-guard regression**: voided a PDC-tendered sale, confirmed deposit/bounce/`reverse_payment`
   all still correctly rejected with `400`, sale state completely untouched by any of the three
   rejected attempts.
7. **Backfill**: confirmed payment 95 now shows collected; confirmed via SQL diff that payments
   7/8/9/10/11/91 have zero new `ArLedger` rows and unchanged `balance_due` — untouched.
8. **Audit coverage**: confirmed the upgraded `deposit_pdc_check` audit row shows a real
   `old_values`/`new_values` diff (`check_status: IN_VAULT → DEPOSITED`, `payment_date` changed);
   confirmed the backfill's audit row for payment 95 with `actor_user_id = NULL` (system-initiated,
   not attributed to a human).

### A pre-existing, unrelated gap surfaced by check 5 — flagged, not fixed

Reversing the Store Credit test payment (check 5's regression case) left customer 1's
`outstanding_balance` ₱40 higher (less negative / less credit) than its true pre-test baseline.
Traced: `post_draft` deliberately does **not** fold an `AR_CREDIT`-reason `ArLedger` row's amount
into `customer.outstanding_balance` at post time (only the `SALE` row's own `+grand_total -
standard_applied` formula does, and `is_ar_credit` is excluded from `standard_applied` by design —
"the SALE entry offset against existing credit handles the net balance"). But `reverse_payment`'s
pre-existing, unchanged-by-this-work `total_delta` mechanism reads *all* `ArLedger` rows for a
payment_id and adds the full delta back to `outstanding_balance` regardless of reason — so
reversing an `AR_CREDIT` payment adds back an amount that was never separately counted in
`outstanding_balance` to begin with. This is a different code path than anything touched in this
proposal (the `ArLedger`-negation loop itself, not the `balance_due`-restoration gate) and appears
to be latent, pre-existing, and previously untested — `reverse_payment` had zero callers before
this session, and reversing an `AR_CREDIT`-mode payment specifically may never have been exercised
until this check. Not investigated further or fixed here — flagged for a future pass. The ₱40
residual on customer 1 (a real seed customer, affected only via this test) could not be cleaned up
via any proper action (no endpoint adjusts `outstanding_balance` directly) and is left as documented
evidence, same treatment as other uncleanable test residuals this session.

### Cleanup

All test payments reversed/bounced and all test sales voided via proper endpoints (`reverse_payment`,
`bounce_pdc_check`, `void_sale`). Temporary test accounts deactivated via
`PATCH /auth/users/{id}/active`. Payment 95 (the backfill) is a real correction, not test data — it
stays fixed. The ₱40 residual above is the one exception, documented rather than force-corrected.

## 2026-07-11 — Fix: reverse_payment on an already-voided sale left it contradictorily stateful

Investigation prompted by an unverified hypothesis noted in this file's own "sales return
reversal" cleanup section (below): that `reverse_payment → void_sale` double-restored
`balance_due`, causing a ₱200 residual. **That hypothesis was wrong** — investigated precisely,
disproven with live evidence, and a *different*, real bug found instead, in the *reverse* order.

### What was actually true

`void_sale` (`router.py:2597-2745`) never touches `sale.balance_due` and never loops over
`CustomerPaymentApplied` — it's a flat, unconditional `-grand_total` `ArLedger` `ADJUSTMENT`.
Structurally incapable of the hypothesized per-application double-restoration. Live-verified:
`reverse_payment` (Posted sale) → `void_sale` nets `outstanding_balance` to *exactly* zero delta,
every time (forward order, standard tender; forward order, PDC/`bounce_pdc_check` — both clean).
The original ₱200 was fully reconciled instead to two ordinary, correctly-functioning
void-without-reversal sales from that session's cleanup — see the correction in the "Cleanup"
section of the return-reversal entry below.

### The real bug: reverse order

`void_sale` **first**, then `reverse_payment` on one of its payments: `outstanding_balance` still
nets correctly to zero — but `reverse_payment` had **no check on the linked sale's status**, unlike
`deposit_pdc_check`/`bounce_pdc_check`, which both already call `_reject_if_linked_to_voided_sale`
(`router.py:1252-1269`) for exactly this scenario. Live-reproduced: a Voided sale ended up with
`balance_due=150.00`/`payment_status='Unpaid'` — contradicting its own `Voided` status. Same root
pattern as this session's two earlier `mode_reduces_balance` fixes (check whether the thing being
restored was already restored/reversed before restoring it again), a different pair of operations.

### `backend/sales/router.py`

- **`reverse_payment`**: added `_reject_if_linked_to_voided_sale(payment, db, action="reverse")`
  as an early precondition, alongside the existing already-reversed/`BOUNCED`/credit-memo checks —
  before any mutation, matching where `deposit_pdc_check`/`bounce_pdc_check` place the same call.
- **`_reject_if_linked_to_voided_sale`**: generalized its error message from *"Cannot {action}
  this check..."* to *"Cannot {action} this payment..."* — the helper now serves a non-PDC caller
  too (`reverse_payment` handles Cash/GCash/Charge, not just checks), so the PDC-specific wording
  no longer fit. Docstring updated to describe all three callers rather than just deposit/bounce.
  Wording-only change to two already-shipped PDC error strings; no behavior change for those two
  call sites.

No schema, migration, or permission changes.

### Verified live (Docker stack, 2026-07-11)

1. **Reproduced pre-fix, confirmed post-fix**: voided a fresh fully-paid sale, then reversed its
   payment on the *unfixed* code — confirmed the bug still occurred (200 OK, sale ended up
   `Voided` + `balance_due=120.00`/`Unpaid`). Rebuilt with the fix, repeated the identical
   sequence on a fresh sale — got `400 Cannot reverse this payment — its originating sale has been
   voided`; confirmed via SQL the sale's `status`/`balance_due`/`payment_status` were completely
   untouched by the rejected call, and the payment's `reversed_at` stayed `NULL` (never reversed).
2. **Regression — normal case**: `reverse_payment` on a payment linked to an ordinary `Posted`
   sale still succeeds unchanged — `balance_due` correctly restored, `outstanding_balance`
   correctly increased by the reversed amount.
3. **Regression — forward order unaffected**: reversed a payment while its sale was still
   `Posted`, then voided that same sale — succeeded, `outstanding_balance` netted to exactly zero
   delta, exactly as already proven in the investigation (the new guard only fires when the sale
   is *already* Voided at the time `reverse_payment` is called, not after).
   3b. A pooled payment with zero sale applications also still reverses cleanly — confirms
   `_reject_if_linked_to_voided_sale`'s early-return on an empty `sale_ids` list is unaffected.

### Cleanup

Three sales from this investigation and its fix's own pre-fix reproduction (94, 96, 97) remain
permanently in the contradictory state (`Voided`, but `balance_due`/`payment_status` reading as if
still active) — **no proper action exists to reset `balance_due` on an already-Voided sale**
(confirmed by searching every `sale.balance_due =` write site in `router.py`; none apply to a
Voided sale, and the fix just shipped here specifically closes the one path that *could* have —
`reverse_payment` — for exactly this reason). Left as permanent historical evidence of the
pre-fix bug, same treatment as the `balance_due=200` rows from the earlier `mode_reduces_balance`
fix. The temporary `test_voidguard_verify` account (plus a throwaway helper needed to deactivate
it after a self-deactivation lockout) was deactivated via `PATCH /auth/users/{id}/active`.

## 2026-07-11 — Feature: sales return reversal mechanism

Implements `docs/return_reversal_proposal.md` (§2–§9, decisions finalized in §10) in full: a new
`POST /sales/returns/{return_id}/reverse` endpoint mirroring `void_sale`/`reverse_payment`'s
established "negate the actual ledger rows this record wrote" pattern, plus two bridge-table
fixes bundled into the same pass (decision 2) — one required by this feature, one a pre-existing,
previously-undiscovered bug surfaced while building it.

### `backend/sales/router.py` — `POST /sales/returns/{return_id}/reverse`

New endpoint, permission `reverse_return` (new action, see below). Preconditions: return exists
(404), not already reversed, `reversal_reason` non-empty, and — the scope boundary this proposal
deliberately drew (§5) — no active exchange sale linked to the return (reused `_attach_exchange`'s
existing derivation as the precondition; rejects with a state-specific message: *"delete the draft
first"* if the paired exchange is still `Draft`, *"void it first"* if `Posted`).

Single transaction, `write_audit()` before the one `db.commit()` (old_values + new_values, matching
`reverse_payment`'s pattern):
- **Inventory**: negates exactly what the return's `SalesReturnItem` rows wrote — `InventoryLedger
  RETURN_OUT` (reusing the existing enum value, previously only used by supplier returns, disjoint
  `reference_type`), `_upsert_stock` decrement, and — where `cost_layer_id` is set —
  `quantity_remaining -= quantity` (lower-capped at zero, the exact inverse of the return's
  upper-capped restore).
- **AR ledger**: negates whatever `ArLedger` rows this return actually wrote
  (`reference_type='sales_returns'`), same origin-agnostic technique `reverse_payment` uses —
  correct regardless of disposition, and (confirmed, not assumed — see the proposal §3) correct
  even for a return that hit the known bundle-variant phantom-stock bug, since it only ever undoes
  what was actually written, never re-derives what should have happened.
- **Cash-refund `CustomerPayment` (path 4)**: investigated (proposal §4.1) and confirmed
  `reverse_payment` **cannot** be reused here — that payment's `CustomerPaymentApplied` row was
  inserted directly by `_do_return`, bypassing `_apply_and_update`, so `sale.balance_due` was never
  touched at creation; calling `reverse_payment`'s restoration loop on it would have *decreased*
  `balance_due` for a value that was never increased, a new corruption in the same family as this
  session's earlier `is_ar_charge`/`balance_due` fix. Instead: locate the payment by its
  system-generated, never-edited `notes` string (`"Cash refund for return #{id}"` — no FK exists,
  tracked as future debt, not a v1 blocker per decision 1) and flip its
  `reversed_at`/`reversed_reason`/`reversed_by_user_id` directly — no `ArLedger` write, no
  `balance_due` touch, since the return's own `ArLedger` reversal above already fully covers this
  payment's customer-level effect.

### `backend/sales/router.py` — bridge-table fixes, both bundled per decision 2

`get_ar_aging` and `get_customer_ar_ledger_view`'s `returns_by_sale_id` `SUM` gained
`SalesReturn.reversed_at.is_(None)` — without it, a reversed `credit_to_account` return would have
kept subtracting from displayed balances forever, even though its actual `ArLedger`/
`outstanding_balance` effect was correctly undone (same "hard prerequisite" relationship the
AR-ledger staleness fix had to the payment-pooling picker earlier tonight).

Found while tracing that: the `payments_by_sale_id` `SUM` right next to it had the **identical,
pre-existing, previously-undiscovered gap** — no `CustomerPayment.reversed_at`/`check_status`
filter at all, so a payment reversed via the already-live `reverse_payment`, or bounced via
`bounce_pdc_check`, was *also* still counted. Fixed in the same pass (decision 2): added
`CustomerPayment.reversed_at.is_(None)` and, specifically to avoid the NULL-semantics landmine the
proposal flagged (`check_status` is nullable, only ever set for PDC payments — a bare `!=
'BOUNCED'` would, under standard SQL `NULL` semantics, silently exclude every non-PDC payment too),
`or_(CustomerPayment.check_status.is_(None), CustomerPayment.check_status != 'BOUNCED')`.

### `backend/sales/schemas.py` / `models.py`

`SalesReturn` gains `reversed_at`/`reversed_reason`/`reversed_by_user_id` (mirrors
`CustomerPayment`'s existing three columns, no boolean flag — same convention as everywhere else in
this schema). `SalesReturnOut` exposes the same three fields. New `ReturnReversalRequest` schema
(one required `reversal_reason: str`, mirrors `PaymentReversalRequest`).

### `backend/main.py` — permission

New action `reverse_return` (program `sales_returns`), granted to `ADMIN` + `STORE_MANAGER` only —
**not** `CASHIER`. Confirmed precisely why reuse of `process_returns` would be unsafe:
`CASHIER` already holds `process_returns` (creating returns), so reusing it for reversal would hand
every cashier a materially bigger privilege than creating one — the exact inversion
`reverse_customer_payment` was already introduced to prevent on the payment side.

### DB migration

`backend/alembic/versions/w3x4y5z6a7b8_add_reversal_fields_to_sales_returns.py` — same shape as
`t0u1v2w3x4y5_add_reversal_fields_to_customer_payments.py`. `docs/schema.dbml`'s `sales_returns`
table block updated to match.

### Verified live (Docker stack, 2026-07-11)

1. **Normal `credit_to_account` reversal**: created a Posted AR sale, returned part of it
   (`credit_to_account`), reversed the return — confirmed exact restoration via direct SQL: cost
   layer `quantity_remaining` back to its pre-return value, `current_stocks` back to its pre-return
   value, exactly two `ArLedger` rows (original + exact negation), `outstanding_balance` back to
   its exact pre-return value.
2. **`cash_refund` reversal (path 4)**: created a `cash_refund` return tied to a Cash-paid sale,
   confirmed the negative `CustomerPayment` existed, reversed the return — confirmed via SQL: that
   payment's three reversal columns set correctly, **zero** new `ArLedger` rows tagged to it
   (proving `reverse_payment` was not internally invoked), and `sale.balance_due` unchanged by that
   specific step (already fully covered by the return's own `ArLedger` reversal).
3. **Bridge-table return fix**: `get_ar_aging`/`get_customer_ar_ledger_view` for the reversed
   `credit_to_account` return's sale now show the full, un-reduced balance — the reversed return no
   longer counted.
4. **Bridge-table payment fix**: reversed a normal, previously-live payment via the existing
   `reverse_payment` endpoint and confirmed the linked sale's bridge-table balance flipped from
   `Paid`/`0.00` to `Open`/full amount (now correctly excluded). Separately confirmed the
   NULL-semantics landmine and its fix directly against the live database — a bare `!= 'BOUNCED'`
   filter would have wrongly excluded 104 real non-PDC payments (all `check_status IS NULL`); the
   `or_`-based filter correctly retains all of them. (No payment mode in current seed data combines
   `is_pdc=True` with `is_ar_charge=False`, so the `check_status='BOUNCED'` branch specifically has
   no live end-to-end path to exercise through the API today — verified at the SQL level instead,
   noted honestly rather than overclaimed.)
5. **Bundle-return case**: reproduced the known bundle phantom-stock bug (returned a bundle-line
   `SaleItem`) — confirmed the phantom bundle-variant `current_stocks` row appeared at `+1`.
   Reversed the return — confirmed the phantom stock was correctly negated back to `0`, and the
   real component stock (already short from the original, still-open bug) was untouched by the
   reversal in either direction, exactly as the proposal's §3 reasoning predicted.
6. **Exchange exclusion**: attempted reversal against a return with an active exchange — got 400
   *"delete the draft first"* while the exchange was `Draft`, and 400 *"void it first"* after
   posting it. Voided the exchange sale, confirmed the same return became reversible immediately
   afterward (`exchange_sale_id` went `null`).
7. **Permission**: a `CASHIER` test account got `403 Missing permission: reverse_return`; a
   `STORE_MANAGER` test account passed the permission gate cleanly (confirmed by reaching the
   business-rule 400 on an already-reversed return, not a 403).
8. **Audit coverage**: `auth.audit_log` shows an `UPDATE` row for every reversed return, with both
   `old_values` and `new_values` populated (spot-checked one: `old.reversed_at` empty,
   `new.reversed_at` the actual timestamp).
9. **Regression**: `create_return` (including a blind return, no `sale_id`) and
   `create_return_and_exchange` both exercised repeatedly during this pass with no change in
   behavior from before this work.

### Cleanup

All test returns reversed via the new endpoint; test sales voided via `void_sale`; the payment
reversed during check 4 was settled by voiding its sale. Three temporary test accounts (two
`STORE_MANAGER`/`CASHIER` accounts used for verification, one throwaway helper needed to
deactivate the second after the first self-deactivated) were deactivated via
`PATCH /auth/users/{id}/active`. One honest residual, not a defect in this work: after the
verification sequence, customer 2's `outstanding_balance` sat ₱200 below its pre-session baseline.
**Correction (2026-07-11, later the same day):** the note originally here attributed this to
voiding a sale after its payment had already been reversed (`reverse_payment` → `void_sale`). That
attribution was wrong — a dedicated investigation (see "Void-after-reversal investigation" below)
proved that specific ordering nets to *exactly* zero. The real, now fully-reconciled cause: two
*other* sales from this same cleanup pass (91, and the paired exchange sale 92 from check 6) were
each voided standalone, with no payment ever reversed on either — `void_sale` correctly and
intentionally left each its own documented -₱100 "unretrieved refund" credit
(`-total_applied` per its own docstring), summing to exactly -₱200. Not a defect; `void_sale`
working exactly as designed, applied twice during ordinary cleanup. See the entry below for the
investigation and the real bug it did find (a different one, in the *reverse* order).
The bundle-variant phantom `current_stocks` row (variant 1005) remains in the
database at quantity `0` (correctly zeroed, not deleted — matches this schema's "never
hard-delete" convention; this is the correct end state, not a cleanup gap).

## 2026-07-11 — Feature: pool payment, then assign to transactions (customer payments)

Implements `docs/payment_pooling_proposal.md` (§2–§9, decisions finalized in §10) in full: a new
receipt-picker flow on `CustomerDetail.tsx`'s "Record Payment" so one payment can be split across
several of a customer's open receipts in a single atomic submission, plus the two fixes the
proposal identified as hard prerequisites for that picker to be trustworthy.

### `backend/sales/router.py` — `get_customer_ar_ledger_view` (`GET /sales/customers/ar-ledger`)

Replaced the direct `sale.balance_due` read (stale relative to `credit_to_account` returns, which
adjust `customer.outstanding_balance` but never touch `sale.balance_due`) with the same
bridge-table derivation `get_ar_aging` already uses: `outstanding = sale.grand_total -
SUM(customer_payment_applied WHERE NOT is_ar_charge) - SUM(sales_returns.grand_total WHERE
disposition='credit_to_account')`. Reuses `sale.grand_total` directly as "principal" (proven
identical to the ArLedger SALE row's `amount_change`, written that way at post time and immutable
after) rather than re-querying `ArLedger`, since this endpoint already starts from `Sale` rows.
Same response shape, same route — fixes today's `CustomerARLedger.tsx` table too, not just the new
picker.

### `backend/sales/schemas.py` / `router.py` — `create_payment` (`POST /sales/payments`)

This endpoint already had the exact shape the new flow needed (one `CustomerPayment` + a
`List[{sale_id, amount_applied}]` applied in a loop, one transaction) and, per
`docs/payment_pooling_verification.md`, had zero frontend callers — so fixing it in place carried
no regression risk:

- **`CustomerPaymentCreate`** gained field parity with `RecordPaymentIn`: `payment_date`,
  `collection_receipt_no`, `notes`, `check_number`, `check_date`, `bank_name`.
- **Accounting fix**: previously wrote one `ArLedger` `PAYMENT` row *per application* and reduced
  `customer.outstanding_balance` by `total_applied` only — meaning a partially-applied payment's
  unapplied remainder wasn't reflected as collected anywhere until a later `apply_unapplied_payment`
  call. Now suppresses the per-application ledger write (`ledger_amount=Decimal("0")` passed to
  `_apply_and_update`) and writes **one** `ArLedger` row for the full `payload.amount`, reducing
  `outstanding_balance` by the full amount — matching `record_customer_payment`'s already-correct
  convention, and verified live not to double-count on a later `apply_unapplied_payment` call
  against the same payment's remaining pool (see verification §3 below).
- **PDC support added**: same `check_number`/`check_date`/`bank_name` requirement and
  `check_status='IN_VAULT'` handling `record_customer_payment` already has — previously absent.
- **Single-commit atomicity fix** (found while making the above change, not called out in the
  proposal but necessary for its explicit "full atomicity" decision): the endpoint previously did
  two separate `db.commit()` calls — one for the payment, a second after `write_audit()` for the
  audit row — so a crash between the two would leave a payment with no audit trail. Replaced with
  `db.flush()` (still surfaces the idempotency-key `IntegrityError` pre-commit) →
  `write_audit()` → one `db.commit()`, mirroring `record_customer_payment`'s pattern.

### `frontend/src/services/api.ts`

Added `CustomerPaymentCreate`/`PaymentApplicationIn` types and `salesApi.payments.create()`
(`POST /sales/payments`) — no existing `salesApi.payments` key previously.

### `frontend/src/pages/customers/CustomerDetail.tsx`

New "Apply to Receipts (optional)" section in the Record Payment modal, shown once mode + amount
are entered: fetches the customer's `Open`/`Partial`/`Overdue` receipts (oldest-first, server-
sorted), defaults to a greedy oldest-first allocation up to the entered amount, allows manual
per-row override (clamped to that row's balance), a "Select All / Apply to All Open Receipts"
shortcut (fetches remaining pages first so it covers the whole filtered list), a running "Applied
/ Remaining to allocate" total, and a "Load more receipts" button for customers with more than 200
open receipts. Submits as a single `salesApi.payments.create()` call (zero receipts selected stays
valid — pure pool, no schema change needed). Success shows a dismissible banner summarizing the
result. `CustomerARLedger.tsx` and `Workstation.tsx` are unchanged — the proposal's explicit
recommendation was to leave the single-sale flow and the POS tender loop alone.

### Verified live (Docker stack, 2026-07-11)

1. **AR ledger fix**: created a `credit_to_account` return against a Posted sale, confirmed
   `GET /sales/customers/ar-ledger` and `GET /sales/customers/aging` agree on the reduced balance
   while the raw `sale.balance_due` column stayed stale at its pre-return value — proving the fix
   reads the bridge-table derivation, not the column. Also surfaced a second, pre-existing
   instance of the same staleness in seed data (a return from an earlier session against a
   different sale), now also displaying correctly.
2. **`create_payment` accounting**: created a payment, applied it across two sales. Confirmed via
   direct SQL exactly **one** `ArLedger` row (`amount_change` = full payment amount, not one row
   per application), `outstanding_balance` dropped by the full amount immediately, and both sales'
   `balance_due`/`payment_status` updated correctly per-sale.
3. **Reconciliation**: called `POST /sales/payments/{id}/apply` against that payment's remaining
   unapplied pool for a third sale — confirmed via SQL no second `ArLedger` row was written (the
   application landed entirely within the already-ledgered surplus) and `outstanding_balance` was
   unchanged by that call, matching the `already_reduced`/`already_applied`/`surplus` math.
4. **Full UI flow** (Playwright, headless Chromium): customer with multiple open/overdue receipts
   — default oldest-first allocation, manual row override, "Select All" shortcut, and single
   submission all confirmed visually and via DOM state; zero browser console errors across the
   whole flow.
5. **Atomicity**: submitted a payment with a valid first application and an invalid second
   (amount exceeding a sale's balance) — confirmed via SQL that nothing persisted: no new payment
   row (despite the mid-transaction `db.flush()` that materializes one), no ledger row, no balance
   changes.
6. **Regression — `CustomerARLedger.tsx`**: Playwright-confirmed its "Receive Payment" modal still
   shows exactly one invoice (no picker table), submits and closes correctly.
7. **Regression — `Workstation.tsx`**: Playwright-confirmed the POS page renders its full tender
   UI with zero console errors — no code path shared with this change.
8. **Audit coverage**: confirmed via `auth.audit_log` an `INSERT` row for `sales.customer_payments`
   exists for the new `create_payment`-originated payment, written in the same transaction as the
   payment itself.

### Cleanup

Three test payments were reversed via the existing `POST /sales/payments/{id}/reverse` endpoint.
One test `credit_to_account` return (₱600 against a seed sale, used for check #1) could **not** be
cleaned up via any proper action — no return-void/cancel endpoint exists in this codebase — and
remains as a permanent, clearly-labeled (`reason` field states it was a verification test) record;
consistent with this session's "never hard-delete, no raw SQL cleanup" standard. The temporary
`test_pooling_verify` user account (registered via `POST /auth/register` to obtain a session for
API/browser-driven verification) was deactivated via `PATCH /auth/users/{id}/active`, matching the
existing convention for other `test_*` accounts in this database.

## 2026-07-11 — Fix: balance_due corruption on reverse/bounce of is_ar_charge payments; new PDC deposit→bounce transition

Closes both gaps found in `docs/customers_section_verification.md` (2026-07-10): the
`balance_due` corruption on reversing/bouncing Charge or PDC payments, and the missing
`DEPOSITED → BOUNCED` transition for PDC checks. Also proactively hardens the same root cause
at the point of application (`create_payment`, `apply_unapplied_payment`,
`record_customer_payment`), which had no backend guard against the same corruption — only ever
safe because the frontend filters `is_ar_charge`/`is_ar_credit` modes out of the relevant
dropdowns.

### Root cause, traced precisely

`balance_due` is reduced by an applied payment in three places, and only one of them already
excludes `is_ar_charge`/`is_ar_credit` tenders:

- `post_draft`'s tender loop (`router.py`) — correctly excludes both flags via
  `standard_applied`.
- `_apply_and_update` (shared by `create_payment`/`apply_unapplied_payment`) — previously
  reduced `balance_due` unconditionally, regardless of mode.
- `record_customer_payment` — same, unconditional.

`reverse_payment` and `bounce_pdc_check` both restore `balance_due` by adding back
`apply.amount_applied`, assuming every application had reduced it — true only for the modes
that actually did. For `is_ar_charge`/`is_ar_credit` applications, nothing was ever subtracted,
so restoring corrupted the value (confirmed live pre-fix: reversing a $100 Charge payment left
`balance_due=200`).

### `backend/sales/router.py`

- **`reverse_payment`** and **`bounce_pdc_check`**: both now compute
  `mode_reduces_balance = not (payment.payment_mode.is_ar_charge or
  payment.payment_mode.is_ar_credit)` once per payment (a payment has one mode, so one check
  covers all its applications) and only run the `balance_due`/`payment_status` restore loop
  when true. The `ArLedger`-reversal logic in both functions is unconditional and unchanged —
  it was already correct.
- **Void-guard**: new shared helper `_reject_if_linked_to_voided_sale()` — both
  `deposit_pdc_check` and `bounce_pdc_check` now reject with `400` if any sale the payment is
  applied to has `status == "Voided"`, matching the existing rejection style
  (already-bounced, credit-memo-mode). `void_sale` already reverses everything else about that
  sale; nothing legitimate was left for a PDC action to do against it.
- **`bounce_pdc_check`**: precondition relaxed from `check_status == 'IN_VAULT'` to
  `check_status in ('IN_VAULT', 'DEPOSITED')`. Confirmed safe to reuse the identical reversal
  logic for either originating status — `deposit_pdc_check` only ever changes
  `check_status`/`payment_date`, never `ArLedger`/`balance_due`/`outstanding_balance`, so there
  is nothing additional a prior deposit could have done that also needs reversing.
- **`_apply_and_update`**: gained a required `mode_reduces_balance: bool` parameter — skips the
  `balance_due`/`payment_status` mutation when false, leaves the `CustomerPaymentApplied` row
  and ledger write untouched (unchanged scope, per instruction — only `balance_due` is gated,
  not the `ArLedger` reason/amount logic for these modes, which is a separate, broader
  inconsistency not addressed here).
- **`create_payment`**: captures the validated `PaymentMode` row (previously discarded after
  the existence check) and passes `mode_reduces_balance` through to `_apply_and_update`.
- **`apply_unapplied_payment`**: computes the same flag from `payment.payment_mode` and passes
  it through.
- **`record_customer_payment`**: the sale-side `balance_due`/`payment_status` block is now
  guarded by the same `not (mode.is_ar_charge or mode.is_ar_credit)` condition.

### Verified live (Docker stack, 2026-07-11)

1. **Original Charge-reversal repro**: $100 sale, single Charge tender, reversed —
   `balance_due` stayed `100.00` (previously became `200.00`).
2. **Void-then-PDC-action**: voided a PDC-tendered sale, then attempted deposit and bounce on
   its PDC payment — both rejected with `400 Cannot {deposit,bounce} this check — its
   originating sale has been voided`.
3. **Regression — standard-tender reversal**: $100 sale, Cash tender, reversed — `balance_due`
   correctly restored `0.00 → 100.00`.
4. **Regression — `void_sale`**: re-ran the single- and multi-tender void tests from the prior
   verification pass — outstanding_balance deltas and stock/ledger reversal unchanged and
   correct (`void_sale` itself was not touched by this fix).
5. **New capability — deposit then bounce**: created a PDC payment, deposited it
   (`check_status=DEPOSITED`), then bounced it — `200 OK`, `check_status=BOUNCED`,
   `balance_due` stayed at its correct pre-bounce value (`100.00`, not doubled),
   `outstanding_balance` unchanged, zero `ArLedger` rows written (correctly — PDC wrote none at
   creation, so there was nothing to reverse).
6. **`write_audit` coverage**: confirmed via `auth.audit_log` — the deposit-then-bounce payment
   shows all three rows (`INSERT`, `UPDATE` deposit, `UPDATE` bounce); both reversal tests show
   their `INSERT`/`UPDATE` pairs. No gap introduced.
7. **Forward-direction guard, tested via direct API** (UI-unreachable for these modes,
   confirmed both ways): applying a Charge-mode payment via `record_customer_payment`,
   `create_payment`, and `apply_unapplied_payment` no longer reduces `balance_due` in any of the
   three; a standard-mode (Cash/GCash) application via the same three endpoints still reduces
   `balance_due` correctly (regression-free).

### Cleanup

`customer.has_bounced_check` (customer 3, stale from an earlier verification pass) cleared via
the proper `PATCH /sales/customers/{id}/clear-bounced-flag` endpoint. The `balance_due=200`
corruption already written to sales 75, 76, and 77 by the pre-fix bug, and payment 91's
`DEPOSITED` status (from depositing a since-voided sale's check before the void-guard existed),
could **not** be cleaned up via any proper action — `reverse_payment`/`bounce_pdc_check` both
refuse to act twice on an already-reversed/bounced payment (by design), and no endpoint exists
to reset a sale's `balance_due` independently of the payment-application lifecycle. These three
sales remain as permanent, correctly-understood historical evidence of the pre-fix bug; the fix
prevents new occurrences, it does not retroactively repair these specific rows.

## 2026-07-10 — Variant deactivation hardening (permissions, audit, reactivation)

`add_variant`, `update_variant`, and `delete_variant` were the only mutating endpoints on
`Variant` with no action-level permission check at all (router-level auth only), and
`update_variant`/`delete_variant` had no `write_audit` coverage. Brought both up to the same
standard as `update_product`/`delete_product` and this session's other destructive/corrective
fixes (`reverse_customer_payment`, `void_sale`, etc.), and closed a UI gap where a deactivated
variant had no way to be found again for reactivation.

### `backend/inventory/router.py` / `schemas.py`

- `add_variant`, `update_variant`, `delete_variant` now require `require_permission
  ("manage_products")`, matching `update_product`/`delete_product` exactly.
- `VariantUpdate` gained `is_deleted: Optional[bool]`, folded into the existing PUT endpoint
  rather than a new route — same convention as `SupplierPatch`/`patch_supplier`. `update_variant`'s
  lookup query no longer filters on `is_deleted`, so it can find and reactivate a soft-deleted
  variant (previously it could only ever find active ones).
- Added a guard: setting `is_deleted=true` on the default variant through `update_variant` is
  rejected with the same message as `delete_variant`'s existing default-variant check, so the
  invariant can't be bypassed now that `is_deleted` is a generic field on this endpoint.
- `update_variant` gained a `write_audit(..., "UPDATE", ...)` call (previously had none at all,
  for any field); `delete_variant` gained a `write_audit(..., "DELETE", ...)` call matching
  `delete_product`/`delete_supplier`'s exact old/new-value shape. Reactivation is covered for
  free since it goes through the same `update_variant` audit write.

### Frontend (`Detail.tsx`)

**Investigation finding**: the Sibling Variants panel (`product.variants.filter(sv =>
!sv.is_deleted)`) filtered deactivated variants out of the list entirely, even though the backend
already returns them (`Product.variants` has no `is_deleted` filter). A reactivate control would
have had nowhere to live — same trap as an earlier orphaned-list finding this session.

- Added a "Show inactive" checkbox next to the panel header; off by default (unchanged existing
  behavior), on reveals deactivated siblings tagged with an amber "Inactive" badge (same style as
  the existing "Default"/"Viewing" badges).
- Row action column: active row keeps the existing `×` convention used by
  barcodes/UOM-conversions/bundle-components/supplier-links in the same pane, now gated behind
  `window.confirm(...)` (more consequential than those other row deletes, which don't confirm);
  inactive row shows a "Reactivate" link calling `catalogueApi.variants.update(id, { is_deleted:
  false })` instead.
- Failures (notably `delete_variant`'s default-variant rejection) surface in a dedicated red error
  box, matching the existing `addVError` convention on this same page, instead of an unhandled
  rejection.

### Verified live (Docker stack + real browser via Playwright, 2026-07-10)

- **Permissions**: created a temporary CASHIER user (no `manage_products`) — `add_variant`,
  `update_variant`, `delete_variant` all returned `403 Missing permission: manage_products`.
  Cleaned up via `PATCH /auth/users/{id}/active` (proper deactivation, not a raw delete).
- **Deactivate via UI**: real browser test (Playwright/Chromium) against product 1004
  ("Rose Water Goblet 11oz" / "...11oz 6s") — clicked the sibling row's `×`, confirmed the
  `window.confirm` dialog fired with the expected message, row disappeared from the default view.
- **POS catalog reflection**: isolated API-level cycle — variant present in `GET
  /products/pos-catalog` before, absent immediately after deactivation, present again after
  reactivation.
- **`audit_log`**: `auth.audit_log` rows confirmed for both events on variant 1005 — one `DELETE`
  (`old.is_deleted=false → new.is_deleted=true`) and one `UPDATE` (`old.is_deleted=true →
  new.is_deleted=false`), both with correct `actor_user_id` and `occurred_at`.
- **Default-variant rejection**: clicking `×` on the default sibling (MLD0027) showed the red
  error box "Cannot delete the default variant — promote another variant first"; row confirmed
  still present afterward (screenshotted).
- **No cascade**: DB-checked variant 1004 (`is_default=true`, `is_deleted=false`, `price=88.00`)
  and product 1004 (`is_deleted=false`) were completely unchanged by variant 1005's
  deactivate/reactivate cycle.
- **Full round trip through the UI**: deactivate → toggle "Show inactive" on → row reappears with
  the "Inactive" badge → click "Reactivate" → toggle off again → row visible normally with no
  toggle needed, confirming `is_deleted` actually flipped back rather than the row just being
  visible because the toggle was still on.
- Variant 1005 ended the session in its original state (`is_deleted=false`, unchanged `PID`/price)
  — no lingering test artifacts.
- The temporary Playwright driver scripts and verification screenshots used for the above (session
  scratchpad only, never part of the repo) were deleted after the report was delivered.

## 2026-07-10 — Duplicate-submission protection for CustomerPayment and SalesReturn

Extends the duplicate-submission protection already proven for `sales.sales.idempotency_key`
(nullable, unique, client-supplied — see `create_draft`/`post_draft`) to the two remaining
unguarded creation surfaces flagged in the 2026-07-10 ground-truth passes: customer payments and
sales returns (`docs/backlog.md` — "Payment creation has no duplicate-submission protection" and
"SalesReturn has no idempotency protection").

**Investigation finding, not a fix in itself:** `post_draft`'s tender-creation loop does not need
a new mechanism. A duplicate `POST /drafts/{id}/post` call on the same draft is already rejected —
`_load_draft` filters `status == 'Draft'`, so once the first call flips status to `Posted`, a
second call 404s ("Draft not found") before the tender loop is ever reached. Confirmed live: a
genuine double-post on the same draft returned `200` then `404`, with only one `customer_payments`
row created. (This is a rejection, not a graceful idempotent return — a different shape than the
other paths below — but it fully prevents the duplicate tender.)

### `backend/sales/models.py` / `schemas.py`

- `CustomerPayment.idempotency_key` and `SalesReturn.idempotency_key` — `String(255), unique=True,
  nullable=True`, same shape as `Sale.idempotency_key`.
- Added to `RecordPaymentIn`, `CustomerPaymentCreate`, `CustomerPaymentOut`, `SalesReturnCreate`,
  `SalesReturnOut`.

### `backend/alembic/versions/v2w3x4y5z6a7_...`

Adds the column plus an explicitly-named unique constraint on each table
(`customer_payments_idempotency_key_key` / `sales_returns_idempotency_key_key`) so the
application-level race-safety net below can match on a known constraint name. `docs/schema.dbml`
updated to match.

### `backend/sales/router.py`

Four creation paths, each given the same two-layer protection as `Sale`: an upfront check that
returns the existing record immediately if the key is already in use (matching `Sale`'s "return
existing, don't reprocess" convention — not a reject), plus an `IntegrityError` safety net around
the commit for the race window between that check and the insert (mirroring the `sale_pid` race
fix in migration `u1v2w3x4y5z6`) that translates a losing-race unique-constraint collision into
the same graceful re-fetch-and-return, instead of a raw 500.

- `record_customer_payment` (`POST /sales/customers/{id}/payment`) and `create_payment`
  (`POST /sales/payments`) — both gain the check/safety-net pair. `create_payment` has no frontend
  caller today (confirmed — zero references to `/sales/payments` in `frontend/src`), but gets the
  mechanism anyway for API-safety, per instruction. `create_payment`'s existing split-commit
  pattern (financial write, then a separate audit commit — a known gap tracked separately in
  `docs/backlog.md`) was left untouched; only the first (financial) commit is wrapped.
- `create_return` and `create_return_and_exchange` — both check for an existing `SalesReturn` by
  key *before* calling the shared `_do_return` helper (mirroring how `create_draft`/`post_draft`
  each carry their own inline check rather than a shared one), so a duplicate never re-enters
  stock/ledger/cost-layer/cash-refund-payment processing at all. `_do_return` itself only gained
  `idempotency_key=payload.idempotency_key` on the `SalesReturn(...)` constructor — no behavior
  change to its internals. The cash-refund negative `CustomerPayment` created inside `_do_return`
  is protected transitively (it can't run a second time for a duplicate return), so it does not
  need its own separate key. New shared helper `_load_exchange_result()` builds the
  `{ sales_return, exchange_draft }` response from a `return_id` for both the pre-check hit and
  the exception-handler hit in `create_return_and_exchange`.

### Frontend

- New local `uid()` helper (same one-liner already duplicated in `Workstation.tsx`/`NewProduct.tsx`)
  plus a `useState(() => uid())`-held key, sent as `idempotency_key`, rotated only after a
  confirmed successful submit — same lifecycle as `Workstation.tsx`'s `txnKey`.
- `CustomerDetail.tsx` ("Record Payment"), `CustomerARLedger.tsx` ("Receive Payment"),
  `ReturnNew.tsx` (return submission). `salesApi.customers.recordPayment` and
  `salesApi.returns.create` param types extended; `CustomerPaymentOut`/`SalesReturnOut` TS
  interfaces extended with `idempotency_key`. `salesApi.returns.exchange` has no frontend caller
  (confirmed) so it was left unwired on the frontend, matching `create_payment`'s treatment.

### Verified live (Docker stack, 2026-07-10)

- `record_customer_payment`: submitted twice with the same key against customer 3 (O'Hotel) —
  identical `payment_id` both times; DB confirmed exactly one `customer_payments` row and one
  `ar_ledger` row.
- `create_payment`: same double-submit test, unapplied payment — identical `payment_id` both
  times, one row in the DB.
- `create_return` (`cash_refund` disposition): built a controlled test sale (walk-in, Cash
  tender), returned it twice with the same key — identical `return_id` both times; DB confirmed
  exactly one `sales_returns` row, one `RETURN_IN` inventory-ledger entry, and one negative
  cash-refund `customer_payments` row (not two).
- `create_return_and_exchange`: same double-submit test — identical `return_id` and
  `exchange_sale_id` both times; DB confirmed only one exchange draft `Sale` row
  (`origin_sale_id` link).
- `post_draft` double-post: created and posted a draft, then called `POST .../post` again on the
  same `sale_id` — first call `200 Posted`, second call `404 Draft not found`, confirming the
  existing-coverage claim above with a real test rather than reasoning only.
- Regression: every "first call" above is itself a normal, non-duplicate submission and succeeded
  normally, confirming unaffected behavior.
- Cleanup: the two balance-affecting test payments (customer 3) were reversed via the real
  `POST /sales/payments/{id}/reverse` endpoint (no raw deletes) — `outstanding_balance` confirmed
  back to its exact pre-test baseline (`0.00`). The test sales/returns/exchange draft were all
  walk-in (no customer), so they carry no financial exposure and were left in place as ordinary
  historical test records.

## 2026-07-09 — Fix: apply_unapplied_payment double-counted AR impact

Follow-up to the item flagged as "discovered, not fixed" in the `bounce_pdc_check` entry below.
The fix itself landed in the same commit (`5a32d05`) as that entry, but was neither called out in
the commit message nor verified live at the time — this entry closes that gap.

**Root cause:** `record_customer_payment` writes one `ArLedger` `PAYMENT` entry for the *full*
payment amount at creation, regardless of how much (if any) is applied to a sale at that time.
`apply_unapplied_payment` then unconditionally wrote a second `ArLedger` entry and reduced
`customer.outstanding_balance` a second time whenever previously-unapplied credit was later applied
to a sale — double-counting money that was already reflected in the ledger at the payment's creation.
`create_payment`/`post_draft`-originated payments were unaffected: those origins only ever write
ledger entries for the applied portion, so their unapplied remainder was never pre-counted.

### `backend/sales/router.py`

Origin-agnostic by design (same technique as `reverse_customer_payment` / `bounce_pdc_check`):
rather than branching on which endpoint created the payment, `apply_unapplied_payment` now asks the
ledger what's actually true before writing anything.

- `_apply_and_update` extended with an optional `ledger_amount` parameter (defaults to
  `amount_to_apply`) — the `CustomerPaymentApplied` row and sale `balance_due`/`payment_status`
  always reflect the full amount being applied; only the `ArLedger` write (and whether it happens
  at all) is controlled separately.
- `apply_unapplied_payment` computes `already_reduced` (sum of negative `ArLedger` entries already
  tagged to this payment) and `already_applied` (sum of existing `CustomerPaymentApplied.amount_applied`
  for this payment), derives `surplus = max(0, -already_reduced - already_applied)` — the amount
  already counted against this payment's balance impact but not yet formally applied — and caps how
  much of the current application is "genuinely new" accordingly. Only the genuinely-new portion
  gets a new `ArLedger` entry and reduces `outstanding_balance`; the already-counted portion still
  gets its `CustomerPaymentApplied` row and sale balance update, just no second ledger write.
- Everything stays inside the existing single `db.commit()`. No `write_audit()` call existed in this
  endpoint before or after — unchanged.

### Verified live (Docker stack, 2026-07-09 follow-up audit)

Using customer 1 (Suntech) and sale 42 as scratch, cleaned up afterward via the real
`POST /sales/payments/{id}/reverse` endpoint (no raw deletes) — `outstanding_balance` and sale 42's
`balance_due`/`payment_status` confirmed back to their exact pre-test baselines afterward.

- **record_customer_payment-originated, unapplied amount applied** ($30 unapplied → applied $10,
  then the remaining $20 in a later call): `outstanding_balance` dropped by $30 once, at creation —
  neither apply call moved it again. Only one `ArLedger` row ever existed for the payment (the
  original creation entry); no second row was written despite two `apply` calls. Sale `balance_due`
  and the `CustomerPaymentApplied` rows updated correctly on both calls regardless.
- **create_payment-originated regression** ($50 payment, $20 applied at creation leaving $30
  unapplied, then $15 of the remainder applied later): creation wrote a ledger entry for only the
  applied $20 (not $50) and reduced `outstanding_balance` by $20 only, matching pre-fix behavior
  exactly. The later $15 apply call *did* write a new $15 ledger entry and reduce
  `outstanding_balance` by $15 more — confirming genuinely-new amounts are still counted, not
  skipped.
- **Mixed partial case** (a payment with some already applied and some still unapplied — reused the
  record_customer_payment payment above after its first $10 apply): applying the remaining $20
  correctly identified it as fully already-counted (surplus tracks unapplied exactly for this
  origin) — zero additional ledger/balance impact, confirming the surplus/applied comparison holds
  across multiple sequential apply calls on the same payment.
- **Live reasoning check, payment_id 44** (customer_id 2, $600, real data predating this session,
  fully unapplied — not applied live, by design, since it's real customer data): confirmed via its
  actual current rows that `already_reduced = -600.00` (one ArLedger entry, at creation) and
  `already_applied = 0` (zero `CustomerPaymentApplied` rows). If any amount up to $600 were applied
  today, `surplus` would resolve to $600 and the entire applied amount would be classified as
  already-counted — `ledger_amount` would be 0, so no new `ArLedger` entry and no further
  `outstanding_balance` reduction, correctly avoiding a double-count of the $600 already reflected
  in the ledger since 2026-07-05.

## 2026-07-09 — Fix: voiding a sale permanently retired its sale_pid

Reported bug: a cashier voided a sale, then tried to reuse its `sale_pid` (the "Receipt No."
field, manually editable via the Auto/Manual toggle in the POS Workstation) on a new sale, and
was blocked from posting with a raw 500.

**Root cause:** `sale_pid` had an unconditional unique constraint (`sales_sale_pid_key`).
Voiding a sale (`void_sale`) never clears `sale_pid`, so the value stayed permanently claimed
even though the sale itself was no longer active. `create_draft` wrote `payload.sale_pid`
straight onto the row with no pre-check, so a collision only surfaced as an unhandled
`IntegrityError` → 500 at `db.commit()`.

**Decision:** `sale_pid` stays the field in active use (no migration to `receipt_no`). A voided
sale's `sale_pid` becomes reusable by a later sale. Genuine duplicates among currently-active
(`Draft`/`Posted`) sales are still blocked, but now surface as a clean 400.

### Schema — migration `u1v2w3x4y5z6`

Replaced the unconditional `sales_sale_pid_key` unique constraint with a partial unique index,
`sales_sale_pid_active_key ON sales.sales (sale_pid) WHERE status != 'Voided'`. Confirmed no
existing active sales shared a `sale_pid` before migrating (0 rows). **This is the first
conditional-uniqueness pattern in this codebase** — every other unique constraint (e.g.
`sales_idempotency_key_key`) is unconditional. `sale_pid`'s `unique=True` was removed from the
SQLAlchemy model (`sales/models.py`) since the ORM no longer owns this constraint; `docs/schema.dbml`
updated to match.

### `backend/sales/router.py`

- New helper `_assert_sale_pid_available(db, sale_pid, exclude_sale_id=None)` — queries for an
  existing active (non-Voided) sale with the same `sale_pid` and raises a `400` ("This document
  number is already in use by an active sale.") if found. Called in `create_draft` before insert,
  and in `post_draft` before the finalize commit (defends the `f"SALE-{sale.sale_id:05d}"`
  auto-fallback against colliding with a manually-set active PID on another sale).
- Both `create_draft`'s and `post_draft`'s `db.commit()` are now wrapped in `try/except
  IntegrityError`, translating a `sales_sale_pid_active_key` violation (the race-condition case
  where two requests both pass the precheck) into the same clean 400 instead of a 500. Same
  division of responsibility as the PID/barcode collision triggers in migration `s9t0u1v2w3x4`:
  the app-level check is the friendly error, the partial index is the actual guarantee.

### Verified live (Docker stack rebuilt)

- Voided a sale, posted a new sale reusing its `sale_pid` via Manual PID mode — succeeded.
- Attempted to reuse the `sale_pid` of a currently-Posted (active) sale — clean `400`, not a 500.
- `GET /sales/next-pid` still returns a non-colliding suggestion.
- Cleaned up the two collision artifacts flagged during investigation (`SALE-00056`/sale 58,
  already Voided; `SALE-00042`/sale 42, a genuine active sale with nothing to clean up) plus the
  new sale created during this verification, via the real void endpoint — no raw deletes.

*Note: the three entries below (bounce_pdc_check fix, payment reversal endpoint, payment audit
gap fix) were logged together on 2026-07-09 as a backfill — all three were implemented and
verified in the same session but only the first was explicitly requested to be logged; the other
two were added retroactively since none had been documented yet.*

## 2026-07-09 — Fix: bounce_pdc_check under-reversed payments with unapplied balance

Surfaced during testing of the new payment-reversal endpoint (see entry below): bouncing a PDC
check only reversed the portion of the payment tied to a `CustomerPaymentApplied` row. Any PDC
payment with a nonzero `unapplied_amount` at bounce time — fully unapplied (no application at
all) or partially applied — was under-reversed by exactly that unapplied amount, permanently
understating `customer.outstanding_balance`.

**Root cause:** `record_customer_payment` always writes one `ArLedger` `PAYMENT` entry for the
*full* `payload.amount` at creation, regardless of how much (if any) gets applied to a sale. The
old `bounce_pdc_check` computed its reversal by summing `CustomerPaymentApplied.amount_applied`
across the payment's applications — which only equals the full original amount when
`unapplied_amount == 0`. Payments created via `create_payment` or as sale-tenders inside
`post_draft` were never affected: those origins only ever write ledger entries for the applied
portion in the first place, so the old sum-of-applications logic already matched them exactly.

### `backend/sales/router.py` — `bounce_pdc_check`

Split the single per-application loop into two passes, both still inside the existing single
`db.commit()`:

- **AR/balance reversal** — now queries `ArLedger` where `reference_type='customer_payments' AND
  reference_id=str(payment_id)`, and reverses (negates) those actual rows, same technique just
  proven in `reverse_customer_payment` below. This captures the full original amount regardless
  of application state, and is self-correcting: it reverses whatever the ledger says actually
  happened, not what the applications imply happened.
- **Sale restoration** (`balance_due`/`payment_status`) — unchanged, still driven by
  `CustomerPaymentApplied`, since `ArLedger` rows don't carry sale linkage.
- Reversal entries keep `reason="PAYMENT"` (not `"ADJUSTMENT"`) — preserves existing bounce
  semantics/output for the case that already worked; only the amount source changed.

### Verified live (Docker stack rebuilt)

- **Fully unapplied** ($60, 0 applications): bounced → `outstanding_balance` restored exactly to
  its pre-payment baseline. Previously this wrote nothing.
- **Fully applied regression** ($90, one application covering the full sale balance): bounced →
  identical outcome to the pre-fix code (sale `balance_due`/`payment_status` and
  `outstanding_balance` both restored correctly) — confirms no behavior change for the case that
  already worked.
- **Partial application** ($100 created unapplied, $35 later applied to a sale, $65 left
  unapplied): bounced → both `ArLedger` entries (the $100 creation entry and the $35 apply entry)
  reversed, `outstanding_balance` and the sale's `balance_due`/`payment_status` both restored
  exactly to their pre-payment baselines.
- **Retroactive correction of the one live-affected record**: `payment_id=52`, a test payment
  bounced under the old code with `unapplied_amount=75.00` and never reversed. `check_status`
  reset from `BOUNCED` to `IN_VAULT` via a direct status-only DB update (no financial fields
  touched), then re-bounced through the fixed endpoint so the actual correction went through the
  normal audited path. `outstanding_balance` corrected by the missing +75.00; new offsetting
  `ArLedger` row and `audit_log` entry both written.

### Discovered here, fixed below

While constructing the partial-application test case, `apply_unapplied_payment`
(`POST /sales/payments/{id}/apply`) was observed writing a *second* `ArLedger` entry and reducing
`outstanding_balance` a second time for money already accounted for by the payment's creation-time
entry — i.e. applying previously-unapplied credit to a sale appears to double-count that credit's
AR impact. Fixed in the same commit as this entry — see "Fix: apply_unapplied_payment double-counted
AR impact" below — but the fix went undocumented and unverified until the follow-up audit.

## 2026-07-09 — Feature: standalone customer payment reversal (correction mechanism)

Closes the gap identified while auditing the payment-audit fix below: `record_customer_payment`
and `create_payment` had no void/reverse/delete path, unlike sales (`POST /sales/{id}/void`) or
PDC checks (`PATCH /sales/pdc/{id}/bounce`). Design proposal: `docs/payment_correction_proposal.md`.

### Schema — migration `t0u1v2w3x4y5`

Added to `sales.customer_payments`: `reversed_at` (timestamptz, null), `reversed_reason`
(varchar(500), null), `reversed_by_user_id` (int, FK → `auth.users`, null). No boolean flag —
reversal state is inferred from `reversed_at IS NOT NULL`, mirroring how `Sale` has no separate
`is_voided` column. `docs/schema.dbml` updated to match.

### RBAC — new `reverse_customer_payment` action

Seeded in `main.py`'s `ACTIONS` list under the `customers_list` program (same program as
`manage_customers`), granted to `ADMIN` (via the existing wildcard grant) and `STORE_MANAGER`
only — not `CASHIER`. Matches the `issue_credit_memo`/`cancel_credit_memo` split precedent rather
than folding into `manage_customers`. Surfaces automatically in the Settings RBAC UI, which is
fully data-driven off `auth.programs`/`auth.actions`.

### `backend/sales/router.py` — `POST /sales/payments/{payment_id}/reverse`

- **Origin-agnostic by design**: rather than re-deriving what a payment did from business rules
  (`record_customer_payment` and `create_payment` update `outstanding_balance` differently), reads
  the actual `ArLedger` rows tagged to `reference_type='customer_payments',
  reference_id=str(payment_id)` and negates exactly those, writing offsetting `ADJUSTMENT` rows.
- Restores `balance_due`/`payment_status` on every linked sale using the same three-branch logic
  `bounce_pdc_check` already used. `CustomerPaymentApplied` rows are preserved, not deleted.
- Full reversal only — no partial-amount correction (see proposal §7 for rationale). To fix a
  wrong amount: reverse in full, then record a new correct payment.
- Preconditions (400): payment not found (404), already reversed, PDC `check_status='BOUNCED'`,
  or `payment_mode.is_credit_memo` (excluded — `CreditMemoRedemption` is keyed by `sale_id`, not
  `payment_id`, so a redeemed memo can't be safely restored from here).
- `write_audit()` — first call site in this file to populate `old_values` as well as `new_values`,
  folded into the same single `db.commit()` as every other mutation (no split-commit).

### Verified live (Docker stack rebuilt)

- Functional: reversed a $150 payment applied to a sale — offsetting `ArLedger` row, restored
  `outstanding_balance`, restored sale `balance_due`/`payment_status`, preserved
  `CustomerPaymentApplied`, populated `reversed_at`/`reversed_reason`/`reversed_by_user_id`,
  `audit_log` UPDATE row with both `old_values` and `new_values`.
- Precondition rejections confirmed: already-reversed (400), bounced PDC (400), credit-memo-mode
  (400).
- Permission: CASHIER → 403; STORE_MANAGER and ADMIN → 200.
- Atomicity: temporarily injected a forced failure after every mutation but before
  `write_audit()`/`commit()`, rebuilt, confirmed every touched field (ledger, balance, sale,
  payment flags) reverted to baseline with nothing partially applied; reverted the injection and
  reconfirmed the real endpoint still works.

## 2026-07-08 — Fix: payment audit gap — record_customer_payment and post_draft tender loop

Verified as genuinely unimplemented (no commit, no partial work, no stash) before starting —
`record_customer_payment` (`POST /customers/{id}/payment`) and `post_draft`'s tender-creation loop
created `CustomerPayment` rows with no corresponding `write_audit()` call, leaving no audit trail
for who recorded a payment.

### `backend/sales/router.py`

- `record_customer_payment`: added `write_audit()` call folded into the existing single
  `db.commit()` (not a new commit after it).
- `post_draft` tender loop: added one `write_audit()` call per tender, immediately after each
  `CustomerPayment` is flushed, folded into the loop's existing single `db.commit()` — does not
  reuse the separate `sales.sales` header audit call later in the same function, which is its own
  commit and covers a different record.

### Verified live (Docker stack rebuilt — plain restart does not pick up code changes, no volume mount)

- Created a payment through both paths; both produced matching `audit_log` INSERT rows.
- Live cross-reference of all 44 existing `customer_payments` rows against `audit_log`: 0 had a
  matching INSERT before the fix; all payments created after the fix do.
- Forced a rollback (second tender referencing a nonexistent credit-memo code) to confirm the
  first tender's payment and audit row, already added to the session, were not left partially
  committed.

## 2026-07-08 — Rename: LedgerEntryContextOut.document_pid → document_id

Follow-up to the same-day "Document ID" data-source fix below. That fix corrected *what* both fields resolve to (`reference_number`, not `shipment_pid`) but left the two API field names inconsistent: `LedgerEntryContextOut.document_pid` vs `PurchaseHistoryItem.document_id` for the same underlying value. `document_pid` was also a misleading name on its own — the value is a manually-entered reference number, not an auto-generated PID (except for the transfer branch, which does resolve a real `transfer_pid`, but the field carries either kind depending on `reference_type`, so `document_id` — the generic name — is the more honest one throughout).

- **`backend/inventory/schemas.py`** — `LedgerEntryContextOut.document_pid` → `.document_id`.
- **`backend/inventory/router.py`** — `list_ledger` (the only endpoint emitting this schema): docstring updated, all three `out.document_pid = ...` assignments (transfer branch, shipment branch, fallback branch) renamed to `out.document_id`.
- **`frontend/src/services/api.ts`** — `LedgerEntry.document_pid` → `.document_id`.
- **`frontend/src/pages/stock/Ledger.tsx`** — 3 usages renamed: `DocIdCell`'s `pid` lookup, the keyword-search predicate, the XLSX export column source.

Grepped the full frontend and backend afterward — zero remaining `document_pid` references in code; only the two prior changelog/backlog entries below still say `document_pid`, left untouched since they're an accurate historical record of what the field was called at the time.

Verified live: rebuilt the backend container, confirmed `GET /products/ledger?reason=RECEIVE` now returns `document_id` (not `document_pid`) with the correct `reference_number` values; no `TRANSFER_IN` rows existed in the current DB to re-exercise that branch directly, but the code path is unchanged apart from the field name and was already covered by inspection.

## 2026-07-08 — Fix: receiving "Document ID" columns were showing shipment_pid instead of reference_number

Two display points on `inventory_shipments`-linked data were pulling the wrong field. `shipment_pid` (`SHP-000001`, system-generated) and `reference_number` (the supplier's physical document reference, labeled "Document ID" everywhere else in the app — `Receiving.tsx`, `ReceivingDetail.tsx`, `ReceivingConfirm.tsx`) are different fields; these two spots were conflating them.

### Inventory Ledger (`/stock/ledger`) — `backend/inventory/router.py`, `list_ledger`

- Was: `document_pid` for `reference_type == "inventory_shipments"` rows was resolved from `InventoryShipment.shipment_pid` (with a `f"SHP-{id:06d}"` synthetic fallback if null).
- Now: resolved from `InventoryShipment.reference_number` (`shipment_docid_map`, renamed from `shipment_pid_map`). No synthetic fallback — a shipment with no reference number on file now shows `—` (existing frontend behavior for a falsy `document_pid`) rather than a fabricated shipment-PID-shaped placeholder.
- Link behavior unchanged — `DocIdCell` in `Ledger.tsx` navigates on `entry.reference_id` (the shipment_id), never on the displayed text, so `/stock/receiving/:shipment_id` navigation was never affected either way.

### Variant Detail → Purchase History (`/inventory/:variant_id`) — `backend/inventory/router.py` `get_purchase_history`, `schemas.py`, `frontend/services/api.ts`, `Detail.tsx`

- Was: `PurchaseHistoryItem.shipment_pid`, sourced from `InventoryShipment.shipment_pid`, rendered under a column literally labeled "Shipment PID."
- Now: field renamed to `PurchaseHistoryItem.document_id`, sourced from `InventoryShipment.reference_number`; column relabeled "Document ID." Table has no row-level link, so no navigation behavior to preserve.
- Left untouched: the `cost_layer` lookup inside the same function still matches by `InventoryShipment.shipment_pid == r.shipment_pid` — that's an internal join key to find the right cost layer, not a display value, and is out of scope per this fix's boundary. `shipment_pid` is still selected in the query for that purpose.

### Confirmed untouched

`shipment_pid` still drives the "Shipment PID" column on Receiving Overview (`Receiving.tsx`) and the Shipment Detail pages (`ReceivingDetail.tsx`, `ReceivingConfirm.tsx`) — verified via live API check against `GET /procurement/shipments/1` after the fix (`shipment_pid: "SHP-000001"`, `reference_number: "test1"`, both correct and independent).

### Verified live (Docker stack rebuilt, tested against real shipment data, throwaway test user cleaned up after)

- `GET /products/ledger?reason=RECEIVE` — `document_pid` now returns `"test1"`/`"test2"`/`"test3"` (real `reference_number` values already in the DB) instead of `"SHP-000001"` etc.
- `GET /products/variants/1/purchase-history` — `document_id` now returns `"test1"`/`"test2"` instead of the shipment PIDs; `net_unit_cost` still populated correctly, confirming the untouched internal `shipment_pid` join still works.

## 2026-07-07 — Fix: reverse barcode resolver, DB-level collision triggers, PID/barcode hardening (completes pid_editability_fix.md batch)

Completes the batch below: the previous same-day entry covered Fix 1 (PID unlock), the forward half of Fix 2, and the app-level half of Fix 3. This pass adds the reverse resolver, the DB-level enforcement, closes two collision-check gaps left on the variant-creation paths, and audits the redirected Fix 5 scope.

### Fix 2 — Reverse resolver (scanned string → variant) — `backend/inventory/router.py`, `frontend/.../Workstation.tsx`

- New `GET /products/resolve?code=...`: checks `variant_barcodes.barcode` for an exact match first, then a current non-deleted `variants.PID` match, else `404 "item not found"`. A PID renamed away from matches neither step.
- `Workstation.tsx`'s barcode-scan field (`handleSearchEnter`) now falls back to an exact PID match after the existing exact-barcode match fails, and flashes "Item not found" when neither resolves — previously it silently did nothing on an unmatched Enter.

### Fix 3 — DB-level triggers + closing app-level gaps — new migration `s9t0u1v2w3x4`, `backend/inventory/router.py`

- New `BEFORE INSERT OR UPDATE` triggers on `inventory.variants` and `inventory.variant_barcodes` independently reject both collision directions at the DB layer — the actual guarantee, closing the race condition and any write path that bypasses app validation.
- App-level check (`_check_pid_barcode_collision`) was only wired into `update_variant`; extended to `add_variant` and `create_product`'s variant-creation loop, which previously validated PID-vs-PID uniqueness but not PID-vs-barcode. All PID/barcode write paths now catch `IntegrityError` from the trigger and return a clean `400` instead of a raw `500`.
- Bulk-import per-row isolation was in scope only for the legacy `/products/import/*` endpoints, which are unused by the frontend and out of scope per this session's decision (see Fix 5 below) — the trigger's per-row concern doesn't currently apply to any live write path, since the live `import_hub` entities (variant-prices, variant-costs) never write to `PID` or `variant_barcodes.barcode`.

### Fix 4 — Confirmed still out of scope

No PID history table or model exists anywhere in the codebase. Nothing to change.

### Fix 5 — Redirected per user decision, not implemented as originally scoped

The original Fix 5 (variant_id-aware import anchor) targeted "the Product Catalogue import template," which doesn't cleanly exist: `backend/inventory/router.py`'s `/products/import/preview`+`/confirm` handle full product+variant rows but have no frontend page calling them (`Catalogue.tsx` only has an Export modal); the live `import_hub` system's 5 entities are narrow single-purpose imports with no full-catalogue entity. Per user direction, this batch leaves the legacy endpoints untouched and does not build new import UI. Instead:

- Audited `import_hub`'s PID-anchored entities (`variant-prices`, `variant-costs`) for renamed-PID behavior: both give a clean row-level error, not a silent no-op or batch abort. Found and fixed one real bug: `cost_confirm` used `variant.variant_id` / `supplier.supplier_id` without a `None` guard, so a missing PID or supplier code threw `AttributeError: 'NoneType' object has no attribute ...` instead of the clean `"PID '...' not found"` message `price_confirm` already gives. Still caught per-row (didn't abort the batch), just a bad message — now fixed with explicit guards.
- Added `variant_id` as an optional export column in `Catalogue.tsx`'s "Additional Fields" toggle (the one piece of the original ask with a live UI already in place). Informational only for now — no import path anchors on it yet.

### Incidental bug found and fixed — `create_product` response staleness

While smoke-testing, `POST /products/` returned `resolved_barcode: ""` on newly created variants instead of the PID fallback. Root cause: the endpoint fetched the enriched response object, then did a second `write_audit` + `commit()` afterward, which (`expire_on_commit=True`) discarded the manually-set `resolved_barcode` attribute (not a real mapped column) on the next relationship access. Fixed by moving the final `_load_product` enrichment to after all commits.

### Smoke tests (all 10 run against the live Docker stack; throwaway test user/product/variants cleaned up after)

1. Renamed a PID with no explicit barcode → resolver returned the new PID immediately, no `variant_barcodes` row written. (Reprint warning verified by code inspection — same condition as Fix 2's already-tested forward resolver.)
2. Renamed a PID with an explicit primary base-UOM barcode present → barcode unchanged, resolver still returns the barcode.
3. Explicit barcode set to another variant's current PID → `400`.
4. PID renamed to match another variant's explicit barcode → `400`.
5. Raw SQL `UPDATE`/`INSERT` bypassing the app layer in both directions → both independently rejected by the DB triggers.
6–9. Out of scope — target the descoped Product Catalogue import. Substitute check run instead: a live PID-anchored bulk import (`variant-prices/preview`) against a renamed-away PID returns a clean row-level "not found," confirming the rename doesn't corrupt the one bulk-import surface that does exist today.
10. Renamed variant A's PID `PID-001 → PID-002`; reverse resolver on `PID-001` → `404 "item not found"`; assigned `PID-001` to new variant D; reverse resolver on `PID-001` → resolved to D.

## 2026-07-07 — Fix: PID editability + computed barcode resolver (supersedes same-day cascade approach)

Implements `/docs/pid_editability_fix.md` in full (revised version — replaces the earlier cascade/reprint-on-save design with a computed resolver). PID was inline-editable on the frontend (`readOnly={!canEdit}`, same as every other field) but silently dropped on save — `VariantUpdate` (backend) had no `PID` field, so Pydantic discarded it before it ever reached the row. No prior save attempt ever errored; it just never persisted.

### Fix 1 — Unlock PID field — `backend/inventory/schemas.py`, `backend/inventory/router.py`

- Added `PID: Optional[str]` to `VariantUpdate`.
- `update_variant` checks the incoming PID against all other variants' current `PID` values (self-match is a no-op, not treated as a change). Collision → `HTTP 400 "PID already in use"`. No history table, no reserved values.

### Fix 2 — Computed barcode resolver — `backend/inventory/router.py`, `schemas.py`, `frontend/.../Detail.tsx`

- New `_resolve_barcode(variant)`: `variant → product.base_uom_id` → look for an explicit `variant_barcodes` row with `is_primary=True` and `uom_id == base_uom_id` → else fall back to `variant.PID`. Never written to `variant_barcodes` — evaluated fresh on every read via `_enrich_resolved_barcode()`, wired into every path that returns a full variant (`_load_product`, `list_products`, `get_variant`, `update_variant`). New `VariantOut.resolved_barcode: str` field exposes it to the frontend.
- A PID rename requires zero writes to `variant_barcodes` — any variant relying on the fallback resolves to the new PID on the very next read.
- `Detail.tsx`'s `handleSave` now gates the reprint warning on the actual resolver condition (`variant.barcodes.some(bc => bc.is_primary && bc.uom_id === product.base_uom_id)`), not just "any barcode row exists." Warning text: "This item has no barcode on file — its scannable code will change to match the new PID. Reprint any physical labels currently in use."

### Fix 3 — Cross-namespace collision checks — `backend/inventory/router.py`

- `update_variant`: renaming a PID is also checked against every *other* variant's explicit `variant_barcodes.barcode` values → `HTTP 400 "PID already in use as another variant's barcode"`.
- `add_barcode`: a new explicit barcode is checked against every *other* variant's current `PID` → `HTTP 400 "Barcode already in use as another variant's PID"`.
- `update_barcode` was **not** given the equivalent check: `VariantBarcodeUpdate` has no `barcode` field — the endpoint only ever supported changing `uom_id`/`is_primary` (matches the frontend, which has add/delete/toggle-primary but no inline value edit). A value-collision check there would be dead code since the value can never change through that endpoint. Left as-is; flagged as a pre-existing gap, not part of this batch.

### Fix 4 — Confirmed import upsert requires no changes

`import_preview` / `import_confirm` key strictly off the current `variants.PID` column at query time — unaffected by the resolver redesign.

### Smoke tests (all 5 passed against the live stack; test data cleaned up after)

1. Renamed a PID with no explicit barcode → `resolved_barcode` reflected the new PID immediately, zero rows written to `variant_barcodes`.
2. Renamed a PID with an explicit primary base-UOM barcode present → `resolved_barcode` unchanged.
3. Explicit barcode set equal to another variant's current PID → rejected (both via direct create attempt).
4. PID renamed to match another variant's explicit barcode → rejected.
5. Re-imported using a PID renamed away → preview/confirm both treated it as create mode; old PID freely reusable, new variant created with zero collision.

## 2026-07-04 — Fix: money-column export formatting (Step 2 of money-export audit)

Follow-up to the Step 1 audit of every export/download feature in the app. Fixed the 8 client-side XLSX exports found to have mixed number/string money columns, so every monetary cell is now a true number (SUM()-able, formula-ready) rather than sometimes a formatted string or an empty string standing in for zero.

### Added — `frontend/src/lib/xlsxMoney.ts`

New shared helper used by all 8 fixes below, so the fix is one reusable pattern rather than a one-off per file:

- `jsonToFormattedSheet(rows, colFormats)` — builds a worksheet via `XLSX.utils.aoa_to_sheet` (header row = union of keys across all rows, first-seen order, so rows that conditionally omit a key still line up under the right column) instead of `json_to_sheet`, then stamps `.z` number-format codes (from `colFormats`) onto the numeric cells in the named columns. A cell value of `undefined` produces a genuinely blank cell — the mechanism used everywhere below for "not applicable" data (no credit limit set, no promo price, no cost data, etc.), replacing the old `''`/text-label placeholders.
- `stampNumberFormat(ws, startRow, colIdxs, rowCount, format)` — lower-level primitive for worksheets built by other means (used by `CustomerDetail.tsx`, which builds a leading statement-header block with `aoa_to_sheet` before appending the ledger table with `sheet_add_json`).
- `MONEY_FORMAT = '#,##0.00'`, `PCT_FORMAT = '0.00'` — matches the format codes the backend's `xlsxwriter` shipment-invoice export already used (`procurement/router.py`), left untouched as the reference implementation.

### Fixed — the 8 exports

- **`CustomerAging.tsx`** (AR Aging): all 5 bucket columns used `r.current_amt || ''`, which blanked a real `0` balance. Now `Number(r.current_amt)` etc. — always numeric, since every bucket field is non-nullable.
- **`CustomerARLedger.tsx`** (AR Ledger, legacy invoice-level view): `Balance Due` no longer blanks on zero. `Total Amount` is a per-customer-group subtotal shown once on the group's last row — now `undefined` (genuinely blank) on other rows instead of `''`.
- **`CustomerDetail.tsx`** (Transaction Ledger + statement export): `Credit Limit` is `undefined` (blank cell) when unset, replacing the `'No Limit'` text label that was mixing types into the column — the informational label is lost from the file; flagged for confirmation. `Debit`/`Credit` are keyed off `row.type` ('SALE' | 'PAYMENT') rather than `> 0`, so the non-applicable side is always blank (standard two-column ledger convention) while the applicable side is never hidden even if it happens to be exactly 0.
- **`SupplierAging.tsx`** (AP Aging): same bucket-blanking fix as CustomerAging.tsx.
- **`CustomerList.tsx`**: `Credit Limit` now `undefined` when null, instead of `''`.
- **`SaleDetail.tsx`** (single sale, 2-sheet export): `Disc %`, `Disc ₱`, `Net Unit Cost` now `undefined` on genuine absence (no discount / no cost data) instead of `''`. Also fixed `Receipt Total` and `Variance` in the same file with the identical pattern — not in the original per-file list but flagged in the Step 1 audit as the same bug, and inconsistent to leave broken next to the columns being fixed.
- **`SalesLedger.tsx`** (ledger, 3-sheet export): `Receipt Total`/`Variance` blank (`undefined`) for return rows and when null (was `''`); `Disc %`/`Disc ₱`/`Net Unit Cost` same fix as SaleDetail.tsx across both sale-item and return-item rows; `Unit Cost` on the "Sales by Variant" sheet blank when no cost data exists for a variant. Negative return line totals keep the existing plain-minus-sign convention (`-Number(item.line_total)`) — no parentheses-style negatives introduced.
- **`Catalogue.tsx`**: `Promo Price`/`Gross Cost` now `undefined` on genuine absence instead of `''`. Also fixed `Price`, which the Step 1 audit had assumed was always populated — `InvVariant.price` is actually typed `number | null` (a variant can have no price of its own and fall back to its default sibling's price for *display*, per requirements §6.2, but the raw catalogue payload can still carry `null`). Wrapping it in `Number(v.price)` unconditionally would have silently turned a null price into `₱0.00`; fixed to `v.price != null ? Number(v.price) : undefined`.

### Out of scope (per instructions, untouched)

- Backend `xlsxwriter` exports (Shipment Invoice, `import_hub` templates) — already correct or explicitly excluded.
- `ApLedger.tsx`, `CreditMemo.tsx`, `Returns.tsx` — already fully numeric with no ambiguity in Step 1; not part of the 8-file fix list.

Verified: `tsc --noEmit -p tsconfig.app.json` shows zero new errors (diffed against a `git stash` of the pre-fix tree — one pre-existing type error surfaced during the fix in `SaleDetail.tsx` from pushing an `undefined` Amount onto a `.map()`-inferred array; resolved by explicitly typing `tenderRows: Record<string, unknown>[]`). `eslint` on all 8 files + the new helper shows zero new warnings/errors (same before/after counts via `git stash` diff). Not yet exercised by opening a generated file in Excel — flagged for confirmation.

---

## 2026-07-04 — Feature: remove AR Ledger section, add Transaction Ledger Excel export

### Removed — AR Ledger section on CustomerDetail

The per-customer "AR Ledger" section (all sales incl. cash, superseded by the Transaction Ledger added 2026-07-03) is removed from `frontend/src/pages/customers/CustomerDetail.tsx`, along with its query, Load More pagination state (`arLedger`, `arMore`, `arLoading`, `loadMoreArLedger`), the `arWithBalance` backward-running-balance computation, the `AR_LEDGER_PAGE` constant, and the now-unused `ArLedgerOut` import.

Checked reuse before touching the backend: `salesApi.customers.arLedger()` / `qk.customerArLedger()` had exactly one caller (this page). The backend route `GET /sales/customers/{customer_id}/ar-ledger` (`get_customer_ar_ledger` in `backend/sales/router.py`) was therefore **deleted** — confirmed via `grep` across the whole repo and by re-registering the FastAPI router in-process to verify it no longer resolves. Two other routes share the `ArLedgerOut` response schema and were **left alone** since they're independently used elsewhere: `GET /sales/customers/ar-ledger` (the invoice-level view behind `CustomerARLedger.tsx`) and `GET /sales/ar-ledger` (the general ledger list). The `ArLedgerOut` schema/type itself is still used by those two and was not removed.

### Added — Transaction Ledger Excel export

- **`backend/sales/router.py`**: extracted the row-building logic out of `get_customer_transaction_ledger` into `_build_customer_transaction_ledger(customer_id, db)`, which returns the full, chronologically-sorted, running-balance-and-status-computed list with no pagination. The existing paginated endpoint now calls this helper and slices by `seq`/`limit` as before (no behavior change). Added `GET /sales/customers/{customer_id}/transaction-ledger/export`, which calls the same helper and returns everything unsliced — the frontend export pulls full history in one call rather than looping the paginated endpoint.
- **`frontend/src/services/api.ts`**: added `salesApi.customers.transactionLedgerExport(id)`.
- **`frontend/src/pages/customers/CustomerDetail.tsx`**: added an "Export to Excel" button next to the Transaction Ledger heading. `handleExportLedger()` fetches the full export endpoint, builds a workbook client-side with the `xlsx` package (`aoa_to_sheet` for a leading statement-header block, `sheet_add_json` with an `origin` offset to append the table below it) — the same library every other export in the app already uses (`ApLedger.tsx`, `CustomerARLedger.tsx`, `SalesLedger.tsx`, etc.), all of which are client-side; no backend-generated files exist elsewhere to match instead.
  - Header block: Customer Name, Terms, Credit Limit, Outstanding Balance, "Statement generated on [date]". No address/contact fields exist on the `Customer` model (checked `sales/models.py` and `docs/schema.dbml`), so none are included.
  - Table: Date, Sales ID, Status, Debit, Credit, Balance — same columns/order as on-screen, full history oldest→newest.
  - Filename: `{customer_name_sanitized}_transaction_ledger_{YYYY-MM-DD}.xlsx`, matching the `{entity}_{date}.xlsx` convention used by every other export (e.g. `ar_ledger_${today}.xlsx`, `ar_aging_${todayLocal()}.xlsx`). Customer name is stripped of non-alphanumeric characters since no other export embeds a free-text name in the filename.

Verified: `tsc --noEmit` clean; backend router imports and both new/removed routes confirmed present/absent by re-registering the FastAPI app in-process (`/sales/customers/{customer_id}/transaction-ledger/export` present, `/sales/customers/{customer_id}/ar-ledger` absent, `/sales/customers/ar-ledger` and `/sales/customers/ar-ledger/{sale_id}/payments` unaffected). Not yet exercised against a rebuilt container.

---

## 2026-07-04 — Fix: stale query invalidation after Record Payment

`frontend/src/pages/customers/CustomerDetail.tsx`'s `handleRecordPayment` invalidated `qk.customerPayments(cid)` after recording a payment — a query key left over from the "Payments" section removed on 2026-07-03, no longer subscribed to by anything on the page. As a result, recording a payment against an AR-Charge sale updated the customer's balance and the AR Ledger section correctly, but the new Transaction Ledger table (and its per-row Status) went stale until a full page reload.

Changed the invalidation target to `qk.customerTransactionLedger(cid)`, matching the query key the Transaction Ledger section actually reads from. `tsc --noEmit` clean.

---

## 2026-07-04 — Enhancement: Status column on Customer Transaction Ledger

Added a per-sale `status` field to the Transaction Ledger introduced 2026-07-03, computed server-side in the same query that builds `running_balance` so both stay consistent.

### `backend/sales/router.py`

- `get_customer_transaction_ledger`: added `applied_by_sale`, a dict summing `amount_applied` from the already-queried `collection_rows` (non-AR-charge `customer_payment_applied` rows), grouped by `sale_id`. No new query — reuses the same rows the Credit column is built from.
- SALE rows: `status = "Paid"` when `total_applied >= charged` (the sale's AR-charged debit), `"Unpaid"` when `total_applied <= 0`, else `"Partially Paid"`. This is scoped strictly to payments applied against that specific `sale_id` — independent of the customer's overall balance or other sales.
- PAYMENT rows: fixed `status = "Payment"`.

### `backend/sales/schemas.py`

- `TransactionLedgerRowOut`: added `status: str`.

### `frontend/src/services/api.ts`, `frontend/src/pages/customers/CustomerDetail.tsx`

- `TransactionLedgerRowOut` type: added `status: 'Paid' | 'Partially Paid' | 'Unpaid' | 'Payment'`.
- Table column order: Date, Sales ID, **Status**, Debit, Credit, Balance. `colSpan` on loading/empty rows bumped 5 → 6.
- Badge reuses the exact classes from the pre-existing (now-removed) Sales History `payment_status` badge — emerald/Paid, yellow/Partially Paid, red/Unpaid — and the neutral `t-bg-elevated t-text-3` style (same as the header's Inactive badge) for the `Payment` label on collection rows. No new colors introduced.

Verified: `tsc --noEmit` clean, backend files parse. Hand-traced against live DB data (customer 3 / sale 38: charged 600, applied 600 → Paid; customer 2 / sales 3,4,5,41: applied 0 → Unpaid). No sale in current test data has a partial collection, so "Partially Paid" wasn't observed live — logic verified by inspection instead. Containers not rebuilt as part of this change.

---

## 2026-07-03 — Feature: Customer Transaction Ledger (AR Charge sales + collections)

Replaced the "Sales History" and "Payments" sections on the customer detail page with a single Transaction Ledger scoped to AR Charge activity only. The pre-existing "AR Ledger" section on the same page was left as-is — it intentionally covers *every* sale tied to the customer (cash included), whereas this new ledger excludes cash/non-credit sales entirely.

### `backend/sales/schemas.py`

- Added `TransactionLedgerRowOut`: `seq`, `date`, `type` (`SALE`|`PAYMENT`), `sale_id`, `payment_id`, `sales_id`, `debit`, `credit`, `running_balance`.

### `backend/sales/router.py`

- Added `GET /sales/customers/{id}/transaction-ledger` (permission: `view_ar_ledger`).
- A sale qualifies only if at least one `customer_payment_applied` row against it comes from a payment mode with `is_ar_charge = true`. The debit amount is the AR-charged portion only (correctly handles split tender, e.g. part Cash / part AR Charge), not the full `grand_total`.
- Collection rows are every `customer_payment_applied` against those same sales where the mode is **not** AR Charge — mirrors the existing exclusion pattern already used by `get_ar_ledger_sale_payments` and the AR Aging report.
- Rows are sorted oldest → newest with a running balance computed from the start of the customer's AR-Charge history (no windowed/opening balance needed). Pagination uses an ordinal `seq` field as the Load More cursor, computed after the full set is balanced, so correctness doesn't depend on page boundaries.
- Voided AR-charged sales are excluded (only `status == 'Posted'` sales are considered) — their debt reversal isn't represented as a row in this view.

### `frontend/src/services/api.ts`, `frontend/src/lib/queryKeys.ts`

- Added `TransactionLedgerRowOut` type, `salesApi.customers.transactionLedger(id, cursor?, limit?)`, and `qk.customerTransactionLedger(id)`.

### `frontend/src/pages/customers/CustomerDetail.tsx`

- Removed the "Sales History" and "Payments" sections and their query/pagination state (`qSales`, `qPayments`, `sales`, `payments`, `loadMoreSales`, `loadMorePayments`).
- Added a single "Transaction Ledger" section (Date, Sales ID, Debit, Credit, Balance) backed by the new endpoint, same Load More / skeleton / empty-state conventions as the rest of the page. Sale rows link to `/sales/ledger/{sale_id}`; payment rows are not clickable.
- `salesApi.customers.sales()` / `.payments()` and their backend endpoints are now unused by this page but were left in place (not deleted) since no other caller was confirmed absent and removing a public endpoint wasn't requested.

Verified with `npx tsc --noEmit` (clean) and by importing `sales/router.py` / `sales/schemas.py` directly to confirm the route registers with no errors. Not yet exercised end-to-end against a running stack.

---

## 2026-07-01 — Enhancement: Add SKU to Inventory Ledger keyword search

Added variant SKU as a searchable field in the keyword search bar on the Inventory Ledger page (`frontend/src/pages/stock/Ledger.tsx`). A single line added to the `hit` function inside the `filtered` useMemo:

```
normalize(e.variant?.sku ?? '').includes(term)
```

Searched fields are now: brand, variant name, PID, **SKU**, reference ID. AND logic across tags is unchanged. No other files modified. `npx tsc --noEmit` passes with zero errors.

---

## 2026-07-01 — Security: Retire manage_import as standalone gate; per-type Import access

`manage_import` was a coarse master switch that either unlocked or blocked the entire Import Hub. It is now retired from the frontend. Import tab and section visibility are derived from the data-type action_keys the user already holds.

### `frontend/src/pages/Settings.tsx`

- `TAB_ACTION_MAP` type changed from `Record<TabName, string>` to `Partial<Record<TabName, string>>`. The `'Import'` entry removed.
- Added `IMPORT_DATA_ACTIONS = ['manage_products', 'manage_suppliers', 'manage_customers']`.
- `visibleTabs` filter updated: Import tab appears if the user holds **any** of the three data-type actions; all other tabs continue to use `TAB_ACTION_MAP` as before.

### `frontend/src/pages/settings/ImportHub.tsx`

- Added `actionKey` field to `EntityConfig` interface and filled for all 5 entities.
- Added `useAuth` import and `useMemo`.
- `ImportHub` component now filters `ENTITIES` to `visibleEntities` based on `user?.action_keys`.
- If `visibleEntities` is empty: renders "You do not have permission to import any data type. Contact your administrator." — no sidebar, no form.
- Sidebar shows only the entities the user can access. Active entity falls back to first visible if the stored `activeId` is no longer in scope.

### Backend — no changes

All 5 import endpoints in `backend/import_hub/router.py` were already correctly gated per type:

| Import type (ENTITY id) | Backend permission |
|---|---|
| `customers` | `manage_customers` |
| `suppliers` | `manage_suppliers` |
| `stock-balances` | `manage_products` |
| `variant-prices` | `manage_products` |
| `variant-costs` | `manage_products` |

### Data cleanup — deferred

`manage_import` remains in `auth.actions` and any existing `auth.role_actions` rows to avoid silent breakage. It is no longer referenced anywhere in the frontend. A follow-up pass will remove it from seed data and clean up orphaned rows.

---

## 2026-07-01 — Feature: AP Ledger export

Added an "Export XLSX" button to `frontend/src/pages/ap/ApLedger.tsx`, closing the `export_ap_ledger` action_key which previously had a seed entry but no corresponding frontend feature.

- Added `useAuth` import and `import * as XLSX from 'xlsx'`.
- `canExport` gates the button: `user?.action_keys?.includes('export_ap_ledger')`.
- `handleExport()` maps currently loaded `rows` (filtered by selected supplier) to columns: Date, Supplier, Reason, Amount Change (raw signed number), Reference. Writes `ap_ledger_<date>.xlsx`.
- Button is disabled when `rows.length === 0`, consistent with `SupplierAging.tsx`.
- No backend changes — export is fully client-side, same as all other export features in the app.

---

## 2026-07-01 — Security: export action_key enforcement and process_blind_returns frontend gate

Closed nine ungated action_keys. All exports are generated client-side (no backend export endpoints exist); gating is applied entirely on the frontend by hiding buttons. `process_blind_returns` backend enforcement was already in place; this change adds the matching frontend gate.

### Frontend — export button gating

Each file received a `useAuth` import (where not already present), a `canExport` boolean derived from `user?.action_keys?.includes(...)`, and the Export XLSX button wrapped in `{canExport && ...}`.

| Action key | File | Notes |
|---|---|---|
| `export_sales` | `frontend/src/pages/sales/SalesLedger.tsx` | Added `useAuth` import |
| `export_returns` | `frontend/src/pages/sales/Returns.tsx` | Added `useAuth` import |
| `export_products` | `frontend/src/pages/inventory/Catalogue.tsx` | `useAuth` already imported; added `canExport` alongside existing `canEdit` |
| `export_stock_ledger` | `frontend/src/pages/stock/Ledger.tsx` | Added `useAuth` import |
| `export_ap_aging` | `frontend/src/pages/ap/SupplierAging.tsx` | Added `useAuth` import |
| `export_customer_aging` | `frontend/src/pages/customers/CustomerAging.tsx` | `useAuth` already imported (see cleanup note below) |
| `export_ar_ledger` | `frontend/src/pages/customers/CustomerARLedger.tsx` | Added `useAuth` import |

### Frontend — `process_blind_returns` gate (`ReturnNew.tsx`)

- Added `useAuth` import and `canBlind = user?.action_keys?.includes('process_blind_returns') ?? false`.
- The blind-return catalog item picker (`{!saleId && ...}`) is now conditioned on `canBlind`. When the user lacks the action and navigates to `/sales/returns/new` without a `?sale_id`, a message is shown instead: "You do not have permission to process blind returns. To process a return, open it from the original sale."
- Backend enforcement was already present: `_do_return()` in `backend/sales/router.py` lines 2697–2699 calls `has_action(current_user, "process_blind_returns", db)` when `is_blind`. No backend change needed.

### Bonus cleanup — `CustomerAging.tsx`

Removed stale hardcoded `ALLOWED_ROLES = ['ADMIN', 'STORE_MANAGER']` page-level role guard and unused `Navigate` import. Program-level access is now handled by `RequireProgram` in `App.tsx` (same cleanup pattern applied to `CreditMemo.tsx` in the Tier 1 session).

### No-feature finding — `export_ap_ledger`

`ApLedger.tsx` has no Export XLSX button — the action key exists in seed data but has no corresponding frontend feature. **No change made.** Decision deferred: either remove the seed data entry or build the missing export button.

---

## 2026-07-01 — Security: Tier 2 — program-level route guards (direct URL bypass)

Authenticated users could reach any module by typing the URL directly, bypassing the nav-bar visibility rules. Added a reusable `RequireProgram` guard that enforces program-level access at the route layer.

### New component

- **`frontend/src/components/RequireProgram.tsx`** — Accepts `program: string | string[]`. Reads `user.programs` from `useAuth()`. If the user holds none of the required programs, redirects to `/no-access`. Supports single-program and "any of" multi-program checks.

### New page

- **`frontend/src/pages/NoAccess.tsx`** — Renders when an authenticated user has zero programs assigned across all modules. Shows "Your account has no assigned permissions. Contact your administrator." with a Logout button. Prevents the infinite redirect loop that would otherwise occur (`/` → `/sales` → RequireProgram → `/` → …).

### `frontend/src/App.tsx`

- Imported `RequireProgram` (static import, not lazy).
- Added lazy-loaded `NoAccess` page.
- Added `<Route path="/no-access" element={<NoAccess />} />` inside `ProtectedRoute` + `AppShell`, with no guard of its own.
- Wrapped every module route element with `RequireProgram`:

| Route | Programs required (any of) |
|---|---|
| `/sales/*` | `sales_workstation`, `sales_ledger`, `sales_returns` |
| `/inventory/*` | `inventory_catalogue` |
| `/stock/*` | `stock_transfers`, `stock_receiving`, `stock_ledger` |
| `/procurement/*` | `procurement_suppliers`, `procurement_purchase_orders` |
| `/ap/*` | `ap_invoices`, `ap_payments`, `ap_ledger`, `ap_aging` |
| `/customers/*` | `customers_list`, `customers_aging`, `customers_ar_ledger`, `customers_credit_memo`, `customers_pdc_vault` |
| `/settings/*` | (unchanged — guarded inside `Settings.tsx`) |
| `/admin/*` | `settings` |

### Module pages — zero-program fallback

Added early-return "no access" message to four module pages for the edge case where a user has the module's route-level program but no sub-programs (e.g., a program was revoked while the page was open in another tab):

- **`frontend/src/pages/Stock.tsx`**
- **`frontend/src/pages/Procurement.tsx`**
- **`frontend/src/pages/AP.tsx`**
- **`frontend/src/pages/Customers.tsx`**

Each renders `"You do not have access to any sections in this module."` instead of an empty nav bar.

---

## 2026-07-01 — Security: Tier 1 — RBAC gaps (discount enforcement, credit memo, write-button visibility)

Closed real-business-risk RBAC gaps: backend enforcement of `apply_discount`, correct action-key gates on credit memo endpoints, and frontend write-button visibility across six modules.

### PART 1 — `apply_discount` enforcement

**`backend/sales/router.py`**

- `create_draft`: Added inline `has_action` check. If the payload contains any non-zero discount field (`cart_discount_pct`, `cart_discount_flat`, `discount_amount`, or any item-level `discount_pct`/`discount_flat`) and the caller lacks `apply_discount`, raises HTTP 403 `"You do not have permission to apply discounts."`.
- `update_draft`: Added smarter inline check that allows preserving existing discounts on a loaded draft. Rejects only if incoming cart discount values _exceed_ the current values, or if a newly added line item carries a non-zero discount. Users without `apply_discount` can still save drafts that already had a discount applied by another user.

**`frontend/src/pages/sales/Workstation.tsx`**

- Added `canDiscount` boolean derived from `myPrograms?.action_keys?.includes('apply_discount')` with localStorage fallback (same live-fetch pattern as `cashieringMode`).
- Per-line `Disc %` and `Disc ₱` table cells: when `!canDiscount`, render a read-only `<span>` instead of the `<input>` + fill handle. Existing draft discount values are still visible.
- Cart footer `Cart Disc %` and `Cart Disc ₱` input rows: wrapped in `{canDiscount && ...}`; the computed `Discount` summary line remains visible when `cartDiscountAmt > 0`.
- `buildPatchPayload`: when `!canDiscount`, sends `null` for all three cart discount fields so a user without the action cannot inadvertently trigger the backend discount guard when saving a draft that was discounted by someone else.

### PART 2 — Credit memo enforcement

**`backend/sales/router.py`**

- `issue_credit_memo`: changed `require_permission("manage_customers")` → `require_permission("issue_credit_memo")`.
- `cancel_credit_memo`: changed `require_permission("manage_customers")` → `require_permission("cancel_credit_memo")`.

**`frontend/src/pages/customers/CreditMemo.tsx`**

- Removed stale `ALLOWED_ROLES` constant (`['ADMIN', 'STORE_MANAGER']`) and the hardcoded role guard that redirected to `/customers`.
- Removed the `Navigate` import that was only used for the role guard.
- "Issue Credit Memo" button gated with `user?.action_keys?.includes('issue_credit_memo')`.
- Table-row "Cancel" button gated with `user?.action_keys?.includes('cancel_credit_memo')`.
- Detail-modal "Cancel Memo" button gated with `user?.action_keys?.includes('cancel_credit_memo')`.

### PART 3 — Write-button visibility

Added `useAuth` + action-key checks to hide write-path buttons for users who lack the corresponding permission. Backend enforcement was already in place; these changes bring the frontend into alignment.

| File | Action key | Buttons gated |
|---|---|---|
| `frontend/src/pages/procurement/Suppliers.tsx` | `manage_suppliers` | + New Supplier, Edit, Deactivate/Reactivate |
| `frontend/src/pages/procurement/PurchaseOrders.tsx` | `manage_purchase_orders` | + New PO |
| `frontend/src/pages/ap/InvoiceDetail.tsx` (`MatchTab`) | `manage_invoices` | Billed Qty inline edit, Unit Cost inline edit (renders static `<span>` when denied) |
| `frontend/src/pages/ap/ApPayments.tsx` | `manage_payments` | + New Payment |
| `frontend/src/pages/customers/CustomerList.tsx` | `manage_customers` | + New Customer |
| `frontend/src/pages/customers/CustomerDetail.tsx` | `manage_customers` | Edit |
| `frontend/src/pages/stock/Transfers.tsx` | `create_transfer` | + New Transfer |

---

## 2026-06-30 — Fix: SKU blank in Sheet 3 and Receipt No. not restored when loading draft

### Fix A — SKU blank in Sheet 3 of Sales Ledger XLSX

**Root cause:** `_collapse_items` in `backend/sales/router.py` builds `VariantRefOut` explicitly field-by-field, but never passed `sku`. `VariantRefOut.sku` is `Optional[str] = None`, so every collapsed item returned `sku = None` regardless of what the variant had in the catalogue. `Variant.sku` is a direct DB column already eager-loaded by the existing `selectinload(SaleItem.variant)` — it was simply never forwarded.

**Fix:** Added `sku=first.variant.sku` to the `VariantRefOut(...)` constructor inside `_collapse_items`.

### Fix B — Receipt No. not restored when loading a saved draft

**Root cause:** `loadDraft` in `frontend/src/pages/sales/Workstation.tsx` restores `registerId`, `employeeId`, and `shiftId` from the draft's `SaleOut` response, but not `receiptNo`. The `GET /sales/drafts/{id}` endpoint returns `receipt_no` in the `SaleOut`, but it was never written back to `header.receiptNo`. A cashier loading a draft that had a receipt number would see a blank "Receipt No." field.

**Fix:** Added `receiptNo: draft.receipt_no ?? ''` to the `setHeader` spread inside `loadDraft`.

---

## 2026-06-30 — Feature: cashier-entered Receipt No. on sales

Adds an optional free-text `receipt_no` field (VARCHAR 100, nullable) that cashiers can enter manually on each transaction. Fully wired through backend, workstation, detail view, and XLSX export.

### Backend

- **`backend/alembic/versions/o5p6q7r8s9t0_add_receipt_no_to_sales.py`** — New migration (`down_revision = n4o5p6q7r8s9`): `ALTER TABLE sales.sales ADD COLUMN IF NOT EXISTS receipt_no VARCHAR(100) NULL`.
- **`backend/sales/models.py`** — `Sale`: added `receipt_no = Column(String(100), nullable=True)`.
- **`backend/sales/schemas.py`** — Added `receipt_no: Optional[str] = None` to `SaleCreate`, `SalePatch`, and `SaleOut`.
- **`backend/sales/router.py`** — `create_draft` passes `receipt_no=payload.receipt_no` to the `Sale` constructor. `update_draft` conditionally sets `sale.receipt_no = payload.receipt_no` when the field is provided.

### Frontend — API types

- **`frontend/src/services/api.ts`** — Added `receipt_no?: string | null` to `SaleCreate`, `SalePatch`, and `SaleOut`.

### Frontend — Workstation

- **`frontend/src/pages/sales/Workstation.tsx`**:
  - `SessionHeader` interface: added `receiptNo: string`.
  - Initial state: `receiptNo: ''`.
  - Renamed existing "Receipt No." header label to "Sale PID" (it was wired to `salePID`, the auto-generated system ID with Auto/Manual toggle — the label was incorrect).
  - Added a new "Receipt No." `<input>` for `header.receiptNo` (optional, placeholder "optional").
  - `buildDraftPayload` and `buildPatchPayload`: include `receipt_no: header.receiptNo || undefined`.
  - `handlePost` success, `handleVoidDraft` success, and `handleNew`: reset `receiptNo` to `''`.

### Frontend — Sale Detail

- **`frontend/src/pages/sales/SaleDetail.tsx`** — Added `{sale.receipt_no && ...}` to the header grid — shows "Receipt No." label and monospace value only when non-null.

### Frontend — XLSX export (Sheet 2 + Sheet 3)

- **`frontend/src/pages/sales/SalesLedger.tsx`**:
  - Sheet 2 "Line Item Detail": added `'Receipt No.': s.receipt_no || ''` column after Sale PID, before Date.
  - Sheet 3 "Sales by Variant": `variantAgg` map type and first-insert block updated to carry `sku: string | null`; `variantRows .map()` now emits an `SKU` column after PID, before Brand.

---

## 2026-06-29 — Enhancement: Inventory Ledger — KeywordSearch + SKU column

Replaced the plain search `<input>` on `/stock/ledger` with the `<KeywordSearch>` multi-tag component (AND logic). Added a SKU column to the table. No backend files changed.

### `frontend/src/pages/stock/Ledger.tsx`

- Replaced `search` / `setSearch` state with `searchTags: string[]` + `liveInput: string`.
- Filter `useMemo`: all committed tags AND the live partial input must all match (brand, variant name, PID, reference ID).
- Replaced the plain `<input>` with `<KeywordSearch tags={searchTags} onTagsChange={setSearchTags} onPartialChange={setLiveInput} />`.
- Added "SKU" column header and `e.variant?.sku ?? '—'` cell after PID.
- Updated `colSpan` and `SkeletonTable cols` from 8 to 9.

### `frontend/src/services/api.ts`

- `LedgerEntry.variant`: added `sku?: string | null` to satisfy TypeScript.

---

## 2026-06-29 — Enhancement: Sales Ledger XLSX — Sheet 3 "Sales by Variant"

Added a third sheet to the Sales Ledger XLSX export aggregating sold quantities and most-recent price/cost per variant. Voided sales and return rows are excluded. No backend changes.

### `frontend/src/pages/sales/SalesLedger.tsx`

- Added `catalogueApi` and `InvProduct` imports.
- Inside `handleExport`: fetches the product catalogue to build a `Map<variant_id, supplierName>` from primary supplier assignments (fails silently if the fetch errors — supplier column left blank).
- Aggregates line items into `variantAgg: Map<number, { PID, sku, brand, variantName, qty, unitPrice, unitCost, latestDate }>` per unique `variant_id`; unit price and cost are taken from the most recent transaction date.
- `variantRows` sorted by Brand then Variant Name.
- Columns: PID | SKU | Brand | Variant Name | Supplier | Qty | Unit Price | Unit Cost.
- Appended as Sheet 3 "Sales by Variant" via `XLSX.utils.book_append_sheet`.

---

## 2026-06-29 — Fix: manage_products access control checking wrong field

Users with the `manage_products` action assigned were blocked from the product detail page and catalogue because two guards were checking `user.programs` (module-level keys) instead of `user.action_keys` (granular action keys). `manage_products` is an action, not a program.

### `frontend/src/pages/Inventory.tsx`

- `RequireManageProducts`: `user?.programs.includes('manage_products')` → `user?.action_keys.includes('manage_products')`.

### `frontend/src/pages/inventory/Catalogue.tsx`

- `canManageProducts` derived value: same fix — `.programs.includes` → `.action_keys.includes`.

---

## 2026-06-28 — Fix: audit_variance not calculated when receipt_grand_total is null

**`backend/sales/router.py`** — `post_draft` was unconditionally setting `sale.receipt_grand_total = grand_total` and calculating `audit_variance = total_tendered_raw - grand_total` (which captured the change-due amount) on every posted sale regardless of mode. The frontend correctly sends `receipt_grand_total: null` in cashiering mode, but the backend was ignoring `payload.receipt_grand_total` entirely.

Fixed:
- `sale.receipt_grand_total` now reads from `payload.receipt_grand_total` (null in cashiering mode, user-supplied value in audit mode)
- `audit_variance` is now `payload.receipt_grand_total - grand_total` when `receipt_grand_total is not None`, otherwise explicitly `None`
- Removed the dead `total_tendered_raw` variable that was only used for the old incorrect formula

---

## 2026-06-28 — Fix: Workstation sticky writes gated on cashieringConfirmed ref

All three sticky saves (shift, location, register) were gated on `cashieringMode`, which is `false` while `myPrograms` is loading. If the user changed a field during the loading window, `saveSticky` was silently skipped and nothing was written to localStorage.

Added `cashieringConfirmed = useRef(false)` that latches to `true` the first time `cashieringMode` resolves to `true` and never reverts. All three `saveSticky` calls now guard on `cashieringConfirmed.current` instead of `cashieringMode`, so once the session is confirmed as cashiering mode the writes fire reliably regardless of re-fetches or timing.

---

## 2026-06-28 — Fix: Workstation employees fetch gated robustly against stale sessions

`GET /auth/employees` requires `manage_users` — a permission cashiers do not hold. The fetch was firing unconditionally, causing a 403 for cashier users.

**Root cause of the regression:** `cashieringMode` was derived solely from `user.action_keys` in localStorage. Sessions saved before `action_keys` was added to the login flow have `action_keys: []` (backwards-compat default), making `cashieringMode = false` even for cashier users — bypassing the `enabled: !cashieringMode` guard.

**Fix:** Added a `myPrograms` query (`GET /auth/me/programs`) that runs on every Workstation mount. `cashieringMode` is now derived from live `myPrograms.action_keys` (primary) with the localStorage value as an instant fallback for the first paint. The employees query is gated on `!myProgramsPending && !cashieringMode`, so it cannot fire until the live programs fetch completes and confirms the user is not in cashiering mode.

---

## 2026-06-28 — Workstation: receipt_grand_total hidden in cashiering mode

### Frontend
- **`frontend/src/pages/sales/Workstation.tsx`** — Added `receiptGrandTotal` state and a "Receipt Total" input field (audit mode only). In cashiering mode the field is hidden and `receipt_grand_total` is sent as `null` in `buildDraftPayload()`, `buildPatchPayload()`, and the post payload, so `audit_variance` is never calculated on cashiered sales. In audit mode the field is visible and the value is included in all three payloads normally. Field resets on post, void, and new transaction; restores when loading a saved draft.

---

## 2026-06-28 — Refactor: Cashiering mode moved to RBAC action

Removes the `pos_cashiering_mode` system-setting toggle and replaces it with a
`cashiering_mode` action on the `sales_workstation` program. Admins assign the
action to a role via Settings → Roles → Permissions matrix; no global on/off toggle exists anymore.

### Backend
- **`backend/settings/schemas.py`** — Removed `POSSettingsOut` and `POSSettingsPatch`.
- **`backend/settings/router.py`** — Removed `GET /settings/pos` and `PATCH /settings/pos`.
- **`backend/main.py`** — Added `cashiering_mode / Cashiering Mode` action seed under `sales_workstation`. Not assigned to any role by default.
- **`backend/auth/schemas.py`** — Added `action_keys: List[str] = []` to `UserProgramsOut`.
- **`backend/auth/router.py`** — `GET /auth/me/programs` now also queries and returns `action_keys` for the calling user's roles.
- **`docs/rbac_programs_actions.md`** — Added `cashiering_mode` entry under `sales_workstation` actions.

### Frontend
- **`frontend/src/services/api.ts`** — Removed `POSSettings` interface and `settingsApi.posSettings`. Added `action_keys: string[]` to `UserProgramsOut`.
- **`frontend/src/lib/queryKeys.ts`** — Removed `posSettings` query key.
- **`frontend/src/context/AuthContext.tsx`** — Added `action_keys: string[]` to `AuthUser`; populated from `GET /auth/me/programs` at login; backwards-compat default is `[]`.
- **`frontend/src/pages/Settings.tsx`** — Removed `POS Workstation` tab, `POSWorkstationTab`, and `ToggleRow` components entirely.
- **`frontend/src/pages/sales/Workstation.tsx`** — `cashieringMode` is now `user?.action_keys?.includes('cashiering_mode') ?? false` — synchronous, zero latency, no fetch. Removed `posSettings` query, `posSettingsLoading`, and all related skeleton guards. Mode badge and date field now render their final state on first paint.

### Migration note
Any `pos_cashiering_mode` row that was written to `settings.system_settings` by the old toggle is now an orphaned row (nothing reads it). No migration is required — the row is harmless and will remain until manually cleaned up.

## 2026-06-28 — Fix: Cashiering mode — date picker timing + cashier submission bugs

### BUG 1 — Date picker still editable on load (timing)
`cashieringMode` was derived as `posSettings?.pos_cashiering_mode ?? false`, defaulting to `false` while the settings query was in-flight. The date input rendered as an editable picker until the fetch resolved.

- **`frontend/src/pages/sales/Workstation.tsx`** — `cashieringMode` is now `null` while `posSettingsLoading` is true. Mode badge, date field, and cashier field all render a skeleton placeholder while `null`, then snap directly to the correct locked/unlocked state once resolved — no picker is ever shown in cashiering mode.

### BUG 2 — Cashier blank / wrong employee submitted
The `useEffect` that set `header.employeeId` was gated on `myProfile?.employee_id != null`. Users without a linked employee record caused `null != null = false`, so the effect never fired and `employee_id: null` was submitted with every sale.

- **`backend/auth/router.py`** — `GET /auth/me` now returns HTTP 400 with a descriptive message if `user.employee` is `None`. Every user must be linked to an employee; unlinked accounts are a data-integrity error, not a silent `null`.
- **`frontend/src/pages/sales/Workstation.tsx`** — Added `resolveEmployeeId()` helper that reads from `myProfile.employee_id` directly in cashiering mode (not from `header.employeeId` state). `handlePost` blocks submission with an inline error when cashiering mode is on and the profile has no linked employee. The cashier display also shows a red "Not linked" label and the full inline error message in that case.

## 2026-06-28 — Feature: Cashiering Mode toggle

Adds a system-wide POS mode flag (`pos_cashiering_mode`) that changes how the workstation operates.

### Backend
- **`backend/auth/schemas.py`** — Added `UserProfileOut` (user_id, username, employee_id, first/last name).
- **`backend/auth/router.py`** — Added `GET /auth/me` that decodes the JWT directly (bypasses `get_current_user` stub) to return the calling user's own profile + linked employee.
- **`backend/settings/schemas.py`** — Added `POSSettingsOut` and `POSSettingsPatch` schemas.
- **`backend/settings/router.py`** — Added `GET /settings/pos` (open) and `PATCH /settings/pos` (requires `manage_sales_settings`).

### Frontend
- **`frontend/src/lib/queryKeys.ts`** — Added `posSettings` and `myProfile` query keys.
- **`frontend/src/services/api.ts`** — Added `UserProfileOut`, `POSSettings` interfaces; `authApi.me.profile()`, `settingsApi.posSettings.get/patch`.
- **`frontend/src/pages/Settings.tsx`** — Added `'POS Workstation'` tab with `POSWorkstationTab` component: toggle switches `pos_cashiering_mode` via API.
- **`frontend/src/pages/sales/Workstation.tsx`**:
  - Fetches `GET /settings/pos` and `GET /auth/me` on load.
  - In **Cashiering Mode**: Date locked to today, Cashier replaced with logged-in user's name (read-only), Shift and Location are sticky (persisted to localStorage).
  - In **Audit Mode**: Fully editable as before.
  - Mode badge displayed in the session header bar.

## 2026-06-28 — Fix: SyntaxError due to duplicate `_actor` parameter in `get_pdc_vault`

`GET /pdc` had two `_actor: AuthUser = Depends(...)` parameters in its signature — `view_pdc_vault` (correct) and `manage_customers` (erroneous duplicate added during RBAC wiring). Python raises `SyntaxError: duplicate argument '_actor'` on import, preventing the backend from starting.

### `backend/sales/router.py`
- Removed the spurious `_actor: AuthUser = Depends(require_permission("manage_customers"))` from `get_pdc_vault`; the `view_pdc_vault` guard is the correct and only permission for that endpoint.

---

## 2026-06-27 — Feature: DB-driven RBAC enforcement (nav visibility + route gating)

Wires the DB program assignments to actual nav and route access. Previously all program/action data was stored in the DB but the frontend still used hardcoded role-name arrays, so granting a program in Settings had no visible effect until re-implemented here.

### `backend/auth/schemas.py`
- Added `UserProgramsOut(program_keys: List[str])` — scoped to the calling user's assigned programs.

### `backend/auth/router.py`
- New `GET /auth/me/programs` endpoint (appears before `GET /auth/programs`): queries `role_programs JOIN programs` for every role held by the current user, deduplicates with `.distinct()`, returns `{ program_keys: [...] }`. Any authenticated user.

### `backend/sales/router.py`
- Added `require_permission` guards to 15 previously unguarded read endpoints:
  - `GET /` → `view_sales_ledger`
  - `GET /summary` → `view_sales_ledger`
  - `GET /{sale_id}/items` → `view_sales_ledger`
  - `GET /returns` → `view_returns`
  - `GET /returns/{return_id}` → `view_returns`
  - `GET /sale/{sale_id}/items-for-return` → `process_returns`
  - `GET /customers/ar-ledger` → `view_ar_ledger`
  - `GET /customers/ar-ledger/{sale_id}/payments` → `view_ar_ledger`
  - `GET /customers/{customer_id}/ar-ledger` → `view_ar_ledger`
  - `GET /customers/{customer_id}/sales` → `view_customers`
  - `GET /customers/{customer_id}/payments` → `view_customers`
  - `GET /ar-ledger` → `view_ar_ledger`
  - `GET /pdc` → `view_pdc_vault`
  - `GET /payments` → `manage_customers`
  - `GET /payments/{payment_id}` → `manage_customers`
- POS workstation reference endpoints intentionally left unguarded (shifts, payment-modes, registers, customers list/detail, next-pid, drafts, credit-memos/validate).

### `frontend/src/services/api.ts`
- Added `UserProgramsOut` interface.
- Added `authApi.me.programs()` → `GET /auth/me/programs`.

### `frontend/src/context/AuthContext.tsx`
- `AuthUser` extended with `programs: string[]`.
- `login()`: stores token first, then calls `authApi.me.programs()`, builds full `authUser` with programs, persists to localStorage. Programs fetch wrapped in try/catch — login never fails due to a programs-fetch error.
- `useState` initializer: existing localStorage records without `programs` default to `[]` (backwards-compat).

### `frontend/src/components/AppShell.tsx`
- `NavItem.roles: string[]` replaced with `NavItem.programs: string[]`.
- `visibleNav` filter now checks `item.programs.some(p => programs.includes(p))` — no role names anywhere.
- Program key mappings: Sales → `[sales_workstation, sales_ledger, sales_returns]`; Inventory → `[inventory_catalogue]`; Stock → `[stock_transfers, stock_receiving, stock_ledger]`; Procurement → `[procurement_suppliers, procurement_purchase_orders]`; AP → `[ap_invoices, ap_payments, ap_ledger, ap_aging]`; Customers → `[customers_list, customers_aging, customers_ar_ledger, customers_credit_memo, customers_pdc_vault]`; Settings/Admin → `[settings]`.

### `frontend/src/pages/Sales.tsx`
- "Sales Ledger" tab and `ledger`/`ledger/:saleId` routes gated on `sales_ledger`.
- "Returns" tab and `returns/*` routes gated on `sales_returns`. "New Sale" always renders.

### `frontend/src/pages/Stock.tsx`
- Rewritten: each tab+routes gated on its program. `defaultTab` computed from first accessible program to prevent redirect loops.

### `frontend/src/pages/Procurement.tsx`
- Rewritten: Suppliers on `procurement_suppliers`; POs on `procurement_purchase_orders`. Dynamic `defaultTab`.

### `frontend/src/pages/AP.tsx`
- Rewritten: each of 4 tabs gated on its program. Index and catch-all redirect to first accessible tab.

### `frontend/src/pages/Customers.tsx`
- Rewritten: each of 5 sub-tabs gated on its program. Index and catch-all redirect to first accessible tab.

---

## 2026-06-27 — Fix: duplicate employee record created on Add User

Every "Add User" form submission unconditionally created a new `auth.employees` row because `POST /auth/register` always inserted a new employee regardless of whether one already existed.

### Correct flow (enforced going forward)
1. Admin creates an employee in the Employees section.
2. Admin promotes that employee to a user via a "Create Login" button on the employee row.
3. `POST /auth/register` links the new `auth.users` row to the existing employee via `employee_id`.

No existing duplicate records were cleaned up — only new ones are prevented.

### `backend/auth/schemas.py`
- `UserCreate`: added `employee_id: Optional[int] = None`; made `first_name`/`last_name` optional.
- `EmployeeOut`: added `has_user: bool = False`.

### `backend/auth/router.py`
- `register()`: if `employee_id` is supplied, links existing employee (rejects 400 if it already has a user); else requires name fields and creates a new employee.
- `list_employees()`: annotates `has_user` by checking the set of employee_ids with linked users.
- New `GET /auth/employees/without-user`: returns active employees with no linked user account.

### `frontend/src/services/api.ts`
- `EmployeeOut`: added `has_user: boolean`.
- `UserCreate`: added `employee_id?: number`; made `first_name?/last_name?` optional.
- `authApi.employees`: added `withoutUser()` → `GET /auth/employees/without-user`.

### `frontend/src/lib/queryKeys.ts`
- Added `employeesWithoutUser: () => ['employees', 'without-user'] as const`.

### `frontend/src/pages/Settings.tsx` (`EmployeesUsersTab`)
- Employee table: added "Login" column — "Has Login" badge or "Create Login" button (`!has_user && is_active` rows only).
- Add User form: free-text name inputs removed; replaced with employee dropdown from `without-user` endpoint. Pre-selected and locked when opened via "Create Login".
- `saveUser` payload: `{ employee_id, username, password, role_names }` only.

---

## 2026-06-27 — Feature: DB-driven RBAC (Programs & Actions)

Replaced the hardcoded `ROLE_PERMISSIONS` dict with a fully database-driven permission system per `/docs/rbac_programs_actions.md`.

### Migration: `n4o5p6q7r8s9_rbac_programs_actions`
- Creates `auth.programs`, `auth.actions`, `auth.role_programs`, `auth.role_actions`.

### `backend/auth/models.py`
- Added `Program`, `Action`, `role_programs_table`, `role_actions_table` ORM models.
- Updated `Role` with `programs` and `actions` relationships.

### `backend/auth/dependencies.py`
- Deleted `ROLE_PERMISSIONS` dict.
- Rewrote `require_permission(action_key)`: queries `role_actions JOIN actions` via DB; caches result set on the SQLAlchemy session for the lifetime of the request.
- Added `require_program(program_key)`: same pattern for program-level gating.
- Added `has_action(user, action_key, db) -> bool`: non-raising check for inline use inside business logic.

### `backend/main.py`
- Added `_seed_rbac()`: idempotently seeds all 19 programs, 54 actions, 6 default roles, and their default program/action assignments. All inserts use `ON CONFLICT DO NOTHING`.

### Router audit
- `ap/router.py`: `manage_ap_ledger` → `manage_invoices` (no matching action in new spec).
- `auth/router.py`: role CRUD endpoints `manage_users` → `manage_roles`.
- `sales/router.py`: removed `ROLE_PERMISSIONS` import and `_has_permission` helper; replaced inline blind-return check with `has_action()`; `manage_payments` (customer payments) → `manage_customers`.

### `backend/auth/schemas.py`
- Added: `ActionOut`, `ActionWithProgramOut`, `ProgramOut`, `ModuleGroup`, `RolePermissionsOut`, `RolePermissionsIn`.

### `backend/auth/router.py`
- `GET /auth/programs`: returns all programs grouped by module with their actions. Any authenticated user.
- `GET /auth/actions`: flat list of all actions with their program_key. Any authenticated user.
- `GET /auth/roles/{role_id}/permissions`: returns `{ program_keys, action_keys }`. Requires `manage_roles`.
- `PUT /auth/roles/{role_id}/permissions`: replaces program/action set atomically. Validates orphaned actions. Requires `manage_roles`.

### Frontend
- `api.ts`: added `ModuleGroup`, `ProgramEntry`, `ActionEntry`, `RolePermissions` types; extended `authApi.roles` with `getPermissions` / `setPermissions`; added `authApi.programs.list`.
- `queryKeys.ts`: added `qk.programs()` and `qk.rolePermissions(id)`.
- `Settings.tsx`: added `PermissionMatrix` sub-component to the Roles tab. Program checkboxes expand to action sub-checkboxes. Unchecking a program auto-unchecks its actions. Checking an action auto-checks its parent program. Save calls `PUT /auth/roles/{id}/permissions`.

---

## 2026-06-27 — Fix: PO Reference column always blank in Receiving list

### Root cause
`ShipmentOut` exposed `po_id: int` but no nested PO object, and `list_shipments` did not eagerly load the `purchase_order` relationship. The frontend `Shipment` type already had `po?: { po_id; po_pid }` but it was always `undefined` in practice.

### `backend/procurement/schemas.py`
- New `PurchaseOrderRefOut` schema: `po_id`, `po_pid` (uses `ConfigDict(from_attributes=True)`).
- `ShipmentOut`: added `po: Optional[PurchaseOrderRefOut] = Field(None, validation_alias='purchase_order')`. `validation_alias` maps the `purchase_order` ORM relationship to the `po` JSON key without affecting serialization of other fields. Added `populate_by_name = True` to `ShipmentOut.Config`.

### `backend/procurement/router.py`
- `list_shipments`: added `selectinload(proc_models.InventoryShipment.purchase_order)` to the options block.

### `frontend/src/pages/stock/Receiving.tsx`
- PO Reference column already read `s.po?.po_pid ?? '—'`; now populated correctly once the backend returns the nested object.

---

## 2026-06-27 — Enhancement: KeywordSearch + SKU column on Transfers and Receiving

### `frontend/src/pages/stock/Transfers.tsx`
- Replaced the plain `<input>` search box with the `<KeywordSearch>` component (multi-tag AND logic, same as Catalogue).
- Search fields expanded: `transfer_pid`, `from_location.location_name`, `to_location.location_name`, and item-level `variant.PID`, `variant.sku`, `variant.variant_name`.
- Added **SKU** column after Transfer PID: comma-separated list of unique SKUs across all items on that transfer row; shows `—` when none are set.
- Export XLSX updated to include the SKU column.
- All existing filters kept: Location dropdown, Status dropdown, Date From, Date To.

### `frontend/src/pages/stock/Receiving.tsx`
- Replaced the plain `<input>` search box with `<KeywordSearch>` (multi-tag AND logic).
- Search fields expanded: `shipment_pid`, `supplier.supplier_name`, `reference_number`, `po?.po_pid`, and detail-level `variant.PID`, `variant.sku`, `variant.variant_name`.
- Added **SKU** column after Shipment PID: comma-separated unique SKUs from `receiving_details[].variant.sku`; shows `—` when none are set.
- Export XLSX updated to include the SKU column.
- Supplier dropdown filter kept.

---

## 2026-06-27 — Fix: CSS contrast — --tx-3 and --tx-4 tokens (all three themes)

`--tx-3` was failing WCAG AA in all three themes (as low as 2.2:1) despite being used for labels, table headers, and form descriptions. `--tx-4` was near-invisible (as low as 1.2:1).

### `frontend/src/index.css`

| Theme | Token | Before | After | Approx ratio on bg-surface |
|---|---|---|---|---|
| Dark | `--tx-3` | `#4b5563` (gray-600) | `#6b7280` (gray-500) | ~4.6:1 ✓ |
| Dark | `--tx-4` | `#374151` (gray-700) | `#4b5563` (gray-600) | dim but visible |
| Light | `--tx-3` | `#9ca3af` (gray-400) | `#6b7280` (gray-500) | ~4.6:1 ✓ |
| Light | `--tx-4` | `#d1d5db` (gray-300) | `#9ca3af` (gray-400) | subtle but visible |
| Carbon | `--tx-3` | `#52525b` (zinc-600) | `#71717a` (zinc-500) | ~4.5:1 ✓ |
| Carbon | `--tx-4` | `#3f3f46` (zinc-700) | `#52525b` (zinc-600) | dim but visible |

No component files were changed; all 316 uses of `t-text-3` and 229 uses of `t-text-4` inherit the fix automatically.

---

## 2026-06-27 — Feature: include_in_ordering toggle on variant detail page

### `frontend/src/services/api.ts`
- `InvVariant` interface: added `include_in_ordering: boolean`.

### `frontend/src/pages/inventory/Detail.tsx`
- Added `include_in_ordering` checkbox in the Variant Fields section, after the `is_default` field.
- Hidden for bundle variants (`isBundleType`). Edit permission guard matches `is_default` (roles: ADMIN, STORE_MANAGER, WAREHOUSE_MANAGER).
- Uses the `vEdit` batch-edit pattern — saved via the existing "Save Changes" bar calling `PUT /products/variants/{id}`.

---

## 2026-06-26 — Feature: include_in_ordering flag on inventory.variants

Controls whether a variant appears in ordering workflows (PO creation, ordering forms). Independent of `product.status` and `is_deleted` — a variant can be Active and non-deleted but still excluded from ordering (e.g. bundles, phased-out items). No existing behaviour changed.

### `backend/alembic/versions/m3h4i5j6k7l8_add_include_in_ordering_to_variants.py` (new)
- Migration (`down_revision = l2g3h4i5j6k7`): `ALTER TABLE inventory.variants ADD COLUMN IF NOT EXISTS include_in_ordering BOOLEAN NOT NULL DEFAULT TRUE`. All 1,005 existing variants default to `TRUE` — no ordering exclusions on day one.

### `backend/inventory/models.py`
- `Variant`: added `include_in_ordering = Column(Boolean, nullable=False, default=True, server_default="TRUE")`.

### `backend/inventory/schemas.py`
- `VariantCreate`: added `include_in_ordering: bool = True`.
- `VariantUpdate`: added `include_in_ordering: Optional[bool] = None`.
- `VariantOut`: added `include_in_ordering: bool`.

### `backend/inventory/router.py`
- `add_variant`: passes `payload.include_in_ordering` to the `Variant` constructor (the handler builds the model explicitly by field, so the new field required an explicit entry).
- `list_products` (`GET /products/`): new optional query param `ordering_only: bool = False`. When `True`, restricts results to products that have at least one non-deleted, orderable variant via a subquery on `inventory.variants`. Default `False` leaves the catalogue listing completely unaffected.

### `docs/schema.dbml`
- `variants` table: added `include_in_ordering boolean [not null, default: true, note: '...']`.

---

## 2026-06-26 — Bug fix: confirm-costs and all AP invoice queries failing with UndefinedColumn

### Root cause
`ap/models.py` `SupplierInvoice` had four columns — `vetting_status`, `paid_before_received`, `check_drafted`, `check_drafted_note` — added to the SQLAlchemy model in the 2026-06-14 AP frontend session but never backed by a database migration. Because `vetting_status` carries a Python-side `default`, SQLAlchemy included it in every INSERT, making confirm-costs fail at the `db.flush()` step. The same missing columns caused every SELECT on `ap.supplier_invoices` (invoice list, aging report, 3-way match) to fail with `psycopg2.errors.UndefinedColumn`.

### `backend/alembic/versions/l2g3h4i5j6k7_add_vetting_columns_to_supplier_invoices.py` (new)
- New migration (`down_revision = k1f2g3h4i5j6`): creates the `ap.invoice_vetting_status` enum type (`Pending_Review`, `Approved`, `Rejected`) idempotently, then adds all four missing columns to `ap.supplier_invoices` with safe defaults for existing rows (`vetting_status DEFAULT 'Pending_Review'`, `paid_before_received DEFAULT FALSE`, `check_drafted DEFAULT FALSE`, `check_drafted_note` nullable). Downgrade drops all four columns and the enum type.

---

## 2026-06-25 — Feature: Confirm Costs revamp (backend + frontend)

### `backend/procurement/schemas.py`
- Replaced `ConfirmCostLine`/old `ConfirmCostsRequest` (single `unit_cost` per line) with `ConfirmCostsItem` (`gross_cost` + `discount_pct` per line) and a new `ConfirmCostsRequest` carrying `invoice_number`, `invoice_date`, an optional `due_date` override, and `items`.
- New `CostAutofillItem` response schema for the cost auto-fill endpoint.
- New `CostLayerRefOut` nested schema; `ReceivingDetailOut` now exposes an optional `cost_layer` (gross cost, discount, net unit cost) once a shipment is confirmed.
- `SupplierRefOut` now exposes `terms`, needed by the frontend to compute the invoice due date.

### `backend/procurement/models.py`
- `ReceivingDetail`: added a `cost_layer` property that resolves the matching `cost_layers` row (by shipment + variant + location) via the live session — there's no FK, since `cost_layers` only ties back to the shipment.

### `backend/procurement/router.py`
- New `GET /procurement/shipment-cost-autofill?shipment_id=` — pre-fills `gross_cost`/`discount_pct` per receiving-detail line from the most recent matching `cost_layers` row (variant + shipment's supplier), falling back to `variant_suppliers`, else nulls.
- Rewrote `POST /procurement/shipments/{id}/confirm-costs`: validates `gross_cost > 0` and `0 ≤ discount_pct ≤ 100` per line (400 on violation); computes `net_unit_cost` server-side; writes `cost_layers.supplier_discount` (previously hardcoded to 0); upserts `variant_suppliers` (gross_cost + supplier_discount, creating the record if missing — previously only updated `gross_cost` and only if a record already existed); records the caller-supplied `invoice_number`/`invoice_date`; `due_date` defaults to `invoice_date + supplier.terms` (per requirements.md §10.1) but can be overridden by the caller; invoice total now sums `quantity_actual × net_unit_cost` (previously preferred `quantity_declared`).
- New `GET /procurement/shipments/{id}/export` — 404 if the shipment isn't confirmed; streams a two-sheet XLSX (Invoice Summary, Line Items) via `xlsxwriter`, filename `{shipment_pid}_invoice.xlsx`.

### `frontend/src/services/api.ts`
- New types `ConfirmCostsItem`, `ConfirmCostsPayload`, `CostAutofillItem`; `ReceivingDetail.cost_layer` and `Shipment.supplier.terms` added.
- `stockApi.shipments.confirmCosts` now takes the new payload shape; added `costAutofill` and `exportInvoice` (downloads the blob client-side, reading the filename from `Content-Disposition`).

### `frontend/src/pages/stock/ReceivingConfirm.tsx`
- Rebuilt: added Invoice Number/Invoice Date inputs, an editable Due Date (auto-computed from invoice date + supplier terms, overridable), and a Destination Location header field.
- Line items grid now has Gross Cost + Discount % (auto-filled from the new autofill endpoint, with a source badge: "Prior shipment" / "Supplier record" / "No prior data"), with client-computed Net Unit Cost and Line Total, plus a Grand Total footer.
- "Confirm & Record Invoice" button disabled until invoice number/date are filled and every line has Gross Cost > 0. Kept the existing "Inspected By" field (not part of the revamp spec, but additive).

### `frontend/src/pages/stock/ReceivingDetail.tsx`
- Replaced the old always-visible client-side "Export XLSX" (raw receiving-detail rows) with a confirmed-only "Export Invoice" button calling the new backend export endpoint.
- Line items table now shows Gross Cost / Discount % / Net Unit Cost columns once the shipment is confirmed.

## 2026-06-24 — Feature: Purchase Orders module (backend + frontend)

### Database / `backend/alembic/versions/k1f2g3h4i5j6_add_discount_to_po_items.py`
- New migration adding `gross_cost NUMERIC(15,2) NOT NULL` and `discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0` to `procurement.purchase_order_items`. Existing rows backfilled with `gross_cost = unit_cost`, `discount_pct = 0` (preserves existing `unit_cost` values exactly).

### `backend/procurement/models.py`
- `PurchaseOrderItem`: added `gross_cost`, `discount_pct` columns. `unit_cost` remains but is now always a server-computed value.

### `backend/procurement/schemas.py`
- `POItemCreate`/`POItemUpdate`: now accept `gross_cost`, `discount_pct`; `unit_cost` removed from input (server-computed only).
- `POItemOut`: exposes `gross_cost`, `discount_pct`, `unit_cost`.
- New `VariantSupplierCostOut` schema for the cost auto-fill endpoint.

### `backend/procurement/router.py`
- `_compute_po_unit_cost(gross_cost, discount_pct)` helper — `unit_cost = gross_cost × (1 − discount_pct / 100)`.
- `create_purchase_order` and `update_po_item`: compute and store `unit_cost` server-side instead of accepting it from the caller.
- New `GET /procurement/variant-supplier-cost?variant_id=&supplier_id=` — returns the primary `variant_suppliers` gross cost/discount for a variant+supplier pair, or 404. Used by the Create PO modal to auto-populate line item costs.
- `receive_shipment` (Stage 1): now updates `purchase_order_items.received_quantity` for every receiving detail linked to a `po_item_id` (`quantity_actual − quantity_rejected`), then calls the previously-unused `_recalculate_po_status` helper to auto-advance the PO to `Partially_Received` or `Closed` when applicable (Requirements §8, backlog "PO lifecycle enforcement" follow-up).

### `frontend/src/services/api.ts`
- New `purchaseOrderApi`: `list`, `get`, `create`, `updateItem`, `updateStatus`, `variantSupplierCost`.
- New types: `POItemCreate`, `POItemUpdate`, `POItemOut`, `POCreate`, `POStatusUpdate`, `POOut`, `VariantSupplierCostOut`, plus `POVariantRef`/`POSupplierRef`/`POLocationRef`.

### `frontend/src/pages/procurement/PurchaseOrders.tsx`
- Replaced stub with full list page: keyword search (PO #, supplier) + status filter, status badges, React Query + skeleton loading, "New PO" button.
- `CreatePOModal`: supplier/location/expected-arrival fields, variant search (top 5, bundles excluded), auto-populates gross cost/discount from `variant-supplier-cost` when a supplier is already selected, client-computed net cost and grand total, validation before "Save as Draft".

### `frontend/src/pages/procurement/PurchaseOrderDetail.tsx` (new)
- Header (PO #, status badge, supplier, destination, dates), status action bar (Draft → Confirm Order/Cancel; Open/Partially_Received → Cancel only; Closed/Cancelled → none), editable line items (gross cost, discount %, qty) when Draft/Open with on-blur save, read-only received-qty progress, grand total footer, back navigation.
- Note: `POOut` has no `created_by` field (matches the agreed API contract), so the "Created by" row from the original spec is omitted on this page.

### `frontend/src/pages/Procurement.tsx`
- Lazy-loaded `PurchaseOrderDetail`, added route `purchase-orders/:po_id`.

## 2026-06-16 — Feature: PDC vault tracking and maturity report (frontend)

### `frontend/src/services/api.ts`
- `PaymentMode`: added `is_pdc: boolean`, `is_cash: boolean`.
- `SaleTenderIn`: added optional `check_number`, `check_date`, `bank_name`.
- `CustomerPaymentOut`: added `check_number`, `check_date`, `bank_name`, `check_status` (all string | null).
- `CustomerOut`: added `has_bounced_check: boolean`.
- New types: `PDCEntryOut`, `PDCMaturitySummary`, `PDCMaturityResponse`.
- `PaymentModeCreate/Patch`: added `is_pdc?`, `is_cash?`.
- `customers.recordPayment`: added optional `check_number`, `check_date`, `bank_name` params.
- `customers.clearBouncedFlag(id)`: new → `PATCH /sales/customers/${id}/clear-bounced-flag`.
- `salesApi.pdc`: new section with `list(filters)`, `deposit(id, body)`, `bounce(id, body)`.

### `frontend/src/lib/queryKeys.ts`
- Added `pdcVault: (filters?) => ['pdc-vault', filters]` key.

### `frontend/src/pages/Settings.tsx`
- Payment mode form: added `is_pdc` checkbox (Post Dated Check flag).
- Payment modes table: shows purple "PDC" badge when `is_pdc` is true.

### `frontend/src/pages/sales/Workstation.tsx`
- `TenderRow` interface: added `check_number`, `check_date`, `bank_name` fields.
- `cashModePID`: now uses `is_cash` flag as primary lookup, with name/physical fallbacks.
- All tender reset/init locations: include empty `check_number/check_date/bank_name`.
- `handlePost`: PDC pre-flight validates check_number, check_date, bank_name when mode.is_pdc.
- Tenders payload: includes PDC fields when mode.is_pdc.
- Tender row UI: shows check_number, check_date (date picker), bank_name inputs inline when mode.is_pdc. Reference number input hidden for PDC modes.

### `frontend/src/pages/customers/CustomerARLedger.tsx`
- Added `payCheckNum`, `payCheckDate`, `payBank` state; reset on open/close.
- `handlePaySubmit`: validates PDC fields when selectedMode.is_pdc; passes check fields to recordPayment.
- Payment modal: shows PDC field inputs (check #, check date, bank) when selectedMode.is_pdc. Reference number hidden for PDC modes.

### `frontend/src/pages/customers/CustomerDetail.tsx`
- Added `payCheckNum`, `payCheckDate`, `payBank`, `clearingBounce` state.
- Customer header: shows red "Bounced Check" badge with inline "Clear" button when `customer.has_bounced_check` is true.
- `showRef`: excludes PDC modes from showing reference number input.
- `handleRecordPayment`: validates PDC fields; passes check fields to recordPayment.
- Payment modal: shows PDC field inputs when selectedMode.is_pdc.

### `frontend/src/pages/customers/PDCVault.tsx` (new)
- Summary cards: Maturing Today, Next 7 Days, Overdue, Total Uncleared.
- Status tab filters (IN_VAULT / DEPOSITED / BOUNCED / ALL) + bank name + date range.
- Table columns: Check #, Bank, Check Date, Days Until Maturity, Customer, Amount, Sale(s), Status, Actions.
- Deposit modal: date picker, calls `salesApi.pdc.deposit`.
- Bounce modal: notes field, warning text, calls `salesApi.pdc.bounce`; invalidates pdc-vault cache.
- Uses `qk.pdcVault(filters)` query key.

### `frontend/src/pages/Customers.tsx`
- Added lazy `PDCVault` import.
- Added "PDC Vault" NavLink tab.
- Added `<Route path="pdc-vault" element={<PDCVault />} />`.

---

## 2026-06-16 — Feature: PDC vault tracking and maturity report (backend)

Backend-only implementation. No frontend files modified.

### `backend/sales/models.py`
- `PaymentMode`: added `is_pdc` (Boolean, default False) — True only for Post Dated Check mode; `is_cash` (Boolean, default False) — True only for Cash mode.
- `Customer`: added `has_bounced_check` (Boolean, default False) — system-set only; True when any of the customer's PDC payments is marked BOUNCED.
- `CustomerPayment`: added `check_number` (String 50, nullable), `check_date` (Date, nullable), `bank_name` (String 100, nullable), `check_status` (SAEnum IN_VAULT/DEPOSITED/BOUNCED, nullable).
- New `CheckStatus` Python enum class (for business logic).

### `backend/sales/schemas.py`
- `PaymentModeCreate`, `PaymentModePatch`, `PaymentModeOut`: added `is_pdc` and `is_cash` fields.
- `CustomerOut`: added `has_bounced_check: bool = False`.
- `CustomerPaymentOut`: added `check_number`, `check_date`, `bank_name`, `check_status` fields.
- `SaleTenderIn`: added optional `check_number`, `check_date`, `bank_name` fields.
- `RecordPaymentIn`: added optional `check_number`, `check_date`, `bank_name` fields.
- New `PDCPaymentFields`, `PDCEntryOut`, `PDCMaturitySummary`, `PDCMaturityResponse`, `PDCDepositIn`, `PDCBounceIn` schemas.

### `backend/sales/router.py`
- `create_payment_mode`: now sets `is_ar_charge`, `is_ar_credit`, `is_pdc`, `is_cash` from payload (pre-existing omission of ar flags corrected in same handler; new pdc/cash flags added).
- `update_payment_mode`: added `is_pdc` and `is_cash` to PATCH handler.
- `post_draft`: validates PDC check fields before creating any payments; sets `check_number`, `check_date`, `bank_name`, `check_status = "IN_VAULT"` on the CustomerPayment when mode.is_pdc. PDC tenders count toward `standard_applied` (treated as collected funds).
- `record_customer_payment`: loads payment mode before creating payment; validates PDC fields; sets check columns and `check_status = "IN_VAULT"` when mode.is_pdc.
- New `GET /sales/pdc`: PDC vault list and maturity summary. Filters by status (default IN_VAULT), bank_name, date range, as_of date.
- New `PATCH /sales/pdc/{payment_id}/deposit`: marks a check DEPOSITED, updates `payment_date` to actual deposit date. Rejects if not IN_VAULT.
- New `PATCH /sales/pdc/{payment_id}/bounce`: marks a check BOUNCED, reverses all applied payments (restores `balance_due`/`payment_status` on each sale, writes negative PAYMENT entries to ArLedger, restores `outstanding_balance`), sets `customer.has_bounced_check = True`. Rejects if not IN_VAULT.
- New `PATCH /sales/customers/{customer_id}/clear-bounced-flag`: clears `has_bounced_check` manually after resolution.

### `backend/main.py`
- New `_seed_payment_mode_flags()` seeder: idempotently sets `is_pdc=True` on "Post Dated Check", `is_cash=True` on "Cash", and `is_pdc=False` on "On Date Check". Silently skips any name not found.

### `backend/alembic/versions/i9d0e1f2g3h4_pdc_vault_tracking.py`
- New migration (`down_revision = h8c9d0e1f2g3`): adds `is_pdc`/`is_cash` to `sales.payment_modes`; creates `sales.check_status` enum type; adds `check_number`/`check_date`/`bank_name`/`check_status` to `sales.customer_payments`; adds `has_bounced_check` to `sales.customers`. All additions use `IF NOT EXISTS`. Downgrade fully reverses all changes.

## 2026-06-15 — Bug fix: charged sales appearing as paid in AR ledger

Two surgical fixes for the confirmed charged-sales display bug. No schema changes, no new endpoints, no refactoring.

### `backend/sales/router.py`
- `get_ar_ledger_sale_payments` (`GET /customers/ar-ledger/{sale_id}/payments`, ~line 595): added a second join from `CustomerPayment` → `PaymentMode` and a filter `PaymentMode.is_ar_charge == False`. AR Charge `CustomerPaymentApplied` records now excluded from the payment-detail expansion in the AR ledger. Follows the identical join/filter pattern used in the aging report endpoint (~line 445–455). Database records unchanged — this is a read-only filter.

### `frontend/src/pages/sales/SalesLedger.tsx`
- "Total Tendered" column (~line 665): replaced `grand_total + audit_variance` with `grand_total - balance_due` when `balance_due` is non-null. For a pure charge sale (`balance_due = grand_total`) this now shows ₱0 tendered instead of the misleading `grand_total`. Falls back to the original `grand_total + audit_variance` formula for older records where `balance_due` is null.

## 2026-06-15 — AP module audit (read-only verification)

No files modified. Full read-only audit of all 10 fixes applied in the AP gap-fix batch. All 10 previously identified issues confirmed FIXED. TypeScript (`tsc --noEmit`) and ESLint (`--max-warnings 0`) both clean. Three observations recorded for future tracking:

- `manage_ap_ledger` is a new permission string with no seeded DB row — must be seeded before the JWT auth stub is replaced with real enforcement.
- Surplus ADJUSTMENT ledger entries have no free-text description field; the link to the originating payment is carried only via `reference_type`/`reference_id`. Acceptable given the current schema; would benefit from a `notes` column if `ApLedger` is extended.
- `_serialize(entry)` in `create_manual_ledger_entry` is called after `db.refresh()` post-commit — correct behavior, observation only.

## 2026-06-15 — Migration: ap.supplier_invoices shipment_id nullable

### `backend/alembic/versions/h8c9d0e1f2g3_ap_supplier_invoices_shipment_nullable.py`
- New migration (`down_revision = g7b8c9d0e1f2`) that runs `ALTER TABLE ap.supplier_invoices ALTER COLUMN shipment_id DROP NOT NULL`. The column was already nullable in the original DDL so this is a no-op on all existing environments; the migration documents the intent formally and anchors it in the version chain. Downgrade restores `SET NOT NULL` with a warning that rows with `shipment_id = NULL` must be cleared first.

## 2026-06-15 — Docs: shipment_id optional on supplier_invoices

### `docs/requirements.md`
- §10.1 Supplier Invoices rewritten to document two invoice creation paths: **Automatic (GRN-linked)** via Stage 2 cost confirmation (shipment_id populated, line items created, 3-way match available) and **Manual (standalone)** via `POST /ap/invoices` with `shipment_id = null` (no line items, empty 3-way match). Common rules extracted into a shared bullet list below the split.

### `docs/schema.dbml`
- `supplier_invoices.shipment_id`: changed from `int [ref: > ...]` to `int [null, ref: > ...]` to mark the column nullable. FK reference to `inventory_shipments.shipment_id` retained.

## 2026-06-15 — AP module gap fixes (audit remediation)

### Overview
Seven targeted fixes addressing confirmed gaps from the AP module audit: security hardening on two endpoints, unapplied payment surplus accounting, optional shipment on manual invoices, corrected 3-way match cost variance definition, supplier name in AP ledger, post-payment cache invalidation, and dead `qk.apSummary` removal.

### `backend/ap/router.py`
- `amend_invoice` (`PATCH /ap/invoices/{id}`): added `require_permission("manage_invoices")` auth guard; added `write_audit()` with old/new values after commit
- `create_manual_ledger_entry` (`POST /ap/ledger`): added `require_permission("manage_ap_ledger")` auth guard; added `write_audit()` after commit
- `create_payment` (`POST /ap/payments`): after writing the main PAYMENT ledger entry, computes `surplus = payment.amount - sum(applications.amount_applied)`; if `surplus > 0`, writes an additional `ADJUSTMENT` AP ledger entry (positive) so net AP effect equals actual applications only; both entries in the same transaction
- `get_invoice_match` (`GET /ap/invoices/{id}/match`): changed `po_line_total` from `ordered_qty × po_unit_cost` to `received_qty × po_unit_cost`; cost variance now answers "was the supplier billed correctly for what was received?"
- `list_ap_ledger` (`GET /ap/ledger`): added `selectinload(models.ApLedger.supplier)` to eager-load supplier name

### `backend/ap/schemas.py`
- `InvoiceCreate.shipment_id`: changed from `int` (required) to `Optional[int] = None`; standalone invoices without a GRN link can now be created
- `ApLedgerOut`: added `supplier_name: Optional[str] = None` with `_flatten_supplier` model_validator (same pattern as `SupplierInvoiceItemOut`)
- `MatchLineOut.po_line_total` comment updated to reflect `received_qty × po unit_cost`

### `frontend/src/services/api.ts`
- `ApLedgerOut`: added `supplier_name: string | null`

### `frontend/src/pages/ap/ApLedger.tsx`
- Replaced "Supplier ID" column (raw number) with "Supplier" column showing `supplier_name`; falls back to `#supplier_id` (muted mono) when null

### `frontend/src/pages/ap/ApPayments.tsx`
- `createMut.onSuccess`: added `['ap', 'ledger']` and `['ap', 'aging']` invalidations alongside existing `['payments']` and `['invoices']`

### `frontend/src/lib/queryKeys.ts`
- Removed dead `qk.apSummary` factory (no backend endpoint, no frontend consumer confirmed by grep)

## 2026-06-15 — Supplier AP Aging Report

### Overview
Added a full supplier aging report (`GET /ap/aging`) and a dedicated "Aging" tab in the AP sub-nav shell. Outstanding AP balances are bucketed by days past due, grouped per supplier, and returned with a backend-computed totals row. Clicking a supplier row navigates to the Invoices tab pre-filtered by that supplier.

### `backend/ap/schemas.py`
- Added `SupplierAgingRow` (supplier_id, supplier_name, supplier_code, invoice_count, has_pending_vetting, has_rejected, current, bucket_30, bucket_60, bucket_90, bucket_90p, total)
- Added `SupplierAgingResponse` (as_of: date, rows: List[SupplierAgingRow], totals: SupplierAgingRow)

### `backend/ap/router.py`
- Added `date` to datetime imports
- Added `GET /ap/aging` endpoint (auth: `manage_invoices`): loads Unpaid/Partial invoices across all vetting statuses via `selectinload(supplier, invoice_payments)`; computes each invoice's `balance = effective_amount − total_applied`; buckets by `(as_of − due_date).days`; groups by supplier; builds backend-side `totals` synthetic row; sorts by total descending

### `frontend/src/services/api.ts`
- Added `SupplierAgingRow` and `SupplierAgingResponse` interfaces
- Added `apApi.getAging(asOf?: string)` → `GET /ap/aging?as_of={asOf}`

### `frontend/src/lib/queryKeys.ts`
- Added `apAging: (asOf?) => ['ap', 'aging', asOf ?? 'today']`

### `frontend/src/pages/ap/InvoiceList.tsx`
- Added `useSearchParams` to read `?supplier_id=` from URL as the initial value of the supplier filter state, enabling click-through pre-filtering from the aging report

### `frontend/src/pages/ap/SupplierAging.tsx` (new)
- Sidebar layout with "As of" date picker (defaults to today); follows CustomerAging.tsx pattern
- Table: Supplier (with muted supplier_code sub-line) | Invoices | Current | 1–30 | 31–60 | 61–90 | 90+ | Total
- Supplier column: amber "Pending" badge when `has_pending_vetting`; red "Rejected" badge when `has_rejected`; both can appear simultaneously
- Zero-value bucket cells render as "—" (muted); non-zero cells show `₱{amount}`
- Cell tinting by age: 31–60 = `bg-amber-50 text-amber-700`; 61–90 = `bg-amber-100 text-amber-900`; 90+ = `bg-red-50 text-red-700`
- Total column always visible; bold
- Footer row sourced from `SupplierAgingResponse.totals` (backend-computed, not client-aggregated)
- Row click navigates to `/ap?supplier_id={id}` (Invoices tab, pre-filtered)
- SkeletonTable while loading; inline error + Retry on failure
- "Export XLSX" button: `ap_aging_{date}.xlsx`, includes all data rows and the totals row

### `frontend/src/pages/AP.tsx`
- Added `SupplierAging` lazy import
- Added "Aging" NavLink to sub-nav (`/ap/aging`)
- Added `<Route path="aging" element={<SupplierAging />} />`

---

## 2026-06-15 — AP 3-way match tab in InvoiceDetail

### Overview
Added a "3-Way Match" tab to `InvoiceDetail.tsx` that fetches the match view lazily (only when the tab is active) and displays PO vs. GRN vs. supplier bill comparisons with inline-editable billed quantities and unit costs.

### `frontend/src/services/api.ts`
- Added `SupplierInvoiceItemOut` interface (id, invoice_id, po_item_id, variant_id, variant_name, variant_sku, ordered/received/rejected/billed quantities, billed_unit_cost, line_total, created_at, updated_at)
- Added `SupplierInvoiceItemUpdate` interface (billed_qty?, billed_unit_cost?)
- Added `MatchPoRef`, `MatchShipmentRef`, `MatchLineOut`, `MatchResponse` interfaces
- Added `items: SupplierInvoiceItemOut[]` to existing `InvoiceOut` interface
- Added `apApi.invoices.getMatch(id)` → `GET /ap/invoices/{id}/match`
- Added `apApi.invoices.updateInvoiceItem(id, itemId, p)` → `PATCH /ap/invoices/{id}/items/{itemId}`

### `frontend/src/lib/queryKeys.ts`
- Added `invoiceMatch: (id) => ['ap', 'invoices', id, 'match']`

### `frontend/src/pages/ap/InvoiceDetail.tsx` (full rewrite)
- Added `Details | 3-Way Match` tab bar below the always-visible invoice header card; `max-w-5xl` outer container
- Existing sections (vetting, check-draft, amendment, linked shipment) moved into the Details tab with their own `max-w-3xl` cap
- Added `MatchTab` internal function component:
  - Lazy-fetches via `useQuery({ enabled: isActive })` — fires only when the tab is first opened
  - Three summary cards (PO, Shipment/GRN, Invoice) in a responsive 3-column grid
  - Open-discrepancy warning banner inside the shipment card when `discrepancy_status` is Flagged or Supplier_Notified
  - Ledger divergence note shown only when `any line.has_variance === true`; explains AP ledger immutability
  - Empty state for invoices with no line items
  - 11-column table: SKU, Item, Ordered, Received, Rejected, Billed Qty *(editable)*, Unit Cost *(editable)*, Line Total, PO Total, Qty Var, Cost Var
  - Inline editing: click cell → input appears with `autoFocus`; blur or Enter commits; Escape cancels; per-row loading opacity; on success invalidates `invoiceMatch` and `invoice` queries; on error cell reverts (falls back to query data) and a per-row error row appears
  - Variance columns: signed, green for positive / red for negative / muted for zero
  - Rows with `has_variance === true` get a `bg-red-50/50` tint
  - Footer row shows Line Total, PO Total, and total Cost Variance
  - SkeletonTable while loading; inline error + Retry on failure

---

## 2026-06-15 — AP line-item billing + 3-way match (backend only)

### Overview
Added `supplier_invoice_items` to enable PO-vs-GRN-vs-supplier-bill 3-way matching.
Stage 2 (`confirm-costs`) now auto-creates one line item per PO line within the
same transaction. Two new AP endpoints expose item editing and the full match view.

### `backend/ap/models.py`
- Added `SupplierInvoiceItem` (table `ap.supplier_invoice_items`): stores
  ordered/received/rejected/billed quantities, billed unit cost, and computed
  `line_total`; has FK to invoice, PO item, and variant
- Added `SupplierInvoice.items` relationship (cascade all/delete-orphan)

### `backend/ap/schemas.py`
- Added `SupplierInvoiceItemOut` with `model_validator` that flattens
  `variant_name` and `variant_sku` from the loaded ORM relationship
- Added `SupplierInvoiceItemUpdate` (billed_qty, billed_unit_cost both optional)
- Updated `InvoiceOut`: added `items: List[SupplierInvoiceItemOut] = []`
- Added `MatchPoRef`, `MatchShipmentRef`, `MatchLineOut`, `MatchResponse`

### `backend/procurement/router.py` — `confirm_costs`
- After cost layers are written, loads the linked PO and builds one
  `SupplierInvoiceItem` per PO line item within the same transaction
- Overrides `invoice_total` with `sum(line_total)` when line items are present
  so the invoice, AP ledger, and line items are always consistent
- Unlinked shipments (no `po_id`) behave identically to before

### `backend/ap/router.py`
- Updated `_load_invoice` and `list_invoices` to selectinload `items` → `variant`
  (prevents N+1 queries now that `InvoiceOut` includes `items[]`)
- Added `PATCH /ap/invoices/{invoice_id}/items/{item_id}` — edits `billed_qty`
  and/or `billed_unit_cost`, recomputes `line_total` and `invoice.total_amount`,
  recalculates Paid/Partial/Unpaid status, writes audit log
- Added `GET /ap/invoices/{invoice_id}/match` — read-only 3-way match view
  returning invoice + po + shipment + per-line variances

## 2026-06-14 — AP frontend: invoice vetting, check-draft, discrepancy, payments, ledger

### Overview
Replaced the AP stub page with a fully functional sub-nav shell (Invoices / Payments / AP Ledger). Surfaces all new backend endpoints added in the previous session: invoice vetting (with discrepancy warning + override), check-draft flag, shipment discrepancy management, and supplier payment recording with invoice application.

### Backend model changes (previous session — recorded here for completeness)
- `ap/models.py` — `SupplierInvoice`: added `vetting_status`, `paid_before_received`, `check_drafted`, `check_drafted_note`
- `procurement/models.py` — `InventoryShipment`: added `discrepancy_status`, `discrepancy_notes`
- `ap/schemas.py` — extended `InvoiceOut`; added `InvoiceVettingUpdate`, `InvoiceCheckDraftUpdate`
- `procurement/schemas.py` — extended `ShipmentOut`; added `ShipmentDiscrepancyUpdate`
- `ap/router.py` — added `PATCH /ap/invoices/{id}/vetting`, `PATCH /ap/invoices/{id}/check-draft`; gated `POST /ap/payments` on vetting approval; added `paid_before_received` anomaly flag
- `procurement/router.py` — added `PATCH /procurement/shipments/{id}/discrepancy`

### Frontend — `frontend/src/services/api.ts`
- Extended `Shipment` interface: added `discrepancy_status: string`, `discrepancy_notes: string | null`
- Added `stockApi.shipments.updateDiscrepancy()` → `PATCH /procurement/shipments/{id}/discrepancy`
- Added AP types: `InvoiceSupplierRef`, `InvoiceOut`, `InvoiceAmend`, `InvoiceVettingUpdate`, `ApVettingWarning`, `InvoiceCheckDraftUpdate`, `InvoiceApplicationCreate`, `ApPaymentCreate`, `InvoicePaymentOut`, `ApPaymentOut`, `ApLedgerOut`
- Added `apApi` object: `invoices.{list, get, amend, setVetting, setCheckDraft}`, `payments.{list, get, create}`, `ledger.list`

### Frontend — `frontend/src/lib/queryKeys.ts`
- Added `invoice(id)` and `apLedger(supplierId?)` keys

### Frontend — `frontend/src/pages/AP.tsx`
- Replaced stub with sub-nav shell: tabs for Invoices, Payments, AP Ledger; lazy-loaded sub-pages

### Frontend — `frontend/src/pages/ap/InvoiceList.tsx` (new)
- Filterable invoice table: supplier, payment status, vetting status filters (vetting filter is client-side)
- Badges: payment status (Unpaid/Partial/Paid), vetting status (Pending/Approved/Rejected)
- Flag chips: PBR (paid before received), CHK (check drafted)
- Click row → navigate to `/ap/invoices/:id`

### Frontend — `frontend/src/pages/ap/InvoiceDetail.tsx` (new)
- Invoice header: all fields, effective amount (with amended indicator), anomaly badges
- Vetting panel: Approve / Reject / Reset buttons; handles `{warning: true}` response with override checkbox flow
- Check-draft panel: mark drafted with note, or clear flag
- Amendment panel: set amended amount and notes
- Linked shipment section: shows discrepancy status; inline select/input to update discrepancy via `PATCH /procurement/shipments/{id}/discrepancy`

### Frontend — `frontend/src/pages/ap/ApPayments.tsx` (new)
- Payment list with supplier filter
- Inline "Record Payment" form: supplier, amount, date, reference, method
- Invoice application sub-section: loads open invoices for selected supplier; per-invoice amount inputs
- Shows applied invoices inline in the list table

### Frontend — `frontend/src/pages/ap/ApLedger.tsx` (new)
- Read-only AP ledger table with supplier filter
- Colour-coded reason badges (INVOICE / PAYMENT / CREDIT_MEMO / ADJUSTMENT)
- Amount sign: positive = liability increase (red), negative = reduction (green)

## 2026-06-13 — Credit Memo page spec compliance

### Overview
Brought `CreditMemo.tsx` into full alignment with `docs/customers_credit_memo.md`. All backend endpoints were already implemented; four frontend deviations corrected and one missing backend field added.

### Backend — `backend/sales/schemas.py`
- Added `redeemed_sale_id: Optional[int] = None` to `CreditMemoListOut`

### Backend — `backend/sales/router.py`
- `list_credit_memos`: batch-fetches `credit_memo_redemptions.sale_id` for all returned memos in one query; included as `redeemed_sale_id` in each list row

### Frontend — `frontend/src/services/api.ts`
- Added `redeemed_sale_id: number | null` to `CreditMemoListOut` interface

### Frontend — `frontend/src/pages/customers/CreditMemo.tsx`
- **Remove auto-print**: `handleIssue` no longer calls `setPrintMemo` or `window.print()` after issuing — spec requires no automatic print prompt; print remains on-demand via the Print button in the detail modal
- **Button text**: "Issue & Print" → "Issue"
- **Issued By filter**: added `issuedByFilter` state, `authApi.users.allActive()` query, and user dropdown in filter sidebar; wired to `issued_by_user_id` API param; cleared by "Clear filters"
- **XLSX export**: added "Redeemed In Sale" column (sale ID when REDEEMED, blank otherwise)

---

## 2026-06-13 — AR Ledger master-detail upgrade (expand + Receive Payment)

### Overview
Upgraded the AR Ledger at `/customers/ledger` from a flat invoice list to a master-detail table. Each invoice row now expands to show the payment history applied to it. A per-row Receive Payment modal applies payments directly to a specific invoice, writing a `customer_payment_applied` row and updating `sale.balance_due` / `sale.payment_status` in one transaction.

### Backend — `backend/sales/schemas.py`
- Added `ARLedgerPaymentRowOut` schema: `payment_id`, `payment_date`, `payment_mode`, `reference_number`, `amount_applied`
- Added `sale_id: Optional[int] = None` to `RecordPaymentIn` — when present, payment is applied to that specific invoice

### Backend — `backend/sales/router.py`
- Added `GET /customers/ar-ledger/{sale_id}/payments` — returns all `customer_payment_applied` rows for one sale, joined to `customer_payments` + `payment_modes`; ordered by payment date then apply_id
- Updated `record_customer_payment` (`POST /customers/{customer_id}/payment`): when `sale_id` is provided, creates a `CustomerPaymentApplied` row, updates `sale.balance_due` (floor 0), and sets `sale.payment_status` to Paid / Partial / Unpaid; sets `unapplied_amount = 0` when sale_id is given

### Frontend — `frontend/src/lib/queryKeys.ts`
- Added `arLedgerPayments: (saleId: number) => ['ar-ledger', 'payments', saleId]`

### Frontend — `frontend/src/services/api.ts`
- Added `ARLedgerPaymentRowOut` interface
- Added `salesApi.customerArLedger.payments(saleId)` — calls `/sales/customers/ar-ledger/{saleId}/payments`
- Updated `salesApi.customers.recordPayment` signature to accept optional `sale_id`

### Frontend — `frontend/src/pages/customers/CustomerARLedger.tsx` (full rewrite)
- Table expanded from 8 to 10 columns: Expand toggle, Customer Name, Invoice #, Issue Date, Due Date, Total Amount, Balance Due, Status, **Actions**, Subtotal
- Expand/collapse per row via chevron toggle; state tracked in `Set<number>`
- `DetailRows` sub-component: lazy-fetched via `useQuery` on first expand (cached thereafter); shows one row per applied payment with date, mode, reference, and amount as negative muted italic; "No payments recorded" empty state
- Actions column: **Receive Payment** primary button (when `balance_due > 0`) + **View Invoice** secondary link
- Receive Payment modal: pre-fills customer name, invoice #, today's Manila date, and full balance due; Payment Mode dropdown excludes `is_ar_charge` / `is_ar_credit` modes; Reference Number shown only for non-physical modes; amount capped at `balance_due`; on success invalidates both master and payment-detail query caches
- `useQueries` now fetches customers, payment modes, and paginated invoice pages in one call

---

## 2026-06-12 — Search input normalization (§11)

### Overview
Implemented `normalize()` / `normalize_search()` per `docs/ui_standards.md §11`. Searches now strip hyphens, underscores, and spaces before comparing, so "abc-123", "abc_123", and "abc 123" all match each other.

### Frontend — `frontend/src/lib/normalize.ts` (new)
- Created shared helper: `normalize(value) → value.toLowerCase().replace(/[-_\s]/g, '')`

### Frontend — all client-side search filters updated
Replaced `.trim().toLowerCase().includes()` with `normalize(field).includes(normalize(query))` in:
- `CustomerAging.tsx` — customer_name
- `CustomerList.tsx` — customer_name
- `Catalogue.tsx` — brand, variant_name, PID, SKU, barcodes, category_name (also normalizes search tags)
- `Detail.tsx` — PID, variant_name (both bundle component search functions)
- `Suppliers.tsx` — supplier_code, supplier_name
- `ReturnNew.tsx` — variant_name, PID, product_brand
- `Workstation.tsx` — product_brand, variant_name, PID, barcodes
- `Ledger.tsx` — brand, variant_name, PID, reference_id
- `Receiving.tsx` — shipment_pid, supplier_name, reference_number
- `ReceivingNew.tsx` — brand, variant_name, PID, SKU, barcodes
- `TransferNew.tsx` — brand, variant_name, PID, SKU, barcodes
- `Transfers.tsx` — transfer_pid, from/to location names

### Backend — `backend/sales/router.py`
- Added public `normalize_search(q)` helper (identical to existing `_normalize_search`)
- Applied `normalize_search` before all ILIKE queries in: `list_customers`, `get_ar_aging`, `get_customer_ar_ledger_view`, `list_sales`, `list_returns`, `list_credit_memos`
- `get_customer_ar_ledger_view` in-memory filter now uses `normalize_search` (was `_normalize_search`)

---

## 2026-06-12 — Customer AR Ledger redesign (invoice-level view)

### Overview
Replaced the per-customer AR ledger stub with a global, invoice-level AR ledger at `/customers/ledger`. One row per Posted sale with a linked customer, sorted by customer name then transaction date. Status is computed server-side from balance and due date.

### Backend — `backend/sales/schemas.py`
- Added `CustomerARLedgerRowOut` schema: `sale_id`, `sale_pid`, `customer_id`, `customer_name`, `transaction_date`, `due_date`, `grand_total`, `balance_due`, `status` (Open/Partial/Paid/Overdue)

### Backend — `backend/sales/router.py`
- Added `_normalize_search()` helper: strips hyphens, spaces, underscores, lowercases — applied to both the search query and customer name for fuzzy matching
- Added `GET /customers/ar-ledger` endpoint: accepts `customer_id`, `date_from`, `date_to`, `status` (multi-value), `search`, `limit`, `cursor`; joins `Sale` → `Customer`; fetches up to 2000 rows from DB then applies Python-side status derivation and normalized search; returns a cursor-paginated slice
- **Route ordering fix**: positioned the new static route before `GET /customers/{customer_id}` to prevent FastAPI from matching "ar-ledger" as an integer `customer_id` parameter

### Frontend — `frontend/src/services/api.ts`
- Added `CustomerARLedgerRowOut` interface
- Added `salesApi.customerArLedger.list()` — calls `/sales/customers/ar-ledger`, serializes `status[]` as repeated query params

### Frontend — `frontend/src/lib/queryKeys.ts`
- Added `customerArLedgerView` key: `['customers', 'ar-ledger-view', filters]`

### Frontend — `frontend/src/pages/customers/CustomerARLedger.tsx` (full rewrite)
- Filter bar: keyword search (customer name), customer dropdown, issue date range, status chips (Open/Partial/Overdue/Paid; default: all except Paid)
- Load More pagination: `pageOffsets` array + `useQueries`; resets on filter change via `prevParams` ref
- Grouped table rows: customer name shown only on first row of each group; per-customer Balance Due subtotal in last column
- Sticky tfoot: Total Amount and Total Balance Due across all loaded rows
- XLSX export: `ar_ledger_YYYY-MM-DD.xlsx`
- **Decimal coercion fix**: API returns `grand_total`/`balance_due` as strings (Python `Decimal`); added `Number()` coercion in the `reduce` accumulator and subtotals Map to prevent string-concatenation NaN

---

## 2026-06-12 — Docs: update schema.dbml to match deployed state

**`docs/schema.dbml`** — Five corrections to bring the schema document in line with the codebase:

1. **`sales_returns`** — Fixed a malformed multi-line note on `location_id` that was swallowing `disposition` and `customer_id` as literal text. Changed `return_date` from `datetime` to `date [not null]` (matches `d4e5f6a7b8c9` migration). Added `shift_id` and `register_id` fields (matches `f6a7b8c9d0e1` migration).
2. **`sales`** — Added `merchandise_subtotal decimal(15,2)` field (matches `c3d4e5f6a7b8` migration). Removed duplicate `created_by_user_id` line.
3. **`payment_modes`** — Added `is_credit_memo boolean` flag (matches `g7b8c9d0e1f2` migration).
4. **`credit_memos`** — New table added (matches `g7b8c9d0e1f2` migration).
5. **`credit_memo_redemptions`** — New table added (matches `g7b8c9d0e1f2` migration).

---

## 2026-06-12 — Docs housekeeping

Deleted two stale files from `docs/`:
- `docs/performance_audit.md` — assistant narration from a prior session, not a design document.
- `docs/batch2_6_settings.md` — duplicate of `docs/customers_ar.md`.

No backend or frontend files were changed.

---

## 2026-06-12 — Fix: Credit Memo migration seed INSERT missing `is_active`

**`backend/alembic/versions/g7b8c9d0e1f2_add_credit_memos.py`** — The seed `INSERT INTO sales.payment_modes` omitted `is_active` from the column list. Since `is_active` is `NOT NULL`, the insert produced a null-violation on startup and put the backend into a restart loop. Added `is_active` to both the column list and the `SELECT` values (`true`).

---

## 2026-06-12 — Credit Memo feature (full implementation)

### Overview
Implemented Credit Memo as a new payment mode. Issued by Admin/Manager for walk-in returns; redeemable at POS; all-or-nothing redemption; voiding a sale reinstates the memo.

### Migration — `backend/alembic/versions/g7b8c9d0e1f2_add_credit_memos.py`
- Adds `is_credit_memo BOOLEAN NOT NULL DEFAULT FALSE` to `sales.payment_modes`
- Creates `sales.credit_memos` table (memo_id, code, amount, status, issued_at, valid_until, issued_by_user_id, return_id, notes, cancelled_by_user_id, cancelled_at)
- Creates `sales.credit_memo_redemptions` table (redemption_id, memo_id, sale_id, amount_redeemed, redeemed_at, redeemed_by_user_id)
- Seeds one `payment_modes` row: name='Credit Memo', is_credit_memo=true, is_physical=false
- Chains from `f6a7b8c9d0e1`

### Backend — `backend/sales/models.py`
- `PaymentMode`: added `is_credit_memo` column (Boolean, server_default=false)
- New model `CreditMemo`: all spec fields, relationships to issued_by, cancelled_by, sales_return, redemptions
- New model `CreditMemoRedemption`: memo_id, sale_id, amount_redeemed, redeemed_at, redeemed_by_user_id

### Backend — `backend/sales/schemas.py`
- `PaymentModeCreate/Patch/Out`: added `is_credit_memo` field
- New schemas: `CreditMemoCreate`, `CreditMemoRedemptionOut`, `CreditMemoOut`, `CreditMemoListOut`, `CreditMemoValidateOut`

### Backend — `backend/sales/router.py`
- `create_payment_mode`: passes `is_credit_memo` to constructor
- `update_payment_mode`: handles `is_credit_memo` patch
- `post_draft` tender loop: validates memo code via `with_for_update()` before payment; on apply sets status='REDEEMED' and inserts `CreditMemoRedemption`
- `void_sale`: reverses credit memo redemptions — deletes redemption row, restores status='ACTIVE'
- Five new endpoints under `/sales/credit-memos/`: GET list, POST issue, GET validate?code=, GET detail, POST cancel
- Added imports: `random`, `string`, `Query`; helper `_generate_memo_code()`

### Frontend — `frontend/src/services/api.ts`
- `PaymentMode`, `PaymentModeCreate`, `PaymentModePatch`: added `is_credit_memo`
- New interfaces: `CreditMemoRedemptionOut`, `CreditMemoListOut`, `CreditMemoOut`, `CreditMemoValidateOut`, `CreditMemoCreate`
- `salesApi.creditMemos`: list, get, issue, cancel, validate endpoints
- `settingsApi.storeName()`: reads store name from `/settings/system-settings/store_name`

### Frontend — `frontend/src/lib/queryKeys.ts`
- Added `creditMemos`, `creditMemo`, `creditMemoValidate`, `storeName` keys

### Frontend — `frontend/src/pages/customers/CreditMemo.tsx` (new file)
- Full Credit Memo management page at `/customers/credit-memo`
- Access guard: Admin and Store Manager only (redirects to /customers)
- Filter panel: keyword, status multi-select (default: ACTIVE), date range
- Table: issued_at DESC, status badges, expiring-soon warning (within 7 days)
- Issue modal: amount, valid_until (default today+30), linked return ID, notes
- On issue: POST → close modal → refresh → window.print() of receipt
- Detail modal: full fields + redemption history for REDEEMED memos
- Cancel: confirmation modal; status→CANCELLED
- Print layout: thermal receipt with store name from settings API, prominent code display
- XLSX export via `xlsx` library

### Frontend — `frontend/src/pages/sales/Workstation.tsx`
- `TenderRow` interface: added `memo_code`, `memo_valid: boolean | null`, `memo_invalid_reason`
- All tender reset points updated to include new fields
- `addTender()`: includes new fields with defaults
- `validateMemoCode()`: async function — calls validate API on blur/Enter; auto-fills and locks amount on success; shows inline error on failure
- Mode select onChange: resets memo state when mode changes
- Amount input: `readOnly` when credit memo is validated (locked)
- Tender render: shows memo code input when `mode.is_credit_memo`; inline success/error messages
- `handlePost()` pre-flight: blocks post if credit memo mode selected but code not validated

### Frontend — `frontend/src/pages/Customers.tsx`
- Added `CreditMemo` lazy import
- Added Credit Memo tab (`/customers/credit-memo`)
- Added `<Route path="credit-memo" element={<CreditMemo />} />`

---

## 2026-06-11 — Sales Ledger: brand column fix, non-merch revenue column, shift/register on returns

### Fix 1 — Brand column in SaleDetail showing variant name instead of brand (`frontend/src/pages/sales/SaleDetail.tsx`)
- Line 297 in the Line Items table was rendering `item.variant?.variant_name` for the Brand column. Changed to `item.variant?.product_brand`.

### Fix 2 — Non-merchandise revenue as toggleable column in Sales Ledger
- `backend/sales/schemas.py`: Added `non_merchandise_revenue: Decimal = Decimal("0")` to `SaleOut`.
- `backend/sales/router.py`: In `list_sales`, compute non_merch per sale from eager-loaded items (product_type IN Service, Non-Inventory) and attach to each `SaleOut` row.
- `frontend/src/services/api.ts`: Added `non_merchandise_revenue: number` to `SaleOut` interface.
- `frontend/src/pages/sales/SalesLedger.tsx`: Added `nonMerchRev` toggleable column (off by default). Shows `₱{amount}` when > 0, blank otherwise. Right-aligned.

### Fix 3 — Shift and Register on Returns
- `backend/sales/models.py`: Added `shift_id` (FK → sales.shifts) and `register_id` (FK → sales.cash_registers) columns to `SalesReturn`.
- `backend/alembic/versions/f6a7b8c9d0e1_add_shift_register_to_sales_returns.py`: Migration chaining from `e5f6a7b8c9d0`; adds both columns with `IF NOT EXISTS`.
- `backend/sales/schemas.py`: Added `shift_id` and `register_id` to `SalesReturnCreate` and `SalesReturnOut`.
- `backend/sales/router.py`: `_do_return` passes `shift_id`/`register_id` from payload to the `SalesReturn` constructor; `list_sales` returns sub-query now filters by `shift_id` and `register_id` when set.
- `frontend/src/services/api.ts`: Updated `returns.create` type and `SalesReturnOut` interface.
- `frontend/src/pages/sales/ReturnNew.tsx`: Added Shift and Register dropdowns to the return form header; values passed in the API call.

## 2026-06-11 — Docs: update requirements.md to reflect Sales Ledger session changes

**`docs/requirements.md`** — Three targeted updates: (1) §16.6 `GET /sales/`: noted that each `SaleOut` row now carries a computed `non_merchandise_revenue` field (sum of Service + Non-Inventory line totals) and that shift/register filters apply to return rows as well as sale rows. (2) §14.1 Creating a Return: added point 5 — `shift_id` and `register_id` are optional tagging fields stored on `sales_returns` for ledger filtering, with no business logic. (3) §16.9 Sales Returns request body: documented `shift_id` and `register_id` optional fields.

---

## 2026-06-11 — Sales Ledger: three bug fixes (discounts, collections double deduction, walk-in payment status)

### Fix 1 — Line-item discount fields missing from Sale Detail (`backend/sales/router.py`)

`_collapse_items()` built each collapsed `SaleItemOut` without passing `discount_pct` or `discount_flat`, so both fields defaulted to `None` regardless of what was stored on the sale items. `GET /{sale_id}` therefore always returned `null` for those fields, and the Sale Detail page always displayed `—` in the Disc % and Disc ₱ columns even when discounts were present. Added `discount_pct=first.discount_pct` and `discount_flat=first.discount_flat` to the constructor call, following the same pattern as `unit_price` and `cost_source`. Header-level cart discount fields (`cart_discount_pct`, `cart_discount_flat`, `discount_amount`) were unaffected — they come directly from the `Sale` ORM model.

### Fix 2 — Collections card double-deducting cash refunds (`frontend/src/pages/sales/SalesLedger.tsx`)

`get_sales_summary` computes `total_physical` and `total_collected` by summing `customer_payment_applied.amount_applied` across the in-scope sales. Cash-refund returns write a negative `CustomerPayment` + `CustomerPaymentApplied` row against the original sale, so when the original sale falls within the date window the refund is already netted out of `total_physical` server-side. The frontend was additionally subtracting `cash_refunds_total` from `total_physical` to derive `adjPhysical`, and computing `adjCollected = adjPhysical + total_virtual` — a second deduction of the same refund amount for same-day returns. Removed `adjPhysical` and `adjCollected`. "Total Physical" now renders `summary.total_physical` and "Total Collected" renders `summary.total_collected` directly. The Cash Refunds informational row remains visible in the collections list for transparency but no longer drives any arithmetic.

### Fix 3 — Walk-in cash sales incorrectly stamped Unpaid (`backend/sales/router.py`)

In `post_draft` step 10, the `standard_applied += amount_to_apply` increment that determines `payment_status` was nested inside `if customer:`. For walk-in sales (`customer = None`) the entire block was skipped regardless of what was tendered, so `standard_applied` stayed at zero and the sale was always stamped `payment_status = "Unpaid"`. Moved the increment outside `if customer:` to a peer-level `if not mode.is_ar_charge and not mode.is_ar_credit:` guard. AR ledger writes remain inside `if customer:` — only the `standard_applied` increment moved. AR-charge and AR-credit tenders continue to be excluded from `standard_applied` as intended, preserving the existing payment-status behaviour for credit customers.

---

## 2026-06-11 — Docs: update sales_ledger_basic.md to reflect session changes

**`docs/sales_ledger_basic.md`** — Seven targeted updates: (1) Revenue card ASCII diagram: added Returns row between Cart Discounts and Non-Merch Revenue, corrected Total Revenue example total. (2) Merchandise Gross definition: changed source field from `subtotal_amount` to `merchandise_subtotal`, added "Inventory and Bundle line items only" clause. (3) Non-Merchandise Revenue: added note that it is additive to Merchandise Gross in the formula, not a subset of it. (4) Total Revenue formula: added `- Returns` term. (5) Collections card diagram: standardised box-drawing characters, renamed "Cash Refund" row to "Cash Refunds", added three explanatory lines (conditional display, warning color, net-of-refunds totals). (6) JSON schema: added missing `returns_total` field in correct position. (7) On Post step 6 (cash_refund disposition): replaced stale "No AR entry" note with the four actual behaviors — AR ledger entry, outstanding_balance update (registered customers only), negative CustomerPayment, CustomerPaymentApplied. (8) Return Credit Policy: replaced both registered-customer and walk-in blocks with accurate current behavior including AR entry and Collections deduction for cash refunds. (9) Backend Notes: added `Sale model — merchandise_subtotal` section.

---

## 2026-06-11 — Migration: convert sales_returns.return_date from TIMESTAMPTZ to DATE

**`backend/alembic/versions/d4e5f6a7b8c9_convert_sales_return_date_to_date.py`** — new migration (`down_revision = 'c3d4e5f6a7b8'`). Upgrades `sales.sales_returns.return_date` from `TIMESTAMP WITH TIME ZONE DEFAULT now()` to `DATE NOT NULL` with no default. The USING clause casts via `AT TIME ZONE 'Asia/Manila'` so existing timestamps are bucketed into the correct Manila business day. A defensive UPDATE fills any NULL rows before SET NOT NULL is applied. Downgrade restores TIMESTAMPTZ, drops NOT NULL, and reinstates the `now()` default.

---

## 2026-06-11 — Migration: backfill merchandise_subtotal for pre-migration Posted sales

**`backend/alembic/versions/e5f6a7b8c9d0_backfill_merchandise_subtotal.py`** — new migration (`down_revision = 'd4e5f6a7b8c9'`). The previous `c3d4e5f6a7b8` migration added `merchandise_subtotal` with `DEFAULT 0`, leaving all existing Posted sales at zero. This migration runs a single correlated UPDATE that sets `merchandise_subtotal` on every Posted sale to the sum of `sale_items.line_total` for lines whose variant belongs to a product with `product_type = 'Inventory'`. Downgrade is a no-op.

---

## 2026-06-11 — Revenue card: fix double-counting of Service/Non-Inventory items

**`backend/sales/models.py`** — `Sale`: added `merchandise_subtotal = Column(Numeric(15, 2), nullable=False, server_default='0')` alongside `subtotal_amount`. Stores only the sum of `Inventory`-type line items (excludes Service and Non-Inventory). `subtotal_amount` is unchanged — it is still the full transaction subtotal used for cart-discount basis and footer totals.

**`backend/sales/router.py`** — `_recalculate_totals`: added `merch_subtotal` computation via lazy-loaded `item.variant.product.product_type`; writes `sale.merchandise_subtotal`. `post_draft` item loop: builds `inventory_variant_ids: set[int]` during the existing loop (no new query — `variant_obj.product` is already eager-loaded via `selectinload`); after the subtotal sum, computes `merchandise_subtotal` by filtering `new_items` against the set; writes `sale.merchandise_subtotal` alongside `sale.subtotal_amount`. `get_sales_summary` step 2: switched from `models.Sale.subtotal_amount` to `models.Sale.merchandise_subtotal` for the `merchandise_gross` aggregation — this eliminates the double-counting that previously occurred because `non_merchandise_revenue` was independently summing Service/Non-Inventory line items and then adding them on top of a `merchandise_gross` that already included them.

**`backend/alembic/versions/a3b4c5d6e7f8_sales_transaction_date_default_ph_local.py`** — corrected `down_revision` from the nonexistent `'f6e5d4c3b2a1'` to `'a1b2c3d4e5f6'` (chain root), repairing the broken Alembic revision chain.

**`backend/alembic/versions/c3d4e5f6a7b8_add_merchandise_subtotal_to_sales.py`** — new migration (`down_revision = 'a3b4c5d6e7f8'`): `ALTER TABLE sales.sales ADD COLUMN merchandise_subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0`. Downgrade drops the column.

---

## 2026-06-11 — Cash refund return flow: AR entry, negative payment, Collections deduction

**`backend/sales/router.py`** — `_do_return`: added `elif` branch for `disposition = 'cash_refund'` that writes an `ArLedger` RETURN entry and decrements `customer.outstanding_balance`, matching the existing `credit_to_account` logic (skipped when no customer is linked). Added a separate block that, for any cash-refund return against a linked sale, queries the largest standard (non-AR) tender on the original sale and writes a negative `CustomerPayment` + `CustomerPaymentApplied` row against that sale, so the Collections panel reflects the cash paid out. `get_sales_summary`: added `cash_refunds_total` aggregation (sum of `SalesReturn.grand_total` where `disposition = 'cash_refund'`, filtered by same date/location/customer scope as `returns_total`); included in both the early-return path and the main return.

**`backend/sales/schemas.py`** — `SalesSummaryResponse`: added `cash_refunds_total: Decimal` field.

**`frontend/src/pages/sales/SalesLedger.tsx`** — Collections card: added Cash Refunds row (red negative amount, Physical badge) visible only when `cash_refunds_total > 0`. Total Physical and Total Collected now display backend values adjusted by `cash_refunds_total` (display-only; backend values unchanged). Fixed Total Virtual label alignment — moved `flex-1` to the outer `span` wrapping the `Tip` component so it participates correctly in the flex layout.

---

## 2026-06-11 — get_sales_summary: fix early-return zeroing returns_total

**`backend/sales/router.py`** — `get_sales_summary` returned early with `returns_total=zero` whenever `base_sale_ids` was empty (no Posted sales in the date window). Before the return_date fix this was harmless — returns were linked to sales, so no sales meant no returns. After the fix, returns are filtered by `return_date` independently, so a day with returns but no sales would show `returns_total=0` in the Revenue card while the table tfoot correctly deducted them. Fixed by moving the `ret_q` block above the early-return check. The early-return path now uses the computed `returns_total` and sets `total_revenue=-returns_total` (net refunds, no sales revenue).

---

## 2026-06-11 — list_sales: fix runtime error building SaleOut for return rows

**`backend/sales/router.py`** — When constructing the `SaleOut` pseudo-row for a `SalesReturn` inside `list_sales`, `transaction_date` was assigned `r.return_date` directly. For existing rows whose `return_date` column still holds a timezone-aware `datetime` (before the Alembic migration converts the column to `Date`), this caused a type error because `SaleOut.transaction_date` expects a plain `date`. Fixed with a defensive guard: `r.return_date.date() if isinstance(r.return_date, datetime) else r.return_date`, which handles both the old `datetime` values and the new plain `date` values.

---

## 2026-06-11 — list_returns: fix customer filter excluding blind returns

**`backend/sales/router.py`** — The `customer_id` filter in `list_returns` used a subquery through `Sale.customer_id`, which excluded blind returns (they have `sale_id = NULL` and therefore never appeared in the subquery result). Replaced with a direct `SalesReturn.customer_id == customer_id` filter, which covers both linked and blind returns.

---

## 2026-06-11 — Returns list: fix Customer column in table and XLSX export

**`frontend/src/pages/sales/Returns.tsx`** — The "Customer" table column keyed off `r.sale_id` instead of `r.customer_id`, causing linked returns with a registered customer to always show "—" and blind returns with a registered customer to always show "Walk-in". Fixed to resolve `customerMap.get(r.customer_id)` (falling back to "Walk-in" when `customer_id` is null). The XLSX export had no Customer column at all; added `'Customer'` between "Original Sale" and "Location" using the same lookup.

---

## 2026-06-11 — Returns list: fix return_date display in table and XLSX export

**`frontend/src/pages/sales/Returns.tsx`** — Added `fmtDateOnly` and switched `r.return_date` from `fmtDate` to `fmtDateOnly` in both the table "Date" column and the XLSX export cell. `fmtDate` uses `new Date(s).toLocaleString(...)` with `timeStyle: 'short'`, which parsed the plain date string as UTC midnight and rendered a spurious time component that shifted with the viewer's timezone. `fmtDateOnly` splits on `'-'` and constructs via `Date.UTC` so the displayed day is always the stored calendar date with no time portion.

---

## 2026-06-11 — ReturnDetail: fix return_date display

**`frontend/src/pages/sales/ReturnDetail.tsx`** — Added `fmtDateOnly` (splits `"YYYY-MM-DD"` and constructs via `Date.UTC` to avoid timezone shifting) and switched the "Date" field from `fmtDate` to `fmtDateOnly`. Previously the date-only string was parsed by `new Date()` as UTC midnight and then rendered with a time component, which could show a wrong day or a meaningless "12:00 AM" time. Now displays the stored calendar date with no time portion.

---

## 2026-06-11 — User-supplied return_date on sales returns

**`backend/sales/models.py`** — Changed `SalesReturn.return_date` from `DateTime(timezone=True)` with a `server_default=func.now()` to a plain `Date, nullable=False` column, matching the pattern of `Sale.transaction_date`.

**`backend/sales/schemas.py`** — Added `return_date: Optional[date] = None` to `SalesReturnCreate`. Changed `SalesReturnOut.return_date` type from `Optional[datetime]` to `Optional[date]`.

**`backend/sales/router.py`** — In `_do_return`: resolves `payload.return_date` against `_ph_today()` as the fallback and writes the result to the `SalesReturn` constructor. In `list_sales`: updated the returns date filter from `_ph_day_bounds` (datetime range) to plain date comparison using `txn_date_from`/`txn_date_to`, consistent with the sales filter; updated return row construction to use `r.return_date` directly (no longer needs `.date()` coercion) and sets `posted_at=None`. In `get_sales_summary`: replaced the split linked-returns (`sale_id.in_`) + blind-returns (datetime) query with a single query filtered by `SalesReturn.return_date` date range, aligning the Revenue card totals with the table rows.

**`frontend/src/pages/sales/ReturnNew.tsx`** — Added `todayManila()` helper and `returnDate` state initialized to today in Manila time. Replaced the read-only static sale-date display with an editable `<input type="date">` labelled "Return Date", always visible for both linked and blind returns, with `max` capped at today and a fallback to today if cleared. Added `return_date` validation in `handleSubmit` and wired the value into the API payload.

**`frontend/src/services/api.ts`** — Added `return_date?: string` to the `salesApi.returns.create` function type.

---

## 2026-06-11 — SaleDetail: Tender section fixes for AR Charge sales

**`frontend/src/pages/sales/SaleDetail.tsx`** — Two display fixes in the Tender table.

**Money Type badge**: AR Charge tenders were showing "Physical" or "Virtual" depending on the payment mode's `is_physical` flag, neither of which describes a deferred AR obligation. Added `isArCharge = fallback?.is_ar_charge ?? false` per row; when true the badge now reads **On Account** in amber instead of the physical/virtual colors.

**Footer totals**: `physical` and `virtual` subtotals and the `Total Tendered` sum previously included AR Charge amounts. For a fully AR-charged sale this made `Total Tendered` equal to `Grand Total` while the header simultaneously showed the same amount as "On Account", implying the money was both collected and still owed. Added an `isAr` predicate to exclude AR Charge tenders from `physical` and `virtual`. A new **On Account** footer row (amber, conditional on `onAccount > 0`) shows the deferred portion separately. `Total Tendered` now reflects only cash and card actually collected at the register.

---

## 2026-06-11 — SaleDetail: balance_due display for AR Charge sales

**`frontend/src/pages/sales/SaleDetail.tsx`** — After the backend fix that correctly sets `balance_due = grand_total` for AR-charged sales, the "Balance Due" field was rendering the full amount in red, which looked like a missed cash collection. Added `arChargedTotal` (sum of tenders whose payment mode has `is_ar_charge = true`) and `isArObligation` (AR charge present and `balance_due > 0`). When `isArObligation` is true, the label changes to "On Account" and the value renders in neutral color instead of red, making it clear the balance is an AR obligation already captured in the ledger, not an outstanding cash debt.

---

## 2026-06-11 — AR Charge payment_status and Sales Ledger return filter fixes

**`backend/sales/router.py`** — Two bugs fixed.

**Fix 1 — AR Charge sales incorrectly stamped as Paid (`post_draft`, step 11):**
`balance_due` and `payment_status` were computed from `total_applied`, which accumulated every tender amount including AR Charge. AR Charge is deferred credit — no cash is collected — so a fully AR-charged sale was storing `payment_status = "Paid"` even though the full amount remained owed. Changed the basis to `standard_applied` (which already excludes AR Charge and AR Credit tenders) so that:
- Fully AR-charged sale → `payment_status = "Unpaid"`, `balance_due = grand_total`
- Partial AR Charge + cash → `payment_status = "Partial"`, `balance_due = grand_total minus cash portion`
- Cash-only sale → unchanged, `payment_status = "Paid"`
The `outstanding_balance` update logic (step 12) was not changed.

**Fix 2 — Returns not filtered by customer in `list_sales`:**
The returns sub-query inside `list_sales` filtered by date, `location_id`, and `search` but never applied `customer_id`. When `list_sales` was called with `customer_id`, sales were correctly restricted to that customer but returns from all other customers in the date range were still appended to the response. Added `rq = rq.filter(models.SalesReturn.customer_id == customer_id)` alongside the existing filters.

---

## 2026-06-11 — AR Aging totals row showing NaN

**`frontend/src/pages/customers/CustomerAging.tsx`** — The five bucket fields in the `totals` reducer were summed with `+` directly against the raw API values. FastAPI serialises `Decimal` fields as strings in the JSON response, so `+` was string-concatenating (`"2000.00" + "500.00"` → `"2000.00500.00"`) rather than adding numerically, producing NaN in the totals row. Fixed by wrapping each field with `Number()` before addition in the reducer (`Number(r.current_amt)`, etc.).

---

## 2026-06-11 — AR Aging Report: per-invoice redesign and invoice-date fix

### Redesign — one row per invoice (per revised `docs/customers_aging.md`)

Changed the aging report from a one-row-per-customer bucket summary to a one-row-per-invoice detail view. The new shape exposes each outstanding invoice individually, which lets staff identify specific invoices to chase rather than just knowing a customer has something overdue.

**`backend/sales/schemas.py`** — Replaced `CustomerAgingOut` (per-customer fields: `terms_days`, `current`, `days_90_plus`, `total_outstanding`) with `AgingRowOut` (per-invoice fields: `invoice_id`, `invoice_date`, `due_date`, `current_amt`, `days_1_30`, `days_31_60`, `days_61_90`, `days_91_plus`). Field rename `days_90_plus` → `days_91_plus` corrects the off-by-one in the old name (the bucket starts at day 91, not 90).

**`backend/sales/router.py` (`get_ar_aging`)** — Rewrote response shape to emit one `AgingRowOut` per outstanding invoice, sorted `customer_name ASC, invoice_date ASC`. Additional corrections in the same pass:
- Removed `include_zero_balance` query param (superseded by the per-invoice model — customers with no outstanding invoices simply produce no rows).
- Removed the three `[AGING DEBUG] print()` statements that were left in production code.
- Fixed the global `ar_ledger` table scan: the prior query loaded every SALE entry in the entire ledger before filtering. Now filtered by `customer_id.in_(customer_ids)` up front.
- Return credit offset now explicitly filters `disposition = 'credit_to_account'`; the old query summed all `sales_returns.grand_total` regardless of disposition, incorrectly offsetting cash-refund returns against the AR balance.

**`frontend/src/pages/customers/CustomerAging.tsx`** — Complete rewrite to match the new per-invoice shape:
- Removed: balance filter toggle (Outstanding only / All active), bucket filter multi-select, column sorting controls.
- Columns: Customer, Invoice #, Invoice Date, Due Date, Current, 1–30 Days, 31–60 Days, 61–90 Days, 90+ Days.
- Customer name renders only on the first row of each customer group (conditional rendering, no rowspan).
- Zero-value bucket cells render blank; dates formatted `MMM DD, YYYY`.
- Sticky `<tfoot>` totals row labeled "Total", spanning the first four columns.
- XLSX export reflects visible (filtered) rows plus the totals row; column headers match the table exactly.
- Local `AgingRowOut` interface defined in the component; result cast from the stale `api.ts` type via `as unknown as Promise<AgingRowOut[]>`.

**`frontend/src/services/api.ts`** — Updated `CustomerAgingOut` interface to the new per-invoice fields. Removed `include_zero_balance` from the `aging()` function signature and simplified the query-string builder accordingly.

---

### Bug fix — invoice date used UTC system timestamp instead of business date

**Root cause**: `ar_ledger.occurred_at` is a PostgreSQL `server_default=func.now()` column — it stores the UTC wall-clock time when the INSERT executed, not the business date of the sale. The aging query was using `occurred_at.date()` as `invoice_date`. Because `transaction_date` is Manila-local (UTC+8) and `occurred_at` is UTC, sales posted between 00:00 and 07:59 Manila time could have an `occurred_at.date()` one day behind their actual `transaction_date`. Backdated sales (where the cashier explicitly supplies an earlier `transaction_date`) would age from today's timestamp rather than the stated invoice date.

**Fix** (`sales/router.py`, `get_ar_aging`): replaced the `occurred_at` column in the `ar_ledger` query with a separate `Sale` query that fetches `sale.transaction_date` and excludes voided sales in a single `IN` pass. `transaction_date` is a plain `date` column (Manila-local, user-supplied at post time, defaults to `_ph_today()`), so no timezone conversion is needed. The old separate voided-sale exclusion query is eliminated — a voided sale has no entry in `transaction_date_by_id` and falls out of `invoice_rows` naturally.

This fix works correctly for all existing historical rows: `sale.transaction_date` has always held the correct business date regardless of when the row was posted.

---

## 2026-06-08 — AR Aging Report: rebuilt on the AR-ledger bridge-table approach

Fixed a bug where AR-charge sales never appeared in the AR Aging Report (`GET /sales/customers/aging`).

**Root cause**: `post_draft` applies every tender — including `is_ar_charge` payment-mode tenders — toward `total_applied`, so a fully AR-charged sale ends up with `balance_due = 0` and `payment_status = 'Paid'` even though no money was actually collected and the customer's `ar_ledger`/`outstanding_balance` carry the full obligation forward (the `pass` branch at `post_draft` step 10 deliberately skips writing an offsetting ledger entry for AR-charge tenders, so the receivable stays open). The old aging query filtered on `Sale.payment_status != 'Paid'` and bucketed `Sale.balance_due`, so these sales were silently excluded — directly violating the "reports always derive the balance from `ar_ledger`, never `sales.balance_due`/`payment_status` in isolation" rule in `requirements.md` §3.8/§12.1.

**Fix** (`sales/router.py`, `get_ar_aging`) — replaced the `Sale.balance_due`/`payment_status` query with a ledger-derived bridge-table computation:
- AR-exposed sales are identified via `ar_ledger` rows with `reason='SALE'`, `reference_type='sales'` (written only for customer-linked Posted sales — see `post_draft` step 9), using `amount_change` as the principal. Voided sales are excluded.
- Offsets are computed as `non_ar_charge_payments + return_credits`:
  - `non_ar_charge_payments` = `SUM(customer_payment_applied.amount_applied)` joined through `customer_payments` → `payment_modes`, **excluding** `is_ar_charge` tenders (an AR-charge tender defers the obligation rather than settling it). `is_ar_credit` tenders are kept as legitimate offsets — they genuinely draw down the account.
  - `return_credits` = `SUM(sales_returns.grand_total)` for returns linked to the sale via `sale_id`.
- `outstanding_for_sale = principal − non_ar_charge_payments − return_credits`; only sales with `outstanding_for_sale > 0` age into the report.
- `due_date`/bucket assignment unchanged: `transaction_date + customer.terms_days`, bucketed by `days_overdue = today − due_date` into `current` / `days_1_30` / `days_31_60` / `days_61_90` / `days_90_plus`.

**Side effect**: this also resolves the "Open observation" logged in the 2026-06-07 AR Aging entry below — a sale partially offset by a `RETURN` (which doesn't touch that sale's own `balance_due`) is now correctly netted down via `return_credits`, so the report no longer diverges from the customer's ledger-derived balance for that case.

The customer-level pre-filter (`outstanding_balance > 0` when `include_zero_balance` is false) is unchanged — `post_draft` correctly adds the full `grand_total` (including AR-charge amounts) to `customer.outstanding_balance` at post time, so that cached field remains a sound pre-filter even though the per-sale `balance_due`/`payment_status` fields are not.

---

## 2026-06-08 — Sales: split `sale_date` into `transaction_date` + `posted_at`

The `sales.sales` schema replaced the single `sale_date` column with two distinct fields: `transaction_date` (a plain `date` — the calendar date the sale occurred, user-supplied at posting time, defaults to today) and `posted_at` (a UTC `datetime` — the timestamp when the sale was finalised). Swept the entire codebase to replace every `sale_date` reference with the correct one of the two, per this rule: occurrences meaning "when the transaction occurred" → `transaction_date`; occurrences meaning "when it was posted/stamped" → `posted_at`.

**Design decision**: `transaction_date` is now the canonical date for all display, sorting, and filtering throughout the UI and reports (Sales Ledger, Sales Summary, AR Aging, Customer Detail, Item Ledger/Sales History, returns). `posted_at` stays in the data but is not surfaced as a primary date anywhere.

### Backend
- `sales/schemas.py`: `SalePostRequest` gained `transaction_date: date = Field(default_factory=date.today)`, letting the cashier supply (or default to today) the calendar date a sale is recorded against. `SaleOut` now exposes `transaction_date: Optional[date]` and `posted_at: Optional[datetime]` instead of `sale_date`.
- `sales/router.py` (`post_draft`): on finalisation, `sale.posted_at = now()` (UTC) and `sale.transaction_date = payload.transaction_date`; `due_date` is now computed as `transaction_date + customer.terms_days`.
- AR aging (`get_ar_aging`) and `_overdue_customer_ids` recompute `due_date` from `transaction_date` rather than the old `sale_date`.
- `list_sales` / `get_sales_summary`: because `transaction_date` is a plain `Date` (no timezone), date-range filters now compare directly (`transaction_date >= date_from.date()` / `<= date_to.date()`) — this removes the need for PH-timezone anchoring (`_ph_day_bounds`) for `Sale` queries entirely, eliminating the "early-morning PH hours misclassified as yesterday" bug class for sales. `SalesReturn.return_date` is still a UTC `datetime`, so `_ph_day_bounds` is retained solely for return-row filtering and blind-return pseudo-rows in the combined ledger.
- `get_customer_sales` now orders by `transaction_date.desc()`.
- `inventory/router.py` / `inventory/schemas.py`: `get_sales_history` / `SalesHistoryItem` now select and expose `transaction_date` (a `date`) instead of `sale_date` (a `datetime`).

### Frontend (`services/api.ts` and consuming pages)
- `SaleOut` interface split into `transaction_date: string | null` and `posted_at: string | null`; `SalesHistoryItem.sale_date` renamed to `transaction_date`.
- Updated all display call sites to read `transaction_date`: `pages/inventory/Detail.tsx`, `pages/customers/CustomerDetail.tsx`, `pages/sales/ReturnNew.tsx`, `pages/sales/SaleDetail.tsx`, `pages/sales/SalesLedger.tsx`.

### Docs
- `docs/schema.dbml`: replaced the `sale_date datetime` column with `transaction_date date [not null, default: CURRENT_DATE]` and `posted_at datetime`; updated the `due_date` note to reference `transaction_date`.
- `docs/requirements.md`, `docs/customers_aging.md`, `docs/customers_ar.md`, `docs/sales_backlog.md`: updated formula/spec references from `sale_date + customer.terms_days` to `transaction_date + customer.terms_days`, and the posting-flow description to mention `posted_at = now()` and `transaction_date` stamping.
- Pre-existing historical changelog entries and `docs/backlog.md:137` that mention `sale_date` describe past states of the system as of when they were written and were intentionally left as-is.

---

## 2026-06-07 — AR Aging Report (`/customers/aging`)

Implemented the AR Aging Report per `docs/customers_aging.md`, reusing the AR module's existing conventions (`docs/customers_ar.md`).

### Backend (`sales/router.py`, `sales/schemas.py`)
- Added `CustomerAgingOut` schema (per-customer bucket totals: `current`, `days_1_30`, `days_31_60`, `days_61_90`, `days_90_plus`, `total_outstanding`, plus `terms_days`).
- Added `GET /sales/customers/aging` (`get_ar_aging`), gated by the `manage_customers` permission (Admin/Manager only, matching the rest of the Customers module). Defined it **before** `get_customer` so its static path isn't shadowed by `/customers/{customer_id}`.
- The endpoint loads active customers (optionally filtered by `search` and `include_zero_balance`), pulls `balance_due` from their Posted, not-fully-paid sales, and buckets each sale's outstanding amount by `days_overdue = today − due_date`.
- **Decision**: bucketing recomputes `due_date` fresh as `sale_date.date() + timedelta(days=customer.terms_days)` for every sale, rather than trusting the stored `Sale.due_date` column. That column is only populated when `terms_days > 0` (`router.py` ~line 1298), so COD customers (`terms_days = 0`) have `due_date = NULL` in the DB. Recomputing uniformly — a literal application of the spec's stated formula — ensures unpaid COD sales age into overdue buckets instead of permanently sitting in "Current".

### Frontend
- New page `pages/customers/CustomerAging.tsx`: Admin/Manager-gated (same `ALLOWED_ROLES` guard pattern as `Settings.tsx`), with a filter panel (keyword search, Outstanding-only/All-active balance toggle, multi-select aging-bucket filter), sortable Customer Name / Total Outstanding columns, color-coded bucket cells (green→red as buckets age), row click-through to Customer Detail, a pinned summary-totals footer row, and an "Export XLSX" button (`ar_aging_{date}.xlsx`, includes a TOTAL row).
- Added `CustomerAgingOut` type and `salesApi.customers.aging()` helper to `services/api.ts`, and `qk.customerAging()` to the query-key factory.
- Added "Aging Report" as a nav sub-item in `Customers.tsx` between "Customers" and "AR Ledger", and registered the `/customers/aging` route ahead of the `:customerId` catch-all.

### Verified
- Live calculation cross-checked against `sales.sales` data (`sale_id=3`: `sale_date=2026-05-29`, `terms_days=30` → recomputed `due_date=2026-06-28`; today `2026-06-07` → `days_overdue=-21` → correctly bucketed as "Current", `total_outstanding=100.00`).
- `include_zero_balance` toggle, `search` filter, and the `manage_customers` permission gate (non-Admin/Manager role correctly denied) all confirmed via direct API calls.
- Rebuilt and redeployed `seasons_frontend`; confirmed the new page and nav link are present in the deployed bundle.

### Open observation (not actioned — pre-existing data/logic issue)
For customer `Test Customer Updated` (id 1), the `ar_ledger` nets to `0.00` (matching `outstanding_balance = 0.00`: `+300 SALE, −150/−50 PAYMENT, −100 RETURN`), but the originating `sale_id=3` still carries `balance_due = 100.00` / `payment_status = Partial` — the RETURN reduced the customer's overall ledger balance without reducing that sale's own `balance_due`. Because the Aging Report buckets `balance_due` from Posted/non-Paid sales (per spec), it correctly shows this customer with `$100` outstanding even though their cached `outstanding_balance` reads `$0`. This is a pre-existing gap in how returns are applied to originating sales — fixing it would mean changing return-posting logic, which is outside the scope of "implement the Aging Report." Flagging it because it can make Aging Report totals diverge from the Customer List's `outstanding_balance` figures.

---

## 2026-06-07 — AR Ledger and Customer Payments: add `notes` column

Added the `notes` field that `docs/customers_ar.md` (and `docs/schema.dbml`, which already documented it) called for but the database lacked.

- **Migration** `t4u5v6w7x8y9_ar_ledger_and_payments_add_notes.py`: adds nullable `notes VARCHAR(500)` to `sales.ar_ledger` and `sales.customer_payments`. Applied to the running DB (this project's `alembic_version` table records one row per applied migration rather than a single pointer, so the new revision was stamped consistently with that existing pattern after applying the DDL).
- **Models** (`sales/models.py`): added `notes = Column(String(500), nullable=True)` to `ArLedger` and `CustomerPayment`.
- **Schemas** (`sales/schemas.py`): added `notes: Optional[str] = None` to `ArLedgerOut` and `CustomerPaymentOut` (response models); `RecordPaymentIn` already carried it.
- **Router** (`sales/router.py`): `record_customer_payment` now persists `payload.notes` on the `CustomerPayment` row and copies it onto the `PAYMENT` `ArLedger` entry it writes, so the note is visible from both the payment record and the ledger.
- **Frontend**: added `notes` to the `ArLedgerOut`/`CustomerPaymentOut` API types; added an optional "Notes" textarea to the Record Payment modal (`CustomerDetail.tsx`); added a "Notes" column to the AR Ledger table (`CustomerARLedger.tsx`), showing the note text (truncated with a tooltip) or "—" when null.
- Verified end-to-end via direct API calls (payment with notes, payment without notes, AR ledger read-back) and cleaned up the test rows afterward, restoring the customer's `outstanding_balance` to its original value.

---

## 2026-06-07 — Customers & AR module: spec audit and gap fixes

Audited the existing Customers & AR implementation (Customer List, Customer Detail, AR Ledger, Payment Recording, AR Charge/Credit posting) against `docs/customers_ar.md`. The module was already substantially built; this pass closed the remaining gaps:

### Backend (`sales/router.py`, `sales/schemas.py`)
- Added computed `is_overdue` flag to `CustomerOut`: a customer is overdue when they carry a positive `outstanding_balance` AND have at least one Posted, not-fully-paid sale whose `due_date` (`sale_date + terms_days`) has passed. Implemented via `_overdue_customer_ids()` / `_attach_overdue_flags()` and wired into `list_customers` and `get_customer`.
- Fixed `list_customers` to honor the `include_deleted` query param (the frontend was already sending it, but the backend silently ignored it).
- **Fixed a critical broken Reactivate flow**: `_load_customer` filtered out `is_deleted = True` customers, so `GET /customers/{id}` 404'd for inactive customers — breaking both the Customer Detail page and the Reactivate button (which routes through the same load). Removed the filter (soft-delete status is still exposed via `CustomerOut.is_deleted`); `update_customer` now also unconditionally sets `customer.is_deleted = False`, matching the frontend's existing convention of calling `PATCH {}` with an empty body to reactivate. Verified end-to-end: deactivate → `GET` returns the record (no 404) → `PATCH {}` reactivates → state restored.

### Frontend
- `CustomerList.tsx`: added an "Overdue" balance-filter option and an Overdue badge next to the outstanding-balance figure.
- `CustomerDetail.tsx`: added the overdue badge near "Outstanding Balance"; added a required "Payment Date" field (defaulting to today, PH-local via `todayLocal()`) to the Record Payment modal; replaced the AR Ledger / Sales / Payments / Returns sections' single-page queries with the project's standard cursor-based "Load More" pattern (local state + `useEffect` seed + `loadMore*` functions), so all four sections now paginate consistently with the rest of the app.
- `CustomerARLedger.tsx`: added a Balance filter (All / Outstanding / Credit) that filters entries by the linked customer's current outstanding-balance sign.
- `services/api.ts`: added `is_overdue` to `CustomerOut`, `payment_date` to the record-payment payload, and `limit` params to the AR ledger / sales / payments cursor-paginated list helpers.
- Minor cleanup: removed pre-existing unused-import/variable TS warnings (`useQuery`, `CustomerOut`, unused `key` param) in the three customer pages touched.

### Open decision (flagged, not actioned)
`docs/customers_ar.md` references "Notes" fields on AR Ledger entries and on Payment Recording, but `docs/schema.dbml` (the CLAUDE.md-designated approved schema) has no `notes` column on either `ar_ledger` or `customer_payments`. Per "state your understanding and wait for confirmation" before schema-affecting changes, no migration or UI was added for this — flagged for the user to confirm whether the spec or the schema should be updated.

---

## 2026-06-07 — Sales Ledger date filter: PH-timezone fixes

### Bug — Date range filter excludes/misplaces early-morning (PH local) sales
- Root cause: `sales.sale_date` is stored as UTC, but `date_from`/`date_to` query params represent Manila-local (UTC+8) calendar dates. The old filter compared them as naive UTC boundaries, so sales posted between roughly midnight and 8am PH time (still "yesterday" in UTC, e.g. `SALE-00060` at `2026-06-06 17:13 UTC` = `2026-06-07 01:13 PHT`) were misclassified into the wrong day's results.
- Added `_ph_day_bounds()` helper in `sales/router.py`: anchors naive `date_from`/`date_to` to PH-local midnight (`UTC+8`) and returns a half-open `[start, start_of_next_local_day)` UTC-comparable range — giving an inclusive full-day window in Manila local time.
- Applied to `list_sales` (`GET /sales/`, including its embedded blind-returns subquery) and `get_sales_summary` (`GET /sales/summary`, including its blind-returns subquery), since the dashboard documents itself as using "same filters as list_sales" and would otherwise disagree with the table for "today".
- Verified via direct DB query (`sale_date AT TIME ZONE 'Asia/Manila'`) and raw `GET /sales/?date_from=2026-06-07&date_to=2026-06-07` — `SALE-00060`/`RET-00014` now correctly appear under "today" (PH local) and are excluded from "yesterday".
- Rebuilt and restarted `seasons_backend` to pick up the change (no live-reload volume mount in `docker-compose.yml`).

### Frontend — Stale build served pre-fixed `todayLocal()` source
- `frontend/src/pages/sales/SalesLedger.tsx` already used a correct local-date helper (`todayLocal()`, built from `getFullYear()/getMonth()/getDate()`) for the `date_from`/`date_to` defaults instead of `toISOString()` (which returns the UTC date and can show yesterday's date for UTC+8 users).
- The deployed `seasons_frontend` container was running a stale bundle (`SalesLedger-DQynm2P8.js`) still containing `new Date().toISOString().slice(0,10)`. Rebuilt the frontend (`docker compose up -d --build frontend`) — the new bundle (`SalesLedger-lAliBj0a.js`) contains the local-date computation with zero `toISOString` calls.

---

## 2026-06-06 — Batch 3: tender fix, return discount, Sales Ledger returns, origin sale, nav cleanup

### Issue 5 — Remove stray Returns tab from Sales.tsx
- Removed `Returns` lazy import, `<NavLink to="/sales/returns">` tab, and `<Route path="returns">` entry
- Kept `returns/new` and `returns/:returnId` routes intact
- Fixed all hardcoded Tailwind gray classes in `Sales.tsx` to use theme CSS variables (`t-bg-base`, `t-bg-surface`, `t-border`, `t-text-1/3/4`)

### Issue 1 — Tender auto-fill timing fix
- Changed `useEffect` in `Workstation.tsx` to use `setTenders(prev => ...)` functional updater, eliminating stale closure on `tenders` state
- Cash tender amount now reliably syncs to `grandTotal` on every grand total change, and resets when cart is cleared

### Issue 4 — Origin Sale reference field on Workstation
- Added `originSaleId: string` to `SessionHeader` interface
- Added "Origin Sale" text input in the session header panel; user types a Sale PID and presses Enter (or blurs) to resolve it via the sales list API
- Resolved sale ID stored in `header.originSaleId`; `buildDraftPayload()` sends it as `origin_sale_id`
- Field clears automatically on post, void, and new transaction
- Also fixed remaining hardcoded gray classes on customer clear button and PID input

### Issue 2 — Return totals respect discounts
- Fixed `_do_return` in `sales/router.py` to compute `line_total` as `(si.line_total / si.quantity) × return_qty` for linked returns
- Blind returns continue using the caller-supplied `unit_price`

### Issue 3 — Returns as negative rows in Sales Ledger
- `SaleOut` schema gains optional `row_type: str = 'sale'` and `return_id: Optional[int]` fields
- `list_sales` endpoint now queries `SalesReturn` records in the same date/location scope and appends them as negative-grand-total `SaleOut` rows with `row_type='return'`, `status='Return'`; combined list sorted by date descending
- Totals: `subtotal`/`discount` are sales-only; `grand_total` is net of returns
- Footer count shows "N sales + M returns" when returns are present
- Return rows navigate to `/sales/returns/{return_id}` on click; purple background tint; grand total shown as `−₱X.XX` in red; status badge purple; no expand toggle
- Removed separate `returnsData` query (previously used only for the RET badge); RET badge removed
- Export: Sheet 1 includes return rows; Sheet 2 fetches return items on demand and includes them with negative qty/line_total
- `api.ts` `SaleOut` interface updated with `row_type` and `return_id`

---

## 2026-06-06 — Return disposition, ledger fixes, workstation tender, theme CSS

### Task 1 — Migration: `sales_returns` add `disposition` and `customer_id`

**`alembic/versions/s3t4u5v6w7x8_sales_returns_add_disposition.py`**
- Adds `disposition VARCHAR(20)` (values: `cash_refund`, `credit_to_account`) to `sales.sales_returns`
- Adds `customer_id INTEGER` FK to `sales.customers` on `sales.sales_returns`
- `down_revision = 'r2s3t4u5v6w7'`

**`sales/models.py`** — `SalesReturn` gets `disposition` and `customer_id` columns; `customer` relationship added.

**`sales/schemas.py`** — `SalesReturnCreate` adds `customer_id` and `disposition` fields. `SalesReturnOut` adds both fields.

**`api.ts`** — `SalesReturnOut` interface and `returns.create` payload type updated with `disposition` and `customer_id`.

---

### Task 2 — Full return protocol

**`sales/router.py` (`_do_return`)**
- Blind returns now load customer from `payload.customer_id` if provided
- `disposition` and `customer_id` written to `SalesReturn` on creation
- AR credit entry (RETURN reason) now gated on `disposition == 'credit_to_account'` — previously always wrote AR on any customer return

**`ReturnNew.tsx`** — Full overhaul:
- Disposition field: Cash Refund (default) / Credit to Account (disabled without registered customer)
- Return Location dropdown (was "same as original sale", now a required picker)
- Customer field: auto-populated from linked sale, editable dropdown for blind returns
- Blind return support: item search panel (searches POS catalog by name/PID); no qty cap
- Removed `handleExchange` function and "Exchange →" button entirely
- All hardcoded dark colors replaced with theme CSS variables

**`SaleDetail.tsx`**
- "Return / Exchange" button renamed to "Process Return"
- Process Return button disabled (with tooltip) when all sale items are fully returned
- Line items table: adds "Returned" and "Returnable" columns when `saleReturns.length > 0`
- Returns section: added Disposition column per return row; tfoot colspan updated

---

### Task 3 — Workstation tender auto-fill fix

**`Workstation.tsx`**
- Auto-fill useEffect now also re-syncs amount when the first tender row already has Cash mode — previously only filled on the very first population, so adding more items didn't update the default amount

---

### Task 4 — Sales Ledger tendered amount fix

**`SalesLedger.tsx`**
- Per-row tendered: `Number(s.grand_total) + Number(s.audit_variance ?? 0)` — wrapping in `Number()` prevents Decimal-as-string concatenation bug (`"1000.00" + "0.00"` = `"1000.000.00"` = NaN)
- Summary row total tendered: same fix applied

---

### Task 5 — Stock and Procurement theme CSS

**12 files** — Replaced all hardcoded Tailwind gray color classes with theme CSS variables:
- `bg-gray-{950,900,800,700}` → `t-bg-{base,surface,elevated,elevated}`
- `border-gray-{900,800,700}` → `t-border`; `border-gray-600` → `t-border-strong`
- `text-gray-{100,200}` → `t-text-1`; `text-gray-300` → `t-text-2`; `text-gray-400` → `t-text-3`; `text-gray-{500–800}` → `t-text-4`

Files: `Procurement.tsx`, `PurchaseOrders.tsx`, `Suppliers.tsx`, `Stock.tsx`, `Ledger.tsx`, `Receiving.tsx`, `ReceivingConfirm.tsx`, `ReceivingDetail.tsx`, `ReceivingNew.tsx`, `TransferDetail.tsx`, `TransferNew.tsx`, `Transfers.tsx`

---

### Task 6 — Remove exchange button

- `ReturnNew.tsx`: `handleExchange` function and "Exchange →" button removed (part of Task 2 overhaul)
- `SaleDetail.tsx`: action button label changed from "Return / Exchange" to "Process Return"

---

## 2026-06-06 — AR Charge/Credit payment modes, Sales Ledger fixes, SaleDetail Returns

### Task 1 — Migrations: AR flags on payment_modes + ar_reason enum expansion

**`alembic/versions/q1r2s3t4u5v6_payment_modes_ar_flags.py`**
- Adds `is_ar_charge boolean not null default false` and `is_ar_credit boolean not null default false` to `sales.payment_modes`
- `down_revision = 'p8q9r0s1t2u3'`

**`alembic/versions/r2s3t4u5v6w7_ar_reason_enum_expand.py`**
- Expands `sales.ar_reason` PostgreSQL enum: `AR_CHARGE`, `AR_CREDIT`
- `down_revision = 'q1r2s3t4u5v6'`
- Uses `COMMIT / BEGIN` wrapping (required — PostgreSQL disallows `ALTER TYPE ADD VALUE` inside a transaction)

**`sales/models.py`** — `PaymentMode` gets `is_ar_charge`, `is_ar_credit` columns; `ArLedger.reason` enum expanded.

**`sales/schemas.py`** — `PaymentModeCreate`, `PaymentModePatch`, `PaymentModeOut` updated with optional AR flags. `SalesSummaryResponse` gains `returns_total: Decimal`.

---

### Task 2 — Settings: Payment Modes tab AR flag toggles (`Settings.tsx`)

- Two new checkbox toggles per payment mode: "Charge to AR Account" and "Draw from AR Credit"
- Mutual exclusivity validation: blocks save if both flags are true simultaneously
- Table column "AR Flags": amber badge for AR Charge, blue badge for AR Credit

---

### Task 3 — Workstation: Customer AR integration (`Workstation.tsx`)

- Session header: Outstanding Balance displayed; Available Credit shown in emerald when `outstanding_balance < 0`
- AR Credit tender rows hidden when no customer is selected
- Per-row inline validation: AR Charge requires customer; AR Credit amount capped at available credit
- Grand total autofilled in Cash row on sale open
- Change Due (emerald) / Balance Due (red) computed from `tenderDelta = totalTendered - grandTotal`
- Stale `setReceiptTotal('')` calls removed (state was never declared)

---

### Task 4 — Workstation: Sale post — AR ledger entries (`sales/router.py`)

AR balance accounting model (per sale post):

| Tender type | AR ledger entry | `standard_applied` |
|---|---|---|
| `is_ar_charge` | `AR_CHARGE` +amount (audit only) | not counted |
| `is_ar_credit` | `AR_CREDIT` −amount (audit only) | not counted |
| Standard | `PAYMENT` −amount | +amount |

`customer.outstanding_balance += grand_total − standard_applied`

AR Charge and AR Credit entries are written solely for audit trail. The balance change is fully captured by the SALE entry ± the standard tenders.

---

### Task 5 — Customers & AR module (`CustomerDetail.tsx`, `CustomerARLedger.tsx`)

**CustomerDetail:**
- Header: Outstanding Balance amber/emerald by sign; Available Credit (emerald) shown when balance < 0
- Record Payment modal: filters out `is_ar_charge` and `is_ar_credit` modes — only standard tenders available
- Returns section: table with Return PID (link), Date, Items Returned, Credit Amount

**CustomerARLedger:**
- `REASONS` const expanded: `AR_CHARGE`, `AR_CREDIT` added to type filter checkboxes
- Badge colors: amber for `AR_CHARGE`, cyan for `AR_CREDIT`; display text uses `.replace('_', ' ')`

---

### Task 6 — Sales Ledger & SaleDetail fixes

**`SalesLedger.tsx`:**
- `fmt` NaN guard: `if (isNaN(num)) return '—'`
- Revenue card: Returns line `−₱{returns_total}` added below Merchandise Gross
- Collections card: amounts right-aligned with `w-24 text-right shrink-0`; label `<Tip>` moved inside flex row so alignment is consistent
- Sale rows: "RET −₱{amount}" badge appended when sale has associated returns
- `salesApi.returns.list` called with date-scope filters; `returnsBySaleId` map built client-side

**`SaleDetail.tsx`:**
- `fmt` NaN guard added
- `modeMap` now stores full `PaymentMode` objects (was string names); fixes `is_physical` lookup in tenders tfoot and XLSX export
- XLSX export updated to prefer `p.payment_mode_name` / `p.payment_mode_is_physical` (backend-resolved), falling back to `modeMap`
- **Returns section** added below Tenders: table with Return PID (link), Date, Reason, Items Returned, Credit Amount; total row at bottom

---

### Task 7 — Sales summary: returns_total (`sales/router.py`, `sales/schemas.py`, `services/api.ts`)

`get_sales_summary` now computes:
- `returns_total` — sum of `SalesReturn.grand_total` for returns linked to in-scope sales, plus blind returns in the date window
- `total_revenue = merch_gross − returns_total − cart_discounts + non_merch + variances`

`SalesSummaryResponse` and TypeScript `SalesSummaryResponse` interface updated.

---

### Task 8 — XLSX export fixes (`SaleDetail.tsx`, `services/api.ts`)

- `salesApi.returns.list` now accepts `sale_id?: number` query param (passed through to `GET /sales/returns?sale_id=`)
- `SaleDetail.handleExport` Sheet 1 (Tender Breakdown): uses backend-resolved `payment_mode_name` and `payment_mode_is_physical` per tender row; `modeMap` as fallback
- Two-sheet structure (Tender Breakdown + Line Item Detail) already in place; no structural changes needed

---

## 2026-06-05 — Sales module fixes (8 items)

### 1. Receipt Total — display only (`Workstation.tsx`, `sales/router.py`)

Receipt Total input removed from the cart footer. The field is now a display-only label showing the system-computed Grand Total. No override is possible on the auditor workstation (reserved for a future cashier page).

`post_draft` updated:
- `sale.receipt_grand_total = grand_total` (always, ignoring any incoming payload value)
- `audit_variance = SUM(payload.tenders.amount) - grand_total` — computed from tender amounts before the tender application loop

`receiptTotal` state, `setReceiptTotal` calls, and `receipt_grand_total` from the post payload removed from `Workstation.tsx`.

---

### 2. Change Due / Balance Due (`Workstation.tsx`)

The tender section now shows a context-sensitive computed line below "Total Tendered":

- `tenderDelta > 0`: **Change Due ₱X** in emerald — auditor over-tendered
- `tenderDelta < 0`: **Balance Due ₱X** in red — shortfall
- `tenderDelta = 0`: nothing shown

`tenderDelta = totalTendered - grandTotal`. Replaces the old single "Balance Due" line which used `grandTotal - totalTendered` and was always shown.

---

### 3. Sales Ledger — new toggleable columns (`SalesLedger.tsx`)

`ColVis` interface and `COL_DEFAULTS`/`COL_LABELS` updated. Old `subtotal`, `discount`, `receiptTotal` keys replaced with new column set:

| New key | Label | Source |
|---|---|---|
| `subtotalAmt` | Subtotal Amount | `s.subtotal_amount` |
| `cartDiscPct` | Cart Disc % | `s.cart_discount_pct` |
| `cartDiscFlat` | Cart Disc ₱ | `s.cart_discount_flat` |
| `discountAmt` | Discount Amount | `s.discount_amount` |
| `taxAmt` | Tax | `s.tax_amount` |
| `totalTendered` | Tendered | `grand_total + audit_variance` |
| `variance` | Variance | `s.audit_variance` (warning color when non-zero) |

"Receipt Total" column removed. "Total Tendered" derived as `grand_total + audit_variance` (exact after fix 1 for all new sales; approximate for pre-fix historical data). Summary row (tfoot) updated to match.

---

### 4. Ledger date range — default to today (`SalesLedger.tsx`)

`dateFrom` and `dateTo` filter state now initialise to `new Date().toISOString().slice(0, 10)` (today). Page opens showing today's sales rather than an empty result.

---

### 5. Same-day query fix (`sales/router.py`)

`list_sales` and `get_sales_summary` both used `sale_date <= date_to`. Since `sale_date` is a datetime and FastAPI parses a bare date as midnight, any sale timestamped after `00:00:00` on `date_to` was excluded.

Fixed in both endpoints: `sale_date < date_to + timedelta(days=1)` (exclusive upper bound, inclusive behaviour). Verified: today's sales now appear when `date_from = date_to = today`.

---

### 6. Collections card alignment fix (`SalesLedger.tsx` — `Dashboard` component)

The `<Tip>` wrapper on the "Total Virtual" row was `inline-block`, preventing the inner `flex justify-between` div from expanding to full width. The amount value was misaligned left.

Fixed by moving `<Tip>` to wrap only the label `<span>`, with the amount `<span>` as a sibling in the outer `flex justify-between` div. All collection rows now have consistent right-aligned amounts.

---

### 7. Payment mode name and is_physical fix (`sales/router.py`, `sales/schemas.py`, `SaleDetail.tsx`)

**Root cause:** `_load_sale` eager-loaded `payments_applied → payment` but not `payment → payment_mode`. The frontend's `modeMap` lookup worked only when `paymentModes` query loaded first and matched IDs. When any mode was unmatched (inactive, race condition, or ID type mismatch), `mode` was `undefined`, and the fallback `mode?.is_physical !== false` defaulted to `true`, showing all rows as "Physical".

**Backend fix:**
- `_load_sale` selectinload extended: `CustomerPaymentApplied.payment → CustomerPayment.payment_mode`
- After loading, `payment_mode_name` and `payment_mode_is_physical` set as Python attributes on each payment object
- `CustomerPaymentOut` schema: `payment_mode_name: Optional[str]` and `payment_mode_is_physical: Optional[bool]` added

**Frontend fix:**
- `CustomerPaymentOut` TypeScript interface updated
- `SaleDetail.tsx` tender section uses `p.payment_mode_name` / `p.payment_mode_is_physical` directly, with `modeMap` as fallback for pre-fix historical records
- Physical/Virtual totals in tfoot use the same resolved function

Verified: `name=Cash is_physical=True` confirmed on live sale detail response.

---

### 8. Cash default tender — reliable (`Workstation.tsx`)

`cashModePID` lookup hardened:
1. First tries `paymentModes.find(m => m.name.toLowerCase() === 'cash')`
2. Falls back to first `is_physical = true` mode
3. Falls back to `paymentModes[0]` (first active mode)

Covers databases where Cash is named differently or doesn't yet exist.

---

## 2026-06-04 — Bulk Excel Import hub (5 entity types)

Spec: `/docs/bulk_import.md`. Additive — existing product, transfer, and receiving imports unchanged.

### Backend — `import_hub/` module

New module at `backend/import_hub/`. Mounted at `/import` prefix.

**`schemas.py`** — row input types per entity (`CustomerImportRow`, `SupplierImportRow`, `StockBalanceImportRow`, `VariantPriceImportRow`, `VariantCostImportRow`), combined confirm requests (anchor list + rows in one body), generic `ImportDiffRow`, `ImportErrorRow`, `ImportPreviewResponse`, `ImportConfirmResponse`.

**`router.py`** — per entity: template download, preview, confirm.

| Entity | Anchor | Key behaviours |
|---|---|---|
| Customers | `customer_name` | "no limit" string clears credit_limit; outstanding_balance always 0 on create |
| Suppliers | `supplier_code` | All fields optional on update; supplier_code immutable |
| Stock Balances | `PID + location_name` | Computes delta; writes ADJUST ledger entry; rejects virtual locs, bundles, Non-Inventory |
| Variant Prices | `PID` | `clear_promo` column; validates price > 0, promo ≤ price; writes `variant_price_history` |
| Variant Costs | `PID + supplier_code` | Link must already exist; validates 0 < cost, 0 ≤ discount ≤ 100; writes `variant_cost_history` |

**Templates** — generated server-side with `xlsxwriter`: bold header row + one sample row. Returned as XLSX `StreamingResponse`.

**Preview** — validation-only, no writes. Returns `valid_rows` (with diff data), `error_rows` (row number + anchor + reason), `summary` (creates/updates/noops/errors counts). Failed rows do not block others.

**Confirm** — accepts `{ confirmed_anchors, rows }` in one body. Writes only approved anchors. Returns written/skipped/error counts.

### Frontend — `services/api.ts`

`ImportDiffRow`, `ImportErrorRow`, `ImportPreviewResponse`, `ImportConfirmResponse` interfaces added. `importApi` object:
- `downloadTemplate(entity)` — fetches XLSX blob and triggers browser download
- `preview(entity, rows)` — `POST /import/{entity}/preview` with parsed rows as JSON
- `confirm(entity, confirmedAnchors, rows)` — `POST /import/{entity}/confirm`

### Frontend — `pages/settings/ImportHub.tsx` (new, lazy-loaded)

**Entity sidebar** — 5 buttons, active item highlighted with accent border. `key={activeId}` on `ImportForm` resets state when switching entities.

**Import form** — per entity:
- Entity name, description, anchor field displayed
- "↓ Download Template" triggers `importApi.downloadTemplate`
- "↑ Upload XLSX" input → parses with `xlsx` library → calls preview → shows results panel
- Results panel: summary badges (new/update/no-op/error counts), error list (row number + anchor + reason), "↓ Error Report" button, "Review & Confirm →" button (disabled until valid rows exist)

**DiffModal** — generic diff table:
- One row per changed field; anchor, mode badge (create green / update amber), field name, current DB value, incoming value (changed fields highlighted yellow)
- Checkbox per action row; "Select all" / "Deselect all" links
- "Apply N rows" button calls confirm; shows write result inline

**`Settings.tsx`** — "Import" tab added to `TABS`. `ImportHub` lazy-loaded via `React.lazy`. `ImportHub` uses `-mx-6 -mt-6` to break out of the Settings card padding and fill the available area.

---

## 2026-06-04 — Sales Ledger redesign, column picker, tender rows, two-sheet export

### 1. Sales Ledger dashboard — three-card redesign

**Backend — `sales/schemas.py` + `sales/router.py`**

`SalesSummaryResponse` updated to match spec:
- `known_profit` → `gross_profit`; `partial_gross_sales` → `uncosted_revenue`; `coverage_pct` removed entirely
- `CollectionEntry` schema added: `{ payment_mode, amount, is_physical }`
- New fields: `collections: List[CollectionEntry]`, `total_physical`, `total_virtual`, `total_collected`

`get_sales_summary` updated:
- Computes collections via `customer_payment_applied → customer_payments → payment_modes` grouped by mode, filtered to the same sale scope as all other metrics
- Removes coverage percentage calculation

**Frontend — `api.ts`**

`SalesSummaryResponse` type updated to new field names. `CollectionEntry` interface added.

**Frontend — `SalesLedger.tsx` — Dashboard section**

Three cards in a horizontal row:

- **Card 1 — Revenue**: composition table showing Merchandise Gross, Cart Discounts (negative), Non-Merch Revenue, Variances, divider, Total Revenue. Each label has a hover tooltip per spec.
- **Card 2 — Profitability**: Gross Profit (fully costed sales only) + Uncosted Revenue (sales with missing cost data flagged in amber). No coverage percentage.
- **Card 3 — Collections**: per payment mode rows with Physical/Virtual badge, Total Physical, Total Virtual (with tooltip), Total Collected.

All three cards use `t-*` theme classes. Dashboard syncs in real time with scope filters (date, location, shift, register, cashier, customer, status).

---

### 2. Sales Ledger table improvements

**Column picker** — ⚙ button top-right opens a popover checklist. Permanently visible: Sale PID, Date, Grand Total. All other columns toggleable (Shift, Location, Register, Cashier, Customer, Subtotal, Discount, Receipt Total, Variance, Payment Status, Sale Status, Actions). Selection persists to `localStorage` under `erp_ledger_cols`. Default: Location, Cashier, Customer, Receipt Total, Variance, Payment Status, Sale Status, Actions visible; Shift, Register, Subtotal, Discount hidden.

**Expandable tender sub-rows** — Each sale row has a ▶/▼ toggle on the far left. Clicking expands inline sub-rows showing each payment's Mode, Amount, Reference Number, Physical/Virtual badge. Only one row expanded at a time (expanding another collapses the previous). Collapsed by default.

**Theme compliance** — All hardcoded colors replaced with `t-*` variables throughout the component.

---

### 3. Export — two sheets

Both `SalesLedger.tsx` and `SaleDetail.tsx` export now produce two-sheet XLSX files:

**Sheet 1 — Tender Breakdown**: one row per tender entry; sale header fields repeat; columns: Sale PID, Date, Shift, Location, Register, Cashier, Customer, Grand Total, Receipt Total, Variance, Payment Status, Sale Status, Payment Mode, Amount, Reference Number, Money Type (Physical/Virtual).

**Sheet 2 — Line Item Detail**: one row per sale item; sale header fields repeat; columns: Sale PID, Date, Cashier, Customer, Brand, Variant Name, PID, Qty, Unit Price, Disc %, Disc ₱, Line Total, Net Unit Cost, Cost Source, Product Type.

Brand and Product Type require backend changes (below). File named `sales_export_{date_from}_{date_to}.xlsx`.

**Backend support for Brand/Product Type in sale items:**
- `VariantRefOut` schema extended with `product_brand: Optional[str]` and `product_type: Optional[str]`
- `selectinload` chains in `list_sales` and `_load_sale` extended: `SaleItem.variant → Variant.product`
- `_collapse_items` updated to manually construct `VariantRefOut` using `variant.product.brand` and `variant.product.product_type` when the product is loaded
- `SaleItemOut.variant` TypeScript type updated with `product_brand` and `product_type`

---

### 4. Register dropdown reliability (confirmed, already fixed)

Already addressed in the previous session: `retry: 3` applied to the registers query, error state with "Failed to load" + Retry button, empty state with Refresh link. No further changes needed.

---

### 5. Sale Detail — tender section update

`SaleDetail.tsx` tender table updated:
- **Money Type column** added — Physical (blue badge) or Virtual (purple badge) per row, resolved from `paymentModes` map via `payment_mode_id`
- **Total Physical** row shown when any physical payments exist
- **Total Virtual** row shown when any virtual payments exist
- **Total Tendered** row always shown at bottom
- Export updated to two-sheet format matching the ledger export

---

## 2026-06-04 — Bug fixes: theme system and register dropdown

### Bug 1 — Workstation and Sales Ledger color scheme (`Workstation.tsx`)

The Sales Ledger already used `t-*` theme-aware classes from its last rewrite. The auditor workstation used hardcoded Tailwind gray shades throughout — these matched the dark theme visually but ignored light and carbon themes entirely.

Every hardcoded color in `Workstation.tsx` replaced with CSS variable utilities:

| Old | New | Applies to |
|---|---|---|
| `bg-gray-950` | `t-bg-base` | Main container, table rows, draft tray |
| `bg-gray-900` | `t-bg-surface` | Header, left panel, footer areas, tender |
| `bg-gray-800` (background) | `t-bg-elevated` | Table header, action buttons, draft items |
| `bg-gray-800` (input) | `t-bg-input` | All text inputs and selects |
| `border-gray-800` | `t-border` | All dividers and cell borders |
| `border-gray-700` | `t-border-strong` | Input borders, strong dividers |
| `text-gray-100/200/300` | `t-text-1` | Primary content text |
| `text-gray-400/500` | `t-text-2` | Secondary text |
| `text-gray-600` | `t-text-3` | Labels, muted text |
| `text-gray-700` | `t-text-4` | Placeholders, decorative elements |
| `focus:ring-blue-500` | `ring-[var(--accent)]` | All focus rings |
| `text-blue-500`, `bg-blue-600` | `color/backgroundColor: var(--accent)` | Links, primary button |
| `hover:bg-gray-800/900` | `hover:t-bg-elevated/surface` | Interactive hover states |

Two shared class constants updated at the top of the file: `cellInput` (basket grid inputs) and `hdrSelect` (session header selects). A `hdrInput` alias added for the customer search text field.

Both pages now update immediately when the theme is changed in Settings → Appearance.

### Bug 2 — Register dropdown fetch reliability (`Workstation.tsx`)

**Root cause:** The global `QueryClient` has `retry: 1`. For a transient network hiccup during page load, a single retry is insufficient for reference data critical to the workstation. Additionally, no user-visible feedback existed when the registers fetch failed — the dropdown silently rendered empty, with no indication of error and no way to recover without a full page reload.

**Fixes:**

1. **`retry: 3`** added to the five critical reference data queries — shifts, locations, registers, paymentModes, employees — overriding the global `retry: 1` default for these specific calls.

2. **Error state**: when `qRegs.isError`, the register select is replaced with:
   ```
   "Failed to load"  [Retry]
   ```
   The Retry button calls `qRegs.refetch()` directly.

3. **Empty state with location selected**: when the fetch succeeded but `filteredRegisters` is empty (location has no active registers), a "No registers for this location" message is shown with a lighter **Refresh** link — handles the edge case where the register list may be stale after a new register is added.

---

## 2026-06-04 — RMA workflow (full customer return + exchange)

Spec: `/docs/rma_workflow.md`. Implements the Full RMA Workflow item from the backlog.

### Backend — `sales/router.py` + `sales/schemas.py`

**`_do_return(payload, current_user, db)`** — extracted the 100-line return creation logic from `create_return` into a shared helper that performs all stock, ledger, FIFO restoration, and AR writes without committing. Both `create_return` and `create_return_and_exchange` call it.

**`POST /sales/returns/exchange`** — new endpoint registered before `GET /returns/{id}`. Calls `_do_return`, then creates an exchange Draft sale with `origin_sale_id = original_sale_id` in the same transaction. Enforces one-exchange-per-sale guard (`origin_sale_id` uniqueness check). Returns `ExchangeResult { sales_return, exchange_draft }`.

**`GET /sales/returns` enhanced** — added `search`, `location_id`, `has_exchange` (bool), `cursor`, `limit` filter params. All rows have `exchange_sale_pid` / `exchange_sale_id` attached via `_attach_exchange()`.

**`_attach_exchange(ret, db)`** — helper that sets `exchange_sale_pid` and `exchange_sale_id` as Python attributes on `SalesReturn` ORM instances by querying `Sale` where `origin_sale_id = ret.sale_id AND status != 'Voided'`.

**`GET /sales/returns/{id}` enhanced** — now returns `exchange_sale_pid` / `exchange_sale_id` via `_load_return` → `_attach_exchange`.

**`GET /sales/sale/{id}/items-for-return`** — new endpoint. Returns collapsed `SaleItemOut` list for a Posted sale, each item annotated with `already_returned` (qty already returned across all prior returns against this sale). Used by the ReturnNew page to pre-populate and validate return quantities.

**`SalesReturnOut` schema** — added `exchange_sale_pid: Optional[str]` and `exchange_sale_id: Optional[int]`.

**`ExchangeResult` schema** — `{ sales_return: SalesReturnOut, exchange_draft: SaleOut }`.

**`SaleItemOut` schema** — added `already_returned: Optional[Decimal] = None`.

### Backend — `main.py`

**`_seed_store_credit()`** — idempotently creates a "Store Credit" payment mode (`is_physical = false`, `is_active = true`) on startup. Used as the pre-populated credit tender row in exchange drafts.

### Frontend — `services/api.ts`

`SalesReturnItemOut`, `SalesReturnOut`, `ExchangeResult` interfaces added. `salesApi.returns` object added:
- `list(params?)` — `GET /sales/returns` with all filter params
- `get(id)` — `GET /sales/returns/{id}`
- `create(p)` — `POST /sales/returns` (return-only)
- `exchange(p, opts?)` — `POST /sales/returns/exchange`
- `itemsForReturn(sale_id)` — `GET /sales/sale/{id}/items-for-return`

`SaleItemOut.already_returned?: number` added.

### Frontend — `lib/queryKeys.ts`

`salesReturns`, `salesReturn`, `saleItemsReturn` keys added.

### Frontend — new pages

**`pages/sales/Returns.tsx`** — RMA list at `/sales/returns`. Filter panel: keyword, date range, location, customer, Has Exchange checkbox. Table: Return PID, Date, Original Sale (clickable), Customer, Location, Return Total, Exchange Sale (clickable if exists), Reason. Summary total. XLSX export.

**`pages/sales/ReturnNew.tsx`** — Return processing at `/sales/returns/new?sale_id=X`. Loads original sale info + items via `itemsForReturn`. Pre-populates return quantities (defaults to full available qty; max enforced against `already_returned`). Reason text field. Two action buttons:
- **Return Only** → `POST /sales/returns`, navigates to `ReturnDetail`
- **Exchange →** → `POST /sales/returns/exchange`, navigates to workstation with exchange draft state (`loadDraftId`, `returnPid`, `returnCredit`)

**`pages/sales/ReturnDetail.tsx`** — read-only return detail. Header shows Return PID, Date, Grand Total, Reason, Original Sale (clickable → Sale Detail), Exchange Sale (clickable → Sale Detail when present). Line items table: Variant, PID, Qty Returned, Unit Price, Line Total.

### Frontend — updated pages

**`pages/sales/SaleDetail.tsx`** — "Return / Exchange" button added to the actions bar for Posted sales. Navigates to `/sales/returns/new?sale_id={id}`.

**`pages/Sales.tsx`** — "Returns" tab added to sub-nav alongside New Sale and Sales Ledger. Routes: `/returns` → Returns, `/returns/new` → ReturnNew, `/returns/:returnId` → ReturnDetail.

### Smoke tests

| Test | Result |
|---|---|
| `POST /sales/returns` on sale 56 (1 unit) | `RET-00003`, `grand_total=600.00`, `exchange_sale_pid=null` ✅ |
| `POST /sales/returns/exchange` on sale 55 (1 unit) | `RET-00004`, exchange draft `sale_id=57`, `origin_sale_id=55`, `status=Draft` ✅ |
| Store Credit payment mode | `payment_mode_id=7`, `is_physical=false`, `is_active=true` ✅ |

---

## 2026-06-04 — Backlog known gaps resolved (5 items)

### Gap 1 — Transfer FIFO under negative stock (`inventory/transfers_router.py`)

When `allow_negative_stock = true` and cost layers at the source were exhausted, `_consume_fifo` still raised HTTP 400 on the layer sufficiency check. Fix: when `allow_negative = True` and `available < qty`, all available layers are consumed normally, then a synthetic `(remaining_qty, Decimal("0"))` tuple is appended for the uncovered quantity. `_create_transfer_layers` uses this to create a zero-cost layer at the destination, ensuring the destination always receives matching FIFO coverage. The destination can sell or transfer the zero-cost stock immediately without further blocking.

### Gap 2 — Pre-policy `cost_source = NULL` backfill (migration `p8q9r0s1t2u3`)

`sale_items` rows created before the costing policy implementation carried `cost_source = NULL`. These were excluded from Known Profit in the Sales Ledger dashboard. Migration applied directly:

```sql
UPDATE sales.sale_items
SET cost_source = 'fifo'
WHERE cost_source IS NULL AND cost_layer_id IS NOT NULL;
```

**7 rows updated.** The 6 remaining NULL rows are Non-Inventory/Service or bundle-level items with no cost tracking — correctly left as NULL. Known Profit on the dashboard increased from ₱195,455 to ₱195,533 after the backfill.

### Gap 3 — Non-standard sale PIDs (won't fix)

Existing sales carry PIDs like `"12345"` and `"1453278"`. Renaming them would break the paper trail (they appear on physical receipts already issued). `GET /sales/next-pid` already ignores non-conforming PIDs correctly. Display in the Ledger is acceptable as-is. Closed as won't-fix.

### Gap 4 — CustomerDetail AR running balance (`pages/customers/CustomerDetail.tsx`)

The running balance column in the AR Ledger section was derived by iterating the descending list and capturing `outstanding_balance` without adjusting it, producing the same value for every row. Fixed: starting from `outstanding_balance` (the current state), each entry's `amount_change` is subtracted as we walk backwards through the descending list, yielding the true historical balance after each transaction.

```typescript
// Before (wrong — same balance on every row)
let runningBalance = customer.outstanding_balance
arLedger.map(row => ({ ...row, runningBalance }))

// After (correct — true historical cumulative)
let runningBalance = customer.outstanding_balance
arLedger.map(row => {
  const displayBalance = runningBalance
  runningBalance = runningBalance - row.amount_change
  return { ...row, runningBalance: displayBalance }
})
```

### Gap 5 — Old one-step `confirm_shipment` endpoint removed

**Backend (`procurement/router.py`):** `POST /shipments/{id}/confirm` replaced with a 410 Gone stub that directs callers to the two-stage workflow. The 186-line original function body was removed entirely. The new stub:

```python
raise HTTPException(status_code=410, detail="...use /receive then /confirm-costs...")
```

**Frontend (`pages/stock/ReceivingDetail.tsx`):** The page was calling `stockApi.shipments.confirm(sid)` via an editable reconciliation form — but the local edits (qty_actual, qty_rejected, qc_status) were never sent to the backend before confirming, making the form non-functional. Rewritten as a fully read-only view:
- Editable input fields removed
- `is_confirmed` status badge added to the header (`Confirmed` / `Pending` in green/amber)
- "Confirm Receipt" button replaced with "Confirm Costs →" (navigates to `ReceivingConfirm` for Stage 2) — shown only when `is_confirmed = false`
- Informational note shown when pending: "Stock has been received (Stage 1 complete). Click Confirm Costs to enter unit costs..."

---

## 2026-06-04 — requirements.md sync (v2.1)

Documentation-only update. No code changes. Brings requirements.md in line with all implemented behaviour since v2.0 was approved.

| Section | Change |
|---|---|
| **§6.5** Bundle Components | Added rule: bundle variants cannot be received or transferred directly; only component variants may appear in receiving/transfer forms. Rejection message specified. |
| **§9.1** Receiving Stock | Rewrote to describe the two-stage workflow. Stage 1 (`POST /shipments/{id}/receive`): ledger entries + stock update, no cost layers, `is_confirmed = false`, stock immediately available. Stage 2 (`POST /shipments/{id}/confirm-costs`): cost layers created at caller-supplied unit costs, supplier invoice + AP ledger written, `is_confirmed = true`. Stage 2 is encouraged but never mandatory. |
| **§9.3** FIFO Consumption | Split into transfers (hard-blocks on insufficient layers) and sales (three-level non-blocking fallback). Documented `cost_source` field: `'fifo'` → FIFO layer consumed; `'supplier_list'` → primary supplier record fallback; `'none'` → no cost data, flagged for review; `NULL` → pre-policy rows. Stated rule: a sale post must never be blocked by missing cost data. |
| **§9.8** Cost Layers | Clarified layers are created at Stage 2, not Stage 1. Added FIFO restoration note on sale void. |
| **§9.9** *(new)* System Policies | Documented `settings.system_settings` table and `allow_negative_stock` flag. When `'true'`: stock balance pre-flight check skipped in `post_draft` and `create_transfer`; `current_stocks.quantity` can go negative. Cost layer sufficiency checks in transfers unchanged. |
| **§13.2** Sale Line Items | Added `cost_source` to the cost snapshot. Documented all four values including `NULL` for pre-policy rows. |
| **§13.3** Sale Totals | Added `cart_discount_pct` and `cart_discount_flat` fields. Corrected `discount_amount` formula to show the two-step cart discount calculation. |
| **§16.6** Reading Sales | Updated `GET /sales/` to describe cursor pagination and `SalesListResponse`. Added `GET /sales/summary` (dashboard metrics) and `GET /sales/next-pid` (PID sequencing) endpoint entries. |
| **§17** Known Gaps | Added two entries: (1) transfer FIFO still blocks on depleted layers even when `allow_negative_stock = true`; (2) pre-policy `sale_items` rows with `cost_source = NULL` excluded from Known Profit calculations. |
| **§18.2** Session Header | Removed lock/unlock mechanic (fields always editable, values always persist). Added Customer field spec (optional, outstanding balance + credit limit shown as informational only, never enforced). Cashier specified as sourced from `GET /auth/employees` (`is_active = true`). Receipt No. updated to describe `GET /sales/next-pid` fetch on mount and after post. |
| **§18.6** Payment Tender | Added: first row auto-populates with Cash + Grand Total on new cart. Reference number shown only when `is_physical = false`. Balance due color coding documented. |

---

## 2026-06-04 — schema.dbml sync

Five drift corrections between the approved DBML and the actual database state. No code changes — documentation only.

| Table | Change |
|---|---|
| `products` | `name varchar` → `brand varchar` (migration `d1e2f3a4b5c6`) |
| `inventory_shipments` | Added `received_by_user_id`, `inspected_by_user_id`, `received_by_employee_id`, `inspected_by_employee_id`, `is_confirmed boolean [default: false]`; `shipment_pid` marked `[unique]` (migrations `h1i2j3k4l5m6`, `l4m5n6o7p8q9`) |
| `receiving_details` | Added `is_deleted boolean` |
| `inventory_transfers` | Added `released_by_employee_id`, `received_by_employee_id`, `status varchar`, `voided_at datetime`, `void_reason varchar` (migrations `j2k3l4m5n6o7`, `k3l4m5n6o7p8`) |
| `sale_items` | Added `cost_source varchar(20)` with note: `fifo \| supplier_list \| none \| null (pre-policy rows)` (migration `n6o7p8q9r0s1`) |

---

## 2026-06-04 — Sales Ledger dashboard + sale PID fix + ledger redirect fix

### Bug fix — Sale PID always reverting to SALE-00001

**Root cause:** The workstation derived the next PID by parsing `latestSales[0].sale_pid` with a regex. Most existing sales carry non-standard PIDs (e.g. `"12345"`, `"1453278"`); the regex failed to match and fell back to the hardcoded default on every mount.

**Fix — `GET /sales/next-pid` backend endpoint** (`sales/router.py`):
```sql
SELECT MAX(CAST(SUBSTRING(sale_pid FROM 6) AS INTEGER))
FROM sales.sales
WHERE sale_pid ~ '^SALE-[0-9]+$'
```
Returns `{"next_pid": "SALE-{n:05d}"}`. Defaults to `SALE-00001` when no conforming PIDs exist. Registered before the `/{sale_id}` wildcard.

**Fix — Workstation.tsx:**
- `useQuery` on `qk.nextSalePid()` replaces the latestSales derivation.
- `useEffect([nextPidData?.next_pid])` sets `header.salePID` when data arrives.
- `handlePost` invalidates `qk.nextSalePid()` after every successful post; the `useEffect` picks up the refreshed value automatically.
- `nextPID()` string-manipulation helper removed entirely.
- `salesApi.sales.nextPid()` added to `api.ts`. `qk.nextSalePid()` added to `queryKeys.ts`.

---

### Bug fix — Sales Ledger showing no rows

**Root cause:** `salesApi.sales.list` built the URL as `/sales?...` (no trailing slash). FastAPI returned a `307 Temporary Redirect` to `http://localhost/sales/?...`, stripping the `/api/` prefix. The browser followed the redirect to a path Nginx handled as the React SPA, returning `index.html` instead of API data.

All other collection endpoints in the codebase use a trailing slash (e.g. `/products/`). The sales list call was the only exception.

**Fix:** Changed URL from `` `/sales${qs ? '?' + qs : ''}` `` to `` `/sales/${qs ? '?' + qs : ''}` `` in `api.ts`. `GET /sales/` now returns HTTP 200 directly with all 14 sales.

---

### Sales Ledger dashboard — Revenue & Profit summary cards

Per `docs/sales_ledger_basic.md` Dashboard section.

#### Backend — `sales/schemas.py`

`SalesSummaryResponse` schema added:
```python
merchandise_gross, cart_discounts, non_merchandise_revenue, variances,
total_revenue, known_profit, partial_gross_sales, coverage_pct
```

#### Backend — `GET /sales/summary` (`sales/router.py`)

Accepts the same scope filter params as `GET /sales/` (date range, location, shift, register, cashier, customer, status). Computed server-side in five SQL passes:

1. **Base sale IDs** — filtered by status + all scope params.
2. **Merchandise gross, cart discounts, variances** — single aggregate `SELECT SUM(subtotal_amount), SUM(discount_amount), SUM(audit_variance)` on filtered sales.
3. **Non-merchandise revenue** — `SUM(sale_items.line_total)` joined through `variants → products` where `product_type IN ('Service', 'Non-Inventory')`.
4. **Known profit** — `SUM(line_total - COALESCE(net_unit_cost, 0) × quantity)` for line items belonging to fully-costed sales (no `cost_source = 'none'` items in that sale). `NOT IN` subquery excludes uncosted sale IDs.
5. **Partial gross sales + coverage** — `SUM(grand_total)` for sales containing any uncosted item; fully-costed revenue divided by total_revenue for `coverage_pct`.

`sqlalchemy.sql.func` import added to the router.

Registered before the `/{sale_id}` wildcard to avoid route shadowing.

#### Frontend — `api.ts`

`SalesSummaryResponse` interface added. `salesApi.sales.summary(params)` method added — builds query string from scope params, calls `GET /sales/summary`.

#### Frontend — `queryKeys.ts`

`salesSummary: (filters?) => ['sales', 'summary', filters]` key added.

#### Frontend — `SalesLedger.tsx` (layout + dashboard)

**Layout change:** Outer container changed from `flex` to `flex-col`. Dashboard section (`shrink-0`) sits above the filter+table flex row (`flex-1 min-h-0`).

**Two `params` memos:**
- `scopeParams` — date, location, shift, register, cashier, customer, status. Drives both the summary query and the base of the table query. Changing a scope filter updates the dashboard and the table simultaneously.
- `tableParams` — extends `scopeParams` with `search`, `payment_status`, `has_variance`, `has_uncosted`, `limit`. Keyword search narrows the table without changing dashboard totals (dashboard reflects the full scope, not the keyword-filtered subset).

**Revenue row (5 cards):**
- Merchandise Gross — `subtotal_amount` sum
- Cart Discounts — `discount_amount` sum, shown as negative, red when > 0
- Non-Merch Revenue — services and fees
- Variances — net variance, green when positive, red when negative
- **Total Revenue** — primary highlighted card with accent border ring; green/red based on sign

**Profit row (2 cards + indicator):**
- Known Gross Profit — emerald when positive, fully costed sales only
- Uncosted Sale Revenue — amber, flagged with "Profit unknown — missing costs"
- Coverage bar — labelled `X% of revenue costed`; fill color: ≥90% green, ≥50% amber, <50% red

**Skeleton loaders** — `SkeletonCard` component shown for each card position while `summaryLoading`.

**Live values confirmed against DB:**
`merchandise_gross=₱602,809 · cart_discounts=₱24.90 · total_revenue=₱602,741 · known_profit=₱195,455 · coverage_pct=100.0%`

---

## 2026-06-04 — Auditor Workstation, Customers & AR, Sales Ledger, global numeric input

### 1. Auditor Workstation (`sales/Workstation.tsx`)

**Lock/unlock removed.** `locked` field removed from `SessionHeader`. All header fields are always live dropdowns. Values persist between transactions and do not reset after posting.

**Cashier dropdown** now sources from `GET /auth/employees` (`authApi.employees.list`) filtered to `is_active = true`. Replaces the previous users-based dropdown.

**Customer search field** added to the session header. Debounced 300ms search against `GET /sales/customers`. Selecting a customer shows their outstanding balance and credit limit as informational read-only text below the field. `customer_id` is included in draft and post payloads. `clearCustomer()` resets to walk-in.

**Promo price indicators:**
- *Search panel cards*: order corrected per spec — strikethrough original price first (`~~₱120~~`), highlighted promo price second (`₱95`).
- *Basket row Unit Price cell*: when `isPromoPrice` is true, cell gets a `bg-red-950/40` background tint and a small `PROMO` label above the input. Price value is displayed in `text-red-400`.

**Tender section — Cash auto-populate.** On new cart initialization (when grand total changes and the first tender row is empty), the first row is automatically set to Cash payment mode + Grand Total amount.

**Reference Number conditional visibility.** Reference Number input is rendered only when the selected payment mode has `is_physical = false`. Hidden for Cash and other physical modes.

**ui_standards §10 — onFocus select.** All numeric inputs in the basket grid (qty, unit price, disc %, disc ₱), footer (cart disc %, cart disc ₱, receipt total), and tender amounts have `onFocus={onFocusSelect}`.

---

### 2. Customers & AR module

#### Backend — `sales/router.py` + `sales/schemas.py`

New schemas: `ArLedgerOut`, `RecordPaymentIn`, `SaleTotals`, `SalesListResponse`.

`SaleOut` gains `payments: List[CustomerPaymentOut] = []`. `_load_sale` now eager-loads `payments_applied → payment` and attaches `sale.payments`.

New endpoints:
- `GET /sales/customers/{id}/ar-ledger` — customer AR ledger with date/reason/cursor filters
- `GET /sales/customers/{id}/sales` — sales history for a customer, cursor-paginated
- `GET /sales/customers/{id}/payments` — payment history for a customer, cursor-paginated
- `POST /sales/customers/{id}/payment` — standalone customer payment (no required sale application); writes `customer_payments` row, `ar_ledger` PAYMENT entry, updates `outstanding_balance`
- `GET /sales/ar-ledger` — global AR ledger across all customers with customer/reason/date/cursor filters

#### Frontend — `services/api.ts`

New types: `CustomerPaymentOut`, `ArLedgerOut`, `CustomerOut`, `SaleTotals`, `SalesListResponse`. `SaleOut` updated with `customer_id`, `created_by_user_id`, `payments`. `SaleItemOut` updated with `cost_source`.

`salesApi.sales.list` now returns `SalesListResponse` and accepts `has_variance`, `has_uncosted`, `customer_id`, `cursor`, `limit` params. `salesApi.sales.void` added. `salesApi.customers` and `salesApi.arLedger` objects added.

#### Frontend — New pages

**`pages/customers/CustomerList.tsx`** — filter panel (keyword, status, balance), sortable table (name, terms, credit limit, outstanding balance, status), + New Customer modal (name, credit limit, terms days), XLSX export.

**`pages/customers/CustomerDetail.tsx`** — inline-editable header (name, credit limit, terms), AR Ledger section with running balance column, Sales History, Payments sections, Record Payment modal (payment mode, amount, conditional ref number), Deactivate/Reactivate action, New Sale link.

**`pages/customers/CustomerARLedger.tsx`** — global AR ledger view; filter panel (keyword, customer dropdown, type multi-select, date range); clickable sale/customer references navigate to detail pages; XLSX export.

**`pages/Customers.tsx`** — replaced stub with routing shell; two tabs (Customers, AR Ledger); routes to CustomerList, CustomerDetail, CustomerARLedger.

---

### 3. Sales Ledger

#### Backend — `GET /sales/`

`has_variance: bool = False` — filters to sales where `audit_variance != 0`.
`has_uncosted: bool = False` — filters to sales with any `sale_item.cost_source = 'none'`.
Cursor pagination via `cursor` (sale_id) + `limit` params.
Response changed from `List[SaleOut]` to `SalesListResponse` — includes `items`, `totals` (count, subtotal, discount, grand_total, receipt_total, variance), and `next_cursor`. Totals computed from the full filtered set before pagination.

#### Frontend — `pages/sales/SalesLedger.tsx` (rewrite)

New filters: Cashier (employee dropdown), Customer (dropdown), Has Variance checkbox, Has Uncosted Items checkbox. Filter panel now uses `employees` list from `authApi.employees.list`. Customer names resolved from `salesApi.customers.list`. Cashier names resolved from `authApi.employees.list`.

Pinned **summary row** in `<tfoot>` showing totals from `resp.totals`: count, subtotal, discount, grand total, receipt total, variance — always visible at the bottom of the filtered set.

#### Frontend — `pages/sales/SaleDetail.tsx` (rewrite)

Full header with all fields: Sale PID, Date, Status, Payment Status, Shift, Location, Register, Cashier, Customer (clickable → Customer Detail), Subtotal, Cart Disc, Discount, Grand Total, Balance Due, Receipt Total, Variance, Created By, Void Reason.

**Line items table** adds Net Unit Cost column and **cost_source badges**: `fifo` → neutral "FIFO", `supplier_list` → muted "List Price", `none` → warning yellow "No Cost".

**Tender section** shows all `sale.payments` rows: Payment Mode (name resolved), Amount, Reference Number.

**Void action** — Void button (Posted only) opens confirmation modal with void reason textarea and warning. Calls `salesApi.sales.void(id, reason)`, invalidates queries.

**Export XLSX** — header + line items + cost data as single-file export.

---

### 4. Global numeric input (ui_standards §10)

`frontend/src/main.tsx` — global `focusin` event listener added before first render:
```typescript
document.addEventListener('focusin', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number') {
    e.target.select()
  }
})
```
Applies to every `<input type="number">` across the entire app — inventory Detail, Settings, Transfer, Receiving, Workstation, Customer pages, and all future numeric fields — without requiring per-field `onFocus` props.

Individual `onFocus={onFocusSelect}` props retained only on fields in components where local declaration predated the global rule (TransferNew, ReceivingNew, Workstation — for explicitness).

---

## 2026-06-04 — Bundle stock policy (search blocking, computed stock, sale location confirmation)

### 1. Bundle variants blocked from Transfer and Receiving item search

**`frontend/src/pages/stock/TransferNew.tsx`** and **`frontend/src/pages/stock/ReceivingNew.tsx`**

In both forms' `searchResults` useMemo, variants where `bundle_components.length > 0` are now skipped before any keyword matching. Bundle variants never appear in the item search panel — only base/component variants can be received or transferred.

In the XLSX import handler of both forms, after a PID match is found the variant is checked for bundle status. If the variant is a bundle, the row is rejected with an inline error chip:

```
{PID} is a bundle variant — receive or transfer its components individually.
```

The error is surfaced via the existing `importErrs` state, displayed as an inline chip alongside other import errors below the line-item grid.

### 2. Computed available bundle count — backend and frontend

#### Backend — `inventory/schemas.py`

`BundleAvailableStock` schema added:
```python
class BundleAvailableStock(BaseModel):
    location_id:   int
    location_name: str
    available:     int
```

`bundle_available_stock: List[BundleAvailableStock] = []` added to `VariantOut`. Defaults to `[]` for non-bundle variants; populated by the enrichment step for bundle variants.

#### Backend — `inventory/router.py`

**`_compute_bundle_available(variant)`** — helper that computes available bundle counts per physical location:
- Collects all physical location_ids from every component variant's `current_stock`
- For each location: `min(floor(comp_stock / comp_qty))` across all components (Requirements §6.5)
- Returns a list of `{location_id, location_name, available}` dicts for all physical locations (including 0-available locations so per-location columns render correctly)

**`_enrich_bundle_stock(products)`** — iterates all loaded products and sets `variant.bundle_available_stock` as a Python attribute on each bundle variant ORM instance before Pydantic serialization. Non-bundle variants receive `[]`.

**selectinload chain extended** in `list_products`:
```python
selectinload(models.Product.variants)
    .selectinload(models.Variant.bundle_components)
    .selectinload(models.BundleComponent.component_variant)
    .selectinload(models.Variant.current_stock)   # NEW
    .selectinload(models.CurrentStock.location)    # NEW
```

`_enrich_bundle_stock(products)` called after `q.all()`, before sorting and returning.

#### Frontend — `services/api.ts`

`BundleAvailableStock` interface added. `bundle_available_stock: BundleAvailableStock[]` field added to `InvVariant`.

#### Frontend — `Catalogue.tsx`

**`bundleTotalStock(v)`** — sums `available` across all entries in `bundle_available_stock`.

**`bundleStockAtLoc(v, locId)`** — finds the per-location available count from `bundle_available_stock`.

**`BundleStockCell`** — new component rendering computed stock with:
- `~N` prefix (tilde signals derived value)
- Amber text color to distinguish from physical inventory counts
- Dotted amber underline with hover tooltip: "Computed stock — Available bundles derived from component stock. Not physical inventory of this variant."

**`buildRows`** updated: for bundle variants (`bundle_components.length > 0`), `totalStock` uses `bundleTotalStock(v)` instead of `physicalStock(v)`. `isBundle: boolean` added to the `Row` interface.

**Table body** updated: Total Stock cell and per-location cells check `isBundle` and render `BundleStockCell` instead of `UomStockCell` for bundle rows. `physicalStock(bundle)` is always 0 — it is no longer called for bundle variants.

### 3. Bundle deduction location confirmed (smoke test)

Code review of `sales/router.py` `post_draft` confirms all three component-level deduction sites use `sale.location_id`:
- `_consume_fifo_for_sale(db, comp.component_variant_id, sale.location_id, comp_qty, ...)`
- `InventoryLedger(... location_id=sale.location_id ...)`
- `_upsert_stock(db, comp.component_variant_id, sale.location_id, -comp_qty)`

**Smoke test — sale_id=49, location_id=3 (Atrium)**

Bundle: `SMOKE-BUNDLE` (variant_id=17), components: `SMOKE-COMP-A` (×3) and `SMOKE-COMP-B` (×2). Sold 1 bundle.

Component stocks before:

| Variant | Location | Qty Before |
|---|---|---|
| SMOKE-COMP-A (15) | Atrium | 44.0000 |
| SMOKE-COMP-B (16) | Atrium | 36.0000 |

Ledger entries written (raw DB):

| ledger_id | PID | location_name | qty_change | reason |
|---|---|---|---|---|
| 65 | SMOKE-COMP-A | Atrium | −3.0000 | SALE |
| 66 | SMOKE-COMP-B | Atrium | −2.0000 | SALE |

Component stocks after: SMOKE-COMP-A @ Atrium = 41, SMOKE-COMP-B @ Atrium = 34. No other location was touched. Deduction is correctly scoped to `sale.location_id` only.

**bundle_available_stock API response after sale:**
- `SMOKE-BUNDLE`: `[{location_id: 3, location_name: "Atrium", available: 13}]`
  — `min(floor(41/3), floor(34/2)) = min(13, 17) = 13` ✅
- `CCC0049`: `[{location_id: 3, available: 31}, {location_id: 4, available: 31}]`
  — `floor(186/6) = 31` at Atrium, `floor(189/6) = 31` at Bredco ✅

---

## 2026-06-03 — Allow Negative Stock policy (inventory_policy.md implementation)

### Migration — `o7p8q9r0s1t2`

Creates the `settings` schema and `system_settings` table, then seeds the initial policy row:

```sql
CREATE SCHEMA IF NOT EXISTS settings;
CREATE TABLE settings.system_settings (
    key                VARCHAR PRIMARY KEY,
    value              VARCHAR NOT NULL,
    updated_at         TIMESTAMPTZ,
    updated_by_user_id INTEGER REFERENCES auth.users(user_id)
);
INSERT INTO settings.system_settings (key, value) VALUES ('allow_negative_stock', 'false')
ON CONFLICT (key) DO NOTHING;
```

Applied directly to the running DB; also registered in `alembic_version`.

### New module — `settings/`

- **`settings/models.py`** — `SystemSetting` ORM model (`settings.system_settings`). Includes `updated_by` relationship to `auth.users`.
- **`settings/schemas.py`** — `InventoryPolicyOut` (read response with `allow_negative_stock`, `updated_at`, `updated_by_user_id`, `updated_by_username`) and `InventoryPolicyPatch` (write payload).
- **`settings/router.py`** — two endpoints under `/settings`:
  - `GET /settings/inventory-policy` — returns current policy state. Open to any authenticated user.
  - `PATCH /settings/inventory-policy` — updates `allow_negative_stock`, stamps `updated_at` and `updated_by_user_id`. Requires `manage_inventory_policy` permission.

### `auth/dependencies.py`

`manage_inventory_policy` permission added to ADMIN, WAREHOUSE_MANAGER, and STORE_MANAGER.

### `main.py`

- `settings` schema added to startup schema-creation block.
- `settings.models` imported in model-registration block (FK resolution order: auth → inventory → procurement → ap → sales → settings).
- `settings_router` mounted at `/settings`.
- `_seed_system_settings()` added — idempotently inserts `allow_negative_stock = 'false'` if the row does not exist.

### `sales/router.py` — post_draft

`_get_allow_negative_stock(db)` helper added (reads `SystemSetting` where `key='allow_negative_stock'`; returns `False` if row is absent). Called once at the start of `post_draft` before the item loop. Result passed as `allow_negative=allow_negative` to both `_consume_fifo_for_sale` call sites (regular inventory path and bundle-component path).

`_consume_fifo_for_sale` gains an `allow_negative: bool = False` parameter. When `True`, the `available_stock < qty` guard is skipped entirely; stock deduction proceeds and `current_stocks.quantity` can go negative.

### `inventory/transfers_router.py` — create_transfer

Same pattern: `_get_allow_negative_stock(db)` called once at the start of `create_transfer`. `allow_negative` threaded through:

- `_consume_fifo(... allow_negative=allow_negative)` — stock-balance guard skipped when `True`.
- `_move_variant(... allow_negative=allow_negative)` — passes through to `_consume_fifo`.
- Both the direct-variant and bundle-component `_move_variant` calls in `create_transfer` receive the flag.

The cost-layer sufficiency check in `_consume_fifo` is **not** skipped (only the stock-balance check is bypassed per spec). Void transfers do not receive the flag — reversals restore stock and should not allow further negative drift.

### `inventory/router.py` — GET /products/

Two new optional query parameters:

- `negative_stock: bool = False` — when `true`, filters to products that have at least one non-deleted variant with `current_stocks.quantity < 0` at a physical (non-Virtual) location. Implemented as a SQL subquery: `Variant → CurrentStock JOIN Location WHERE quantity < 0 AND location_type != 'Virtual'`.
- `sort_by: str` / `sort_dir: str` — when `sort_by='total_stock'`, products are sorted after loading by the sum of all non-deleted variants' physical stock. `sort_dir='asc'` (default) or `'desc'`.

### Frontend — `services/api.ts`

`InventoryPolicy` interface added (`allow_negative_stock`, `updated_at`, `updated_by_user_id`, `updated_by_username`). `settingsApi` object added with `inventoryPolicy.get()` and `inventoryPolicy.patch()`.

### Frontend — `lib/queryKeys.ts`

`inventoryPolicy: () => ['inventoryPolicy']` key added.

### Frontend — `Settings.tsx`

`'Inventory Policy'` tab added to `TABS` after `'Appearance'`. `InventoryPolicyTab` component:
- Fetches current policy via `settingsApi.inventoryPolicy.get()` with `stale.reference` (10 min).
- Toggle switch immediately calls `settingsApi.inventoryPolicy.patch()` and invalidates the query.
- Displays label, description, On/Off badge, and last-updated timestamp + username below the toggle.
- While saving, toggle is disabled (`opacity-50`).
- Amber badge when On; green badge when Off (visual warning that negative stock is enabled).

### Frontend — `Catalogue.tsx`

**Total Stock — sortable**

`SortKey` type extended to include `'totalStock'`. `sortRows` handles numeric comparison for this key (`a.totalStock - b.totalStock`). Total Stock `<th>` replaced with `<SortTh k="totalStock" label="Total Stock" right />` — click cycles asc → desc → off.

**Per-location stock columns — sortable**

`SortKey` extended to include `` `loc_${number}` `` template literal. `sortRows` handles numeric comparison: `stockAtLoc(a.variant, locId) - stockAtLoc(b.variant, locId)`. Per-location `<th>` cells converted from static to click-sortable inline headers (preserves `t-text-4 italic` styling for virtual locations).

**Negative Stock filter**

`negativeStock: boolean` state added. When `true`, `filteredRows` memo excludes any variant where no physical location has `current_stocks.quantity < 0`. "Negative Stock" checkbox added to the filter panel under the Status section. Dependency added to the `filteredRows` `useMemo`.

---

## 2026-06-03 — Non-blocking FIFO fallback + cost_source (costing policy implementation)

### Background
`docs/costing_policy.md` defines a three-level cost resolution hierarchy for sale posting. The system was previously blocking sales with an HTTP 400 when cost layers were missing — violating the policy's critical rule that a sale post must never be blocked by missing cost data.

A live data investigation also identified that shipment SHP-000006 had completed Stage 1 (`/receive`) but Stage 2 (`/confirm-costs`) was never called, leaving variants 14, 18, and 19 with stock but zero cost layers.

### Data fix — SHP-000006 cost layers

`POST /procurement/shipments/6/confirm-costs` called with `unit_cost=0` for detail_id 8 (variant 14, 720 units, location 4). This set `is_confirmed=true` on the shipment and created cost layer `layer_id=29`.

Variants 18 and 19 were not included in the `confirm-costs` payload (endpoint only processes supplied detail_ids). Since the shipment was already `is_confirmed=true`, those two cost layers were inserted directly:

| layer_id | variant_id | location_id | original_qty | quantity_remaining | net_unit_cost |
|---|---|---|---|---|---|
| 29 | 14 | 4 | 720.0000 | 720.0000 | 0.00 |
| 30 | 18 | 4 | 720.0000 | 720.0000 | 0.00 |
| 31 | 19 | 4 | 360.0000 | 360.0000 | 0.00 |

### Migration — `n6o7p8q9r0s1`

```sql
ALTER TABLE sales.sale_items ADD COLUMN IF NOT EXISTS cost_source VARCHAR(20);
```

Existing rows receive `NULL` (pre-policy records). Applied directly to the running DB and recorded in `alembic_version`.

### Backend changes

**`sales/models.py`**
- `SaleItem`: `cost_source = Column(String(20), nullable=True)` added after `net_unit_cost`. Values: `'fifo'` | `'supplier_list'` | `'none'`.

**`sales/schemas.py`**
- `SaleItemOut`: `cost_source: Optional[str] = None` added.

**`sales/router.py` — `_consume_fifo_for_sale`**

Return type changed from `list[tuple[int, Decimal, Decimal, Decimal, Decimal]]` to `list[tuple[int | None, Decimal, Decimal, Decimal, Decimal, str]]` (6-tuple; last element is `cost_source`). The blocking "Insufficient cost layers" error removed. Three-level resolution now implemented:

- **Level 1 — FIFO** (`cost_source='fifo'`): cost layers exist covering the full quantity → consume oldest-first as before.
- **Level 2 — Supplier list** (`cost_source='supplier_list'`): no covering layers, but a primary `variant_suppliers` record exists → `net = gross × (1 − disc/100)`, `cost_layer_id=NULL`, full qty in one tuple.
- **Level 3 — No data** (`cost_source='none'`): no layers and no supplier link → `net_unit_cost=0`, `cost_layer_id=NULL`.

Only insufficient *stock* still raises HTTP 400. Cost data absence never blocks the post.

**`sales/router.py` — `post_draft`**

Unpacking updated from 5-tuple to 6-tuple:
```python
for layer_id, qty_taken, gross_cost, supplier_discount, net_cost, cost_source in splits:
```
`cost_source=cost_source` added to the `SaleItem(...)` constructor.

**`sales/router.py` — `_collapse_items` (bug fix)**

`_collapse_items` was constructing `SaleItemOut` manually without forwarding `cost_source`, causing the API response to show `null` even though the DB value was correct. Fixed by adding `cost_source=first.cost_source` to the collapsed row.

### Smoke test results

| sale_id | sale_item_id | variant_id | cost_layer_id | quantity | gross_cost | supplier_discount | net_unit_cost | cost_source |
|---|---|---|---|---|---|---|---|---|
| 19 | 22 | 2 | NULL | 1.0000 | 50.00 | 10.00 | 45.00 | supplier_list |
| 20 | 24 | 2 | NULL | 1.0000 | 0.00 | 0.00 | 0.00 | none |

**Test A (Level 2):** variant 2 at location 1, no cost layers, primary supplier with `gross_cost=50, supplier_discount=10`. Posted successfully. `cost_source='supplier_list'`, `net_unit_cost=45.00` (50 × 0.90). ✅

**Test B (Level 3):** variant 2 at location 1, no cost layers, no supplier link. Posted successfully. `cost_source='none'`, `net_unit_cost=0.00`. ✅

Both tests also confirm the API response now correctly surfaces `cost_source` (the `_collapse_items` bug fix).

---

## 2026-06-03 — Bundle component stock deduction on sale post (smoke-tested)

### Verification
Confirmed that `sales/router.py` `post_draft` already correctly implements bundle explosion per Requirements §6.5 and §13.4. No code changes were required — the logic was wired in the Sales Batch 6 implementation.

**Bundle behaviour (lines 841–880 of `sales/router.py`):**
- When a sale item's variant has rows in `bundle_components`, the bundle variant's own stock is never touched.
- Each component's quantity deducted = `sale_qty × component.quantity`.
- `_consume_fifo_for_sale` is called per component — FIFO layers consumed at the sale location.
- One `InventoryLedger` entry (reason `SALE`, negative `qty_change`) written per component, referencing the sale's `sale_id`.
- `current_stocks` upserted per component in the same transaction.
- One `SaleItem` row written at the bundle level (revenue at bundle price, `cost_layer_id = NULL`, no cost snapshot).

### Smoke test results — Sale `SALE-00014`

**Setup:** Bundle variant `SMOKE-BUNDLE` (variant_id=17) with two components — `SMOKE-COMP-A` (variant_id=15, qty=3 per bundle) and `SMOKE-COMP-B` (variant_id=16, qty=2 per bundle). Each component seeded with stock and a FIFO cost layer at Atrium (location_id=3). Sale of **2 bundle units** posted.

**Check 1 — No stock row for the bundle variant:**
`SMOKE-BUNDLE` has no `current_stocks` row at location 3 — correct; bundles hold no physical stock.

**Check 2 — Component deductions correct:**

| Variant | Pre-sale | Post-sale | Deducted | Expected |
|---|---|---|---|---|
| SMOKE-COMP-A (×3) | 50.0000 | 44.0000 | −6.0000 | 2×3=6 ✅ |
| SMOKE-COMP-B (×2) | 40.0000 | 36.0000 | −4.0000 | 2×2=4 ✅ |

**Check 3 — `inventory_ledger` entries (raw DB values):**

| ledger_id | PID | qty_change | reason | reference_id |
|---|---|---|---|---|
| 40 | SMOKE-COMP-A | −6.0000 | SALE | 14 |
| 41 | SMOKE-COMP-B | −4.0000 | SALE | 14 |

No ledger entry written for SMOKE-BUNDLE. ✅

**Check 4 — FIFO cost layers consumed:**

| layer_id | Variant | original_qty | qty_remaining | Consumed |
|---|---|---|---|---|
| 27 | SMOKE-COMP-A | 50.0000 | 44.0000 | 6 ✅ |
| 28 | SMOKE-COMP-B | 40.0000 | 36.0000 | 4 ✅ |

**Check 5 — `sale_items` row:** One row for `SMOKE-BUNDLE` (qty=2, unit_price=200.00, line_total=400.00, `cost_layer_id=NULL`). Revenue captured at bundle level only. ✅

---

## 2026-06-02 — Stock Movement Fix Batch (9 fixes)

**Fix 1 — Transfer Detail line items**: `_load_transfer` now eager-loads `items→variant→product`. `TransferItemOut` schema adds `variant: VariantWithProductRef`. Line items now render with Brand, Variant, PID, SKU in the Transfer Detail page.

**Fix 2 — Transfer employee tracking**: Migration `k3l4m5n6o7p8` adds `released_by_employee_id` and `received_by_employee_id` (FK→`auth.employees`) to `inventory_transfers`. ORM, schema, and router updated. `TransferNew` form shows Released By / Received By employee dropdowns (active employees only). `TransferDetail` header displays both employee full names.

**Fix 3 — Transfer XLSX import upload**: `TransferNew` now has a file `<input>` alongside Download Template. Parses XLSX, matches by PID, appends matched lines to the grid with Bundle Count mechanic. Unrecognised PIDs shown as inline error chips.

**Fix 4 — Receiving XLSX import**: Same pattern added to `ReceivingNew`. Template headers changed to `PID, variant_name, qty_received` per spec. Unrecognised PID error chips.

**Fix 5 — Two-stage receiving**: New backend endpoints: `POST /procurement/shipments/{id}/receive` (Stage 1 — writes RECEIVE ledger entries, no cost layers) and `POST /procurement/shipments/{id}/confirm-costs` (Stage 2 — creates FIFO cost layers at user-supplied unit costs, updates `variant_suppliers.gross_cost`, creates invoice + AP entry, marks `is_confirmed=True`). `ReceivingNew` now calls `receive` instead of `confirm`. New `ReceivingConfirm.tsx` page at `/stock/receiving/:id/confirm`. `Receiving.tsx` overview: status now derived from `is_confirmed` field; "Confirm Costs" button shown for Pending Confirmation shipments.

**Fix 6 — Receiving details visible**: `_load_shipment` and `list_shipments` now eager-load `receiving_details→variant→product`. `ReceivingDetailOut` schema adds `variant: VariantWithProductRef`. Detail variant data now appears in the Shipment Detail page.

**Fix 7 — Inventory Ledger**: Complete rewrite of `Ledger.tsx`. Root bugs: state vars referenced before declaration, `entries` vs `allEntries` mismatch. Fixed state declaration order, derived `filterParams` via `useMemo`, separated filter-reset effect from page-accumulation effect. All filters (reason, location, date range, keyword) and Load More pagination now work correctly.

**Fix 8 — PID leftmost on all templates**: `TEMPLATE_COLS` in `NewProduct.tsx` reordered so `PID` is the first column (was position 6). All other templates already had PID first. Example row updated accordingly.

**Fix 9 — Receiving employee fields**: Migration `l4m5n6o7p8q9` adds `received_by_employee_id`, `inspected_by_employee_id` (FK→`auth.employees`), and `is_confirmed BOOLEAN` to `procurement.inventory_shipments`. ORM and schemas updated. `ReceivingNew` now uses employee dropdown for Received By (removed user dropdown). `ReceivingConfirm` has Inspected By employee dropdown.

## 2026-06-02 — Supplier Management, Sales Ledger, Transfer Enhancements

### supplier_code anchor
- **Migration** `i1j2k3l4m5n6`: adds `supplier_code VARCHAR(100) UNIQUE NOT NULL` to `inventory.suppliers`. Existing rows receive auto-generated codes (`SUP-00001`).
- **ORM** (`inventory/models.py`): `supplier_code` field added to `Supplier`.
- **Schemas** (`inventory/schemas.py`): `supplier_code` added to `SupplierCreate` (required), `SupplierOut`, and `SupplierRefOut`. New `SupplierPatch` schema supports deactivate/reactivate.
- **Router** (`inventory/router.py`): `GET /products/suppliers/all` accepts `include_deleted` query param. `POST /products/suppliers` validates unique code. New `PATCH /products/suppliers/{id}` handles deactivate (is_deleted=true) and reactivate (is_deleted=false) without touching supplier_code.
- **Sheet 3 import**: anchor changed from `supplier_name` to `supplier_code` in `NewProduct.tsx` and the XLSX template. All supplier dropdowns now filter `is_deleted=true` suppliers system-wide.

### Suppliers page (`/procurement/suppliers`)
- `Procurement.tsx` converted from stub to sub-nav shell (Suppliers + Purchase Orders).
- New `procurement/Suppliers.tsx`: full CRUD table, Active/Inactive/Both status toggle, create modal (supplier_code required), edit modal (supplier_code read-only), deactivate/reactivate inline.
- `procurement/PurchaseOrders.tsx`: placeholder stub.

### Transfer void + status
- **Migration** `j2k3l4m5n6o7`: adds `status VARCHAR(20) DEFAULT 'Posted'`, `voided_at`, and `void_reason` to `inventory.inventory_transfers`.
- **ORM + schema**: `InventoryTransfer` and `TransferOut` updated with new fields.
- **Router** (`transfers_router.py`): `POST /transfers/{id}/void` reverses all stock movements and marks transfer Voided.
- **Frontend**: `TransferNew.tsx` filters virtual locations from dropdowns, adds Requested By user dropdown. `Transfers.tsx` adds status + date range filters and Status column. `TransferDetail.tsx` adds Void button with confirmation modal.

### Sales Ledger (`/sales/ledger`)
- **Backend**: `GET /sales/` updated with `shift_id`, `register_id`, `status`, and `search` filter params.
- **Frontend** `Sales.tsx`: sub-nav added (New Sale, Sales Ledger). New `sales/SalesLedger.tsx`: full filter panel (keyword, date range, location, shift, register, sale status, payment status) + XLSX export. New `sales/SaleDetail.tsx`: drill-down view of a single sale with header and line items.

## 2026-06-02 — Receiving: consolidated single-form workflow

### Problem
The receiving module had a 3-step multi-page flow (Declaration → Count → Reconcile) that was also broken: `addDetails` was sending a single dict instead of the required list, and QC Status was hardcoded to `"Pending"` so the confirm step always failed with "No passing receiving details."

### Backend changes

**`backend/alembic/versions/h1i2j3k4l5m6_shipment_received_inspected_by.py`** — migration adding `received_by_user_id` and `inspected_by_user_id` (nullable `INTEGER REFERENCES auth.users`) to `procurement.inventory_shipments`. Applied directly to running DB.

**`backend/procurement/models.py`** — `InventoryShipment` model updated with both new FK columns.

**`backend/procurement/schemas.py`** — `ShipmentCreate` and `ShipmentOut` updated to include `received_by_user_id` and `inspected_by_user_id`.

**`backend/procurement/router.py`** — `create_shipment` persists both user IDs from the request payload.

The `confirm_shipment` endpoint required no changes — it already correctly routes accepted qty to the destination location and rejected qty to Quarantine, all in a single transaction.

### Frontend changes

**`frontend/src/services/api.ts`**
- `Shipment` interface: added `received_by_user_id` and `inspected_by_user_id`
- `stockApi.shipments.addDetails`: fixed the API signature bug — now sends a `Record<string, unknown>[]` (array) to match the backend's `List[ReceivingDetailCreate]` expectation. Previous implementation was sending a single dict which caused 422 errors on every call.

**`frontend/src/pages/stock/ReceivingNew.tsx`** — complete rewrite implementing the single-form flow:

- **Header fields:** Supplier *, Document ID, PO Link, Date Received *, Destination Location *, Received By (user dropdown), Inspected By (user dropdown)
- **Line item grid columns:** Brand, Variant, PID, Bundle Count (with `× factor` label, only shown when warehouse bundle conversion exists), Qty Declared, Qty Actual, Qty Rejected, QC Status, remove (×)
- **Bundle Count mechanic:** Bundle Count ↔ Qty Declared linked via `is_warehouse_bundle` conversion per ui_standards §8. Qty Actual auto-fills from Qty Declared when declared changes. Changing Qty Actual or Qty Rejected auto-adjusts QC Status: 0 rejected → Passed; some rejected → Partially_Passed; all rejected → Failed.
- **Qty Rejected:** stored as `quantity_rejected` — units automatically routed to Quarantine virtual location by the confirm endpoint. An informational note appears below the grid when any line has rejected qty.
- **Post Receiving action:** three backend calls in sequence — `POST /procurement/shipments` (create header) → `POST /procurement/shipments/{id}/details` (batch add all details in one call) → `POST /procurement/shipments/{id}/confirm` (write all ledger entries, cost layers, AP invoice). Error at any step is surfaced inline. On success, navigates to Receiving Overview.
- **Download Template:** updated headers to `PID, variant_name, qty_declared, qty_actual, qty_rejected, qc_status`.
- No separate Warehouse Count or Reconciliation step. `ReceivingDetail.tsx` remains as a read-only view of completed shipments.

### Smoke test results

Shipment SHP-000002 posted with 2 line items:

| PID | Qty Declared | Qty Actual | Qty Rejected | QC Status |
|---|---|---|---|---|
| MLD0027 | 48 | 46 | 2 | Partially_Passed |
| MLD0027-1 | 24 | 24 | 0 | Passed |

**Ledger entries written (3):**
- MLD0027 → Atrium: +44.00 RECEIVE (46 actual - 2 rejected)
- MLD0027 → Quarantine: +2.00 RECEIVE (rejected units)
- MLD0027-1 → Atrium: +24.00 RECEIVE

**Current stock after confirm:**
- MLD0027 @ Atrium: 44.00
- MLD0027 @ Quarantine: 2.00
- MLD0027-1 @ Atrium: 24.00

`received_by_user_id = 3`, `inspected_by_user_id = 3` confirmed on shipment record.

---

## 2026-06-02 — Catalogue polish, alternating rows, multi-sheet import template

### Grand Table — Catalogue.tsx

- **PROMO badge removed** from Promo Price column. Column now shows the price value only (`—` when none). No visual indicator.
- **Default badge removed** from Variant Name column. Default variant rows retain their `font-semibold` weight emphasis as the only visual distinction.
- **Column headers** — all `<th>` elements upgraded to `font-bold t-text-2` (up from `font-medium t-text-3`). Headers are now clearly heavier and brighter than data rows. Sort indicator characters (↕↑↓) retained.
- **Column width stability** — `whitespace-nowrap` applied to all `<td>` cells. Brand and Variant Name cells get `max-w-*` + `truncate` to prevent variable-length text from reflowing adjacent columns. Price, Promo Price, Total Stock, and location columns get explicit `w-*` so they hold fixed width regardless of content. The badge removals (above) eliminate the main previous source of column shifting.

### Appearance — Alternating Rows

- `frontend/src/index.css` — added `--row-alt` CSS variable to all three themes (dark: 2.5% white, light: 2.5% black, carbon: 3% white). Global rule `[data-alt-rows="true"] tbody tr:nth-child(even)` applies `background-color: var(--row-alt)` to all tables app-wide.
- `frontend/src/hooks/useAltRows.ts` — new hook mirroring `useTheme`. Reads/writes `erp_alt_rows` from localStorage, applies `data-alt-rows` attribute on `<html>` immediately.
- `frontend/src/main.tsx` — initialises `data-alt-rows` attribute before first paint to prevent flash.
- `frontend/src/components/AppShell.tsx` — calls `useAltRows()` to keep the attribute reactive.
- `frontend/src/pages/Settings.tsx` — Appearance tab now includes a **"Table Display"** section below the theme cards with an **Alternating Rows** checkbox. Persists to localStorage, applies immediately.

### Import — Multi-sheet XLSX Template

**`frontend/src/pages/inventory/NewProduct.tsx`**

- `downloadTemplate()` rewritten to generate a **3-sheet XLSX**:
  - **Sheet 1 — Variants**: PID as leftmost column, then product_brand, product_type, variant_name, description, base_uom_code, categories, SKU, price, promo_price, attr_color, attr_size. One row per product/variant.
  - **Sheet 2 — UOM Conversions**: PID, from_uom, to_uom, factor, is_warehouse_bundle. Composite key: PID + from_uom + to_uom.
  - **Sheet 3 — Supplier Links**: PID, supplier_name, supplier_sku, gross_cost, supplier_discount_pct, is_primary. Composite key: PID + supplier_name.
  - Each sheet includes one example row.

- `handleImportFile()` updated to read all three sheets. Sheet 1 feeds the existing preview/confirm upsert flow. Sheet 2 and Sheet 3 rows are stored in state alongside pending variant rows.

- `handleDiffConfirm()` extended with two post-confirm steps:
  - **Step 2 — UOM Conversions**: for each row in Sheet 2, resolves PID → variant_id from the confirm response, resolves UOM codes to IDs from local state, checks if the (from_uom_id, to_uom_id) conversion already exists on the variant → calls `update` or `create` accordingly.
  - **Step 3 — Supplier Links**: for each row in Sheet 3, resolves supplier name → supplier_id, checks if the supplier is already linked to the variant → calls `update` or `create`. Per-row errors are non-fatal and reported in the results list.

- New state: `pendingUomRows`, `pendingSupplierRows` hold Sheet 2/3 data across the preview/confirm lifecycle.

- Import section description updated to explain the 3-sheet structure.

### Transfer and Receiving Templates — PID leftmost

- `frontend/src/pages/stock/TransferNew.tsx` — added `downloadTemplate()` generating a blank XLSX with headers `PID, variant_name, quantity` (PID first). **Download Template** button added to the footer action bar.
- `frontend/src/pages/stock/ReceivingNew.tsx` — added `downloadTemplate()` with headers `PID, variant_name, qty_declared, breakage`. **Download Template** button added to the footer.

---

## 2026-06-02 — Three targeted fixes: price columns, theme awareness, import upsert

### Fix 1 — Price column stability (`frontend/src/pages/inventory/Catalogue.tsx`)

**Problem:** The Price column rendered `fmt(v.promo_price ?? v.price)` — swapping in the promo price when active. The Promo Price column rendered `v.promo_price != null ? fmt(v.price) : '—'` — showing the regular price in the Promo column when a promo was active. Both columns could therefore show the same value with no stable position.

**Fix:** Price column always renders `fmt(v.price)`. Promo Price column always renders `fmt(v.promo_price)` with a red `PROMO` badge inline when the promo is set, and `—` when absent. No column positions change under any condition.

### Fix 2 — Theme awareness (`frontend/src/pages/inventory/Catalogue.tsx`)

**Problem:** The entire Catalogue table (aside panel, toolbar, table header, table rows, column picker, export modal) used hardcoded dark-mode Tailwind classes (`bg-gray-900`, `bg-gray-800`, `text-gray-400`, `border-gray-700`, etc.) that did not update when the user changed the theme in Settings → Appearance.

**Fix:** Audited and replaced every hardcoded colour in the file with theme-aware CSS variable classes: `t-bg-base`, `t-bg-surface`, `t-bg-elevated`, `t-bg-input`, `t-border`, `t-border-strong`, `t-text-1` through `t-text-4`, `ring-[var(--accent)]`, `accent-[var(--accent)]`. Status filter toggle now uses `var(--accent)` for the active state. The table reacts to theme changes immediately without a page reload.

### Fix 3 — Import upsert end-to-end (`backend/inventory/router.py`, `frontend/src/pages/inventory/NewProduct.tsx`)

**Root cause:** The frontend container was serving a stale build that pre-dated the import preview/confirm changes. Backend endpoints existed but the frontend never reached them.

**Additional backend fixes applied during investigation:**

- `import_preview` — `_norm()` helper rewrote Decimal comparison to use `quantize(0.01)` so `Decimal("528.00")` and `Decimal("528")` compare as equal (no false diff). Previously used `str(v.normalize())` which produced scientific notation (`"3.9E+2"`) for prices like 390.00.
- `import_preview` — create-mode variants now only include non-null fields in `new_values` and `diff_fields` (null optional fields are excluded).
- `import_preview` — `old_values` and `new_values` are serialised with normalised 2dp strings for Decimal fields so the diff modal renders readable numbers.

**Smoke test results (DB values before and after):**

| PID | Field | Before | After |
|-----|-------|--------|-------|
| MLD0027 | variant_name | Rose Water Goblet 6's | Rose Water Goblet 6s Renamed |
| MLD0027 | price | 528.00 | 555.00 |
| MLD0027-1 | variant_name | Rose Water Goblet | Rose Water Goblet Single |
| MLD0027-1 | sku | 44373 | 44374-NEW |
| MLD0027-1 | price | 88.00 | 95.00 |
| SMOKE-FINAL-001 | (new) | — | Created: New Item, SF001, ₱200.00 |

promo_price on MLD0027 (390.00) was correctly preserved — null import value = no change per ui_standards §2.

---

## 2026-06-02 — Frontend Batch 2 + Backend: React Query completion, Detail restructure, Ledger endpoint, Import upsert

### Item 1 — React Query migration (remaining pages)

**`frontend/src/pages/Settings.tsx`** — All 8 data-fetching tabs migrated from `useCallback + useEffect` to `useQuery` with correct stale times (reference: 10 min, auth: 5 min). Each tab now calls `queryClient.invalidateQueries` after mutations instead of re-fetching manually. `SkeletonTable` shown on initial load per tab. `FetchingBar` shown during background refreshes. `useCallback`/`useEffect` removed from data-loading paths entirely.

**`frontend/src/pages/sales/Workstation.tsx`** — Seven parallel reference data fetches (shifts, locations, registers, paymentModes, users, posCatalog, sales) replaced with `useQueries` with correct stale times. Sale PID initialisation from latest sale moved to a `useEffect` dependent on query data. `FetchingBar` added for background refreshes. All cart/tender/UI state unchanged.

**Procurement.tsx, AP.tsx, Customers.tsx, Admin.tsx** — Pure placeholder stubs with no data fetching. No React Query migration needed; noted as no-ops.

### Item 2 — Product Detail page restructure (inventory_catalogue.md §Page 2)

**`frontend/src/pages/inventory/Detail.tsx`**

- **Product Header section** — Product-level fields (Brand, Product Type, Status, Base UOM, Categories, Description) separated into their own "Product" section above variant-specific fields.
- **Sibling Variants Panel** — "All Variants" table below the Product Header showing all non-deleted variants for the product. Current variant highlighted with "Viewing" badge. Other variants show Default badge, name, PID, SKU, total stock, and "View →" link to navigate. "+ Add Variant" link at the bottom of the panel.
- **Variant Fields section** — Variant Name, PID, SKU, is_default now in their own "Variant" section below the panel.
- **Price inheritance** — Non-default variants with `price == null` show the default variant's price greyed out with "Override" link. Non-default variants with an overridden price show a "Reset to default" button. Same pattern for promo_price.
- **Supplier link inheritance** — Non-default variants with no supplier links show the default variant's supplier links greyed out with explanatory text and an "Add Override Supplier Link" callout.
- **Breadcrumb** simplified to `Inventory / Brand / Variant Name`; Add Variant button moved to sibling panel.
- **FetchingBar** added for background refresh indicator.

### Item 3 — Import upsert standard (ui_standards §2)

**`frontend/src/components/ImportDiffModal.tsx`** — New reusable diff modal component. Shows one diff row per variant with left column (current DB values) and right column (incoming import values). Changed fields highlighted in yellow. Row-by-row confirm/skip checkboxes + Confirm All / Skip All bulk controls. Applied count shown in footer with Apply N Rows button.

**`frontend/src/pages/inventory/NewProduct.tsx`** — Import flow updated: XLSX parse now calls `POST /products/import/preview` first to get a diff, opens `ImportDiffModal`, then calls `POST /products/import/confirm` with only the confirmed PIDs. Falls back to legacy row-by-row create if backend upsert endpoint is unavailable.

**`backend/inventory/schemas.py`** — Added: `ProductBriefOut`, `VariantBriefOut`, `LocationBriefOut`, `LedgerEntryContextOut` (with variant + location joins), `ImportVariantRow`, `ImportProductRow`, `ImportPreviewVariant`, `ImportPreviewRow`, `ImportPreviewResponse`, `ImportConfirmRequest`.

**`backend/inventory/router.py`** — Two new endpoints:
- `POST /products/import/preview` — dry-run diff between incoming rows and DB. Returns create/update mode per variant, changed field list, old vs new values. No writes.
- `POST /products/import/confirm` — upserts approved variants. Updates existing PIDs (variant_name, sku, price, promo_price, attributes), creates new PIDs. Product-level fields (brand, type, description, base_uom_id) updated when a match is found. Requires `manage_products` permission.

### Item 4 — GET /inventory/ledger endpoint

**`backend/inventory/models.py`** — Added `variant` and `location` relationship attributes to `InventoryLedger` model (lazy="joined") so the context-enriched serialiser can resolve joins.

**`backend/inventory/router.py`** — New `GET /products/ledger` endpoint. Filters: reason (excludes SALE by default), location_id, variant_id, date_from, date_to. Cursor-based pagination via `cursor` (ledger_id) + `limit` parameters. Capped at 200 rows per page. Returns `List[LedgerEntryContextOut]` with variant (PID, variant_name, product.brand) and location (location_name) nested.

**`frontend/src/services/api.ts`** — `stockApi.ledger.list` updated to use the new `/products/ledger` endpoint with full filter/cursor params.

**`frontend/src/pages/stock/Ledger.tsx`** — Cursor-based "Load More" pattern implemented. Entries accumulate across pages. Filter changes reset the accumulator and cursor. Placeholder message replaced with real data rendering. XLSX export now exports filtered entries.

---

## 2026-06-02 — Frontend Batch: React Query, Catalogue v2, Stock Movement module

### Infrastructure

**`frontend/src/lib/queryClient.ts`** — `QueryClient` with per-tier stale times: reference data 10 min, transactional 30 s, auth 5 min.

**`frontend/src/lib/queryKeys.ts`** — Centralised query key factory covering all data domains (products, variants, locations, UOMs, categories, suppliers, transfers, shipments, ledger, sales, auth, settings).

**`frontend/package.json`** — `@tanstack/react-query` v5 installed.

**`frontend/src/main.tsx`** — `QueryClientProvider` wraps the entire app.

**`frontend/src/components/Skeleton.tsx`** — Reusable skeleton loaders: `SkeletonRow`, `SkeletonTable`, `SkeletonCard`, `SkeletonField`, `SkeletonFields`, `FetchingBar` (thin top bar for background refreshes).

### Item 1 — React Query migration (ui_standards §4 & §5)

**`frontend/src/pages/inventory/Catalogue.tsx`** — Migrated from `useEffect + Promise.allSettled` to `useQueries` with correct stale times. `FetchingBar` shown during background refreshes. `SkeletonTable` shown on initial load.

**`frontend/src/pages/inventory/Detail.tsx`** — Migrated to `useQueries` for variant, product, locations, UOMs, categories, suppliers, and all history endpoints in parallel. History sections seed local state from query cache; `reload()` now calls `qc.invalidateQueries()` instead of re-fetching manually. Skeleton shown on initial load.

### Item 2 — Product Catalogue updates (ui_standards §6, inventory_catalogue.md §Page 1)

**Column picker** — Full column picker (⚙ Columns button) replaces the Locations-only picker. Toggleable columns: SKU, Product Type, Category, Price, Promo Price, Total Stock, Status. Location group remains with Physical / Virtual subgroups. Selection persists to `localStorage` under `erp_catalogue_cols`.

**Sorting** — Click-to-sort on Brand, Variant Name, PID, SKU, Category. Clicking a sorted header cycles asc → desc → off.

**Default variant emphasis** — Default variant rows: `font-semibold` weight on Brand and Variant Name + "Default" badge (blue pill). Non-default sibling rows: `opacity-80`.

**Keyword search scope** — Already included brand; now also includes category name.

### Item 5 — Stock Movement module (stock_movement.md)

**`frontend/src/pages/Stock.tsx`** — Module wrapper with sub-nav tabs (Transfers / Receiving / Ledger). All sub-pages lazy-loaded with Suspense.

**`frontend/src/pages/stock/Transfers.tsx`** — Transfer overview: list with search + location filter, Export XLSX. React Query with 30 s stale time.

**`frontend/src/pages/stock/TransferNew.tsx`** — Create Transfer form: left-panel item search (brand, name, PID, SKU, barcode), header fields (From, To, Date, Remarks), line item grid with Brand column. Bundle Count ↔ Qty linked via `is_warehouse_bundle` conversion (ui_standards §8) — Bundle Count shown only when warehouse bundle conversion exists. Posts atomically via `POST /transfers/`.

**`frontend/src/pages/stock/TransferDetail.tsx`** — Transfer detail: read-only header + line items table with Brand column. Export XLSX.

**`frontend/src/pages/stock/Receiving.tsx`** — Receiving overview: list with search + supplier filter, Export XLSX.

**`frontend/src/pages/stock/ReceivingNew.tsx`** — Supplier Declaration form: left-panel item search, header fields (Supplier, Document ID, PO Link, Date Received, Destination Location), line item grid with Brand column + Bundle Count ↔ Qty Declared mechanic. Saves via `POST /procurement/shipments` + `POST /shipments/{id}/details`.

**`frontend/src/pages/stock/ReceivingDetail.tsx`** — Shipment detail with inline Qty Actual / Qty Rejected / QC Status edits per line. Variance column highlighted when non-zero. Confirm Receipt button calls `POST /shipments/{id}/confirm`. Export XLSX.

**`frontend/src/pages/stock/Ledger.tsx`** — Inventory Ledger browser: reason-filter pills (RECEIVE, TRANSFER_IN, TRANSFER_OUT, RETURN_IN, RETURN_OUT, ADJUST — excludes SALE), location filter, date range, keyword search. Export XLSX. **Note: requires a top-level `GET /inventory/ledger` backend endpoint not yet implemented — page renders with an informational placeholder until that endpoint is added.**

**`frontend/src/components/AppShell.tsx`** — Stock nav item added (visible to ADMIN, WAREHOUSE_MANAGER, STORE_MANAGER).

**`frontend/src/App.tsx`** — `/stock/*` route added.

**`frontend/src/services/api.ts`** — Added `Transfer`, `TransferItem`, `TransferCreate`, `Shipment`, `ReceivingDetail`, `LedgerEntry` types + `stockApi` (transfers, shipments, ledger).

### Items 3 & 4 — Deferred

**Item 3 (Product Detail restructure)** — Sibling variants panel, price/supplier inheritance UI, and Detail page reorganisation are partially implemented (React Query migration complete) but the full structural rewrite is deferred to the next batch. Backend already supports siblings via `GET /products/{product_id}`.

**Item 4 (Import upsert standard)** — PID-as-anchor upsert + diff modal for the Catalogue import and Transfer/Receiving imports are deferred. Requires a reusable `ImportDiffModal` component and backend upsert logic.

---

## 2026-06-02 — Inventory UI: Add Variant modal + Supplier SKU pre-fill

### `frontend/src/pages/inventory/Detail.tsx`

**Add Variant modal**
- `+ Add Variant` button added to the breadcrumb row (visible to ADMIN, STORE_MANAGER, WAREHOUSE_MANAGER only).
- Clicking opens a fixed-overlay modal titled "Add Variant — {product brand}". Clicking the backdrop or Cancel closes it without submitting.
- Modal fields match the variant row on the New Product creation form: Variant Name *, PID *, SKU, Price, Promo Price, Set as default variant, Attributes (key/value), Barcodes (expandable), UOM Conversions (expandable), Bundle toggle + component search, Supplier Link (optional).
- On submit: calls `POST /products/{product_id}/variants`, then fires follow-up calls for supplier link, barcodes, UOM conversions, and bundle components (non-fatal). On success, closes the modal and navigates to the new variant's detail page.
- Client-side validation: requires Variant Name and PID before submitting. Backend PID-uniqueness errors surface as inline red text inside the modal.
- Fix: `setShowAddVariant(false)` is called before `navigate()` so the modal does not persist when React Router reuses the same `Detail` component instance for the new variant's URL.

**Supplier SKU pre-fill**
- New `useEffect([variant?.sku])`: whenever the variant loads (or its SKU is saved and the page reloads), the Supplier SKU field in the add-supplier row is pre-filled with `variant.sku`. If the variant has no SKU the field is left blank.
- `handleAddSupplierLink` reset: after a link is successfully added, the form resets with `supplier_sku: variant?.sku ?? ''` instead of `''`, so the field returns to the pre-filled state rather than going blank.

### `frontend/src/pages/inventory/NewProduct.tsx`

**Supplier SKU pre-fill**
- `updateVariant` updated: when the SKU field changes, if `supplier_sku` is still empty or still equals the previous SKU value (i.e. the user has not manually overridden it), `supplier_sku` is updated to match the new SKU automatically. If the user has typed something different into Supplier SKU, the manual value is preserved.

---

## 2026-05-31 — Frontend Batch 2.6 (Settings page) + employees.is_active migration

### Migration — `backend/alembic/versions/f3b1d7a9c2e0_employees_add_is_active.py`
Added `is_active BOOLEAN NOT NULL DEFAULT true` to `auth.employees`. Applied directly against the running DB and recorded in `alembic_version` table (which was created as part of this session since no prior version table existed). Migration uses `ADD COLUMN IF NOT EXISTS` for idempotency.

### `backend/auth/models.py`
Added `is_active = Column(Boolean, default=True, nullable=False)` to `Employee` model.

### `backend/auth/schemas.py`
- `EmployeeOut` updated: `is_active: bool` added.
- New schemas: `EmployeeCreate` (first/last name), `EmployeePatch` (first/last/is_active optional).

### `backend/auth/dependencies.py`
Added `manage_users` to `STORE_MANAGER` permissions so managers can access the Settings page.

### `backend/auth/router.py`
Five new endpoints:
- `GET /auth/employees` — lists all employees (active + inactive), requires `manage_users`
- `POST /auth/employees` — creates standalone employee record, requires `manage_users`
- `PATCH /auth/employees/{id}` — updates name and/or is_active, requires `manage_users`
- `GET /auth/users` — lists all users including inactive (for Settings page); distinct from `GET /auth/users/all` which returns active only and is used for dropdowns
- `GET /auth/roles` — lists all role records; requires valid JWT only

`set_user_active` endpoint updated to cascade `employee.is_active` when a user is deactivated, so all dropdowns system-wide that filter by `employee.is_active` stay consistent.

### `frontend/src/services/api.ts`
- New types: `RoleEntry`, `EmployeeOut`, `EmployeeCreate`, `EmployeePatch`, `UserCreate`
- New Settings CRUD types: `LocationCreate`, `LocationUpdate`, `ShiftCreate/Patch`, `RegisterCreate/Patch`, `PaymentModeCreate/Patch`
- `Employee` interface updated: `is_active: boolean` added
- `authApi` expanded: `users.allActive`, `users.all`, `users.register`, `users.setActive`, `users.setRoles`, `users.changePassword`, `employees.*`, `roles.list`
- `salesApi` expanded: `shifts.create/patch`, `registers.create/patch`, `paymentModes.create/patch`
- `inventoryApi.locations` expanded: `create`, `update` (PUT)
- Workstation updated to use `authApi.users.allActive()` (active only, for cashier dropdown)

### `frontend/src/pages/Settings.tsx`
Full 7-section settings page at `/settings`. Role guard redirects non-ADMIN / non-STORE_MANAGER users.

**Sections:**
1. **Locations** — list, add, edit (name/type/parent/address), deactivate/reactivate; system locations (Quarantine, Adjustment) show as read-only
2. **Shifts** — list, add, edit name, deactivate/reactivate
3. **Cash Registers** — list, add (name + location), edit, deactivate/reactivate; location dropdown filtered to active non-virtual locations
4. **Payment Modes** — list, add (name + Physical/Digital type), edit, deactivate/reactivate
5. **Employees** — list all (active + inactive, dimmed), add standalone employee record, edit names, deactivate/reactivate
6. **Users** — list all including inactive, add user (creates linked employee), inline password change, deactivate/reactivate
7. **Role Assignment** — active users only; edit opens checkboxes for all available roles; saves via `PUT /auth/users/{id}/roles`; role badges displayed inline

**Design decisions:**
- Inline form-above-table pattern — no modals, no separate routes; clicking Add/Edit shows a collapsible `InlineForm` panel at the top of the section with a grid layout
- Deactivated rows remain visible but dimmed (`opacity-50`) per spec
- Roles section fetches from `GET /auth/roles`; falls back to a hardcoded list if endpoint unavailable (graceful degradation)
- `RolesSection` and `UsersSection` are fully self-contained with their own data fetch; `RegistersSection` receives `locations` as a prop from the root page (shared with `LocationsSection` to avoid double-fetch)
- All sections follow the same dark theme (gray-900/800/700 palette) established in Batch 2

---

## 2026-05-30 — Frontend Batch 2 (sales encoding workstation)

### `frontend/src/services/api.ts`
All API types and call methods needed by the workstation added:
- Types: `Shift`, `PaymentMode`, `CashRegister`, `Location`, `Employee`, `UserEntry`, `VariantBarcode`, `POSStockEntry`, `POSVariant`, `POSCatalogItem`, `SaleLineItemIn`, `SaleCreate`, `SalePatch`, `SaleTenderIn`, `SalePostRequest`, `SaleItemOut`, `SaleOut`
- `salesApi` — shifts, paymentModes, registers, drafts (create/list/get/patch/delete/post), sales.list
- `inventoryApi` — locations.all, posCatalog
- `authApi.users.all` — added to existing authApi object

### `frontend/src/pages/Sales.tsx`
Converted from a placeholder into a React Router sub-router. `/sales` and `/sales/*` redirect to `/sales/new`; room left for Batch 3's `/sales` list and `/sales/:id` detail routes.

### `frontend/src/pages/sales/Workstation.tsx` (new)
Full sales encoding workstation at `/sales/new`.

**Session header (lockable):**
- Date, Shift, Location, Register (filtered by Location), Cashier/Employee dropdowns
- Sale PID field with Auto/Manual toggle — auto mode seeds from last posted `sale_pid` on load and increments after each successful post
- Lock/Unlock affordance — freezes all header fields; auto-locks after first successful post to prevent accidental changes during batch encoding

**Left panel — Item search:**
- Single keyword input; client-side search against POS catalog cache (product name, variant name, PID, barcode)
- Results remain visible after click; clicking increments quantity if the variant is already in the cart
- Promo price highlighted in red with strikethrough of regular price when active

**Right panel — Basket grid:**
- Spreadsheet-style HTML table: Item (read-only), Unit Price (editable), Qty (editable), Disc % (editable), Disc ₱ (editable), Line Total (read-only), Delete
- Line total formula: `(unit_price × (1 − disc_pct/100) − disc_flat) × qty`
- Disc % and Disc ₱ fill-down via ⬇ handle: single click → fills next row; double click → fills all rows below; mousedown+drag → fills each row the cursor enters

**Cart footer:**
- Subtotal, Cart Disc %, Cart Disc ₱, Discount Amount, Grand Total
- Receipt Total — editable override; placeholder shows Grand Total; blank = no variance
- Variance — shown when Receipt Total is filled; green if positive, red if negative

**Tender section:**
- Add/remove rows; each row: payment mode selector (from active modes), amount, optional reference number
- Running total tendered and Balance Due shown; balance turns red when underpaid, green when overpaid

**Action buttons:**
- Save Draft — creates or patches the active draft; requires location
- Post — validates register + items + tenders, creates/patches draft then posts; on success clears cart, increments PID, locks header
- Void Draft — visible only when a draft is loaded; voids and purges it
- New — clears cart with confirmation guard
- Drafts button — opens/closes the draft tray; shows badge count

**Draft tray:**
- Collapsible panel showing up to 5 most recent open drafts for the active location
- Each entry: Sale PID (or "Unsaved"), item count, grand total; click loads into cart with confirmation guard if cart has items

**Design decisions:**
- All data fetching on mount via `Promise.allSettled` — individual failures are non-fatal; other dropdowns still populate
- Client-side search only — no per-keystroke API call; `useMemo` recomputes on search/catalog change
- `idempotency_key` set to the Sale PID on draft creation — prevents double-post on network retry
- All customers default to walk-in (`customer_id = null`) per spec §18 general notes
- Register is the only strictly required field at post time (validated client-side before submission)

---

## 2026-05-30 — Frontend Batch 1 (foundation and routing)

### `frontend/src/` — complete rewrite from scratch

All prior source files moved to `frontend/src/_archive/`. New structure:

| File | Purpose |
|---|---|
| `index.css` | Tailwind v4 entry: `@import "tailwindcss"` only |
| `main.tsx` | Root render — wraps app in `<AuthProvider>` |
| `App.tsx` | `BrowserRouter` + `Routes`. All module pages lazy-loaded via `React.lazy`. Root `/` redirects to `/sales`. Catch-all inside shell also redirects to `/sales`. |
| `context/AuthContext.tsx` | `AuthProvider` + `useAuth` hook. Reads `erp_token` and `erp_user` from `localStorage` on init; checks JWT `exp` and clears stale tokens. `login()` calls the API, decodes the `roles` array from the JWT payload, and persists both token and user object. Listens for `auth:unauthorized` window events to auto-logout on 401 responses. |
| `services/api.ts` | Central `request()` wrapper with auth header injection, 401 event dispatch, and error extraction from FastAPI `detail` fields. Exports `get`, `post`, `patch`, `del` helpers. `authApi.login` is the only populated API object in Batch 1; later batches fill in the rest. |
| `components/ProtectedRoute.tsx` | Renders `<Outlet />` if token present; otherwise `<Navigate to="/login" replace />`. |
| `components/Can.tsx` | Renders `children` when `user.roles` intersects `props.roles`; renders `fallback` (default `null`) otherwise. |
| `components/AppShell.tsx` | Fixed-height top nav bar. Nav items filtered to those the user's roles can access. Displays username + role badge + Sign out. Renders `<Outlet />` for page content. Role → nav visibility map: CASHIER sees Sales; WAREHOUSE_STAFF sees Inventory; ACCOUNTANT sees AP; STORE_MANAGER sees Sales/Inventory/Customers/Settings; WAREHOUSE_MANAGER sees Inventory/Procurement; ADMIN sees all. |
| `pages/Login.tsx` | Login form. Redirects away if already authenticated. Inline error display. Auto-redirects to `/` (→ `/sales`) on success. |
| `pages/{Sales,Inventory,Procurement,AP,Customers,Settings,Admin}.tsx` | Placeholder pages — each shows module name and the batch it will be implemented in. |

**Key implementation decision:** root `/` redirects to `/sales` rather than a separate dashboard. This means WAREHOUSE_STAFF (no sales access) lands on the Sales placeholder but can navigate to Inventory. Per-page role guards will be added in each module's batch.

**Verified against live stack:**
- Frontend serves `index.html` for all SPA paths (Nginx config intact)
- JWT `roles` field confirmed as array: `{"roles":["ADMIN"]}`, `{"roles":["CASHIER"]}`
- `authApi.login` correctly populates `AuthUser.roles` from JWT payload
- Unauthenticated API requests return 401
- Bad password returns `{"detail":"Invalid credentials"}` — shown inline on login form

---

## 2026-05-29 — Sales route ordering bugfix

### `sales/router.py`

**Bug found and fixed:** `GET /sales/payments` and `GET /sales/returns` were being intercepted by `GET /{sale_id}` (the single-sale wildcard) before the specific routes could match. FastAPI/Starlette matches routes strictly in registration order; since `GET /{sale_id}` was registered before `GET /payments`, any single-segment path under `/sales/` hit the wildcard and produced an `int_parsing` error.

**Fix:** Removed `get_sale` (`GET /{sale_id}`) from the "Reading Sales" section and re-registered it at the end of the router file — after all static routes including `/payments`, `/returns`, and `/shifts`. A comment was added explaining why the wildcard must remain last.

`GET /sales/{id}` (single sale by ID) continues to work identically from the caller's perspective.

---

## 2026-05-29 — Sales Batches 3–12 verification pass

All endpoints verified against the live stack with a fresh database. Results by batch:

| Batch | Key evidence |
|---|---|
| **3 — Customers** | Create/read/update with correct `outstanding_balance = 0` on creation; soft-delete guard working |
| **4 — POS catalog** | `GET /products/pos-catalog` returns active variants with price fallback; virtual-location stock excluded |
| **5 — Draft lifecycle** | Create, list, get, patch, delete; idempotency key returns existing draft without creating duplicate |
| **6 — Post a sale** | SALE-00002: 2 units deducted (50→48), `payment_status=Paid`, `audit_variance=0.00`, FIFO layer consumed |
| **7 — Reading sales** | `GET /sales/` list, `GET /sales/{id}` single, `GET /sales/{id}/items` raw FIFO rows; filter by `payment_status` |
| **8 — Void** | SALE-00002 voided: `status=Voided`, stock restored (48→50), double-void correctly rejected |
| **9 — Customer payments** | Partial payment ($150) → `Partial`; unapplied credit applied via `/apply` → `Paid`; AR ledger entries confirmed |
| **10 — Sales returns** | RET-00001 linked (1 unit from SALE-00003): stock +1, AR ledger `RETURN` entry; blind return with `process_blind_returns` permission |
| **11 — Supplier returns** | SRET-00001 Draft→Shipped (Quarantine stock 5→2, `RETURN_OUT` ledger) →Credit_Received (`CREDIT_MEMO` ap_ledger -240.00); terminal state correctly blocks further transitions |
| **12 — Auth/audit** | CASHIER role blocked on `manage_sales_settings` and `manage_payments` (403); `process_sale` allowed; 16 `audit_log` rows confirmed across all write events |

---

## 2026-05-29 — Sales Batch 2 gap-fill (shift CRUD endpoints)

### `sales/router.py`
Three endpoints added under `prefix="/sales"`. All require `manage_sales_settings` permission on writes; reads are open to any authenticated user.

| Endpoint | Behaviour |
|----------|-----------|
| `GET /sales/shifts` | List all shifts (active and inactive) ordered by `shift_id`. |
| `POST /sales/shifts` | Create a shift with `shift_name` and optional `is_active` (defaults `true`). |
| `PATCH /sales/shifts/{id}` | Update `shift_name` and/or `is_active`. Use `is_active = false` to retire a shift without deleting it. Returns 404 if not found. |

Verified live against the running stack: empty list, create AM/PM, rename AM → Morning, list returns both.

---

## 2026-05-29 — Sales Batch 1 gap-fill (Shift model, shift_id, origin_sale_id)

Previous Batch 1 entry created 12 of the 13 required models. Three schema gaps were identified and closed:

### `sales/models.py`
- **`Shift` model added** — `sales.shifts` table (`shift_id`, `shift_name`, `is_active`). Required by schema.dbml §9 and Requirements §11.3 ("shift management" reference lookup for tagging sales).
- **`Sale.shift_id` column added** — nullable FK to `sales.shifts.shift_id`. Was in `schema.dbml` but missing from the ORM model. `shift = relationship("Shift")` also added.
- **`Sale.origin_sale_id` column added** — nullable self-referential FK (`sales.sales.sale_id`). Was in `schema.dbml` but missing. Used to link exchange sales back to the original transaction (Requirements §13.1).

### `sales/schemas.py`
- **`ShiftCreate`, `ShiftPatch`, `ShiftOut` schemas added** — covers CRUD for the new Shift model.
- **`SaleCreate`** — `shift_id: Optional[int]` and `origin_sale_id: Optional[int]` added.
- **`SalePatch`** — `shift_id: Optional[int]` added (origin_sale_id is set at draft creation, not updated).
- **`SaleOut`** — `shift_id: Optional[int]` and `origin_sale_id: Optional[int]` added.

### `sales/router.py`
- `create_draft` now passes `shift_id` and `origin_sale_id` from the payload to the `Sale` constructor.
- `update_draft` now applies `shift_id` when present in the patch payload.

---

## 2026-05-29 — Sales Batch 12 (auth and audit wiring)

### `auth/dependencies.py`

**New permissions added to `ADMIN`:** `manage_sales_settings`, `manage_customers`, `process_sale`, `process_returns` (in addition to `process_blind_returns` added in Batch 10).

**Two new roles:**
- `STORE_MANAGER` — `view_inventory`, `manage_sales_settings`, `manage_customers`, `process_sale`, `process_returns`, `process_blind_returns`, `manage_payments`.
- `CASHIER` — `view_inventory`, `process_sale`, `process_returns`. Floor cashier: no access to settings/customer management, blind returns, or standalone payment application.

### `sales/router.py`

**New import:** `from core.audit import write_audit, _serialize`.

**Permission guards applied to all 13 write endpoints:**

| Permission | Endpoints |
|-----------|-----------|
| `manage_sales_settings` | `POST /payment-modes`, `PATCH /payment-modes/{id}`, `POST /registers`, `PATCH /registers/{id}` |
| `manage_customers` | `POST /customers`, `PATCH /customers/{id}`, `DELETE /customers/{id}` |
| `process_sale` | `POST /drafts`, `PATCH /drafts/{id}`, `DELETE /drafts/{id}`, `POST /drafts/{id}/post`, `POST /{id}/void` |
| `manage_payments` | `POST /payments` (added); `POST /payments/{id}/apply` (already had it since Batch 9) |
| `process_returns` | `POST /returns` — replaced `Depends(get_current_user)` with `Depends(require_permission("process_returns"))`; blind-return gate still enforced inline via `_has_permission` |

**Audit writes** added to 4 key events (pattern: `write_audit` called after main `db.commit()`, then a second `db.commit()` for the audit row):

| Event | Table | Action | Actor |
|-------|-------|--------|-------|
| Sale posted (`post_draft`) | `sales.sales` | `UPDATE` | `_actor.user_id` |
| Sale voided (`void_sale`) | `sales.sales` | `UPDATE` | `_actor.user_id` |
| Return created (`create_return`) | `sales.sales_returns` | `INSERT` | `current_user.user_id` |
| Payment recorded (`create_payment`) | `sales.customer_payments` | `INSERT` | `_actor.user_id` |

---

## 2026-05-29 — Sales Batch 11 (supplier returns)

### `procurement/schemas.py`
Six new schemas added for supplier returns:
- `SupplierReturnItemIn` — create input per line item: `variant_id`, optional `cost_layer_id`, `quantity`, optional `unit_credit_expected`.
- `SupplierReturnCreate` — header input: `supplier_id`, `location_id` (source, typically Quarantine), `items`, optional `total_credit_amount` (auto-computed from items if omitted).
- `SupplierReturnStatusPatch` — `status` field for `Draft → Shipped → Credit_Received` lifecycle.
- `SupplierReturnItemOut`, `SupplierReturnOut` — response schemas; `SupplierReturnOut` includes nested `supplier` and `items` with variant refs.

### `procurement/router.py`
- `from sales import models as sales_models` added — models live in the sales module per Batch 1 design.
- `_SRET_TRANSITIONS` dict defines valid one-way status progressions; terminal at `Credit_Received`.
- `_load_supplier_return(return_id, db)` — loads the return with `supplier` and `items → variant` eager-loaded.

Four endpoints added under `prefix="/procurement"`:

| Endpoint | Key behaviour |
|----------|---------------|
| `POST /procurement/supplier-returns` | Validates supplier, location, and sufficient stock at source location per item (pre-flight — rejects before writing anything). `total_credit_amount` auto-computed as `Σ qty × unit_credit_expected` if not supplied. `return_pid = SRET-{id:05d}`. Requires `manage_suppliers` permission. |
| `PATCH /procurement/supplier-returns/{id}/status` | Enforces `_SRET_TRANSITIONS`; HTTP 400 on invalid move. On `Shipped`: writes `RETURN_OUT` `inventory_ledger` entry and calls `_upsert_stock` per Inventory-type item. On `Credit_Received`: writes `ap_ledger` `CREDIT_MEMO` with `amount_change = -total_credit_amount`. Requires `manage_suppliers` permission. |
| `GET /procurement/supplier-returns` | List newest-first; optional `supplier_id` filter. |
| `GET /procurement/supplier-returns/{id}` | Single return with line items. |

---

## 2026-05-29 — Sales Batch 10 (sales returns)

### `auth/dependencies.py`
- `process_blind_returns` added to the `ADMIN` role's permission list.

### `sales/router.py`
- `ROLE_PERMISSIONS` imported from `auth.dependencies` to support inline permission checks.

Two module-level helpers added:
- `_has_permission(user, perm)` — checks whether a user holds a permission via any of their roles; used to conditionally enforce `process_blind_returns` inside `create_return` without an extra `Depends`.
- `_load_return(return_id, db)` — loads a `SalesReturn` with `items → variant` eager-loaded; raises 404 if not found.

Three endpoints added:

**`POST /sales/returns`** — 7-step transaction:
1. **Blind return gate** — if `sale_id` is None: checks `process_blind_returns` via `_has_permission`; requires `location_id`; raises 403/400 appropriately.
2. **Sale load** — for linked returns, sale must be Posted; customer loaded from sale.
3. **Location resolve** — defaults to original sale's `location_id`; validates location exists and is not deleted.
4. **Item pre-validation** — validates each item: `SaleItem` exists (when `sale_item_id` given), `variant_id` matches, `quantity ≤ sale_item.quantity`; derives `cost_layer_id` from the referenced `SaleItem`.
5. **Header creation** — flushes to get `return_id`; assigns `return_pid = RET-{id:05d}`.
6. **Per-item processing** — creates `SalesReturnItem`; skips ledger for Non-Inventory/Service; writes `RETURN_IN` ledger entry; calls `_upsert_stock`; if `cost_layer_id` is set, increments `cost_layer.quantity_remaining` (capped at `original_quantity`, row-locked with `with_for_update`).
7. **AR + balance** — writes AR RETURN entry (`-grand_total`) and decrements `customer.outstanding_balance` if a customer is linked.
- Exchange (`origin_sale_id`) not implemented — `Sale` model has no such field; deferred.

**`GET /sales/returns`** — list returns newest-first; optional filters: `sale_id`, `customer_id` (joined via sale subquery — blind returns excluded), `date_from`, `date_to`.

**`GET /sales/returns/{id}`** — single return with line items and variant refs.

---

## 2026-05-29 — Sales Batch 9 (customer payments)

### `sales/router.py`

Two new helpers:
- `_load_payment(payment_id, db)` — loads a `CustomerPayment` with `applications` eager-loaded; raises 404 if not found.
- `_apply_and_update(db, sale, payment_id, amount_to_apply, customer_id)` — shared logic for both `create_payment` and `apply_unapplied_payment`: creates the `CustomerPaymentApplied` row, recalculates `sale.balance_due` and `sale.payment_status`, and writes the AR PAYMENT ledger entry. `outstanding_balance` is intentionally left to the caller so multiple applications in one request can be batched into a single net update.

Four endpoints added. `require_permission` and `AuthUser` imported into the router.

| Endpoint | Key behaviour |
|----------|---------------|
| `POST /sales/payments` | Validates customer (not deleted), payment mode (active), and that total applications ≤ payment amount. Creates `CustomerPayment` with `unapplied_amount = full amount` then applies via `_apply_and_update` per sale. Reduces `unapplied_amount` by total applied. Updates `customer.outstanding_balance` once (net of all applications). All in one transaction. |
| `GET /sales/payments` | Lists payments newest-first; optional `customer_id`, `date_from`, `date_to` filters. Eager-loads `applications`. |
| `GET /sales/payments/{id}` | Single payment with full application detail. |
| `POST /sales/payments/{id}/apply` | Manually applies unapplied credit to a Posted sale. Requires `manage_payments` permission. Guards: `amount_applied > 0`, `amount_applied ≤ unapplied_amount`, sale is Posted and has outstanding balance. Caps `amount_to_apply` at `sale.balance_due` so callers don't need to know the exact remaining figure. Updates `payment.unapplied_amount`, sale balance/status, AR ledger, and `customer.outstanding_balance`. |

---

## 2026-05-29 — Sales Batch 8 (voiding a sale)

### `sales/router.py`

`POST /sales/{id}/void` — single-transaction void of a Posted sale. Accepts `SaleVoidRequest` (`void_reason: str`).

**Gate:** rejects with HTTP 400 for any non-Posted status, with distinct messages for already-Voided vs. Draft.

**Step-by-step within one transaction:**

1. **Stock reversal** — queries all `inventory_ledger` rows for this sale (`reference_type="sales"`, `reason=SALE`). This captures both regular inventory and bundle component movements, since the posting code writes component-level ledger entries. For each row: writes a `RETURN_IN` entry (`qty_change = +abs(original qty_change)`) and calls `_upsert_stock` to restore `current_stocks`.

2. **FIFO layer restoration** — queries `sale_items` rows where `cost_layer_id IS NOT NULL`, ordered by `sale_item_id DESC` (reverse insertion = most recently consumed layer first). For each row: increments `cost_layer.quantity_remaining` by `item.quantity`, capped at `original_quantity` to guard against any data drift. Bundle SaleItem rows have `cost_layer_id = NULL` and are deliberately skipped; stock for bundle components is correctly restored in step 1 via ledger entries.

3. **AR ledger** — writes one `ADJUSTMENT` entry with `amount_change = -grand_total` for the sale's customer (if any). No per-payment reversal entries are added; the single adjustment covers the full void per Requirements §13.7–§13.8.

4. **`customer.outstanding_balance`** — decremented by `grand_total` transactionally. A negative resulting balance represents a customer credit (correct when the voided sale was fully or partially paid).

5. **Payment records preserved** — `customer_payments` and `customer_payment_applied` rows are intentionally untouched.

6. **Sale finalised** — `status = Voided`, `voided_at = now()`, `void_reason` set.

**Response** — voided `SaleOut` with items collapsed (same format as the post response).

---

## 2026-05-29 — Sales Batch 7 (reading sales)

### `sales/router.py`

Three endpoints added. All reuse the `_load_sale` and `_collapse_items` helpers from Batch 6.

| Endpoint | Behaviour |
|----------|-----------|
| `GET /sales/` | Lists Posted and Voided sales (Drafts excluded). Optional query filters: `date_from`, `date_to` (ISO 8601 datetime), `location_id`, `employee_id`, `customer_id`, `payment_status`. Ordered newest-first by `sale_date`. Items collapsed to one display row per variant. |
| `GET /sales/{id}/items` | Returns raw `sale_items` rows with full FIFO split detail and cost snapshot — for audit and COGS queries. Defined before `GET /{id}` so the two-segment path resolves correctly. |
| `GET /sales/{id}` | Returns a single sale (any status: Draft, Posted, Voided) with items collapsed to one display row per variant. |

---

## 2026-05-29 — Sales Batch 6 (posting a sale)

### `sales/schemas.py`
- `SaleTenderIn` — one payment tender: `payment_mode_id`, `amount`, optional `reference_number`.
- `SalePostRequest` — post-endpoint payload: `tenders: List[SaleTenderIn]`, optional `receipt_grand_total`.

### `sales/router.py`

Four module-level helpers added:

| Helper | Purpose |
|--------|---------|
| `_load_sale(sale_id, db)` | Loads any sale (any status) with `items → variant` eager-loaded. Used by post, read, and void endpoints. |
| `_upsert_stock(db, variant_id, location_id, delta)` | PostgreSQL `INSERT … ON CONFLICT DO UPDATE` for atomic stock delta — mirrors the pattern in `transfers_router.py`. |
| `_consume_fifo_for_sale(db, variant_id, location_id, qty)` | FIFO consumption with full layer detail. Pre-flight check against `current_stocks`, row-locks layers with `with_for_update()`. Returns `[(layer_id, qty_taken, gross_cost, supplier_discount, net_unit_cost), …]`. |
| `_collapse_items(items)` | Collapses FIFO-split `SaleItem` rows to one display row per variant (sum qty/line_total, first row's unit_price and cost snapshot). |

`POST /sales/drafts/{id}/post` — 13-step transaction:
1. **Idempotency** — returns existing Posted sale (collapsed) if `idempotency_key` already committed; never reprocesses.
2. **Empty cart guard** — HTTP 400 if draft has no items.
3. **Customer load** — raises 400 if customer linked to draft has since been soft-deleted.
4. **Credit limit check** — enforced only for credit customers (`terms_days > 0`) with a non-NULL `credit_limit`. Rejects with HTTP 400 if `outstanding_balance + grand_total > credit_limit` (Requirements §13.6).
5. **Payment mode validation** — all tender `payment_mode_id` values must exist and be active.
6. **Draft item replacement** — bulk-deletes old `SaleItem` rows (no cost data); flushes before creating new ones.
7. **Per-variant processing**:
   - *Non-Inventory / Service*: SaleItem row written, no ledger, no FIFO.
   - *Bundle*: exploded to components; each component's FIFO consumed, `SALE` ledger entry written, `current_stocks` upserted; one SaleItem at bundle level with no cost snapshot.
   - *Regular Inventory*: FIFO consumed, `SALE` ledger entry, `current_stocks` upserted, one SaleItem row per FIFO layer split with full cost snapshot.
8. **Totals recalculated** from final SaleItem rows: `subtotal`, `grand_total`.
9. **AR ledger SALE entry** written (`+grand_total`, reason `SALE`) before payments.
10. **Tenders applied** — each tender creates a `CustomerPayment` + `CustomerPaymentApplied`; overpayment remainder stored in `unapplied_amount`; AR ledger `PAYMENT` entry written per applied tender.
11. **`balance_due` / `payment_status`** computed from total applied vs. grand_total.
12. **`customer.outstanding_balance`** updated transactionally (`+grand_total − total_applied`).
13. **Sale header finalised** — `sale_pid = SALE-{id:05d}`, `sale_date = now()`, `status = Posted`, `due_date` set for credit customers only, `audit_variance` computed if `receipt_grand_total` is present.
- **Response** — `SaleOut` with `items` collapsed to one display line per variant via `_collapse_items`.

---

## 2026-05-29 — Sales Batch 5 (draft sale lifecycle)

### `sales/router.py`

Three module-level helpers added:
- `_load_draft(sale_id, db)` — loads a Draft-status sale with `items → variant` selectinloaded; raises 404 if not found or not a Draft.
- `_build_sale_items(items_in)` — converts a list of `SaleLineItemIn` into unsaved `SaleItem` rows; `line_total` quantised to 2 d.p.
- `_recalculate_totals(sale)` — recomputes `subtotal_amount`, `grand_total`, and `balance_due` from current `sale.items`. Used on both create and update.

Five endpoints added:

| Endpoint | Key behaviour |
|----------|---------------|
| `POST /sales/drafts` | Creates a Draft. Idempotency check first — returns existing sale if key seen before. Validates location (Active), register (active, if given), customer (not deleted, if given). `sale_pid` and `sale_date` left NULL. Totals computed from items. |
| `GET /sales/drafts` | Lists Draft-status sales newest-first; optional `?location_id=` and `?register_id=` filters. |
| `GET /sales/drafts/{id}` | Returns a single draft with nested items. |
| `PATCH /sales/drafts/{id}` | Updates header fields and/or fully replaces line items. When `items` is supplied, `cascade="all, delete-orphan"` removes old `SaleItem` rows atomically. Totals recalculated after every change. |
| `DELETE /sales/drafts/{id}` | Sets `status = Voided`. No stock movement, no ledger write. |

---

## 2026-05-29 — Sales Batch 4 (POS catalog endpoint)

### `inventory/schemas.py`
- `POSStockEntry` — simplified stock entry: `location_id`, `location_name`, `quantity`.
- `POSVariantOut` — variant row for the POS catalog: `variant_id`, `PID`, `variant_name`, resolved `price`, `promo_price`, `attributes`, `barcodes`, `stock`.
- `POSCatalogItemOut` — product row for the POS catalog: `product_id`, `product_name`, `product_type`, `variants`.

### `inventory/router.py`
- `GET /products/pos-catalog` — read-only endpoint for full POS catalog caching. Registered before `GET /products/{product_id}` to ensure correct route resolution.
  - Filters: `product.is_deleted = false` AND `product.status = Active`; variants filtered to `is_deleted = false` in Python after load.
  - Products with no active variants are omitted from the response.
  - Price resolution: each variant's `price` falls back to the default sibling's `price` when NULL (Requirements §6.2).
  - Stock: `current_stocks` loaded via `selectinload`; virtual-location entries (`location_type = Virtual`) filtered out in Python (Requirements §9.7). Only `location_id`, `location_name`, and `quantity` are included — no cost data.
  - `promo_price` returned as-is; frontend should display it in place of `price` when set.

---

## 2026-05-29 — Sales Batch 3 (customer endpoints)

### `sales/router.py`
- `GET /sales/customers` — list non-deleted customers ordered by name; optional `search` query param filters by name substring (case-insensitive `ILIKE`).
- `POST /sales/customers` — create customer; `outstanding_balance` always initialised to `0` regardless of payload.
- `GET /sales/customers/{id}` — get a single non-deleted customer.
- `PATCH /sales/customers/{id}` — update `customer_name`, `credit_limit`, and/or `terms_days`.
- `DELETE /sales/customers/{id}` — soft-delete (`is_deleted = true`); returns HTTP 400 if `outstanding_balance > 0` (Requirements §12.1).

---

## 2026-05-29 — Sales Batch 2 (sales settings endpoints)

### `sales/router.py` (new)
- Router mounted at `/sales` with router-level JWT authentication (`get_current_user`). Granular permission guards deferred to Batch 12.
- `GET /sales/payment-modes` — list all payment modes (active and inactive). No soft-delete on payment modes per Requirements §11.1.
- `POST /sales/payment-modes` — create a payment mode.
- `PATCH /sales/payment-modes/{id}` — update `name`, `is_physical`, and/or `is_active`. Use `is_active = false` to retire a mode.
- `GET /sales/registers` — list all registers with nested location detail.
- `POST /sales/registers` — create a register; validates `location_id` exists, is not deleted, and has `status = Active`. Returns HTTP 400 otherwise.
- `PATCH /sales/registers/{id}` — update `name`, `location_id`, and/or `is_active`; re-validates location if `location_id` changes.

### `main.py`
- `from sales.router import router as sales_router` added; `app.include_router(sales_router)` mounts the sales router.

---

## 2026-05-29 — Sales Batch 1 (models and migrations)

### `sales/` (new module)
- `sales/__init__.py` — new package.
- `sales/models.py` — 12 SQLAlchemy models covering the full sales schema:
  - `PaymentMode` — payment mode catalog (`Cash`, `GCash`, `Maya`, etc.); `is_physical` and `is_active` flags.
  - `CashRegister` — POS terminal tied to a location; `is_active` flag.
  - `Customer` — customer master; `credit_limit`, `terms_days`, cached `outstanding_balance`, soft-delete.
  - `ArLedger` — immutable AR event log; reasons `SALE`, `PAYMENT`, `RETURN`, `ADJUSTMENT`.
  - `Sale` — sale header; `sale_pid` nullable until posted; `sale_status` (`Draft`/`Posted`/`Voided`), `sale_payment_status` (`Unpaid`/`Partial`/`Paid`); `idempotency_key` unique constraint.
  - `SaleItem` — one row per FIFO cost layer consumed; cost snapshot (`gross_cost`, `supplier_discount`, `net_unit_cost`) locked at post time; unique on `(sale_id, variant_id, cost_layer_id)`.
  - `CustomerPayment` — payment record; `unapplied_amount` for overpayments.
  - `CustomerPaymentApplied` — bridge table linking payments to specific sales.
  - `SalesReturn` — return header; `return_pid` nullable until generated; `sale_id` nullable for blind returns.
  - `SalesReturnItem` — return line; `sale_item_id` nullable for blind returns.
  - `SupplierReturn` — supplier return header; status `Draft`/`Shipped`/`Credit_Received`.
  - `SupplierReturnItem` — supplier return line; references exact `cost_layer_id` for COGS credit.
- `sales/schemas.py` — Pydantic schemas for all 12 models: `...Create`, `...Out`, `...Patch`/`...In` as appropriate. Includes `SaleLineItemIn`, `SaleVoidRequest`, `PaymentApplicationIn`, `ManualPaymentApplyIn`, `SupplierReturnStatusPatch`.

### `main.py`
- `sales` schema created on startup (`CREATE SCHEMA IF NOT EXISTS sales`).
- `from sales import models as sales_models` added to the model import block; FK resolution order is now `auth → inventory → procurement → ap → sales`.

---

## 2026-05-29 — Batch 6 (JWT enforcement and audit log)

### `core/audit.py` (new)
- `_serialize(obj)` — converts any ORM instance to a JSON-safe dict (handles `Decimal` → str, `datetime`/`date` → ISO string, SQLAlchemy Enum → `.value`).
- `write_audit(db, table_name, record_pk, action, actor_user_id, old_values, new_values)` — appends an immutable `auth.audit_log` row to the current session. Does not commit; callers commit with the main transaction.

### `auth/dependencies.py`
- `get_current_user()` stub replaced with real JWT decoding via `jwt.decode()`. Raises HTTP 401 on expired or malformed tokens, and when the user is not found or deactivated.
- `SECRET_KEY` and `ALGORITHM` constants moved here so the token issuer (`auth/router.py`) and validator share the same source.
- `ROLE_PERMISSIONS` expanded from 4 to 13 permissions covering all modules: `view_inventory`, `manage_products`, `manage_locations`, `create_transfer`, `receive_transfer`, `edit_transfer_header`, `manage_suppliers`, `manage_purchase_orders`, `confirm_shipment`, `manage_invoices`, `manage_payments`, `manage_ap_ledger`, `manage_users`.
- Four roles defined: `ADMIN` (all permissions), `WAREHOUSE_MANAGER`, `WAREHOUSE_STAFF`, `ACCOUNTANT`.

### Router-level authentication
All four protected routers now declare `dependencies=[Depends(get_current_user)]`, enforcing a valid JWT on every route without changing individual endpoint signatures:
- `inventory/router.py`
- `inventory/transfers_router.py`
- `procurement/router.py`
- `ap/router.py`

`auth/router.py` public endpoints (`POST /auth/register`, `POST /auth/login`) remain unauthenticated. User-management endpoints now require `require_permission("manage_users")`.

### Permission guards on write operations
Specific `require_permission()` guards added to:
- `manage_products`: product create/update/delete, supplier create/update/delete
- `manage_locations`: location create/update
- `create_transfer`: transfer create
- `manage_purchase_orders`: PO create, item update, status change
- `confirm_shipment`: shipment confirm
- `manage_invoices`: invoice create, amend
- `manage_payments`: payment create
- `manage_ap_ledger`: manual ledger entry
- `manage_users`: user deactivate, roles update, password change

### Audit log writes
`write_audit()` called at every significant INSERT, UPDATE, and DELETE across all modules, with `actor_user_id` from the authenticated user:
- `auth.users`: register, deactivate, role change, password change
- `inventory.products`: create, update, soft-delete
- `inventory.suppliers`: create, update, soft-delete
- `inventory.locations`: create
- `procurement.purchase_orders`: create, status change
- `ap.supplier_invoices`: create
- `ap.supplier_payments`: create

---

## 2026-05-29 — Batch 5 (missing endpoints)

### `inventory/schemas.py`
- `UOMCreate`, `UOMUpdate` added; `UOMOut` now includes `is_deleted`.
- `CategoryCreate`, `CategoryUpdate` added; `CategoryOut` now includes `is_deleted`.

### `inventory/router.py`
- `GET /products/uoms` — list non-deleted UOMs.
- `POST /products/uoms` — create UOM (`uom_code` auto-uppercased, duplicate rejected).
- `PATCH /products/uoms/{id}` — update `uom_name`.
- `GET /products/categories` — list non-deleted categories.
- `POST /products/categories` — create category with optional parent; validates parent exists.
- `PATCH /products/categories/{id}` — update name and/or parent.
- `GET /products/variants/{id}` — standalone variant GET; if `price` is NULL, falls back to the default sibling's price (Requirements §6.2).
- `GET /products/variants/{id}/stock` — stock levels across all non-virtual, non-deleted locations (Requirements §9.7).

### `inventory/transfers_router.py`
- `GET /transfers/locations/{id}` — single location detail endpoint.

### `procurement/schemas.py`
- `POItemUpdate` added (`ordered_quantity`, `unit_cost`, both optional).

### `procurement/router.py`
- `PUT /procurement/orders/{po_id}/items/{po_item_id}` — update a PO line item. Blocked on Closed/Cancelled POs. Recalculates `total_amount` after update.

### `auth/schemas.py`
- `UserActiveUpdate`, `UserRolesUpdate`, `UserPasswordChange` added.

### `auth/router.py`
- `PATCH /auth/users/{id}/active` — activate or deactivate a user account (Requirements §4.1).
- `PUT /auth/users/{id}/roles` — replace user role assignments; creates new Role rows on the fly if needed (Requirements §4.2).
- `PATCH /auth/users/{id}/password` — change password; returns 204 (Requirements §4.1).

---

## 2026-05-29 — Batch 4 (AP completeness)

### `ap/schemas.py`
- `InvoiceOut` now exposes `amended_amount: Optional[Decimal]` and `amendment_notes: Optional[str]` — both were in the model but absent from the response schema.
- New `InvoiceAmend` schema: payload for `PATCH /ap/invoices/{id}`.
- New `ManualApLedgerCreate` schema: payload for `POST /ap/ledger`.

### `ap/router.py`
- `_recalculate_invoice_status` now uses `amended_amount` when set, falling back to `total_amount`. Previously payments were compared against `total_amount` even after an amendment, causing invoices to show the wrong status (Requirements §10.1).
- `PATCH /ap/invoices/{invoice_id}` — new endpoint to set `amended_amount` and/or `amendment_notes` on an existing invoice. Status is recalculated against the new effective amount immediately on save.
- `POST /ap/ledger` — new endpoint for manual `CREDIT_MEMO` and `ADJUSTMENT` entries. `INVOICE` and `PAYMENT` reasons are rejected (those are written automatically). Used for supplier return recoveries and free replacement stock scenarios (Requirements §9.3, §10.4).

---

## 2026-05-29 — Batch 3 (transfer and PO correctness)

### `inventory/transfers_router.py`
- `_move_variant` now accepts `out_reason` and `in_reason` keyword params (defaults: `TRANSFER_OUT` / `TRANSFER_IN`).
- `create_transfer` captures both validated `Location` objects during the existing validation loop. If either location's name is `"Adjustment"`, both reasons are set to `ADJUST` and forwarded to all `_move_variant` calls (direct variant and each bundle component). The `ADJUST` `LedgerReason` value was previously dead code (Requirements §9.4).

### `procurement/router.py`
- `_PO_TRANSITIONS` dict enforces valid status progressions: `Draft → {Open, Cancelled}`, `Open → {Partially_Received, Closed, Cancelled}`, `Partially_Received → {Closed, Cancelled}`, `Closed / Cancelled → {}` (terminal). `update_po_status` now loads the PO first, checks against the allowed set for the current status, and returns HTTP 400 on invalid transitions. Previously any status value was accepted silently (Requirements §8.1).
- `create_purchase_order` bug fixed: previously flushed with `po_pid = None`, violating the `NOT NULL` constraint. Now sets a unique UUID placeholder before flush and replaces it with `PO-{id}` afterwards.

---

## 2026-05-28 — Batch 2 (receiving correctness)

### `procurement/router.py`
- `confirm_shipment` now correctly splits `quantity_actual` into accepted (`quantity_actual - quantity_rejected`) and rejected. Accepted qty enters the destination location; rejected qty is routed to the Quarantine virtual location — each gets its own `InventoryLedger` RECEIVE entry, `CurrentStock` upsert, and `CostLayer`.
- Non-Inventory/Service guard added: `confirm_shipment` checks `product.product_type` before writing any ledger/stock/layer records. Non-Inventory and Service variants are skipped entirely.
- Auto-invoice creation: `confirm_shipment` now creates a `SupplierInvoice` in the same transaction (`total_amount = Σ quantity_declared × net_unit_cost`; `due_date = today + supplier.terms`). An `INVOICE` entry is written to `ap_ledger`. `ConfirmResult` now includes `invoice_id`.
- `_upsert_stock` replaced with a PostgreSQL `INSERT … ON CONFLICT DO UPDATE` — atomic and safe when multiple details for the same variant+location are processed within one `autoflush=False` transaction (previously produced a unique constraint violation).

### `inventory/transfers_router.py`
- `_upsert_stock` replaced with the same PostgreSQL upsert pattern (same root fix).
- Non-Inventory/Service guard added to `create_transfer`: checks `product.product_type` before calling `_move_variant`. For bundles, also checks each component's type individually before exploding.

### `procurement/schemas.py`
- `ReceivingDetailCreate` and `ReceivingDetailOut` now include `received_at` and `inspected_at` (both `Optional[datetime]`). Previously both fields were in the model but always stored as NULL.
- `ConfirmResult` now includes `invoice_id: Optional[int]`.

---

## 2026-05-28 — Batch 1 (data integrity)

### `alembic/env.py`
- Fixed URL encoding bug: `DATABASE_URL` now uses `safe_password` (via `quote_plus`) instead of raw `db_password`. Passwords with special characters no longer break Alembic migrations silently.
- Fixed stale model imports: replaced `sales.models` with the correct `auth → inventory → procurement → ap` import order.

### `ap/schemas.py`
- `InvoiceOut.shipment_id` changed from `int` to `Optional[int] = None` to match the nullable column in the `SupplierInvoice` model. Previously, any invoice without a shipment link would fail schema validation on the response.

### `auth/router.py`
- `POST /auth/login` now writes a `LoginAttempt(success=False)` record before raising HTTP 403 when `is_active = False`. Requirements §4.1 requires all failed attempts to be recorded regardless of reason.

### `inventory/transfers_router.py`
- `_consume_fifo` now runs a pre-flight check against `current_stocks.quantity` before querying or locking cost layers. If `current_stocks` and cost layers ever drift out of sync (e.g. a failed partial transaction), this returns a clear 400 before stock can go negative.

---

## 2026-05-28

### Schema additions
- `procurement.receiving_details`: added `received_at datetime`, `inspected_at datetime`
- `ap.supplier_invoices`: added `amended_amount decimal(15,2)`, `amendment_notes text`
- `inventory.locations`: added `is_system boolean not null default false`

### Business logic — Rule 1: is_default exclusivity on Variant
- `inventory/router.py`: `_enforce_single_default()` already wired into `add_variant` and `update_variant`
- Added guard in `update_variant`: rejects `is_default=false` on the sole default variant
- Added guard in `delete_variant`: rejects soft-delete of the default variant

### Business logic — Rule 2: System location seeding
- `inventory/models.py`: `is_system` column added to `Location`
- `main.py`: `_seed_system_locations()` runs after `create_all`; idempotently creates Quarantine and Adjustment as Virtual/Active/is_system=True
- `inventory/transfers_router.py`: `update_location` rejects any modification to a system location

### Business logic — Rule 3: FIFO cost layer consumption on outbound movements
- `inventory/transfers_router.py`: added `_consume_fifo()` — deducts oldest-first with row-level locking; raises 400 on insufficient layers
- Added `_create_transfer_layers()` — creates matching cost layers at destination, proportionally scaled if actual_in ≠ actual_out
- `create_transfer` now calls both helpers per item inside the same transaction

### Business logic — Rule 4: Bundle explosion on outbound movements
- `inventory/transfers_router.py`: added `_get_bundle_components()` helper
- Extracted per-variant movement logic into `_move_variant()` helper
- `create_transfer` detects bundle variants and explodes each into component movements; `InventoryTransferItem` retains bundle-level quantities for document trail

### Business logic — Rule 5: Soft delete guards on all routers
- `inventory/router.py` `delete_product`: cascades soft-delete to all active child variants
- `inventory/router.py` `add_bundle_component`: validates component variant exists and is not soft-deleted
- `inventory/router.py` `add_variant_supplier`: validates supplier exists and is not soft-deleted
- `inventory/transfers_router.py` `create_transfer`: validates both locations exist, are not deleted, and are Active
- `procurement/router.py` `add_receiving_details`: validates variant and location exist, are not deleted, and location is Active
