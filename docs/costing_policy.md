# Costing Policy

## Overview
This document defines how the system resolves product cost at the
time of sale, how cost layers are created through receiving, and
how variances between assumed and actual costs are handled.

The guiding principle is: the auditor workflow must never be blocked
by missing cost data. A semi-working FIFO with a sensible fallback
is better than a blocking system or a flat average cost model.

---

## Cost Resolution Hierarchy

When a sale is posted, the system resolves unit cost for each
sale_item in the following order:

### Level 1 — FIFO Cost Layer (preferred)
- Condition: `inventory.cost_layers` has rows for this variant
  at this location with `quantity_remaining > 0`
- Behavior: consume from the oldest layer first (FIFO order
  determined by `created_at`)s
- Fields set on sale_item:
  - `cost_layer_id` = consumed layer's layer_id
  - `net_unit_cost` = layer's net_unit_cost
  - `cost_source` = 'fifo'

### Level 2 — Supplier List Cost (fallback)
- Condition: no cost layers exist for this variant at this
  location, but a primary supplier link exists in
  `inventory.variant_suppliers` where `is_primary = true`
- Behavior: calculate net unit cost from supplier record
  `net_unit_cost = gross_cost × (1 - supplier_discount / 100)`
- Fields set on sale_item:
  - `cost_layer_id` = NULL
  - `net_unit_cost` = calculated supplier list cost
  - `cost_source` = 'supplier_list'

### Level 3 — No Cost Data
- Condition: no cost layers and no supplier link exists
- Behavior: sale posts with zero cost, flagged for review
- Fields set on sale_item:
  - `cost_layer_id` = NULL
  - `net_unit_cost` = 0
  - `cost_source` = 'none'

### Critical Rule
The system must NEVER block a sale post due to missing cost
layers. Stock deduction and revenue recording always succeed
regardless of cost data availability.

---

## Cost Layer Creation — Receiving Workflow

Cost layers are created through the two-stage receiving workflow.

### Stage 1 — Physical Arrival
- Endpoint: POST /procurement/shipments/:id/receive
- Writes: inventory_ledger RECEIVE entry, current_stocks upsert
- Cost layers: NOT created at this stage
- Shipment status: Pending Confirmation
- Stock is immediately available and can be sold
- Sales against this stock use Level 2 or Level 3 cost fallback

### Stage 2 — Cost Confirmation
- Endpoint: POST /procurement/shipments/:id/confirm-costs
- Writes: cost_layers per line item, supplier invoice, ap_ledger
- Shipment status: Confirmed
- Fields per cost layer:
  - `original_quantity` = quantity_actual from receiving_details
  - `quantity_remaining` = same as original_quantity at creation
  - `net_unit_cost` = unit_cost as entered in confirm-costs form
  - `gross_cost` = unit_cost before discount
  - `supplier_discount` = discount % from supplier link if available
- After Stage 2, future sales consume from real FIFO layers

### Stage 2 is encouraged but never mandatory
The system operates correctly without Stage 2. Stage 2 improves
cost accuracy but does not gate any other workflow.

---

## Cost Variance Handling

When Stage 2 is completed after some units have already been sold:

### Past sales — no restatement
Sales that posted using Level 2 (supplier_list) or Level 3 (none)
cost are not retroactively updated. The cost snapshot on sale_items
is immutable once recorded. This is correct accounting behavior —
past COGS is not restated.

### Future sales — use real FIFO
Once cost layers exist, all future sales consume from them at the
actual received cost. cost_source switches to 'fifo' automatically.

### Variance reporting
The system flags the variance between assumed and actual cost for
the accountant's awareness:
- Identify sale_items where cost_source = 'supplier_list' or 'none'
  that reference variants which now have confirmed cost layers
- Report: variant, units sold at assumed cost, assumed cost,
  actual confirmed cost, COGS variance (units × difference)
- The accountant reviews and makes journal entries as needed
- No automated restatement — variance is informational only

### Example
- 100 units sold at assumed cost ₱45.00 (supplier_list)
- Stage 2 confirmed actual cost ₱48.00
- Variance report shows: ₱300.00 COGS understatement
- Accountant records journal entry if material
- Future sales use ₱48.00 from FIFO layer

---

## Bundle Variants — Cost Handling

Bundle variants have no independent stock or cost layers.
When a bundle variant is sold:
- System deducts from component variant stocks (not bundle stock)
- Cost is resolved per component using the hierarchy above
- Each component gets its own cost_source on the ledger entry
- Bundle sale_item records bundle variant_id and bundle price
  with cost_layer_id = NULL (cost tracked at component level)

---

## Schema Reference

### sales.sale_items additions
- cost_source varchar [note: 'fifo = consumed from cost layer,
- supplier_list = fallback to primary supplier cost,
- none = no cost data available']

### inventory.cost_layers (existing, for reference)
- layer_id bigint [pk, increment]
- variant_id int [ref: > variants.variant_id]
- shipment_id int [ref: > inventory_shipments.shipment_id]
- location_id int [ref: > locations.location_id]
- original_quantity decimal(15,4)
- quantity_remaining decimal(15,4)
- gross_cost decimal(15,2)
- supplier_discount decimal(5,2)
- net_unit_cost decimal(15,2)
- created_at datetime

---

## Implementation Notes for CC

### _consume_fifo modification (sales/router.py)
When no cost layers found for variant at location:
1. Query variant_suppliers WHERE variant_id = X AND is_primary = true
2. If found: net_unit_cost = gross_cost × (1 - supplier_discount/100)
   set cost_source = 'supplier_list', cost_layer_id = NULL
3. If not found: net_unit_cost = 0, cost_source = 'none',
   cost_layer_id = NULL
4. Never raise InsufficientCostLayers error
5. Always proceed with sale post

### cost_source migration
Add cost_source varchar nullable to sales.sale_items.
Update SaleItem ORM model and SaleItemOut schema.
Existing rows get cost_source = NULL (pre-policy records).

---

## Future Work

### Cost variance account
A dedicated cost variance account in the AP/GL module to formally
record the difference between assumed and actual COGS. Not required
for current operations — variance report is sufficient for now.

### Promotions engine
Quantity-based pricing (buy X get Y) is a planned feature.
Current promo_price on variants and UOM conversions is a manual
flat override only. The promotions engine will be designed as a
separate module.

### Average cost option
If FIFO proves too complex for certain product categories,
an average cost method may be introduced as an alternative
per product type. Deferred pending operational feedback.