"""platform: add tenants table (multi-tenancy foundation, phase 1)

Introduces the `platform` schema and `platform.tenants` table — the root
entity every tenant-scoped table will eventually FK to. This migration only
adds the schema and table; it does not touch auth.employees/users/roles or
any other existing table (that's a separate, later migration in this same
session).

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-07-13
"""
from alembic import op

revision = 'x4y5z6a7b8c9'
down_revision = 'w3x4y5z6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE SCHEMA IF NOT EXISTS platform;")
    op.execute("""
        CREATE TABLE platform.tenants (
            tenant_id  SERIAL PRIMARY KEY,
            name       VARCHAR NOT NULL,
            slug       VARCHAR NOT NULL UNIQUE,
            is_active  BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS platform.tenants;")
    op.execute("DROP SCHEMA IF EXISTS platform CASCADE;")
