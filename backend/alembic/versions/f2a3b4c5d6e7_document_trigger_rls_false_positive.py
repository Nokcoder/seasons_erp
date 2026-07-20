"""platform: document the erp_admin RLS false-positive on the PID/barcode triggers

The two collision triggers (check_variant_pid_no_barcode_collision,
check_barcode_no_pid_collision) are SECURITY INVOKER, so their global EXISTS
scans inherit the caller's RLS. Under erp_app they auto-scope to one tenant
(per-tenant PID/barcode uniqueness — the desired behaviour). But erp_admin is a
SUPERUSER and bypasses RLS, so any admin-side write to inventory.variants /
inventory.variant_barcodes makes the EXISTS scan ALL tenants and can
FALSE-POSITIVE — rejecting a legitimate per-tenant PID that merely matches
another tenant's barcode.

Not hit today (no admin/seed/migration path writes variants or barcodes; imports
run on the erp_app request path), but it's a long-fuse landmine. This migration
attaches the warning to the function objects themselves via COMMENT ON FUNCTION,
so it surfaces in \\df+ / pg_description for anyone inspecting them. There's a
matching note in CLAUDE.md.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-14
"""
from alembic import op

revision = 'f2a3b4c5d6e7'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None

_WARNING = (
    'RLS/tenant landmine: SECURITY INVOKER, so its EXISTS scan is RLS-scoped. '
    'Under erp_app it enforces PER-TENANT PID/barcode uniqueness. Under erp_admin '
    '(superuser bypasses RLS) it scans ALL tenants and can FALSE-POSITIVE, '
    'rejecting a valid per-tenant PID. Any admin/bulk inventory write path MUST '
    'run as erp_app or SET app.tenant_id first. See CLAUDE.md.'
)


def upgrade():
    for fn in ("check_variant_pid_no_barcode_collision", "check_barcode_no_pid_collision"):
        op.execute(f"COMMENT ON FUNCTION inventory.{fn}() IS '{_WARNING}';")


def downgrade():
    for fn in ("check_variant_pid_no_barcode_collision", "check_barcode_no_pid_collision"):
        op.execute(f"COMMENT ON FUNCTION inventory.{fn}() IS NULL;")
