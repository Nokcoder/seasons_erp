"""initial schema — consolidated from current SQLAlchemy models

Replaces the prior 21-migration history. Development reset: all existing
data is test data and is not preserved. This migration builds the full
schema from scratch as a single base revision, with `transaction_date`
(user-controlled, backdatable transaction-occurrence date) and `posted_at`
(stamped at posting time) already in place on sales.sales — no rename step.

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-06-07
"""
from alembic import op

revision = 'a1b2c3d4e5f6'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE SCHEMA IF NOT EXISTS inventory;
        CREATE SCHEMA IF NOT EXISTS procurement;
        CREATE SCHEMA IF NOT EXISTS ap;
        CREATE SCHEMA IF NOT EXISTS sales;
        CREATE SCHEMA IF NOT EXISTS settings;
    """)

    op.execute("""
        CREATE TYPE inventory.location_type AS ENUM ('Warehouse', 'Store', 'Bin', 'Virtual');
        CREATE TYPE inventory.location_status AS ENUM ('Active', 'Inactive');
        CREATE TYPE ap.ap_reason AS ENUM ('INVOICE', 'PAYMENT', 'CREDIT_MEMO', 'ADJUSTMENT');
        CREATE TYPE inventory.product_type AS ENUM ('Inventory', 'Non-Inventory', 'Service');
        CREATE TYPE inventory.product_status AS ENUM ('Active', 'Inactive');
        CREATE TYPE sales.ar_reason AS ENUM ('SALE', 'PAYMENT', 'RETURN', 'ADJUSTMENT', 'AR_CHARGE', 'AR_CREDIT');
        CREATE TYPE auth.audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT');
        CREATE TYPE procurement.po_status AS ENUM ('Draft', 'Open', 'Partially_Received', 'Closed', 'Cancelled');
        CREATE TYPE sales.sale_payment_status AS ENUM ('Unpaid', 'Partial', 'Paid');
        CREATE TYPE sales.sale_status AS ENUM ('Draft', 'Posted', 'Voided');
        CREATE TYPE sales.supplier_return_status AS ENUM ('Draft', 'Shipped', 'Credit_Received');
        CREATE TYPE inventory.ledger_reason AS ENUM ('RECEIVE', 'SALE', 'RETURN_IN', 'RETURN_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUST');
        CREATE TYPE ap.invoice_status AS ENUM ('Unpaid', 'Partial', 'Paid');
        CREATE TYPE procurement.qc_status AS ENUM ('Pending', 'Passed', 'Failed', 'Partially_Passed');
    """)

    op.execute("""
        CREATE TABLE auth.employees (
            employee_id SERIAL NOT NULL,
            first_name VARCHAR NOT NULL,
            last_name VARCHAR NOT NULL,
            is_active BOOLEAN NOT NULL,
            PRIMARY KEY (employee_id)
        );

        CREATE TABLE auth.roles (
            role_id SERIAL NOT NULL,
            role_name VARCHAR NOT NULL,
            PRIMARY KEY (role_id),
            UNIQUE (role_name)
        );

        CREATE TABLE inventory.locations (
            location_id SERIAL NOT NULL,
            location_name VARCHAR(255) NOT NULL,
            location_type inventory.location_type NOT NULL,
            parent_location_id INTEGER,
            address TEXT,
            status inventory.location_status,
            is_system BOOLEAN NOT NULL,
            is_deleted BOOLEAN,
            PRIMARY KEY (location_id),
            UNIQUE (location_name),
            FOREIGN KEY(parent_location_id) REFERENCES inventory.locations (location_id)
        );

        CREATE TABLE inventory.product_categories (
            category_id SERIAL NOT NULL,
            category_name VARCHAR(255) NOT NULL,
            parent_category_id INTEGER,
            is_deleted BOOLEAN,
            PRIMARY KEY (category_id),
            UNIQUE (category_name),
            FOREIGN KEY(parent_category_id) REFERENCES inventory.product_categories (category_id)
        );

        CREATE TABLE inventory.suppliers (
            supplier_id SERIAL NOT NULL,
            supplier_code VARCHAR(100) NOT NULL,
            supplier_name VARCHAR(255) NOT NULL,
            bank_account_name VARCHAR(255),
            terms INTEGER,
            is_deleted BOOLEAN,
            contact_person VARCHAR(255),
            phone VARCHAR(50),
            email VARCHAR(255),
            address TEXT,
            contact_notes TEXT,
            registered_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (supplier_id),
            UNIQUE (supplier_code)
        );

        CREATE TABLE inventory.uoms (
            uom_id SERIAL NOT NULL,
            uom_code VARCHAR(50) NOT NULL,
            uom_name VARCHAR(255),
            is_deleted BOOLEAN,
            PRIMARY KEY (uom_id),
            UNIQUE (uom_code)
        );

        CREATE TABLE sales.customers (
            customer_id SERIAL NOT NULL,
            customer_name VARCHAR(255) NOT NULL,
            credit_limit NUMERIC(15, 2),
            terms_days INTEGER NOT NULL,
            outstanding_balance NUMERIC(15, 2) NOT NULL,
            is_deleted BOOLEAN NOT NULL,
            PRIMARY KEY (customer_id)
        );

        CREATE TABLE sales.payment_modes (
            payment_mode_id SERIAL NOT NULL,
            name VARCHAR(100) NOT NULL,
            is_physical BOOLEAN NOT NULL,
            is_active BOOLEAN NOT NULL,
            is_ar_charge BOOLEAN NOT NULL,
            is_ar_credit BOOLEAN NOT NULL,
            PRIMARY KEY (payment_mode_id)
        );

        CREATE TABLE sales.shifts (
            shift_id SERIAL NOT NULL,
            shift_name VARCHAR(100) NOT NULL,
            is_active BOOLEAN NOT NULL,
            PRIMARY KEY (shift_id)
        );

        CREATE TABLE ap.ap_ledger (
            ap_ledger_id BIGSERIAL NOT NULL,
            supplier_id INTEGER,
            amount_change NUMERIC(15, 2) NOT NULL,
            reason ap.ap_reason NOT NULL,
            reference_type VARCHAR(100),
            reference_id VARCHAR(100),
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (ap_ledger_id),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id)
        );

        CREATE TABLE ap.supplier_payments (
            payment_id SERIAL NOT NULL,
            supplier_id INTEGER,
            amount NUMERIC(15, 2) NOT NULL,
            payment_date TIMESTAMP WITH TIME ZONE,
            reference_number VARCHAR(100),
            payment_method VARCHAR(100),
            PRIMARY KEY (payment_id),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id)
        );

        CREATE TABLE auth.users (
            user_id SERIAL NOT NULL,
            employee_id INTEGER NOT NULL,
            username VARCHAR(100) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            is_active BOOLEAN,
            last_login_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (user_id),
            FOREIGN KEY(employee_id) REFERENCES auth.employees (employee_id),
            UNIQUE (username)
        );

        CREATE TABLE inventory.products (
            product_id SERIAL NOT NULL,
            brand VARCHAR(255) NOT NULL,
            product_type inventory.product_type NOT NULL,
            description TEXT,
            base_uom_id INTEGER,
            status inventory.product_status,
            is_deleted BOOLEAN,
            PRIMARY KEY (product_id),
            FOREIGN KEY(base_uom_id) REFERENCES inventory.uoms (uom_id)
        );
        CREATE INDEX ix_inventory_products_product_id ON inventory.products (product_id);

        CREATE TABLE sales.ar_ledger (
            ar_ledger_id BIGSERIAL NOT NULL,
            customer_id INTEGER,
            amount_change NUMERIC(15, 2) NOT NULL,
            reason sales.ar_reason NOT NULL,
            reference_type VARCHAR(100),
            reference_id VARCHAR(100),
            notes VARCHAR(500),
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (ar_ledger_id),
            FOREIGN KEY(customer_id) REFERENCES sales.customers (customer_id)
        );

        CREATE TABLE sales.cash_registers (
            register_id SERIAL NOT NULL,
            name VARCHAR(100) NOT NULL,
            location_id INTEGER NOT NULL,
            is_active BOOLEAN NOT NULL,
            PRIMARY KEY (register_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id)
        );

        CREATE TABLE sales.customer_payments (
            payment_id SERIAL NOT NULL,
            customer_id INTEGER,
            payment_mode_id INTEGER NOT NULL,
            amount NUMERIC(15, 2) NOT NULL,
            payment_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
            reference_number VARCHAR(100),
            notes VARCHAR(500),
            unapplied_amount NUMERIC(15, 2) NOT NULL,
            PRIMARY KEY (payment_id),
            FOREIGN KEY(customer_id) REFERENCES sales.customers (customer_id),
            FOREIGN KEY(payment_mode_id) REFERENCES sales.payment_modes (payment_mode_id)
        );

        CREATE TABLE auth.audit_log (
            audit_id BIGSERIAL NOT NULL,
            table_name VARCHAR NOT NULL,
            record_pk VARCHAR NOT NULL,
            action auth.audit_action NOT NULL,
            actor_user_id INTEGER,
            actor_employee_id INTEGER,
            old_values JSONB,
            new_values JSONB,
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (audit_id),
            FOREIGN KEY(actor_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(actor_employee_id) REFERENCES auth.employees (employee_id)
        );

        CREATE TABLE auth.login_attempts (
            attempt_id BIGSERIAL NOT NULL,
            user_id INTEGER,
            username VARCHAR NOT NULL,
            success BOOLEAN NOT NULL,
            ip_address VARCHAR,
            user_agent VARCHAR,
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (attempt_id),
            FOREIGN KEY(user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE auth.user_roles (
            user_id INTEGER NOT NULL,
            role_id INTEGER NOT NULL,
            PRIMARY KEY (user_id, role_id),
            FOREIGN KEY(user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(role_id) REFERENCES auth.roles (role_id)
        );

        CREATE TABLE inventory.inventory_transfers (
            transfer_id SERIAL NOT NULL,
            transfer_pid VARCHAR(100),
            from_location_id INTEGER,
            to_location_id INTEGER,
            released_by_user_id INTEGER,
            received_by_user_id INTEGER,
            requested_by_user_id INTEGER,
            released_by_employee_id INTEGER,
            received_by_employee_id INTEGER,
            total_bundle_count INTEGER,
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            status VARCHAR(20) NOT NULL,
            voided_at TIMESTAMP WITH TIME ZONE,
            void_reason VARCHAR(500),
            PRIMARY KEY (transfer_id),
            UNIQUE (transfer_pid),
            FOREIGN KEY(from_location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(to_location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(released_by_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(received_by_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(requested_by_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(released_by_employee_id) REFERENCES auth.employees (employee_id),
            FOREIGN KEY(received_by_employee_id) REFERENCES auth.employees (employee_id)
        );

        CREATE TABLE inventory.product_category_links (
            product_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            PRIMARY KEY (product_id, category_id),
            FOREIGN KEY(product_id) REFERENCES inventory.products (product_id) ON DELETE CASCADE,
            FOREIGN KEY(category_id) REFERENCES inventory.product_categories (category_id) ON DELETE CASCADE
        );

        CREATE TABLE inventory.variants (
            variant_id SERIAL NOT NULL,
            product_id INTEGER NOT NULL,
            "PID" VARCHAR(50) NOT NULL,
            variant_name VARCHAR(100) NOT NULL,
            sku VARCHAR(100),
            is_default BOOLEAN NOT NULL,
            attributes JSONB,
            price NUMERIC(15, 2),
            promo_price NUMERIC(15, 2),
            is_deleted BOOLEAN,
            PRIMARY KEY (variant_id),
            FOREIGN KEY(product_id) REFERENCES inventory.products (product_id) ON DELETE CASCADE,
            UNIQUE ("PID")
        );
        CREATE INDEX ix_inventory_variants_variant_id ON inventory.variants (variant_id);
        CREATE INDEX ix_inventory_variants_sku ON inventory.variants (sku);

        CREATE TABLE procurement.purchase_orders (
            po_id SERIAL NOT NULL,
            po_pid VARCHAR(100) NOT NULL,
            supplier_id INTEGER,
            location_id INTEGER,
            order_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
            expected_arrival_date DATE,
            status procurement.po_status,
            total_amount NUMERIC(15, 2),
            created_by_user_id INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (po_id),
            UNIQUE (po_pid),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(created_by_user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE sales.sales (
            sale_id SERIAL NOT NULL,
            sale_pid VARCHAR(100),
            transaction_date DATE DEFAULT CURRENT_DATE NOT NULL,
            posted_at TIMESTAMP WITH TIME ZONE,
            location_id INTEGER NOT NULL,
            register_id INTEGER,
            customer_id INTEGER,
            employee_id INTEGER,
            created_by_user_id INTEGER,
            shift_id INTEGER,
            origin_sale_id INTEGER,
            subtotal_amount NUMERIC(15, 2),
            cart_discount_pct NUMERIC(5, 2),
            cart_discount_flat NUMERIC(15, 2),
            discount_amount NUMERIC(15, 2),
            tax_amount NUMERIC(15, 2),
            grand_total NUMERIC(15, 2),
            receipt_grand_total NUMERIC(15, 2),
            audit_variance NUMERIC(15, 2),
            due_date DATE,
            payment_status sales.sale_payment_status,
            balance_due NUMERIC(15, 2),
            status sales.sale_status,
            voided_at TIMESTAMP WITH TIME ZONE,
            void_reason VARCHAR(500),
            idempotency_key VARCHAR(255),
            PRIMARY KEY (sale_id),
            UNIQUE (sale_pid),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(register_id) REFERENCES sales.cash_registers (register_id),
            FOREIGN KEY(customer_id) REFERENCES sales.customers (customer_id),
            FOREIGN KEY(employee_id) REFERENCES auth.employees (employee_id),
            FOREIGN KEY(created_by_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(shift_id) REFERENCES sales.shifts (shift_id),
            FOREIGN KEY(origin_sale_id) REFERENCES sales.sales (sale_id),
            UNIQUE (idempotency_key)
        );

        CREATE TABLE sales.supplier_returns (
            return_id SERIAL NOT NULL,
            return_pid VARCHAR(100),
            supplier_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            status sales.supplier_return_status,
            total_credit_amount NUMERIC(15, 2),
            created_by_user_id INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (return_id),
            UNIQUE (return_pid),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(created_by_user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE settings.system_settings (
            key VARCHAR NOT NULL,
            value VARCHAR NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE,
            updated_by_user_id INTEGER,
            PRIMARY KEY (key),
            FOREIGN KEY(updated_by_user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE inventory.bundle_components (
            bundle_variant_id INTEGER NOT NULL,
            component_variant_id INTEGER NOT NULL,
            quantity NUMERIC(15, 4) NOT NULL,
            PRIMARY KEY (bundle_variant_id, component_variant_id),
            FOREIGN KEY(bundle_variant_id) REFERENCES inventory.variants (variant_id) ON DELETE CASCADE,
            FOREIGN KEY(component_variant_id) REFERENCES inventory.variants (variant_id)
        );

        CREATE TABLE inventory.current_stocks (
            stock_id BIGSERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            quantity NUMERIC(15, 4),
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (stock_id),
            CONSTRAINT uq_current_stocks_variant_location UNIQUE (variant_id, location_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id)
        );

        CREATE TABLE inventory.inventory_ledger (
            ledger_id BIGSERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            qty_change NUMERIC(15, 4) NOT NULL,
            reason inventory.ledger_reason NOT NULL,
            reference_type VARCHAR(100),
            reference_id VARCHAR(100),
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (ledger_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id)
        );

        CREATE TABLE inventory.inventory_transfer_items (
            transfer_item_id SERIAL NOT NULL,
            transfer_id INTEGER,
            variant_id INTEGER NOT NULL,
            quantity_requested NUMERIC(15, 4) NOT NULL,
            quantity_released NUMERIC(15, 4),
            quantity_received NUMERIC(15, 4),
            PRIMARY KEY (transfer_item_id),
            FOREIGN KEY(transfer_id) REFERENCES inventory.inventory_transfers (transfer_id) ON DELETE CASCADE,
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id)
        );

        CREATE TABLE inventory.variant_barcodes (
            barcode_id BIGSERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            barcode VARCHAR(100) NOT NULL,
            uom_id INTEGER,
            is_primary BOOLEAN,
            PRIMARY KEY (barcode_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id) ON DELETE CASCADE,
            UNIQUE (barcode),
            FOREIGN KEY(uom_id) REFERENCES inventory.uoms (uom_id)
        );

        CREATE TABLE inventory.variant_cost_history (
            history_id BIGSERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            old_gross_cost NUMERIC(15, 2),
            new_gross_cost NUMERIC(15, 2),
            old_supplier_discount NUMERIC(5, 2),
            new_supplier_discount NUMERIC(5, 2),
            changed_by_user_id INTEGER,
            changed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (history_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id),
            FOREIGN KEY(changed_by_user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE inventory.variant_price_history (
            history_id BIGSERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            old_price NUMERIC(15, 2),
            new_price NUMERIC(15, 2),
            old_promo_price NUMERIC(15, 2),
            new_promo_price NUMERIC(15, 2),
            changed_by_user_id INTEGER,
            changed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (history_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(changed_by_user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE inventory.variant_suppliers (
            id SERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            supplier_sku VARCHAR(100),
            gross_cost NUMERIC(15, 2),
            supplier_discount NUMERIC(5, 2),
            is_primary BOOLEAN,
            PRIMARY KEY (id),
            CONSTRAINT uq_variant_suppliers UNIQUE (variant_id, supplier_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id) ON DELETE CASCADE,
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id) ON DELETE CASCADE
        );

        CREATE TABLE inventory.variant_uom_conversions (
            variant_id INTEGER NOT NULL,
            from_uom_id INTEGER NOT NULL,
            to_uom_id INTEGER NOT NULL,
            factor NUMERIC(15, 4) NOT NULL,
            is_warehouse_bundle BOOLEAN NOT NULL,
            price NUMERIC(15, 2),
            promo_price NUMERIC(15, 2),
            PRIMARY KEY (variant_id, from_uom_id, to_uom_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id) ON DELETE CASCADE,
            FOREIGN KEY(from_uom_id) REFERENCES inventory.uoms (uom_id),
            FOREIGN KEY(to_uom_id) REFERENCES inventory.uoms (uom_id)
        );

        CREATE TABLE procurement.inventory_shipments (
            shipment_id SERIAL NOT NULL,
            shipment_pid VARCHAR(100),
            supplier_id INTEGER,
            po_id INTEGER,
            reference_number VARCHAR(100),
            received_at TIMESTAMP WITH TIME ZONE,
            received_by_user_id INTEGER,
            inspected_by_user_id INTEGER,
            received_by_employee_id INTEGER,
            inspected_by_employee_id INTEGER,
            is_confirmed BOOLEAN NOT NULL,
            PRIMARY KEY (shipment_id),
            UNIQUE (shipment_pid),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id),
            FOREIGN KEY(po_id) REFERENCES procurement.purchase_orders (po_id),
            FOREIGN KEY(received_by_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(inspected_by_user_id) REFERENCES auth.users (user_id),
            FOREIGN KEY(received_by_employee_id) REFERENCES auth.employees (employee_id),
            FOREIGN KEY(inspected_by_employee_id) REFERENCES auth.employees (employee_id)
        );

        CREATE TABLE procurement.purchase_order_items (
            po_item_id SERIAL NOT NULL,
            po_id INTEGER,
            variant_id INTEGER,
            ordered_quantity NUMERIC(15, 4) NOT NULL,
            received_quantity NUMERIC(15, 4),
            unit_cost NUMERIC(15, 2) NOT NULL,
            PRIMARY KEY (po_item_id),
            FOREIGN KEY(po_id) REFERENCES procurement.purchase_orders (po_id) ON DELETE CASCADE,
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id)
        );

        CREATE TABLE sales.customer_payment_applied (
            apply_id SERIAL NOT NULL,
            payment_id INTEGER NOT NULL,
            sale_id INTEGER NOT NULL,
            amount_applied NUMERIC(15, 2) NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (apply_id),
            FOREIGN KEY(payment_id) REFERENCES sales.customer_payments (payment_id),
            FOREIGN KEY(sale_id) REFERENCES sales.sales (sale_id)
        );

        CREATE TABLE sales.sales_returns (
            return_id SERIAL NOT NULL,
            return_pid VARCHAR(100),
            sale_id INTEGER,
            location_id INTEGER NOT NULL,
            return_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
            reason VARCHAR(500),
            grand_total NUMERIC(15, 2),
            disposition VARCHAR(20),
            customer_id INTEGER,
            created_by_user_id INTEGER,
            PRIMARY KEY (return_id),
            UNIQUE (return_pid),
            FOREIGN KEY(sale_id) REFERENCES sales.sales (sale_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(customer_id) REFERENCES sales.customers (customer_id),
            FOREIGN KEY(created_by_user_id) REFERENCES auth.users (user_id)
        );

        CREATE TABLE ap.supplier_invoices (
            invoice_id SERIAL NOT NULL,
            supplier_id INTEGER,
            shipment_id INTEGER,
            invoice_number VARCHAR(100),
            invoice_date DATE,
            due_date DATE,
            total_amount NUMERIC(15, 2),
            amended_amount NUMERIC(15, 2),
            amendment_notes TEXT,
            status ap.invoice_status,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (invoice_id),
            FOREIGN KEY(supplier_id) REFERENCES inventory.suppliers (supplier_id),
            FOREIGN KEY(shipment_id) REFERENCES procurement.inventory_shipments (shipment_id)
        );

        CREATE TABLE inventory.cost_layers (
            layer_id BIGSERIAL NOT NULL,
            variant_id INTEGER NOT NULL,
            shipment_id INTEGER,
            location_id INTEGER NOT NULL,
            original_quantity NUMERIC(15, 4) NOT NULL,
            quantity_remaining NUMERIC(15, 4) NOT NULL,
            gross_cost NUMERIC(15, 2) NOT NULL,
            supplier_discount NUMERIC(5, 2),
            net_unit_cost NUMERIC(15, 2) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (layer_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id) ON DELETE CASCADE,
            FOREIGN KEY(shipment_id) REFERENCES procurement.inventory_shipments (shipment_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id)
        );

        CREATE TABLE procurement.receiving_details (
            detail_id SERIAL NOT NULL,
            shipment_id INTEGER,
            variant_id INTEGER,
            location_id INTEGER,
            po_item_id INTEGER,
            received_at TIMESTAMP WITH TIME ZONE,
            inspected_at TIMESTAMP WITH TIME ZONE,
            quantity_ordered NUMERIC(15, 4),
            quantity_declared NUMERIC(15, 4),
            quantity_actual NUMERIC(15, 4) NOT NULL,
            quantity_rejected NUMERIC(15, 4),
            qc_status procurement.qc_status,
            is_deleted BOOLEAN,
            PRIMARY KEY (detail_id),
            FOREIGN KEY(shipment_id) REFERENCES procurement.inventory_shipments (shipment_id) ON DELETE CASCADE,
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(location_id) REFERENCES inventory.locations (location_id),
            FOREIGN KEY(po_item_id) REFERENCES procurement.purchase_order_items (po_item_id)
        );

        CREATE TABLE ap.invoice_payments (
            invoice_id INTEGER NOT NULL,
            payment_id INTEGER NOT NULL,
            amount_applied NUMERIC(15, 2) NOT NULL,
            PRIMARY KEY (invoice_id, payment_id),
            FOREIGN KEY(invoice_id) REFERENCES ap.supplier_invoices (invoice_id),
            FOREIGN KEY(payment_id) REFERENCES ap.supplier_payments (payment_id)
        );

        CREATE TABLE sales.sale_items (
            sale_item_id SERIAL NOT NULL,
            sale_id INTEGER NOT NULL,
            variant_id INTEGER NOT NULL,
            cost_layer_id BIGINT,
            quantity NUMERIC(15, 4) NOT NULL,
            unit_price NUMERIC(15, 2) NOT NULL,
            discount_pct NUMERIC(5, 2),
            discount_flat NUMERIC(15, 2),
            line_total NUMERIC(15, 2) NOT NULL,
            gross_cost NUMERIC(15, 2),
            supplier_discount NUMERIC(5, 2),
            net_unit_cost NUMERIC(15, 2),
            cost_source VARCHAR(20),
            PRIMARY KEY (sale_item_id),
            CONSTRAINT uq_sale_items_sale_variant_layer UNIQUE (sale_id, variant_id, cost_layer_id),
            FOREIGN KEY(sale_id) REFERENCES sales.sales (sale_id) ON DELETE CASCADE,
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(cost_layer_id) REFERENCES inventory.cost_layers (layer_id)
        );

        CREATE TABLE sales.supplier_return_items (
            return_item_id SERIAL NOT NULL,
            return_id INTEGER NOT NULL,
            variant_id INTEGER NOT NULL,
            cost_layer_id BIGINT,
            quantity NUMERIC(15, 4) NOT NULL,
            unit_credit_expected NUMERIC(15, 2),
            PRIMARY KEY (return_item_id),
            FOREIGN KEY(return_id) REFERENCES sales.supplier_returns (return_id) ON DELETE CASCADE,
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(cost_layer_id) REFERENCES inventory.cost_layers (layer_id)
        );

        CREATE TABLE sales.sales_return_items (
            return_item_id SERIAL NOT NULL,
            return_id INTEGER NOT NULL,
            sale_item_id INTEGER,
            variant_id INTEGER NOT NULL,
            cost_layer_id BIGINT,
            quantity NUMERIC(15, 4) NOT NULL,
            line_total NUMERIC(15, 2) NOT NULL,
            PRIMARY KEY (return_item_id),
            FOREIGN KEY(return_id) REFERENCES sales.sales_returns (return_id) ON DELETE CASCADE,
            FOREIGN KEY(sale_item_id) REFERENCES sales.sale_items (sale_item_id),
            FOREIGN KEY(variant_id) REFERENCES inventory.variants (variant_id),
            FOREIGN KEY(cost_layer_id) REFERENCES inventory.cost_layers (layer_id)
        );
    """)


def downgrade():
    op.execute("""
        DROP SCHEMA IF EXISTS sales CASCADE;
        DROP SCHEMA IF EXISTS settings CASCADE;
        DROP SCHEMA IF EXISTS ap CASCADE;
        DROP SCHEMA IF EXISTS procurement CASCADE;
        DROP SCHEMA IF EXISTS inventory CASCADE;
        DROP SCHEMA IF EXISTS auth CASCADE;
    """)
