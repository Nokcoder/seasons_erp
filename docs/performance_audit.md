I'll do a thorough read of all the relevant files. Let me pull them in parallel.

  Searched for 2 patterns, read 3 files

Now let me read the POS catalog endpoint and the key sales endpoints.

  Read 3 files

Now let me look at the sales ledger, AR aging, customer detail, and query client config.

  Searched for 1 pattern, read 3 files

Now let me read the sales list endpoint and the AR aging endpoint.

  Searched for 1 pattern, read 1 file

Let me check a few final areas — the _attach_overdue_flags function, post_draft's overhead, and the alembic migration for indexes.

  Searched for 3 patterns, read 2 files

I have everything I need. Here is the full audit.

---
Performance Audit Report

---
1. Database Queries

---
[HIGH] list_sales loads all records before paginating — router.py:1580–1664

all_sales = q.all()   # loads everything — no DB-level limit
# ...
page = combined[:limit]
next_cursor = None    # intentionally broken — commented out

The endpoint fetches every matching sale and every matching return, merges them in Python, sorts in Python, then discards everything past limit. With 5,000+ sales this degrades badly. Cursor-based pagination is stubbed out (next_cursor = None on every response). The totals row also iterates the full merged list in Python.

Fix: Apply LIMIT and OFFSET/cursor at the DB level for the sales query. Compute the totals via a separate aggregation query (two cheap SQL queries) rather than iterating a Python list. Returns either get their own paginated endpoint or are excluded from the main list and shown separately.

---
[HIGH] post_draft N+1 queries inside the item loop — router.py:1218–1326

For every line item in the cart, three separate DB round trips fire:

1. db.query(Variant).filter(variant_id == ...).first() — one per item
2. db.query(CurrentStock).filter_by(...) — one per item inside _consume_fifo_for_sale
3. db.query(CostLayer).filter(...).with_for_update() — one per item

For a 10-item sale: 30+ sequential queries in the critical path transaction. Bundle items add more (one per component). VariantSupplier fallback adds another round trip per uncovered item.

Fix: Before the loop, batch-load all variants with their product in one IN query; batch-load all CurrentStock rows for the relevant (variant_id, location_id) pairs. Only the cost layer query needs to be in the loop (it holds a row lock for FIFO correctness).

---
[HIGH] AR aging does a full table scan on ar_ledger — router.py:382–396

ar_sale_rows = (
    db.query(models.ArLedger.reference_id, models.ArLedger.amount_change)
    .filter(models.ArLedger.reason == "SALE", models.ArLedger.reference_type == "sales")
    .all()          # no customer_id filter — reads entire history
)

This loads every SALE entry from ar_ledger for all customers, all time. At 50 sales/day over a year, that's ~18,000 rows. Over two years with returns and payments it's 50,000+ rows. The customer filter happens in Python afterward.

Fix: Add .filter(models.ArLedger.customer_id.in_(customer_ids)) before .all(). Also add an index on (customer_id, reason) on ar_ledger.

---
[HIGH] Missing indexes on the most-queried columns

The migration creates almost no secondary indexes beyond PKs and unique constraints. Key gaps:

┌────────────────────────────────┬────────────────────────────────────────┬────────────────────────────────────────────┐
│             Table              │             Missing Index              │                  Used By                   │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.sales                    │ (transaction_date DESC, sale_id DESC)  │ list_sales sort order                      │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.sales                    │ customer_id                            │ customer detail, AR aging joins            │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.sales                    │ status                                 │ every sales query                          │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.sale_items               │ sale_id                                │ every items query                          │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.sale_items               │ cost_source                            │ has_uncosted filter, summary               │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.ar_ledger                │ (customer_id, reason)                  │ AR aging, customer AR ledger               │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ inventory.cost_layers          │ (variant_id, location_id, created_at)  │ every FIFO consumption — oldest-first sort │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ inventory.inventory_ledger     │ (reference_type, reference_id, reason) │ void_sale reversal query                   │
├────────────────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┤
│ sales.customer_payment_applied │ sale_id                                │ AR aging offset calculation                │
└────────────────────────────────┴────────────────────────────────────────┴────────────────────────────────────────────┘

Without the cost_layers index, every FIFO consumption does a sequential scan ordered by created_at, which is the inner loop of every sale post.

---
[MEDIUM] _do_return N+1: one variant query per returned item — router.py:2197–2203

for v in validated:
    variant_obj = (
        db.query(inv_models.Variant)
        .options(selectinload(inv_models.Variant.product))
        .filter(inv_models.Variant.variant_id == v["variant_id"])
        .first()
    )

One variant+product query per return line. For a 5-item return: 5 queries. Fix: batch-load before the loop.

---
[MEDIUM] list_returns N+1 via _attach_exchange — router.py:2390–2392

for ret in rows:
    _attach_exchange(ret, db)   # one Sale query per return row

_attach_exchange fires db.query(Sale).filter(Sale.origin_sale_id == ret.sale_id) for every row in the page. For 100 returns, 100 queries. Fix: batch the lookup: one query for all origin_sale_id values in the result set, then map back.

