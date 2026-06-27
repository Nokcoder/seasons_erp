"""auth: add programs, actions, role_programs, role_actions tables

Revision ID: n4o5p6q7r8s9
Revises: m3h4i5j6k7l8
Create Date: 2026-06-27
"""
from alembic import op

revision = 'n4o5p6q7r8s9'
down_revision = 'm3h4i5j6k7l8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS auth.programs (
            program_id   SERIAL PRIMARY KEY,
            program_key  VARCHAR NOT NULL UNIQUE,
            display_name VARCHAR NOT NULL,
            module       VARCHAR NOT NULL,
            sort_order   INT     NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS auth.actions (
            action_id    SERIAL PRIMARY KEY,
            action_key   VARCHAR NOT NULL UNIQUE,
            display_name VARCHAR NOT NULL,
            program_id   INT     NOT NULL REFERENCES auth.programs(program_id)
        );

        CREATE TABLE IF NOT EXISTS auth.role_programs (
            role_id    INT NOT NULL REFERENCES auth.roles(role_id) ON DELETE CASCADE,
            program_id INT NOT NULL REFERENCES auth.programs(program_id) ON DELETE CASCADE,
            PRIMARY KEY (role_id, program_id)
        );

        CREATE TABLE IF NOT EXISTS auth.role_actions (
            role_id   INT NOT NULL REFERENCES auth.roles(role_id) ON DELETE CASCADE,
            action_id INT NOT NULL REFERENCES auth.actions(action_id) ON DELETE CASCADE,
            PRIMARY KEY (role_id, action_id)
        );
    """)


def downgrade():
    op.execute("""
        DROP TABLE IF EXISTS auth.role_actions;
        DROP TABLE IF EXISTS auth.role_programs;
        DROP TABLE IF EXISTS auth.actions;
        DROP TABLE IF EXISTS auth.programs;
    """)
