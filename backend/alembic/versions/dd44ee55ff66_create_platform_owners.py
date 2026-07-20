"""platform: platform_owners table — identity that sits ABOVE tenants (Track A)

Design decision (multitenancy-roadmap.md, auth subset item 3): a platform owner
is modelled as a SEPARATE identity, not a flag on auth.users. auth.users is
tenant-scoped by design (tenant_id NOT NULL, now RLS'd); a platform owner belongs
to NO tenant and must be able to act across all of them. Rather than punch a
cross-tenant hole in the tenant user model, platform owners live in their own
table in the platform schema with their own (future) login path.

This migration is the SCHEMA half only — the table and its ORM model
(tenancy.models.PlatformOwner). The behaviour that uses it — a platform-owner
login endpoint and the admin capability to list/deactivate tenants and handle
failed payments — is Track B (blocked on Track A) and is deliberately NOT built
here. Per the roadmap's governing principle, the table shape is created now,
while schema changes are still free (no real tenant data yet).

Columns:
  owner_id       serial PK        (serial int, consistent with every other PK in
                                   the system; platform_owners is brand-new
                                   platform data with no legacy-migration concern,
                                   so the serial-vs-UUID question that affects the
                                   ERP tables does not bind here)
  email          unique, not null (global identity — NOT tenant-scoped)
  password_hash  not null
  full_name      nullable
  is_active      not null default true
  last_login_at  nullable
  created_at     not null default now()

No tenant_id column and NO RLS: this table is above the tenant boundary. Access
runs deliberately on the erp_admin (BYPASSRLS) connection, never the tenant
request path. As defence-in-depth we REVOKE all privileges on it from erp_app so
the tenant app connection can never read platform-owner password hashes even if a
future bug tried to — the a7b8c9d0e1f2 default-privileges grant would otherwise
auto-grant DML on every new platform table to erp_app.

Revision ID: dd44ee55ff66
Revises: cc33dd44ee55
Create Date: 2026-07-19
"""
import os
from alembic import op

revision = 'dd44ee55ff66'
down_revision = 'cc33dd44ee55'
branch_labels = None
depends_on = None

APP_ROLE = "erp_app"


def upgrade():
    op.execute("""
        CREATE TABLE platform.platform_owners (
            owner_id      SERIAL PRIMARY KEY,
            email         VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            full_name     VARCHAR(255),
            is_active     BOOLEAN NOT NULL DEFAULT true,
            last_login_at TIMESTAMPTZ,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    # Defence-in-depth: keep the tenant app role away from platform-owner
    # credentials entirely. The ALTER DEFAULT PRIVILEGES from a7b8c9d0e1f2 will
    # have auto-granted DML + sequence access to erp_app on creation; revoke both.
    op.execute(f"REVOKE ALL PRIVILEGES ON platform.platform_owners FROM {APP_ROLE};")
    op.execute(f"REVOKE ALL PRIVILEGES ON SEQUENCE platform.platform_owners_owner_id_seq FROM {APP_ROLE};")


def downgrade():
    op.execute("DROP TABLE IF EXISTS platform.platform_owners;")
