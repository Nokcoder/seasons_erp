"""settings: server-side print template storage (print_templates + assignments)

Moves print templates and function assignments off device-local platformStore into
the database so they're shared across terminals. Two new tables in the settings
schema, both following the established tenant/RLS recipe:

* tenant_id NOT NULL, FK -> platform.tenants, with a GUC server-default.
* ENABLE + FORCE ROW LEVEL SECURITY + a tenant_isolation policy using the HARDENED
  predicate nullif(current_setting('app.tenant_id', true), '')::integer so NULL and
  '' (post-RESET) both mean "no context -> zero rows", never reaching the ::integer
  cast. Per the decision on aa77's spec, the tenant_id column DEFAULT uses the same
  hardened nullif form (not the bare cast) so this table does not add to the
  pile of bare-cast defaults flagged for cleanup.
* (tenant_id) and (tenant_id, doc_type) indexes.

template_id is UUID (gen_random_uuid, built-in on PG13+) so the existing
client-generated UUID ids import 1:1 and function assignments keep resolving.
doc_type / function_key are plain VARCHAR (never enums) so a future document type
(purchase orders, etc.) needs no second migration. Explicit erp_app grants are
added belt-and-suspenders alongside the schema's default privileges.

Revision ID: aa77bb88cc99
Revises: ff66aa77bb88
Create Date: 2026-07-22
"""
from alembic import op

revision = 'aa77bb88cc99'
down_revision = 'ff66aa77bb88'
branch_labels = None
depends_on = None

_HARDENED = "tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer"
_DEFAULT = "nullif(current_setting('app.tenant_id', true), '')::integer"
_TABLES = ("print_templates", "print_function_assignments")


def upgrade():
    op.execute(f"""
        CREATE TABLE settings.print_templates (
            template_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          INTEGER NOT NULL DEFAULT {_DEFAULT}
                                   REFERENCES platform.tenants(tenant_id),
            name               VARCHAR NOT NULL,
            doc_type           VARCHAR NOT NULL,
            template           JSONB NOT NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by_user_id INTEGER REFERENCES auth.users(user_id),
            updated_by_user_id INTEGER REFERENCES auth.users(user_id),
            is_deleted         BOOLEAN NOT NULL DEFAULT false
        );
    """)
    op.execute("CREATE INDEX ix_print_templates_tenant ON settings.print_templates (tenant_id);")
    op.execute("CREATE INDEX ix_print_templates_tenant_doctype ON settings.print_templates (tenant_id, doc_type);")

    op.execute(f"""
        CREATE TABLE settings.print_function_assignments (
            assignment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          INTEGER NOT NULL DEFAULT {_DEFAULT}
                                   REFERENCES platform.tenants(tenant_id),
            function_key       VARCHAR NOT NULL,
            template_id        UUID REFERENCES settings.print_templates(template_id),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by_user_id INTEGER REFERENCES auth.users(user_id),
            CONSTRAINT uq_print_fn_assign_tenant_key UNIQUE (tenant_id, function_key)
        );
    """)
    op.execute("CREATE INDEX ix_print_fn_assign_tenant ON settings.print_function_assignments (tenant_id);")

    # Enable + force RLS with the hardened tenant_isolation policy.
    for t in _TABLES:
        op.execute(f"ALTER TABLE settings.{t} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE settings.{t} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON settings.{t}
            USING ({_HARDENED})
            WITH CHECK ({_HARDENED});
        """)

    # Explicit DML grants to the app role (default privileges should also cover
    # settings, but be explicit so access never depends on owner-match subtleties).
    for t in _TABLES:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON settings.{t} TO erp_app;")


def downgrade():
    op.execute("DROP TABLE IF EXISTS settings.print_function_assignments;")
    op.execute("DROP TABLE IF EXISTS settings.print_templates;")
