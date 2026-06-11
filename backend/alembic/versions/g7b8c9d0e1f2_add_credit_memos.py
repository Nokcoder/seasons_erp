"""sales: add credit_memos, credit_memo_redemptions, is_credit_memo flag

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-12
"""
from alembic import op

revision = 'g7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sales.payment_modes
            ADD COLUMN IF NOT EXISTS is_credit_memo
            BOOLEAN NOT NULL DEFAULT FALSE;

        CREATE TABLE IF NOT EXISTS sales.credit_memos (
            memo_id              SERIAL PRIMARY KEY,
            code                 VARCHAR(20) UNIQUE NOT NULL,
            amount               NUMERIC(15,2) NOT NULL,
            status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            issued_at            DATE NOT NULL,
            valid_until          DATE NOT NULL,
            issued_by_user_id    INTEGER REFERENCES auth.users(user_id),
            return_id            INTEGER REFERENCES sales.sales_returns(return_id),
            notes                VARCHAR(500),
            cancelled_by_user_id INTEGER REFERENCES auth.users(user_id),
            cancelled_at         TIMESTAMP WITH TIME ZONE
        );

        CREATE TABLE IF NOT EXISTS sales.credit_memo_redemptions (
            redemption_id         SERIAL PRIMARY KEY,
            memo_id               INTEGER NOT NULL
                                  REFERENCES sales.credit_memos(memo_id),
            sale_id               INTEGER NOT NULL
                                  REFERENCES sales.sales(sale_id),
            amount_redeemed       NUMERIC(15,2) NOT NULL,
            redeemed_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            redeemed_by_user_id   INTEGER NOT NULL
                                  REFERENCES auth.users(user_id)
        );

        INSERT INTO sales.payment_modes
            (name, is_active, is_credit_memo, is_physical, is_ar_charge, is_ar_credit)
        SELECT 'Credit Memo', true, true, false, false, false
        WHERE NOT EXISTS (
            SELECT 1 FROM sales.payment_modes WHERE is_credit_memo = true
        );
    """)


def downgrade():
    op.execute("""
        DROP TABLE IF EXISTS sales.credit_memo_redemptions;
        DROP TABLE IF EXISTS sales.credit_memos;
        ALTER TABLE sales.payment_modes
            DROP COLUMN IF EXISTS is_credit_memo;
    """)
