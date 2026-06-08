# Season ERP — Requirements Document
**Version:** 2.0
**Status:** Approved

---

## 1. Purpose

This document defines the data structures, business rules, and behavioral requirements for the Season ERP system. It serves as the authoritative reference for all backend implementation. Claude Code must read this document at the start of every session and must not deviate from these rules without explicit instruction.

---

## 2. System Overview

This is a multi-location inventory and retail management system built around a master-variant product model. It tracks physical stock movements across locations, manages procurement from suppliers, records sales and customer payments, and maintains an immutable ledger of all financial and inventory events.

The system is designed for a business that:
- Sells physical goods with multiple variants (size, color, etc.)
- Operates across multiple physical locations (warehouses, stores)
- Purchases from multiple suppliers at negotiated costs
- Needs accurate cost-of-goods tracking using FIFO costing
- Needs accounts payable tracking per supplier
- Needs point-of-sale and accounts receivable tracking per customer

---

## 3. Core Design Principles

1. **The ledger is immutable.** Records in `inventory_ledger`, `ap_ledger`, and `ar_ledger` are never updated or deleted. Corrections are made via new entries.
2. **Every stock movement writes two records.** Any change to physical stock must write to both `inventory_ledger` (the event log) and `current_stocks` (the running total). These must happen in the same transaction.
3. **The variant is the atomic unit.** All stock tracking, costing, pricing, and sourcing is done at the variant level, not the product level.
4. **PID is the human identifier.** The `PID` field on `variants` is the user-facing unique identifier. It may be used in barcodes unless overridden by a specific barcode entry. SKU is not unique and is for reference only.
5. **Soft deletes only.** No record is ever hard-deleted. Use `is_deleted = true` to retire records. Junction tables and sub-entities with no `is_deleted` column (barcodes, UOM conversions, bundle components) may use hard deletes.
6. **Cost layers are locked at receipt.** Once a cost layer is written, its `net_unit_cost` never changes regardless of future supplier price changes.
7. **Pricing fields are never touched by cost operations.** FIFO consumption, free replacements, and adjustments must never modify `variant_suppliers.gross_cost`, `variants.price`, or `variants.promo_price`.
8. **Cached balances are always updated transactionally.** `customers.outstanding_balance` and `sales.balance_due` are never updated in isolation. They are recalculated and written in the same transaction as the event that caused the change. Reports always verify against the ledger.

---

## 4. Section 1 — Access & Security

### 4.1 Employees and Users

- Every `user` must be linked to an `employee`. An employee record may exist without a user account.
- `users.is_active = false` disables login without deleting the account.
- All failed and successful login attempts are recorded in `login_attempts`. For failed attempts where the user cannot be resolved, `user_id` may be null but `username` must be recorded. Failed attempts due to a deactivated account must also be recorded.

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
- `is_system = true` marks locations that are created on setup and must never be deletable or modifiable.

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
- The bundle variant's available quantity is always derived: it is the minimum of (each component's available stock ÷ component quantity required), computed per physical location.
- `quantity` supports decimals to allow fractional component quantities.
- **Bundle variants cannot be received or transferred directly.** Only base/component variants may appear in `receiving_details` or `inventory_transfer_items`. Attempting to add a bundle PID to a receiving or transfer form is rejected with an inline error. Suppliers deliver components; bundles are assembled at the point of sale by the backend explosion logic.

---

## 7. Section 4 — Procurement & Sourcing

### 7.1 Suppliers

- `terms` is the payment term in days (e.g. 30 = Net 30).

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
- Only valid transitions are accepted. Any other transition is rejected with HTTP 400.
- `total_amount` reflects the sum of `(ordered_quantity × unit_cost)` across all line items.

### 8.2 Purchase Order Items

- `ordered_quantity` and `received_quantity` support decimals for weight/length-based items.
- `unit_cost` is the agreed cost per unit for this specific PO line.

---

## 9. Section 6 — Inventory Movements, Costing & Ledger

### 9.1 Receiving Stock

Receiving is a two-stage workflow. Stock enters the active system at Stage 1; cost is confirmed separately at Stage 2. Stage 2 is encouraged but never mandatory — the system operates correctly without it.

**Stage 1 — Physical Arrival (`POST /procurement/shipments/{id}/receive`)**

