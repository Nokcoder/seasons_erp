"""platform: harden auth-cluster RLS predicate against empty-string GUC (Track A)

Follow-up to cc33dd44ee55 (already applied), which used the house-standard
predicate:
    tenant_id = current_setting('app.tenant_id', true)::integer
That is fail-closed when app.tenant_id is NULL (a pristine connection that never
touched the GUC) — NULL::integer is NULL, so no rows match. But it is NOT robust
when the GUC is the EMPTY STRING '': ''::integer raises
`invalid input syntax for type integer: ""`, turning a should-be-empty result
into a query error. A custom/placeholder GUC becomes '' (not NULL) after
`RESET app.tenant_id` — so any code path that RESETs the setting, rather than
leaving it untouched, would make RLS'd auth reads throw instead of returning zero
rows.

This migration re-points the tenant_isolation policy on auth.users/employees/roles
to a hardened predicate that treats NULL-or-empty identically as "no context →
zero rows", never reaching the ::integer cast when the setting is unset:
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer
  - GUC '' → nullif returns NULL → NULL::integer → NULL → no rows (no error)
  - GUC NULL → nullif returns NULL → same
  - GUC '5' → nullif returns '5' → 5 → tenant_id = 5
(Equivalent to the explicit `nullif(...) IS NOT NULL AND tenant_id = ...::integer`
form, in a single current_setting evaluation.)

Applied via ALTER POLICY (USING + WITH CHECK) rather than DROP/CREATE so the
policy is never momentarily absent.

Scope note: the SAME fragile predicate exists in the other RLS-policy migrations
(d0e1f2a3b4c5 leaf pilot, e1f2a3b4c5d6 inventory, p1a2b3c4d5e6 procurement/ap,
q2b3c4d5e6f7 sales/settings, r3c4d5e6f7a8 document_sequences). Those are
DELIBERATELY left unchanged here and flagged for a separate decision — this
migration hardens ONLY the auth cluster, as requested.

Revision ID: ee55ff66aa77
Revises: dd44ee55ff66
Create Date: 2026-07-20
"""
from alembic import op

revision = 'ee55ff66aa77'
down_revision = 'dd44ee55ff66'
branch_labels = None
depends_on = None

TABLES = ["users", "employees", "roles"]

_HARDENED = "tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer"
_ORIGINAL = "tenant_id = current_setting('app.tenant_id', true)::integer"


def upgrade():
    for t in TABLES:
        op.execute(f"""
            ALTER POLICY tenant_isolation ON auth.{t}
            USING ({_HARDENED})
            WITH CHECK ({_HARDENED});
        """)


def downgrade():
    for t in TABLES:
        op.execute(f"""
            ALTER POLICY tenant_isolation ON auth.{t}
            USING ({_ORIGINAL})
            WITH CHECK ({_ORIGINAL});
        """)