---
[MEDIUM] get_sales_summary passes a Python list as IN — router.py:2476–2510

base_sale_ids = [r.sale_id for r in base_q.all()]
# then used in 4+ subsequent queries:
.filter(models.SaleItem.sale_id.in_(base_sale_ids))

If the filter window contains 5,000 sales, every subsequent query sends IN (1, 2, 3, ... 5000) as a parameter list. PostgreSQL handles this but it generates large query plans. Fix: use a CTE or subquery:
base_sq = base_q.subquery()
.filter(models.SaleItem.sale_id.in_(base_sq))

---
[LOW] _get_allow_negative_stock fires one query per sale post — router.py:23–25, 1103

def _get_allow_negative_stock(db: Session) -> bool:
    row = db.query(SystemSetting).filter_by(key="allow_negative_stock").first()

Called at the start of every post_draft. The setting almost never changes. Fix: a module-level TTL cache (e.g. functools.lru_cache with a manual invalidation on PATCH /settings/inventory-policy) would eliminate this.

---
[LOW] Debug print() statements in production AR aging — router.py:368, 393, 409

Three print(f"[AGING DEBUG]...") statements are live in the AR aging endpoint. Every aging request writes to stdout. Not a bottleneck but should be removed.

---
2. Heavy Endpoints

┌───────────────────────────┬───────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
│         Endpoint          │                            Why it's heavy                             │                     Recommended mitigation                     │
├───────────────────────────┼───────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ GET /sales/               │ Full table load + Python sort + truncation                            │ DB-level cursor pagination; separate totals aggregate query    │
├───────────────────────────┼───────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ GET /sales/summary        │ 8 separate queries + Python list as IN                                │ Use CTEs/subqueries; add indexes on sale_items.cost_source     │
├───────────────────────────┼───────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ POST /drafts/{id}/post    │ N+1 per item + row-locked FIFO query per item + AR write              │ Pre-fetch variants & stock; only keep cost layer query in loop │
├───────────────────────────┼───────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ GET /customers/aging      │ Full ar_ledger table scan                                             │ Filter by customer_id.in_() + index on (customer_id, reason)   │
├───────────────────────────┼───────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ GET /products/pos-catalog │ Entire catalog + all stock rows loaded, partially discarded in Python │ DB-level filters on variants/stock; longer stale time          │
└───────────────────────────┴───────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘

---
3. SQLAlchemy Usage

---
[MEDIUM] InventoryLedger has lazy="joined" — models.py:327–328

variant  = relationship("Variant",  foreign_keys=[variant_id],  lazy="joined")
location = relationship("Location", foreign_keys=[location_id], lazy="joined")

lazy="joined" means every query against InventoryLedger always emits a JOIN to variants and locations, even when neither is needed. The void_sale reversal (router.py:1720–1728) queries ledger rows purely to get variant_id and location_id scalars — it's doing a 3-table join for two integer columns.

Fix: Change to lazy="select" (default). The one place that needs the related data (ledger display) already uses selectinload or can add it explicitly.

---
[MEDIUM] POS catalog filters variants and stock in Python — router.py:406–421

active_variants = [v for v in product.variants if not v.is_deleted]
# ...
non_virtual_stock = [cs for cs in v.current_stock
                     if cs.location and cs.location.location_type != "Virtual"]

All variants (including deleted ones) and all stock entries (including virtual locations) are fetched from the DB, then discarded in Python. Wastes DB bandwidth, object construction, and serialization.

Fix: Use selectinload with join conditions:
selectinload(Product.variants.and_(Variant.is_deleted == False))
selectinload(Variant.current_stock).selectinload(CurrentStock.location.and_(
    Location.location_type != "Virtual"
))

---
[LOW] InventoryTransferItem.variant uses default lazy loading — models.py:305

variant = relationship("Variant", lazy="select")

If transfer items are ever iterated without an explicit selectinload, each item triggers a separate variant query. The transfers router appears to handle this but it's fragile.

---
4. Frontend

---
[MEDIUM] POS catalog uses stale.transactional (30-second staleness) — Workstation.tsx:120

{ queryKey: qk.posCatalog(), queryFn: inventoryApi.posCatalog, ...stale.transactional }
//                                                               ^^^^^^^^^^^^^^^^^^^
// staleTime: 30s, refetchOnWindowFocus: true

stale.transactional is intended for live sale data. The catalog changes only when inventory is received or products are modified — events that happen on a different page, not during active selling. Using refetchOnWindowFocus: true on the largest payload in the app means every time the cashier switches windows (common when taking phone calls, checking another tab), the full catalog re-fetches.

Fix: Use stale.reference (10 min stale time) for the catalog. Even better: use staleTime: Infinity and manually invalidate qk.posCatalog() after a stock receive or product update event (currently not done because the workstation and the inventory pages are separate browser sessions anyway).

---
[MEDIUM] Default staleTime of 0 with global refetchOnWindowFocus: true — queryClient.ts:9–13

defaultOptions: {
  queries: {
    retry: 1,
    refetchOnWindowFocus: true,   // global default
    // no staleTime → defaults to 0 (always stale)
  },
}