1. A record in `inventory_shipments` captures the shipment header, linked to the supplier and optionally to a PO. A PO is not always required.
2. Each variant received gets a row in `receiving_details` with:
   - `received_at` — the date physical items were counted
   - `inspected_at` — the date QC status was determined (may differ from received_at)
   - `quantity_ordered` — what the PO said should arrive (if a PO exists)
   - `quantity_declared` — what the supplier's delivery note claims
   - `quantity_actual` — what was physically counted on arrival
   - `quantity_rejected` — what was refused due to damage or quality failure
3. Only `quantity_actual - quantity_rejected` enters active stock at the destination location.
4. `quantity_rejected` units are routed to the virtual Quarantine location via a ledger entry with reason `RECEIVE`.
5. `inventory_ledger` is written with reason `RECEIVE` and `current_stocks` is updated — both in the same transaction.
6. No cost layers are created at this stage. `inventory_shipments.is_confirmed` remains `false`.
7. Stock received at Stage 1 is immediately available and can be sold. Sales against this stock use the costing fallback hierarchy (see §9.3).

**Stage 2 — Cost Confirmation (`POST /procurement/shipments/{id}/confirm-costs`)**

1. Caller provides `unit_cost` per receiving detail line.
2. A `cost_layer` is created for each detail using the provided unit cost.
3. `variant_suppliers.gross_cost` is updated to the confirmed cost for future reference.
4. A `supplier_invoices` record is created with `total_amount = quantity_declared × unit_cost`. Due date = `invoice_date + supplier.terms days`.
5. An `INVOICE` entry is written to `ap_ledger`.
6. `inventory_shipments.is_confirmed` is set to `true`.

#### Cost Resolution on Receiving

When cost layers are created (Stage 2), the unit cost is provided directly by the caller. If Stage 2 is not performed, future sales fall back to the costing hierarchy defined in §9.3.

### 9.2 Transferring Stock

When stock moves between locations:

1. A record in `inventory_transfers` captures the header.
2. Each variant moved gets a row in `inventory_transfer_items` with `quantity_requested`, `quantity_released`, and `quantity_received`.
3. The system writes two `inventory_ledger` entries in the same transaction:
   - `TRANSFER_OUT` at the source location (negative `qty_change`)
   - `TRANSFER_IN` at the destination location (positive `qty_change`)
4. When either location is the virtual Adjustment location, the ledger reason is `ADJUST` instead of `TRANSFER_OUT`/`TRANSFER_IN`.
5. `current_stocks` is updated for both locations in the same transaction.
6. FIFO cost layers at the source location are consumed oldest-first for the transferred quantity.
7. Matching cost layers are created at the destination location carrying over the same `net_unit_cost` values from the consumed source layers. No new cost is introduced.
8. `total_bundle_count` is an optional informational field for staff reference only. It is never used in inventory calculations.

### 9.3 FIFO Consumption Rules

FIFO consumption is triggered on every outbound movement: `SALE`, `RETURN_OUT`, `TRANSFER_OUT`, and `ADJUST` (outbound).

**For transfers and adjustments:**
1. Pre-flight: verify `current_stocks.quantity >= requested quantity`. Reject with HTTP 400 if insufficient (unless `allow_negative_stock` policy is enabled — see §9.9).
2. Fetch all cost layers ordered by `created_at` ascending (oldest first).
3. Deduct from the oldest layer first, reducing `quantity_remaining`.
4. Reject with HTTP 400 if cost layers are insufficient to cover the quantity.
5. Continue until the full quantity is consumed.

**For sales (`post_draft`):**

The system must never block a sale post due to missing cost data. The consumption process follows a three-level fallback hierarchy:

1. Pre-flight: verify `current_stocks.quantity >= requested quantity`. Reject with HTTP 400 if insufficient (unless `allow_negative_stock` is enabled — see §9.9).
2. **Level 1 — FIFO** (`cost_source = 'fifo'`): cost layers exist covering the full quantity → consume oldest-first. `sale_items.cost_layer_id` is set to the consumed layer.
3. **Level 2 — Supplier list** (`cost_source = 'supplier_list'`): no covering layers, but a primary `variant_suppliers` record exists → `net_unit_cost = gross_cost × (1 - supplier_discount / 100)`. `cost_layer_id` is NULL.
4. **Level 3 — No cost data** (`cost_source = 'none'`): no layers and no supplier link → `net_unit_cost = 0`. `cost_layer_id` is NULL. Flagged for review in the Sales Ledger dashboard.

`sale_items.cost_source` records which level was used for each row. This field is locked at post time and never updated.

COGS for fully costed sales = sum of `(units consumed × net_unit_cost)` per `sale_items` row.

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

