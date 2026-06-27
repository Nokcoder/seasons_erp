# RBAC — Programs & Actions

## Overview
This document defines the DB-driven role-based access control
system replacing the hardcoded ROLE_PERMISSIONS dict in
auth/dependencies.py.

Access control has two layers:
1. Programs — which pages/modules a role can access (page
   visibility and nav gating)
2. Actions — which operations a role can perform within
   those programs (button visibility and API enforcement)

A role must have the program before its actions are relevant.
Actions belong to a specific program — they are not global.

---

## Schema Additions

### auth.programs
- program_id    SERIAL PRIMARY KEY
- program_key   VARCHAR UNIQUE NOT NULL  -- e.g. 'inventory_catalogue'
- display_name  VARCHAR NOT NULL         -- e.g. 'Product Catalogue'
- module        VARCHAR NOT NULL         -- e.g. 'Inventory'
- sort_order    INT NOT NULL DEFAULT 0   -- for UI ordering within module

### auth.actions
- action_id     SERIAL PRIMARY KEY
- action_key    VARCHAR UNIQUE NOT NULL  -- e.g. 'create_transfer'
- display_name  VARCHAR NOT NULL         -- e.g. 'Create Transfer'
- program_id    INT NOT NULL FK → auth.programs(program_id)

### auth.role_programs (junction)
- role_id       INT FK → auth.roles(role_id)
- program_id    INT FK → auth.programs(program_id)
- PRIMARY KEY (role_id, program_id)

### auth.role_actions (junction)
- role_id       INT FK → auth.roles(role_id)
- action_id     INT FK → auth.actions(action_id)
- PRIMARY KEY (role_id, action_id)

---

## Programs & Actions Master List

### Module: Sales

program_key: sales_workstation | display_name: POS Workstation | sort_order: 1
  process_sale            Process Sale
  process_returns         Process Returns
  process_blind_returns   Process Blind Returns
  apply_discount          Apply Discount

program_key: sales_ledger | display_name: Sales Ledger | sort_order: 2
  view_sales_ledger       View Sales Ledger
  export_sales            Export Sales

program_key: sales_returns | display_name: Returns | sort_order: 3
  view_returns            View Returns
  export_returns          Export Returns

### Module: Inventory

program_key: inventory_catalogue | display_name: Product Catalogue | sort_order: 1
  view_inventory          View Inventory
  manage_products         Manage Products
  export_products         Export Products
  import_products         Import Products

### Module: Stock

program_key: stock_transfers | display_name: Stock Transfers | sort_order: 1
  view_transfers          View Transfers
  create_transfer         Create Transfer
  edit_transfer_header    Edit Transfer Header
  receive_transfer        Receive Transfer

program_key: stock_receiving | display_name: Receiving | sort_order: 2
  view_receiving          View Receiving
  create_shipment         Create Shipment
  confirm_shipment        Confirm Shipment

program_key: stock_ledger | display_name: Stock Ledger | sort_order: 3
  view_stock_ledger       View Stock Ledger
  export_stock_ledger     Export Stock Ledger

### Module: Procurement

program_key: procurement_suppliers | display_name: Suppliers | sort_order: 1
  view_suppliers          View Suppliers
  manage_suppliers        Manage Suppliers

program_key: procurement_purchase_orders | display_name: Purchase Orders | sort_order: 2
  view_purchase_orders    View Purchase Orders
  manage_purchase_orders  Manage Purchase Orders

### Module: AP

program_key: ap_invoices | display_name: AP Invoices | sort_order: 1
  view_invoices           View Invoices
  manage_invoices         Manage Invoices

program_key: ap_payments | display_name: AP Payments | sort_order: 2
  view_ap_payments        View AP Payments
  manage_payments         Manage AP Payments

program_key: ap_ledger | display_name: AP Ledger | sort_order: 3
  view_ap_ledger          View AP Ledger
  export_ap_ledger        Export AP Ledger

program_key: ap_aging | display_name: Supplier Aging | sort_order: 4
  view_ap_aging           View Supplier Aging
  export_ap_aging         Export Supplier Aging

### Module: Customers

program_key: customers_list | display_name: Customer List | sort_order: 1
  view_customers          View Customers
  manage_customers        Manage Customers

program_key: customers_aging | display_name: Customer Aging | sort_order: 2
  view_customer_aging     View Customer Aging
  export_customer_aging   Export Customer Aging

program_key: customers_ar_ledger | display_name: AR Ledger | sort_order: 3
  view_ar_ledger          View AR Ledger
  export_ar_ledger        Export AR Ledger

program_key: customers_credit_memo | display_name: Credit Memos | sort_order: 4
  view_credit_memos       View Credit Memos
  issue_credit_memo       Issue Credit Memo
  cancel_credit_memo      Cancel Credit Memo

program_key: customers_pdc_vault | display_name: PDC Vault | sort_order: 5
  view_pdc_vault          View PDC Vault
  manage_pdc              Manage PDC

### Module: Settings

program_key: settings | display_name: Settings | sort_order: 1
  manage_locations        Manage Locations
  manage_shifts           Manage Shifts
  manage_registers        Manage Registers
  manage_payment_modes    Manage Payment Modes
  manage_uoms             Manage UOMs
  manage_categories       Manage Categories
  manage_users            Manage Users & Employees
  manage_roles            Manage Roles & Permissions
  manage_inventory_policy Inventory Policy
  manage_import           Manage Import
  manage_appearance       Manage Appearance
  manage_sales_settings   Manage Sales Settings

---

## Default Role Assignments