Any query that doesn't explicitly spread ...stale.reference or ...stale.transactional is staleTime: 0 and will refetch on every window focus event. This is an easy configuration drift — if a developer adds a useQuery without stale options, they get aggressive background refetching silently.

Fix: Set a sensible default staleTime: 30_000 at the global level.

---
[LOW] Catalog search is O(n) per keystroke — Workstation.tsx:272–289

const searchResults = useMemo(() => {
    for (const item of catalog) {          // N products
      for (const v of item.variants) {     // M variants each
        const hit = item.product_brand.includes(q) || v.variant_name.includes(q) || ...

Every character typed re-scans the full catalog. useMemo avoids re-renders but not the computation. For 200 products × 3 variants = 600 iterations per keystroke — acceptable today. At 2,000+ variants this becomes noticeable.

Fix (when catalog grows): Pre-build a flat variant_id → searchable string map once when the catalog loads, and search the flat map.

---
[LOW] Draft list fetched outside React Query — Workstation.tsx:317–326

const refreshDrafts = useCallback(async (locationId?: string) => {
    const list = await salesApi.drafts.list(...)
    setDrafts(list.slice(0, 5))
  }, [header.locationId])

The draft list is managed with a raw fetch + useState, bypassing React Query's cache. The useCallback dependency on header.locationId causes a new function reference on every location change, which triggers the useEffect to re-fetch. If a user tabs through locations quickly, multiple concurrent requests fire. Not harmful but inconsistent with the rest of the codebase.

---
5. POS Catalog Specifically

Payload size estimate:

For a mid-sized business (500 active variants across 200 products):
- Each variant: PID, name, price, promo, attributes + 2 barcodes + 3 stock entries + 1 UOM conversion
- Rough per-variant JSON: ~500–700 bytes
- Total uncompressed: ~300–400KB; gzip: ~60–80KB — acceptable

For a larger business (2,000+ variants):
- Total uncompressed: ~1.2–1.6MB; gzip: ~240–320KB — noticeably heavy

Structural issues specific to this endpoint:

1. No HTTP caching headers. No ETag, Last-Modified, or Cache-Control is set. The browser cannot use a conditional GET (If-None-Match), so every fetch is a full response even if nothing changed. Adding an ETag based on MAX(current_stocks.last_updated) across active variants would allow the client to skip the full payload on unchanged catalogs.
2. Virtual location stock loaded and discarded. All current_stock rows are eagerly loaded (including virtual locations), then filtered in Python. A business with 3 physical + 2 virtual locations loads 40% more stock rows than needed.
3. Deleted variants loaded and discarded. Same as above — all variants are loaded, then [v for v in product.variants if not v.is_deleted] runs in Python.
4. Stale time too short for the payload size. At stale.transactional (30 seconds), a typical 8-hour shift with an active cashier could trigger 100+ full catalog fetches. The catalog only changes when someone on a different page receives stock or modifies a product. It should be treated as reference data.

Recommended fixes, in priority order:

1. Add DB-level filters for is_deleted and location_type != 'Virtual' (removes wasted data transfer)
2. Change stale time to stale.reference or staleTime: Infinity (removes the 30-second refetch loop)
3. Add ETag response header (enables conditional GET, eliminates re-transfer when catalog is unchanged)
4. Add indexes on cost_layers.(variant_id, location_id, created_at) and sale_items.sale_id (benefits the sale post that runs alongside every catalog-visible sale)

---
Priority Summary

┌─────┬──────────────────────────────────────────────────┬────────┬───────────────────────┐
│  #  │                      Issue                       │ Impact │       Location        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 1   │ list_sales loads all records then truncates      │ High   │ router.py:1580        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 2   │ post_draft N+1 per line item                     │ High   │ router.py:1218        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 3   │ Missing indexes on sales, cost_layers, ar_ledger │ High   │ Migration             │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 4   │ AR aging full table scan of ar_ledger            │ High   │ router.py:382         │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 5   │ POS catalog Python-level filtering               │ Medium │ router.py:406         │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 6   │ _do_return N+1 per item                          │ Medium │ router.py:2197        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 7   │ list_returns N+1 via _attach_exchange            │ Medium │ router.py:2390        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 8   │ Summary endpoint Python list as IN               │ Medium │ router.py:2476        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 9   │ InventoryLedger forced JOIN on every query       │ Medium │ models.py:327         │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 10  │ POS catalog stale time too short                 │ Medium │ Workstation.tsx:120   │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 11  │ No ETag on POS catalog                           │ Medium │ router.py:372         │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 12  │ Debug prints in AR aging                         │ Low    │ router.py:368,393,409 │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 13  │ allow_negative_stock query per post              │ Low    │ router.py:1103        │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 14  │ Catalog search O(n) per keystroke                │ Low    │ Workstation.tsx:272   │
├─────┼──────────────────────────────────────────────────┼────────┼───────────────────────┤
│ 15  │ Draft list outside React Query                   │ Low    │ Workstation.tsx:317   │
└─────┴──────────────────────────────────────────────────┴────────┴───────────────────────┘

✻ Cogitated for 5m 42s