- Created at Stage 2 of the receiving workflow (`confirm-costs`), not at Stage 1 (`receive`).
- FIFO tracked per variant per location.
- `net_unit_cost` is permanently locked at the time the layer is created. Never changes.
- `quantity_remaining` decreases as stock is consumed. It never increases after creation except when a sale is voided (FIFO restoration).

### 9.9 System Policies (`settings.system_settings`)

System-wide inventory behaviour flags stored as key-value pairs. Readable by all authenticated users; writable by Admin and Manager roles only via `GET/PATCH /settings/inventory-policy`.

**`allow_negative_stock`** (default: `'false'`)
- `'false'` — insufficient stock blocks sales and transfers with HTTP 400. Default behavior.
- `'true'` — sales and transfers post regardless of stock level. `current_stocks.quantity` can go negative. Intended for after-the-fact auditor encoding where physical stock counts may not be current.
- Applies to: `post_draft` (sales) and `create_transfer`.
- When enabled: the stock balance pre-flight check is skipped. Cost layer sufficiency checks still apply for transfers.

---

## 10. Section 7 — Accounts Payable

### 10.1 Supplier Invoices

- Created automatically on receiving, in the same transaction as the ledger write.
- `total_amount` is based on `quantity_declared × unit_cost` from the receiving detail.
- `amended_amount` records the final agreed amount if it differs from the original.
- `amendment_notes` records what was negotiated (e.g. shortfall to be fulfilled in next shipment).
- `due_date` is calculated as `invoice_date + suppliers.terms days`.
- Status lifecycle: `Unpaid → Partial → Paid`.
- When `amended_amount` is set, payment status calculations use `amended_amount` instead of `total_amount`.

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

## 11. Section 8 — Sales Settings

### 11.1 Payment Modes

- Payment modes define how a customer pays: Cash, GCash, Maya, Visa, etc.
- `is_physical = true` for cash and checks; `false` for digital transfers and cards.
- Only `is_active = true` payment modes appear at the point of sale.
- Payment modes are not soft-deleted — use `is_active = false` to retire them.

### 11.2 Cash Registers

- A register is a physical POS terminal tied to a location.
- Every posted sale must reference a register.
- Only `is_active = true` registers are available for new sales.

---

## 12. Section 9 — Customers & Accounts Receivable

### 12.1 Customers

- A customer record is optional on a sale. Walk-in / anonymous sales are allowed.
- `credit_limit` is the maximum outstanding balance allowed. The system must reject a sale that would push a customer's `outstanding_balance` above their `credit_limit`.
- `terms_days` determines when payment is due: `0` = COD (due immediately), `15` = Net 15, etc.
- `outstanding_balance` is a cached running total. It is updated in the same transaction as every sale, return, and payment that affects it. It is never queried in isolation for financial reporting — reports always derive the balance from `ar_ledger`.
- `is_deleted = true` retires a customer. A deleted customer's historical sales records are preserved.

### 12.2 AR Ledger

- Immutable source of truth for money owed by each customer.
- `amount_change` is positive when debt increases (new sale) and negative when debt decreases (payment received, return credited).
- `reason` values: `SALE`, `PAYMENT`, `RETURN`, `ADJUSTMENT`.
- Every sale, customer payment, and sales return must write an `ar_ledger` entry in the same transaction.

---

## 13. Section 10 — Sales

### 13.1 Creating a Sale

When a sale is posted:

1. A `sales` record is created with status `Posted`.
2. `sale_pid` is a system-generated human-friendly reference (e.g. `SALE-00123`). It is not assigned until the sale is Posted — Draft sales carry no `sale_pid`.
3. `idempotency_key` is provided by the client.
4. `origin_sale_id` is optional. When a new sale is created as part of an exchange, it references the original sale's `sale_id`. This creates a traceable chain between related transactions. If a sale with the same key already exists, the existing sale is returned without creating a duplicate. This prevents double-posting on network retries.
4. `location_id` identifies where the sale occurred and drives stock deduction.
5. `customer_id` is optional. If null, the sale is treated as a walk-in COD sale.
6. `employee_id` records the cashier or salesperson.
7. For credit customers (`terms_days > 0`), `due_date` is calculated as `transaction_date + customer.terms_days`. For COD customers, `due_date` is null and `payment_status` defaults to `Paid` when fully tendered at checkout.

### 13.2 Sale Line Items

