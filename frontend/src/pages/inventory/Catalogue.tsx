import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import KeywordSearch from '../../components/KeywordSearch'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  catalogueApi, inventoryApi,
  type InvProduct, type InvVariant, type Location, type Category, type InvSupplier, type UOM,
} from '../../services/api'
import * as XLSX from 'xlsx'
import { normalize } from '../../lib/normalize'

// ── helpers ───────────────────────────────────────────────────────────────────

const CAN_EDIT = ['ADMIN', 'STORE_MANAGER', 'WAREHOUSE_MANAGER']

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function physicalStock(v: InvVariant): number {
  return v.current_stock.filter(s => s.location.location_type !== 'Virtual')
    .reduce((sum, s) => sum + Number(s.quantity), 0)
}
function stockAtLoc(v: InvVariant, locId: number): number {
  return Number(v.current_stock.find(s => s.location.location_id === locId)?.quantity ?? 0)
}

// ── UOM stock breakdown ───────────────────────────────────────────────────────

interface UomCount { code: string; count: number }

function uomBreakdown(v: InvVariant, baseStock: number, uomMap: Map<number, string>): UomCount[] {
  return (v.uom_conversions ?? [])
    .filter(c => c.price != null && Number(c.factor) > 0)
    .map(c => ({
      code:  uomMap.get(c.from_uom_id) ?? `UOM-${c.from_uom_id}`,
      count: Math.floor(baseStock / Number(c.factor)),
    }))
    .filter(x => x.count >= 1)
}

function UomStockCell({
  baseStock,
  variant,
  uomMap,
  className = '',
}: {
  baseStock: number
  variant: InvVariant
  uomMap: Map<number, string>
  className?: string
}) {
  const breakdown = uomBreakdown(variant, baseStock, uomMap)

  if (breakdown.length === 0) {
    return <span className={className}>{baseStock.toFixed(0)}</span>
  }

  return (
    <span className={`relative group/stock inline-block ${className}`}>
      {/* Primary value — dotted underline signals expandable info */}
      <span className="cursor-help underline decoration-dotted decoration-gray-600 underline-offset-2">
        {baseStock.toFixed(0)}
      </span>

      {/* Tooltip — shows on hover, positioned above the cell */}
      <span className={[
        'pointer-events-none invisible group-hover/stock:visible',
        'absolute right-0 bottom-full mb-1.5 z-30',
        'bg-gray-900 border border-gray-700 rounded-md shadow-xl',
        'px-2.5 py-2 min-w-[120px]',
        'text-[10px] text-left whitespace-nowrap',
      ].join(' ')}>
        <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">
          Sellable packs
        </p>
        {breakdown.map(b => (
          <div key={b.code} className="flex items-center justify-between gap-4 mb-0.5">
            <span className="text-gray-400">{b.code}</span>
            <span className="tabular-nums font-semibold text-gray-200">{b.count}</span>
          </div>
        ))}
      </span>
    </span>
  )
}

// ── bundle stock helpers ──────────────────────────────────────────────────────

function bundleTotalStock(v: InvVariant): number {
  return (v.bundle_available_stock ?? []).reduce((s, e) => s + e.available, 0)
}
function bundleStockAtLoc(v: InvVariant, locId: number): number {
  return v.bundle_available_stock?.find(e => e.location_id === locId)?.available ?? 0
}

