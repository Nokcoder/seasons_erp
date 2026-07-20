# Project Instructions

## Session Startup — Read These First

At the start of every session, before doing anything else:

1. Read `/docs/requirements.md` — the authoritative system specification.
2. Read `/docs/schema.dbml` — the current approved database schema.
3. Report that you have read both files before proceeding.
4. Wait for instructions. Do not make any changes until told to.

## General Rules

- Never hard-delete records. Always use `is_deleted = true`.
- Every stock movement must write to both `inventory_ledger` 
  and `current_stocks` in the same transaction.
- Before implementing any feature, state your understanding 
  and wait for confirmation.
- After completing significant changes, update `/docs/changelog.md`.

## Scope

- Current approved scope is v1: Inventory, Procurement, and AP.
- The sales module is not yet designed. Do not implement 
  anything sales-related until a v2 schema is issued.

## Project Overview

Season ERP is a full-stack enterprise resource planning system for retail. It manages inventory, procurement, sales (POS), and stock transfers across multiple locations.

## Running the Application

The entire stack runs via Docker Compose. There is no test suite.

```bash
# Build and start all services
docker-compose up --build

# Start without rebuilding
docker-compose up

# Rebuild a single service
docker-compose up --build backend
```

**Local backend development (without Docker):**
```bash
cd backend
# Activate venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # Linux/Mac

pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Local frontend development (without Docker):**
```bash
cd frontend
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # Production build
npm run lint         # ESLint
```

## Architecture

### Infrastructure

```
Browser → Cloudflare Tunnel → Nginx (port 80) → frontend:80  (React/Nginx)
                                               → backend:8000 (FastAPI/Uvicorn)
```

Nginx strips the `/api/` prefix before forwarding to FastAPI. All frontend API calls use `VITE_API_URL` (defaults to `/api`), so `fetch('/api/products/')` becomes `GET http://backend:8000/products/` inside the Docker network.

The frontend is built as a static Vite bundle served by its own Nginx container. The backend is FastAPI served by Uvicorn. PostgreSQL is the database; `db_data/` is the persistent volume.

### Backend Module Structure

```
backend/
├── main.py               # App entry point; mounts all routers; runs create_all()
├── core/database.py      # SQLAlchemy engine, SessionLocal, Base, get_db()
├── auth/                 # JWT login, user registration, role management
├── inventory/            # Products, variants, stock, transfers, ledger
│   ├── router.py         # Product/variant CRUD, ledger reads
│   └── transfers_router.py  # Stock transfer lifecycle, location management
├── procurement/          # Suppliers, purchase orders, inbound shipments, GRNs
├── sales/                # POS checkout, sales ledger, Excel export
└── settings/             # Registers, shifts, payment methods, location admin
```

Each module follows the same pattern: `models.py` (SQLAlchemy), `schemas.py` (Pydantic), `router.py` (FastAPI endpoints).

### Database Schema Organization

All PostgreSQL schemas are created explicitly at startup in `main.py`:

| Schema | Tables |
|--------|--------|
| `auth` | `users` |
| `inventory` | `products`, `product_variants`, `product_categories`, `locations`, `current_stocks`, `inventory_ledger`, `cost_layers`, `price_history`, `stock_transfers`, `stock_transfer_items`, `suppliers`, `uoms` |
| `procurement` | `purchase_orders`, `purchase_order_items`, `inbound_shipments`, `goods_receipts`, `goods_receipt_items` |
| `sales` | `sales_headers`, `sales_items`, `sales_payments`, `customers`, `pos_settings`, `sales_returns`, `sales_return_items` |
| `settings` | `registers`, `shifts`, `payment_methods` |

SQLAlchemy `Base.metadata.create_all()` auto-creates tables on startup. The Dockerfile also runs `alembic upgrade head` before starting Uvicorn.

### Critical Domain Model: Product → Variant

All financial data and stock levels belong to **ProductVariant**, not Product. Product is metadata-only (name, brand, category, bundle flag). This affects all queries:

- `inventory.current_stocks` tracks `variant_id` + `location_id` → quantity
- `inventory.inventory_ledger` tracks `variant_id` movements
- `inventory.cost_layers` tracks FIFO cost per variant
- Transfers and GRNs reference `variant_id`

**Known inconsistency**: `sales/models.py` `SalesItem` still uses `product_id` (not `variant_id`), and `sales/router.py` `create_sale` deducts stock from `CurrentStock.product_id`. This is a migration gap; the rest of the codebase uses `variant_id`.

### ⚠️ Multi-tenancy landmine: PID/barcode triggers under erp_admin

The app runs as the non-superuser role **`erp_app`**, under which Row-Level Security scopes every query to the caller's tenant (context set per request via `SET LOCAL app.tenant_id` in `get_db`). The two PID/barcode collision triggers (`inventory.check_variant_pid_no_barcode_collision`, `inventory.check_barcode_no_pid_collision`) are `SECURITY INVOKER`, so their global `EXISTS` scans are RLS-scoped too — enforcing **per-tenant** PID/barcode uniqueness under `erp_app`.