- Each line in the sale maps to one or more rows in `sale_items` — one row per FIFO cost layer consumed (or one row for fallback cost sources).
- The frontend sends one line per variant. The backend splits it into multiple `sale_items` rows if the quantity spans more than one cost layer.
- The API response collapses `sale_items` rows back to one display line per variant for the frontend. The split is a backend detail only.
- Each `sale_items` row carries a cost snapshot: `gross_cost`, `supplier_discount`, `net_unit_cost`, and `cost_source`. These fields are locked at post time and never updated after the sale is posted.
- `cost_source` values: `'fifo'` (consumed from a cost layer), `'supplier_list'` (fallback to primary supplier record), `'none'` (no cost data available — flagged for review), or `NULL` (pre-policy rows created before the costing policy was implemented).
- `line_total = unit_price × quantity` for each row.

### 13.3 Sale Totals

- `subtotal_amount` = sum of all `sale_items.line_total` values.
- `cart_discount_pct` = optional cart-level percentage discount applied to subtotal first.
- `cart_discount_flat` = optional cart-level flat discount applied after the percentage.
- `discount_amount` = resolved total cart discount (`subtotal × cart_discount_pct / 100 + cart_discount_flat`). System-calculated.
- `tax_amount` = tax applied to the sale.
- `grand_total` = `subtotal_amount - discount_amount + tax_amount`. Always system-calculated. Never accepted as client input.
- `receipt_grand_total` = always set to `grand_total` by the backend on auditor workstation posts. Reserved for a future cashier page where the physical receipt amount may differ.
- `audit_variance` = `SUM(tender amounts) - grand_total`. Calculated by the backend on post. Positive = over-tendered (change given); negative = shortfall (balance still owed). A non-zero value flags a discrepancy for review in the Sales Ledger dashboard.

### 13.4 Stock Deduction on Sale

When a sale is posted:

1. For each line item, FIFO cost layers are consumed at the sale location oldest-first.
2. `inventory_ledger` is written with reason `SALE` (negative `qty_change`) for each variant.
3. `current_stocks` is updated in the same transaction.
4. Bundle variants are exploded into components before deduction. The same bundle explosion rules from §6.5 apply.
5. `Non-Inventory` and `Service` product types generate no ledger entries.

### 13.5 Payments on a Sale

- There is no single `payment_mode_id` on the `sales` header. All payment detail lives in `customer_payments` and `customer_payment_applied`.
- A COD sale may be paid with split tender across multiple payment modes in the same transaction (e.g. part Cash, part GCash).
- Each tender creates one `customer_payments` row and one `customer_payment_applied` row linking it to the sale.
- `sales.balance_due` = `grand_total` minus the sum of all `customer_payment_applied.amount_applied` for that sale. Updated transactionally on every payment application.
- `sales.payment_status` is recalculated after every payment: `Unpaid` if no payments applied, `Partial` if partially paid, `Paid` if `balance_due = 0`.
- `customer_payments.unapplied_amount` holds any overpayment or advance payment remainder after application.

### 13.6 Credit Limit Enforcement

- Before posting a sale for a credit customer, the system must verify:
  `customer.outstanding_balance + sale.grand_total <= customer.credit_limit`
- If this check fails, the sale is rejected with HTTP 400 and a descriptive error.
- COD customers and walk-in sales have no credit limit check.

### 13.7 Voiding a Sale

- A posted sale may be voided by setting `status = 'Voided'`, recording `voided_at` and `void_reason`.
- Voiding reverses all stock movements: `inventory_ledger` entries with reason `RETURN_IN` are written for each line item, and `current_stocks` is updated.
- FIFO cost layers consumed by the sale are restored: `quantity_remaining` is incremented back on the layers that were consumed, in reverse order.
- Any applied payments are reversed: `customer_payments` and `customer_payment_applied` records are not deleted, but a reversal entry is written to `ar_ledger` with reason `ADJUSTMENT`.
- `customer.outstanding_balance` is updated transactionally.
- A voided sale may not be re-opened. It is a terminal state.
- Draft sales may be deleted (soft-deleted) without any stock or ledger impact, since no stock was ever deducted.

### 13.8 AR Ledger Writes on Sale Events

Every sale event must write to `ar_ledger` in the same transaction:

| Event | `amount_change` | `reason` |
|---|---|---|
| Sale posted | + `grand_total` | `SALE` |
| Payment applied | - `amount_applied` | `PAYMENT` |
| Sale voided | - `grand_total` | `ADJUSTMENT` |
| Return posted | - `return.grand_total` | `RETURN` |

---

