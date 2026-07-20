# Multi-Tenancy Architecture & Implementation

Status: **Phase 1 COMPLETE. Phase 2 COMPLETE.** Privilege separation, per-request tenant
context, and RLS are live; **all five domain schemas (`inventory`, `procurement`, `ap`,
`sales`, `settings`) are tenant-scoped under RLS**, per-tenant document numbering is live,
`auth.audit_log` now carries `tenant_id`, and RBAC permission enforcement is applied across
every mutation and sensitive read. **Tenant scoping is COMPLETE** — no scoped surface remains.
Last updated: 2026-07-14 · Current Alembic head: `bb22cc33dd44`

> **Pick-up-cold orientation:** the app runs as a non-superuser Postgres role (`erp_app`)
> under Row-Level Security. Each request sets `app.tenant_id` from the JWT; RLS policies
> filter every scoped table to that tenant automatically. Administrative paths (migrations,
> boot seeds, signup) run as the superuser `erp_admin`, which **bypasses RLS**. To extend
> tenancy to a new schema, follow the **"Repeatable cluster recipe"** below.

## Decision Summary

- **Model:** Shared schema + `tenant_id` column. Not deploy-per-tenant, not schema-per-tenant.
- **Why:** Tenants are other businesses we onboard; onboarding must be a DB insert, not an infra op.
- **Tenant resolution:** Org slug typed at login (`{org_slug, username, password}`), **not** subdomains. Subdomains remain addable later as a pure routing layer without revisiting this work.
- **RBAC:** `auth.programs` / `auth.actions` (feature catalog) are **global**; `auth.roles` + grants are **per-tenant**.
- **Isolation mechanism (FINALIZED): Postgres Row-Level Security**, not per-router application filters. Phase 1 proved manual per-endpoint scoping gets missed repeatedly, and the codebase already trusts DB-level backstops (the PID/barcode triggers). RLS makes isolation the default and — proven, not assumed (see Lessons) — auto-corrects app queries that forgot to scope.

---

## THE CENTRAL LESSON FROM PHASE 1 — read before any new phase

**Single-tenant state masks tenant-isolation bugs completely.** Phase 1 took *five separate passes* over the same bug class, each finding another instance, every one invisible until a second tenant existed (unscoped `register`, role lookups, role-by-id endpoints, `_load_employee`, unscoped list endpoints). Several were *silent* — 200 while doing an unscoped lookup.

**Consequence for all phases:** two live tenants — **`default` (tenant_id 1)** and **`acme` (tenant_id 5)** — are kept in the dev DB. **Do not tear them down.** Every change is verified against both, with cross-tenant probes as a standard step. Login creds: `default` → `admin`/`Omni4GangSockets`; `acme` → `admin`/`AcmePass123!`.

---

## Phase 1 — COMPLETE

`auth` schema fully tenant-scoped (via **application-layer** scoping — Phase 1 predates RLS). Delivered: `platform.tenants`; `tenant_id` NOT NULL on `auth.employees/users/roles` with composite `(tenant_id, username)` / `(tenant_id, role_name)` uniques; nullable `tenant_id` on `auth.login_attempts`; `seed_roles_for_tenant()`; org-slug login with `tenant_id` in the JWT and `get_current_user` filtering `(user_id, tenant_id, is_active)`; `POST /platform/signup` (atomic). All five Phase-1 bug-class instances closed. Unauthenticated-endpoint sweep clean. **Frontend login org-slug field + `AuthContext` tenant_id handling: DONE.**

> Note: `auth` uses **app-layer** scoping, not RLS. It is not part of the RLS rollout. `auth.audit_log` carries `tenant_id` via a GUC `server_default` (app-layer, since `auth` isn't RLS'd) — see What is DONE.

---

## Phase 2 — IN PROGRESS

### What is DONE

