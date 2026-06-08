# Inventory System — Requirements Document
**Version:** 1.0 (Draft)
**Status:** Pending Review

---

## 1. Purpose

This document defines the data structures, business rules, and behavioral requirements for the inventory management system. It serves as the authoritative reference for all backend implementation. Claude Code must read this document at the start of every session and must not deviate from these rules without explicit instruction.

---

## 2. System Overview

This is a multi-location inventory management system built around a master-variant product model. It tracks physical stock movements across locations, manages procurement from suppliers, and maintains an immutable ledger of all financial and inventory events.

The system is designed for a business that:
- Sells physical goods with multiple variants (size, color, etc.)
- Operates across multiple physical locations (warehouses, stores)
- Purchases from multiple suppliers at negotiated costs
- Needs accurate cost-of-goods tracking using FIFO costing
- Needs accounts payable tracking per supplier

---

## 3. Core Design Principles

1. **The ledger is immutable.** Records in `inventory_ledger` and `ap_ledger` are never updated or deleted. Corrections are made via new entries.
2. **Every stock movement writes two records.** Any change to physical stock must write to both `inventory_ledger` (the event log) and `current_stocks` (the running total).
3. **The variant is the atomic unit.** All stock tracking, costing, pricing, and sourcing is done at the variant level, not the product level.
4. **PID is the human identifier.** The `PID` field on `variants` is the user-facing unique identifier. It may be used in barcodes unless overridden. SKU is not unique and is for reference only.
5. **Soft deletes only.** No record is ever hard-deleted. Use `is_deleted = true` to retire records.

---

## 4. Section 1 — Access & Security

### 4.1 Employees and Users

- Every `user` must be linked to an `employee`. An employee record may exist without a user account (not all staff need system access).
- `users.is_active = false` disables login without deleting the account.
- All failed and successful login attempts are recorded in `login_attempts`. For failed attempts where the user cannot be resolved, `user_id` may be null but `username` must be recorded.

### 4.2 Roles

- Roles are assigned to users via `user_roles` (many-to-many).
- Role-based access control is enforced at the API layer. The database stores role assignments only.

### 4.3 Audit Log

- Every INSERT, UPDATE, and DELETE on any significant table must write a record to `audit_log`.
- `old_values` and `new_values` store the full row state as JSONB before and after the change.
- `audit_log` records are immutable. They are never updated or deleted.
- `actor_user_id` and `actor_employee_id` identify who performed the action.

---

## 5. Section 2 — Master Data & Reference

### 5.1 Locations

- Locations represent physical or virtual places where stock can exist.
- `location_type` must be one of: `Warehouse`, `Store`, `Bin`, `Virtual`.
- Physical locations (`Warehouse`, `Store`, `Bin`) represent real places where stock is held.
- Virtual locations exist for system purposes such as quarantine, damaged goods, and adjustment staging. They are never counted in active inventory reports.
- Locations support unlimited nesting depth via `parent_location_id`. Example: a Warehouse may contain Bins, which may contain sub-Bins (shelves, slots, etc.).
- The root of a location tree has no parent (`parent_location_id` is null).
- `status = 'Inactive'` prevents a location from being used in new transactions but preserves all historical records.
- A dedicated virtual quarantine location must exist in the system to hold rejected, damaged, or out-of-circulation stock. This location is system-managed and must not be deletable.

### 5.2 Units of Measure (UOMs)

- UOMs define how quantities are measured (PC, BOX, CASE, KG, etc.).
- `uom_code` is unique and uppercase.
- UOM conversions at the variant level allow a box of one variant to hold a different quantity than a box of another variant.

### 5.3 Product Categories

- Categories support a parent-child hierarchy via `parent_category_id`.
- A product may belong to multiple categories via `product_category_links`.
- Categories are used for UI filtering only and do not affect stock or costing logic.

---

## 6. Section 3 — Catalog & SKUs

### 6.1 Products (The Master Shell)

- A product is the conceptual grouping of one or more variants.
- The system generates `product_id` automatically. There is no user-facing product PID.
- `product_type` governs whether stock is tracked:
  - `Inventory` — stock is tracked and deducted on every outbound movement.
  - `Non-Inventory` — not tracked. No ledger entries are created.
  - `Service` — not tracked. No ledger entries are created.
- `base_uom_id` defines the default unit of measure for the product family.

### 6.2 Variants (The Physical SKU)