## 14. Section 11 — Sales Returns

### 14.1 Creating a Return

When a customer return is processed:

1. A `sales_returns` record is created referencing the original `sale_id`.
2. `return_pid` is a system-generated human-friendly reference (e.g. `RET-00045`).
3. `location_id` is where returned stock will land. It defaults to the original sale's `location_id`. The cashier may override this at the time of return.
4. Each returned item references the exact `sale_item_id` (and therefore the exact `cost_layer_id`) from the original sale. This ensures FIFO reversal is precise.

### 14.2 Stock on Return

- Returned stock is added back to the destination location via an `inventory_ledger` entry with reason `RETURN_IN` (positive `qty_change`).
- `current_stocks` is updated in the same transaction.
- The cost layer referenced by `sales_return_items.cost_layer_id` has its `quantity_remaining` restored by the returned quantity.
- The customer's `outstanding_balance` is reduced by the return value in the same transaction.
- An `ar_ledger` entry is written with reason `RETURN` and a negative `amount_change`.

### 14.3 Return Refund

- A return does not automatically generate a cash refund. The refund is handled separately as a negative `customer_payment_applied` entry or a credit against a future sale, depending on business preference.
- This workflow is not enforced by the system — it is a manual step recorded by the cashier.

---

## 15. Section 12 — Supplier Returns

### 15.1 Creating a Supplier Return

- A `supplier_returns` record captures the header. Status lifecycle: `Draft → Shipped → Credit_Received`.
- Stock is sourced from the virtual Quarantine location — items must have been routed there at the time of receiving (via `quantity_rejected`).
- Each return item references the exact `cost_layer_id` being reversed, for accurate COGS credit.

### 15.2 Stock and AP on Supplier Return

- When a supplier return is confirmed (status moves to `Shipped`):
  - `inventory_ledger` is written with reason `RETURN_OUT` from the Quarantine location (negative `qty_change`).
  - `current_stocks` in Quarantine is reduced in the same transaction.
- When credit is received (status moves to `Credit_Received`):
  - A `CREDIT_MEMO` entry is written to `ap_ledger` reducing the amount owed to the supplier.
- `RETURN_OUT` movements must not be counted in outbound sales figures or distort COGS calculations in reports.

---

## 16. Section 13 — Sales API Reference

All sales endpoints live under the `/sales` prefix unless noted.

---

### 16.1 Product Catalog (POS Load)

| Method | Path | Description |
|---|---|---|
| `GET` | `/products/pos-catalog` | Returns the full active product and variant catalog for local caching at the POS. Includes variant PID, barcodes, price, promo_price, attributes, and current stock per location. Called once on POS load, not per scan. |

---

### 16.2 Sales Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/sales/payment-modes` | List all payment modes |
| `POST` | `/sales/payment-modes` | Create a payment mode |
| `PATCH` | `/sales/payment-modes/{id}` | Update or deactivate a payment mode |
| `GET` | `/sales/registers` | List all registers |
| `POST` | `/sales/registers` | Create a register |
| `PATCH` | `/sales/registers/{id}` | Update or deactivate a register |

---

### 16.3 Customers

| Method | Path | Description |
|---|---|---|
| `GET` | `/sales/customers` | List customers. Supports search by name. |
| `POST` | `/sales/customers` | Create a customer |
| `GET` | `/sales/customers/{id}` | Get customer detail including `outstanding_balance` and credit limit |
| `PATCH` | `/sales/customers/{id}` | Update customer details |
| `DELETE` | `/sales/customers/{id}` | Soft-delete (`is_deleted = true`). Historical sales preserved. |

---

### 16.4 Draft Sales

| Method | Path | Description |
|---|---|---|
| `POST` | `/sales/drafts` | Create a new draft sale. No `sale_pid` assigned. No stock deducted. No ledger written. Accepts `location_id`, `register_id`, `customer_id`, `employee_id`, and line items. |
| `GET` | `/sales/drafts` | List all open draft sales for the current register or location. |
| `GET` | `/sales/drafts/{id}` | Get a single draft sale with its line items. |
| `PATCH` | `/sales/drafts/{id}` | Update line items, customer, or other header fields on a draft. |
| `DELETE` | `/sales/drafts/{id}` | Soft-delete a draft. No stock or ledger impact. |

---

### 16.5 Posting a Sale

| Method | Path | Description |
|---|---|---|
| `POST` | `/sales/drafts/{id}/post` | Converts a draft to a Posted sale. This is the critical transaction endpoint. |

