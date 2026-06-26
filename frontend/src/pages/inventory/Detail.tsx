import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { FetchingBar, SkeletonFields } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  catalogueApi, inventoryApi,
  type InvVariant, type InvProduct, type Location,
  type InvBarcode, type InvUomConversion, type BundleComp, type InvVariantSupplier,
  type PriceHistoryItem, type CostHistoryItem, type SalesHistoryItem, type PurchaseHistoryItem,
  type UOM, type Category, type InvSupplier,
} from '../../services/api'
import { normalize } from '../../lib/normalize'

// ── helpers ───────────────────────────────────────────────────────────────────

const CAN_EDIT = ['ADMIN', 'STORE_MANAGER', 'WAREHOUSE_MANAGER']
const HIST_LIMIT = 10

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
// For plain calendar-date strings ("YYYY-MM-DD", e.g. transaction_date) — formats
// the date components directly so the displayed day never shifts with the
// viewer's local timezone (new Date(dateOnlyString) parses as UTC midnight,
// which `toLocaleString` would otherwise convert to local time and possibly
// roll back a day).
function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'UTC' })
}

// ── shared primitives ─────────────────────────────────────────────────────────

const iCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'
const lCls = 'block text-[10px] font-medium uppercase tracking-widest text-gray-600 mb-1'

function SectionHead({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mt-6 mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{title}</p>
      <div className="flex-1 border-b border-gray-800" />
    </div>
  )
}

