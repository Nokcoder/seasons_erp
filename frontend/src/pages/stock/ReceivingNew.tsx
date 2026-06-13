import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { FetchingBar } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  stockApi, catalogueApi, inventoryApi, authApi,
  type InvProduct, type InvVariant, type EmployeeOut,
} from '../../services/api'
import * as XLSX from 'xlsx'
import { normalize } from '../../lib/normalize'

// ui_standards §10 — onFocus selects all numeric input value
const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

// ── bundle count mechanic (ui_standards §8) ────────────────────────────────
function getWarehouseBundle(v: InvVariant) {
  return v.uom_conversions?.find(c => c.is_warehouse_bundle) ?? null
}

const QC_OPTIONS = ['Passed', 'Partially_Passed', 'Failed', 'Pending'] as const
type QCStatus = typeof QC_OPTIONS[number]

interface LineItem {
  variant:     InvVariant
  product:     InvProduct
  bundleCount: string
  qtyDeclared: string
  qtyActual:   string
  qtyRejected: string
  qcStatus:    QCStatus
}

// Auto-suggest QC status based on quantities
function suggestQC(qtyActual: string, qtyRejected: string): QCStatus {
  const actual   = parseFloat(qtyActual)   || 0
  const rejected = parseFloat(qtyRejected) || 0
  if (rejected <= 0)              return 'Passed'
  if (rejected >= actual)         return 'Failed'
  return 'Partially_Passed'
}