**What happens inside `POST /sales/drafts/{id}/post` (all in one transaction):**
1. Assigns `sale_pid` (e.g. `SALE-00123`).
2. Sets `status = 'Posted'`, `posted_at = now()`, and stamps `transaction_date` (user-supplied or defaults to today).
3. For credit customers: checks `outstanding_balance + grand_total <= credit_limit`. Rejects with HTTP 400 if exceeded.
4. Checks idempotency key — if a Posted sale with the same key exists, returns it without re-processing.
5. For each line item: runs FIFO consumption at `sale.location_id`, writes `sale_items` rows (one per layer split), writes `inventory_ledger` with reason `SALE`, updates `current_stocks`.
6. Calculates `grand_total`, `balance_due`, `due_date` (if credit customer), `audit_variance`.
7. Applies any tendered payments: creates `customer_payments` and `customer_payment_applied` rows, recalculates `balance_due` and `payment_status`.
8. Writes `ar_ledger` entry with reason `SALE` and `amount_change = grand_total`.
9. Updates `customer.outstanding_balance` transactionally.

**Response:** Full posted sale with collapsed line items (one display line per variant), payment summary, and balance due.

---

### 16.6 Reading Sales

| Method | Path | Description |
|---|---|---|
| `GET` | `/sales/` | List posted and voided sales with cursor pagination. Returns `SalesListResponse` with `items`, `totals` (summary row), and `next_cursor`. Filters: date range, location, shift, register, cashier, employee, customer, payment_status, status, has_variance, has_uncosted. |
| `GET` | `/sales/summary` | Revenue and profit dashboard metrics for the filtered scope. Same filter parameters as `GET /sales/` (excluding pagination). Returns merchandise_gross, cart_discounts, non_merchandise_revenue, variances, total_revenue, gross_profit, uncosted_revenue, collections (per payment mode), total_physical, total_virtual, total_collected. |
| `GET` | `/sales/next-pid` | Returns the next sale PID formatted as `SALE-{n:05d}`, computed as `MAX(CAST(SUBSTRING(sale_pid FROM 6) AS INTEGER)) + 1` over all conforming PIDs. Defaults to `SALE-00001`. |
| `GET` | `/sales/{id}` | Get a single sale. Line items collapsed to one per variant for display. Includes `payments` (tender rows). |
| `GET` | `/sales/{id}/items` | Get raw `sale_items` rows including FIFO layer splits and `cost_source`. For audit and COGS queries. |

---

### 16.7 Voiding a Sale

| Method | Path | Description |
|---|---|---|
| `POST` | `/sales/{id}/void` | Voids a posted sale. Requires `void_reason` in the request body. |

**What happens inside `POST /sales/{id}/void` (all in one transaction):**
1. Sets `status = 'Voided'`, records `voided_at` and `void_reason`.
2. Reverses stock: writes `inventory_ledger` with reason `RETURN_IN` for each line item, updates `current_stocks`.
3. Restores FIFO layers: increments `quantity_remaining` on consumed layers in reverse order.
4. Reverses AR: writes `ar_ledger` entry with reason `ADJUSTMENT` and `amount_change = -grand_total`.
5. Updates `customer.outstanding_balance` transactionally.
6. Does not delete or reverse `customer_payments` records — records a reversal entry instead.

---

### 16.8 Customer Payments

| Method | Path | Description |
|---|---|---|
| `POST` | `/sales/payments` | Record a customer payment and apply it to one or more sales. |
| `GET` | `/sales/payments` | List payments. Filter by customer or date range. |
| `GET` | `/sales/payments/{id}` | Get a single payment with its application detail. |
| `POST` | `/sales/payments/{id}/apply` | Manually apply unapplied credit from an existing payment to a sale. Requires authorization — not available to floor cashier role. |

**What happens inside `POST /sales/payments` (all in one transaction):**
1. Creates `customer_payments` record.
2. For each sale in the application list: creates `customer_payment_applied` row, recalculates `sales.balance_due` and `sales.payment_status`.
3. Sets `customer_payments.unapplied_amount` to any remainder.
4. Writes `ar_ledger` entry with reason `PAYMENT` and `amount_change = -amount_applied` per sale.
5. Updates `customer.outstanding_balance` transactionally.

---

### 16.9 Sales Returns

| Method | Path | Description |
|---|---|---|
| `POST` | `/sales/returns` | Create a return. |
| `GET` | `/sales/returns` | List returns. |
| `GET` | `/sales/returns/{id}` | Get a single return with its line items. |

