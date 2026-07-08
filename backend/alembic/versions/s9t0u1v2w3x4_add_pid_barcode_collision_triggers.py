"""inventory: DB-level cross-namespace PID/barcode collision triggers

Closes the race-condition gap in Fix 3 of docs/pid_editability_fix.md.
App-level validation in inventory/router.py already rejects these
collisions with a clean error message on the normal write paths; these
triggers are the actual guarantee — they catch any write path that
bypasses app validation (raw SQL, other services, future code).

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-07-07
"""
from alembic import op

revision = 's9t0u1v2w3x4'
down_revision = 'r8s9t0u1v2w3'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION inventory.check_variant_pid_no_barcode_collision()
        RETURNS TRIGGER AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM inventory.variant_barcodes vb
                WHERE vb.barcode = NEW."PID"
                  AND vb.variant_id <> NEW.variant_id
            ) THEN
                RAISE EXCEPTION 'PID "%" collides with another variant''s barcode', NEW."PID"
                    USING ERRCODE = 'unique_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS trg_variant_pid_no_barcode_collision ON inventory.variants;
        CREATE TRIGGER trg_variant_pid_no_barcode_collision
        BEFORE INSERT OR UPDATE ON inventory.variants
        FOR EACH ROW EXECUTE FUNCTION inventory.check_variant_pid_no_barcode_collision();
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION inventory.check_barcode_no_pid_collision()
        RETURNS TRIGGER AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM inventory.variants v
                WHERE v."PID" = NEW.barcode
                  AND v.variant_id <> NEW.variant_id
            ) THEN
                RAISE EXCEPTION 'Barcode "%" collides with another variant''s PID', NEW.barcode
                    USING ERRCODE = 'unique_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS trg_barcode_no_pid_collision ON inventory.variant_barcodes;
        CREATE TRIGGER trg_barcode_no_pid_collision
        BEFORE INSERT OR UPDATE ON inventory.variant_barcodes
        FOR EACH ROW EXECUTE FUNCTION inventory.check_barcode_no_pid_collision();
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS trg_barcode_no_pid_collision ON inventory.variant_barcodes;")
    op.execute("DROP FUNCTION IF EXISTS inventory.check_barcode_no_pid_collision();")
    op.execute("DROP TRIGGER IF EXISTS trg_variant_pid_no_barcode_collision ON inventory.variants;")
    op.execute("DROP FUNCTION IF EXISTS inventory.check_variant_pid_no_barcode_collision();")
