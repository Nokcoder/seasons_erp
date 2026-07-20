# GoTrue Auth Migration — Planning Notes

**Status:** Scoped and researched. Not started. Deprioritized behind production migration investigation.

**Last updated:** 2026-07-20

---

## Why this came up

A login/credential-security audit of the current in-house auth (`auth/router.py`) found:

| Item | Finding |
|---|---|
| Password hashing | ✅ bcrypt via passlib, cost 12 — adequate, just untuned |
| Rate limiting / lockout | 🔴 Absent. `auth.login_attempts` is written but never queried — logged, not enforced. No app- or nginx-level throttle. Unlimited password guessing per account/IP. |
| Password policy | 🔴 Absent. No min length, no complexity, no breach check. Bare `str` fields everywhere. |
| MFA/TOTP | 🔴 Not supported at all |
| Timing/enumeration | 🔴 Confirmed real. Unknown username/org_slug short-circuits before `bcrypt.verify()`, creating a measurable timing oracle that undermines the deliberately generic 401. |
| JWT/session | ⚠️ 12h TTL, no refresh, no revocation. A stolen token is valid up to 12h with no server-side kill switch. |

Conclusion at the time: rate limiting, password policy, and the timing fix are small and self-contained — worth fixing regardless of vendor choice. MFA, breach intelligence, and token lifecycle are the higher-effort pieces where a specialist provider earns its cost.

## Build vs. buy decision

Considered: hardening in-house, WorkOS (SSO-layered-on-top model), Supabase's **hosted** Auth product, and self-hosting **GoTrue** (the open-source engine behind Supabase Auth).

**Decided: self-hosted GoTrue**, run as its own container against a **dedicated second Postgres instance**.