**Request body for `POST /sales/returns`:**
- `sale_id` — optional. If omitted, caller must have a role with `process_blind_returns` permission.
- `location_id` — where stock lands. Defaults to original sale's `location_id` if `sale_id` is provided.
- `origin_sale_id` — set on any new exchange sale created as a result of this return, linking the transactions.
- `items` — list of `{ sale_item_id, quantity }`. `sale_item_id` is required when `sale_id` is provided. When processing a blind return (no `sale_id`), `variant_id` and `unit_price` are provided instead.

**What happens inside `POST /sales/returns` (all in one transaction):**
1. Assigns `return_pid` (e.g. `RET-00045`).
2. Writes `inventory_ledger` with reason `RETURN_IN` for each item, updates `current_stocks` at the destination location.
3. Restores `cost_layer.quantity_remaining` for the referenced layer.
4. Writes `ar_ledger` entry with reason `RETURN` and `amount_change = -grand_total`.
5. Updates `customer.outstanding_balance` transactionally.

---

### 16.10 Supplier Returns (Sales Module View)

Supplier return endpoints live under `/procurement`. See §15 for business rules. The sales module has no direct endpoints for supplier returns — they are managed via the procurement module.

---

## 17. Known Gaps & Future Scope

Out of scope — do not build until explicitly instructed:

- Reporting and analytics layer
- UOM conversion enforcement on stock movements (conversions are reference data for now)
- Bulk Excel import
- Full RMA workflow (partial coverage exists via supplier returns and sales returns)
- Shift management and register open/close reconciliation
- Transfer FIFO under negative stock: when `allow_negative_stock = true` and cost layers are depleted, `create_transfer` still raises HTTP 400 on insufficient layers. Only the stock balance check is bypassed — cost layer enforcement is unchanged.
- Pre-policy `sale_items` rows carry `cost_source = NULL` (neither `'fifo'` nor `'none'`). These are excluded from Known Profit calculations and not counted as uncosted. A backfill migration may be needed for historical COGS accuracy.

---

## 18. Section 14 — Frontend: Sales Encoding Workstation

The sales encoding workstation is a privileged data entry screen for auditors and authorized cashiers to record paper receipt transactions into the system. It is not a live POS terminal — it is a transcription tool. Transactions are recorded after the fact from physical receipts.

### 18.1 Two Modes — Auditor vs Floor Cashier

The workstation has two behavioral modes driven by the user's role. The interface is the same page; role determines which fields are editable.

| Field | Floor cashier | Auditor |
|---|---|---|
| Sale date | Fixed to today | Editable — backdating allowed |
| Cashier | Fixed to logged-in user | Selectable from employee list |
| Location | Fixed to assigned register's location | Selectable |
| Shift | Fixed to current shift | Selectable |
| Register | Fixed to assigned register | Selectable |
| Receipt number | Free entry | Free entry + auto-increment option |
| System total override | Not allowed | Allowed — enters receipt total manually |
| Cart discount | Allowed | Allowed |
| Item discount | Allowed | Allowed |
| Cart park | Allowed | Allowed |
| Void a sale | Not allowed | Allowed |

### 18.2 Sticky Session Header

The header bar sits at the top of the workstation. All fields are always editable — there is no lock/unlock mechanic. Values persist between transactions and do not reset after posting.

Fields: **Date**, **Shift**, **Location**, **Register** (required to post), **Cashier/Employee**, **Customer**, **Receipt No.**

**Cashier/Employee** — dropdown populated from `GET /auth/employees` filtered to `is_active = true`. Sources from the employees table directly, not from users or roles.

**Customer** — optional search field. Defaults to walk-in (`customer_id = null`). When a customer is selected, their `outstanding_balance` and `credit_limit` are displayed as informational text. Credit limit is never enforced on the workstation — display only.

**Receipt No. (Sale PID)** behavior:
- Auto mode: on mount and after every successful post, the workstation fetches `GET /sales/next-pid` and sets the field to the returned value.
- Manual mode: field is free-text. The encoder may override it at any time to match the physical receipt.
- Values persist between transactions — the encoder controls when to increment.

### 18.3 Item Search Panel

A persistent left-side panel for searching and adding items to the cart.

- Keyword search filters the item list in real time as the encoder types.
- Results show variant name, PID, and catalog price.
- Clicking an item adds it to the cart. The panel stays open and does not reset — multiple items can be added in sequence without interruption.
- The search field retains its value after adding an item.
- The panel is always visible alongside the cart. It does not close or collapse on item selection.

