# Inventory Section — Tooltip Audit

**Purpose:** Discovery/documentation pass ahead of writing tooltip copy for the Inventory section (Catalogue, Stock, Procurement, and the Inventory-relevant Settings tabs). No tooltips were implemented in this pass — this document catalogs every interactive element per screen, flags non-obvious behavior and business logic, and notes where the app already has a tooltip pattern to extend.

**Scope:** `/inventory/*`, `/stock/*`, `/procurement/*`, plus the Locations / UOMs / Categories / Inventory Policy tabs in Settings and the inventory-relevant entities in Import Hub. Sales, Customers, AP/Payments, and Auth screens are out of scope.

**Method:** Six research passes read every file in scope against `docs/requirements.md` and `docs/schema.dbml` as the source of truth for business rules, then cataloged every field/button/dropdown/badge/checkbox/icon with its business logic, non-obvious behavior, domain terminology, and a Low/Medium/High "confusion risk" for a first-time user.

**A note on scope creep:** several passes surfaced real correctness bugs and permission gaps while reading the code — not tooltip material, but worth knowing before writing copy that would otherwise describe intended behavior rather than actual behavior. These are consolidated in the [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) section below, and also called out inline where they occur.

---

## Pending Bug-Dependent Tooltips

Tooltip copy is being implemented against `docs/requirements.md`'s *documented/intended* behavior for these elements, not the app's current (buggy) behavior — the copy describes what the field is supposed to do. Once the underlying bug is fixed, re-check these specific tooltips against real behavior and remove this section's entry (and the `TOOLTIP-TODO(bug)` comment above the `<Tooltip>` call in code) once confirmed accurate.

| # | Bug | Tooltip instance | Mismatch |
|---|---|---|---|
| 1 | `ReceivingNew.tsx`'s `handlePost` hardcodes `quantity_rejected: '0'` in the submit payload regardless of the Qty Rejected field's value | `frontend/src/pages/stock/ReceivingNew.tsx` — column header tooltip on **Qty Rejected** (line-item grid) | Tooltip says rejected units are "routed to the Quarantine virtual location and excluded from active stock" (per requirements §9.1) — currently nothing is routed anywhere; the value is discarded before the API call. |
| 2 | `ReceivingNew.tsx`'s `handlePost` hardcodes `qc_status: 'Passed'` in the submit payload regardless of the QC Status field's value | `frontend/src/pages/stock/ReceivingNew.tsx` — column header tooltip on **QC Status** (line-item grid) | Tooltip describes QC status as affecting whether units enter active stock — currently whatever the user selects (or the auto-suggest computes) is discarded; every line is always submitted as `Passed`. |
| 3 | `TransferNew.tsx`'s `handlePost` never includes `remarks` in the `stockApi.transfers.create()` payload — the value is captured in component state but never sent | `frontend/src/pages/stock/TransferNew.tsx` — field label tooltip on **Remarks** (header fields) | Tooltip says "Optional internal note saved with this transfer record" — currently anything typed here is silently discarded on submit; nothing is saved. |
| 4 | `NewProduct.tsx`'s `handleSubmit` wraps each per-sub-entity POST (supplier link, bundle components, barcodes, UOM conversions) in `.catch(() => {})` | `frontend/src/pages/inventory/NewProduct.tsx` — icon-only tooltip next to the **Create Product** button | Tooltip describes a single atomic creation ("Creates the product, its variants, and any barcodes, UOM conversions, bundle components, and supplier links you've added") — currently any individual sub-entity failure is silently swallowed; the product/variants are still created and you're navigated away with no indication a sub-record didn't save. |
| 5 | `Detail.tsx`'s `handleAddVariantSubmit` (Add Variant modal) wraps each per-sub-entity POST (supplier link, barcodes, UOM conversions, bundle components) in `.catch(() => {})` — same root cause as #4, different file | `frontend/src/pages/inventory/Detail.tsx` — icon-only tooltip next to the **Create Variant** button (Add Variant modal) | Same mismatch as #4: tooltip describes atomic creation; currently a sub-entity failure is silently swallowed and you're navigated to the new variant's page regardless. |
| 6 | `Detail.tsx` fetches `bundle_available_stock` from the API but never renders it anywhere on the page | `frontend/src/pages/inventory/Detail.tsx` — **Total Physical** stat label (Stock section) | Tooltip's note describes a buildable-quantity figure being shown "here" for bundle variants ("shown here as a derived buildable quantity") — no such figure is actually rendered anywhere on this page today; a bundle variant's Total Physical is always 0 with nothing else to look at. |

All items from the original 3-bug list (now 6 tooltip instances across those bugs, since two of the three affected more than one screen or field) are tracked above.

---

## Other Pre-Existing Inaccuracies Flagged (Not Tooltip-Copy Mismatches)

Unlike the table above, these aren't cases where new tooltip copy describes intended-vs-actual behavior — they're existing, already-visible UI text that's inaccurate on its own, discovered while writing tooltip copy nearby. No tooltip was added at the flagged location, specifically to avoid either repeating or contradicting the existing incorrect text. Tracked here in the same format so they aren't lost when triaged later.

| # | Issue | Location | Detail |
|---|---|---|---|
| 1 | Export checkbox label claims a re-import-anchoring purpose the bulk-import flow doesn't actually use | `frontend/src/pages/inventory/Catalogue.tsx` — Export Options modal, **"variant_id (for re-import anchoring)"** checkbox | The label states the exported `variant_id` column is "for re-import anchoring," but the bulk-import flow (`NewProduct.tsx`'s 3-sheet import, `ImportHub.tsx`'s Variant Prices/Costs entities) always anchors on **PID**, never `variant_id`. No tooltip was added on this checkbox — one describing the label's stated purpose would repeat a false claim, and one describing actual import behavior would directly contradict the visible label right next to it. |

---

## Table of Contents