- A variant is the sellable, trackable unit. All stock, pricing, and sourcing lives here.
- `PID` is unique, user-defined, and is the primary human-readable identifier. It may appear on barcodes unless a specific barcode entry overrides it.
- `sku` is not unique. It is a reference field only.
- `is_default = true` flags the hero variant for the product family. Exactly one variant per product must have `is_default = true` at all times. The backend must enforce this constraint — setting a new default must automatically unset the previous one.
- If a variant's `price` is NULL, the system pulls the price from the sibling variant where `is_default = true`.
- `promo_price` is an optional temporary markdown price. If set, it takes precedence over `price` for display purposes.
- `attributes` is a JSONB field storing key-value pairs such as `{"size": "10-inch", "color": "silver"}`.

### 6.3 Variant Barcodes

- A variant may have multiple barcodes, each linked to a specific UOM.
- `is_primary = true` flags the main scannable barcode. Only one barcode per variant may be primary.
- The PID is used as the default barcode identifier unless a barcode entry exists.

### 6.4 Variant UOM Conversions

- Defines how quantities convert between UOMs at the variant level.
- Example: for Variant A, 1 BOX = 50 PCs. For Variant B (a larger size), 1 BOX = 30 PCs.
- Conversions are directional. `from_uom_id → to_uom_id` with a decimal `factor`.

### 6.5 Bundle Components

- A variant may be a bundle, composed of one or more component variants.
- When a bundle variant is sold or transferred outbound, the system must deduct stock from each component variant, not from the bundle variant itself.
- The bundle variant itself holds no stock.
- `quantity` supports decimals to allow fractional component quantities.
- Bundle behavior is triggered by the presence of rows in `bundle_components` for the given `bundle_variant_id`.

---

## 7. Section 4 — Procurement & Sourcing

### 7.1 Suppliers

- Suppliers are the vendors from whom stock is purchased.
- `terms` is the payment term in days (e.g. 30 = Net 30).

### 7.2 Variant Suppliers

- A variant may be sourced from multiple suppliers.
- `is_primary = true` identifies the preferred supplier for a variant. Only one supplier per variant may be primary.
- `gross_cost` is the supplier's catalog price for that variant.
- `supplier_discount` is the negotiated discount percentage (e.g. 10.00 = 10% off gross cost).
- Net cost is always computed as: `gross_cost × (1 - supplier_discount / 100)`. It is never stored here — it is derived on demand or locked into cost layers at the time of receipt.

---

## 8. Section 5 — Purchase Orders

### 8.1 Purchase Orders

- A PO documents the intent to purchase from a supplier for a specific destination location.
- `po_pid` is the human-friendly PO reference number, unique across all POs.
- PO status lifecycle: `Draft → Open → Partially_Received → Closed | Cancelled`.
- `total_amount` is a computed summary field. It reflects the sum of `(ordered_quantity × unit_cost)` across all line items.

### 8.2 Purchase Order Items

- Each line item references a specific variant.
- `ordered_quantity` and `received_quantity` support decimals for weight/length-based items.
- `unit_cost` is the agreed cost per unit for this specific PO line, which may differ from the catalog cost in `variant_suppliers`.

---

## 9. Section 6 — Inventory Movements, Costing & Ledger

### 9.1 Inventory Shipments

- A shipment records the physical arrival of goods, linked to a PO and a supplier.
- `shipment_pid` is the human-friendly shipment reference number.
- `po_id` links the shipment back to the originating purchase order.

### 9.2 Receiving Details

- Each line in a shipment records the QC result for one variant at one location.
- Four quantity fields capture the full receiving picture:
  - `quantity_ordered` — what the PO said should arrive.
  - `quantity_declared` — what the supplier's delivery note claims.
  - `quantity_actual` — what was physically counted on arrival.
  - `quantity_rejected` — what was refused due to damage or quality failure.
- Only `quantity_actual - quantity_rejected` enters stock. Rejected quantity goes to the virtual quarantine location.
- `qc_status` reflects the outcome: `Pending`, `Passed`, `Failed`, `Partially_Passed`.

### 9.3 Inventory Transfers

- A transfer records the movement of stock between two locations.
- Transfers are recorded after the fact. There is no status lifecycle at this stage.
- `transfer_pid` is the human-friendly transfer reference number.
- `requested_by_user_id`, `released_by_user_id`, and `received_by_user_id` record accountability.
- `total_bundle_count` records the number of physical boxes or bundles in the shipment (whole number only).
- Line items live in `inventory_transfer_items`, not in the header.

### 9.4 Inventory Transfer Items