### 18.4 Cart — Spreadsheet-Style Line Items

The cart is a table with one row per item. Columns: item name, quantity, unit price, discount, line total, delete.

Quantity field:
- Plain number input. No spinner arrows.
- Supports decimals for weight/length-based items.

Unit price field:
- Editable. Pre-filled from the catalog price.
- The encoder may override it to match the physical receipt.

Discount field:
- Supports both percentage and flat value modes.
- A toggle on the column header switches the entire discount column between `%` mode and `flat` (₱) mode.
- In `%` mode: entering `15` applies a 15% discount to that line. Line total = unit price × qty × (1 - 0.15).
- In flat mode: entering `50` deducts ₱50 from the line total. Line total = (unit price × qty) - 50.
- Discount propagation behavior:
  - Single click on a discount cell: the value spreads to the next row below.
  - Double click on a discount cell: the value spreads to all rows below.
  - Click and drag across rows: the value spreads to each row the cursor passes over.

Line total:
- Read-only. Calculated automatically from quantity, unit price, and discount.

### 18.5 Cart Totals

Below the cart:

- Subtotal — sum of all line totals. Read-only.
- Cart discount — a flat value field. Deducted from the subtotal. Available to all roles.
- Grand Total — `subtotal - cart discount`. Always system-calculated. Never editable.
- Receipt Total — display only. Always equals Grand Total. The backend sets `receipt_grand_total = grand_total` on every auditor post. Not overridable on this page (reserved for a future cashier page).

### 18.6 Payment Tender

Below the totals, a tender section allows the encoder to record how the sale was paid.

- On new cart initialization, the first tender row auto-populates with Cash payment mode and the current Grand Total amount. Cash is resolved as: the mode named "Cash" first; if absent, the first `is_physical = true` mode; if absent, the first active mode.
- Additional rows can be added for split tender (e.g. part Cash, part GCash). Amounts on additional rows are not auto-split — the encoder enters them manually.
- Per row fields: payment mode selector (active modes only), amount, reference number.
- **Reference number** is shown only when the selected payment mode has `is_physical = false` (digital and card payments). Hidden for Cash and all physical modes. Used for GCash reference numbers, card approval codes, bank transfer IDs, etc.
- Running total of all tender rows displayed below.
- **Change Due / Balance Due** — shown below "Total Tendered":
  - When `total_tendered > grand_total`: "Change Due ₱X" in green — over-tendered, change to be given back.
  - When `total_tendered < grand_total`: "Balance Due ₱X" in red — underpaid.
  - When equal: nothing shown.
- **Audit variance** = `SUM(tender amounts) - grand_total`. Stored to `audit_variance` on post. Positive = over-tendered; negative = shortfall. Used by the Sales Ledger dashboard and reports.
- Payment rows can be added and removed freely before posting.

### 18.7 Cart Park (Draft)

A Park button saves the current cart as a Draft sale and clears the workstation for the next transaction. The parked draft retains all line items, header values, and partial payment entries.

Parked drafts are accessible from a draft queue — the encoder can return to any parked transaction, complete it, and post it.

A parked draft does not deduct stock and does not write any ledger entries.

### 18.8 Posting a Sale

The Post Sale button submits the transaction. Before posting:
- All required fields must be filled (location, register, at least one line item, at least one payment row).
- The system runs the credit limit check for credit customers.
- The idempotency key is sent with the request to prevent double-posting on retry.

After posting, the workstation clears and the receipt number auto-increments.

---

## 19. Claude Code Operating Instructions

1. Read this document, `/docs/schema.dbml`, and `/docs/backlog.md` in full at the start of every session.
2. Report that you have read all three files before proceeding.
3. Do not make any changes until explicitly instructed.
4. Before implementing any feature, state your understanding and wait for confirmation.
5. Never hard-delete records. Always use `is_deleted = true` except on junction tables with no `is_deleted` column.
6. Every stock movement must write to both `inventory_ledger` and `current_stocks` in the same transaction.
7. Every AR event must write to `ar_ledger` in the same transaction as the sale, return, or payment.
8. Pricing fields (`variant_suppliers.gross_cost`, `variants.price`, `variants.promo_price`) must never be modified by receiving, costing, or adjustment operations.
9. After completing significant changes, update `/docs/changelog.md` and tick completed items in `/docs/backlog.md`.
10. Do not run any git commands. Never stage, commit, or push. All version control is handled manually.
