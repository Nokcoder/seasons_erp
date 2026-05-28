# Inventory System — Requirements Document
**Version:** 1.1
**Status:** Approved

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
2. **Every stock movement writes two records.** Any change to physical stock must write to both `inventory_ledger` (the event log) and `current_stocks` (the running total). These must happen in the same transaction.
3. **The variant is the atomic unit.** All stock tracking, costing, pricing, and sourcing is done at the variant level, not the product level.
4. **PID is the human identifier.** The `PID` field on `variants` is the user-facing unique identifier. It may be used in barcodes unless overridden by a specific barcode entry. SKU is not unique and is for reference only.
5. **Soft deletes only.** No record is ever hard-deleted. Use `is_deleted = true` to retire records. Junction tables and sub-entities with no `is_deleted` column (barcodes, UOM conversions, bundle components) may use hard deletes.
6. **Cost layers are locked at receipt.** Once a cost layer is written, its `net_unit_cost` never changes regardless of future supplier price changes.
7. **Pricing fields are never touched by cost operations.** FIFO consumption, free replacements, and adjustments must never modify `variant_suppliers.gross_cost`, `variants.price`, or `variants.promo_price`.

---

## 4. Section 1 — Access & Security

### 4.1 Employees and Users

- Every `user` must be linked to an `employee`. An employee record may exist without a user account.
- `users.is_active = false` disables login without deleting the account.
- All failed and successful login attempts are recorded in `login_attempts`. For failed attempts where the user cannot be resolved, `user_id` may be null but `username` must be recorded.

### 4.2 Roles

- Roles are assigned to users via `user_roles` (many-to-many).
- Role-based access control is enforced at the API layer.

### 4.3 Audit Log

- Every INSERT, UPDATE, and DELETE on any significant table must write a record to `audit_log`.
- `old_values` and `new_values` store the full row state as JSONB before and after the change.
- `audit_log` records are immutable. They are never updated or deleted.

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
- A dedicated virtual quarantine location must exist in the system to hold rejected or damaged stock. This location is system-managed and must not be deletable.
- A dedicated virtual adjustment location must exist for stock corrections. This location is system-managed and must not be deletable.

### 5.2 System-Seeded Virtual Locations

Two virtual locations must be created on system setup and must never be deletable:

| Name | Purpose |
|---|---|
| Quarantine | Holds rejected or damaged goods from receiving |
| Adjustment | Source or destination for stock corrections |

### 5.3 Units of Measure (UOMs)

- UOMs define how quantities are measured (PC, BOX, CASE, KG, MTR, etc.).
- `uom_code` is unique and uppercase.
- UOM conversions at the variant level allow different variants to have different conversion factors for the same UOM pair.

### 5.4 Product Categories

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
- `is_default = true` flags the hero variant for the product family. Exactly one variant per product must have `is_default = true` at all times. Setting a new default must automatically unset the previous one in the same transaction.
- If a variant's `price` is NULL, the system pulls the price from the sibling variant where `is_default = true`.
- `promo_price` is an optional temporary markdown price. If set, it takes precedence over `price` for display purposes.
- `attributes` is a JSONB field storing key-value pairs such as `{"size": "10-inch", "color": "silver"}`.

### 6.3 Variant Barcodes

- A variant may have multiple barcodes, each linked to a specific UOM.
- `is_primary = true` flags the main scannable barcode. Setting a new primary must automatically demote all other barcodes for that variant.
- The PID is used as the default identifier if no barcode entry exists.

### 6.4 Variant UOM Conversions

- Defines how quantities convert between UOMs at the variant level.
- Example: for Variant A, 1 BOX = 50 PCs. For Variant B (a larger size), 1 BOX = 30 PCs.
- On the frontend, users may enter transfer quantities in either bundle/UOM mode or base unit mode. The system always stores and processes quantities in base units. Bundle entry is a UI convenience that multiplies by the conversion factor before saving.

### 6.5 Bundle Components

- A variant may be a bundle, composed of one or more component variants.
- When a bundle variant is involved in any outbound movement (sale, transfer, adjustment), the system explodes it into components and deducts stock and FIFO cost layers from each component individually. The bundle variant itself holds no stock.
- The bundle variant's available quantity is always derived: it is the minimum of (each component's available stock ÷ component quantity required).
- `quantity` supports decimals to allow fractional component quantities.

---

## 7. Section 4 — Procurement & Sourcing

### 7.1 Suppliers

- `terms` is the payment term in days (e.g. 30 = Net 30).
- Supplier contact fields (contact_person, phone, email, address, contact_notes, registered_at) are retained for reference.

### 7.2 Variant Suppliers

