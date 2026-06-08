import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { catalogueApi, type UOM, type Category, type InvSupplier, type InvVariant } from '../../services/api'
import ImportDiffModal, { type ImportPreviewResponse } from '../../components/ImportDiffModal'
import * as XLSX from 'xlsx'

// ── types ─────────────────────────────────────────────────────────────────────

interface AttrPair { key: string; value: string }
interface BundleDraftComp { component_variant_id: number; quantity: string; label: string }
interface BarcodeDraft { id: string; barcode: string; uom_id: string; is_primary: boolean }
interface UomConvDraft  { id: string; from_uom_id: string; to_uom_id: string; factor: string; is_warehouse_bundle: boolean }

interface VariantDraft {
  id: string
  variant_name: string
  PID: string
  sku: string
  price: string
  promo_price: string
  is_default: boolean
  is_bundle: boolean
  attrs: AttrPair[]
  bundle_comps: BundleDraftComp[]
  barcodes: BarcodeDraft[]
  uom_convs: UomConvDraft[]
  supplier_id: string
  supplier_sku: string
  gross_cost: string
  supplier_discount: string
}

function uid() { return Math.random().toString(36).slice(2, 10) }

function newVariant(isDefault = false): VariantDraft {
  return {
    id: uid(), variant_name: '', PID: '', sku: '', price: '', promo_price: '',
    is_default: isDefault, is_bundle: false,
    attrs: [], bundle_comps: [], barcodes: [], uom_convs: [],
    supplier_id: '', supplier_sku: '', gross_cost: '', supplier_discount: '0',
  }
}

// ── import template ───────────────────────────────────────────────────────────

const TEMPLATE_COLS = [
  // PID first — anchor column used by all imports
  'PID',                      // Required. Unique product identifier. MUST be leftmost.
  // Product (required)
  'product_brand',            // Required. Brand / product name.
  'product_type',             // Required. Inventory | Non-Inventory | Service
  // Product (optional)
  'description',
  'base_uom_code',            // e.g. PC  (must match an existing UOM code)
  'categories',               // Comma-separated, e.g. Electronics,Accessories
  // Variant (required)
  'variant_name',             // e.g. Default
  // Variant (optional)
  'SKU',
  'price',                    // e.g. 9.99
  'promo_price',
  // Attributes — add more attr_* columns as needed
  'attr_color',
  'attr_size',
  // Barcode (optional — one barcode per row; repeat row for additional barcodes)
  'barcode_value',            // e.g. 5901234123457
  'barcode_uom',              // UOM code the barcode represents, e.g. BOX
  'barcode_is_primary',       // TRUE or FALSE
  // UOM Conversion (optional — one conversion per row)
  'uom_from',                 // e.g. BOX
  'uom_to',                   // e.g. PC
  'uom_factor',               // e.g. 24  (means 1 BOX = 24 PC)
  'uom_is_warehouse_bundle',  // TRUE or FALSE — marks the warehouse counting unit
  // Supplier (optional)
  'supplier_code',            // Must exactly match an existing supplier code (e.g. SUP-001). Stable anchor — never changes.
  'supplier_sku',
  'gross_cost',               // e.g. 8.50
  'supplier_discount_pct',    // e.g. 10  (for 10%)
]

const TEMPLATE_EXAMPLE = [
  'WID-001',
  'Widget Pro', 'Inventory', 'Example product', 'PC', 'Electronics',
  'Default', 'WID-SKU-001', '9.99', '',
  'Red', 'Medium',
  '5901234123457', 'BOX', 'FALSE',
  'BOX', 'PC', '24', 'TRUE',
  'SUP-001', 'ACM-001', '7.50', '5',
]

// ── import result type ────────────────────────────────────────────────────────

interface ImportResult { row: number; status: 'ok' | 'error'; message: string }

// ── component ─────────────────────────────────────────────────────────────────