Seed on startup. Fully idempotent — INSERT ... ON CONFLICT
DO NOTHING throughout.

### ADMIN
All programs. All actions.

### WAREHOUSE_MANAGER
Programs:
  inventory_catalogue, stock_transfers, stock_receiving,
  stock_ledger, procurement_suppliers,
  procurement_purchase_orders, settings

Actions:
  view_inventory, manage_products, export_products,
  import_products, view_transfers, create_transfer,
  edit_transfer_header, receive_transfer, view_receiving,
  create_shipment, confirm_shipment, view_stock_ledger,
  export_stock_ledger, view_suppliers, manage_suppliers,
  view_purchase_orders, manage_purchase_orders,
  manage_locations, manage_inventory_policy

### WAREHOUSE_STAFF
Programs:
  stock_transfers, stock_receiving, stock_ledger

Actions:
  view_transfers, create_transfer, receive_transfer,
  view_receiving, view_stock_ledger

### ACCOUNTANT
Programs:
  inventory_catalogue, ap_invoices, ap_payments,
  ap_ledger, ap_aging

Actions:
  view_inventory, view_invoices, manage_invoices,
  view_ap_payments, manage_payments, view_ap_ledger,
  export_ap_ledger, view_ap_aging, export_ap_aging

### STORE_MANAGER
Programs:
  sales_workstation, sales_ledger, sales_returns,
  inventory_catalogue, stock_ledger, customers_list,
  customers_aging, customers_ar_ledger,
  customers_credit_memo, customers_pdc_vault, settings

Actions:
  process_sale, process_returns, process_blind_returns,
  apply_discount, view_sales_ledger, export_sales,
  view_returns, export_returns, view_inventory,
  view_stock_ledger, view_customers, manage_customers,
  view_customer_aging, export_customer_aging,
  view_ar_ledger, export_ar_ledger, view_credit_memos,
  issue_credit_memo, cancel_credit_memo, view_pdc_vault,
  manage_pdc, manage_users, manage_roles, manage_shifts,
  manage_registers, manage_payment_modes,
  manage_sales_settings, manage_inventory_policy

### CASHIER
Programs:
  sales_workstation

Actions:
  process_sale, process_returns

---

## Backend Changes

### auth/dependencies.py

1. DELETE the entire ROLE_PERMISSIONS dict.

2. Rewrite require_permission(required_action_key: str):
   - From the current user's roles, query role_actions JOIN
     actions to get the full set of action_keys
   - If required_action_key is in the set → allow
   - Otherwise → HTTP 403
   - Cache the resolved action set on request.state to avoid
     repeated DB hits within the same request

3. Add require_program(required_program_key: str):
   - Same pattern, checks role_programs JOIN programs
   - Primarily for backend enforcement on sensitive routes
   - Frontend handles nav/page gating via the programs API

4. get_current_user() stays exactly as-is. No changes.

5. Audit all router files. Update any old permission string
   passed to require_permission() to its matching new
   action_key from the master list above.

### auth/models.py

Add ORM models:
- Program
- Action (program_id FK → Program)
- RoleProgram (association: role_id, program_id)
- RoleAction (association: role_id, action_id)

Update Role model:
- Add programs relationship via RoleProgram
- Add actions relationship via RoleAction

---

## New API Endpoints

Add to auth/router.py. All require get_current_user.

### Catalogue endpoints (read-only, any authenticated user)

GET /auth/programs
  Returns all programs grouped by module with their actions.
  Response shape:
  [
    {
      module: "Sales",
      programs: [
        {
          program_id, program_key, display_name, sort_order,
          actions: [
            { action_id, action_key, display_name }
          ]
        }
      ]
    }
  ]

GET /auth/actions
  Returns flat list of all actions with their program_key.

### Role permission management (manage_roles action required)

GET /auth/roles/{role_id}/permissions
  Returns:
  {
    program_keys: ["sales_workstation", ...],
    action_keys: ["process_sale", ...]
  }

PUT /auth/roles/{role_id}/permissions
  Body:
  {
    program_keys: ["sales_workstation", ...],
    action_keys: ["process_sale", ...]
  }
  Replaces the full program and action set for the role
  atomically. Validates that all supplied action_keys belong
  to programs in the supplied program_keys list. If an
  action's program is not in program_keys, reject with 422.

---

## Settings UI Changes

Settings → Roles tab gains a permission matrix sub-section.

When a role row is expanded or an Edit button is clicked:

1. Load GET /auth/programs (full catalogue)
2. Load GET /auth/roles/{role_id}/permissions (current state)
3. Render programs grouped by module:
   - Each program has a checkbox (grants/revokes program access)
   - Checking a program expands its actions as sub-checkboxes
   - Unchecking a program auto-unchecks all its actions
   - Checking all actions in a program auto-checks the program
4. Save button calls PUT /auth/roles/{role_id}/permissions
   with the current checkbox state
5. Optimistic update on success, rollback on error

Existing role name management and user-role assignment
sections on the Roles tab remain unchanged.

---

## Enforcement Notes

- Backend: require_permission() enforces action-level access
  on every write and sensitive read endpoint.
- Frontend: programs list from GET /auth/programs drives
  nav item visibility. Items for programs the user's role
  does not hold are hidden, not just disabled.
- The ADMIN role always has all programs and all actions
  by virtue of the seed data. The UI should reflect this.
- When the future auth service (Keycloak/Zitadel) is
  integrated, only get_current_user() changes. The program
  and action tables, the enforcement logic, and the Settings
  UI remain as-is.