function HistoryTable({
  cols, rows, onLoadMore, hasMore, loading,
}: {
  cols: string[]
  rows: (string | number | null | undefined)[][]
  onLoadMore?: () => void
  hasMore?: boolean
  loading?: boolean
}) {
  return (
    <>
      <table className="w-full text-xs mt-2">
        <thead>
          <tr className="border-b border-gray-800">
            {cols.map(c => <th key={c} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} className="px-2 py-4 text-center text-gray-700">No records</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-800">
              {r.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 text-gray-400">{cell ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="mt-2 text-[10px] text-blue-500 hover:text-blue-400 disabled:opacity-40 transition-colors font-medium"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  )
}

// ── add-variant modal types ───────────────────────────────────────────────────
type AVAttr       = { key: string; value: string }
type AVBarcode    = { id: string; barcode: string; uom_id: string; is_primary: boolean }
type AVUomConv    = { id: string; from_uom_id: string; to_uom_id: string; factor: string; is_warehouse_bundle: boolean }
type AVBundleComp = { component_variant_id: number; quantity: string; label: string }
function avUid()  { return Math.random().toString(36).slice(2, 10) }

// ── component ─────────────────────────────────────────────────────────────────

export default function Detail() {
  const { variantId } = useParams<{ variantId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = user?.roles.some(r => CAN_EDIT.includes(r)) ?? false
  const vid = parseInt(variantId ?? '0')

  // ── React Query: parallel data fetching ───────────────────────────────────
  const results = useQueries({
    queries: [
      { queryKey: qk.variant(vid),    queryFn: () => catalogueApi.variants.get(vid),      ...stale.transactional },
      { queryKey: qk.locations(),     queryFn: () => inventoryApi.locations.all(),         ...stale.reference },
      { queryKey: qk.uoms(),          queryFn: () => catalogueApi.uoms.list(),             ...stale.reference },
      { queryKey: qk.categories(),    queryFn: () => catalogueApi.categories.list(),       ...stale.reference },
      { queryKey: qk.suppliers(),     queryFn: () => catalogueApi.suppliers.list(),        ...stale.reference },
      { queryKey: qk.priceHistory(vid,   HIST_LIMIT, 0), queryFn: () => catalogueApi.variants.priceHistory(vid,   HIST_LIMIT, 0), ...stale.transactional },
      { queryKey: qk.costHistory(vid,    HIST_LIMIT, 0), queryFn: () => catalogueApi.variants.costHistory(vid,    HIST_LIMIT, 0), ...stale.transactional },
      { queryKey: qk.salesHistory(vid,   HIST_LIMIT, 0), queryFn: () => catalogueApi.variants.salesHistory(vid,   HIST_LIMIT, 0), ...stale.transactional },
      { queryKey: qk.purchaseHistory(vid,HIST_LIMIT, 0), queryFn: () => catalogueApi.variants.purchaseHistory(vid,HIST_LIMIT, 0), ...stale.transactional },
    ],
  })
  const [qVariant, qLocs, qUoms, qCats, qSups, qPH, qCH, qSH, qPurH] = results
  const locations = qLocs.data ?? []
  const uoms      = (qUoms.data ?? []).filter(u => !u.is_deleted)
  const cats      = (qCats.data ?? []).filter(c => !c.is_deleted)
  const suppliers = (qSups.data ?? []).filter(s => !s.is_deleted)
  const loading   = qVariant.isLoading
  const fetching  = results.some(r => r.isFetching && !r.isLoading)

  // Local display state — seeded from query cache, allows inline editing overlay
  const [variant, setVariant] = useState<InvVariant | null>(null)
  const [product, setProduct] = useState<InvProduct | null>(null)

  // Sync from query cache when no unsaved edits are pending
  // (variantEdits/productEdits are checked inside handleSave — we just sync on data arrival)
  useEffect(() => { if (qVariant.data) setVariant(qVariant.data) }, [qVariant.data])

  // product is fetched once variant is known
  const productId = variant?.product_id
  const qProduct  = useQueries({
    queries: productId != null
      ? [{ queryKey: qk.product(productId), queryFn: () => catalogueApi.products.get(productId), ...stale.transactional }]
      : [],
  })
  useEffect(() => { if (qProduct[0]?.data) setProduct(qProduct[0].data) }, [qProduct[0]?.data])

  // invalidate variant (and product) — triggers fresh fetch → syncs display state
  async function reload() {
    await qc.invalidateQueries({ queryKey: qk.variant(vid) })
    if (productId != null) await qc.invalidateQueries({ queryKey: qk.product(productId) })
  }

  // ── paginated history (load-more appended locally) ────────────────────────
  const [priceHist,    setPriceHist]    = useState<PriceHistoryItem[]>([])
  const [costHist,     setCostHist]     = useState<CostHistoryItem[]>([])
  const [salesHist,    setSalesHist]    = useState<SalesHistoryItem[]>([])
  const [purchaseHist, setPurchaseHist] = useState<PurchaseHistoryItem[]>([])
  const [priceHasMore, setPriceHasMore] = useState(false)
  const [costHasMore,  setCostHasMore]  = useState(false)
  const [salesHasMore, setSalesHasMore] = useState(false)
  const [purchHasMore, setPurchHasMore] = useState(false)
  const [histLoading,  setHistLoading]  = useState<string | null>(null)

  // Seed history from query cache when it arrives
  useEffect(() => {
    if (qPH.data) { setPriceHist(qPH.data); setPriceHasMore(qPH.data.length === HIST_LIMIT) }
  }, [qPH.data])
  useEffect(() => {
    if (qCH.data) { setCostHist(qCH.data); setCostHasMore(qCH.data.length === HIST_LIMIT) }
  }, [qCH.data])
  useEffect(() => {
    if (qSH.data) { setSalesHist(qSH.data); setSalesHasMore(qSH.data.length === HIST_LIMIT) }
  }, [qSH.data])
  useEffect(() => {
    if (qPurH.data) { setPurchaseHist(qPurH.data); setPurchHasMore(qPurH.data.length === HIST_LIMIT) }
  }, [qPurH.data])

  // ── dirty tracking ────────────────────────────────────────────────────────
  const [variantEdits,  setVariantEdits]  = useState<Record<string, unknown>>({})
  const [productEdits,  setProductEdits]  = useState<Record<string, unknown>>({})
  const [saving,        setSaving]        = useState(false)
  const [saveMsg,       setSaveMsg]       = useState('')

  // ── inline CRUD state ─────────────────────────────────────────────────────
  const [addBarcode,   setAddBarcode]   = useState({ barcode: '', uom_id: '', is_primary: false })
  const [addUomConv,   setAddUomConv]   = useState({ from_uom_id: '', to_uom_id: '', factor: '', is_warehouse_bundle: false, price: '', promo_price: '' })
  const [uomEdits,     setUomEdits]     = useState<Record<string, { price: string; promo_price: string }>>({})
  const [addBundle,    setAddBundle]    = useState({ component_variant_id: '', quantity: '1', searchPID: '' })
  const [addSupplier,  setAddSupplier]  = useState({ supplier_id: '', supplier_sku: '', gross_cost: '', supplier_discount: '0', is_primary: false })
  const [bundleSearch, setBundleSearch] = useState<InvVariant[]>([])

  // ── add variant modal state ───────────────────────────────────────────────
  const [showAddVariant,   setShowAddVariant]   = useState(false)
  const [addVDraft,        setAddVDraft]        = useState({
    variant_name: '', PID: '', sku: '', price: '', promo_price: '',
    is_default: false, is_bundle: false,
    attrs:        [] as AVAttr[],
    barcodes:     [] as AVBarcode[],
    uom_convs:    [] as AVUomConv[],
    bundle_comps: [] as AVBundleComp[],
    supplier_id: '', supplier_sku: '', gross_cost: '', supplier_discount: '0',
  })
  const [addVSaving,       setAddVSaving]       = useState(false)
  const [addVError,        setAddVError]        = useState('')
  const [addVBundleSearch, setAddVBundleSearch] = useState<InvVariant[]>([])
  const [addVBundleQ,      setAddVBundleQ]      = useState('')

  // ── supplier link edit state ──────────────────────────────────────────────
  const [editingSupId,   setEditingSupId]   = useState<number | null>(null)
  const [supEditForm,    setSupEditForm]    = useState({ supplier_sku: '', gross_cost: '', supplier_discount: '0' })

  // Pre-fill supplier SKU from variant's own SKU
  useEffect(() => {
    setAddSupplier(prev => ({ ...prev, supplier_sku: variant?.sku ?? '' }))
  }, [variant?.sku])

  // ── load-more handlers ────────────────────────────────────────────────────
  async function loadMore(kind: 'price' | 'cost' | 'sales' | 'purchase', current: number) {
    setHistLoading(kind)
    try {
      if (kind === 'price') {
        const next = await catalogueApi.variants.priceHistory(vid, HIST_LIMIT, current)
        setPriceHist(p => [...p, ...next]); setPriceHasMore(next.length === HIST_LIMIT)
      } else if (kind === 'cost') {
        const next = await catalogueApi.variants.costHistory(vid, HIST_LIMIT, current)
        setCostHist(p => [...p, ...next]); setCostHasMore(next.length === HIST_LIMIT)
      } else if (kind === 'sales') {
        const next = await catalogueApi.variants.salesHistory(vid, HIST_LIMIT, current)
        setSalesHist(p => [...p, ...next]); setSalesHasMore(next.length === HIST_LIMIT)
      } else {
        const next = await catalogueApi.variants.purchaseHistory(vid, HIST_LIMIT, current)
        setPurchaseHist(p => [...p, ...next]); setPurchHasMore(next.length === HIST_LIMIT)
      }
    } finally { setHistLoading(null) }
  }

  // ── save handler ──────────────────────────────────────────────────────────
  async function handleSave() {
    if (!variant || !product) return
    setSaving(true)
    try {
      const promises: Promise<unknown>[] = []
      if (Object.keys(variantEdits).length > 0)
        promises.push(catalogueApi.variants.update(vid, variantEdits))
      if (Object.keys(productEdits).length > 0)
        promises.push(catalogueApi.products.update(product.product_id, productEdits))
      await Promise.all(promises)
      setVariantEdits({}); setProductEdits({})
      await reload()
      setSaveMsg('Saved.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  function vEdit<K extends keyof InvVariant>(key: K, value: InvVariant[K]) {
    setVariantEdits(prev => ({ ...prev, [key]: value }))
    setVariant(prev => prev ? { ...prev, [key]: value } : prev)
  }
  function pEdit<K extends keyof InvProduct>(key: K, value: InvProduct[K]) {
    if (key === 'categories') {
      const names = (value as Category[]).map(c => c.category_name)
      setProductEdits(prev => ({ ...prev, category_names: names }))
    } else {
      setProductEdits(prev => ({ ...prev, [key]: value }))
    }
    setProduct(prev => prev ? { ...prev, [key]: value } : prev)
  }

  const isDirty = Object.keys(variantEdits).length > 0 || Object.keys(productEdits).length > 0

  // ── barcode handlers ──────────────────────────────────────────────────────
  async function handleAddBarcode() {
    if (!addBarcode.barcode.trim()) return
    await catalogueApi.barcodes.create(vid, {
      barcode: addBarcode.barcode.trim(),
      uom_id: addBarcode.uom_id ? parseInt(addBarcode.uom_id) : null,
      is_primary: addBarcode.is_primary,
    })
    setAddBarcode({ barcode: '', uom_id: '', is_primary: false })
    await reload()
  }

  async function handleDeleteBarcode(bid: number) {
    await catalogueApi.barcodes.delete(vid, bid); await reload()
  }

  async function handleTogglePrimaryBarcode(bc: InvBarcode) {
    await catalogueApi.barcodes.update(vid, bc.barcode_id, { is_primary: !bc.is_primary }); await reload()
  }

  // ── uom conversion handlers ───────────────────────────────────────────────
  async function handleAddUomConv() {
    if (!addUomConv.from_uom_id || !addUomConv.to_uom_id || !addUomConv.factor) return
    await catalogueApi.uomConversions.create(vid, {
      from_uom_id:         parseInt(addUomConv.from_uom_id),
      to_uom_id:           parseInt(addUomConv.to_uom_id),
      factor:              parseFloat(addUomConv.factor),
      is_warehouse_bundle: addUomConv.is_warehouse_bundle,
      price:               addUomConv.price       ? parseFloat(addUomConv.price)       : null,
      promo_price:         addUomConv.promo_price ? parseFloat(addUomConv.promo_price) : null,
    })
    setAddUomConv({ from_uom_id: '', to_uom_id: '', factor: '', is_warehouse_bundle: false, price: '', promo_price: '' })
    await reload()
  }

  async function handleToggleWarehouseBundle(c: InvUomConversion) {
    await catalogueApi.uomConversions.update(vid, c.from_uom_id, c.to_uom_id, {
      is_warehouse_bundle: !c.is_warehouse_bundle,
    })
    await reload()
  }

  async function handleDeleteUomConv(c: InvUomConversion) {
    await catalogueApi.uomConversions.delete(vid, c.from_uom_id, c.to_uom_id); await reload()
  }

  // ── uom price inline edit helpers ─────────────────────────────────────────
  function uomEditKey(c: InvUomConversion) { return `${c.from_uom_id}-${c.to_uom_id}` }

  function getUomDraft(c: InvUomConversion) {
    return uomEdits[uomEditKey(c)] ?? {
      price:       c.price       != null ? String(c.price)       : '',
      promo_price: c.promo_price != null ? String(c.promo_price) : '',
    }
  }

  function handleUomPriceChange(c: InvUomConversion, field: 'price' | 'promo_price', val: string) {
    const key = uomEditKey(c)
    setUomEdits(prev => ({ ...prev, [key]: { ...getUomDraft(c), [field]: val } }))
  }

  async function handleUomPriceBlur(c: InvUomConversion, field: 'price' | 'promo_price') {
    const draft  = getUomDraft(c)
    const rawVal = draft[field]
    const parsed = rawVal === '' ? null : parseFloat(rawVal)
    if (parsed !== null && isNaN(parsed)) return
    const current = field === 'price' ? c.price : c.promo_price
    if (parsed === null && current == null) return
    if (parsed !== null && current !== null && Math.abs(parsed - Number(current)) < 0.001) return
    await catalogueApi.uomConversions.update(vid, c.from_uom_id, c.to_uom_id, { [field]: parsed })
    setUomEdits(prev => { const next = { ...prev }; delete next[uomEditKey(c)]; return next })
    await reload()
  }

  // ── bundle handlers ───────────────────────────────────────────────────────
  async function handleBundleSearch(q: string) {
    if (!q.trim()) { setBundleSearch([]); return }
    const all = await catalogueApi.products.list()
    const results: InvVariant[] = []
    for (const p of all)
      for (const v of p.variants)
        if (!v.is_deleted && (normalize(v.PID).includes(normalize(q)) || normalize(v.variant_name).includes(normalize(q))))
          results.push(v)
    setBundleSearch(results.slice(0, 10))
  }

  async function handleAddBundle() {
    if (!addBundle.component_variant_id) return
    await catalogueApi.bundleComponents.create(vid, {
      component_variant_id: parseInt(addBundle.component_variant_id),
      quantity: parseFloat(addBundle.quantity) || 1,
    })
    setAddBundle({ component_variant_id: '', quantity: '1', searchPID: '' })
    setBundleSearch([])
    await reload()
  }

  async function handleDeleteBundle(c: BundleComp) {
    await catalogueApi.bundleComponents.delete(vid, c.component_variant_id); await reload()
  }

  // ── supplier link handlers ────────────────────────────────────────────────
  async function handleAddSupplierLink() {
    if (!addSupplier.supplier_id) return
    await catalogueApi.supplierLinks.create(vid, {
      supplier_id:       parseInt(addSupplier.supplier_id),
      supplier_sku:      addSupplier.supplier_sku || null,
      gross_cost:        addSupplier.gross_cost ? parseFloat(addSupplier.gross_cost) : null,
      supplier_discount: parseFloat(addSupplier.supplier_discount) || 0,
      is_primary:        addSupplier.is_primary,
    })
    setAddSupplier({ supplier_id: '', supplier_sku: variant?.sku ?? '', gross_cost: '', supplier_discount: '0', is_primary: false })
    await reload()
  }

  function startEditSupplier(s: InvVariantSupplier) {
    setEditingSupId(s.id)
    setSupEditForm({
      supplier_sku:      s.supplier_sku ?? '',
      gross_cost:        s.gross_cost != null ? String(s.gross_cost) : '',
      supplier_discount: String(s.supplier_discount),
    })
  }

  async function saveEditSupplier() {
    if (editingSupId == null) return
    await catalogueApi.supplierLinks.update(vid, editingSupId, {
      supplier_sku:      supEditForm.supplier_sku || null,
      gross_cost:        supEditForm.gross_cost ? parseFloat(supEditForm.gross_cost) : null,
      supplier_discount: parseFloat(supEditForm.supplier_discount) || 0,
    })
    setEditingSupId(null)
    await reload()
  }

  async function handleDeleteSupplierLink(link: InvVariantSupplier) {
    await catalogueApi.supplierLinks.delete(vid, link.id); await reload()
  }

  async function handleTogglePrimarySupplier(link: InvVariantSupplier) {
    await catalogueApi.supplierLinks.update(vid, link.id, { is_primary: !link.is_primary }); await reload()
  }

  // ── add variant handlers ──────────────────────────────────────────────────
  async function handleAddVBundleSearch(q: string) {
    setAddVBundleQ(q)
    if (!q.trim()) { setAddVBundleSearch([]); return }
    const all = await catalogueApi.products.list()
    const results: InvVariant[] = []
    for (const p of all)
      for (const v of p.variants)
        if (!v.is_deleted && (normalize(v.PID).includes(normalize(q)) || normalize(v.variant_name).includes(normalize(q))))
          results.push(v)
    setAddVBundleSearch(results.slice(0, 10))
  }

  async function handleAddVariantSubmit() {
    if (!product) return
    if (!addVDraft.PID.trim() || !addVDraft.variant_name.trim()) {
      setAddVError('Variant Name and PID are required.'); return
    }
    setAddVSaving(true); setAddVError('')
    try {
      const payload: Record<string, unknown> = {
        PID:          addVDraft.PID.trim(),
        variant_name: addVDraft.variant_name.trim(),
        sku:          addVDraft.sku.trim() || null,
        price:        addVDraft.price ? parseFloat(addVDraft.price) : null,
        promo_price:  addVDraft.promo_price ? parseFloat(addVDraft.promo_price) : null,
        is_default:   addVDraft.is_default,
        attributes:   addVDraft.attrs.length > 0
          ? Object.fromEntries(addVDraft.attrs.filter(a => a.key.trim()).map(a => [a.key, a.value]))
          : null,
      }
      const updated = await catalogueApi.variants.addToProduct(product.product_id, payload)
      const newV = updated.variants.find(v => v.PID === addVDraft.PID.trim())
      if (newV) {
        if (addVDraft.supplier_id) {
          await catalogueApi.supplierLinks.create(newV.variant_id, {
            supplier_id:       parseInt(addVDraft.supplier_id),
            supplier_sku:      addVDraft.supplier_sku || null,
            gross_cost:        addVDraft.gross_cost ? parseFloat(addVDraft.gross_cost) : null,
            supplier_discount: parseFloat(addVDraft.supplier_discount) || 0,
            is_primary:        true,
          }).catch(() => {})
        }
        for (const bc of addVDraft.barcodes.filter(b => b.barcode.trim())) {
          await catalogueApi.barcodes.create(newV.variant_id, {
            barcode:    bc.barcode.trim(),
            uom_id:     bc.uom_id ? parseInt(bc.uom_id) : null,
            is_primary: bc.is_primary,
          }).catch(() => {})
        }
        for (const uc of addVDraft.uom_convs.filter(c => c.from_uom_id && c.to_uom_id && c.factor)) {
          await catalogueApi.uomConversions.create(newV.variant_id, {
            from_uom_id:        parseInt(uc.from_uom_id),
            to_uom_id:          parseInt(uc.to_uom_id),
            factor:             parseFloat(uc.factor),
            is_warehouse_bundle: uc.is_warehouse_bundle,
          }).catch(() => {})
        }
        for (const bc of addVDraft.bundle_comps) {
          await catalogueApi.bundleComponents.create(newV.variant_id, {
            component_variant_id: bc.component_variant_id,
            quantity:             parseFloat(bc.quantity) || 1,
          }).catch(() => {})
        }
        setShowAddVariant(false)
        navigate(`/inventory/${newV.variant_id}`)
      }
    } catch (e: unknown) {
      setAddVError(e instanceof Error ? e.message : 'Create failed')
    } finally { setAddVSaving(false) }
  }

  if (loading) return (
    <div className="min-h-full bg-gray-950 px-6 py-5">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="h-5 bg-gray-800 rounded w-48 animate-pulse" />
        <SkeletonFields count={9} />
        <SkeletonFields count={4} />
        <SkeletonFields count={6} />
      </div>
    </div>
  )
  if (!variant || !product) return <div className="p-8 text-sm text-gray-500 animate-pulse">Loading…</div>

  const physLocs   = locations.filter(l => l.location_type !== 'Virtual' && !l.is_deleted)
  const virtLocs   = locations.filter(l => l.location_type === 'Virtual')
  const isBundleType = variant.bundle_components && variant.bundle_components.length > 0

  const smallInput  = 'bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
  // shared class for tfoot add-row inputs — fills the cell, matches column width automatically
  const addInputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <>
    <div className="min-h-full bg-gray-950 px-6 py-5">
      <div className="max-w-4xl mx-auto">

        <FetchingBar show={fetching} />
        {/* breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-600 mb-4">
          <button onClick={() => navigate('/inventory')} className="hover:text-gray-400">Inventory</button>
          <span>/</span>
          <span className="text-gray-300">{product.brand}</span>
          <span>/</span>
          <span className="text-gray-400">{variant.variant_name}</span>
        </div>

        {/* save bar */}
        {(isDirty || saveMsg) && (
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 mb-4">
            <span className={`text-xs ${saveMsg && !isDirty ? 'text-emerald-400' : 'text-gray-400'}`}>
              {saveMsg || 'Unsaved changes'}
            </span>
            <div className="ml-auto flex gap-2">
              {isDirty && (
                <>
                  <button onClick={() => { setVariantEdits({}); setProductEdits({}); reload() }}
                    className="px-3 py-1 text-xs border border-gray-700 rounded text-gray-500 hover:border-gray-600">
                    Discard
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-1 text-xs rounded text-white font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── PRODUCT HEADER (shared across all variants) ── */}
        <SectionHead title="Product" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className={lCls}>Brand</label>
            <input className={iCls} value={product.brand}
              onChange={e => pEdit('brand', e.target.value)} readOnly={!canEdit} />
          </div>
          <div>
            <label className={lCls}>Product Type</label>
            {canEdit
              ? <select className={iCls} value={product.product_type} onChange={e => pEdit('product_type', e.target.value)}>
                  {['Inventory', 'Non-Inventory', 'Service'].map(t => <option key={t}>{t}</option>)}
                </select>
              : <input className={iCls} value={product.product_type} readOnly />
            }
          </div>
          <div>
            <label className={lCls}>Status</label>
            {canEdit
              ? <select className={iCls} value={product.status} onChange={e => pEdit('status', e.target.value)}>
                  <option>Active</option><option>Inactive</option>
                </select>
              : <input className={iCls} value={product.status} readOnly />
            }
          </div>
          <div>
            <label className={lCls}>Base UOM</label>
            {canEdit
              ? <select className={iCls} value={product.base_uom_id ?? ''}
                  onChange={e => pEdit('base_uom_id', e.target.value ? parseInt(e.target.value) : null as never)}>
                  <option value="">— none —</option>
                  {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                </select>
              : <input className={iCls} value={product.base_uom?.uom_code ?? '—'} readOnly />
            }
          </div>
          <div className="col-span-full">
            <label className={lCls}>Categories</label>
            {canEdit
              ? <div className="flex flex-wrap gap-1.5">
                  {cats.map(c => {
                    const active = product.categories.some(pc => pc.category_id === c.category_id)
                    return (
                      <button key={c.category_id}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${active ? 'text-white border-transparent' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
                        style={active ? { backgroundColor: 'var(--accent)' } : undefined}
                        onClick={() => pEdit('categories', active ? product.categories.filter(pc => pc.category_id !== c.category_id) : [...product.categories, c])}>
                        {c.category_name}
                      </button>
                    )
                  })}
                </div>
              : <div className="flex flex-wrap gap-1">
                  {product.categories.map(c => (
                    <span key={c.category_id} className="text-[10px] bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">{c.category_name}</span>
                  ))}
                  {product.categories.length === 0 && <span className="text-xs text-gray-700">—</span>}
                </div>
            }
          </div>
          <div className="col-span-full">
            <label className={lCls}>Description</label>
            <textarea className={`${iCls} h-16 resize-none`} value={product.description ?? ''}
              onChange={e => pEdit('description', e.target.value || null as never)} readOnly={!canEdit} />
          </div>
        </div>

        {/* ── SIBLING VARIANTS PANEL ── */}
        <SectionHead title="All Variants" />
        <table className="w-full text-xs mb-1">
          <thead>
            <tr className="border-b border-gray-800">
              {['Variant Name','PID','SKU','Total Stock',''].map(h => (
                <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {product.variants.filter(sv => !sv.is_deleted).map(sv => {
              const isCurrent = sv.variant_id === vid
              const svStock = sv.current_stock
                .filter(s => s.location.location_type !== 'Virtual')
                .reduce((sum, s) => sum + Number(s.quantity), 0)
              return (
                <tr key={sv.variant_id}
                  className={`border-b border-gray-800 transition-colors ${isCurrent ? 'bg-gray-900' : 'hover:bg-gray-900 cursor-pointer'}`}
                  onClick={() => !isCurrent && navigate(`/inventory/${sv.variant_id}`)}>
                  <td className={`px-2 py-1.5 ${isCurrent ? 'text-gray-100 font-semibold' : 'text-gray-400'}`}>
                    {sv.variant_name}
                    {sv.is_default && <span className="ml-1.5 text-[9px] bg-blue-950 text-blue-400 border border-blue-900 rounded px-1 py-0.5 font-bold">Default</span>}
                    {isCurrent    && <span className="ml-1.5 text-[9px] bg-gray-700 text-gray-300 rounded px-1 py-0.5">Viewing</span>}
                  </td>
                  <td className={`px-2 py-1.5 font-mono ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>{sv.PID}</td>
                  <td className={`px-2 py-1.5 font-mono ${isCurrent ? 'text-gray-400' : 'text-gray-600'}`}>{sv.sku ?? '—'}</td>
                  <td className={`px-2 py-1.5 tabular-nums ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>{svStock.toFixed(0)}</td>
                  <td className="px-2 py-1.5">
                    {!isCurrent && <span className="text-[10px] text-blue-500 hover:text-blue-400">View →</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {canEdit && (
          <button onClick={() => setShowAddVariant(true)}
            className="text-[10px] text-blue-500 hover:text-blue-400 font-medium mb-2">
            + Add Variant
          </button>
        )}

        {/* ── VARIANT FIELDS ── */}
        <SectionHead title="Variant" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className={lCls}>Variant Name</label>
            <input className={iCls} value={variant.variant_name}
              onChange={e => vEdit('variant_name', e.target.value)} readOnly={!canEdit} />
          </div>
          <div>
            <label className={lCls}>PID</label>
            <input className={iCls} value={variant.PID}
              onChange={e => vEdit('PID', e.target.value as never)} readOnly={!canEdit} />
          </div>
          <div>
            <label className={lCls}>SKU</label>
            <input className={iCls} value={variant.sku ?? ''}
              onChange={e => vEdit('sku', e.target.value || null as never)} readOnly={!canEdit} />
          </div>
          <div>
            <label className={lCls}>Default Variant</label>
            {canEdit
              ? <select className={iCls} value={variant.is_default ? 'yes' : 'no'}
                  onChange={e => vEdit('is_default', e.target.value === 'yes' as never)}>
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              : <input className={iCls} value={variant.is_default ? 'Yes' : 'No'} readOnly />
            }
          </div>
          {!isBundleType && (
            <div>
              <label className={lCls}>Include in Ordering</label>
              {canEdit ? (
                <label
                  className="flex items-center gap-2 mt-1 cursor-pointer"
                  title="Uncheck to exclude this variant from purchase order forms. Use for bundles and phased-out items you still carry on hand."
                >
                  <input
                    type="checkbox"
                    checked={variant.include_in_ordering}
                    onChange={e => vEdit('include_in_ordering', e.target.checked as never)}
                  />
                  <span className="text-xs text-gray-400">
                    {variant.include_in_ordering ? 'Yes' : 'No'}
                  </span>
                </label>
              ) : (
                <input className={iCls} value={variant.include_in_ordering ? 'Yes' : 'No'} readOnly />
              )}
              <p className="text-[10px] text-gray-600 mt-0.5">
                Uncheck to exclude from purchase order forms. Use for phased-out items you still carry on hand.
              </p>
            </div>
          )}
        </div>

        {/* ── PRICING ── */}
        <SectionHead title="Pricing" />
        {(() => {
          const defaultV   = product.variants.find(v => v.is_default && v.variant_id !== vid)
          const inheriting = !variant.is_default && variant.price == null
          const inheritingPromo = !variant.is_default && variant.promo_price == null && defaultV?.promo_price != null
          return (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className={lCls}>Price</label>
                {inheriting ? (
                  <div>
                    <input className={`${iCls} opacity-50 cursor-default`}
                      value={defaultV?.price != null ? Number(defaultV.price).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : '—'}
                      readOnly title="Inherited from default variant" />
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      Inherited from default{canEdit && <> · <button className="text-blue-500 hover:text-blue-400" onClick={() => vEdit('price', defaultV?.price ?? 0 as never)}>Override</button></>}
                    </p>
                  </div>
                ) : (
                  <div>
                    <input type="number" step="0.01" className={iCls}
                      value={variant.price ?? ''}
                      onChange={e => vEdit('price', e.target.value ? parseFloat(e.target.value) : null as never)}
                      readOnly={!canEdit} />
                    {!variant.is_default && canEdit && variant.price != null && (
                      <button className="text-[10px] text-gray-600 hover:text-gray-400 mt-0.5 block"
                        onClick={() => vEdit('price', null as never)}>
                        Reset to default
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className={lCls}>Promo Price</label>
                {inheritingPromo ? (
                  <div>
                    <input className={`${iCls} opacity-50 cursor-default`}
                      value={Number(defaultV!.promo_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      readOnly title="Inherited from default variant" />
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      Inherited{canEdit && <> · <button className="text-blue-500 hover:text-blue-400" onClick={() => vEdit('promo_price', defaultV!.promo_price as never)}>Override</button></>}
                    </p>
                  </div>
                ) : (
                  <div>
                    <input type="number" step="0.01" className={iCls}
                      value={variant.promo_price ?? ''}
                      onChange={e => vEdit('promo_price', e.target.value ? parseFloat(e.target.value) : null as never)}
                      readOnly={!canEdit} />
                    {!variant.is_default && canEdit && variant.promo_price != null && (
                      <button className="text-[10px] text-gray-600 hover:text-gray-400 mt-0.5 block"
                        onClick={() => vEdit('promo_price', null as never)}>
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Attributes */}
        <div className="mt-3">
          <label className={lCls}>Attributes (key → value)</label>
          <div className="space-y-1.5">
            {Object.entries(variant.attributes ?? {}).map(([k, v]) => (
              <div key={k} className="flex gap-2 items-center">
                <input className={`${iCls} w-32`} value={k} readOnly />
                <input className={iCls} value={String(v)}
                  onChange={e => vEdit('attributes', { ...(variant.attributes ?? {}), [k]: e.target.value } as never)}
                  readOnly={!canEdit} />
                {canEdit && (
                  <button onClick={() => {
                    const next = { ...(variant.attributes ?? {}) }; delete next[k]
                    vEdit('attributes', next as never)
                  }} className="text-gray-700 hover:text-red-500 text-base">×</button>
                )}
              </div>
            ))}
            {canEdit && (
              <button onClick={() => {
                const key = prompt('Attribute key:')
                if (!key) return
                vEdit('attributes', { ...(variant.attributes ?? {}), [key]: '' } as never)
              }} className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add attribute</button>
            )}
          </div>
        </div>

        {/* ── PRICE HISTORY ── */}
        <SectionHead title="Price History" />
        <HistoryTable
          cols={['Date','Old Price','New Price','Old Promo','New Promo','Changed By']}
          rows={priceHist.map(h => [fmtDate(h.changed_at), fmt(h.old_price), fmt(h.new_price), fmt(h.old_promo_price), fmt(h.new_promo_price), h.changed_by_username ?? h.changed_by_user_id ?? '—'])}
          hasMore={priceHasMore}
          onLoadMore={() => loadMore('price', priceHist.length)}
          loading={histLoading === 'price'}
        />

        {/* ── BARCODES ── */}
        <SectionHead title="Barcodes" />
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {['Barcode','UOM','Primary',''].map(h =>
                <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {variant.barcodes.map(bc => (
              <tr key={bc.barcode_id} className="border-b border-gray-800">
                <td className="px-2 py-1.5 font-mono text-gray-300">{bc.barcode}</td>
                <td className="px-2 py-1.5 text-gray-500">{uoms.find(u => u.uom_id === bc.uom_id)?.uom_code ?? '—'}</td>
                <td className="px-2 py-1.5">
                  {bc.is_primary
                    ? <span className="text-[10px] bg-emerald-950 text-emerald-500 rounded px-1.5 py-0.5">Primary</span>
                    : canEdit
                    ? <button onClick={() => handleTogglePrimaryBarcode(bc)} className="text-[10px] text-gray-600 hover:text-gray-400">Set primary</button>
                    : <span className="text-gray-700">—</span>
                  }
                </td>
                <td className="px-2 py-1.5">
                  {canEdit && <button onClick={() => handleDeleteBarcode(bc.barcode_id)} className="text-gray-700 hover:text-red-500">×</button>}
                </td>
              </tr>
            ))}
          </tbody>
          {canEdit && (
            <tfoot>
              <tr className="border-t border-gray-700">
                <td className="px-2 py-1.5">
                  <input className={addInputCls} placeholder="Barcode value"
                    value={addBarcode.barcode}
                    onChange={e => setAddBarcode(p => ({ ...p, barcode: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <select className={addInputCls} value={addBarcode.uom_id}
                    onChange={e => setAddBarcode(p => ({ ...p, uom_id: e.target.value }))}>
                    <option value="">UOM</option>
                    {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
                    <input type="checkbox" checked={addBarcode.is_primary}
                      onChange={e => setAddBarcode(p => ({ ...p, is_primary: e.target.checked }))} />
                    Primary
                  </label>
                </td>
                <td className="px-2 py-1.5">
                  <button onClick={handleAddBarcode}
                    className="text-[10px] font-medium text-white rounded px-2 py-0.5 whitespace-nowrap"
                    style={{ backgroundColor: 'var(--accent)' }}>Add</button>
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* ── UOM CONVERSIONS ── */}
        <SectionHead title="UOM Conversions" />
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {['From','To','Factor','Warehouse Bundle','Price','Promo Price',''].map(h =>
                <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {variant.uom_conversions.map(c => {
              const draft = getUomDraft(c)
              const basePrice = variant.price != null ? Number(variant.price) : null
              const inheritedPrice = basePrice != null
                ? (basePrice * Number(c.factor)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : null
              return (
                <tr key={`${c.from_uom_id}-${c.to_uom_id}`} className="border-b border-gray-800">
                  <td className="px-2 py-1.5 text-gray-300">{uoms.find(u => u.uom_id === c.from_uom_id)?.uom_code ?? c.from_uom_id}</td>
                  <td className="px-2 py-1.5 text-gray-300">{uoms.find(u => u.uom_id === c.to_uom_id)?.uom_code ?? c.to_uom_id}</td>
                  <td className="px-2 py-1.5 tabular-nums text-gray-400">{c.factor}</td>
                  <td className="px-2 py-1.5">
                    {c.is_warehouse_bundle
                      ? <span className="text-[10px] bg-emerald-950 text-emerald-500 rounded px-1.5 py-0.5">Yes</span>
                      : <span className="text-[10px] text-gray-700">No</span>
                    }
                    {canEdit && (
                      <button onClick={() => handleToggleWarehouseBundle(c)}
                        className="ml-2 text-[10px] text-gray-600 hover:text-gray-400 transition-colors">
                        Toggle
                      </button>
                    )}
                  </td>

                  {/* Price */}
                  <td className="px-2 py-1">
                    {canEdit ? (
                      <div>
                        <input
                          type="number" step="0.01" min="0"
                          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="—"
                          value={draft.price}
                          onChange={e => handleUomPriceChange(c, 'price', e.target.value)}
                          onBlur={() => handleUomPriceBlur(c, 'price')}
                        />
                        {draft.price === '' && inheritedPrice != null && (
                          <p className="text-[10px] text-gray-600 mt-0.5 whitespace-nowrap">
                            inherits: ₱{inheritedPrice}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        {c.price != null
                          ? <span className="tabular-nums text-gray-300">₱{Number(c.price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                          : inheritedPrice != null
                            ? <span className="text-gray-600 italic text-[10px]">inherits: ₱{inheritedPrice}</span>
                            : <span className="text-gray-700">—</span>
                        }
                      </div>
                    )}
                  </td>

                  {/* Promo Price */}
                  <td className="px-2 py-1">
                    {canEdit ? (
                      <input
                        type="number" step="0.01" min="0"
                        className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="—"
                        value={draft.promo_price}
                        onChange={e => handleUomPriceChange(c, 'promo_price', e.target.value)}
                        onBlur={() => handleUomPriceBlur(c, 'promo_price')}
                      />
                    ) : (
                      c.promo_price != null
                        ? <span className="tabular-nums text-emerald-400">₱{Number(c.promo_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        : <span className="text-gray-700">—</span>
                    )}
                  </td>

                  <td className="px-2 py-1.5">
                    {canEdit && <button onClick={() => handleDeleteUomConv(c)} className="text-gray-700 hover:text-red-500">×</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {canEdit && (
            <tfoot>
              <tr className="border-t border-gray-700">
                <td className="px-2 py-1.5">
                  <select className={addInputCls} value={addUomConv.from_uom_id}
                    onChange={e => setAddUomConv(p => ({ ...p, from_uom_id: e.target.value }))}>
                    <option value="">From</option>
                    {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select className={addInputCls} value={addUomConv.to_uom_id}
                    onChange={e => setAddUomConv(p => ({ ...p, to_uom_id: e.target.value }))}>
                    <option value="">To</option>
                    {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="0.0001" className={addInputCls} placeholder="Factor"
                    value={addUomConv.factor}
                    onChange={e => setAddUomConv(p => ({ ...p, factor: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
                    <input type="checkbox" checked={addUomConv.is_warehouse_bundle}
                      onChange={e => setAddUomConv(p => ({ ...p, is_warehouse_bundle: e.target.checked }))} />
                    WH Bundle
                  </label>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="0.01" min="0" className={addInputCls} placeholder="Price"
                    value={addUomConv.price}
                    onChange={e => setAddUomConv(p => ({ ...p, price: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="0.01" min="0" className={addInputCls} placeholder="Promo"
                    value={addUomConv.promo_price}
                    onChange={e => setAddUomConv(p => ({ ...p, promo_price: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <button onClick={handleAddUomConv}
                    className="text-[10px] font-medium text-white rounded px-2 py-0.5 whitespace-nowrap"
                    style={{ backgroundColor: 'var(--accent)' }}>Add</button>
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* ── BUNDLE COMPONENTS (conditional) ── */}
        {(isBundleType || canEdit) && (
          <>
            <SectionHead title="Bundle Components" />
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Component','Qty',''].map(h =>
                    <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(variant.bundle_components ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-gray-700 text-xs">
                      No components yet. Add one below to make this a bundle.
                    </td>
                  </tr>
                )}
                {(variant.bundle_components ?? []).map((c: BundleComp) => (
                  <tr key={c.component_variant_id} className="border-b border-gray-800">
                    <td className="px-2 py-1.5 text-gray-300">
                      {c.component_variant
                        ? <>{c.component_variant.variant_name}<span className="font-mono text-gray-600 ml-1">({c.component_variant.PID})</span></>
                        : `Variant ${c.component_variant_id}`}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-gray-500">× {c.quantity}</td>
                    <td className="px-2 py-1.5">
                      {canEdit && <button onClick={() => handleDeleteBundle(c)} className="text-gray-700 hover:text-red-500">×</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {canEdit && (
                <tfoot>
                  <tr className="border-t border-gray-700">
                    <td className="px-2 py-1.5 relative">
                      <input className={addInputCls} placeholder="Search component by PID or name…"
                        value={addBundle.searchPID}
                        onChange={e => { setAddBundle(p => ({ ...p, searchPID: e.target.value, component_variant_id: '' })); handleBundleSearch(e.target.value) }} />
                      {bundleSearch.length > 0 && (
                        <div className="absolute top-full left-0 w-64 bg-gray-900 border border-gray-700 rounded shadow-xl z-20 mt-0.5">
                          {bundleSearch.map(v => (
                            <button key={v.variant_id}
                              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 border-b border-gray-800"
                              onClick={() => { setAddBundle(p => ({ ...p, component_variant_id: String(v.variant_id), searchPID: `${v.variant_name} (${v.PID})` })); setBundleSearch([]) }}>
                              {v.variant_name}<span className="text-gray-600 font-mono ml-1">{v.PID}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" className={addInputCls} placeholder="Qty"
                        value={addBundle.quantity}
                        onChange={e => setAddBundle(p => ({ ...p, quantity: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={handleAddBundle} disabled={!addBundle.component_variant_id}
                        className="text-[10px] font-medium text-white rounded px-2 py-0.5 disabled:opacity-40 whitespace-nowrap"
                        style={{ backgroundColor: 'var(--accent)' }}>Add</button>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}

        {/* ── SUPPLIER LINKS ── */}
        <SectionHead title="Supplier Links" />
        {/* Supplier link inheritance — show default variant's links greyed out when non-default has none */}
        {!variant.is_default && variant.suppliers.length === 0 && (() => {
          const defaultV = product.variants.find(v => v.is_default)
          if (!defaultV || defaultV.suppliers.length === 0) return null
          return (
            <div className="mb-3 border border-gray-800 rounded-lg p-3 opacity-60">
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">
                Inheriting from default variant · {defaultV.variant_name}
              </p>
              <table className="w-full text-xs">
                <tbody>
                  {defaultV.suppliers.map(s => (
                    <tr key={s.id} className="border-b border-gray-800">
                      <td className="px-2 py-1.5 text-gray-500">{s.supplier.supplier_name}</td>
                      <td className="px-2 py-1.5 text-gray-600">{s.supplier_sku ?? '—'}</td>
                      <td className="px-2 py-1.5 text-gray-600 tabular-nums">{s.gross_cost != null ? Number(s.gross_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {canEdit && (
                <p className="text-[10px] text-gray-600 mt-2">
                  Add a supplier link below to override for this variant.
                </p>
              )}
            </div>
          )
        })()}
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {['Supplier','SKU','Gross Cost','Discount %','Primary',''].map(h =>
                <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {variant.suppliers.map(s => (
              <tr key={s.id} className="border-b border-gray-800">
                <td className="px-2 py-1.5 text-gray-300">{s.supplier.supplier_name}</td>

                {editingSupId === s.id ? (
                  <>
                    <td className="px-2 py-1">
                      <input className={smallInput} placeholder="SKU"
                        value={supEditForm.supplier_sku} onChange={e => setSupEditForm(f => ({ ...f, supplier_sku: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" className={`${smallInput} w-20`} placeholder="Gross cost"
                        value={supEditForm.gross_cost} onChange={e => setSupEditForm(f => ({ ...f, gross_cost: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" className={`${smallInput} w-16`} placeholder="Disc %"
                        value={supEditForm.supplier_discount} onChange={e => setSupEditForm(f => ({ ...f, supplier_discount: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1 text-gray-600 text-[10px]">—</td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1.5">
                        <button onClick={saveEditSupplier} className="text-[10px] text-white rounded px-2 py-0.5" style={{ backgroundColor: 'var(--accent)' }}>Save</button>
                        <button onClick={() => setEditingSupId(null)} className="text-[10px] text-gray-500 hover:text-gray-300">Cancel</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-1.5 text-gray-500">{s.supplier_sku ?? '—'}</td>
                    <td className="px-2 py-1.5 tabular-nums text-gray-300">{fmt(s.gross_cost)}</td>
                    <td className="px-2 py-1.5 tabular-nums text-gray-500">{s.supplier_discount}%</td>
                    <td className="px-2 py-1.5">
                      {s.is_primary
                        ? <span className="text-[10px] bg-emerald-950 text-emerald-500 rounded px-1.5 py-0.5">Primary</span>
                        : canEdit
                        ? <button onClick={() => handleTogglePrimarySupplier(s)} className="text-[10px] text-gray-600 hover:text-gray-400">Set primary</button>
                        : '—'
                      }
                    </td>
                    <td className="px-2 py-1.5">
                      {canEdit && (
                        <div className="flex gap-2">
                          <button onClick={() => startEditSupplier(s)} className="text-[10px] text-gray-500 hover:text-gray-300">Edit</button>
                          <button onClick={() => handleDeleteSupplierLink(s)} className="text-gray-700 hover:text-red-500">×</button>
                        </div>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {canEdit && (
            <tfoot>
              <tr className="border-t border-gray-700">
                <td className="px-2 py-1.5">
                  <select className={addInputCls} value={addSupplier.supplier_id}
                    onChange={e => setAddSupplier(p => ({ ...p, supplier_id: e.target.value }))}>
                    <option value="">— supplier —</option>
                    {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input className={addInputCls} placeholder="Supplier SKU"
                    value={addSupplier.supplier_sku}
                    onChange={e => setAddSupplier(p => ({ ...p, supplier_sku: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="0.01" className={addInputCls} placeholder="Gross cost"
                    value={addSupplier.gross_cost}
                    onChange={e => setAddSupplier(p => ({ ...p, gross_cost: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="0.01" className={addInputCls} placeholder="Disc %"
                    value={addSupplier.supplier_discount}
                    onChange={e => setAddSupplier(p => ({ ...p, supplier_discount: e.target.value }))} />
                </td>
                <td className="px-2 py-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
                    <input type="checkbox" checked={addSupplier.is_primary}
                      onChange={e => setAddSupplier(p => ({ ...p, is_primary: e.target.checked }))} />
                    Primary
                  </label>
                </td>
                <td className="px-2 py-1.5">
                  <button onClick={handleAddSupplierLink}
                    className="text-[10px] font-medium text-white rounded px-2 py-0.5 whitespace-nowrap"
                    style={{ backgroundColor: 'var(--accent)' }}>Add</button>
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* ── COST HISTORY ── */}
        <SectionHead title="Cost History" />
        <HistoryTable
          cols={['Date','Supplier','Old Cost','New Cost','Old Disc%','New Disc%','Changed By']}
          rows={costHist.map(h => [fmtDate(h.changed_at), h.supplier_name, fmt(h.old_gross_cost), fmt(h.new_gross_cost), h.old_supplier_discount != null ? `${h.old_supplier_discount}%` : '—', h.new_supplier_discount != null ? `${h.new_supplier_discount}%` : '—', h.changed_by_username ?? '—'])}
          hasMore={costHasMore}
          onLoadMore={() => loadMore('cost', costHist.length)}
          loading={histLoading === 'cost'}
        />

        {/* ── STOCK ── */}
        <SectionHead title="Stock" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1">Total Physical</p>
            <p className="text-lg font-bold text-gray-200 tabular-nums">
              {variant.current_stock.filter(s => s.location.location_type !== 'Virtual').reduce((sum, s) => sum + Number(s.quantity), 0).toFixed(2)}
            </p>
          </div>
        </div>
        <table className="w-full text-xs mb-2">
          <thead><tr className="border-b border-gray-800">
            {['Location','Type','Quantity'].map(h => <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">{h}</th>)}
          </tr></thead>
          <tbody>
            {physLocs.map(loc => {
              const entry = variant.current_stock.find(s => s.location.location_id === loc.location_id)
              return (
                <tr key={loc.location_id} className="border-b border-gray-800">
                  <td className="px-2 py-1.5 text-gray-300">{loc.location_name}</td>
                  <td className="px-2 py-1.5 text-gray-500">{loc.location_type}</td>
                  <td className="px-2 py-1.5 tabular-nums text-gray-300">{entry ? Number(entry.quantity).toFixed(2) : '0.00'}</td>
                </tr>
              )
            })}
            {virtLocs.map(loc => {
              const entry = variant.current_stock.find(s => s.location.location_id === loc.location_id)
              if (!entry || Number(entry.quantity) === 0) return null
              return (
                <tr key={loc.location_id} className="border-b border-gray-800 opacity-60">
                  <td className="px-2 py-1.5 text-gray-500 italic">{loc.location_name} (virtual)</td>
                  <td className="px-2 py-1.5 text-gray-600">Virtual</td>
                  <td className="px-2 py-1.5 tabular-nums text-gray-500">{Number(entry.quantity).toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* ── SALES HISTORY ── */}
        <SectionHead title="Sales History" />
        <HistoryTable
          cols={['Sale PID','Date','Cashier','Qty Sold','Unit Price','Line Total','Status']}
          rows={salesHist.map(h => [h.sale_pid, fmtDateOnly(h.transaction_date), h.cashier, h.quantity, fmt(h.unit_price), fmt(h.line_total), h.sale_status])}
          hasMore={salesHasMore}
          onLoadMore={() => loadMore('sales', salesHist.length)}
          loading={histLoading === 'sales'}
        />

        {/* ── PURCHASE HISTORY ── */}
        <SectionHead title="Purchase History" />
        <HistoryTable
          cols={['Shipment PID','Date','Supplier','Qty Received','Net Unit Cost','QC Status']}
          rows={purchaseHist.map(h => [h.shipment_pid, fmtDate(h.received_at), h.supplier_name, h.quantity_received, fmt(h.net_unit_cost), h.qc_status])}
          hasMore={purchHasMore}
          onLoadMore={() => loadMore('purchase', purchaseHist.length)}
          loading={histLoading === 'purchase'}
        />

        <div className="h-12" />
      </div>
    </div>

    {/* ── ADD VARIANT MODAL ── */}
    {showAddVariant && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={e => { if (e.target === e.currentTarget) setShowAddVariant(false) }}>
        <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

          {/* modal header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
            <p className="text-sm font-semibold text-gray-200">Add Variant — {product.brand}</p>
            <button onClick={() => setShowAddVariant(false)} className="text-gray-600 hover:text-gray-400 text-xl leading-none">×</button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {addVError && (
              <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2">{addVError}</div>
            )}

            {/* core fields */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={lCls}>Variant Name *</label>
                <input className={iCls} value={addVDraft.variant_name}
                  onChange={e => setAddVDraft(p => ({ ...p, variant_name: e.target.value }))} />
              </div>
              <div>
                <label className={lCls}>PID *</label>
                <input className={iCls} value={addVDraft.PID}
                  onChange={e => setAddVDraft(p => ({ ...p, PID: e.target.value }))} />
              </div>
              <div>
                <label className={lCls}>SKU</label>
                <input className={iCls} value={addVDraft.sku}
                  onChange={e => setAddVDraft(p => ({ ...p, sku: e.target.value }))} />
              </div>
              <div>
                <label className={lCls}>Price</label>
                <input type="number" step="0.01" className={iCls} value={addVDraft.price}
                  onChange={e => setAddVDraft(p => ({ ...p, price: e.target.value }))} />
              </div>
              <div>
                <label className={lCls}>Promo Price</label>
                <input type="number" step="0.01" className={iCls} value={addVDraft.promo_price}
                  onChange={e => setAddVDraft(p => ({ ...p, promo_price: e.target.value }))} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400">
                  <input type="checkbox" className="accent-blue-500" checked={addVDraft.is_default}
                    onChange={e => setAddVDraft(p => ({ ...p, is_default: e.target.checked }))} />
                  Set as default variant
                </label>
              </div>
            </div>

            {/* attributes */}
            <div>
              <label className={lCls}>Attributes</label>
              <div className="space-y-1.5">
                {addVDraft.attrs.map((a, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className={`${iCls} w-32`} placeholder="Key" value={a.key}
                      onChange={e => setAddVDraft(p => ({ ...p, attrs: p.attrs.map((x, j) => j === i ? { ...x, key: e.target.value } : x) }))} />
                    <input className={iCls} placeholder="Value" value={a.value}
                      onChange={e => setAddVDraft(p => ({ ...p, attrs: p.attrs.map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))} />
                    <button onClick={() => setAddVDraft(p => ({ ...p, attrs: p.attrs.filter((_, j) => j !== i) }))}
                      className="text-gray-700 hover:text-red-500 text-base">×</button>
                  </div>
                ))}
                <button onClick={() => setAddVDraft(p => ({ ...p, attrs: [...p.attrs, { key: '', value: '' }] }))}
                  className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add attribute</button>
              </div>
            </div>

            {/* barcodes */}
            <div className="border-t border-gray-800 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-medium uppercase tracking-widest text-gray-600">
                  Barcodes {addVDraft.barcodes.length > 0 && <span className="ml-1 text-blue-500">{addVDraft.barcodes.length}</span>}
                </p>
                <button
                  onClick={() => setAddVDraft(p => ({ ...p, barcodes: [...p.barcodes, { id: avUid(), barcode: '', uom_id: '', is_primary: false }] }))}
                  className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add</button>
              </div>
              {addVDraft.barcodes.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Barcode','UOM','Primary',''].map(h =>
                        <th key={h} className="text-left px-1 py-1 text-[10px] uppercase tracking-widest text-gray-700">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {addVDraft.barcodes.map(bc => (
                      <tr key={bc.id} className="border-b border-gray-800">
                        <td className="px-1 py-1">
                          <input className={addInputCls} placeholder="Barcode value" value={bc.barcode}
                            onChange={e => setAddVDraft(p => ({ ...p, barcodes: p.barcodes.map(b => b.id === bc.id ? { ...b, barcode: e.target.value } : b) }))} />
                        </td>
                        <td className="px-1 py-1">
                          <select className={addInputCls} value={bc.uom_id}
                            onChange={e => setAddVDraft(p => ({ ...p, barcodes: p.barcodes.map(b => b.id === bc.id ? { ...b, uom_id: e.target.value } : b) }))}>
                            <option value="">UOM</option>
                            {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap">
                            <input type="checkbox" checked={bc.is_primary}
                              onChange={e => setAddVDraft(p => ({ ...p, barcodes: p.barcodes.map(b => b.id === bc.id ? { ...b, is_primary: e.target.checked } : b) }))} />
                            Primary
                          </label>
                        </td>
                        <td className="px-1 py-1">
                          <button onClick={() => setAddVDraft(p => ({ ...p, barcodes: p.barcodes.filter(b => b.id !== bc.id) }))}
                            className="text-gray-700 hover:text-red-500">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* uom conversions */}
            <div className="border-t border-gray-800 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-medium uppercase tracking-widest text-gray-600">
                  UOM Conversions {addVDraft.uom_convs.length > 0 && <span className="ml-1 text-blue-500">{addVDraft.uom_convs.length}</span>}
                </p>
                <button
                  onClick={() => setAddVDraft(p => ({ ...p, uom_convs: [...p.uom_convs, { id: avUid(), from_uom_id: '', to_uom_id: '', factor: '', is_warehouse_bundle: false }] }))}
                  className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add</button>
              </div>
              {addVDraft.uom_convs.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['From','To','Factor','Wh. Bundle',''].map(h =>
                        <th key={h} className="text-left px-1 py-1 text-[10px] uppercase tracking-widest text-gray-700">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {addVDraft.uom_convs.map(uc => (
                      <tr key={uc.id} className="border-b border-gray-800">
                        <td className="px-1 py-1">
                          <select className={addInputCls} value={uc.from_uom_id}
                            onChange={e => setAddVDraft(p => ({ ...p, uom_convs: p.uom_convs.map(c => c.id === uc.id ? { ...c, from_uom_id: e.target.value } : c) }))}>
                            <option value="">From</option>
                            {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select className={addInputCls} value={uc.to_uom_id}
                            onChange={e => setAddVDraft(p => ({ ...p, uom_convs: p.uom_convs.map(c => c.id === uc.id ? { ...c, to_uom_id: e.target.value } : c) }))}>
                            <option value="">To</option>
                            {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" step="0.0001" className={addInputCls} placeholder="Factor" value={uc.factor}
                            onChange={e => setAddVDraft(p => ({ ...p, uom_convs: p.uom_convs.map(c => c.id === uc.id ? { ...c, factor: e.target.value } : c) }))} />
                        </td>
                        <td className="px-1 py-1">
                          <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap">
                            <input type="checkbox" checked={uc.is_warehouse_bundle}
                              onChange={e => setAddVDraft(p => ({ ...p, uom_convs: p.uom_convs.map(c => c.id === uc.id ? { ...c, is_warehouse_bundle: e.target.checked } : c) }))} />
                            Yes
                          </label>
                        </td>
                        <td className="px-1 py-1">
                          <button onClick={() => setAddVDraft(p => ({ ...p, uom_convs: p.uom_convs.filter(c => c.id !== uc.id) }))}
                            className="text-gray-700 hover:text-red-500">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* bundle */}
            <div className="border-t border-gray-800 pt-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 mb-3">
                <input type="checkbox" className="accent-blue-500" checked={addVDraft.is_bundle}
                  onChange={e => setAddVDraft(p => ({ ...p, is_bundle: e.target.checked }))} />
                This variant is a bundle
              </label>
              {addVDraft.is_bundle && (
                <div className="space-y-1.5">
                  <label className={lCls}>Bundle Components</label>
                  {addVDraft.bundle_comps.map(bc => (
                    <div key={bc.component_variant_id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 text-gray-300">{bc.label}</span>
                      <input type="number" min="0.01" step="any" className={`${iCls} w-16`} value={bc.quantity}
                        onChange={e => setAddVDraft(p => ({ ...p, bundle_comps: p.bundle_comps.map(c => c.component_variant_id === bc.component_variant_id ? { ...c, quantity: e.target.value } : c) }))} />
                      <button onClick={() => setAddVDraft(p => ({ ...p, bundle_comps: p.bundle_comps.filter(c => c.component_variant_id !== bc.component_variant_id) }))}
                        className="text-gray-600 hover:text-red-500">×</button>
                    </div>
                  ))}
                  <div className="relative">
                    <input className={iCls} placeholder="Search component by PID or name…" value={addVBundleQ}
                      onChange={e => handleAddVBundleSearch(e.target.value)} />
                    {addVBundleSearch.length > 0 && (
                      <div className="absolute top-full left-0 w-full bg-gray-900 border border-gray-700 rounded shadow-xl z-20 mt-0.5 max-h-40 overflow-y-auto">
                        {addVBundleSearch.map(v => (
                          <button key={v.variant_id} type="button"
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 border-b border-gray-800"
                            onClick={() => {
                              setAddVDraft(p => ({
                                ...p,
                                bundle_comps: p.bundle_comps.some(c => c.component_variant_id === v.variant_id)
                                  ? p.bundle_comps
                                  : [...p.bundle_comps, { component_variant_id: v.variant_id, quantity: '1', label: `${v.variant_name} (${v.PID})` }],
                              }))
                              setAddVBundleSearch([]); setAddVBundleQ('')
                            }}>
                            {v.variant_name} <span className="font-mono text-gray-600 ml-1">{v.PID}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* supplier link */}
            <div className="border-t border-gray-800 pt-3">
              <label className={lCls}>Supplier Link (optional)</label>
              <div className="flex gap-2 flex-wrap">
                <select className={`${iCls} flex-1 min-w-[120px]`} value={addVDraft.supplier_id}
                  onChange={e => setAddVDraft(p => ({ ...p, supplier_id: e.target.value }))}>
                  <option value="">— supplier —</option>
                  {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
                </select>
                <input className={`${iCls} w-28`} placeholder="Supplier SKU" value={addVDraft.supplier_sku}
                  onChange={e => setAddVDraft(p => ({ ...p, supplier_sku: e.target.value }))} />
                <input type="number" step="0.01" className={`${iCls} w-24`} placeholder="Gross cost" value={addVDraft.gross_cost}
                  onChange={e => setAddVDraft(p => ({ ...p, gross_cost: e.target.value }))} />
                <input type="number" step="0.01" className={`${iCls} w-20`} placeholder="Disc %" value={addVDraft.supplier_discount}
                  onChange={e => setAddVDraft(p => ({ ...p, supplier_discount: e.target.value }))} />
              </div>
            </div>

            {/* actions */}
            <div className="flex gap-3 pt-3 border-t border-gray-800">
              <button onClick={handleAddVariantSubmit} disabled={addVSaving}
                className="px-5 py-2 text-sm rounded text-white font-medium disabled:opacity-40 transition-colors"
                style={{ backgroundColor: 'var(--accent)' }}>
                {addVSaving ? 'Creating…' : 'Create Variant'}
              </button>
              <button onClick={() => { setShowAddVariant(false); setAddVError('') }}
                className="px-4 py-2 text-sm border border-gray-700 rounded text-gray-500 hover:border-gray-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