Reasoning:
- GoTrue defaults to creating and owning a schema literally named `auth` — a direct collision with our existing `auth.users`/`employees`/`roles`. A separate dedicated Postgres for GoTrue sidesteps this entirely (GoTrue owns `auth` in its DB; we keep `auth` in ours).
- Self-hosting fits our existing operating pattern (self-hosted Postgres, Docker, Cloudflare tunnel) — no new external dependency, no user data leaving our infrastructure, no recurring subscription, and no added network-latency/uptime dependency on a third party for every login.
- Same battle-tested, vetted code either way (hosted Supabase Auth *is* GoTrue) — the real tradeoff was "who patches it," and we're already comfortable owning that kind of operational responsibility.
- Rejected hosted Supabase Auth: credentials would live outside our infra, adds a network dependency for every login, ongoing cost, and migrating away later likely forces a full password reset for every user (can't extract hashes back out).
- Rejected WorkOS: it's an SSO/SCIM layer for enterprise customers, not a general credential-security fix — doesn't address the audit's core findings (rate limiting, password policy, timing, MFA) the way GoTrue does.

## What GoTrue replaces (closes from the audit)

- Password hashing, storage, verification
- Rate limiting on auth endpoints (built into GoTrue)
- Password strength requirements + leaked-password (HIBP) protection
- MFA/TOTP
- Token lifecycle: short-lived access tokens (~1h default) + refresh tokens with rotation/reuse-detection + real logout/revocation — replaces the current 12h/no-refresh/no-revocation model
- The timing oracle — **conditionally**: only if our façade always calls GoTrue (even for unknown username/org_slug) and returns a uniform error. If the façade short-circuits before calling GoTrue on a bad org_slug, the same oracle comes back.

## What stays entirely ours — unaffected by this migration

- **All 47 RLS policies** across auth/inventory/procurement-ap/sales-settings/leaf-pilot/document_sequences, and the hardened NULL/empty-string-safe predicate. GoTrue doesn't touch Postgres RLS.
- The tenant model itself: `platform.tenants`, `org_slug` resolution, `tenant_id` as the isolation unit. GoTrue has no concept of tenants.
- `erp_app`/`erp_admin` role separation and the RLS-bypass seam.
- RBAC (`auth.roles`, `require_permission`, employee-role linkage) — GoTrue handles authentication only, never authorization.
- `platform.platform_owners` — deliberately kept separate as a break-glass identity outside GoTrue, so a GoTrue outage/misconfig can't lock us out of platform administration.
- The two unrelated pending hardening items (see "Open items" below) — not auth-related, GoTrue doesn't absorb them.

## Key technical findings (sourced against current Supabase/GoTrue docs)

### Infra
- GoTrue takes its own `DATABASE_URL` and auto-applies its own migrations on startup. Point it at a dedicated second Postgres (new Compose service, e.g. `auth-db` + `gotrue`).
- GoTrue expects a dedicated `supabase_auth_admin` role with full rights on its own schema.
- The second DB needs to hold **nothing of ours** — an empty database + the admin role; GoTrue creates its full schema itself (`auth.users`, `identities`, `sessions`, `refresh_tokens`, `mfa_*`, `audit_log_entries`, `flow_state`, `one_time_tokens`, SSO/SAML tables, etc.). Exact table set is version-pinned.

### Password migration
- Existing passlib bcrypt-12 hashes **can be imported without a forced reset**, via the admin `createUser` API's `password_hash` field (bcrypt and Argon2 both supported).
- Caveat to spot-verify against the pinned GoTrue version: docs use the `$2y$` prefix, passlib emits `$2b$` — cross-compatible in practice, but confirm before relying on it.
- `createUser` **requires an email** — see identity model mismatch below, this is the actual blocker, not the hash format.

### Identity model mismatch — the real integration work
- GoTrue = UUID + globally-unique email, single global namespace, **no username concept**.
- Ours = `(tenant_id, username)`, with usernames **reused across tenants** (both `default` and `acme` have an `admin`). One GoTrue instance cannot hold two `admin` accounts.
- **Every user needs a globally-unique email before migration is possible** — real (if collected) or synthetic (e.g. `username@<tenant-slug>.internal`). This decision gates everything downstream and hasn't been made yet.

### Proposed mapping
Add to our own `auth.users` (not GoTrue's DB — no FK possible across separate databases, mapping is app-maintained):
```sql
ALTER TABLE auth.users ADD COLUMN gotrue_user_id uuid UNIQUE; -- nullable during migration
```
(Alternative: a dedicated `auth.identity_map(gotrue_user_id uuid PK, user_id, tenant_id)` table if isolating the coupling is preferred.)

### Proposed login flow — keep our endpoint as the façade
Contract stays the same from the client's perspective (`org_slug`, `username`, `password`):

1. Client → `POST /auth/login {org_slug, username, password}` (unchanged)
2. Resolve `org_slug` → `tenant_id` via `platform.tenants` (unchanged)
3. Map `(tenant_id, username)` → GoTrue email
4. Server-to-server call to GoTrue `POST /token?grant_type=password` over the internal network
5. GoTrue verifies, returns its access + refresh tokens
6. Verify GoTrue's JWT, extract `sub` (UUID)
7. Look up `gotrue_user_id` → `tenant_id` + roles
8. Issue our own internal JWT with the existing claim shape (`tenant_id`, `roles`) — **least churn**: `get_current_user`, `require_permission`, and the `SET LOCAL app.tenant_id` bootstrap in `database.py` all stay exactly as they are today.

**Longer-term alternative** (not needed for a first cut): GoTrue's custom access-token hook can inject `tenant_id`/`role` directly into GoTrue's own JWT, letting us consume its token directly and drop step 8. More elegant, more moving parts.

**Hard requirement to preserve the timing fix:** the façade must call GoTrue and return a uniform error path even when `org_slug`/`username` don't resolve — never short-circuit early, or the original timing oracle reappears.

## Still to be built regardless of GoTrue

- The UUID → `tenant_id` + role mapping — becomes security-critical; a wrong mapping crosses tenants, and GoTrue enforces none of our tenant boundary.
- `org_slug` resolution + the login façade + the JWT-verification swap in `dependencies.py`.
- The email strategy decision (real vs. synthetic) for username-only users.
- Provisioning/sync: tenant signup must atomically create the GoTrue user + our mapping (partial-failure handling, same as today's atomic signup). Deactivation must sync to GoTrue ban/delete.
- Data migration script: for each existing user, `createUser` with `password_hash` (+ chosen email) and write the mapping.
- SMTP config, if GoTrue's own email flows (reset/confirm) are used.

## Proposed implementation plan (scoping only — nothing started)

1. **Spike (½–1 day):** stand up `auth-db` + `gotrue` in Compose against a throwaway DB. Import one existing user via `createUser` with a real `$2b$12$` hash. Confirm login through `/token`. Resolves the hash-compat and import questions for real.
2. **Decide the email strategy** (real vs. synthetic) — gates everything else.
3. **Design the mapping + façade** (column vs. table; own-JWT vs. custom-claim hook).
4. **Write the migration script** for existing users; update signup/provisioning.
5. **Cut over login to the façade**; RLS/RBAC remain untouched throughout.

## Sequencing decision (2026-07-20)

GoTrue was assessed as structurally **smaller and more contained** than the multitenancy effort — it touches one table meaningfully (`auth.users` gets a mapping column) plus new isolated infrastructure, versus multitenancy's changes across nearly every table and every transaction. Per the stated decision rule ("only prioritize auth right now if it's as consequential as multitenancy was"), GoTrue was **deprioritized in favor of production migration investigation**.

Explicit risk accepted: production migration may proceed before GoTrue lands, meaning real users would be exposed to the audit's open gaps (no rate limiting, no password policy) until GoTrue is implemented. This was a deliberate choice, not an oversight — logged here so it isn't forgotten.

## Open items (not part of GoTrue, but adjacent/pending)

- `tenant_id` column-default hardening (wrap the `current_setting(...)::integer` cast in `nullif(...)` across ~44 defaults) — confirmed still pending as of 2026-07-20, no migration exists yet. Low urgency (INSERT-time only, fails closed today, no live trigger path).
- `core/doc_sequence.py:44,61` — missing the `, true` missing-ok flag on `current_setting`, unlike every other read site. Confirmed still pending. Low urgency but the sharpest edge case of the family (throws on any contextless call, not just NULL-unsafe).
- Production migration (Track C in the roadmap) — currently the active priority. As of this writing, "production" refers to anticipated existing single-tenant customer deployments outside this repo, not yet located or inspected — the actual scope is still unknown pending direct access/information from the user.