0. [Pending Bug-Dependent Tooltips](#pending-bug-dependent-tooltips)
0. [Other Pre-Existing Inaccuracies Flagged (Not Tooltip-Copy Mismatches)](#other-pre-existing-inaccuracies-flagged-not-tooltip-copy-mismatches)
1. [Existing Tooltip Pattern in the Codebase](#existing-tooltip-pattern-in-the-codebase)
2. [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope)
3. Module: Catalogue (`/inventory`)
   - [Catalogue List](#catalogue-list)
   - [New Product](#new-product)
   - [Variant Detail](#variant-detail)
4. Module: Stock (`/stock`)
   - [Inventory Ledger](#inventory-ledger)
   - [Reason Glossary](#reason-glossary)
   - [Stock Transfers List](#stock-transfers-list)
   - [New Stock Transfer](#new-stock-transfer)
   - [Transfer Detail](#transfer-detail)
   - [Receiving — Shipment List](#receiving--shipment-list)
   - [Receiving New — Create Shipment (Stage 1)](#receiving-new--create-shipment-stage-1)
   - [Receiving Detail](#receiving-detail)
   - [Receiving Confirm — Confirm Costs (Stage 2)](#receiving-confirm--confirm-costs-stage-2)
5. Module: Procurement (`/procurement`)
   - [Suppliers](#suppliers)
   - [Purchase Orders](#purchase-orders)
   - [Purchase Order Detail](#purchase-order-detail)
6. Module: Settings (Inventory-relevant tabs)
   - [Locations](#locations)
   - [Units of Measure](#units-of-measure)
   - [Product Categories](#product-categories)
   - [Inventory Policy](#inventory-policy)
   - [Import Hub](#import-hub)
7. [Appendix: Route Map](#appendix-route-map)

---

## Existing Tooltip Pattern in the Codebase

**No shared `<Tooltip>`/`<Tip>` component exists anywhere in `frontend/src/components/`.** The pattern is duplicated locally, hand-rolled with Tailwind `group-hover`, in two files:

- **`frontend/src/pages/sales/SalesLedger.tsx`** (outside this audit's scope, but the closest full precedent) — a local `Tip({ children, tip })` component, used 7 times for KPI-label tooltips.
- **`frontend/src/pages/inventory/Catalogue.tsx`** (lines ~64–84) — the one existing tooltip inside the Inventory section itself, on the stock-quantity cell. Implementation detail, since this is the pattern any new Inventory tooltips would most naturally extend or replace:
  - Trigger and panel share a **named** Tailwind group (`group/stock` or `group/bstock`) — necessary because multiple stock cells can sit side-by-side in the same row and a plain unscoped `group` would cross-trigger.
  - Trigger text uses `cursor-help underline decoration-dotted underline-offset-2` — a dotted underline is this app's only visual "hover for more" signal; there's no icon convention.
  - Panel is `absolute right-0 bottom-full mb-1.5` (pops upward, right-aligned), `invisible pointer-events-none` by default, `visible` purely via `group-hover/stock:visible` CSS — no JS state, no click-to-open, no keyboard/focus trigger, no animation delay.
  - Styled as a dark card: `bg-gray-900 border border-gray-700 rounded-md shadow-xl`, `z-30`, `text-[10px]`, muted uppercase header line.
  - `UomStockCell` shows a data table (UOM code → sellable-pack count); `BundleStockCell` shows a static two-line explanatory note.
  - **Accessibility gap worth carrying into any tooltip redesign**: purely hover-based, no touch or keyboard equivalent — unreachable on touch devices.

**Native `title=` (browser tooltip) usage** — scattered, inconsistent, and mostly undocumented as a deliberate pattern:
- `Detail.tsx`: 16 raw `title=` hits, but 12 are actually the `<SectionHead title="...">` **prop** (rendered as visible heading text, not a real tooltip). Only **4 are genuine native tooltips** — see the [Variant Detail](#variant-detail) section for the exact text of each; two of them duplicate static helper text already shown elsewhere on the same field.
- `Settings.tsx`: 15 occurrences, spread across both in-scope tabs (Locations/UOMs/Categories/Inventory Policy) and out-of-scope tabs.
- Scattered single/few uses in out-of-scope files (`SaleDetail.tsx`, `SalesLedger.tsx`, `ap/InvoiceList.tsx`, `ap/InvoiceDetail.tsx`, `customers/PDCVault.tsx`, `sales/Workstation.tsx`).
- **No CSS/UI tooltip library is used anywhere** (no Radix, Headless UI, Floating UI, etc.) — everything in the app is hand-rolled.

**Implication for the tooltip-copy pass:** since both existing implementations are copy-pasted per-file rather than shared, this is a natural moment to decide whether to extract a single `<Tip>`/`<Tooltip>` component into `components/` before adding more instances into Catalogue, Detail, NewProduct, and the Stock/Procurement/Settings screens — versus continuing the copy-paste pattern. Not resolved in this pass; flagging for the next planning step.

---

## Findings Beyond Tooltip Scope

These surfaced incidentally while reading the code for tooltip candidates. None were fixed — this is a discovery pass only — but they matter because tooltip copy should describe what the screen *actually does*, not what the requirements doc says it should do. Roughly ordered by severity:

- **Silent sub-entity save failures on variant creation.** Both `NewProduct.tsx` (Create Product wizard) and `Detail.tsx`'s "Add Variant" modal POST each sub-entity (barcodes, UOM conversions, bundle components, supplier links) as a **separate follow-up call wrapped in `.catch(() => {})`**. Any individual failure (duplicate barcode, invalid UOM pair, bad supplier link) is swallowed — the product/variant is still created, the user is navigated to its detail page, and nothing on screen indicates a sub-record didn't save. The user must manually re-check every sub-section to discover what's missing.
- **Receiving Stage 1 discards rejected-quantity and QC data before it reaches the backend.** In `ReceivingNew.tsx`, `handlePost` hardcodes `quantity_rejected: '0'` and `qc_status: 'Passed'` in the submit payload regardless of what the user entered in the Qty Rejected and QC Status fields. Per requirements §9.1, rejected units should route to the virtual Quarantine location via a `RECEIVE` ledger entry — **that rule never actually fires from this screen**, and the on-screen advisory text ("Rejected quantities will be automatically routed to Quarantine") is currently false for any shipment created here.
- **`bundle_available_stock` is computed by the backend but never rendered in the UI.** `Detail.tsx` fetches this per-location "how many bundles can be assembled right now" value, but no element on the Variant Detail page displays it — the Stock section shows only raw `current_stock`, which is always 0 for a bundle variant by design. There is currently no screen where a user can see a bundle's real availability.
- **Price "Override" button on Variant Detail falls back to `?? 0`.** If a non-default variant has no default sibling to inherit from (edge case, but reachable), clicking "Override" writes a literal `0.00` price rather than leaving the field blank or erroring.
- **`TransferNew.tsx`'s Remarks field is discarded.** Captured in component state, styled and labeled like every other field, but never included in the POST payload — anything typed there vanishes silently on submit.
- **Transfer void reversal always uses `TRANSFER_IN`/`TRANSFER_OUT` ledger reasons, never `ADJUST`.** Per requirements §9.2 rule 4, a transfer touching the virtual Adjustment location should post `ADJUST` — but `void_transfer` in the backend never passes `out_reason`/`in_reason`, so voiding an adjustment produces reversal ledger rows with mismatched semantics from the original movement.
- **Purchase Order Detail has weaker frontend permission gating than its sibling screens.** The status-change buttons (Confirm/Cancel) and inline line-item editing render for any logged-in user regardless of `manage_purchase_orders`, unlike the list page and Suppliers page which hide "+ New" buttons entirely for unauthorized users. The backend's `update_po_item` endpoint has **no `require_permission` check at all** — any authenticated user can edit PO line items on a Draft/Open PO via a direct API call.
- **Settings → Categories parent-selector blocks self-selection but not indirect cycles.** A category can't be set as its own parent, but nothing stops picking one of its own descendants as its parent (e.g. a grandchild), which would create a cycle. Unclear whether the backend guards against this either.
- **Two parallel, inconsistent authorization systems gate different buttons on the same Catalogue screen.** "+ New Product" is gated by a hardcoded role-name array (`CAN_EDIT = ['ADMIN','STORE_MANAGER','WAREHOUSE_MANAGER']`), while row-level View/Edit access is gated by the `manage_products` action key. A user can hold one without the other. (This matches a known gap already logged in `docs/backlog.md`'s RBAC audit section — STORE_MANAGER sees an editable UI it can't actually use.)
- **`is_phased_out` is used throughout Catalogue.tsx and Detail.tsx but does not appear in `docs/schema.dbml` or `docs/requirements.md`.** Likely schema-documentation drift rather than a UI bug, but worth reconciling before writing tooltip copy that claims authoritative behavior for this field.
- **Receiving list's derived "Pending Confirmation" status can't detect a failed/partial Stage 1 save.** `ReceivingNew.tsx` makes three sequential network calls (create shipment → add details → receive); if the third call fails after the second succeeded, the shipment has detail rows but no actual ledger/stock write, yet still displays as "Pending Confirmation" — indistinguishable from a healthy shipment awaiting Stage 2. None of the four Receiving screens offer a way to add details to or recover an orphaned shipment.
- **`parent_location_id` (unlimited location nesting, per requirements §5.1) has no UI surface at all.** The field exists in the schema and API types, but the Locations tab in Settings has no control to set it on create/edit and no tree/indentation to display it on read.

---

## Module: Catalogue (`/inventory`)

### Catalogue List

## Catalogue (`frontend/src/pages/inventory/Catalogue.tsx`)
**Route:** `/inventory` (index route under `Inventory.tsx`)
**Purpose:** Browsable, filterable, sortable list of every product variant with per-location stock, price/promo columns, and an Excel export — the main landing page of the Inventory module.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **Keyword search box** (`KeywordSearch`) | Type + Enter commits a dismissible "tag"; typing without Enter live-filters (300ms debounce) | Searches brand, variant name, PID, SKU, barcode value, category name (all via `normalize()`, case/diacritic-insensitive) | Multiple committed tags are **ANDed**, not ORed — adding a second keyword narrows results further, it does not broaden them. Tags persist in the URL (`?kw=`). Backspace on empty input deletes the last tag. | "PID" vs "SKU" — see below | Medium — AND semantics of multi-tag search surprises users expecting OR |
| **Category dropdown** | Single-select filter by category | Matches if *any* of the product's linked categories equals the selected one (`product_category_links`, requirements §5.4: "A product may belong to multiple categories") | The table only ever displays the product's **first/primary** category (`p.categories[0]`). A product can pass the filter via a *non-primary* category while showing a different category name in the row — looks like a mismatch. | "Category" here really means "any linked category," not "the displayed category" | High |
| **Product Type checkboxes** (Inventory / Non-Inventory / Service) | Multi-select filter | `product_type` governs stock tracking per requirements §6.1: `Non-Inventory`/`Service` items are never stocked or ledgered | None selected = show all types (not "show none") | "Non-Inventory" vs "Service" — both untracked but conceptually different (goods vs. labor) | Low |
| **Status segmented control** (Active / Both / Inactive) | Filters on `product.status`, defaults to **Active** | — | New products created via the wizard default to Active | — | Low |
| **"Show negative stock only" checkbox** | Filters to variants with negative quantity at any physical location | Negative stock is only possible when the `allow_negative_stock` system policy is `'true'` (requirements §9.9) | If the policy is disabled, this checkbox will always return zero rows — looks broken rather than "correctly showing nothing" | `allow_negative_stock` policy (not visible anywhere on this screen) | Medium |
| **"Hide Phased Out" checkbox** | Hides variants with `is_phased_out = true` | — | `is_phased_out` is **not documented anywhere in `requirements.md` or `schema.dbml`** — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope). The UI implies "retired but kept for history," but there's no written rule for what phased-out actually means operationally. | `is_phased_out` | High — undocumented field, meaning must be inferred |
| **Supplier dropdown** | Filters to variants linked to the selected supplier via `variant_suppliers` | requirements §7.2: a variant may have multiple suppliers | Matches *any* linked supplier, not just the primary one | "Primary supplier" concept exists but isn't distinguished in this filter | Low |
| **Attribute filters** (dynamic, one text box per unique attribute key found across loaded variants) | Free-text substring filter (case-insensitive) per JSONB attribute key | `variants.attributes` JSONB, e.g. `{"size":"10-inch","color":"silver"}` (requirements §6.2) | The list of filterable keys is derived from whatever attribute keys exist in the currently loaded catalogue — inconsistent tagging (e.g. "Color" vs "color") silently produces two separate filter boxes | JSONB attributes | Medium |
| **Rows-per-page select** (10/30/50/100/500) | Changes page size | — | Changing it resets to page 1 | — | Low |
| **Prev / Next pagination buttons** | Page through filtered rows | Disabled at bounds | — | — | Low |
| **Columns (⚙) picker button** | Opens a dropdown to toggle optional columns (SKU, Type, Category, Price, Promo Price, Total Stock, Status, Phased Out) and per-location stock columns (Physical vs. Virtual) | — | Selections persist to `localStorage` (`erp_catalogue_cols`) — per-browser, not per-account; switching computers resets the view | — | Medium |
| **Export XLSX button** | Opens the export options modal (only visible if `export_products` action key present) | — | Exports the currently **filtered** row set, not the whole catalogue, not limited to the current page | `export_products` permission | Low |
| **+ New Product button** | Navigates to `/inventory/new` (only visible if user's role is in hardcoded `CAN_EDIT = ['ADMIN','STORE_MANAGER','WAREHOUSE_MANAGER']`) | — | This is a **different authorization mechanism** than the `manage_products`/`export_products` action-key checks used elsewhere on the same page — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) | Two parallel permission systems on one screen | Medium |
| **Sortable column headers** | Click cycles asc → desc → unsorted (3-state) | — | Location columns are sortable too — sorting "by a warehouse's stock" isn't a typical spreadsheet affordance | — | Low |
| **Table row click** | Navigates to variant Detail page (only if `manage_products`) | — | Whole row clickable except the Actions cell | — | Low |
| **PID cell** | Displays `variant.PID`, monospace | Primary human identifier, unique (requirements §6.2) | — | PID vs SKU distinction | Medium (for new users) |
| **Brand / Variant Name cells** | Bold + full opacity if `is_default`; muted (`opacity-80` on the whole row) otherwise | Exactly one variant per product must be `is_default = true` (requirements §6.2) | "Default variant is the hero SKU" is only conveyed via subtle styling — no label/badge, no tooltip | "Default variant" | Medium |
| **SKU cell** (hidden by default) | Shows `variant.sku` or `—` | SKU is not unique, reference-only (requirements §6.2) | Hidden by default in the column picker — a new user may not know it exists or why it's off | SKU non-uniqueness | Low |
| **Price cell** | Shows `variant.price` formatted | If `price` is NULL, requirements §6.2 says the system pulls price from the default sibling variant — **the UI does not show this fallback**; a non-default variant with a null price just displays `—` even though it effectively "has" the default's price at POS | Price-inheritance-from-default rule is invisible here | High |
| **Promo Price cell** | Shows `promo_price` or `—` | requirements §6.2: promo_price, when set, **takes precedence over price for display** | Table shows Price and Promo Price as two independent columns with no indicator of which is actually charged | Promo price precedence | High |
| **Total Stock cell** | For bundles: `BundleStockCell` (derived, prefixed `~`); for normal variants: `UomStockCell` (raw base-unit qty with hover tooltip) | Bundle stock = min(component stock ÷ qty required) per location, summed across locations (requirements §6.5); normal stock = sum across **non-Virtual** locations only (requirements §9.7) | Excludes Quarantine/Adjustment stock entirely — a variant sitting entirely in Quarantine shows "0" total stock with no indication why | Bundle explosion, virtual locations | High |
| **Status badge** (Active/Inactive) | Colored pill on `product.status` | — | — | — | Low |
| **Phased Out badge** | Colored pill on `variant.is_phased_out` | Undocumented business rule | — | `is_phased_out` | High |
| **Per-location stock cells** | Physical locations: `UomStockCell`/`BundleStockCell` with tooltip; virtual locations: plain number, italic/muted, no tooltip | requirements §9.7: virtual stock excluded from active reports but still trackable | Virtual location columns are opt-in via the column picker — most users will never see Quarantine/Adjustment quantities unless they know to enable them | Quarantine, Adjustment (system-seeded virtual locations, requirements §5.2) | Medium |
| **View / Edit action links** (row-hover only) | Both call `navigate('/inventory/${variant_id}')` | — | **View and Edit are functionally identical** — no distinct read-only vs. edit mode. Hover-only means effectively undiscoverable on touch devices. | — | High |
| **Export modal → "variant_id (for re-import anchoring)" checkbox** | Adds a `variant_id` column to the export | — | Implies a re-import path keyed on `variant_id`, but the bulk-import flow in `NewProduct.tsx` always anchors on **PID**, never `variant_id` | "Anchor column" for imports | Medium |
| **Export modal → "Cost data" checkbox** | Adds `Net Unit Cost` (from `v.cost_layers[0]`) and `FIFO Layers` count | Cost layers are FIFO-ordered (requirements §9.8) | Trusts the array is already oldest-first from the API, no client-side sort/verification | FIFO cost layers | Medium |
| **Export modal → "Supplier data" checkbox** | Adds primary (or first) supplier's name/SKU/gross cost/discount | requirements §7.2: `is_primary` marks preferred supplier | Falls back to `suppliers[0]` if no primary is flagged — could silently export a non-primary supplier's cost as if it were canonical | Primary supplier, gross_cost vs net cost | Medium |
| **Export modal → "Attributes" / "Barcodes" checkboxes** | Adds one column per attribute key, or a comma-joined barcode list | — | — | — | Low |
| **Export / Cancel buttons** | Downloads `.xlsx` / closes modal | Export button also shows the row count being exported | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **Total Stock** — bundle variants use a *derived* min-ratio calculation across components (never their own row), while normal variants sum physical (non-virtual) `current_stocks`; the distinction is invisible except via the `~` prefix and amber color on bundle cells.
- **UOM breakdown tooltip contents ("Sellable packs")** — computed client-side as `floor(baseStock / factor)` for each UOM conversion that has a non-null `price` set (only conversions marked as sellable packs, not every UOM conversion, are shown).
- **Row dimming (`opacity-80`) and bold text** — purely a visual cue that a variant is *not* the product's `is_default` hero variant; not explained anywhere in the UI.
- **Status / Phased Out badges** — colored conditionally (emerald for Active, amber for Phased Out, neutral otherwise).
- **View/Edit buttons visibility** — only rendered on row hover and only if `manage_products`; Edit additionally requires the separate `CAN_EDIT` role check.
- **Attribute filter boxes** — dynamically generated based on the union of all attribute keys present in the loaded catalogue.

---

### New Product

## New Product (`frontend/src/pages/inventory/NewProduct.tsx`)
**Route:** `/inventory/new`
**Purpose:** Multi-variant product creation wizard — define the product shell, one or more variant drafts (with attributes, barcodes, UOM conversions, bundle components, and a supplier link), then submit; also hosts a 3-sheet Excel bulk-import path.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **Brand * input** | Sets `products.brand` | Required — blocks submit if empty | There is no separate "product name" field — Brand *is* the product's display name; there's no user-facing `product_id` (requirements §6.1: "no user-facing product PID") | — | Low |
| **Product Type * select** (Inventory / Non-Inventory / Service) | Sets `products.product_type`, default `Inventory` | Governs whether stock is tracked at all (requirements §6.1) | Choosing Non-Inventory/Service on a variant that also has barcodes/UOM conversions/bundle components filled in still creates those sub-records — the wizard doesn't warn they'll be functionally inert (no ledger entries ever generated for these types) | Inventory vs Non-Inventory vs Service | High |
| **Base UOM select** | Sets `products.base_uom_id` | requirements §6.1: "defines the default unit of measure for the product family" | Optional (`— none —`); no documented fallback if left blank | Base UOM | Medium |
| **Description textarea** | Free text | — | — | — | Low |
| **Categories toggle buttons** | Multi-select chips | Sent as `category_names` | Unlike the Catalogue filter dropdown, this is a full multi-select — a product can belong to many categories, but Catalogue only ever displays the first one | `product_category_links` (many-to-many, §5.4) | Low |
| **Variant Name * / PID * / SKU / Price / Promo Price inputs** (per variant card) | Core variant fields | Both Variant Name and PID required for every variant before submit; PID must be globally unique (requirements §6.2) — **not validated client-side**, only surfaces as a backend error after submit | Editing SKU auto-copies the value into the Supplier Link's "Supplier SKU" field if that field is currently empty or still equal to the old SKU — a linked-field side effect that isn't visible unless you notice the change | PID uniqueness enforced server-side only | Medium |
| **"Set default" link** (per non-default variant) | Marks this variant `is_default`, unmarks all others | requirements §6.2: exactly one default per product, auto-unset-previous — correctly enforced client-side before submit | — | "Default" hero variant | Low |
| **"Remove" link** (per variant, hidden if only 1 remains) | Deletes the variant draft | If the removed variant was the default, the **first remaining variant is silently promoted to default** — no confirmation or notice | Silent default-reassignment | Medium |
| **Attributes: Key/Value rows + "+ Add attribute"** | Builds `variant.attrs[]` → submitted as JSONB `attributes` | Empty-key rows filtered out on submit | Duplicate keys across rows aren't prevented — later duplicate silently overwrites earlier one | JSONB attributes | Medium |
| **Barcodes table: "+ Add" button** | Appends an empty barcode row and auto-expands the section | requirements §6.3: multiple barcodes per variant, each tied to a UOM | — | — | Low |
| **Barcode value input** | Free text barcode string | requirements §6.3: "The PID is used as the default identifier if no barcode entry exists" — leaving this table empty is valid and expected | — | — | Low |
| **Barcode UOM select** | Which UOM this barcode represents | requirements §6.3 | — | — | Low |
| **Barcode "Primary" checkbox** | Marks `is_primary` on that barcode row | requirements §6.3: setting a new primary must auto-demote all others *for that variant* | **The draft UI does not enforce single-primary** — you can check "Primary" on multiple rows for the same variant. Which one wins is determined by POST order, not obvious to the user | Barcode primary demotion | High |
| **Barcode remove (×)** | Deletes the barcode row | — | — | — | Low |
| **UOM Conversions table: "+ Add" button** | Appends an empty conversion row | requirements §6.4: variant-level UOM conversion factors (e.g. 1 BOX = 24 PC) | — | — | Low |
| **From / To UOM selects + Factor input** | Defines the conversion pair and factor | requirements §6.4/§9.5: factor used for repackaging math; supports decimals | Only rows with `from_uom_id`, `to_uom_id`, and `factor` all filled are submitted — silently drops partially-filled rows with no warning | UOM conversion factor | Medium |
| **"Wh. Bundle" (warehouse bundle) checkbox** | Sets `is_warehouse_bundle` on a conversion | schema.dbml note: "exactly one per variant should be true" — a *should*, not a DB constraint | Nothing in this UI prevents checking "Wh. Bundle" on multiple rows for the same variant — directly contradicts the schema's stated intent | "Warehouse bundle" unit (the UOM staff physically count in) | High |
| **UOM conversion remove (×)** | Deletes the row | — | — | — | Low |
| **"This variant is a bundle" checkbox** | Toggles `is_bundle` client-side flag, reveals the Bundle Components section | — | **This flag is never sent to the backend** — a variant is only treated as a bundle downstream if it actually has `bundle_components` rows. Checking this box with zero components added results in a perfectly normal, non-bundle variant with no warning | Bundle status is *implied* by having components, not a stored flag | High |
| **Bundle component search box** | Live-searches existing variants by PID or name as you type | requirements §6.5: bundle composed of component variants | Re-fetches the entire product catalogue on every keystroke; only searches *already-saved* variants — you can't bundle two variants both being created in the same wizard session | Bundle components | Medium |
| **Bundle component search result → click to add** | Adds the component with default quantity `1` | Prevents duplicate component add | — | — | Low |
| **Bundle component quantity input** | Sets `quantity` for that component (decimal-capable) | requirements §6.5: "quantity supports decimals to allow fractional component quantities" | — | — | Low |
| **Bundle component remove (×)** | Removes that component from the draft | — | — | — | Low |
| **Supplier Link section** (supplier select, Supplier SKU, Gross cost, Disc %) | Optional single supplier link per variant | requirements §7.2: net cost = `gross_cost × (1 - discount/100)`, never stored | Submitted with `is_primary: true` **hardcoded**, no checkbox exposing this — any supplier added here automatically becomes the variant's primary supplier, silently. Nothing blocks attaching a Supplier Link to a variant simultaneously flagged as a bundle, even though §6.5 implies bundles aren't directly sourced from a supplier | Primary supplier, gross_cost vs. net cost | High |
| **"+ Add Variant" button** | Appends a new blank (non-default) variant card | — | — | — | Low |
| **"Create Product" button** | Submits the whole wizard | Validates brand + every variant's Name/PID are filled; one `products.create` call, then a sequence of per-variant, per-sub-entity POSTs (supplier link, bundle components, barcodes, UOM conversions) | **All follow-up POSTs use `.catch(() => {})`** — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope). Any failure is silently swallowed; the product/variants are still created and the user is navigated away with no indication anything failed. | Multi-step, partially-transactional creation with no atomicity, no error surfacing | High |
| **"Cancel" button** | Navigates back to `/inventory` without saving | — | — | — | Low |
| **"Download Template" button** | Generates a 3-sheet `.xlsx` (Variants / UOM Conversions / Supplier Links) | Sheet order matters | — | — | Low |
| **"Upload & Import" file input** | Parses the uploaded `.xlsx`, matches sheets **by position** (index 0/1/2), builds preview payload, opens `ImportDiffModal` | requirements §17 lists "Bulk Excel import" as out of scope, yet a fully-functional pipeline exists in the code — a direct discrepancy between documented scope and shipped feature | Sheets matched by **index**, not name — renaming/reordering/deleting a sheet in the uploaded file silently misroutes data with no validation that sheet names match the template | 3-sheet composite-key import model | High |
| **Import results list** | Shows ok/error count and per-row messages | — | Every result row is created with `row: 0` hardcoded — the "Row X" label is **always "Row 0,"** never the actual spreadsheet row, making it impossible to trace an error to a specific line | — | High |
| **`ImportDiffModal` → per-variant "Confirm all" / "Skip all" links** | Bulk-select/deselect all previewed variants | All variants confirmed by default when the modal opens | — | — | Low |
| **`ImportDiffModal` → per-variant checkbox** | Include/exclude that variant's row(s) from the import | Unconfirmed rows render at `opacity-40` | Skipping a variant here only affects Sheet 1 (Variants). Sheets 2/3 (UOM Conversions, Supplier Links) are processed for *all* rows regardless of what was skipped — a skipped variant's PID appearing in those sheets fails with a generic "PID not found" error, not "this was skipped deliberately" | Cascading skip failures across sheets | High |
| **`ImportDiffModal` → diff table** (Field / Current / Incoming) | For `create` rows, shows every non-empty incoming field; for `update` rows, shows only changed fields | — | "Current" is blank for creates since there's nothing to diff against | Create vs. Update diff semantics | Low |
| **`ImportDiffModal` → mode badge** (create/update) | Shows whether this PID will insert or update | Determined server-side by whether the PID already exists | — | — | Low |
| **`ImportDiffModal` → "×" close / Cancel** | Closes modal without applying anything | — | — | — | Low |
| **`ImportDiffModal` → "Apply N rows" button** | Runs the confirm step; disabled while applying or if 0 rows selected | — | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **Variant "Default" badge** — shown only on the variant currently flagged `is_default`; toggling any other variant's "Set default" flips it off this one.
- **Barcodes/UOM Conversions section expansion** — collapsed by default; auto-expands once a row is added or if rows already exist.
- **Bundle Components section** — only rendered when `v.is_bundle` is checked, even though that flag has no server-side effect by itself.
- **Supplier SKU auto-fill** — silently mirrors the variant SKU field whenever SKU changes and Supplier SKU is blank or still matches the old SKU value.
- **Default reassignment on removal** — if the removed variant was the default and others remain, the first remaining variant is auto-promoted to default.
- **Import preview `create`/`update` mode and `diff_fields`** — computed server-side from matching PIDs against existing variants.
- **Import result "ok"/"error" counts** — computed client-side by filtering `importResults` by `status`.

**Tooltip pattern note:** `NewProduct.tsx` uses **no hover tooltips anywhere** — all help/context is either a plain label, a placeholder string, or nothing. Given the number of High-confusion-risk, undocumented, or silently-failing behaviors cataloged here, this is likely the single highest-priority file for the upcoming tooltip pass.

---

### Variant Detail

## Variant Detail (`frontend/src/pages/inventory/Detail.tsx`)
**Route:** `/inventory/:variantId`
**Purpose:** Single-variant read/edit workbench — core identity fields, pricing, barcodes, UOM conversions, bundle composition, supplier sourcing, and four read-only paginated history panels (price, cost, sales, purchase), plus a sibling-variant switcher and an "Add Variant" creation modal.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **Save bar — "Discard"** | Clears all unsaved edits and re-fetches from server | No confirmation dialog | Not scoped to one section — drops changes across core fields, pricing, and attributes at once | — | Medium — one click loses everything with no undo prompt |
| **Save bar — "Save Changes"** | PUTs variant edits and product edits in parallel | If PID was edited and the variant has no explicit primary barcode at the product's base UOM, a native `window.confirm()` warns the scannable code will change and labels need reprinting. Cancelling aborts the whole save (product edits included) | Product-level edits (brand, categories, etc.) are silently bundled into the same save even though they're a different entity shared across sibling variants | "PID" resolving to barcode | High — confirm only fires for PID changes, and cancelling loses unrelated edits too |
| **Breadcrumb** | Navigates back to `/inventory` | — | — | — | Low |
| **Product — Brand** | Text input, product-level (shared by all sibling variants) | — | Editing this changes the label for every variant under this product, not just the one being viewed | — | Medium — easy to think it's variant-scoped |
| **Product — Product Type** (Inventory/Non-Inventory/Service) | Governs stock tracking per §6.1 | Changing to Non-Inventory/Service stops ledger writes for **all** sibling variants going forward | Retroactive change does not reclassify historical ledger entries | "Non-Inventory" vs "Service" | High — changing this on one variant's screen silently changes behavior for the whole product family |
| **Product — Status** (Active/Inactive) | Product-level status | Not soft-delete; separate from variant-level `is_deleted` | A product can be "Active" while all its variants are deactivated, or vice versa | — | Medium |
| **Product — Base UOM** | Sets `base_uom_id` | — | Drives which barcode counts as the "explicit primary base-UOM barcode" used by the PID-save confirm logic above | "Base UOM" | Medium |
| **Product — Categories** (toggle chips) | Adds/removes category tag | UI-only filtering per §5.4 — no effect on stock/costing | — | — | Low |
| **Product — Description** | Free text | — | — | — | Low |
| **Sibling Variants — "Show inactive" checkbox** | Toggles whether soft-deleted siblings appear | — | — | — | Low |
| **Sibling Variants — table rows** | Click navigates to that sibling's Detail page | "Default"/"Inactive" badges | "Total Stock" column sums stock across physical locations only — for a **bundle** sibling this is always 0; the derived buildable quantity (`bundle_available_stock`) is never shown here | "Default" vs "Viewing" vs "Inactive" badges | High for bundle rows — reads as "0 stock" with no hint units could still be assembled |
| **Sibling Variants — deactivate (×)** | Soft-deletes the sibling after a `window.confirm()` warning | — | Does not warn if this sibling is currently `is_default` — deactivating the default variant leaves no default, breaking price/supplier inheritance for all other siblings, with nothing preventing or flagging this | — | High — no guardrail against deactivating the one variant everything else inherits from |
| **Sibling Variants — "Reactivate"** | Sets `is_deleted=false` | No confirm dialog (asymmetric with deactivate) | — | — | Low |
| **"+ Add Variant"** (canEdit only) | Opens the Add Variant modal | — | — | — | Low |
| **Variant — Variant Name** | Text input | — | — | — | Low |
| **Variant — PID** | Text input, editable | Backend enforces uniqueness and cross-namespace collision checks against other variants' explicit barcodes | Biggest hidden blast radius on the page: PID is the fallback barcode, the default source for price/supplier inheritance to *other* siblings when this variant `is_default`, and appears throughout POS/reports — none of that context is shown inline | "PID" as "the human-facing unique identifier that may double as the barcode" | High |
| **Variant — SKU** | Text input, free reference field | Explicitly **not unique** per §6.2 | Pre-fills the "Supplier SKU" field on new supplier links — a convenience that can mislead users into thinking SKU and Supplier SKU are the same concept | "SKU is reference-only, not a real key" | Medium |
| **Variant — Default Variant** (Yes/No) | Sets `is_default` | Exactly one variant per product must be default; setting Yes should atomically unset the previous default (backend-only, not visible in UI) | No confirmation despite wide effects: any sibling with blank price/promo/supplier links inherits from whichever variant is default — switching default rewires pricing/sourcing for every other sibling | "Default variant" as inheritance anchor, not just a display flag | High |
| **Variant — Include in Ordering** (checkbox, hidden for bundle-type variants) | Sets `include_in_ordering`; excludes variant from PO/ordering forms when unchecked | Per schema note, does not affect sales, receiving, or transfers — ordering only | Conditionally rendered — a user who doesn't already know a variant is a bundle simply won't see this control and won't understand why. Has a native `title=` tooltip. | "Bundle variants are implicitly excluded from ordering" is never stated when the control disappears | Medium |
| **Variant — Phased Out** (checkbox) | Sets `is_phased_out` — flags as discontinued while still tracked | Purely informational per its tooltip text | Not present in `docs/schema.dbml` — possible schema-doc drift. Has a native `title=` tooltip. | "Phased out" vs "Deactivated" (`is_deleted`) — two different discontinuation concepts on the same screen | Medium |
| **Pricing — Price** (input, or greyed inherited display) | Sets `variant.price`; when `!is_default && price == null`, shows the **default sibling's** price instead, per §6.2 | Fallback triggers purely on `price === null`, not any explicit "inherit" flag | **"Override" link** copies `defaultV?.price ?? 0` — if no default variant exists, this silently writes **0.00** as a real price. **"Reset to default"** sets price back to `null`. | "Inherited from default variant" native tooltip | High — the `?? 0` fallback is a real footgun |
| **Pricing — Promo Price** (input, or greyed inherited display) | Sets `variant.promo_price` | Inheritance condition is **stricter** than Price's: only shows "inherited" when the default sibling actually has a promo price set | Per §6.2, promo_price takes precedence over price for display — never shown/explained here. A variant can show "Inherited" for Price but a plain blank box for Promo Price simultaneously, for reasons invisible to the user. "Override" here has no `?? 0` fallback (inconsistent with Price's) | Same "Inherited" tooltip | High — two fields look parallel but follow different inheritance conditions and different override safety |
| **Attributes — value inputs** | Edits a value for an existing JSONB key | Free text, no schema/type validation | Keys are **read-only once created** — renaming requires delete + re-add | "Attributes" as freeform JSONB | Medium |
| **Attributes — delete (×)** | Removes a key locally (staged until Save) | — | — | — | Low |
| **Attributes — "+ Add attribute"** | Uses a native `window.prompt()` to ask for a key name | No duplicate-key guard — re-prompting with an existing key silently overwrites its value with `''` | Native `prompt()` is jarring/inconsistent with the rest of the app's styling | — | Medium |
| **Barcodes — "Set primary"** | Toggles `is_primary` on one row | Per §6.3, setting a new primary demotes all others server-side — UI gives zero indication other rows will silently flip | — | "Primary" barcode = the one actually scanned/printed | High |
| **Barcodes — delete (×)** | Removes a barcode (hard delete, no `is_deleted` on this table) | — | Deleting the sole primary barcode silently reverts the effective scannable code back to PID — `resolved_barcode` is never displayed anywhere on this screen | — | High |
| **Barcodes — add row** | Creates a new `variant_barcodes` row | UOM is optional despite meaningfully linking barcode→UOM (e.g. CASE vs PC barcode) | No client-side duplicate/format validation | Why a barcode needs a UOM at all (multi-pack scanning) is never explained | Medium |
| **UOM Conversions — "Toggle" (Warehouse Bundle)** | Flips `is_warehouse_bundle` on a row | Schema says "exactly one per variant should be true" — **not enforced client-side** | **Naming collision:** "Warehouse Bundle" here is unrelated to "Bundle Components" further down — one is a UOM-conversion packaging flag, the other a multi-SKU assembled product per §6.5. Both use the word "bundle." | "Warehouse Bundle" vs "Bundle" (Components) — genuinely different features sharing a name | High |
| **UOM Conversions — Price / Promo Price inline inputs** | Per-UOM override price; blank shows "inherits: ₱X" (`variant.price × factor`). Saves on blur | Silently no-ops if the value is NaN or unchanged (within 0.001) — no error shown | A user who tabs away without noticing may believe a value "didn't take" when it actually silently failed validation | "Inherits: ₱X" fallback formula not shown as a tooltip | Medium |
| **UOM Conversions — delete (×)** | Hard-deletes the row | Consistent with schema (no `is_deleted` on this table), but not obvious it's irreversible (unlike variant "deactivate" elsewhere on the page) | — | — | Medium |
| **UOM Conversions — add row** | Creates a new conversion | Factor supports 4 decimals, matching `decimal(15,4)` | No validation preventing From == To or duplicate pairs (relies on the composite PK server-side) | — | Medium |
| **Bundle Components section** (only rendered if the variant has components OR `canEdit`) | — | — | A non-editor viewing a plain (non-bundle) variant never sees this section — no "N/A" placeholder | — | Low-Medium |
| **Bundle Components — Qty display (`× {quantity}`)** | Read-only | Per §6.5, decimals supported for fractional component quantities | — | "×" prefix meaning "this many of the component per one bundle unit" | Low |
| **Bundle Components — delete (×)** | Hard-deletes the row (no `is_deleted`, consistent with §5) | — | — | — | Low |
| **Bundle Components — search-add row** | Free-text search across the entire catalogue (client-side, re-fetches on every keystroke), matches PID or name | Add button disabled until a result is explicitly clicked; quantity defaults to 1 | No client-side check preventing self-reference, nesting another bundle as a component, or duplicate components. Per §6.5, bundles can't be received/transferred directly, but nothing here stops a bundle-of-bundles from being constructed | — | High (data-integrity risk) |
| **Supplier Links — inheritance preview panel** (shown when non-default, zero supplier links, and the default sibling has some) | Greyed, read-only preview of the default sibling's supplier rows | Mirrors the price-inheritance UX, but this "supplier inheritance" is **not documented anywhere in requirements.md** — unclear/unverified whether the backend's costing fallback actually reaches across to a sibling's supplier record, or if this is purely a UI preview with no real costing effect | If the backend does not honor this, the panel is actively misleading | "Inheriting from default variant" — implies a live business rule that may not be enforced | High — flag for backend verification |
| **Supplier Links — "Set primary"** | Toggles `is_primary` | Per §7.2, demotes all others automatically server-side, invisible in the UI | Determines which supplier's cost feeds the Level-2 costing fallback (§9.3) — a high-stakes toggle presented as a plain link | — | High |
| **Supplier Links — "Edit" / inline row** | Edits SKU/cost/discount for one link | — | Cannot change which supplier a link points to — only add new or delete | — | Low |
| **Supplier Links — Gross Cost / Discount % fields** | §7.2's `gross_cost`/`supplier_discount` | Net cost = `gross_cost × (1 - discount/100)` — **never displayed anywhere on this row or table**; user must compute mentally | Distinct from `net_unit_cost` shown in Cost/Purchase History lower on the page (a locked historical FIFO snapshot) — easy to conflate a live editable catalog rate with an immutable historical one | "Gross cost" vs "net cost" vs "net unit cost" — three related-but-distinct figures, only one of which is ever actually shown as a number | High |
| **Supplier Links — add row** | Creates a `variant_suppliers` link | `supplier_sku` pre-fills from the variant's own SKU (auto-populated, easy to miss) | — | — | Medium |
| **Price History panel** | Read-only, paginated ("Load more") | New row on every `price`/`promo_price` change (immutable per schema) | Even trivial null↔inherited toggles via the "Override"/"Reset" buttons generate a permanent audit row | — | Low |
| **Cost History panel** | Read-only, paginated | Triggered by changes to a `variant_suppliers` row's cost/discount — **not** by actual receiving events | Near-identical column shape to Purchase History (below) but represents an entirely different event (catalog negotiation vs. physical receiving) | — | High — easy to mix up with Purchase History |
| **Stock section — "Total Physical" tile** | Sums stock across non-Virtual locations | Bundle variants hold no stock of their own (§6.5) | For a bundle-type variant this tile always reads effectively 0/empty — `bundle_available_stock` is computed server-side but **never rendered anywhere on this page**, see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) | "Bundle-derived availability" is a real backend concept with zero UI surface here | High |
| **Stock — per-location table** | Row per physical location; virtual-location rows (Quarantine/Adjustment) only render if nonzero, dimmed/italic | — | A nonzero Quarantine/Adjustment row is easy to miss given its de-emphasized styling | "Virtual" location, Quarantine/Adjustment purpose not explained inline | Medium |
| **Sales History panel** | Read-only, paginated | — | Rows likely include **Voided** sales — nothing filters them out, only the Status column shows it; a user skimming quantities/totals could double-count voided activity | — | Medium-High (status-blindness) |
| **Purchase History panel** | Read-only, paginated | Cost layers (and `net_unit_cost`) are only created at Stage 2 (§9.1) | A `—` in Net Unit Cost means "cost not yet confirmed"; a `0.00` means "confirmed cost of zero" (e.g. a free replacement per §9.3) — distinguishable, but not explained | "QC Status" (Pending/Passed/Failed/Partially_Passed) not explained inline | Medium |
| **Add Variant modal — core fields** (Name*, PID*, SKU, Price, Promo Price, "Set as default variant") | Creates a new sibling variant | Only Name and PID required client-side | "Set as default variant" checkbox has no confirmation despite demoting the current default sibling (same blast-radius issue as the main Default Variant field) | — | High |
| **Add Variant modal — Attributes/Barcodes/UOM Conversions/Bundle Components builders** | Multi-row local drafts submitted as a batch of separate calls | Each sub-item POST wrapped in `.catch(() => {})` | Same silent-data-loss pattern as `NewProduct.tsx` — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) | — | High |
| **Add Variant modal — "This variant is a bundle" checkbox** | Client-side toggle only, not sent to backend | Actual bundle status determined by presence of ≥1 component rows after creation | Checking with zero components produces an indistinguishable-from-normal variant | — | Medium |
| **Add Variant modal — Supplier Link** | If a supplier is chosen, created with `is_primary: true` hardcoded | — | No way to create a first supplier link as non-primary | — | Medium |
| **Add Variant modal — bundle-component search** | Same catalogue-wide client-side search as the main section | Same lack of self-reference/nested-bundle guard | — | — | Medium-High |
| **Add Variant modal — Create Variant / Cancel** | Submits or discards | On success, navigates straight to the new variant's page | Only way to discover a partially-failed sub-item save is to review that new page | — | Medium |

#### Derived / calculated / conditionally-shown values

- **`resolved_barcode`** is fetched by the API but never rendered anywhere on this screen — the effective scannable code (explicit primary base-UOM barcode, else the PID) is invisible; a user could delete the only primary barcode with no on-screen indication the code silently reverted to PID.
- **`bundle_available_stock`** is fetched by the API but never rendered — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) for the full note. Most consequential gap on this page.
- **Price inheritance** (`inheriting = !variant.is_default && variant.price == null`) — a pure null-check, not a persisted "inherit" flag.
- **Promo Price inheritance** has an extra condition Price doesn't (the default sibling must actually have a promo price) — asymmetry not explained in the UI.
- **UOM Conversion inherited price** (`variant.price × conversion.factor`) is a second, independent inheritance chain layered on top of the variant-level price inheritance — can be two levels deep with no visual distinction.
- **`isBundleType`** (`variant.bundle_components?.length > 0`) — a derived UI flag, not a backend column, used to hide "Include in Ordering" and gate Bundle Components visibility for non-editors.
- **Sibling "Total Stock" and the main "Total Physical" tile** both exclude Virtual locations per §9.7 — the exclusion is never labeled near the totals.
- **`fmt()` helper** renders `null`/`undefined` as `—` but `0` as `0.00` — the distinction matters for Purchase History's Net Unit Cost but is never explained.

#### Native `title=` (browser tooltip) attributes on this screen

A raw grep of `title=` returns 16 hits, but 12 are the `<SectionHead title="...">` **prop** (rendered as visible heading text, not a real tooltip). Only **4 are genuine native tooltips**:

| Attached to | Tooltip text |
|---|---|
| "Include in Ordering" checkbox label | "Uncheck to exclude this variant from purchase order forms. Use for bundles and phased-out items you still carry on hand." |
| "Phased Out" checkbox label | "Mark this variant as phased out — still tracked in stock and reports, but flagged as discontinued." |
| Greyed-out inherited **Price** input | "Inherited from default variant" |
| Greyed-out inherited **Promo Price** input | "Inherited from default variant" |

The first two duplicate static helper text already shown elsewhere on the same field (redundant, not missing). None of the four explain the *consequences* flagged above (e.g. the Price tooltip doesn't mention the source is `is_default`-driven and can silently break if the default sibling changes) — all four are strong candidates for upgrading to a richer tooltip with that context added.

---

## Module: Stock (`/stock`)

### Inventory Ledger

## Inventory Ledger (`frontend/src/pages/stock/Ledger.tsx`)
**Route:** `/stock/ledger`
**Purpose:** A filterable, paginated, read-only log of every physical stock movement (receive, transfer, return, adjust) across all locations, with Excel export.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Keyword search (`KeywordSearch`) | Filters rows client-side by brand, variant name, PID, SKU, reference ID, or document ID | Multi-tag AND match | Filtering happens only on entries already fetched into `allEntries` — searching won't reach rows beyond what's been paged in via "Load more" | — | Medium — users may assume the search scans the *entire* ledger |
| Location dropdown | Filters ledger to one location (server-side) | Only non-deleted locations listed; includes virtual locations (Quarantine, Adjustment) unlabeled | Selecting "Adjustment" or "Quarantine" is the only way to see stock movements to/from these virtual locations | Quarantine, Adjustment | Medium — nothing in the dropdown marks these two as special |
| Date From / Date To | Filters entries by `occurred_at` range (server-side) | `date_to` padded to `T23:59:59` so the end date is inclusive | Filters reset pagination back to page 1 | — | Low |
| Reason pills (RECEIVE / TRANSFER_IN / TRANSFER_OUT / RETURN_IN / RETURN_OUT / ADJUST) | Toggle multi-select filter (OR'd, server-side) | Sent as comma-joined list | **`SALE` is deliberately excluded** — no SALE pill, and the backend explicitly filters `reason != "SALE"`. Sales stock deductions never appear here; view the Sales Ledger instead | RECEIVE, TRANSFER_IN/OUT, RETURN_IN/OUT, ADJUST (see [Reason Glossary](#reason-glossary)) | High — a user reconciling total stock movement will look here for sales deductions and not find them, with no on-screen explanation |
| "Clear" (reason pills) | Resets the reason filter | Only appears when at least one pill is active | — | — | Low |
| Export XLSX button | Downloads the currently filtered/searched rows | Only visible if `export_stock_ledger` action key present | Exports only what's loaded client-side — same "not the whole ledger" caveat as keyword search | — | Medium — a partial export could be mistaken for a complete one |
| Document ID cell (`DocIdCell`) | For `TRANSFER_IN`/`TRANSFER_OUT`, links to Transfer Detail; for `RECEIVE`, links to Receiving Detail; otherwise plain text | Reason-dependent routing hardcoded | `RETURN_IN`, `RETURN_OUT`, and `ADJUST` rows are **not clickable** even though a source document exists | reference_id vs document_id (resolved human-friendly PID, falls back to raw reference_id) | Medium — users will expect all document references to be links since some are |
| "Load more" button | Fetches next page (100 rows), cursor-based | Disabled while fetching; hidden once a page returns fewer than 100 rows | Combined with the search caveat, a user must page through everything before a keyword search is exhaustive | — | Low |
| Qty Change column | Signed quantity, green positive / red negative | Purely presentational | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **`document_id`** — resolved server-side per row by joining `reference_id`/`reference_type` against the transfer PID (transfers) or the supplier's delivery reference (receipts); falls back to the raw `reference_id` for any other reason, which is why RETURN/ADJUST rows aren't clickable.
- **Reason color coding** — inbound reasons in green/blue, outbound in orange, ADJUST in yellow — an implicit visual cue that ADJUST movements deserve a second look.
- **`ADJUST` reason on what looks like a transfer** — per §9.2 rule 4, when either side of a *transfer* is the virtual Adjustment location, the backend writes `ADJUST` instead of `TRANSFER_IN`/`TRANSFER_OUT`, even though the underlying record is still an `inventory_transfers` row — the Ledger screen doesn't link these rows to their transfer.
- **Hidden `SALE` reason** — filtered out server-side before this screen ever sees it.
- **"Load more" visibility** — an inferred "there might be more" signal (page was exactly full), not a real total count.

---

### Reason Glossary

Applies to the Ledger and Transfer screens:

- **RECEIVE** — Stock arriving from a supplier shipment (Stage 1 of receiving). Also used for `quantity_rejected` units routed to Quarantine (though see the Receiving-screen finding — this routing currently never fires in practice from the UI).
- **SALE** — Stock deducted at POS/sales-workstation checkout. *Never shown on the Inventory Ledger screen* (filtered out server-side); visible only via the Sales module.
- **RETURN_IN** — Stock added back from a customer sales return, or restored to a physical location when a sale is voided.
- **RETURN_OUT** — Stock leaving the virtual Quarantine location as part of a supplier return (RMA); must not be confused with normal outbound sales.
- **TRANSFER_IN / TRANSFER_OUT** — Normal stock transfer between two physical (non-virtual) locations.
- **ADJUST** — A transfer where either the source or destination is the virtual Adjustment location — used for stock corrections (found/missing units), never counted as a real inter-store movement.

---

### Stock Transfers List

## Stock Transfers List (`frontend/src/pages/stock/Transfers.tsx`)
**Route:** `/stock/transfers`
**Purpose:** Browsable, searchable/filterable list of all stock transfer documents (including adjustments and voided transfers), with Excel export and a link to create a new transfer.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Keyword search | Filters by transfer PID, from/to location name, or any line item's PID/SKU/variant name | All client-side over the full transfer list (no server pagination on this endpoint) | Loads *all* transfers up front — could get slow as volume grows | — | Low |
| Location dropdown | Filters to transfers touching a location | Options built dynamically from location names seen in the *currently loaded* transfers, not the master list | Includes virtual locations unlabeled if any transfer touched them | — | Medium — filtering by "Adjustment" is the only way to isolate all stock-correction transfers, but nothing hints at that |
| Status dropdown | Filters to `Posted` or `Voided` | Defaults transfer status to `'Posted'` if null (legacy safety) | — | — | Low |
| Date From / Date To | Filters by `occurred_at` | **Inconsistent comparison logic**: `dateFrom` compares full ISO datetime, `dateTo` compares only the date portion — can cause subtle off-by-one behavior at boundary dates | — | Low-Medium — unlikely to be noticed but could cause "why isn't today's transfer showing" confusion |
| Export XLSX | Downloads filtered rows (PID, aggregated SKUs, from/to, date, bundle count) | Same "exports only what's filtered/visible" pattern as the Ledger | Exported "SKU" column is a de-duplicated, comma-joined list of every line item's SKU — not a single value | — | Low |
| "+ New Transfer" button | Navigates to `/stock/transfers/new` | Only visible if `create_transfer` action key present | — | — | Low |
| Table row click / "View" button | Navigates to Transfer Detail | — | Redundant with each other | — | Low |
| Status badge | "Posted" (blue) or "Voided" (neutral) | — | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **SKU column** — not a stored field; computed by joining unique `variant.sku` values across all line items, truncated with no way to see the full list without opening the detail page.
- **Route display (`From → To`)** — pure concatenation of location names; gives no visual distinction when one side is a virtual location.
- **Bundle Count column** — displays `total_bundle_count` verbatim. Per §9.2 rule 8, this is **staff-informational only** — never validated against or reconciled with actual line-item quantities. A user could reasonably (and wrongly) assume a mismatch indicates a data error.
- **Status defaulting** — `t.status ?? 'Posted'` applied silently everywhere status is read/filtered, with no visible indication the underlying value was actually null.

---

### New Stock Transfer

## New Stock Transfer (`frontend/src/pages/stock/TransferNew.tsx`)
**Route:** `/stock/transfers/new`
**Purpose:** Create-and-post a stock transfer (or stock adjustment) by picking variants, entering quantities via a bundle-count helper, and choosing source/destination locations — includes an Excel bulk-import path.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Transfer PID field (required) | Free-text document reference | Required before posting | If left blank the backend *would* auto-generate `TRF-{id:06d}`, but the frontend never allows submission without a value | — | Low |
| Item search panel (left sidebar) | Live keyword search over the catalog; click a result to add a line | Searches brand, variant name, PID, SKU, barcodes; **silently excludes any variant with `bundle_components`** (bundle/kit variants) | Per §6.5, bundle variants cannot be transferred directly — but instead of an inline rejection message, the bundle variant simply **never appears in results**. A user searching for a bundle sees "No items match" with no explanation | Bundle variant, component variant | High — "No items match" reads as "doesn't exist," not "blocked from transfer" |
| "Stock: N" hint under each search result | Shows current stock at the selected **From Location** | Only shown once a From Location is chosen | No hint at all before a From Location is picked | — | Low |
| From Location / To Location dropdowns (required) | Select source/destination | Lists only `Active` locations; physical listed first, virtual grouped under "── Virtual Locations ──" | Selecting "Adjustment" as either side silently changes the *ledger semantics* of the whole transfer to `ADJUST` (§9.2 rule 4) — nothing on this screen warns the user; they'll only discover it later on the Ledger screen | Adjustment location, Quarantine location, virtual location | High — the single most consequential silent behavior in the whole flow |
| Date field | Sets `occurred_at` (defaults to today) | Sent as full ISO datetime | — | — | Low |
| Released By / Received By dropdowns | Optional employee attribution | Populated from active employees only | Purely informational tagging — no validation ties this to the actual movement | — | Low |
| Remarks field | Free text | **Never sent to the backend** — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) | Anything typed here is silently discarded on post | — | High — real data-loss trap |
| Line item table — Bundle Count column | For variants with a UOM conversion flagged `is_warehouse_bundle`, an editable count (e.g. "boxes") | Editing recalculates `qty = bundleCount × factor` and vice versa (two-way sync) | Variants with no warehouse-bundle conversion show "—" and only Qty is editable — inconsistent row-to-row with no explanation | Warehouse bundle (e.g. 1 case = 24 pcs) | Medium |
| Line item table — Qty field | Base-unit quantity, decimals allowed | This is what's actually sent to the backend — bundle count is a pure UI convenience | Per §6.4, the system always stores/processes in base units | — | Low |
| "Stock at Source" column | Read-only display of current stock at the From Location | Shows "—" if no From Location selected | **Purely informational — not a hard cap.** The frontend does not block entering a quantity greater than available stock; enforcement is server-side only (and only if `allow_negative_stock` is false) | allow_negative_stock policy | High — a user could type far more than "Stock at Source" with no client-side warning |
| Remove line (×) button | Removes a line from the cart | — | — | — | Low |
| "Download Template" button | Downloads a 3-column XLSX template | — | — | — | Low |
| "Upload XLSX" file input | Bulk-imports lines from a spreadsheet | Matches rows by PID; **rejects bundle PIDs explicitly** with a visible inline error message | Unlike the manual search (silent omission), the import path **does show** the §6.5 inline error — an inconsistency between the two entry methods for the same rule. Also silently skips PIDs not found or already added, with no error for those | — | Medium — same rule enforced two different ways depending on entry method |
| "Cancel" button | Navigates back without saving | No confirmation prompt | — | — | Low-Medium |
| "Post Transfer" button | Submits the transfer | Validates PID present, both locations selected, ≥1 line item | `quantity_received` is **never sent** — only `quantity_requested`/`quantity_released`. Every transfer created here always has `quantity_received = null`, even though the schema/detail page has a distinct field for tracking receipt discrepancies | quantity_requested vs. quantity_released vs. quantity_received | Medium — no way to record breakage/loss-in-transit through this UI |
| Footer summary ("N items · N bundles") | Live count/sum | `totalBundles` = sum of all lines' bundle counts | Becomes `total_bundle_count` on post — reinforcing it's a staff tally, not derived/validated math | — | Low |

#### Derived / calculated / conditionally-shown values

- **Bundle count ↔ Qty two-way sync** — only active for variants with a `is_warehouse_bundle` UOM conversion.
- **`total_bundle_count`** — sum of all lines' bundle counts; informational only per §9.2 rule 8, never validated server-side against line items.
- **ADJUST vs TRANSFER semantics** — entirely determined by whether "Adjustment" is chosen as From or To location; silent backend reclassification with no client-side indicator.
- **Bundle-blocking behavior divergence** — search silently filters bundles out, XLSX import explicitly rejects them with a visible error — same rule, two different UX outcomes.
- **"Stock at Source" is advisory only** — real enforcement lives entirely server-side.
- **Remarks field is discarded** — present in the form, absent from the submit payload.

---

### Transfer Detail

## Transfer Detail (`frontend/src/pages/stock/TransferDetail.tsx`)
**Route:** `/stock/transfers/:transferId`
**Purpose:** Read-only view of a single posted or voided transfer's header and line items, with Excel export and a void action.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Header fields (PID, From, To, Date, Bundle Count, Released/Received By) | Read-only display | — | "Bundle Count" is the same staff-informational `total_bundle_count` as elsewhere | — | Low |
| Void Reason display | Shown only when Voided and a reason was recorded | — | — | — | Low |
| Export XLSX button | Downloads line items (requested/released/received qty) | — | "Qty Received" will show blank for virtually every transfer created via New Transfer, since that field is never populated there | — | Medium |
| "Void" button | Opens a confirmation modal requiring a void reason | Only shown when `status === 'Posted'` | — | — | Low |
| Void modal — Void Reason input (required) | Free text explaining the void | Blocks submission if empty | — | — | Low |
| Void modal — "Confirm Void" | Calls the void endpoint, invalidates caches, closes modal | The confirmation copy says "This will reverse all stock movements" — true but incomplete, see notes | **The backend's void logic always reverses using `TRANSFER_IN`/`TRANSFER_OUT`, never `ADJUST`** — even when the original transfer involved the Adjustment location. Void does **not** modify the original ledger entries — it only appends new, opposite-direction entries (ledger immutability), so a voided transfer leaves *four* ledger rows total. FIFO cost layers are consumed/recreated again rather than simply restored to their pre-transfer state (correct quantity-wise, but not a clean lineage undo) | Void (reversal semantics: additive, not destructive) | High — "reverses all stock movements" undersells several real nuances, see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) |
| Void modal — "Cancel" | Closes modal, clears state | — | — | — | Low |
| Line items table | Read-only: Brand, Variant, PID, SKU, Qty Requested/Released/Received | — | Qty Released/Received show "—" for legacy/incomplete rows | — | Low |

#### Derived / calculated / conditionally-shown values

- **Void eligibility** — gated on `status === 'Posted'`; voiding is a one-way terminal transition, matching the sales-void pattern elsewhere.
- **Reversal direction on void** — mirror image of the original movement; for bundle-component transfers, each component is reversed individually using the same explosion math as the original post.
- **FIFO layers on void** — consumes at the (former) destination, recreates at the (former) source, carrying `net_unit_cost` — functionally an undo, but a forward movement rather than a literal `quantity_remaining` restoration (contrast with how a sale void works per §13.7).
- **`ADJUST` reason not preserved on void** — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope).
- **"Qty Received" perpetually blank** — inherited gap from TransferNew never sending the field.

---

### Receiving — Shipment List

## Receiving — Shipment List (`frontend/src/pages/stock/Receiving.tsx`)
**Route:** `/stock/receiving`
**Purpose:** Lists all inbound shipments with a derived confirmation status, lets staff search/filter, export the visible list to Excel, and jump into a shipment's detail, Stage 1 creation, or Stage 2 cost confirmation.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Keyword search (`KeywordSearch`) | Filters shipments by tag/live-text match | Matches shipment PID, supplier name, document reference, PO reference, and per-line variant PID/SKU/name (AND) | Purely client-side over the already-fetched list (no server-side pagination on this screen) | "PID" (variant/shipment human ID) vs "Document ID" (supplier's own delivery reference) | Low |
| Supplier filter | Restricts list to one supplier | Options built from distinct supplier names present in the loaded shipments, not a full supplier list | If a supplier has no shipments yet, it won't appear in the dropdown | — | Low |
| Export XLSX button | Downloads the currently filtered rows | Columns: Shipment PID, SKU, Supplier, Document ID, Date Received, PO Reference, Status | Exports the derived Status label, not the raw `is_confirmed` boolean; SKU column collapses to a comma-joined list | — | Low |
| + New Shipment button | Navigates to `/stock/receiving/new` (Stage 1) | — | — | — | Low |
| Table row (click) | Navigates to shipment detail | — | — | — | Low |
| Status badge (Pending / Pending Confirmation / Confirmed) | Derived client-side: `is_confirmed → Confirmed`; else `receiving_details.length > 0 → Pending Confirmation`; else `Pending` | This label does **not** actually confirm Stage 1 succeeded — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) for the orphaned-shipment scenario | Distinction between "Pending" (no line items ever added) vs "Pending Confirmation" (Stage 1 physically done, awaiting Stage 2 costing) | High |
| "Confirm Costs" link (conditional) | Shown only when status is "Pending Confirmation"; navigates to the Stage 2 screen | — | Because of the status-derivation gap above, this link can appear on a shipment whose Stage 1 receive silently failed | — | Medium |

#### Derived / calculated / conditionally-shown values

- **Status** — computed client-side from `is_confirmed` and detail-row presence, not a dedicated backend field; see reliability caveat above.
- **SKU column** — deduplicated, comma-joined list, display convenience only.
- **Document ID column** — this is `reference_number` (the supplier's delivery-note reference), distinct from the system-generated `shipment_pid` shown in the first column.
- **"Confirm Costs" action visibility** — only for "Pending Confirmation" shipments (see status-derivation caveat).

---

### Receiving New — Create Shipment (Stage 1)

## Receiving New — Create Shipment (Stage 1) (`frontend/src/pages/stock/ReceivingNew.tsx`)
**Route:** `/stock/receiving/new`
**Purpose:** Records the physical arrival of goods (Stage 1 of the two-stage receiving workflow) — creates the shipment header, adds line items with declared/actual/rejected quantities and QC status, and immediately posts stock to the destination location with no cost data.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Search Items panel | Finds catalog variants by brand, name, PID, SKU, or barcode | Only base/component variants are searchable — bundle variants filtered out entirely per §6.5 | Bundle variants never appear in results at all, no error message (unlike the Excel import path, which surfaces an explicit rejection for the same rule) | "Bundle" variant | Medium |
| Item result row (click to add) | Adds the variant with defaults (`bundleCount:1, qtyDeclared:1, qtyActual:1, qtyRejected:0, qcStatus:'Passed'`) | Disabled if already added | Silent no-op if clicked while already added | — | Low |
| Supplier * | Sets the shipment's supplier | Required to post | — | — | Low |
| Document ID | Free-text supplier delivery-note reference | Optional; stored as `reference_number` | Not the same as the system `shipment_pid` | — | Low |
| Date Received * | Sets `received_at` for the shipment **and** every line | Required; defaults to today | One date applies to the whole shipment — no per-line received date on this screen, even though the schema supports it | — | Low |
| Destination Location * | Sets where stock is posted for **all** lines | Required; `Active`, non-`Virtual` locations only | One location per shipment — multi-location receiving requires separate shipments | — | Low |
| Received By | Tags the shipment with the receiving employee | Optional | Distinct from the logged-in user — a separate attribution field, not auto-filled from the session | Employee vs User distinction | Low |
| Bundle Count (per-line, conditional) | Lets staff enter box/case counts | Only rendered for variants with a `is_warehouse_bundle` conversion; qty = count × factor | Editing this **overwrites both Qty Declared and Qty Actual**, silently discarding any prior manual edit to Qty Actual | "Warehouse bundle" conversion factor | Medium |
| Qty Declared | What the supplier's delivery note claims | Free numeric entry | Editing this **also overwrites Qty Actual** (and recalculates Bundle Count), overwriting any manually entered physical count | "Declared" vs "Actual" vs "Rejected" — three distinct concepts | High |
| Qty Actual | What was physically counted on arrival — the quantity that becomes stock | Editing this does *not* touch Qty Declared, and re-triggers QC auto-suggest | **Cross-field trap**: if the user sets Qty Actual different from Qty Declared (to record a shortfall), then touches Bundle Count or Qty Declared again, Qty Actual is silently reset to match — the recorded discrepancy is lost without warning | This is the quantity that actually enters `current_stocks` | High |
| Qty Rejected | Intended to record units refused for damage/quality failure | Triggers QC auto-suggest on change | **Verified bug**: whatever is entered here is **never sent to the backend** — `handlePost` hardcodes `quantity_rejected: '0'` regardless. The on-screen note about automatic Quarantine routing is therefore never actually true for shipments created through this screen. See [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope). | Quarantine (virtual location holding rejected/damaged stock) | High |
| QC Status | Pending / Passed / Failed / Partially_Passed | Auto-suggested whenever Qty Actual/Rejected changes, but manually overridable | **Verified bug**: whatever the user selects is **discarded** — `handlePost` hardcodes `qc_status: 'Passed'` for every line | — | High |
| Remove-line button (×) | Removes a line from the cart | — | No confirmation prompt | — | Low |
| Download Template button | Downloads a 3-column XLSX template (PID, variant_name, qty_received) | — | `variant_name` column is not actually used by the importer — cosmetic only | — | Low |
| Upload XLSX (file input) | Bulk-adds lines from a spreadsheet | PID must exist and resolve to a non-deleted, non-bundle variant; duplicates and blanks silently skipped | Sets `qtyDeclared = qtyActual = qty_received`, `qtyRejected = '0'`, `qcStatus = 'Passed'` for every row — same downstream discard issue as manual entry | — | Medium |
| Cancel button | Navigates back without saving | — | No confirmation — an in-progress cart is lost silently | — | Low |
| Save Receipt button | Executes the 3-step Stage 1 sequence: create shipment header → add all details → call receive (posts ledger + stock) | Blocked client-side if Supplier, Destination Location, or ≥1 line is missing | Three separate network calls, not one atomic backend transaction from the frontend's perspective — a partial failure leaves an orphan shipment. Stock becomes live and sellable the instant `receive` succeeds, before any cost has been entered | Stage 1 vs Stage 2 (cost is optional and separate; stock precedes costing) | High |

#### Derived / calculated / conditionally-shown values

- **QC Status auto-suggest**: `rejected <= 0 → Passed`; `rejected >= actual → Failed`; otherwise `Partially_Passed`. Moot in practice since the selected value is never transmitted (see bug above).
- **Bundle Count column visibility** — shown only for variants with a `is_warehouse_bundle` conversion; all others show "—".
- **Qty Declared / Qty Actual auto-sync** — editing Bundle Count or Qty Declared forces both fields to the same value; only editing Qty Actual directly decouples it.
- **Quarantine note** ("Rejected quantities will be automatically routed to Quarantine") — shown when any line has `qtyRejected > 0`, but currently inaccurate for this screen (see bugs above).
- **No PO linkage on this screen** — `quantity_ordered` stays null for every line created here; the schema field exists but this UI has no path to populate it.
- **`inspected_at` is never set** by this screen — only `received_at` is captured.

---

### Receiving Detail

## Receiving Detail (`frontend/src/pages/stock/ReceivingDetail.tsx`)
**Route:** `/stock/receiving/{shipmentId}`
**Purpose:** Read-only view of a shipment's header and line items, showing cost/invoice columns once Stage 2 is complete, and offering export or a jump into Stage 2 confirmation.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| "Receiving" breadcrumb link | Navigates back to the shipment list | — | — | — | Low |
| Cost Confirmation badge | Shows "Confirmed" (green) or "Pending" (yellow) | Reads `shipment.is_confirmed` directly — the actual field, unlike the list screen's inferred status | — | — | Low |
| Export Invoice button (conditional) | Downloads a two-sheet XLSX (Invoice Summary + Line Items) | Only rendered when `is_confirmed = true`; backend 404s otherwise | — | — | Low |
| "Confirm Costs →" button (conditional) | Navigates to the Stage 2 screen | Only rendered when `is_confirmed = false` | Confirmed: the old combined "Confirm Receipt" endpoint still exists server-side (deprecated) but nothing in any of these screens calls it anymore — the two-stage flow is exclusive now | "Confirm Costs" vs the retired single-step "Confirm Receipt" concept | Low |
| Line item table | Read-only display of all receiving_details rows | Cost columns (Gross Cost, Discount %, Net Unit Cost) only rendered when `is_confirmed = true` | **Quantities are entirely locked here** — confirms Stage 1 quantities become read-only once entered; no edit affordance anywhere on this screen | — | Low |

#### Derived / calculated / conditionally-shown values

- **Variance column** = `quantity_actual − quantity_declared` (physical count vs. supplier's claimed delivery), highlighted when non-zero. **Not** variance against `quantity_ordered` (the PO quantity) — easy to misread as an ordered-vs-received comparison.
- **Cost columns** appear only once `is_confirmed = true`; before that, the table shows 8 columns instead of 11, reinforcing Stage 1 carries zero cost information.
- **Yellow advisory banner** ("Stock has been received (Stage 1 complete). Click 'Confirm Costs'…") — shown only while unconfirmed, explicitly tells the user stock is already live even though no cost exists yet.
- **`Qty Ordered` is never displayed** anywhere on this screen — consistent with the create screen never populating it.

---

### Receiving Confirm — Confirm Costs (Stage 2)

## Receiving Confirm — Confirm Costs (Stage 2) (`frontend/src/pages/stock/ReceivingConfirm.tsx`)
**Route:** `/stock/receiving/{shipmentId}/confirm`
**Purpose:** Stage 2 of receiving — enters/reviews per-line unit costs, creates FIFO cost layers, and generates the supplier invoice + AP ledger entry, all in one backend transaction.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Header fields (Shipment PID, Supplier, Date Received, Destination Location, Document ID) | Read-only display of Stage 1 data | — | "Destination Location" is derived from **only the first** receiving-detail row — if a shipment somehow had lines at multiple locations, only the first line's location is shown | — | Medium |
| Invoice Number * | Sets the supplier invoice's number | Required to enable Confirm | — | — | Low |
| Invoice Date * | Sets invoice date; defaults to today | Required; drives Due Date auto-calc | Changing this recalculates Due Date automatically **unless** the user has already manually edited Due Date this session | — | Medium |
| Due Date | Sets `supplier_invoices.due_date` | Auto-populated as `invoice_date + supplier.terms` until manually touched | Once edited, permanently decouples from Invoice Date for the rest of the session. If the supplier has no `terms` on file, the field is blanked with helper text — but if left untouched, the **backend** silently computes `due_date = invoice_date + 0 days` on submit, never surfaced to the user | "Net {terms} days" payment terms | High |
| Inspected By | Sets `inspected_by_employee_id` on the shipment | Optional | Only stamps the shipment-level field — the per-line `inspected_at` timestamp is never set anywhere in this flow | Shipment-level "inspected by" (who) vs never-populated line-level `inspected_at` (when) | Medium |
| Gross Cost (per-line) | Enters the supplier's catalog price for that line | Must be `> 0` for every visible line; on submit, also overwrites `variant_suppliers.gross_cost` for that variant/supplier going forward | **Autofill source**: pre-filled from a priority chain — (1) most recent cost layer for this variant from this supplier ("Prior shipment"), (2) the matching `variant_suppliers` record ("Supplier record"), (3) nothing ("No prior data"). Caption shows the source, purely informational — fully editable/overridable | "Prior shipment" / "Supplier record" cost source labels | Medium |
| Discount % (per-line) | Enters `supplier_discount` for that line | 0–100 range enforced client-side via input attrs, not strictly | — | — | Low |
| Net Unit Cost (per-line, read-only) | `gross × (1 − discount/100)`, live | — | — | — | Low |
| Line Total (per-line, read-only) | `quantity_actual × net_unit_cost` | — | Uses the **full** `quantity_actual`, not `quantity_actual − quantity_rejected` — confirmed to match backend behavior, but since Stage 1 currently forces `quantity_rejected = 0` (see the Receiving New bug), this discrepancy is presently unreachable in practice through this UI | — | Medium |
| Grand Total (footer, read-only) | Sum of all visible Line Totals | — | Silently excludes any line with `qc_status === 'Failed'` or `quantity_actual <= 0` — those lines never appear in this table at all | — | Medium |
| Cancel button | Navigates back, discarding entered costs | — | No confirmation prompt | — | Low |
| Confirm & Record Invoice button | Submits all line costs, invoice header, and inspector | Disabled unless Invoice Number, Invoice Date, and a positive Gross Cost on every visible line are present | This single call, in one backend transaction: creates a cost_layer per line, updates `variant_suppliers` for future receipts, creates the supplier invoice, writes an `INVOICE` entry to `ap_ledger`, and flips `is_confirmed = true` — none of this is visible to the user beyond the eventual redirect; no confirmation summary shown before navigating away | AP ledger/supplier invoice creation happening invisibly as a side effect of one click | Medium |
| "Already confirmed" guard screen | If already `is_confirmed = true`, the form is replaced with a message and a back link | Prevents double-confirmation at the page level | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **Visible line filter** — only lines with `quantity_actual > 0` AND `qc_status !== 'Failed'` appear; wholly-rejected or zero-actual-quantity lines never show up here and are never costed or invoiced.
- **Cost autofill source label** — informational only, never blocks or forces the entered value.
- **Net Unit Cost, Line Total, Grand Total** — all purely computed live from Gross Cost × Discount %.
- **Due Date auto-calc** — computed as `invoice_date + supplier.terms` until manually touched; silently falls back to `invoice_date + 0` if left blank with no supplier terms on file.
- **`canConfirm` gate** — non-empty Invoice Number, non-empty Invoice Date, positive Gross Cost on every visible line; Discount % not required (defaults to 0).
- **Destination Location display** — derived from the first line's location only, not a true shipment-wide value.

---

## Module: Procurement (`/procurement`)

### Suppliers

## Suppliers (`frontend/src/pages/procurement/Suppliers.tsx`)
**Route:** `/procurement/suppliers`
**Purpose:** List, create, edit, and activate/deactivate suppliers used as the counterparty on purchase orders and shipments.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Search box (code, name) | Client-side filter over `supplier_code`/`supplier_name` | Substring match, case/diacritic-insensitive | Only filters the already-fetched page of suppliers; no server-side search | — | Low |
| Status toggle (Active / Inactive / Both) | Filters by `is_deleted` | Default view is Active only | "Inactive" means `is_deleted = true` — a soft-delete flag, not a separate lifecycle state | "Inactive" = soft-deleted, not "on hold" | Medium — users may not realize "Inactive" is the ERP's delete mechanism |
| "+ New Supplier" button | Opens create modal | Gated by `manage_suppliers` (frontend-only, hidden entirely if lacking) | — | — | Low |
| Supplier Code field (create mode) | Free-text, forced uppercase, required | No client-side duplicate check; relies on backend unique constraint | **Notable inconsistency**: this is a user-typed, permanent identifier, unlike `po_pid` (Purchase Orders) which is auto-generated by the backend if left blank. Once created, immutable — the edit modal renders it read-only | "Supplier Code" vs system-generated PIDs elsewhere in the app | High — a user familiar with auto-generated PIDs elsewhere may expect this to also be system-assigned, or not realize it's permanent |
| Supplier Code field (edit mode) | Read-only display of existing code | Cannot be changed after creation | No visual cue (e.g. lock icon) explaining why it's read-only | — | Medium |
| Supplier Name field | Free text, required | — | — | — | Low |
| Bank Account Name field | Free text, optional | Sent as null if empty | — | — | Low |
| Payment Terms (days) field | Numeric input, defaults to 0 | `parseInt(terms) || 0` — non-numeric input silently becomes 0 | Directly maps to `suppliers.terms`. Not used anywhere on this screen, but downstream drives `due_date = invoice_date + terms` at Stage 2 cost confirmation. A value of 0 displays elsewhere as "COD" | "Terms" = payment terms in days, e.g. 30 = Net 30; drives AP due dates generated later | Medium — the downstream due-date consequence is completely invisible on this screen |
| Terms column display (list) | Renders `0` as "COD" and otherwise "Net {terms}" | Formatting only | — | "COD", "Net {n}" | Medium — non-obvious to non-finance users |
| Edit link (row) | Opens edit modal | Only shown when `canManage` and supplier is active | — | — | Low |
| Deactivate / Reactivate link | Toggles `is_deleted` | Gated by `canManage`; no confirmation dialog | Deactivating does **not** cascade — existing POs/shipments tied to it remain untouched; only prevents/hides it from active-selection dropdowns elsewhere | Soft-delete pattern (`is_deleted`) | Medium — no confirmation step, and consequence for existing POs isn't explained |

#### Derived / calculated / conditionally-shown values

- Status badge — derived purely from `is_deleted`.
- "COD" vs "Net {n}" terms label — computed display transform of the raw integer `terms`.
- Edit link visibility — hidden for deactivated suppliers, so their fields can't be modified without first reactivating (not stated anywhere).
- Row dimming — conditional styling for deactivated rows in "Both" view.

---

### Purchase Orders

## Purchase Orders (`frontend/src/pages/procurement/PurchaseOrders.tsx`)
**Route:** `/procurement/purchase-orders`
**Purpose:** List all purchase orders with filtering, and create new draft POs against a supplier with line items.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Search box (PO #, supplier) | Client-side filter | Matches `po_pid` or supplier name | — | — | Low |
| Status filter dropdown | Filters list by status | Options: All, Draft, Open, Partially_Received, Closed, Cancelled | Underscore replaced with space for display only | Full status vocabulary — see below | Low |
| "+ New PO" button | Opens Create PO modal | Gated by `manage_purchase_orders` (frontend-only) | — | — | Low |
| PO row / PO Number link | Navigates to PO detail | — | — | — | Low |
| Total Amount column | Read-only display of `po.total_amount` | **Never manually entered** — always the sum of `ordered_quantity × unit_cost` across line items, computed server-side | Updates automatically as line items are edited on the detail page; a user can't type a PO total directly anywhere | — | Low |
| Status badge (list) | Color-coded pill | Draft=grey, Open=blue, Partially_Received=yellow, Closed=green, Cancelled=red | — | Full lifecycle terms | Low |
| **Create PO Modal — Supplier select** | Required dropdown of active suppliers | Required to save | — | — | Low |
| **Destination Location select** | Optional dropdown | Filtered to `Active`, non-`Virtual` locations | Virtual locations (Quarantine/Adjustment) deliberately excluded — a PO can only target a real physical location | "Virtual" location concept | Medium — a new user won't know why some locations from Settings don't appear here |
| Expected Arrival date picker | Optional date | No validation against past dates | Maps to `expected_arrival_date`; distinct from actual receiving date recorded later on shipments | — | Low |
| Line item search (brand, name, PID, SKU) | Typeahead, max 5 results | Excludes soft-deleted and **bundle** variants — bundles cannot be purchased directly | Silent exclusion, no explanation — searching for a known bundle SKU yields zero results | "Bundle" variant concept | High — reads as a data error |
| Clicking a search result (add line) | Adds the variant as a line item, auto-fetches supplier cost | Calls the variant-supplier cost lookup; **silently fails** (leaves fields blank) if no `is_primary=true` record exists for that variant+supplier pair | Autofill only works when this supplier is the variant's *primary* source — a secondary cost relationship won't autofill even though pricing data exists | `is_primary` supplier concept (§7.2) — "preferred supplier" per variant | High — blank cost fields with no explanation of why autofill didn't happen |
| Qty / Gross Cost / Discount % inputs (per line) | Free numeric entry | Qty and Gross Cost must be `> 0` at save (validated per line, PID named in error); Discount % constrained 0–100 via input attrs only | Net Cost and Line Total recompute live client-side for preview — the authoritative `unit_cost` is recalculated server-side on save using the same formula | "Gross Cost" vs "Net Cost" | Medium |
| Remove line (×) | Removes a line before save | — | — | — | Low |
| Grand Total (modal footer) | Sum of line totals | Client-side preview only; real `total_amount` computed authoritatively server-side | — | — | Low |
| "Save as Draft" button | Submits the PO | Requires supplier, ≥1 line item, all lines qty>0 and gross>0; new POs always start in `Draft` (hardcoded server-side) | Button label signals the PO always lands in Draft — no option to submit directly as "Open" | — | Low — label is fairly explicit |

#### Derived / calculated / conditionally-shown values

- **Net Cost / Line Total / Grand Total** (modal) — computed live client-side as a preview; server is source of truth for what's actually persisted.
- **Total Amount** (list column) — persisted server-computed value; never directly editable anywhere.
- **Status badge color** — presentation mapping keyed off the status enum.
- **Destination Location options** — conditionally filtered to exclude inactive and Virtual-type locations (not explained in UI).
- **Line-item search results** — conditionally exclude soft-deleted and bundle variants (not explained in UI).
- **Auto-filled Gross Cost/Discount** — only populated when a *primary* supplier-cost record exists; otherwise blank/zero and must be typed manually.

---

### Purchase Order Detail

## Purchase Order Detail (`frontend/src/pages/procurement/PurchaseOrderDetail.tsx`)
**Route:** `/procurement/purchase-orders/:po_id`
**Purpose:** View a single PO's header, line items, and advance its status (confirm or cancel), with inline editing of line items while still in Draft/Open.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Breadcrumb "Purchase Orders" link | Navigates back to list | — | — | — | Low |
| Status badge (header) | Current status, color-coded | Same mapping as list page | — | — | Low |
| **Status action buttons** (dynamic per status) | See lifecycle notes below | Driven by a hardcoded frontend map | **Not gated by `manage_purchase_orders` on the frontend at all** — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope). Renders for any logged-in user; backend does enforce and returns 403, discovered only after clicking | Status transition vocabulary | High — inconsistent permission UX vs. sibling screens |
| "Confirm Order" button (Draft only) | Transitions `Draft → Open` | Backend also allows `Draft → Cancelled`; this is the only forward transition exposed | Marks the PO as officially placed with the supplier | — | Low |
| "Cancel PO" button (Draft, Open, Partially_Received) | Transitions to `Cancelled` | No confirmation dialog | Cancellation is terminal — no outgoing transitions from `Cancelled` | — | Medium — no confirm prompt for a terminal, irreversible action |
| *(No button for `Open → Partially_Received` or `→ Closed`)* | These transitions exist backend-side but are never manually triggered from this screen | Happen automatically as a side effect of the receiving/shipment workflow | This PO detail screen cannot manually close or partially-receive a PO | Automatic status transition via receiving workflow | High — a user looking for a "Mark Received"/"Close PO" button won't find one |
| Closed / Cancelled status | No action buttons shown | Backend transition table also has no outgoing transitions — confirmed terminal | — | — | Low |
| Line item — Ordered Qty (editable when Draft/Open) | Numeric input, commits on blur | Only re-submits if the value changed | **Also not gated by `manage_purchase_orders`** — the `editable` flag depends solely on PO status, no permission check on the frontend. Backend's update endpoint has **no permission dependency at all** (only router-level auth) — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope) | — | High — verified backend gap |
| Line item — Gross Cost / Discount % (editable) | Numeric inputs, commit on blur | Backend recomputes `unit_cost` server-side on every commit — never accepts a caller-supplied `unit_cost` | Editing either field triggers a full PO total recalculation across all items | — | Medium |
| Received Qty column | Read-only, shown as "received / ordered" | Never editable from this screen | Only changes via the receiving/shipment workflow, not from PO Detail | "Received Quantity" tracked separately from "Ordered Quantity" — supports partial receipt | Medium — user might expect to record receiving here |
| Net Cost column (labeled, shows `unit_cost`) | Read-only computed display | `= gross_cost × (1 − discount_pct/100)`, computed server-side and returned as `unit_cost` | Column header says "Net Cost" but the underlying field/schema name is `unit_cost` — a naming mismatch | "Net Cost" (UI label) = `unit_cost` (field name) | Medium |
| Line Total column | Read-only, `ordered_quantity × unit_cost` | Matches how `total_amount` is computed server-side | — | — | Low |
| Grand Total (footer) | Client-recomputed sum of line totals | Should always match `po.total_amount` from the server after any edit | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **`editable` flag** — `true` only when status is Draft or Open; gates whether Qty/Gross/Discount render as inputs vs. plain text. Not obvious that `Partially_Received` POs become fully locked for line-item edits.
- **`nextActions` (status buttons)** — a hardcoded frontend map that is a subset of what the backend actually allows (the backend also permits `Open → Partially_Received` and `→ Closed`, never exposed as buttons here since they happen automatically via receiving).
- **Line Total / Grand Total** — always computed, never stored/entered directly.
- **No link to fulfilling shipment(s)** — this screen shows no reference to the `inventory_shipments` records that received against this PO, even though receiving updates `received_quantity` and (indirectly) the PO's status. Per §9.1, a PO is optional context for a shipment (not the other way around), and this screen provides no way to navigate from a PO to the shipment(s) that fulfilled it.

---

## Module: Settings (Inventory-relevant tabs)

### Locations

## Locations (`frontend/src/pages/Settings.tsx` — `LocationsTab`)
**Route:** Settings tab, no dedicated route
**Purpose:** Create, edit, and activate/deactivate physical and virtual locations (warehouses, stores, bins, quarantine/adjustment staging).

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **+ Add Location** button | Opens the inline "New Location" form (`location_type` defaults to `Store`) | Name required (trimmed) — Save silently no-ops on empty name, no inline error shown | Nothing prevents creating a duplicate `location_name` from the UI itself | — | Medium — empty-name click does nothing with no feedback |
| **Name** text input | Sets `location_name` | Required, trimmed | — | — | Low |
| **Type** dropdown (Warehouse / Store / Bin / Virtual) | Sets `location_type` | No validation beyond the fixed enum | Editable even on an existing location that already has stock/history — changing type after stock exists isn't blocked client-side | `Virtual` — not explained anywhere in the UI. Per §5.1, Virtual locations exist for system purposes (quarantine, damaged goods, adjustment staging) and are never counted in active inventory reports | High — real downstream reporting consequences, reads as a plain category picker |
| **Address** text input | Sets `address` (optional) | None | — | — | Low |
| **Save** button (inline form) | Creates or updates | Blocked only by empty name (silently) | On edit, only name/type/address are sent — `status` and `parent_location_id` are never touched by this form | — | Low |
| **Cancel** button | Closes form without saving | — | — | — | Low |
| **Edit** button (per row) | Opens the form pre-filled | Hidden entirely for system locations | — | — | Low |
| **Deactivate** / **Reactivate** button (per row) | Toggles `status` between Active/Inactive | No confirmation dialog | Per §5.1, `Inactive` blocks the location from **new** transactions but preserves history — not explained anywhere in the UI | "Inactive" — meaning is implicit | Medium — irreversible-feeling action with real transactional consequences that aren't spelled out |
| System row indicator ("system" label, no buttons) | Replaces Edit/Deactivate for `is_system = true` rows | Backend independently rejects any edit on a system location with HTTP 400 | Two rows are always system-seeded and unremovable: **Quarantine** and **Adjustment**. Neither concept is explained in this tab | "System location", "Quarantine", "Adjustment" | High — permanent fixtures with completely opaque purpose from this screen alone |
| Location table (list) | Displays Name, Type, Address, Status, Actions | Sorted alphabetically client-side | Inactive rows dimmed but remain in a flat list — no visual grouping/tree despite the data model supporting nesting | — | Low |

#### Derived / calculated / conditionally-shown values

- **Sort order** — always alphabetized by name; does not reflect hierarchy or creation order.
- **Row dimming** — applied whenever `status !== 'Active'`, with no separate "show inactive" filter toggle.
- **Actions column content** — conditionally either Edit/Deactivate buttons or the plain "system" label, based on `is_system`.
- **Gap worth flagging**: `parent_location_id` (the field driving §5.1's "unlimited nesting depth") exists in the schema/API types but is **not exposed anywhere in this UI** — see [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope).

---

### Units of Measure

## Units of Measure (`frontend/src/pages/Settings.tsx` — `UOMsTab`)
**Route:** Settings tab, no dedicated route
**Purpose:** Maintain the list of measurement units (PC, BOX, KG, etc.) used across products and variant UOM conversions.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **+ Add UOM** button | Opens the inline "New UOM" form | — | — | — | Low |
| **Code** text input | Sets `uom_code`; every keystroke force-uppercased | Required only when creating; not editable when editing (read-only with a "(read-only)" label). Backend enforces uniqueness | Uppercasing happens silently as you type, with no explanation of the §5.3 uppercase convention | `uom_code` uniqueness/uppercase convention | Low-Medium — could surprise a user pasting mixed-case text |
| **Name** text input | Sets `uom_name` (optional) | None | — | — | Low |
| **Save** | Creates or patches (name only — code is immutable post-creation) | Create requires non-empty code; edit has no equivalent guard | — | — | Low |
| **Edit** button (per row) | Opens form pre-filled, Code locked read-only | Reinforces `uom_code` is permanent | — | — | Low |
| **Delete** button (per row) | Attempts a **hard delete** | Backend blocks the delete if any product, barcode, or UOM conversion still references the code — error shown inline; a footnote states this rule in small text | This is the one place in these tabs that performs a true hard delete rather than a soft delete — inconsistent with the rest of the system's `is_deleted` convention | "Hard delete" — used without being defined against the soft-delete pattern used everywhere else | Medium — a user expecting the "Deactivate" pattern from Locations may not realize this is permanent-or-blocked |
| UOM table (list) | Shows Code, Name, Actions; no status column | Filtered to `!is_deleted` | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **Delete error banner** — only rendered on a failed delete; message text comes straight from the backend exception, not authored copy.
- **"(read-only)" label on Code** — shown only in edit mode.
- **Footnote text** ("Hard delete — blocked if any product, barcode, or UOM conversion references this code.") — the only in-UI documentation of this behavior, easy to skip given its small, muted styling.

---

### Product Categories

## Product Categories (`frontend/src/pages/Settings.tsx` — `CategoriesTab`)
**Route:** Settings tab, no dedicated route
**Purpose:** Maintain a parent-child hierarchy of product categories used for catalogue UI filtering.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **+ Add Category** button | Opens the inline "New Category" form | — | — | — | Low |
| **Name** text input | Sets `category_name` | Required, trimmed; Save no-ops silently if blank | — | — | Low |
| **Parent Category** dropdown | Sets `parent_category_id` (or null for top level) | Options exclude the category currently being edited (prevents direct self-selection) | **Does not** prevent picking one of the category's own *descendants* as its parent — e.g. a category could pick its own grandchild, creating a cycle. No cycle detection visible client-side; backend enforcement unverified. See [Findings Beyond Tooltip Scope](#findings-beyond-tooltip-scope). | — | Medium-High — indirect cycles aren't blocked and the UI gives no view of hierarchy depth to help avoid them |
| **Save** | Creates or patches | Same blank-name guard as Add | — | — | Low |
| **Edit** button (per row) | Opens form pre-filled including current parent | — | — | — | Low |
| **Delete** button (per row) | Attempts a **hard delete** | Backend blocks if products are linked or child categories exist — error shown inline; footnote states the rule | Same hard-delete inconsistency as UOMs relative to the rest of the app's soft-delete convention | "Hard delete" | Medium |
| Category table (list) | Shows Name, resolved Parent name, Actions | Parent name resolved client-side via lookup against the already-loaded list | If a category's parent was deleted out from under it in a race, the lookup silently renders "—" rather than an error | — | Low |

#### Derived / calculated / conditionally-shown values

- **Parent dropdown options** — computed by excluding self from the full category list.
- **Displayed "Parent" column value** — always derived via lookup against the in-memory category list.
- **Critical fact with no in-UI signal at all**: per §5.4, this entire parent-child hierarchy is used **for UI filtering only** and has **zero effect on stock, costing, pricing, or any other business logic**. Nothing on this screen states that — probably the single most important tooltip candidate on this tab, since a user could reasonably (and incorrectly) assume nesting affects reordering rules, cost allocation, or reporting rollups.
- **Category is many-to-many with products**, not one-to-one — this tab has no way to see or imply that fact since it shows no product counts or associations, only the category tree itself.

---

### Inventory Policy

## Inventory Policy (`frontend/src/pages/Settings.tsx` — `InventoryPolicyTab`)
**Route:** Settings tab, no dedicated route
**Purpose:** Toggle the system-wide policy that determines whether sales and transfers can post when there isn't enough stock on hand.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| **Allow Negative Stock** toggle switch | Flips `system_settings.allow_negative_stock`, immediately (no separate Save step, no confirmation) | Backend restricts writes to Admin/Manager-tier roles; this tab is only reachable by a role holding that permission, so no secondary confirmation exists for such a system-wide change | Affects **both** sales posting and transfer creation simultaneously — the on-screen description says "sales and transfers" but doesn't clarify it's one global switch with no per-location/per-role override. Per §9.9, even when enabled, the **cost layer sufficiency check still applies for transfers** — enabling this does not guarantee a transfer succeeds if FIFO layers are exhausted (a documented gap in requirements §17). None of that nuance is on-screen. | "Negative stock" — practical meaning is explained reasonably well, but the cost-layer caveat is not mentioned at all | Medium-High — reads as a simple universal on/off, but its real effect is asymmetric between sales and transfers |
| Status badge ("On"/"Off") | Reflects current state, amber when on / emerald when off | — | — | — | Low |
| "Last updated" metadata line | Shows `updated_at` and, if present, `updated_by_username` | Only rendered when `updated_at` exists | Easy to overlook given its small, muted styling relative to the toggle | — | Low |

#### Derived / calculated / conditionally-shown values

- **`enabled`** — derived as `policy?.allow_negative_stock ?? false`, so during initial load or a silent fetch failure the UI defaults to the "Off" (safe) state, potentially misrepresenting the true server state for a moment.
- **Toggle knob position/color** — purely derived from `enabled`.
- **"Last updated" line visibility** — conditional on `updated_at`; the `by {username}` portion is separately conditional on `updated_by_username`.
- **Intended use case not stated anywhere on-screen**: per §9.9, this flag exists specifically for "after-the-fact auditor encoding where physical stock counts may not be current" — i.e. a specific transcription/backfill workflow (the Sales Encoding Workstation, §18), not a general permissive stock-tolerance setting for day-to-day floor operations. The description text hints at this but doesn't connect it to any specific screen or workflow — a manager could reasonably flip this on permanently for the wrong reason.

---

### Import Hub

## Import Hub (`frontend/src/pages/settings/ImportHub.tsx`)
**Route:** Settings → "Import" tab, no dedicated route (lazy-loaded)
**Purpose:** Bulk-create/update inventory-adjacent records (suppliers, opening stock, variant prices, variant costs) via Excel upload, with a preview/diff/confirm workflow to avoid blind writes.

#### Interactive elements

| Element | What it does | Business logic / validation | Non-obvious behavior, edge cases, dependencies | Domain terms a new user won't know | Confusion risk |
|---|---|---|---|---|---|
| Entity sidebar (Suppliers / Opening Stock Balances / Variant Prices / Variant Costs, plus out-of-scope Customers) | Switches the active entity form | List filtered to entities whose action key the user holds; no visible entities shows a permission message instead | If the currently-selected entity falls outside the user's visible set mid-session, silently falls back to the first visible entity | — | Low |
| **Anchor** label under each entity's title | Static text stating the matching key (e.g. `PID + supplier_code`) | — | The only in-UI explanation of "how does the system know if this is a new record vs. an update" — easy to skim past, small/muted text | "Anchor" — used without definition | Medium — the whole create-vs-update behavior hinges on this one word |
| **↓ Download Template** button | Fetches a server-generated `.xlsx` template | — | — | — | Low |
| **↑ Upload XLSX** file input | Parses the file client-side, reads the first sheet only, numbers rows assuming row 1 is a header, POSTs to `/preview` | Rejects client-side if no sheet found or zero data rows; blanks coerced to `''` | Only the **first sheet** in a multi-sheet workbook is ever read — no sheet picker, no warning if other sheets have data | — | Medium — silent first-sheet-only behavior could confuse a user with data on a second tab |
| Validation Results panel | Summarizes the preview response (creates/updates/no-op/error counts) | Preview performs **no writes** — safe to re-run, but this isn't stated on-screen | — | "no-op" — a row that exactly matches what's already stored; shown as a distinct chip but never defined | Low-Medium |
| Per-row error list | Shows why specific rows were rejected; excluded from anything confirmable | — | No way to "fix and retry" a single row in-app — the user must correct the source file and re-upload the whole batch | — | Medium |
| **↓ Error Report** button | Downloads a `.xlsx` of error rows | Only shown when errors exist | — | — | Low |
| **Review & Confirm →** button | Opens the diff modal for all non-error rows | Disabled when zero actionable rows | — | — | Low |
| **Diff modal → per-row checkbox** | Include/exclude a row from being written | All actionable rows **pre-selected by default**; no-op rows are filtered out of the modal entirely | A user who clicks through without reviewing writes every proposed change | — | Medium — default-select-all on a bulk financial/inventory-affecting write is a real "didn't mean to change that" risk, especially for Variant Prices/Costs |
| **Select all / Deselect all** links | Bulk-toggle every actionable row | — | — | — | Low |
| Diff table (Anchor / Mode / Field / Current / Incoming) | Shows exactly which fields change and their before/after values | For `create` rows, "Current" is always blank; for `update` rows, only changed fields shown (highlighted) | — | "Mode" badge (create/update) | Low |
| **Apply N rows** button | POSTs only the checked anchors + full row set to `/confirm` | Disabled while applying or with zero rows selected | If confirm returns partial success, the modal shows only the *first* error — successfully-written rows aren't distinguished from failed ones in that message | — | Medium — terse partial-failure feedback |
| **Cancel** (modal) | Closes without writing anything | — | — | — | Low |

#### Derived / calculated / conditionally-shown values

- **`creates` / `updates` / `noops` counts** — derived client-side from the already-fetched preview response.
- **Per-field yellow highlighting** — only applied to fields present in `diff_fields`, i.e. fields that actually changed.
- **Success banner** — only shown after a fully clean confirm (zero errors); a partial-success response surfaces via the modal's inline error text instead and does not auto-close the modal.

**Entity-specific business logic** (drives what appears in the diff/error panels, not directly visible as UI copy):

- **Suppliers** — anchor `supplier_code`; `supplier_code` itself is never updatable once a supplier exists, only name/terms/bank/contact fields can update.
- **Opening Stock Balances** — anchor `PID|location_name`; every row is `update` or `noop` (never `create`), defaulting "current" to 0 if no `current_stocks` row exists yet. Rejects unknown PID, unknown/inactive location, `Virtual`-type locations, `Non-Inventory`/`Service` product types, and bundle variants. Writes `delta = new_qty − current_qty` as an `ADJUST` ledger entry — the UI never explicitly states this is a **delta**, not an absolute overwrite, until the diff's Incoming column is inspected.
- **Variant Prices** — anchor `PID`; validates `price > 0`, `promo_price >= 0`, and `promo_price <= effective price` (the *new* price if also being set in the same row). The `clear_promo` column explicitly nulls `promo_price` even if a `promo_price` value is also present — takes precedence. Writes `variant_price_history` per changed row.
- **Variant Costs** — anchor `PID|supplier_code`; requires a **pre-existing** `variant_suppliers` link (the error message tells the user to create the link first on Product Detail — this import cannot create the relationship itself). Validates `gross_cost > 0`, `supplier_discount` 0–100. Writes `variant_cost_history` per changed row.

---

## Appendix: Route Map

Wired in `frontend/src/App.tsx`:

- `/inventory/*` → `Inventory` (gated by `inventory_catalogue` program)
  - `/inventory` (index) → Catalogue
  - `/inventory/new` → New Product
  - `/inventory/:variantId` → Variant Detail (additionally gated by `manage_products`)
- `/stock/*` → `Stock` (gated by `stock_transfers`/`stock_receiving`/`stock_ledger`)
  - `/stock/transfers` → Stock Transfers List
  - `/stock/transfers/new` → New Stock Transfer
  - `/stock/transfers/:transferId` → Transfer Detail
  - `/stock/receiving` → Receiving — Shipment List
  - `/stock/receiving/new` → Receiving New (Stage 1)
  - `/stock/receiving/:shipmentId` → Receiving Detail
  - `/stock/receiving/:shipmentId/confirm` → Receiving Confirm (Stage 2)
  - `/stock/ledger` → Inventory Ledger
- `/procurement/*` → `Procurement` (gated by `procurement_suppliers`/`procurement_purchase_orders`)
  - `/procurement/suppliers` → Suppliers
  - `/procurement/purchase-orders` → Purchase Orders
  - `/procurement/purchase-orders/:po_id` → Purchase Order Detail
- `/settings` → `Settings` (no sub-routes — internal tab state, not react-router; Locations/UOMs/Categories/Inventory Policy/Import are tabs within this one page, alongside non-inventory tabs)

**Excluded as dead code**: `frontend/src/_archive/` contains a legacy App.tsx, Settings.tsx, and older components (`ProductTable.tsx`, `ProductDetail.tsx`, `LocationManager.tsx`, `TransferForm.tsx`, `TransferList.tsx`, `PurchaseOrders.tsx`, `InboundShipments.tsx`, `GoodsReceipts.tsx`, `ItemLedger.tsx`, `SupplierMaster.tsx`, `BulkImportModal.tsx`) — none of it is imported from the live `App.tsx` and it was excluded from this audit.
