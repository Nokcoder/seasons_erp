# Seasons ERP — Multitenancy Roadmap

Living planning doc for the multitenancy migration. Goal: **hands-off deployment** —
new tenants can sign up, pay, and be provisioned with no manual work, and existing
single-tenant client instances can be migrated in safely.

## Governing principle

**If it changes a table's shape, a constraint, a trigger, or a PK type — it belongs
in Track A, full stop**, regardless of which phase it was originally filed under.
Schema changes get free while there's no real customer data in the system. Once
real data lands (self-serve signups or migrated legacy instances), every further
schema change becomes a real migration with real risk. So: finish all schema-shape
work first, freeze the schema, then build/migrate on top of a stable target.

## Current state — what's already done (Phase 1)

- `platform` schema + `tenants` table (Postgres schema `platform`, Python package
  `tenancy/` — not `platform/`, to avoid shadowing the stdlib module).
- `tenant_id` added to `auth.employees`, `auth.users`, `auth.roles` (NOT NULL).
  `username` and `role_name` uniqueness are composite `(tenant_id, value)`.
- `tenant_id` on `auth.login_attempts` (nullable — a bogus `org_slug` has no tenant).
- `seed_roles_for_tenant(tenant_id, db)` — per-tenant RBAC seeding, idempotent,
  not wired into boot (role seeding is a per-tenant lifecycle event).
- `POST /platform/signup` — public but gated behind `X-Platform-Key` header.
  Atomic: tenant → roles → employee → user → ADMIN grant, rolls back cleanly on
  failure. Returns tenant identity, not a JWT (single login code path preserved).
- Login + JWT: `POST /auth/login` takes `{org_slug, username, password}`. Tenant
  resolved by slug, user looked up by `(tenant_id, username)`. JWT carries a
  `tenant_id` claim. Bad slug / bad password return identical 401s (no slug-leak).