- A variant may be sourced from multiple suppliers.
- `is_primary = true` identifies the preferred supplier. Setting a new primary must automatically demote all others for that variant.
- `gross_cost` is the supplier's catalog price. `supplier_discount` is the negotiated discount percentage.
- Net cost is always computed as: `gross_cost × (1 - supplier_discount / 100)`. It is never stored here.

---

## 8. Section 5 — Purchase Orders

### 8.1 Purchase Orders

- `po_pid` is the human-friendly PO reference number, unique across all POs.
- PO status lifecycle: `Draft → Open → Partially_Received → Closed | Cancelled`.
- `total_amount` reflects the sum of `(ordered_quantity × unit_cost)` across all line items.

### 8.2 Purchase Order Items

- `ordered_quantity` and `received_quantity` support decimals for weight/length-based items.
- `unit_cost` is the agreed cost per unit for this specific PO line.

---

## 9. Section 6 — Inventory Movements, Costing & Ledger

### 9.1 Receiving Stock

When stock is received from a supplier:

1. A record in `inventory_shipments` captures the shipment header, linked to the supplier and optionally to a PO. A PO is not always required.
2. Each variant received gets a row in `receiving_details` with:
   - `received_at` — the date physical items were counted
   - `inspected_at` — the date QC status was determined (may differ from received_at)
   - `quantity_ordered` — what the PO said should arrive (if a PO exists)
   - `quantity_declared` — what the supplier's delivery note claims
   - `quantity_actual` — what was physically counted on arrival
   - `quantity_rejected` — what was refused due to damage or quality failure
3. Only `quantity_actual - quantity_rejected` enters active stock at the destination location.
4. `quantity_rejected` units are routed to the virtual Quarantine location via a ledger entry with reason `RECEIVE` and a note indicating rejection.
5. A `cost_layer` is created for the accepted quantity using the cost resolution rules below.
6. `inventory_ledger` is written with reason `RECEIVE` and `current_stocks` is updated — both in the same transaction.

#### Cost Resolution on Receiving

The system resolves cost in this priority order:
1. The `unit_cost` on the matching `purchase_order_items` line (if a PO exists)
2. The primary `variant_suppliers` record's `gross_cost × (1 - supplier_discount / 100)`
3. If neither exists, the cost layer is written with `net_unit_cost = 0` and must be flagged for manual review

#### Payment Forecasting

- On receiving, a `supplier_invoices` record is created with `total_amount` based on `quantity_declared × unit_cost` from the supplier's receipt — this is the expected amount to be paid.
- If the agreed amount changes after negotiation (e.g. supplier promises to fulfill a shortfall in the next shipment), `amended_amount` and `amendment_notes` are updated on the invoice record.
- Payment forecasting is done by querying `supplier_invoices.due_date` grouped by month.

### 9.2 Transferring Stock

When stock moves between locations:

1. A record in `inventory_transfers` captures the header.
2. Each variant moved gets a row in `inventory_transfer_items` with `quantity_requested`, `quantity_released`, and `quantity_received`.
3. The system writes two `inventory_ledger` entries in the same transaction:
   - `TRANSFER_OUT` at the source location (negative `qty_change`)
   - `TRANSFER_IN` at the destination location (positive `qty_change`)
4. `current_stocks` is updated for both locations in the same transaction.
5. FIFO cost layers at the source location are consumed oldest-first for the transferred quantity.
6. Matching cost layers are created at the destination location carrying over the same `net_unit_cost` values from the consumed source layers. No new cost is introduced.
7. `total_bundle_count` is an optional informational field for staff reference only. It is never used in inventory calculations.

### 9.3 FIFO Consumption Rules

FIFO consumption is triggered on every outbound movement: `SALE`, `RETURN_OUT`, `TRANSFER_OUT`, and `ADJUST` (outbound).

The consumption process:
1. Fetch all cost layers for the variant at the location, ordered by `created_at` ascending (oldest first).
2. Deduct from the oldest layer first, reducing `quantity_remaining`.
3. If the oldest layer is exhausted (`quantity_remaining = 0`), move to the next oldest layer.
4. Continue until the full outbound quantity is consumed.
5. COGS = sum of `(units consumed from each layer × that layer's net_unit_cost)`.

#### Free Replacement Stock (Exchange RMA)

When a supplier sends replacement items at no charge:
- Receive the replacement via a normal `receiving_details` entry.
- Write the cost layer with `net_unit_cost = 0` for the replacement units.
- Record a `CREDIT_MEMO` entry in `ap_ledger` for the value of the returned items.
- **Under no circumstances should `net_unit_cost = 0` propagate to `variant_suppliers.gross_cost`, `variants.price`, or `variants.promo_price`.** Pricing fields are never touched by receiving or cost operations.

### 9.4 Stock Adjustments

