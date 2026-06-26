import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { FetchingBar } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  stockApi, catalogueApi, inventoryApi, authApi,
  type InvProduct, type InvVariant, type Location, type UserEntry, type EmployeeOut,
} from '../../services/api'
import * as XLSX from 'xlsx'
import { normalize } from '../../lib/normalize'
import KeywordSearch from '../../components/KeywordSearch'

// ui_standards §10 — onFocus selects all numeric input value
const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

// ── bundle count mechanic (ui_standards §8) ────────────────────────────────

function getWarehouseBundle(v: InvVariant) {
  return v.uom_conversions?.find(c => c.is_warehouse_bundle) ?? null
}

interface LineItem {
  variant:       InvVariant
  product:       InvProduct
  qty:           string
  bundleCount:   string
}

function physicalStock(v: InvVariant, locId: number): number {
  return Number(v.current_stock.find(s => s.location.location_id === locId)?.quantity ?? 0)
}

export default function TransferNew() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const results = useQueries({
    queries: [
      { queryKey: qk.products(),   queryFn: () => catalogueApi.products.list(),  ...stale.transactional },
      { queryKey: qk.locations(),  queryFn: () => inventoryApi.locations.all(),  ...stale.reference },
      { queryKey: qk.employees(),  queryFn: () => authApi.employees.list(),      ...stale.auth },
    ],
  })
  const [qProds, qLocs, qEmps] = results
  const products       = qProds.data ?? []
  const allActiveLocs  = (qLocs.data ?? []).filter(l => l.status === 'Active')
  const physicalLocs   = allActiveLocs.filter(l => l.location_type !== 'Virtual')
  const virtualLocs    = allActiveLocs.filter(l => l.location_type === 'Virtual')
  const employees      = ((qEmps.data ?? []) as EmployeeOut[]).filter(e => e.is_active)
  const fetching   = results.some(r => r.isFetching)

  // ── header state ──────────────────────────────────────────────────────────
  const [transferPid,        setTransferPid]        = useState('')
  const [fromLocId,          setFromLocId]          = useState('')
  const [toLocId,            setToLocId]            = useState('')
  const [date,               setDate]               = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks,            setRemarks]            = useState('')
  const [releasedByEmpId,    setReleasedByEmpId]    = useState('')
  const [receivedByEmpId,    setReceivedByEmpId]    = useState('')

  // ── line items ────────────────────────────────────────────────────────────
  const [lines,        setLines]        = useState<LineItem[]>([])
  const [searchTags,   setSearchTags]   = useState<string[]>([])
  const [liveInput,    setLiveInput]    = useState('')
  const handleTagsChange    = useCallback((tags: string[]) => setSearchTags(tags), [])
  const handlePartialChange = useCallback((v: string) => setLiveInput(v), [])
  const [importErrs, setImportErrs] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  // ── item search results ───────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const allTerms = [
      ...searchTags.map(t => normalize(t)),
      ...(liveInput.trim() ? [normalize(liveInput)] : []),
    ]
    if (allTerms.length === 0) return []
    const out: { product: InvProduct; variant: InvVariant }[] = []
    for (const p of products) {
      for (const v of p.variants) {
        if (v.is_deleted) continue
        if (v.bundle_components && v.bundle_components.length > 0) continue  // bundles blocked
        const matches = allTerms.every(term =>
          normalize(p.brand).includes(term) ||
          normalize(v.variant_name).includes(term) ||
          normalize(v.PID).includes(term) ||
          normalize(v.sku ?? '').includes(term) ||
          v.barcodes.some(b => normalize(b.barcode).includes(term))
        )
        if (matches) out.push({ product: p, variant: v })
        if (out.length >= 10) return out
      }
    }
    return out
  }, [products, searchTags, liveInput])

  function addLine(product: InvProduct, variant: InvVariant) {
    if (lines.some(l => l.variant.variant_id === variant.variant_id)) return
    setLines(prev => [...prev, { variant, product, qty: '1', bundleCount: '1' }])
    // keep search open (don't clear search)
  }

  function updateQty(variantId: number, qty: string) {
    setLines(prev => prev.map(l => {
      if (l.variant.variant_id !== variantId) return l
      const wb = getWarehouseBundle(l.variant)
      if (wb) {
        const qNum = parseFloat(qty) || 0
        const bc   = qNum > 0 ? Math.ceil(qNum / wb.factor).toString() : '0'
        return { ...l, qty, bundleCount: bc }
      }
      return { ...l, qty }
    }))
  }

  function updateBundleCount(variantId: number, bc: string) {
    setLines(prev => prev.map(l => {
      if (l.variant.variant_id !== variantId) return l
      const wb = getWarehouseBundle(l.variant)
      if (wb) {
        const bcNum = parseFloat(bc) || 0
        const qty   = (bcNum * wb.factor).toString()
        return { ...l, qty, bundleCount: bc }
      }
      return { ...l, bundleCount: bc }
    }))
  }

  function removeLine(variantId: number) {
    setLines(prev => prev.filter(l => l.variant.variant_id !== variantId))
  }

  const totalBundles = useMemo(() => lines.reduce((sum, l) => sum + (parseFloat(l.bundleCount) || 0), 0), [lines])

  // Build a PID → {product, variant} lookup from loaded catalogue
  const pidMap = useMemo(() => {
    const m = new Map<string, { product: InvProduct; variant: InvVariant }>()
    for (const p of products) for (const v of p.variants) if (!v.is_deleted) m.set(v.PID, { product: p, variant: v })
    return m
  }, [products])

  function downloadTemplate() {
    const cols    = ['PID', 'variant_name', 'quantity']
    const example = ['WID-001', 'Default', '10']
    const ws = XLSX.utils.aoa_to_sheet([cols, example])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Transfer Items')
    XLSX.writeFile(wb, 'transfer_import_template.xlsx')
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
      const qty = String(row['quantity'] ?? '1')
      const wb2 = getWarehouseBundle(match.variant)
      const bc  = wb2 && parseFloat(qty) > 0 ? Math.ceil(parseFloat(qty) / wb2.factor).toString() : '1'
      setLines(prev => [...prev, { variant: match.variant, product: match.product, qty, bundleCount: bc }])
    }
    setImportErrs(errs)
  }

  async function handlePost() {
    if (!transferPid.trim())    { setError('Transfer PID (document reference) is required.'); return }
    if (!fromLocId || !toLocId) { setError('From and To locations are required.'); return }
    if (lines.length === 0)     { setError('Add at least one line item.'); return }
    setSaving(true); setError('')
    try {
      const result = await stockApi.transfers.create({
        transfer_pid:             transferPid.trim(),
        from_location_id:         parseInt(fromLocId),
        to_location_id:           parseInt(toLocId),
        occurred_at:              new Date(date).toISOString(),
        total_bundle_count:       totalBundles > 0 ? totalBundles : null,
        released_by_employee_id:  releasedByEmpId ? parseInt(releasedByEmpId) : null,
        received_by_employee_id:  receivedByEmpId ? parseInt(receivedByEmpId) : null,
        items: lines.map(l => ({
          variant_id:         l.variant.variant_id,
          quantity_requested: parseFloat(l.qty) || 0,
          quantity_released:  parseFloat(l.qty) || 0,
        })),
      })
      await qc.invalidateQueries({ queryKey: qk.transfers() })
      navigate(`/stock/transfers/${result.transfer_id ?? ''}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Post failed')
    } finally { setSaving(false) }
  }

  const iCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-sm t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-1'
  const fromId = fromLocId ? parseInt(fromLocId) : null

  return (
    <div className="flex h-full overflow-hidden">
      <FetchingBar show={fetching} />

      {/* ── item search panel ── */}
      <aside className="w-72 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-hidden">
        <div className="p-3 border-b t-border">
          <label className={lCls}>Search Items</label>
          <KeywordSearch
            tags={searchTags}
            onTagsChange={handleTagsChange}
            onPartialChange={handlePartialChange}
            placeholder="Brand, PID, SKU…"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {searchResults.map(({ product: p, variant: v }) => {
            const already = lines.some(l => l.variant.variant_id === v.variant_id)
            const stock   = fromId != null ? physicalStock(v, fromId) : 0
            return (
              <button key={v.variant_id} disabled={already}
                onClick={() => addLine(p, v)}
                className={`w-full text-left px-3 py-2.5 border-b t-border transition-colors ${already ? 'opacity-40 cursor-not-allowed' : 'hover:t-bg-elevated cursor-pointer'}`}>
                <p className="text-xs t-text-2 font-medium">{p.brand} — {v.variant_name}</p>
                <p className="text-[10px] t-text-4 font-mono mt-0.5">{v.PID}{v.sku ? ` · ${v.sku}` : ''}</p>
                {fromId != null && <p className="text-[10px] t-text-4 mt-0.5">Stock: {stock.toFixed(0)}</p>}
              </button>
            )
          })}
          {(searchTags.length > 0 || liveInput.trim()) && searchResults.length === 0 && (
            <p className="px-3 py-4 text-xs t-text-4">No items match.</p>
          )}
          {searchTags.length === 0 && !liveInput.trim() && (
            <p className="px-3 py-4 text-xs t-text-4">Start typing to search.</p>
          )}
        </div>
      </aside>

      {/* ── main form ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* header fields */}
        <div className="shrink-0 p-4 border-b t-border t-bg-surface">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 max-w-5xl">
            <div>
              <label className={lCls}>Transfer PID *</label>
              <input className={iCls} placeholder="e.g. TR-2026-001"
                value={transferPid} onChange={e => setTransferPid(e.target.value)} />
            </div>
            <div>
              <label className={lCls}>From Location *</label>
              <select className={iCls} value={fromLocId} onChange={e => setFromLocId(e.target.value)}>
                <option value="">— select —</option>
                {physicalLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
                {virtualLocs.length > 0 && (
                  <optgroup label="── Virtual Locations ──">
                    {virtualLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className={lCls}>To Location *</label>
              <select className={iCls} value={toLocId} onChange={e => setToLocId(e.target.value)}>
                <option value="">— select —</option>
                {physicalLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
                {virtualLocs.length > 0 && (
                  <optgroup label="── Virtual Locations ──">
                    {virtualLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className={lCls}>Date</label>
              <input type="date" className={iCls} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className={lCls}>Released By</label>
              <select className={iCls} value={releasedByEmpId} onChange={e => setReleasedByEmpId(e.target.value)}>
                <option value="">— select —</option>
                {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Received By</label>
              <select className={iCls} value={receivedByEmpId} onChange={e => setReceivedByEmpId(e.target.value)}>
                <option value="">— select —</option>
                {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className={lCls}>Remarks</label>
              <input className={iCls} value={remarks} onChange={e => setRemarks(e.target.value)} />
            </div>
          </div>
        </div>

        {/* line items grid */}
        <div className="flex-1 overflow-auto p-4">
          {error && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{error}</div>}

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b t-border">
                {['Brand','Variant','PID','SKU','Stock at Source','Bundle Count','Qty',''].map(h => (
                  <th key={h} className="text-left px-2 py-2 text-[10px] uppercase tracking-widest t-text-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-8 text-center t-text-4">Search and click items on the left to add them.</td></tr>
              )}
              {lines.map(line => {
                const wb      = getWarehouseBundle(line.variant)
                const srcStock = fromId != null ? physicalStock(line.variant, fromId) : null
                return (
                  <tr key={line.variant.variant_id} className="border-b t-border">
                    <td className="px-2 py-1.5 t-text-3">{line.product.brand}</td>
                    <td className="px-2 py-1.5 t-text-2">{line.variant.variant_name}</td>
                    <td className="px-2 py-1.5 font-mono t-text-4">{line.variant.PID}</td>
                    <td className="px-2 py-1.5 font-mono t-text-4">{line.variant.sku ?? '—'}</td>
                    <td className="px-2 py-1.5 tabular-nums t-text-4">
                      {srcStock != null ? srcStock.toFixed(0) : '—'}
                    </td>
                    {/* bundle count */}
                    {wb ? (
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="1"
                          className="t-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-1 w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={line.bundleCount}
                          onChange={e => updateBundleCount(line.variant.variant_id, e.target.value)}
                          onFocus={onFocusSelect} />
                        <span className="ml-1 t-text-4 text-[10px]">× {wb.factor}</span>
                      </td>
                    ) : (
                      <td className="px-2 py-1.5 t-text-4 text-[10px]">—</td>
                    )}
                    {/* qty */}
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="any"
                        className="t-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-1 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={line.qty}
                        onChange={e => updateQty(line.variant.variant_id, e.target.value)}
                        onFocus={onFocusSelect} />
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => removeLine(line.variant.variant_id)} className="t-text-4 hover:text-red-500">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* import errors */}
        {Object.keys(importErrs).length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {Object.entries(importErrs).map(([pid, msg]) => (
              <span key={pid} className="text-[10px] text-red-400 bg-red-950 border border-red-900 rounded px-2 py-0.5">{msg}</span>
            ))}
          </div>
        )}

        {/* footer actions */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-t t-border t-bg-surface">
          {lines.length > 0 && (
            <span className="text-xs t-text-4">
              {lines.length} item{lines.length !== 1 ? 's' : ''} · {totalBundles} bundle{totalBundles !== 1 ? 's' : ''}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={downloadTemplate}
              className="px-3 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
              Download Template
            </button>
            <label className="px-3 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong cursor-pointer">
              Upload XLSX
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleImportFile(e.target.files[0]); e.target.value = '' }} />
            </label>
            <button onClick={() => navigate('/stock/transfers')}
              className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
              Cancel
            </button>
            <button onClick={handlePost} disabled={saving}
              className="px-5 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? 'Posting…' : 'Post Transfer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