export default function ReceivingNew() {
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const results = useQueries({
    queries: [
      { queryKey: qk.products(),      queryFn: () => catalogueApi.products.list(),  ...stale.transactional },
      { queryKey: qk.suppliers(),     queryFn: () => catalogueApi.suppliers.list(), ...stale.reference },
      { queryKey: qk.locations(),     queryFn: () => inventoryApi.locations.all(),  ...stale.reference },
      { queryKey: qk.employees(),     queryFn: () => authApi.employees.list(),       ...stale.auth },
    ],
  })
  const [qProds, qSups, qLocs, qEmps] = results
  const products   = qProds.data ?? []
  const suppliers  = (qSups.data ?? []).filter(s => !s.is_deleted)
  const locations  = (qLocs.data ?? []).filter(l => l.status === 'Active' && l.location_type !== 'Virtual')
  const employees  = ((qEmps.data ?? []) as EmployeeOut[]).filter(e => e.is_active)
  const fetching   = results.some(r => r.isFetching)

  // ── header ─────────────────────────────────────────────────────────────────
  const [supplierId,        setSupplierId]        = useState('')
  const [docId,             setDocId]             = useState('')
  const [dateRcv,           setDateRcv]           = useState(() => new Date().toISOString().slice(0, 10))
  const [destLocId,         setDestLocId]         = useState('')
  const [receivedByEmpId,   setReceivedByEmpId]   = useState('')

  // ── line items ─────────────────────────────────────────────────────────────
  const [lines,      setLines]      = useState<LineItem[]>([])
  const [search,     setSearch]     = useState('')
  const [importErrs, setImportErrs] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const out: { product: InvProduct; variant: InvVariant }[] = []
    for (const p of products) {
      for (const v of p.variants) {
        if (v.is_deleted) continue
        if (v.bundle_components && v.bundle_components.length > 0) continue  // bundles blocked
        if (
          normalize(p.brand).includes(normalize(search)) ||
          normalize(v.variant_name).includes(normalize(search)) ||
          normalize(v.PID).includes(normalize(search)) ||
          normalize(v.sku ?? '').includes(normalize(search)) ||
          v.barcodes.some(b => normalize(b.barcode).includes(normalize(search)))
        ) out.push({ product: p, variant: v })
        if (out.length >= 20) return out
      }
    }
    return out
  }, [products, search])

  function addLine(product: InvProduct, variant: InvVariant) {
    if (lines.some(l => l.variant.variant_id === variant.variant_id)) return
    setLines(prev => [...prev, {
      variant, product,
      bundleCount: '1', qtyDeclared: '1', qtyActual: '1', qtyRejected: '0',
      qcStatus: 'Passed',
    }])
  }

  function updateLine(variantId: number, patch: Partial<LineItem>) {
    setLines(prev => prev.map(l => {
      if (l.variant.variant_id !== variantId) return l
      const updated = { ...l, ...patch }
      // Re-suggest QC when rejected qty changes
      if ('qtyRejected' in patch || 'qtyActual' in patch) {
        updated.qcStatus = suggestQC(updated.qtyActual, updated.qtyRejected)
      }
      return updated
    }))
  }

  function updateBundleCount(variantId: number, bc: string) {
    setLines(prev => prev.map(l => {
      if (l.variant.variant_id !== variantId) return l
      const wb  = getWarehouseBundle(l.variant)
      const qty = wb ? ((parseFloat(bc) || 0) * wb.factor).toString() : l.qtyDeclared
      return { ...l, bundleCount: bc, qtyDeclared: qty, qtyActual: qty }
    }))
  }

  function updateQtyDeclared(variantId: number, qty: string) {
    setLines(prev => prev.map(l => {
      if (l.variant.variant_id !== variantId) return l
      const wb  = getWarehouseBundle(l.variant)
      const bc  = wb && parseFloat(qty) > 0 ? Math.ceil(parseFloat(qty) / wb.factor).toString() : l.bundleCount
      return { ...l, qtyDeclared: qty, bundleCount: bc, qtyActual: qty }
    }))
  }

  // PID → {product, variant} lookup
  const pidMap = useMemo(() => {
    const m = new Map<string, { product: InvProduct; variant: InvVariant }>()
    for (const p of products) for (const v of p.variants) if (!v.is_deleted) m.set(v.PID, { product: p, variant: v })
    return m
  }, [products])

  function downloadTemplate() {
    const cols    = ['PID', 'variant_name', 'qty_received']
    const example = ['WID-001', 'Default', '50']
    const ws = XLSX.utils.aoa_to_sheet([cols, example])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Receiving Items')
    XLSX.writeFile(wb, 'receiving_import_template.xlsx')
  }

  async function handleImportFile(file: File) {
    const buf  = await file.arrayBuffer()
    const wb   = XLSX.read(buf)
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]] ?? {})
    const errs: Record<string, string> = {}
    for (const row of rows) {
      const pid = String(row['PID'] ?? '').trim()
      if (!pid) continue
      const match = pidMap.get(pid)
      if (!match) { errs[pid] = `PID "${pid}" not found`; continue }
      if (match.variant.bundle_components && match.variant.bundle_components.length > 0) {
        errs[pid] = `${pid} is a bundle variant — receive or transfer its components individually.`
        continue
      }
      if (lines.some(l => l.variant.variant_id === match.variant.variant_id)) continue
      const qty = String(row['qty_received'] ?? '1')
      const wb2 = getWarehouseBundle(match.variant)
      const bc  = wb2 && parseFloat(qty) > 0 ? Math.ceil(parseFloat(qty) / wb2.factor).toString() : '1'
      setLines(prev => [...prev, {
        variant: match.variant, product: match.product,
        bundleCount: bc, qtyDeclared: qty, qtyActual: qty, qtyRejected: '0', qcStatus: 'Passed',
      }])
    }
    setImportErrs(errs)
  }

  // ── post: create shipment + add details + receive (Stage 1 — no cost layers) ─
  async function handlePost() {
    if (!supplierId)  { setError('Supplier is required.'); return }
    if (!destLocId)   { setError('Destination location is required.'); return }
    if (lines.length === 0) { setError('Add at least one line item.'); return }
    const now = new Date(dateRcv).toISOString()
    setSaving(true); setError('')
    try {
      // Step 1: create shipment header
      const shipment = await stockApi.shipments.create({
        supplier_id:               parseInt(supplierId),
        reference_number:          docId || null,
        received_at:               now,
        received_by_employee_id:   receivedByEmpId ? parseInt(receivedByEmpId) : null,
      })

      // Step 2: add all details (quantities — no cost data at this stage)
      const detailRows = lines.map(line => ({
        variant_id:        line.variant.variant_id,
        location_id:       parseInt(destLocId),
        received_at:       now,
        quantity_declared: parseFloat(line.qtyDeclared) || 0,
        quantity_actual:   parseFloat(line.qtyActual)   || 0,
        quantity_rejected: '0',
        qc_status:         'Passed',
      }))
      await stockApi.shipments.addDetails(shipment.shipment_id, detailRows)

      // Step 3: Stage 1 receive — write inventory ledger, stock enters immediately
      await stockApi.shipments.receive(shipment.shipment_id)

      await qc.invalidateQueries({ queryKey: qk.shipments() })
      navigate('/stock/receiving')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Post failed')
    } finally { setSaving(false) }
  }

  const iCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-sm t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-1'
  const inpCls = 't-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="flex h-full overflow-hidden">
      <FetchingBar show={fetching} />

      {/* ── item search panel ── */}
      <aside className="w-72 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-hidden">
        <div className="p-3 border-b t-border">
          <label className={lCls}>Search Items</label>
          <input className={iCls} placeholder="Brand, name, PID, SKU…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {searchResults.map(({ product: p, variant: v }) => {
            const already = lines.some(l => l.variant.variant_id === v.variant_id)
            return (
              <button key={v.variant_id} disabled={already}
                onClick={() => addLine(p, v)}
                className={`w-full text-left px-3 py-2.5 border-b t-border transition-colors ${already ? 'opacity-40 cursor-not-allowed' : 'hover:t-bg-elevated cursor-pointer'}`}>
                <p className="text-xs t-text-2 font-medium">{p.brand} — {v.variant_name}</p>
                <p className="text-[10px] t-text-4 font-mono mt-0.5">{v.PID}{v.sku ? ` · ${v.sku}` : ''}</p>
              </button>
            )
          })}
          {search.trim() && searchResults.length === 0 && <p className="px-3 py-4 text-xs t-text-4">No items match.</p>}
          {!search.trim() && <p className="px-3 py-4 text-xs t-text-4">Start typing to search.</p>}
        </div>
      </aside>

      {/* ── main form ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* header fields */}
        <div className="shrink-0 p-4 border-b t-border t-bg-surface">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-5xl">
            <div>
              <label className={lCls}>Supplier *</label>
              <select className={iCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— select —</option>
                {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_code} — {s.supplier_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Document ID</label>
              <input className={iCls} placeholder="Supplier delivery ref." value={docId} onChange={e => setDocId(e.target.value)} />
            </div>
            <div>
              <label className={lCls}>Date Received *</label>
              <input type="date" className={iCls} value={dateRcv} onChange={e => setDateRcv(e.target.value)} />
            </div>
            <div>
              <label className={lCls}>Destination Location *</label>
              <select className={iCls} value={destLocId} onChange={e => setDestLocId(e.target.value)}>
                <option value="">— select —</option>
                {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Received By</label>
              <select className={iCls} value={receivedByEmpId} onChange={e => setReceivedByEmpId(e.target.value)}>
                <option value="">— select —</option>
                {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* line item grid */}
        <div className="flex-1 overflow-auto p-4">
          {error && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{error}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b t-border">
                  {['Brand','Variant','PID','Bundle Count','Qty Declared','Qty Actual','Qty Rejected','QC Status',''].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[10px] font-bold uppercase tracking-widest t-text-4 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={9} className="px-2 py-8 text-center t-text-4">Add items from the search panel.</td></tr>
                )}
                {lines.map(line => {
                  const wb = getWarehouseBundle(line.variant)
                  return (
                    <tr key={line.variant.variant_id} className="border-b t-border">
                      <td className="px-2 py-1.5 t-text-3 whitespace-nowrap">{line.product.brand}</td>
                      <td className="px-2 py-1.5 t-text-2 whitespace-nowrap max-w-[160px] truncate">{line.variant.variant_name}</td>
                      <td className="px-2 py-1.5 font-mono t-text-4 whitespace-nowrap">{line.variant.PID}</td>

                      {/* Bundle Count — only if warehouse bundle conversion exists */}
                      {wb ? (
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input type="number" min="0" step="1" className={`${inpCls} w-16`}
                              value={line.bundleCount}
                              onChange={e => updateBundleCount(line.variant.variant_id, e.target.value)}
                              onFocus={onFocusSelect} />
                            <span className="t-text-4 text-[10px] whitespace-nowrap">× {wb.factor}</span>
                          </div>
                        </td>
                      ) : (
                        <td className="px-2 py-1.5 t-text-4 text-[10px]">—</td>
                      )}

                      {/* Qty Declared */}
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" className={`${inpCls} w-20`}
                          value={line.qtyDeclared}
                          onChange={e => updateQtyDeclared(line.variant.variant_id, e.target.value)}
                          onFocus={onFocusSelect} />
                      </td>

                      {/* Qty Actual */}
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" className={`${inpCls} w-20`}
                          value={line.qtyActual}
                          onChange={e => updateLine(line.variant.variant_id, { qtyActual: e.target.value })}
                          onFocus={onFocusSelect} />
                      </td>

                      {/* Qty Rejected → routes to Quarantine */}
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" className={`${inpCls} w-20`}
                          value={line.qtyRejected}
                          onChange={e => updateLine(line.variant.variant_id, { qtyRejected: e.target.value })}
                          onFocus={onFocusSelect} />
                      </td>

                      {/* QC Status — auto-set, still editable */}
                      <td className="px-2 py-1.5">
                        <select className={`${inpCls} w-36`} value={line.qcStatus}
                          onChange={e => updateLine(line.variant.variant_id, { qcStatus: e.target.value as QCStatus })}>
                          {QC_OPTIONS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </td>

                      <td className="px-2 py-1.5">
                        <button onClick={() => setLines(prev => prev.filter(l => l.variant.variant_id !== line.variant.variant_id))}
                          className="t-text-4 hover:text-red-500">×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Quarantine note */}
          {lines.some(l => parseFloat(l.qtyRejected) > 0) && (
            <p className="mt-2 text-[10px] t-text-4">
              Rejected quantities will be automatically routed to the Quarantine virtual location.
            </p>
          )}
        </div>

        {/* import errors */}
        {Object.keys(importErrs).length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {Object.entries(importErrs).map(([pid, msg]) => (
              <span key={pid} className="text-[10px] text-red-400 bg-red-950 border border-red-900 rounded px-2 py-0.5">{msg}</span>
            ))}
          </div>
        )}

        {/* footer */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-t t-border t-bg-surface">
          <button onClick={downloadTemplate}
            className="px-3 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
            Download Template
          </button>
          <label className="px-3 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong cursor-pointer">
            Upload XLSX
            <input type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleImportFile(e.target.files[0]); e.target.value = '' }} />
          </label>
          <button onClick={() => navigate('/stock/receiving')}
            className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
            Cancel
          </button>
          <button onClick={handlePost} disabled={saving}
            className="px-5 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40 ml-auto"
            style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? 'Posting…' : 'Save Receipt'}
          </button>
        </div>
      </div>
    </div>
  )
}