**But `erp_admin` (the superuser used for migrations, boot seeds, and signup via `get_admin_db`) BYPASSES RLS.** Any inventory write to `variants`/`variant_barcodes` performed as `erp_admin` makes those triggers scan **all** tenants and **false-positive** — wrongly rejecting a valid per-tenant PID that merely collides with another tenant's barcode. Nothing hits this today (no admin path writes variants/barcodes; imports run on the `erp_app` request path). **Any future admin-side or bulk inventory write path must run as `erp_app`, or `SET app.tenant_id` before writing** — otherwise it will spuriously reject valid PIDs. (Warning is also attached to both functions via `COMMENT ON FUNCTION`.)

### Authentication Flow

1. `POST /auth/login` validates credentials with bcrypt, returns a JWT containing `sub` (username), `id` (user_id), `role`, and `exp`
2. The frontend stores the token at `localStorage.erp_token` and user object at `localStorage.erp_user` (see `AuthContext.tsx`)
3. `AuthContext` provides `{ user, token, login, logout }` globally via React Context

`auth/dependencies.py`'s `get_current_user()` is a **real JWT decoder** — it validates the Bearer token using the `SECRET_KEY` env var, extracts `user_id` from the payload, queries `auth.users` for an active matching record, and raises HTTP 401 on any failure. `require_permission(action_key)` wraps `get_current_user` and additionally resolves the user's full action set from `auth.role_actions`, raising HTTP 403 if the required action is absent. All guarded endpoints enforce both authentication and authorisation on every request.

`SECRET_KEY` is read from the environment variable of the same name (`dependencies.py:11`). The backend refuses to start if it is unset. Set it in `.env` before running.

### Frontend Architecture

All TypeScript interfaces and API fetch functions live in `frontend/src/services/api.ts`. This is the single source of truth for the API contract.

Route-level code splitting is done with `React.lazy()` in `App.tsx`. All routes behind `ProtectedRoute` require a valid `erp_token` in localStorage.

The `Can` component (`components/Can.tsx`) is available for role-based UI rendering, though the backend permission system is not fully enforced yet.

## Environment Variables

Create a `.env` file in the project root:

```env
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=db                    # 'db' for Docker; 'localhost' for local dev
DB_PORT=5432
DB_NAME=your_db_name
ALLOWED_ORIGINS=http://localhost:5173,https://yourdomain.com
```

The backend reads this via `python-dotenv`. The frontend only uses `VITE_API_URL` (set to `/api` in `docker-compose.yml`).

## Key API Routes

| Prefix | Module |
|--------|--------|
| `/auth` | Auth (login, register, users) |
| `/products` | Inventory (products, variants, ledger) |
| `/transfers` | Stock transfers and locations |
| `/procurement` | Suppliers, POs, shipments, GRNs |
| `/sales` | POS checkout and sales dashboard |
| `/settings` | Registers, shifts, payment methods, locations |

Nginx routes `/api/*` → FastAPI root, so `/api/products/` maps to FastAPI's `/products/`.



Do not run any git commands. Never stage, commit, or push. All version control is handled manually.

## Deployment

- Frontend changes only reach the Cloudflare tunnel via:
  `docker compose up --build -d frontend`
- A plain `docker compose up -d frontend` only recreates the container
  from whatever image already exists — it does NOT recompile source. This
  caused a real bug once (stale pre-fix bundle served for hours) — always
  use `--build` after any frontend source change intended for the tunnel.
- Vite dev server (`npm run dev`) runs on port 8080 (`vite.config.ts` pins
  `server.port: 8080`, `strictPort: true`).

## Storage architecture

- All persistent client-side storage (auth tokens, print templates, print
  settings) goes through `frontend/src/lib/platformStore.ts`'s `getStore()`
  function — NEVER import `@tauri-apps/plugin-store` directly anywhere.
  Direct imports crash with "Cannot read properties of undefined (reading
  'invoke')" in a plain browser tab, since that package requires Tauri's
  IPC bridge which doesn't exist outside the Tauri webview.
- `platformStore.ts` detects environment via `isTauri()` from
  `@tauri-apps/api/core` and picks a real Tauri store or a localStorage
  fallback automatically — callers never need environment-specific code.

## RBAC / permissions

- `backend/main.py`'s `_seed_programs_and_actions()` (seeds the
  Program/Action catalog) runs on EVERY backend startup and is idempotent
  (`ON CONFLICT DO NOTHING`) — safe to restart freely for this.
- `tenancy/rbac_seed.py`'s ADMIN wildcard grant (attaching every action to
  the ADMIN role) only runs ONCE, at tenant creation (`POST /tenants`) — it
  does NOT re-run on backend restart. A newly added `action_key` will NOT
  automatically appear on existing ADMIN roles. Must be manually granted
  via Settings → Roles → ADMIN → Permissions after adding any new action.

## Print module architecture

- Templates are named, saved designs in a library
  (`frontend/src/print/designer/useTemplateLibrary.js`) — NOT tied directly
  to a document type in code.
- "Functions" (`frontend/src/print/designer/useFunctionAssignments.js`) are
  named trigger points (currently only `'salesReceipt'`) mapped to whichever
  template is currently assigned. Adding a new function (e.g. a kitchen
  ticket) means adding an entry to `KNOWN_FUNCTIONS`, not a redesign.
- Access gated behind the `'manage_print_templates'` permission, under
  Settings → Print Templates.