export default function NewProduct() {
  const navigate = useNavigate()

  const [uoms,      setUoms]      = useState<UOM[]>([])
  const [cats,      setCats]      = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<InvSupplier[]>([])

  const [productName,  setProductName]  = useState('')
  const [productType,  setProductType]  = useState('Inventory')
  const [description,  setDescription]  = useState('')
  const [baseUomId,    setBaseUomId]    = useState<number | ''>('')
  const [selectedCats, setSelectedCats] = useState<number[]>([])

  const [variants, setVariants] = useState<VariantDraft[]>([newVariant(true)])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  // which expandable sub-sections are open per variant id
  const [openSections, setOpenSections] = useState<Record<string, { barcodes: boolean; uomConvs: boolean }>>({})

  // bundle search state keyed by variant draft id
  const [bundleSearch, setBundleSearch] = useState<Record<string, { q: string; results: InvVariant[] }>>({})

  // import state
  const [importResults,      setImportResults]      = useState<ImportResult[]>([])
  const [importing,          setImporting]          = useState(false)
  const [diffPreview,        setDiffPreview]        = useState<ImportPreviewResponse | null>(null)
  const [pendingRows,        setPendingRows]        = useState<unknown[]>([])
  const [pendingUomRows,     setPendingUomRows]     = useState<Record<string, unknown>[]>([])
  const [pendingSupplierRows,setPendingSupplierRows]= useState<Record<string, unknown>[]>([])

  useEffect(() => {
    Promise.allSettled([
      catalogueApi.uoms.list(),
      catalogueApi.categories.list(),
      catalogueApi.suppliers.list(),
    ]).then(([u, c, s]) => {
      if (u.status === 'fulfilled') setUoms(u.value.filter(x => !x.is_deleted))
      if (c.status === 'fulfilled') setCats(c.value.filter(x => !x.is_deleted))
      if (s.status === 'fulfilled') setSuppliers(s.value.filter(x => !x.is_deleted))
    })
  }, [])

  // ── section toggle ────────────────────────────────────────────────────────
  function toggleSection(vid: string, section: 'barcodes' | 'uomConvs') {
    setOpenSections(prev => ({
      ...prev,
      [vid]: { barcodes: false, uomConvs: false, ...(prev[vid] ?? {}), [section]: !(prev[vid]?.[section]) },
    }))
  }
  function isSectionOpen(vid: string, section: 'barcodes' | 'uomConvs') {
    return openSections[vid]?.[section] ?? false
  }

  // ── variant helpers ───────────────────────────────────────────────────────
  function updateVariant(id: string, field: keyof VariantDraft, value: unknown) {
    setVariants(prev => prev.map(v => {
      if (v.id !== id) return v
      const updated = { ...v, [field]: value }
      if (field === 'sku' && (v.supplier_sku === '' || v.supplier_sku === v.sku)) {
        updated.supplier_sku = (value as string) ?? ''
      }
      return updated
    }))
  }
  function setDefault(id: string) {
    setVariants(prev => prev.map(v => ({ ...v, is_default: v.id === id })))
  }
  function addVariant() {
    setVariants(prev => [...prev, newVariant(false)])
  }
  function removeVariant(id: string) {
    setVariants(prev => {
      const next = prev.filter(v => v.id !== id)
      if (next.length === 0) return prev
      if (!next.some(v => v.is_default)) next[0].is_default = true
      return next
    })
  }

  // ── attribute helpers ─────────────────────────────────────────────────────
  function addAttr(id: string) {
    setVariants(prev => prev.map(v =>
      v.id === id ? { ...v, attrs: [...v.attrs, { key: '', value: '' }] } : v
    ))
  }
  function updateAttr(vid: string, idx: number, field: 'key' | 'value', val: string) {
    setVariants(prev => prev.map(v => {
      if (v.id !== vid) return v
      const next = [...v.attrs]; next[idx] = { ...next[idx], [field]: val }
      return { ...v, attrs: next }
    }))
  }
  function removeAttr(vid: string, idx: number) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, attrs: v.attrs.filter((_, i) => i !== idx) }
    ))
  }

  // ── barcode helpers ───────────────────────────────────────────────────────
  function addBarcodeDraft(vid: string) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, barcodes: [...v.barcodes, { id: uid(), barcode: '', uom_id: '', is_primary: false }] }
    ))
  }
  function updateBarcodeDraft(vid: string, bid: string, field: keyof BarcodeDraft, value: unknown) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, barcodes: v.barcodes.map(b => b.id === bid ? { ...b, [field]: value } : b) }
    ))
  }
  function removeBarcodeDraft(vid: string, bid: string) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, barcodes: v.barcodes.filter(b => b.id !== bid) }
    ))
  }

  // ── UOM conversion helpers ────────────────────────────────────────────────
  function addUomConvDraft(vid: string) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, uom_convs: [...v.uom_convs, { id: uid(), from_uom_id: '', to_uom_id: '', factor: '', is_warehouse_bundle: false }] }
    ))
  }
  function updateUomConvDraft(vid: string, cid: string, field: keyof UomConvDraft, value: unknown) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, uom_convs: v.uom_convs.map(c => c.id === cid ? { ...c, [field]: value } : c) }
    ))
  }
  function removeUomConvDraft(vid: string, cid: string) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, uom_convs: v.uom_convs.filter(c => c.id !== cid) }
    ))
  }

  // ── bundle helpers ────────────────────────────────────────────────────────
  async function searchBundle(vid: string, q: string) {
    setBundleSearch(prev => ({ ...prev, [vid]: { q, results: [] } }))
    if (!q.trim()) return
    const all = await catalogueApi.products.list()
    const results: InvVariant[] = []
    for (const p of all)
      for (const v of p.variants)
        if (!v.is_deleted && (v.PID.toLowerCase().includes(q.toLowerCase()) || v.variant_name.toLowerCase().includes(q.toLowerCase()))) {
          results.push(v); if (results.length >= 10) break
        }
    setBundleSearch(prev => ({ ...prev, [vid]: { q, results } }))
  }
  function addBundleComp(vid: string, comp: InvVariant) {
    setVariants(prev => prev.map(v => {
      if (v.id !== vid) return v
      if (v.bundle_comps.some(c => c.component_variant_id === comp.variant_id)) return v
      return { ...v, bundle_comps: [...v.bundle_comps, { component_variant_id: comp.variant_id, quantity: '1', label: `${comp.variant_name} (${comp.PID})` }] }
    }))
    setBundleSearch(prev => ({ ...prev, [vid]: { q: '', results: [] } }))
  }
  function removeBundleComp(vid: string, componentId: number) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, bundle_comps: v.bundle_comps.filter(c => c.component_variant_id !== componentId) }
    ))
  }
  function updateBundleCompQty(vid: string, componentId: number, qty: string) {
    setVariants(prev => prev.map(v =>
      v.id !== vid ? v : { ...v, bundle_comps: v.bundle_comps.map(c => c.component_variant_id === componentId ? { ...c, quantity: qty } : c) }
    ))
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError('')
    if (!productName.trim()) { setError('Product brand/name is required.'); return }
    if (variants.some(v => !v.PID.trim() || !v.variant_name.trim())) {
      setError('All variants need a name and PID.'); return
    }
    setSaving(true)
    try {
      const categoryNames = cats.filter(c => selectedCats.includes(c.category_id)).map(c => c.category_name)
      const payload = {
        brand: productName.trim(), product_type: productType,
        description: description.trim() || null, base_uom_id: baseUomId || null,
        category_names: categoryNames,
        variants: variants.map(v => ({
          PID: v.PID.trim(), variant_name: v.variant_name.trim(),
          sku: v.sku.trim() || null,
          price: v.price ? parseFloat(v.price) : null,
          promo_price: v.promo_price ? parseFloat(v.promo_price) : null,
          is_default: v.is_default,
          attributes: v.attrs.length > 0
            ? Object.fromEntries(v.attrs.filter(a => a.key.trim()).map(a => [a.key, a.value]))
            : null,
        })),
      }
      const created = await catalogueApi.products.create(payload)
      const createdVariants = created.variants

      for (const draft of variants) {
        const matchedV = createdVariants.find(cv => cv.PID === draft.PID.trim() && cv.variant_name === draft.variant_name.trim())
        if (!matchedV) continue

        // Supplier link
        if (draft.supplier_id) {
          await catalogueApi.supplierLinks.create(matchedV.variant_id, {
            supplier_id: parseInt(draft.supplier_id),
            supplier_sku: draft.supplier_sku || null,
            gross_cost: draft.gross_cost ? parseFloat(draft.gross_cost) : null,
            supplier_discount: parseFloat(draft.supplier_discount) || 0, is_primary: true,
          }).catch(() => {})
        }
        // Bundle components
        for (const bc of draft.bundle_comps) {
          await catalogueApi.bundleComponents.create(matchedV.variant_id, {
            component_variant_id: bc.component_variant_id, quantity: parseFloat(bc.quantity) || 1,
          }).catch(() => {})
        }
        // Barcodes
        for (const bc of draft.barcodes.filter(b => b.barcode.trim())) {
          await catalogueApi.barcodes.create(matchedV.variant_id, {
            barcode: bc.barcode.trim(),
            uom_id: bc.uom_id ? parseInt(bc.uom_id) : null,
            is_primary: bc.is_primary,
          }).catch(() => {})
        }
        // UOM conversions
        for (const uc of draft.uom_convs.filter(c => c.from_uom_id && c.to_uom_id && c.factor)) {
          await catalogueApi.uomConversions.create(matchedV.variant_id, {
            from_uom_id: parseInt(uc.from_uom_id),
            to_uom_id: parseInt(uc.to_uom_id),
            factor: parseFloat(uc.factor),
            is_warehouse_bundle: uc.is_warehouse_bundle,
          }).catch(() => {})
        }
      }

      const defaultV = created.variants.find(v => v.is_default) ?? created.variants[0]
      navigate(`/inventory/${defaultV.variant_id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally { setSaving(false) }
  }

  // ── XLSX template download — three-sheet format ──────────────────────────
  function downloadTemplate() {
    const wb = XLSX.utils.book_new()

    // Sheet 1 — Variants (PID leftmost, one row = one product + variant)
    const variantCols    = ['PID','product_brand','product_type','variant_name','description','base_uom_code','categories','SKU','price','promo_price','attr_color','attr_size']
    const variantExample = ['WID-001','Widget Pro','Inventory','Default','Example product','PC','Electronics,Accessories','WID-SKU-001','9.99','','Red','Medium']
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([variantCols, variantExample]), 'Variants')

    // Sheet 2 — UOM Conversions (PID leftmost, composite key: PID + from_uom + to_uom)
    const uomCols    = ['PID','from_uom','to_uom','factor','is_warehouse_bundle']
    const uomExample = ['WID-001','BOX','PC','24','TRUE']
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([uomCols, uomExample]), 'UOM Conversions')

    // Sheet 3 — Supplier Links (PID leftmost, composite key: PID + supplier_code)
    const supplierCols    = ['PID','supplier_code','supplier_sku','gross_cost','supplier_discount_pct','is_primary']
    const supplierExample = ['WID-001','SUP-001','ACM-001','7.50','5','TRUE']
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([supplierCols, supplierExample]), 'Supplier Links')

    XLSX.writeFile(wb, 'inventory_import_template.xlsx')
  }

  // ── XLSX import — reads three sheets ─────────────────────────────────────
  async function handleImportFile(file: File) {
    setImporting(true); setImportResults([])
    const buf = await file.arrayBuffer()
    const wb  = XLSX.read(buf)

    // Sheet 1: Variants (PID leftmost)
    const variantRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]] ?? {})
    // Sheet 2: UOM Conversions (optional)
    const uomRows = wb.SheetNames[1]
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[1]])
      : []
    // Sheet 3: Supplier Links (optional)
    const supplierRows = wb.SheetNames[2]
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[2]])
      : []

    const productRows: unknown[] = []
    for (const row of variantRows) {
      if (!row['PID'] || !row['product_brand'] || !row['variant_name']) continue
      const categoryNames = row['categories']
        ? String(row['categories']).split(',').map(s => s.trim()).filter(Boolean) : []
      const attrs: Record<string, unknown> = {}
      for (const col of Object.keys(row)) if (col.startsWith('attr_')) attrs[col.replace('attr_', '')] = row[col]
      const uomMatch = uoms.find(u => u.uom_code === String(row['base_uom_code'] ?? '').trim().toUpperCase())
      productRows.push({
        brand:          String(row['product_brand']).trim(),
        product_type:   String(row['product_type'] ?? 'Inventory'),
        description:    row['description'] ? String(row['description']) : null,
        base_uom_id:    uomMatch?.uom_id ?? null,
        category_names: categoryNames,
        variants: [{
          PID:          String(row['PID']).trim(),
          variant_name: String(row['variant_name']).trim(),
          sku:          row['SKU'] ? String(row['SKU']) : null,
          price:        row['price'] ? parseFloat(String(row['price'])) : null,
          promo_price:  row['promo_price'] ? parseFloat(String(row['promo_price'])) : null,
          is_default:   true,
          attributes:   Object.keys(attrs).length > 0 ? attrs : null,
        }],
      })
    }

    setPendingUomRows(uomRows)
    setPendingSupplierRows(supplierRows)

    try {
      const preview = await catalogueApi.importOps.preview(productRows)
      setPendingRows(productRows)
      setDiffPreview(preview as ImportPreviewResponse)
    } catch (e: unknown) {
      setImportResults([{ row: 0, status: 'error', message: e instanceof Error ? e.message : 'Preview failed' }])
    } finally {
      setImporting(false)
    }
  }

  async function handleDiffConfirm(confirmedPids: string[]) {
    const results: ImportResult[] = []
    try {
      // Step 1: confirm variant creates/updates
      const confirmed = await catalogueApi.importOps.confirm(pendingRows, confirmedPids)
      confirmed.forEach(p =>
        p.variants.forEach(v => results.push({ row: 0, status: 'ok', message: `Variant: ${p.brand} / ${v.PID}` }))
      )

      // Build PID → variant map from confirmed results for follow-up sheet processing
      const pidMap = new Map<string, typeof confirmed[0]['variants'][0]>()
      confirmed.forEach(p => p.variants.forEach(v => pidMap.set(v.PID, v)))

      // Step 2: UOM Conversions (Sheet 2) — composite key PID + from_uom + to_uom
      for (const row of pendingUomRows) {
        const pid = String(row['PID'] ?? '').trim()
        if (!pid || !row['from_uom'] || !row['to_uom'] || !row['factor']) continue
        const variant = pidMap.get(pid)
        if (!variant) { results.push({ row: 0, status: 'error', message: `UOM: PID '${pid}' not found in confirmed variants` }); continue }
        const fromUom = uoms.find(u => u.uom_code === String(row['from_uom']).trim().toUpperCase())
        const toUom   = uoms.find(u => u.uom_code === String(row['to_uom']).trim().toUpperCase())
        if (!fromUom || !toUom) { results.push({ row: 0, status: 'error', message: `UOM: unknown UOM code in row for ${pid}` }); continue }
        const factor = parseFloat(String(row['factor']))
        const isWB   = String(row['is_warehouse_bundle'] ?? '').toUpperCase() === 'TRUE'
        const existing = variant.uom_conversions?.find(c => c.from_uom_id === fromUom.uom_id && c.to_uom_id === toUom.uom_id)
        try {
          if (existing) {
            await catalogueApi.uomConversions.update(variant.variant_id, fromUom.uom_id, toUom.uom_id, { factor, is_warehouse_bundle: isWB })
          } else {
            await catalogueApi.uomConversions.create(variant.variant_id, { from_uom_id: fromUom.uom_id, to_uom_id: toUom.uom_id, factor, is_warehouse_bundle: isWB })
          }
          results.push({ row: 0, status: 'ok', message: `UOM: ${pid} ${row['from_uom']}→${row['to_uom']} (${existing ? 'updated' : 'created'})` })
        } catch (e: unknown) {
          results.push({ row: 0, status: 'error', message: `UOM ${pid}: ${e instanceof Error ? e.message : 'failed'}` })
        }
      }

      // Step 3: Supplier Links (Sheet 3) — composite key PID + supplier_code
      for (const row of pendingSupplierRows) {
        const pid          = String(row['PID'] ?? '').trim()
        const supplierCode = String(row['supplier_code'] ?? '').trim()
        if (!pid || !supplierCode) continue
        const variant  = pidMap.get(pid)
        if (!variant) { results.push({ row: 0, status: 'error', message: `Supplier: PID '${pid}' not found in confirmed variants` }); continue }
        const supplier = suppliers.find(s => s.supplier_code.toLowerCase() === supplierCode.toLowerCase())
        if (!supplier) { results.push({ row: 0, status: 'error', message: `Supplier: code '${supplierCode}' not found` }); continue }
        const payload = {
          supplier_id:       supplier.supplier_id,
          supplier_sku:      row['supplier_sku']          ? String(row['supplier_sku']) : null,
          gross_cost:        row['gross_cost']             ? parseFloat(String(row['gross_cost'])) : null,
          supplier_discount: row['supplier_discount_pct'] ? parseFloat(String(row['supplier_discount_pct'])) : 0,
          is_primary:        String(row['is_primary'] ?? '').toUpperCase() === 'TRUE',
        }
        const existing = variant.suppliers?.find(s => s.supplier.supplier_id === supplier.supplier_id)
        try {
          if (existing) {
            await catalogueApi.supplierLinks.update(variant.variant_id, existing.id, payload)
          } else {
            await catalogueApi.supplierLinks.create(variant.variant_id, payload)
          }
          results.push({ row: 0, status: 'ok', message: `Supplier: ${pid} → ${supplierCode} (${existing ? 'updated' : 'created'})` })
        } catch (e: unknown) {
          results.push({ row: 0, status: 'error', message: `Supplier ${pid}: ${e instanceof Error ? e.message : 'failed'}` })
        }
      }

    } catch (e: unknown) {
      results.push({ row: 0, status: 'error', message: e instanceof Error ? e.message : 'Confirm failed' })
    }
    setImportResults(results)
    setDiffPreview(null)
    setPendingRows([])
    setPendingUomRows([])
    setPendingSupplierRows([])
  }

  // ─────────────────────────────────────────────────────────────────────────
  const iCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest text-gray-600 mb-1'
  const sCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'

  return (
    <>
    <div className="min-h-full bg-gray-950 px-6 py-5">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate('/inventory')} className="text-xs text-gray-600 hover:text-gray-400">← Inventory</button>
          <span className="text-gray-700">/</span>
          <span className="text-sm font-semibold text-gray-300">New Product</span>
        </div>

        {error && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-4">{error}</div>}

        {/* ── PRODUCT INFO ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-3">Product Info</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={lCls}>Brand *</label>
              <input className={`${iCls} w-full`} value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Widget Pro" />
            </div>
            <div>
              <label className={lCls}>Product Type *</label>
              <select className={`${iCls} w-full`} value={productType} onChange={e => setProductType(e.target.value)}>
                {['Inventory','Non-Inventory','Service'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Base UOM</label>
              <select className={`${iCls} w-full`} value={baseUomId} onChange={e => setBaseUomId(e.target.value ? parseInt(e.target.value) : '')}>
                <option value="">— none —</option>
                {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
              </select>
            </div>
            <div className="col-span-full">
              <label className={lCls}>Description</label>
              <textarea className={`${iCls} w-full h-16 resize-none`} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="col-span-full">
              <label className={lCls}>Categories</label>
              <div className="flex flex-wrap gap-1.5">
                {cats.map(c => {
                  const active = selectedCats.includes(c.category_id)
                  return (
                    <button key={c.category_id} type="button"
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${active ? 'text-white border-transparent' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
                      style={active ? { backgroundColor: 'var(--accent)' } : undefined}
                      onClick={() => setSelectedCats(prev => active ? prev.filter(id => id !== c.category_id) : [...prev, c.category_id])}>
                      {c.category_name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── VARIANTS ── */}
        <div className="mb-4 space-y-3">
          {variants.map((v, idx) => (
            <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Variant {idx + 1} {v.is_default && <span className="ml-1 text-[9px] bg-blue-950 text-blue-400 rounded px-1">Default</span>}
                </p>
                <div className="flex gap-2">
                  {!v.is_default && <button type="button" onClick={() => setDefault(v.id)} className="text-[10px] text-gray-600 hover:text-gray-400">Set default</button>}
                  {variants.length > 1 && <button type="button" onClick={() => removeVariant(v.id)} className="text-[10px] text-red-700 hover:text-red-500">Remove</button>}
                </div>
              </div>

              {/* core fields */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ['Variant Name *','variant_name','text','Default'],
                  ['PID *','PID','text','PROD-001'],
                  ['SKU','sku','text',''],
                  ['Price','price','number','0.00'],
                  ['Promo Price','promo_price','number',''],
                ] as [string,keyof VariantDraft,string,string][]).map(([label, field, type, ph]) => (
                  <div key={field}>
                    <label className={lCls}>{label}</label>
                    <input type={type} step={type === 'number' ? '0.01' : undefined}
                      className={`${iCls} w-full`} placeholder={ph}
                      value={String(v[field] ?? '')}
                      onChange={e => updateVariant(v.id, field, e.target.value)} />
                  </div>
                ))}
              </div>

              {/* attributes */}
              <div className="mt-3">
                <label className={lCls}>Attributes</label>
                {v.attrs.map((a, i) => (
                  <div key={i} className="flex gap-2 mb-1">
                    <input className={`${iCls} w-28`} placeholder="Key" value={a.key} onChange={e => updateAttr(v.id, i, 'key', e.target.value)} />
                    <input className={`${iCls} flex-1`} placeholder="Value" value={a.value} onChange={e => updateAttr(v.id, i, 'value', e.target.value)} />
                    <button type="button" onClick={() => removeAttr(v.id, i)} className="text-gray-700 hover:text-red-500">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => addAttr(v.id)} className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add attribute</button>
              </div>

              {/* ── BARCODES ── */}
              <div className="mt-3 border-t border-gray-800 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-gray-600">
                    Barcodes {v.barcodes.length > 0 && <span className="ml-1 text-blue-500">{v.barcodes.length}</span>}
                  </p>
                  <button type="button" onClick={() => { addBarcodeDraft(v.id); if (!isSectionOpen(v.id, 'barcodes')) toggleSection(v.id, 'barcodes') }}
                    className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add</button>
                </div>
                {(v.barcodes.length > 0 || isSectionOpen(v.id, 'barcodes')) && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Barcode','UOM','Primary',''].map(h =>
                          <th key={h} className="text-left px-1 py-1 text-[10px] uppercase tracking-widest text-gray-700">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {v.barcodes.map(bc => (
                        <tr key={bc.id} className="border-b border-gray-800">
                          <td className="px-1 py-1">
                            <input className={sCls} placeholder="Barcode value" value={bc.barcode}
                              onChange={e => updateBarcodeDraft(v.id, bc.id, 'barcode', e.target.value)} />
                          </td>
                          <td className="px-1 py-1">
                            <select className={sCls} value={bc.uom_id}
                              onChange={e => updateBarcodeDraft(v.id, bc.id, 'uom_id', e.target.value)}>
                              <option value="">UOM</option>
                              {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap">
                              <input type="checkbox" checked={bc.is_primary}
                                onChange={e => updateBarcodeDraft(v.id, bc.id, 'is_primary', e.target.checked)} />
                              Primary
                            </label>
                          </td>
                          <td className="px-1 py-1">
                            <button type="button" onClick={() => removeBarcodeDraft(v.id, bc.id)} className="text-gray-700 hover:text-red-500">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── UOM CONVERSIONS ── */}
              <div className="mt-3 border-t border-gray-800 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-gray-600">
                    UOM Conversions {v.uom_convs.length > 0 && <span className="ml-1 text-blue-500">{v.uom_convs.length}</span>}
                  </p>
                  <button type="button" onClick={() => { addUomConvDraft(v.id); if (!isSectionOpen(v.id, 'uomConvs')) toggleSection(v.id, 'uomConvs') }}
                    className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">+ Add</button>
                </div>
                {(v.uom_convs.length > 0 || isSectionOpen(v.id, 'uomConvs')) && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['From','To','Factor','Wh. Bundle',''].map(h =>
                          <th key={h} className="text-left px-1 py-1 text-[10px] uppercase tracking-widest text-gray-700">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {v.uom_convs.map(uc => (
                        <tr key={uc.id} className="border-b border-gray-800">
                          <td className="px-1 py-1">
                            <select className={sCls} value={uc.from_uom_id}
                              onChange={e => updateUomConvDraft(v.id, uc.id, 'from_uom_id', e.target.value)}>
                              <option value="">From</option>
                              {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <select className={sCls} value={uc.to_uom_id}
                              onChange={e => updateUomConvDraft(v.id, uc.id, 'to_uom_id', e.target.value)}>
                              <option value="">To</option>
                              {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <input type="number" step="0.0001" className={sCls} placeholder="Factor" value={uc.factor}
                              onChange={e => updateUomConvDraft(v.id, uc.id, 'factor', e.target.value)} />
                          </td>
                          <td className="px-1 py-1">
                            <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap">
                              <input type="checkbox" checked={uc.is_warehouse_bundle}
                                onChange={e => updateUomConvDraft(v.id, uc.id, 'is_warehouse_bundle', e.target.checked)} />
                              Yes
                            </label>
                          </td>
                          <td className="px-1 py-1">
                            <button type="button" onClick={() => removeUomConvDraft(v.id, uc.id)} className="text-gray-700 hover:text-red-500">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* is bundle toggle */}
              <div className="mt-3 border-t border-gray-800 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-blue-500" checked={v.is_bundle}
                    onChange={e => updateVariant(v.id, 'is_bundle', e.target.checked)} />
                  <span className="text-xs text-gray-400">This variant is a bundle</span>
                </label>
              </div>

              {/* bundle components */}
              {v.is_bundle && (
                <div className="mt-3 space-y-1.5">
                  <label className={lCls}>Bundle Components</label>
                  {v.bundle_comps.map(bc => (
                    <div key={bc.component_variant_id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 text-gray-300">{bc.label}</span>
                      <input type="number" min="0.01" step="any" className={`${iCls} w-16`} value={bc.quantity}
                        onChange={e => updateBundleCompQty(v.id, bc.component_variant_id, e.target.value)} />
                      <button type="button" onClick={() => removeBundleComp(v.id, bc.component_variant_id)} className="text-gray-600 hover:text-red-500">×</button>
                    </div>
                  ))}
                  <div className="relative">
                    <input className={`${iCls} w-full`} placeholder="Search component by PID or name…"
                      value={bundleSearch[v.id]?.q ?? ''}
                      onChange={e => searchBundle(v.id, e.target.value)} />
                    {(bundleSearch[v.id]?.results ?? []).length > 0 && (
                      <div className="absolute top-full left-0 w-full bg-gray-900 border border-gray-700 rounded shadow-xl z-20 mt-0.5 max-h-40 overflow-y-auto">
                        {bundleSearch[v.id].results.map(r => (
                          <button key={r.variant_id} type="button"
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 border-b border-gray-800"
                            onClick={() => addBundleComp(v.id, r)}>
                            {r.variant_name} <span className="font-mono text-gray-600 ml-1">{r.PID}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* optional supplier link */}
              <div className="mt-3 border-t border-gray-800 pt-3">
                <label className={lCls}>Supplier Link (optional)</label>
                <div className="flex gap-2 flex-wrap">
                  <select className={`${iCls} w-36`} value={v.supplier_id} onChange={e => updateVariant(v.id, 'supplier_id', e.target.value)}>
                    <option value="">— supplier —</option>
                    {suppliers.filter(s => !s.is_deleted).map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_code} — {s.supplier_name}</option>)}
                  </select>
                  <input className={`${iCls} w-24`} placeholder="Supplier SKU" value={v.supplier_sku} onChange={e => updateVariant(v.id, 'supplier_sku', e.target.value)} />
                  <input type="number" step="0.01" className={`${iCls} w-24`} placeholder="Gross cost" value={v.gross_cost} onChange={e => updateVariant(v.id, 'gross_cost', e.target.value)} />
                  <input type="number" step="0.01" className={`${iCls} w-20`} placeholder="Disc %" value={v.supplier_discount} onChange={e => updateVariant(v.id, 'supplier_discount', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={addVariant}
          className="w-full mb-4 py-2 text-xs border border-dashed border-gray-700 rounded text-gray-600 hover:border-gray-600 hover:text-gray-400 transition-colors">
          + Add Variant
        </button>

        <div className="flex gap-3 mb-8">
          <button type="button" onClick={handleSubmit} disabled={saving}
            className="px-6 py-2 text-sm rounded text-white font-medium disabled:opacity-40 transition-colors"
            style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? 'Creating…' : 'Create Product'}
          </button>
          <button type="button" onClick={() => navigate('/inventory')}
            className="px-4 py-2 text-sm border border-gray-700 rounded text-gray-500 hover:border-gray-600">
            Cancel
          </button>
        </div>

        {/* ── IMPORT SECTION ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-3">Bulk Import</p>
          <p className="text-xs text-gray-600 mb-4">
            Download the template (3 sheets), fill in each sheet, then upload. <strong>Sheet 1 — Variants</strong>: one row per variant, PID as anchor.
            <strong> Sheet 2 — UOM Conversions</strong>: PID + from/to UOM as composite key, upserts existing rows.
            <strong> Sheet 3 — Supplier Links</strong>: PID + supplier name as composite key, upserts existing rows.
          </p>
          <div className="flex gap-3 mb-4">
            <button type="button" onClick={downloadTemplate}
              className="px-4 py-2 text-xs border border-gray-700 rounded text-gray-400 hover:border-gray-600 hover:text-gray-200 transition-colors">
              Download Template
            </button>
            <label className="px-4 py-2 text-xs rounded text-white font-medium cursor-pointer transition-colors"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}>
              {importing ? 'Importing…' : 'Upload & Import'}
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleImportFile(e.target.files[0]) }} />
            </label>
          </div>
          {importResults.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1">
                Results: {importResults.filter(r => r.status === 'ok').length} ok,{' '}
                {importResults.filter(r => r.status === 'error').length} errors
              </p>
              {importResults.map(r => (
                <div key={r.row} className={`text-xs px-2 py-1 rounded ${r.status === 'ok' ? 'bg-emerald-950 text-emerald-500' : 'bg-red-950 text-red-400'}`}>
                  Row {r.row}: {r.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Import diff modal */}
    {diffPreview && (
      <ImportDiffModal
        preview={diffPreview}
        onConfirm={handleDiffConfirm}
        onCancel={() => { setDiffPreview(null); setPendingRows([]) }}
      />
    )}
    </>
  )
}