function BundleStockCell({ available }: { available: number }) {
  return (
    <span className="relative group/bstock inline-block">
      <span className={[
        'cursor-help tabular-nums',
        'underline decoration-dotted decoration-amber-600/60 underline-offset-2',
        available > 0 ? 'text-amber-400' : 't-text-4',
      ].join(' ')}>
        ~{available}
      </span>
      <span className={[
        'pointer-events-none invisible group-hover/bstock:visible',
        'absolute right-0 bottom-full mb-1.5 z-30',
        'bg-gray-900 border border-gray-700 rounded-md shadow-xl',
        'px-2.5 py-2 min-w-[180px] text-[10px] text-left whitespace-normal',
      ].join(' ')}>
        <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">
          Computed stock
        </p>
        <p className="text-gray-400 leading-relaxed">
          Available bundles derived from component stock.<br />
          Not physical inventory of this variant.
        </p>
      </span>
    </span>
  )
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Row {
  product:    InvProduct
  variant:    InvVariant
  primaryCat: string
  totalStock: number
  isBundle:   boolean
}

function buildRows(products: InvProduct[]): Row[] {
  const rows: Row[] = []
  for (const p of products)
    for (const v of p.variants)
      if (!v.is_deleted) {
        const isBundle = v.bundle_components && v.bundle_components.length > 0
        const totalStock = isBundle ? bundleTotalStock(v) : physicalStock(v)
        rows.push({ product: p, variant: v, primaryCat: p.categories[0]?.category_name ?? '—', totalStock, isBundle })
      }
  return rows
}

// ── column-picker state (persisted to localStorage) ───────────────────────────

const COL_STORAGE_KEY = 'erp_catalogue_cols'

interface ColVis {
  sku:        boolean
  type:       boolean
  category:   boolean
  price:      boolean
  promo:      boolean
  totalStock: boolean
  status:     boolean
  locIds:     number[]
}
const COL_DEFAULTS: ColVis = {
  sku: false, type: true, category: true, price: true, promo: true,
  totalStock: true, status: true, locIds: [],
}
function loadCols(): ColVis {
  try { return { ...COL_DEFAULTS, ...JSON.parse(localStorage.getItem(COL_STORAGE_KEY) ?? '{}') } }
  catch { return COL_DEFAULTS }
}
function saveCols(c: ColVis) {
  localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(c))
}

// ── sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'brand' | 'variant_name' | 'PID' | 'sku' | 'category' | 'totalStock' | `loc_${number}`
interface SortState { key: SortKey; dir: 'asc' | 'desc' }