Adjustments are processed as transfers involving the virtual Adjustment location:

- **To add stock** (e.g. found extra units): create a transfer from the Adjustment location to the physical location. Ledger reason: `ADJUST`.
- **To remove stock** (e.g. missing units): create a transfer from the physical location to the Adjustment location. Ledger reason: `ADJUST`. FIFO layers are consumed on the outbound side.
- The decision to write off the discrepancy or assign accountability is made separately and does not affect the stock correction itself.

### 9.5 Repackaging / Standard Factor Items

For items sold by a unit of measure derived from a standard conversion (e.g. fabric sold by the meter from a spool):

- The variant's `base_uom` is the purchase unit (e.g. SPOOL).
- A `variant_uom_conversion` defines the standard factor (e.g. 1 SPOOL = 20 MTR).
- On receiving, stock is added in the purchase unit (e.g. +1 SPOOL = +20 MTR effective stock).
- Sales and transfers deduct in the sell unit (e.g. MTR), supporting decimal quantities.
- The standard factor is always used. Actual physical measurement is not feasible and is not supported. Discrepancies are corrected via stock adjustments over time.

### 9.6 Inventory Ledger

- The ledger is the immutable source of truth for all physical stock movements.
- `qty_change` is positive for stock coming in and negative for stock going out.
- `reference_type` and `reference_id` identify the source document.
- `reason` values: `RECEIVE`, `SALE`, `RETURN_IN`, `RETURN_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`, `ADJUST`.

#### RETURN_OUT Special Rules

- Stock for a supplier return is sourced from the virtual Quarantine location.
- `RETURN_OUT` movements must be flagged distinctly in reports. They must not inflate outbound sales figures or distort COGS calculations.
- Financial recovery is recorded as a `CREDIT_MEMO` in `ap_ledger`.

### 9.7 Current Stocks

- `current_stocks` is a materialized running total per variant per location.
- Updated in the same transaction as every `inventory_ledger` write.
- Stock in virtual locations (Quarantine, Adjustment) is excluded from active inventory reports.

### 9.8 Cost Layers

- Created on every stock receipt.
- FIFO tracked per variant per location.
- `net_unit_cost` is computed and permanently locked at receipt time.
- `quantity_remaining` decreases as stock is consumed. It never increases after creation.

---

## 10. Section 7 — Accounts Payable

### 10.1 Supplier Invoices

- Created on receiving, with `total_amount` based on the supplier's declared quantities and agreed unit cost.
- `amended_amount` records the final agreed amount if it differs from the original.
- `amendment_notes` records what was negotiated (e.g. shortfall to be fulfilled in next shipment).
- `due_date` is calculated as `invoice_date + suppliers.terms days`.
- Status lifecycle: `Unpaid → Partial → Paid`.

### 10.2 Supplier Payments

- A payment records money sent to a supplier.
- Applied to specific invoices via `invoice_payments`.

### 10.3 Invoice Payments Bridge

- A single payment may be applied across multiple invoices.
- A single invoice may be partially paid by multiple payments.
- `amount_applied` is the portion of the payment applied to a specific invoice.

### 10.4 AP Ledger

- Immutable source of truth for money owed to each supplier.
- `amount_change` is positive when debt increases (invoice) and negative when debt decreases (payment or credit memo).
- `reason` values: `INVOICE`, `PAYMENT`, `CREDIT_MEMO`, `ADJUSTMENT`.
- Supplier return recoveries are recorded as `CREDIT_MEMO` entries.

---

## 11. Known Gaps & Future Scope

Out of scope for v1 — do not build until explicitly instructed:

- Sales module
- Customer returns module
- Full RMA workflow
- Reporting and analytics layer
- UOM conversion enforcement on stock movements (conversions are reference data for now)
- Bulk Excel import (needs redesign for PID-on-variant model)
- JWT enforcement on protected routes (auth stub to be replaced)
- Audit log writes (model exists, no code writes to it yet)

---

## 12. Claude Code Operating Instructions

1. Read this document and `/docs/schema.dbml` in full at the start of every session.
2. Report that you have read both files before proceeding.
3. Do not make any changes until explicitly instructed.
4. Before implementing any feature, state your understanding and wait for confirmation.
5. Never hard-delete records. Always use `is_deleted = true` except on junction tables with no `is_deleted` column.
6. Every stock movement must write to both `inventory_ledger` and `current_stocks` in the same transaction.
7. Pricing fields (`variant_suppliers.gross_cost`, `variants.price`, `variants.promo_price`) must never be modified by receiving, costing, or adjustment operations.
8. After completing significant changes, update `/docs/changelog.md`.
9. The sales module is out of scope for v1. Do not implement anything sales-related until a v2 schema is issued.
