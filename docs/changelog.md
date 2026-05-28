# Changelog

## 2026-05-28

### Schema additions
- `procurement.receiving_details`: added `received_at datetime`, `inspected_at datetime`
- `ap.supplier_invoices`: added `amended_amount decimal(15,2)`, `amendment_notes text`
- `inventory.locations`: added `is_system boolean not null default false`

### Business logic — Rule 1: is_default exclusivity on Variant
- `inventory/router.py`: `_enforce_single_default()` already wired into `add_variant` and `update_variant`
- Added guard in `update_variant`: rejects `is_default=false` on the sole default variant
- Added guard in `delete_variant`: rejects soft-delete of the default variant

### Business logic — Rule 2: System location seeding
- `inventory/models.py`: `is_system` column added to `Location`
- `main.py`: `_seed_system_locations()` runs after `create_all`; idempotently creates Quarantine and Adjustment as Virtual/Active/is_system=True
- `inventory/transfers_router.py`: `update_location` rejects any modification to a system location

### Business logic — Rule 3: FIFO cost layer consumption on outbound movements
- `inventory/transfers_router.py`: added `_consume_fifo()` — deducts oldest-first with row-level locking; raises 400 on insufficient layers
- Added `_create_transfer_layers()` — creates matching cost layers at destination, proportionally scaled if actual_in ≠ actual_out
- `create_transfer` now calls both helpers per item inside the same transaction

### Business logic — Rule 4: Bundle explosion on outbound movements
- `inventory/transfers_router.py`: added `_get_bundle_components()` helper
- Extracted per-variant movement logic into `_move_variant()` helper
- `create_transfer` detects bundle variants and explodes each into component movements; `InventoryTransferItem` retains bundle-level quantities for document trail

### Business logic — Rule 5: Soft delete guards on all routers
- `inventory/router.py` `delete_product`: cascades soft-delete to all active child variants
- `inventory/router.py` `add_bundle_component`: validates component variant exists and is not soft-deleted
- `inventory/router.py` `add_variant_supplier`: validates supplier exists and is not soft-deleted
- `inventory/transfers_router.py` `create_transfer`: validates both locations exist, are not deleted, and are Active
- `procurement/router.py` `add_receiving_details`: validates variant and location exist, are not deleted, and location is Active