function sortRows(rows: Row[], sort: SortState | null): Row[] {
  if (!sort) return rows
  const { key, dir } = sort
  return [...rows].sort((a, b) => {
    if (key === 'totalStock') {
      const diff = a.totalStock - b.totalStock
      return dir === 'asc' ? diff : -diff
    }
    if ((key as string).startsWith('loc_')) {
      const locId = parseInt((key as string).slice(4))
      const diff = stockAtLoc(a.variant, locId) - stockAtLoc(b.variant, locId)
      return dir === 'asc' ? diff : -diff
    }
    let av = '', bv = ''
    if (key === 'brand')             { av = a.product.brand;        bv = b.product.brand }
    else if (key === 'variant_name') { av = a.variant.variant_name; bv = b.variant.variant_name }
    else if (key === 'PID')          { av = a.variant.PID;          bv = b.variant.PID }
    else if (key === 'sku')          { av = a.variant.sku ?? '';    bv = b.variant.sku ?? '' }
    else if (key === 'category')     { av = a.primaryCat;           bv = b.primaryCat }
    const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' })
    return dir === 'asc' ? cmp : -cmp
  })
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Catalogue() {
  const navigate   = useNavigate()
  const { user }          = useAuth()
  const canEdit           = user?.roles.some(r => CAN_EDIT.includes(r)) ?? false
  const canManageProducts = user?.action_keys.includes('manage_products') ?? false
  const [searchParams, setSearchParams] = useSearchParams()

  // ── React Query ─────────────────────────────────────────────────────────────
  const results = useQueries({
    queries: [
      { queryKey: qk.products(),   queryFn: () => catalogueApi.products.list(),   ...stale.transactional },
      { queryKey: qk.locations(),  queryFn: () => inventoryApi.locations.all(),   ...stale.reference },
      { queryKey: qk.categories(), queryFn: () => catalogueApi.categories.list(), ...stale.reference },
      { queryKey: qk.suppliers(),  queryFn: () => catalogueApi.suppliers.list(),  ...stale.reference },
      { queryKey: qk.uoms(),       queryFn: () => catalogueApi.uoms.list(),       ...stale.reference },
    ],
  })
  const [qProds, qLocs, qCats, qSups, qUoms] = results
  const products   = qProds.data ?? []
  const locations  = (qLocs.data  ?? []).filter(l => l.status === 'Active')
  const categories = (qCats.data  ?? []).filter(c => !c.is_deleted)
  const suppliers  = (qSups.data  ?? []).filter(s => !s.is_deleted)
  const uomMap     = useMemo(() => {
    const m = new Map<number, string>()
    for (const u of ((qUoms.data ?? []) as UOM[])) m.set(u.uom_id, u.uom_code)
    return m
  }, [qUoms.data])
  const loading    = results.some(r => r.isLoading)
  const fetching   = results.some(r => r.isFetching && !r.isLoading)

  // ── keyword search ────────────────────────────────────────────────────────
  const [searchTags, setSearchTags] = useState<string[]>(() => searchParams.getAll('kw'))
  const [liveInput,  setLiveInput]  = useState('')
  const handleTagsChange = useCallback((tags: string[]) => {
    setSearchTags(tags)
    const p = new URLSearchParams()
    tags.forEach(t => p.append('kw', t))
    setSearchParams(p, { replace: true })
  }, [setSearchParams])
  const handlePartialChange = useCallback((v: string) => setLiveInput(v), [])

  // ── other filters ─────────────────────────────────────────────────────────
  const [catFilter,      setCatFilter]      = useState<number | ''>('')
  const [typeFilter,     setTypeFilter]     = useState<Set<string>>(new Set())
  const [statusFilter,   setStatusFilter]   = useState<'Active' | 'Inactive' | 'Both'>('Active')
  const [supFilter,      setSupFilter]      = useState<number | ''>('')
  const [attrFilters,    setAttrFilters]    = useState<Record<string, string>>({})
  const [negativeStock,  setNegativeStock]  = useState(false)

  // ── pagination ────────────────────────────────────────────────────────────
  const ROWS_PER_PAGE_OPTIONS = [10, 30, 50, 100, 500] as const
  const [pageSize, setPageSize] = useState(50)
  const [page,     setPage]     = useState(1)

  // ── column visibility ─────────────────────────────────────────────────────
  const [cols,       setCols]      = useState<ColVis>(loadCols)
  const [pickerOpen, setPickerOpen]= useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  function updateCols(patch: Partial<ColVis>) {
    setCols(prev => { const next = { ...prev, ...patch }; saveCols(next); return next })
  }
  function toggleLoc(id: number) {
    setCols(prev => {
      const ids = prev.locIds.includes(id) ? prev.locIds.filter(x => x !== id) : [...prev.locIds, id]
      const next = { ...prev, locIds: ids }; saveCols(next); return next
    })
  }

  // ── sort ──────────────────────────────────────────────────────────────────
  const [sort, setSort] = useState<SortState | null>(null)
  function handleSort(key: SortKey) {
    setSort(prev => prev?.key === key
      ? prev.dir === 'asc' ? { key, dir: 'desc' } : null
      : { key, dir: 'asc' }
    )
  }
  function sortIcon(key: SortKey) {
    if (sort?.key !== key) return ' ↕'
    return sort.dir === 'asc' ? ' ↑' : ' ↓'
  }

  // ── export modal ──────────────────────────────────────────────────────────
  const [exportOpen,    setExportOpen]    = useState(false)
  const [extraCost,     setExtraCost]     = useState(false)
  const [extraSupplier, setExtraSupplier] = useState(false)
  const [extraAttrs,    setExtraAttrs]    = useState(false)
  const [extraBarcodes, setExtraBarcodes] = useState(false)

  // ── unique attribute keys ─────────────────────────────────────────────────
  const attrKeys = useMemo(() => {
    const keys = new Set<string>()
    products.forEach(p => p.variants.forEach(v => {
      if (v.attributes) Object.keys(v.attributes).forEach(k => keys.add(k))
    }))
    return Array.from(keys).sort()
  }, [products])

  // ── filtered + sorted rows ────────────────────────────────────────────────
  const allRows = useMemo(() => buildRows(products), [products])

  const filteredRows = useMemo(() => {
    const allTerms = [
      ...searchTags.map(t => normalize(t)),
      ...(liveInput.trim() ? [normalize(liveInput)] : []),
    ]
    const base = allRows.filter(({ product: p, variant: v }) => {
      if (statusFilter !== 'Both' && p.status !== statusFilter) return false
      if (allTerms.length > 0) {
        const hit = (term: string) =>
          normalize(p.brand).includes(term)
          || normalize(v.variant_name).includes(term)
          || normalize(v.PID).includes(term)
          || normalize(v.sku ?? '').includes(term)
          || v.barcodes.some(b => normalize(b.barcode).includes(term))
          || p.categories.some(c => normalize(c.category_name).includes(term))
        if (!allTerms.every(hit)) return false
      }
      if (catFilter !== '' && !p.categories.some(c => c.category_id === catFilter)) return false
      if (typeFilter.size > 0 && !typeFilter.has(p.product_type)) return false
      if (supFilter  !== '' && !v.suppliers.some(s => s.supplier.supplier_id === supFilter)) return false
      for (const [key, val] of Object.entries(attrFilters)) {
        if (!val.trim()) continue
        if (!String(v.attributes?.[key] ?? '').toLowerCase().includes(val.trim().toLowerCase())) return false
      }
      if (negativeStock && !v.current_stock.some(
        s => s.location.location_type !== 'Virtual' && Number(s.quantity) < 0
      )) return false
      return true
    })
    return sortRows(base, sort)
  }, [allRows, searchTags, liveInput, catFilter, typeFilter, statusFilter, supFilter, attrFilters, negativeStock, sort])

  // ── pagination over filtered rows ─────────────────────────────────────────
  useEffect(() => { setPage(1) }, [filteredRows, pageSize])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const pagedRows  = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize]
  )

  // ── derived location lists ────────────────────────────────────────────────
  const physLocs    = locations.filter(l => l.location_type !== 'Virtual')
  const virtLocs    = locations.filter(l => l.location_type === 'Virtual')
  const selectedLocs= locations.filter(l => cols.locIds.includes(l.location_id))

  // ── export ────────────────────────────────────────────────────────────────
  function handleExport() {
    const data = filteredRows.map(({ product: p, variant: v }) => {
      const row: Record<string, unknown> = {
        Brand: p.brand, 'Variant Name': v.variant_name, PID: v.PID,
        SKU: v.sku ?? '', 'Product Type': p.product_type,
        Category: p.categories[0]?.category_name ?? '',
        Price: v.price, 'Promo Price': v.promo_price ?? '',
        'Total Stock': physicalStock(v), Status: p.status,
      }
      selectedLocs.forEach(l => { row[l.location_name] = stockAtLoc(v, l.location_id) })
      if (extraCost && v.cost_layers.length) {
        row['Net Unit Cost'] = v.cost_layers[0].net_unit_cost; row['FIFO Layers'] = v.cost_layers.length
      }
      if (extraSupplier && v.suppliers.length) {
        const ps = v.suppliers.find(s => s.is_primary) ?? v.suppliers[0]
        row['Primary Supplier'] = ps.supplier.supplier_name; row['Supplier SKU'] = ps.supplier_sku ?? ''
        row['Gross Cost'] = ps.gross_cost ?? ''; row['Supplier Discount %'] = ps.supplier_discount
      }
      if (extraAttrs) attrKeys.forEach(k => { row[`Attr: ${k}`] = v.attributes?.[k] ?? '' })
      if (extraBarcodes) row['Barcodes'] = v.barcodes.map(b => b.barcode).join(', ')
      return row
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory')
    XLSX.writeFile(wb, `inventory_${new Date().toISOString().slice(0, 10)}.xlsx`)
    setExportOpen(false)
  }

  // ── theme-aware shared classes ────────────────────────────────────────────
  const inputCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
  const labelCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'

  // ── sortable header cell — bolder than data rows ─────────────────────────
  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => handleSort(k)}
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap cursor-pointer hover:t-text-1 select-none ${right ? 'text-right' : 'text-left'}`}>
      {label}{sortIcon(k)}
    </th>
  )

  const PERMANENT_COLS = 3
  const toggleableCols = (cols.sku ? 1 : 0) + (cols.type ? 1 : 0) + (cols.category ? 1 : 0)
    + (cols.price ? 1 : 0) + (cols.promo ? 1 : 0) + (cols.totalStock ? 1 : 0) + (cols.status ? 1 : 0)
  const totalCols = PERMANENT_COLS + toggleableCols + selectedLocs.length + 1

  return (
    <div className="h-full flex overflow-hidden t-bg-base">
      <FetchingBar show={fetching} />

      {/* ── FILTER PANEL ── */}
      <aside className="w-60 shrink-0 flex flex-col border-r t-border t-bg-surface overflow-y-auto p-3 gap-4">
        <div>
          <label className={labelCls}>Keyword</label>
          <KeywordSearch tags={searchTags} onTagsChange={handleTagsChange}
            onPartialChange={handlePartialChange}
            placeholder="Brand, name, PID, SKU, barcode…" />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select className={inputCls} value={catFilter}
            onChange={e => setCatFilter(e.target.value ? parseInt(e.target.value) : '')}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Product Type</label>
          {(['Inventory', 'Non-Inventory', 'Service'] as const).map(t => (
            <label key={t} className="flex items-center gap-2 text-xs t-text-2 mb-1 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]"
                checked={typeFilter.has(t)}
                onChange={() => setTypeFilter(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })} />
              {t}
            </label>
          ))}
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <div className="flex rounded overflow-hidden border t-border-strong text-[11px]">
            {(['Active', 'Both', 'Inactive'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`flex-1 py-1 transition-colors ${statusFilter === s ? 'text-white' : 't-text-2 hover:t-bg-elevated'}`}
                style={statusFilter === s ? { backgroundColor: 'var(--accent)' } : undefined}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Negative Stock</label>
          <label className="flex items-center gap-2 text-xs t-text-2 cursor-pointer mt-1">
            <input type="checkbox" className="accent-[var(--accent)]"
              checked={negativeStock}
              onChange={e => setNegativeStock(e.target.checked)} />
            Show negative stock only
          </label>
        </div>
        <div>
          <label className={labelCls}>Supplier</label>
          <select className={inputCls} value={supFilter}
            onChange={e => setSupFilter(e.target.value ? parseInt(e.target.value) : '')}>
            <option value="">All suppliers</option>
            {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
          </select>
        </div>
        {attrKeys.length > 0 && (
          <div>
            <label className={labelCls}>Attributes</label>
            {attrKeys.map(key => (
              <div key={key} className="mb-1.5">
                <label className="text-[10px] t-text-4 capitalize">{key}</label>
                <input className={inputCls} placeholder={`Filter by ${key}…`}
                  value={attrFilters[key] ?? ''}
                  onChange={e => setAttrFilters(p => ({ ...p, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* ── TABLE AREA ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface">
          <span className="text-xs t-text-3">
            {loading ? 'Loading…' : `${filteredRows.length} variant${filteredRows.length !== 1 ? 's' : ''}`}
          </span>

          {/* rows-per-page + page nav */}
          <div className="flex items-center gap-2 ml-3">
            <label className="text-xs t-text-3">Rows per page</label>
            <select
              className="t-bg-input border t-border-strong rounded px-2 py-1 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors"
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}>
              {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-2 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong hover:t-text-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                ‹ Prev
              </button>
              <span className="text-xs t-text-3 px-1">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-2 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong hover:t-text-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Next ›
              </button>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">

            {/* column picker */}
            <div className="relative" ref={pickerRef}>
              <button onClick={() => setPickerOpen(o => !o)}
                className="px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong hover:t-text-1 transition-colors">
                Columns ⚙
              </button>
              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1 w-64 t-bg-surface border t-border-strong rounded-lg shadow-xl z-20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-2">Toggleable Columns</p>
                  {([
                    ['sku',        'SKU'],
                    ['type',       'Product Type'],
                    ['category',   'Category'],
                    ['price',      'Price'],
                    ['promo',      'Promo Price'],
                    ['totalStock', 'Total Stock'],
                    ['status',     'Status'],
                  ] as [keyof ColVis, string][]).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs t-text-1 mb-1 cursor-pointer">
                      <input type="checkbox" className="accent-[var(--accent)]"
                        checked={cols[key] as boolean}
                        onChange={e => updateCols({ [key]: e.target.checked })} />
                      {label}
                    </label>
                  ))}

                  <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mt-3 mb-2">Physical Locations</p>
                  {physLocs.map(l => (
                    <label key={l.location_id} className="flex items-center gap-2 text-xs t-text-1 mb-1 cursor-pointer">
                      <input type="checkbox" className="accent-[var(--accent)]"
                        checked={cols.locIds.includes(l.location_id)}
                        onChange={() => toggleLoc(l.location_id)} />
                      {l.location_name}
                    </label>
                  ))}
                  {virtLocs.length > 0 && (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mt-3 mb-2">Virtual Locations</p>
                      {virtLocs.map(l => (
                        <label key={l.location_id} className="flex items-center gap-2 text-xs t-text-4 italic mb-1 cursor-pointer">
                          <input type="checkbox" className="accent-[var(--accent)]"
                            checked={cols.locIds.includes(l.location_id)}
                            onChange={() => toggleLoc(l.location_id)} />
                          {l.location_name}
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <button onClick={() => setExportOpen(true)}
              className="px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong hover:t-text-1 transition-colors">
              Export XLSX
            </button>
            {canEdit && (
              <button onClick={() => navigate('/inventory/new')}
                className="px-3 py-1 text-xs rounded text-white font-medium transition-colors"
                style={{ backgroundColor: 'var(--accent)' }}>
                + New Product
              </button>
            )}
          </div>
        </div>

        {/* table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="t-bg-elevated border-b t-border-strong">
                <SortTh k="brand"        label="Brand" />
                <SortTh k="variant_name" label="Variant Name" />
                <SortTh k="PID"          label="PID" />
                {cols.sku        && <SortTh k="sku" label="SKU" />}
                {cols.type       && <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Type</th>}
                {cols.category   && <SortTh k="category" label="Category" />}
                {cols.price      && <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Price</th>}
                {cols.promo      && <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Promo Price</th>}
                {cols.totalStock && <SortTh k="totalStock" label="Total Stock" right />}
                {cols.status     && <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Status</th>}
                {selectedLocs.map(l => {
                  const locKey = `loc_${l.location_id}` as SortKey
                  const isVirt = l.location_type === 'Virtual'
                  return (
                    <th key={l.location_id}
                      onClick={() => handleSort(locKey)}
                      className={`text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap cursor-pointer hover:t-text-1 select-none ${isVirt ? 't-text-4 italic' : 't-text-2'}`}>
                      {l.location_name}{sortIcon(locKey)}
                    </th>
                  )
                })}
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonTable rows={10} cols={totalCols} />}
              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-12 text-center t-text-4 text-xs">
                    No variants match the current filters.
                  </td>
                </tr>
              )}
              {!loading && pagedRows.map(({ product: p, variant: v, isBundle }) => {
                const isDefault = v.is_default
                const rowCls = `border-b t-border ${canManageProducts ? 'hover:t-bg-surface cursor-pointer' : ''} transition-colors group${isDefault ? '' : ' opacity-80'}`
                return (
                  <tr key={v.variant_id} onClick={canManageProducts ? () => navigate(`/inventory/${v.variant_id}`) : undefined} className={rowCls}>
                    {/* Brand — max-w + truncate prevents layout shifts from long names */}
                    <td className={`px-3 py-2 whitespace-nowrap max-w-[180px] truncate ${isDefault ? 't-text-1 font-semibold' : 't-text-2'}`}>
                      {p.brand}
                    </td>
                    {/* Variant Name — bold emphasis for default, no badge */}
                    <td className={`px-3 py-2 whitespace-nowrap max-w-[200px] truncate ${isDefault ? 't-text-1 font-semibold' : 't-text-2'}`}>
                      {v.variant_name}
                    </td>
                    <td className="px-3 py-2 font-mono t-text-2 whitespace-nowrap">{v.PID}</td>
                    {cols.sku        && <td className="px-3 py-2 font-mono t-text-3 whitespace-nowrap">{v.sku ?? '—'}</td>}
                    {cols.type       && <td className="px-3 py-2 t-text-3 whitespace-nowrap">{p.product_type}</td>}
                    {cols.category   && <td className="px-3 py-2 t-text-3 whitespace-nowrap max-w-[140px] truncate">{p.categories[0]?.category_name ?? '—'}</td>}
                    {cols.price      && (
                      // Price column — always the variant's own price, stable width
                      <td className="px-3 py-2 text-right tabular-nums t-text-1 whitespace-nowrap w-24">{fmt(v.price)}</td>
                    )}
                    {cols.promo      && (
                      // Promo Price column — value only, no badge, stable width
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap w-24">
                        {v.promo_price != null
                          ? <span className="t-text-1">{fmt(v.promo_price)}</span>
                          : <span className="t-text-4">—</span>
                        }
                      </td>
                    )}
                    {cols.totalStock && (
                      <td className="px-3 py-2 text-right tabular-nums t-text-1 whitespace-nowrap w-24">
                        {isBundle
                          ? <BundleStockCell available={bundleTotalStock(v)} />
                          : <UomStockCell baseStock={physicalStock(v)} variant={v} uomMap={uomMap} />
                        }
                      </td>
                    )}
                    {cols.status     && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${p.status === 'Active' ? 'bg-emerald-950 text-emerald-500' : 't-bg-elevated t-text-4'}`}>
                          {p.status}
                        </span>
                      </td>
                    )}
                    {selectedLocs.map(l => {
                      const locStock = isBundle
                        ? bundleStockAtLoc(v, l.location_id)
                        : stockAtLoc(v, l.location_id)
                      return (
                        <td key={l.location_id}
                          className={`px-3 py-2 text-right tabular-nums whitespace-nowrap w-20 ${l.location_type === 'Virtual' ? 't-text-4 italic' : 't-text-2'}`}>
                          {l.location_type !== 'Virtual'
                            ? isBundle
                              ? <BundleStockCell available={locStock} />
                              : <UomStockCell baseStock={locStock} variant={v} uomMap={uomMap} />
                            : locStock.toFixed(0)
                          }
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 whitespace-nowrap w-20" onClick={e => e.stopPropagation()}>
                      {canManageProducts && (
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => navigate(`/inventory/${v.variant_id}`)} className="text-[10px] text-blue-400 hover:underline">View</button>
                          {canEdit && <button onClick={() => navigate(`/inventory/${v.variant_id}`)} className="text-[10px] t-text-3 hover:t-text-1">Edit</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── EXPORT MODAL ── */}
      {exportOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setExportOpen(false)}>
          <div className="t-bg-surface border t-border-strong rounded-lg p-5 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-semibold t-text-1 mb-4">Export Options</p>
            <p className="text-[10px] t-text-4 mb-2 uppercase tracking-widest">Additional Fields</p>
            {([
              ['Cost data (net_unit_cost, FIFO layers)', extraCost,     setExtraCost],
              ['Supplier data (gross_cost, discount, SKU)', extraSupplier, setExtraSupplier],
              ['Attributes',  extraAttrs,    setExtraAttrs],
              ['Barcodes',    extraBarcodes, setExtraBarcodes],
            ] as [string, boolean, (v: boolean) => void][]).map(([label, val, setter]) => (
              <label key={label} className="flex items-center gap-2 text-xs t-text-2 mb-2 cursor-pointer">
                <input type="checkbox" className="accent-[var(--accent)]" checked={val} onChange={e => setter(e.target.checked)} />
                {label}
              </label>
            ))}
            <div className="mt-4 flex gap-2">
              <button onClick={handleExport} className="flex-1 py-1.5 text-xs rounded text-white font-medium" style={{ backgroundColor: 'var(--accent)' }}>
                Export ({filteredRows.length} rows)
              </button>
              <button onClick={() => setExportOpen(false)} className="px-3 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
