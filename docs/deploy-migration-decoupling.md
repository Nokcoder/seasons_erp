# Deploy/Migration Decoupling — Future Fix Needed

**Status:** Not urgent yet. No critical/real-data instance exists today. Fix before one does.

**Last updated:** 2026-07-20

---

## The problem

Current container startup command runs migrations automatically on every rebuild:

```
CMD: alembic upgrade head && uvicorn ...
```

This means **deploying new code and running schema migrations are the same action** — every rebuild silently applies whatever migrations are pending, with no pause to inspect what's about to happen, no backup checkpoint, and no chance to verify the migration is actually safe against that instance's real data before it runs.

## Why it's fine today, and why it won't stay fine

- Today: only used against disposable dev/seed data (`test.lukosledger.com` and similar). Auto-migrate-on-rebuild is genuinely convenient here — low stakes, easy to reset if something goes wrong.
- Future: at least one instance will eventually hold real data and real users. Running 18+ migrations' worth of schema change (backfilling `tenant_id`, enabling RLS, converting global-unique constraints to composite ones, etc.) automatically and blindly against unknown real data is a materially different risk:
  - A `NOT NULL` backfill can fail if existing data doesn't fit the assumption.
  - A composite-unique constraint (e.g. `(tenant_id, username)`) can fail if duplicate values exist that were previously fine under old global-unique rules.
  - There's no natural checkpoint to take a backup or review the diff before it's already applied.

This ties directly into **Track C** of the multitenancy roadmap (migrating existing/legacy instances into the new multitenancy model) — any real migration there needs deliberate, reviewed schema changes, not an automatic side effect of deploying code.

## The fix (when picked back up)

**Decouple "deploy the code" from "run the migration" for any deployment holding real data.**

Concretely:
1. Remove `alembic upgrade head` from the startup `CMD` for production-tier deployments. Keep it as-is for dev (`test.lukosledger.com`) — it's genuinely useful there.
2. Run migrations as a separate, deliberate step instead — a manual command or one-off job, triggered intentionally, not automatically on container start.
3. Require a backup immediately before any migration runs against a real-data instance.
4. Document the actual deploy runbook once decided (who runs the migration step, when, what gets checked first).

## Open questions to resolve when this is picked up

- Manual command vs. a dedicated one-off migration job/container — which fits the existing Docker Compose setup better?
- Does this apply to *all* non-dev environments, or only ones flagged as holding real data?
- Should the dev instance (`test.lukosledger.com`) eventually be split from whatever the first real-data instance becomes, to keep the "convenient auto-migrate" behavior isolated to genuinely disposable environments?