- Unauthenticated-endpoint sweep: clean (only `/auth/login`, `/platform/signup`,
  health check — plus FastAPI's `/docs`/`/redoc`/`/openapi.json` by default).
- Verified against two live tenants (default + acme).

**Still open from Phase 1 (not schema, not blocking):** frontend org-slug field on
the login form, and confirming `AuthContext.tsx` against the `tenant_id` claim.

## The four tracks

```
                    Core tenancy correctness
                    (schema completion, RLS)
                       |              |
                       v              v
              Self-serve signup   Legacy migration
              (Stripe & billing)  (ETL, per client)
                       |              |
                       v              v
                 -------------------------
                 |  Hands-off deployment  |
                 -------------------------
                            ^
                            |
                    Production ops
                 (backups, scaling — parallel,
                  not blocked by anything)
```

### Track A — Core tenancy correctness (blocking)

Everything here must land before real customer data (self-serve or migrated)
touches the system.

- **Phases 2–6**: propagate `tenant_id` through inventory, procurement, ap, sales.
- **PK strategy decision**: serial/integer vs. UUID. Determines whether migrating
  legacy instances later needs a full ID-remapping ETL or a straight backfill.
  Cheapest to decide now, while these tables are already getting schema changes.
- **~7 composite unique constraints**: PID, barcode, location/UOM/category/supplier
  names, document-number fields — converting these is much easier before real,
  possibly-colliding data exists.
- **Two PL/pgSQL triggers** (PID/barcode collision checks) — need tenant-scoping.
- **`sale_pid` generator + other raw SQL** — needs tenant-scoping.
- **Singleton seed functions + `system_settings` PK restructure**.
- **`platform.tenants` lifecycle columns** (status enum, `stripe_customer_id`,
  `stripe_subscription_id`, `billing_email`, `verified_at`) — this is a schema
  change to a table that will hold real tenant data, so it's Track A even though
  the Stripe *logic* that uses it is Track B.
- **Central enforcement layer — Row-Level Security (RLS)**:
  - RLS is a Postgres feature where the database itself enforces which rows a
    query can see, via a policy attached to the table (e.g. "only rows where
    `tenant_id` matches the current session's tenant"). It backs up app-layer
    `WHERE tenant_id = ...` filters rather than replacing them — the safety net
    for when a filter is missing, not a reason to stop writing one.
  - Applied to the leaf/inventory/procurement-ap/sales-settings clusters, and
    **now to `auth.users`/`auth.employees`/`auth.roles`** (migration `cc33dd44ee55`).
  - Needs stress-testing with cross-tenant probes as standard verification,
    per the Phase 1 post-mortem lesson: a missing filter returns 200 OK with
    someone else's data, silently — no error to notice.
- ~~**`erp_admin` connection-role question**~~ **RESOLVED**: the app connects as
  the non-superuser `NOBYPASSRLS` role `erp_app` (migration `a7b8c9d0e1f2`), with
  `erp_admin` confined to Alembic, boot seeds, and signup (`get_admin_db`). RLS
  binds correctly on the request path.
- ~~**Platform-owner identity**~~ **DECIDED**: modelled as a *separate* identity
  in `platform.platform_owners` (migration `dd44ee55ff66`, model
  `tenancy.models.PlatformOwner`), NOT a flag on `auth.users` — no `tenant_id`, no
  RLS, `erp_app` revoked from it. Schema/identity only; the platform-owner login
  endpoint + tenant-admin API are Track B.

### Track B — Self-serve signup & billing (blocked on Track A)

- Restructure signup: pending → payment → provision (not atomic-on-request,
  so abandoned checkouts don't leave half-real tenants).
- Stripe integration: Checkout session, webhook handler (`payment_succeeded`,
  `payment_failed`, `subscription_canceled`), idempotent processing (Stripe retries).
- Email verification (token, expiry, resend).
- Rate limiting on the signup endpoint (overdue regardless of payment).
- Live slug-availability check, abuse detection (disposable email domains, etc.).
- ToS/privacy consent capture at signup.

### Track C — Legacy instance migration (blocked on Track A)

Real production data, multiple existing single-tenant instances, each becoming
a tenant in the new shared-schema system.

- Clone + inspect each old instance (`pg_dump` → isolated container, never touch
  the live one directly).
- Establish per-instance: PK types (serial vs UUID — determines ETL complexity),
  current `alembic_version` (may be behind dev's migration lineage), row counts.
- Design the ETL: dependency-ordered table migration, ID remapping if PKs are
  serial, tenant_id assignment per source instance.
- Dress rehearsal — **only after Track A's schema is final**, so the rehearsal
  isn't invalidated by the next phase landing.
- Execute for real, one client at a time, with the rehearsal as the playbook.

### Track D — Production operations (parallel, not blocked)

- Automated backups with tested restores.
- Disable `/docs`, `/redoc`, `/openapi.json` in production.
- Connection/worker scaling for multiple tenants.
- Monitoring & alerting (errors, failed webhooks, failed payments).
- Deployment automation, secrets management.

## Auth layer (Track A subset) — status

1. ✅ **`erp_admin` connection-role check** — resolved: app is on `erp_app`
   (`NOBYPASSRLS`), `erp_admin` confined to migrations/boot/signup.
2. ✅ **RLS on `auth.users`, `auth.employees`, `auth.roles`** — policies written
   (`cc33dd44ee55`) + login bootstrap reworked so the pre-JWT user lookup sets
   tenant context first. **Still pending: apply to the running DB and run
   cross-tenant probes** — deferred because the instance is live behind the
   Cloudflare tunnel; applying RLS + probing is a gated step, not to be run
   against live traffic automatically.
3. ✅ **Platform-owner identity design** — decided: separate
   `platform.platform_owners` table (`dd44ee55ff66`). Behaviour (login endpoint,
   tenant-admin API) is Track B.

### Immediate next step
Apply migrations `cc33dd44ee55` + `dd44ee55ff66` in a safe window and run
cross-tenant probes against `auth.users`/`employees`/`roles` (two tenants: confirm
tenant A cannot see tenant B's users, and login still works for both).