**Step 1 — Privilege separation (migration `a7b8c9d0e1f2`).**
- New login role **`erp_app`**: `NOSUPERUSER`, `NOBYPASSRLS`, no CREATE. Granted `USAGE` + DML on every schema, `USAGE, SELECT` on all sequences (the serial-PK grant that's easy to miss), and `ALTER DEFAULT PRIVILEGES` so future migration-created tables/sequences are auto-granted. Password in **`APP_DB_PASSWORD`** (`.env`).
- **`erp_admin`** stays superuser + owner + migrator, unchanged.
- **Two-engine seam** in `core/database.py`: `engine`/`SessionLocal` → `erp_app` (used by `get_db`, the request path); `admin_engine`/`AdminSessionLocal` → `erp_admin` (used by `get_admin_db`). Boot DDL + boot seeds + `POST /platform/signup` run on the admin engine. Alembic connects as `erp_admin` (`DATABASE_URL`); the app request path connects as `erp_app` (`APP_DATABASE_URL`).

**Step 2 — Per-request tenant context (code only, no migration).**
- `get_db(request: Request)` decodes the JWT (secret read from env to avoid a circular import), and stores `tenant_id` on `session.info`.
- A SQLAlchemy **`after_begin` event listener** on the app sessionmaker issues **`SET LOCAL app.tenant_id = <n>`** from `session.info` at the start of **every** transaction.
- Unauthenticated requests set nothing → GUC unset → (under RLS) zero rows. `get_admin_db` has no listener → admin path never sets context.
- Proven pool-safe: 1500 interleaved concurrent requests across both tenants, 0 GUC bleed across pooled connections; unauthenticated requests never inherited a prior tenant.

**Step 3 — `tenant_id` on 8 leaf tables (migrations `b8c9d0e1f2a3`, `c9d0e1f2a3b4`).**
`inventory.locations`, `uoms`, `product_categories`, `suppliers`; `sales.payment_modes`, `cash_registers`, `shifts`, `customers`. Each: nullable FK → backfill to tenant 1 by slug → NOT NULL → **GUC `server_default`**. Composite uniques: location_name / uom_code / category_name / supplier_code. Index `ix_customers_tenant_id`. Singleton seeds refactored into **`seed_defaults_for_tenant()`** (Quarantine/Adjustment locations + Store Credit + payment-mode flags, per tenant); acme backfilled its own.

**Step 4 — RLS pilot on those 8 tables (migration `d0e1f2a3b4c5`).**
`ENABLE` + `FORCE ROW LEVEL SECURITY` + one `tenant_isolation` policy each (`USING` and `WITH CHECK` both `tenant_id = current_setting('app.tenant_id', true)::integer`). Verified: per-tenant reads, WITH CHECK blocks cross-tenant writes, unset context → 0 rows (fail closed), admin seam unaffected.

**Step 5 — Full `inventory` cluster, 14 tables as ONE unit (migrations `e1f2a3b4c5d6`, `f2a3b4c5d6e7`).**
`products, variants, variant_barcodes, variant_uom_conversions, bundle_components, product_category_links, variant_suppliers, current_stocks, cost_layers, inventory_ledger, inventory_transfers, inventory_transfer_items, variant_price_history, variant_cost_history`. Same pattern (tenant_id + GUC default + RLS). Composite uniques: `variants.PID`, `variant_barcodes.barcode`, `inventory_transfers.transfer_pid`. Indexes: `ix_ledger_tenant_variant`, `ix_ledger_tenant_occurred`, `ix_cost_layers_tenant_variant`. ORM models mapped and verified against migrations (see Lessons).

**Step 6 — procurement + ap cluster, 9 tables as ONE unit (migration `p1a2b3c4d5e6`).**
`procurement.{purchase_orders, purchase_order_items, inventory_shipments, receiving_details}` + `ap.{supplier_invoices, supplier_invoice_items, supplier_payments, invoice_payments, ap_ledger}`. Migrated together because they're FK-entangled (`ap.supplier_invoices → procurement.inventory_shipments`). Composite uniques: `po_pid`, `shipment_pid`. `ap_ledger` (append-only) got `(tenant_id, supplier_id)` + `(tenant_id, occurred_at)`. Noted: **`ap` has zero user-attribution columns** — but `tenant_id` is a direct column, so scoping is unaffected.

**Step 7 — sales + settings cluster, 12 tables (migration `q2b3c4d5e6f7`). All five domain schemas are now RLS-isolated.**
The 11 remaining `sales` tables (`ar_ledger, sales, sale_items, customer_payments, customer_payment_applied, sales_returns, sales_return_items, supplier_returns, supplier_return_items, credit_memos, credit_memo_redemptions`) + `settings.system_settings`. Two landmines handled:
- **`sales.sale_pid` partial index kept its predicate:** the unique index became `(tenant_id, sale_pid) WHERE status <> 'Voided'` — still partial, so a **voided sale's PID stays reusable, now per tenant** (not converted to a plain composite constraint). Verified: a new Posted sale can reuse a voided one's PID.
- **`settings.system_settings` PK restructured** from `(key)` to composite **`(tenant_id, key)`** (a real PK change, not just an added column). Its seed moved into `seed_defaults_for_tenant` (per-tenant `allow_negative_stock`); acme backfilled its own. (`pos_cashiering_mode` is an orphan read by no code — backfilled to tenant 1 only.)

Composite uniques also converted: `sales.idempotency_key`, `customer_payments.idempotency_key`, `sales_returns.{return_pid, idempotency_key}`, `supplier_returns.return_pid`, `credit_memos.code`. Indexes: `ar_ledger` (append-only) `(tenant_id, customer_id)` + `(tenant_id, occurred_at)`; the highest-growth tables `sales` `(tenant_id, transaction_date)` + `(tenant_id, customer_id)` and `sale_items` `(tenant_id, variant_id)`.

**End-to-end usability proof.** acme (a real second tenant) completed a full **supplier → UOM/category/location → product+variant+barcode → PO → shipment → receive → confirm-costs → customer → POS sale → return** chain entirely through the API — zero 500s, every row in tenant 5, tenant 1 untouched. This proved *usability*, which every prior isolation test had not. **Both tenants now carry real data** (a second tenant with real data makes every future test more honest than an empty one). It also caught the document-numbering bug below.

**Per-tenant document numbering (migration `r3c4d5e6f7a8`).**
`platform.document_sequences` (`(tenant_id, doc_type)` PK, `next_number`), RLS-forced. Numbers allocated with **atomic `INSERT .. ON CONFLICT DO UPDATE .. RETURNING`** under a row lock held until commit — concurrent callers in the same tenant serialize, no `MAX()+1` race, no retry-on-conflict in the POS path. Helper in `core/doc_sequence.py` (`next_document_pid` / `peek_next_document_pid`). **6 doc types: SALE, RET, SRET, PO, SHP, TRF** (all the `f"X-{serial_id}"` sites; `CM`/credit-memo excluded — random code, not sequential). Existing tenants' counters seeded to `max + 1` so their numbering **continues** (tenant 1 SALE → 108, no restart); new tenants auto-start at 1. `GET /sales/next-pid` now reads the counter so preview == actual. Proven: 300 concurrent allocations → 300 distinct, 0 duplicates; 5 concurrent real POS posts → distinct PIDs, 0 collisions.

**Also done:** `POST /platform/signup` gated behind a shared secret — header **`X-Platform-Key`** checked against env **`PLATFORM_SIGNUP_KEY`** (fails closed if unset; missing/wrong → 401). Endpoint logic untouched; swap this gate for a real admin UI's auth later.

**Permission enforcement — every mutation and sensitive read gated (migration `aa11bb22cc33`).**
Three passes closed the RBAC-enforcement gap the Phase-1 sweep found:
- **26 unprotected mutations** → each mapped to its existing action key and gated with `require_permission` (categories/uoms/products/barcodes/bundle-components/uom-conversions/variant-suppliers, the procurement shipment flow, PO line edit, location edit, import preview). Verified with a **real CASHIER (403) vs ADMIN (not-403)**, 0 failures.
- **60 unprotected reads** → classified GATE / LEAVE-OPEN / uncertain against the *actual* cashier flow. **44 gated** (AP, procurement, inventory/products, transfers, RBAC catalog, import templates, inventory-policy) under existing `view_*`/`manage_*` keys; **16 left open** — everything the POS/returns UI calls (pos-catalog, customers, payment-modes, registers, shifts, locations, drafts, credit-memo validate, `/sales/{id}`, next-pid, `/auth/me`). CASHIER holds only `process_sale` + `process_returns`, so any `view_*` gate on a POS read breaks checkout; verified a real cashier **still completes a full POS sale end-to-end** after gating (SALE-00008), and both tenants' admins still load every screen.
- **Granular settings keys wired up + phantom actions retired.** The shifts/registers/payment-modes mutation endpoints were guarded by the coarse `manage_sales_settings` while the frontend gated the tabs by the granular `manage_shifts`/`manage_registers`/`manage_payment_modes` — a front/back mismatch; the endpoints were narrowed to the granular keys, and PDC deposit/bounce narrowed from `manage_customers` → `manage_pdc`. Two seeded actions that guarded **no distinct endpoint** were **retired** (catalog 58→56): `receive_transfer` (transfers are single-step — `create_transfer` records a *completed* transfer with `quantity_received` inline; there is no separate receive op) and `manage_sales_settings` (superseded by the granular keys). No role lost real capability — every holder already had the covering key.

**Enforcement now: 44 of 56 actions** (`require_permission` 42 + `has_action` 2). The remaining 12 are decorative **by design**, not gaps: 8 `export_*` have no backend endpoint (Excel is built client-side from already-gated list data), `manage_appearance` gates a frontend-only tab, and `view_ap_aging` / `view_customer_aging` / `view_credit_memos` gate endpoints that **are** enforced — under the adjacent `manage_invoices` / `manage_customers` keys (a view/manage granularity choice, not an open door). (`auth/permissions.py` is dead pre-RBAC code referencing never-seeded actions — flagged, not wired to anything.)

**`auth.audit_log` tenant_id — last piece of tenant scoping (migration `bb22cc33dd44`).**
Added `tenant_id` to `auth.audit_log`. Mechanism: a **GUC `server_default`** (`current_setting('app.tenant_id', true)::integer`) — `write_audit()` receives the per-request session that already ran `SET LOCAL app.tenant_id`, so all **40 call sites auto-fill with zero code changes and no risk of a missed site** (chosen over threading `tenant_id` through `write_audit`, whose only tenant source is that same session). **Nullable by design:** `auth` isn't RLS'd and genuine system/boot writes have no tenant; forcing NOT NULL would break boot writes and misattribute platform activity. Backfilled all 382 rows: actor rows → `users.tenant_id`; the 18 null-actor rows → **attributed by the record they touched** (`record_pk` → the touched row's tenant) — **0 left NULL**. FK to `platform.tenants` + `(tenant_id, occurred_at)` index; model mapped and drift-checked. Verified: live audited writes from **both** tenants land with the correct `tenant_id` via the default (acme→5, default→1).

### DECISIONS & LESSONS worth carrying forward

1. **Migrate FK-coherent CLUSTERS, not leaf-first.** Scoping a *referenced* table (e.g. `locations`) while its *referencing* tables (`current_stocks`, `variant_suppliers`, `products`) stay unscoped creates **dangling-reference 500s** for a non-owning viewer: the referencing row is visible but its RLS-hidden referenced row resolves to `None`, and response serialization blows up. This is exactly why `GET /products/` 500'd for acme during the pilot. Migrate everything in an FK cluster together so no such window exists.

2. **`SET LOCAL` must be re-applied per transaction, not once per session.** It is transaction-scoped, and handlers here commit multiple times per request (`write_audit` pattern). A "set once in `get_db`" approach silently loses context after the first commit — and would pass every test that reads the GUC before the first commit, then fail-closed to zero rows mid-request under RLS. The `after_begin` listener re-applies it on every transaction. **Never** use a session-level `SET` — it survives the pool's reset-on-return and leaks one request's tenant into the next.

3. **GUC `server_default` for `tenant_id` on writes — no per-endpoint code.** Columns default to `current_setting('app.tenant_id', true)::integer`; the ORM omits the unmapped/defaulted column on INSERT and the DB fills it from the request GUC, validated by the same expression in the policy's `WITH CHECK`. Admin/seed paths that set `tenant_id` explicitly override it. Contextless inserts get NULL → rejected by NOT NULL (fail closed). This is the standard pattern for all future clusters — do not add `tenant_id=...` to endpoints.

4. **`erp_admin` trigger false-positive — a long-fuse landmine.** The PID/barcode collision triggers are `SECURITY INVOKER`, so under `erp_app` their `EXISTS` scans auto-scope per tenant (global-unique → per-tenant-unique, the behavior we want). But `erp_admin` bypasses RLS, so **any admin-side write to `variants`/`variant_barcodes` makes them scan all tenants and false-positive**, rejecting a valid per-tenant PID. Not hit today (no admin path writes variants; imports run as `erp_app`). Documented in `CLAUDE.md` and via `COMMENT ON FUNCTION` on both triggers. **Any future admin/bulk inventory write must run as `erp_app` or `SET app.tenant_id` first.**

5. **RLS auto-scopes unscoped app queries — PROVEN, not assumed.** `create_category`'s duplicate-name check is a bare `filter(category_name == ...)` with no tenant filter. Pre-RLS it wrongly rejected acme creating a name tenant 1 already had. Post-RLS the same query only sees the caller's tenant → acme's create succeeds, and its own duplicate still 400s. This is the core justification for choosing RLS: it backstops the exact "forgot to scope" class that bit us five times in Phase 1. (Fail-safe direction too: unscoped queries fail *closed* — restrictive, not leaky.)

6. **Models vs migrations had NEVER been compared until Step 5 — and 4 real drifts existed.** `main.py` runs `create_all()` on boot and `reset_db.py` does `DROP SCHEMA` + `create_all()`, so the models ARE a build source of truth. A from-scratch build was diffed against the migration-built schema (throwaway DB, `information_schema.columns`, all 7 schemas): found `platform.tenants.created_at` nullable-in-model-but-NOT-NULL-in-migration, plus 3 missing `server_default`s (`tenants.is_active`, `programs.sort_order`, `roles.is_cashiering_mode`) — all fixed. **Any future schema change must keep models and migrations in sync; re-run the create_all diff after each cluster.** (This is the same drift class that made `schema.dbml` untrustworthy.)

7. **Verify against the REAL write path, not a preview endpoint.** Document PIDs were "verified" as per-tenant via `GET /sales/next-pid` — a `MAX()` scan that RLS auto-scoped, so it *looked* per-tenant. But the **actual** assignment at post time was `f"SALE-{sale_id}"` off the global serial PK — two entirely different mechanisms that had never been run against each other. acme's first real sale would have been `SALE-00108`, not `SALE-00001`, leaking tenant 1's document volume. The preview endpoint answered a question *adjacent* to the real one and hid the bug. It was only caught by making a **real sale as a real second tenant** (Step 7). **Any future verification must exercise the write path that actually runs in production — never an adjacent endpoint that appears to answer the same question.**

8. **Global monotonic identifiers across tenants are an information leak.** A tenant can infer other tenants' activity volume from the gaps/jumps in its own numbering (acme seeing `SALE-00108` reveals ~107 documents exist elsewhere; `SHP-000004` reveals 3 other shipments). This is why document numbering moved to a per-tenant counter (`platform.document_sequences`). **Any future sequential/monotonic identifier exposed to a tenant must be per-tenant, never a shared serial.**

### Repeatable cluster recipe (now used for all five domain schemas)

1. Identify the FK-coherent cluster (all tables that reference each other) — migrate it whole.
2. Per table: add `tenant_id` nullable FK → backfill to tenant 1 by slug → `SET NOT NULL` → `SET DEFAULT current_setting('app.tenant_id', true)::integer`.
3. Convert any global unique to composite `(tenant_id, value)`. Watch `sales.sale_pid` — it's a **partial** unique index (`WHERE status != 'Voided'`); `tenant_id` goes into that index, not a plain constraint. Also quote mixed-case constraint names in `DROP CONSTRAINT` (e.g. `variants_PID_key`).
4. Add `(tenant_id, ...)`-leading indexes only where an existing index would stop covering the access pattern (unbounded/append-only tables especially). Bounded reference tables and PK lookups don't need them.
5. `ENABLE` + `FORCE ROW LEVEL SECURITY` + the `tenant_isolation` policy on each.
6. **Map `tenant_id` (+ composite uniques + indexes) into the ORM models** with the GUC `server_default`. Then run the create_all-vs-migration diff and reconcile.
7. Handle raw-SQL spots and per-tenant seeds in the cluster (see landmines).
8. Verify against **both** tenants: reads isolated, cross-tenant write blocked, unset→0, the admin seam still works, and no dangling-reference 500s (`GET` the cluster's list endpoints as the non-owning tenant — must be empty, not 500). Re-run a concurrency data-assertion.

---

## What REMAINS

**Tenant scoping is COMPLETE — Phase 2 is closed.** All five domain schemas (`inventory`, `procurement`, `ap`, `sales`, `settings`) plus per-tenant document numbering are RLS-isolated; `auth` (incl. `audit_log`) is app-layer scoped; RBAC permission enforcement is applied across every mutation and sensitive read. All verified end-to-end against both tenants; both `default` and `acme` hold real data. The cluster-specific landmines from earlier drafts — the `sale_pid`/`next-pid` generators, the `system_settings` PK, and all the document-number/idempotency-key uniques — are **resolved**. Nothing tenant-scoping-related remains open; the items below are pre-existing cleanups, not scoping gaps.

**Still open, low priority:**
- **3 display-only auth lookups** in `inventory/router.py` (`get_price_history` ~L1215, `get_cost_history` ~L1246, `get_sales_history` ~L1298) resolve User/Employee by bare ID. `auth` uses app-layer scoping (not RLS), so these don't auto-scope — but the IDs come from the domain record (not caller input) and the data is display-only, so it's not probeable. Scope when convenient.
- **3 display-only PID fallbacks** left in place: `x or f"SALE-{id}"` / `f"RET-{id}"` in response serializers at `sales/router.py:999`, `:1294`, and `inventory/router.py:582`. They only fire for a NULL pid — which no longer happens now that all assignment goes through the counter — but they still reference the old global-serial format. Clean up for consistency when next touching those responses.

**RBAC granularity (optional, not a security gap):** `view_ap_aging`, `view_customer_aging`, and `view_credit_memos` are seeded but their endpoints are enforced under the adjacent `manage_invoices` / `manage_customers` keys — the data is protected, but a role can't be given aging/credit-memo *view* access without the broader *manage* key. Split these into their own guards if a read-only aging/credit-memo role is ever needed. The 8 `export_*` actions and `manage_appearance` are decorative by design (no backend endpoint) — leave as UI-layer `Can` gates.

**Operational / cleanup:**
- **`GET /products/` has no pagination** — ignores `limit`, always returns the full catalogue (~645 KB for 1004 products). Not RLS-related, but it saturated a single uvicorn worker during load testing (needed a restart). Add real pagination; consider more workers before production.
- Remove unused `INIT_ADMIN_USERNAME` / `INIT_ADMIN_PASSWORD` from `.env`.
- Disable `/docs`, `/redoc`, `/openapi.json` in production (public by FastAPI default; API-schema disclosure, not a data leak).
- `docs/schema.dbml` is stale — **do not use as a design input.** Schema-membership drift: `payment_modes`/`cash_registers`/`shifts` live in `sales`, not `settings`, contrary to `CLAUDE.md` and `schema.dbml`.

**Operational reminders:** after any `docker-compose up -d --build backend` (which recreates the container), **restart nginx** — it caches the upstream IP and returns 502 otherwise. Migrations run as `erp_admin` via the Dockerfile `CMD` (`alembic upgrade head && uvicorn ...`) before the app connects as `erp_app`.