- Each line records the movement of one variant in a transfer.
- Three quantity fields: `quantity_requested`, `quantity_released`, `quantity_received`.
- Quantities support decimals for weight/length-based items.

### 9.5 Inventory Ledger

- The ledger is the immutable source of truth for all physical stock movements.
- Every inbound or outbound movement creates a ledger entry.
- `qty_change` is positive for stock coming in and negative for stock going out.
- `location_id` records where the movement happened.
- `reason` values and their meaning:
  - `RECEIVE` — stock arriving from a shipment.
  - `SALE` — stock leaving for a customer sale.
  - `RETURN_IN` — customer returns stock back into a location.
  - `RETURN_OUT` — stock leaving to return to a supplier (RMA). See special rules below.
  - `TRANSFER_IN` — stock arriving at the destination location from a transfer.
  - `TRANSFER_OUT` — stock leaving the source location for a transfer.
  - `ADJUST` — manual stock correction.
- `reference_type` and `reference_id` identify the source document. Example: `reference_type = 'SHIPMENT'`, `reference_id = '42'`.

#### RETURN_OUT Special Rules

- `RETURN_OUT` entries represent stock being physically returned to a supplier, typically damaged or rejected goods.
- Stock for a supplier return is sourced from the virtual quarantine location.
- `RETURN_OUT` movements must be flagged distinctly in reports so they do not inflate outbound sales figures or distort COGS calculations.
- The financial recovery from a supplier return is recorded separately as a credit memo in the `ap_ledger`.

### 9.6 Current Stocks

- `current_stocks` is a materialized running total of stock per variant per location.
- It must be updated in the same transaction as every `inventory_ledger` write. They must never fall out of sync.
- The unique index on `(variant_id, location_id)` ensures one row per combination.
- Stock in the virtual quarantine location is excluded from active inventory reports.

### 9.7 Cost Layers (FIFO Engine)

- A cost layer is created for every shipment receipt, recording the cost at which that batch of stock was acquired.
- `original_quantity` is the quantity received. `quantity_remaining` decreases as stock from that batch is consumed.
- FIFO consumption: the oldest layer (lowest `created_at`) for a given variant and location is consumed first.
- `net_unit_cost` is computed and stored at the time of receipt as: `gross_cost × (1 - supplier_discount / 100)`. It is locked permanently and never recalculated.
- Cost layers are tracked per location. Stock received at the warehouse and stock received at the store maintain separate FIFO pools.

---

## 10. Section 7 — Accounts Payable

### 10.1 Supplier Invoices

- An invoice is the financial document from a supplier, linked to a physical shipment.
- `due_date` is calculated using `invoice_date + suppliers.terms days`.
- Status lifecycle: `Unpaid → Partial → Paid`.

### 10.2 Supplier Payments

- A payment records money sent to a supplier.
- Payments are applied to specific invoices via `invoice_payments`.

### 10.3 Invoice Payments Bridge

- A single payment may be applied across multiple invoices.
- A single invoice may be partially paid by multiple payments.
- `amount_applied` is the portion of the payment applied to a specific invoice.

### 10.4 AP Ledger

- The AP ledger is the immutable source of truth for how much money is owed to each supplier.
- `amount_change` is positive when debt increases (invoice received) and negative when debt decreases (payment made or credit memo applied).
- `reason` values: `INVOICE`, `PAYMENT`, `CREDIT_MEMO`, `ADJUSTMENT`.
- `reference_type` and `reference_id` identify the source document, consistent with the inventory ledger pattern.
- Supplier return recoveries (RMAs) are recorded as `CREDIT_MEMO` entries.

---

## 11. Known Gaps & Future Scope

The following are out of scope for the current implementation phase and must not be built until explicitly instructed:

- Sales module (sales orders, sales ledger, customer management)
- Customer returns module beyond basic `RETURN_IN` ledger entries
- Full RMA workflow (currently handled manually via virtual location)
- Reporting and analytics layer
- UOM conversion enforcement on stock movements (conversions are reference data only for now)

---

## 12. Claude Code Operating Instructions

1. Read this document in full at the start of every session.
2. Read the current schema file before making any structural changes.
3. Do not make changes to the database schema without explicit instruction.
4. Before implementing any feature, state your understanding of the requirement and wait for confirmation.
5. After completing any significant change, update the changelog and note any deviations from this document.
6. If a requirement is ambiguous, ask before implementing.
7. Never hard-delete records. Always use `is_deleted = true`.
8. Every stock movement must write to both `inventory_ledger` and `current_stocks` in the same transaction.

