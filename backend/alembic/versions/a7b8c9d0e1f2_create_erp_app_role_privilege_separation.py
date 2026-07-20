"""platform: create erp_app role (privilege separation, Phase 2 step 1)

Introduces a non-superuser, NOBYPASSRLS login role `erp_app` that the FastAPI
request path connects as. No RLS policies exist yet and no tenant_id columns are
added here — with no policies in play, erp_app still sees ALL data. The only
change is that the app is no longer a superuser, so that any breakage in this
step is unambiguously a grants/plumbing problem rather than RLS logic (which
comes later).

erp_admin remains superuser, owner of every object, and the migrator: Alembic
continues to connect as erp_admin (core.database.DATABASE_URL), and the boot
seeds + signup path run through a dedicated erp_admin engine. Only the normal
request path (get_db) uses erp_app.

The erp_app password is taken from the APP_DB_PASSWORD env var so it is not
committed to source. DB_USER is the owner/migrator role name (erp_admin).

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-07-13
"""
import os
from alembic import op

revision = 'a7b8c9d0e1f2'
down_revision = 'z6a7b8c9d0e1'
branch_labels = None
depends_on = None

APP_ROLE = "erp_app"
# Every schema the app touches. (auth, platform, inventory, procurement, ap,
# sales, settings) + public. USAGE on the schema, DML on its tables, and
# USAGE/SELECT on its sequences (the latter is required for serial-PK inserts).
SCHEMAS = ["auth", "platform", "inventory", "procurement", "ap", "sales", "settings", "public"]


def upgrade():
    pw = os.getenv("APP_DB_PASSWORD")
    if not pw:
        raise RuntimeError(
            "APP_DB_PASSWORD env var is required to create the erp_app role. "
            "Set it in .env before running this migration."
        )
    db_name = os.getenv("DB_NAME")
    if not db_name:
        raise RuntimeError("DB_NAME env var is required.")
    owner = os.getenv("DB_USER", "erp_admin")  # object owner / migrator role
    pw_lit = pw.replace("'", "''")             # escape for the SQL string literal

    # 1. Create the role if absent, then (re)assert its attributes + password
    #    idempotently so the migration is reproducible on a fresh database.
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} LOGIN;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        ALTER ROLE {APP_ROLE}
            LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
            PASSWORD '{pw_lit}';
    """)

    # 2. Connect privilege on the database.
    op.execute(f'GRANT CONNECT ON DATABASE "{db_name}" TO {APP_ROLE};')

    # 3. Per-schema: USAGE + DML on existing tables + sequence access, and
    #    ALTER DEFAULT PRIVILEGES so tables/sequences created by the owner in
    #    FUTURE migrations are auto-granted (otherwise every new table silently
    #    breaks the app until someone remembers to grant it).
    for s in SCHEMAS:
        op.execute(f'GRANT USAGE ON SCHEMA {s} TO {APP_ROLE};')
        op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {s} TO {APP_ROLE};')
        op.execute(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {s} TO {APP_ROLE};')
        op.execute(
            f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {s} '
            f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};'
        )
        op.execute(
            f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {s} '
            f'GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE};'
        )


def downgrade():
    owner = os.getenv("DB_USER", "erp_admin")
    for s in SCHEMAS:
        op.execute(
            f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {s} '
            f'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {APP_ROLE};'
        )
        op.execute(
            f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {s} '
            f'REVOKE USAGE, SELECT ON SEQUENCES FROM {APP_ROLE};'
        )
    # DROP OWNED revokes all privileges granted TO erp_app across the DB; the
    # role owns no objects (only grants), so it can then be dropped.
    op.execute(f'DROP OWNED BY {APP_ROLE};')
    op.execute(f'DROP ROLE IF EXISTS {APP_ROLE};')
