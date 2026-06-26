import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { normalize } from '../../lib/normalize'
import {
  purchaseOrderApi, catalogueApi, inventoryApi,
  type POOut, type POCreate, type POItemCreate,
  type InvProduct, type InvVariant,
} from '../../services/api'

const STATUS_OPTIONS = ['All', 'Draft', 'Open', 'Partially_Received', 'Closed', 'Cancelled'] as const
type StatusOption = typeof STATUS_OPTIONS[number]

const STATUS_BADGE: Record<string, string> = {
  Draft:               't-bg-elevated t-text-4',
  Open:                'bg-blue-950 text-blue-400',
  Partially_Received:  'bg-yellow-950 text-yellow-500',
  Closed:              'bg-emerald-950 text-emerald-500',
  Cancelled:           'bg-red-950 text-red-400',
}

function fmtMoney(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-PH', { dateStyle: 'medium' })
}

const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

// ── Create PO Modal ────────────────────────────────────────────────────────────

interface DraftLine {
  variant: InvVariant
  product: InvProduct
  qty: string
  grossCost: string
  discountPct: string
}

interface CreateModalProps {
  onClose: () => void
}

function CreatePOModal({ onClose }: CreateModalProps) {
  const qc = useQueryClient()

  const results = useQueries({
    queries: [
      { queryKey: qk.products(),  queryFn: () => catalogueApi.products.list(),  ...stale.transactional },
      { queryKey: qk.suppliers(), queryFn: () => catalogueApi.suppliers.list(), ...stale.reference },
      { queryKey: qk.locations(), queryFn: () => inventoryApi.locations.all(),  ...stale.reference },
    ],
  })
  const [qProds, qSups, qLocs] = results
  const products  = qProds.data ?? []
  const suppliers = (qSups.data ?? []).filter(s => !s.is_deleted)
  const locations = (qLocs.data ?? []).filter(l => l.status === 'Active' && l.location_type !== 'Virtual')

  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const out: { product: InvProduct; variant: InvVariant }[] = []
    for (const p of products) {
      for (const v of p.variants) {
        if (v.is_deleted) continue
        if (v.bundle_components && v.bundle_components.length > 0) continue
        if (
          normalize(p.brand).includes(normalize(search)) ||
          normalize(v.variant_name).includes(normalize(search)) ||
          normalize(v.PID).includes(normalize(search)) ||
          normalize(v.sku ?? '').includes(normalize(search))
        ) out.push({ product: p, variant: v })
        if (out.length >= 5) return out
      }
    }
    return out
  }, [products, search])

  async function addLine(product: InvProduct, variant: InvVariant) {
    if (lines.some(l => l.variant.variant_id === variant.variant_id)) return
    let grossCost = ''
    let discountPct = ''
    if (supplierId) {
      try {
        const cost = await purchaseOrderApi.variantSupplierCost(variant.variant_id, parseInt(supplierId))
        grossCost = String(cost.gross_cost)
        discountPct = String(cost.discount_pct)
      } catch {
        // no matching supplier cost record — leave blank
      }
    }
    setLines(prev => [...prev, { variant, product, qty: '1', grossCost, discountPct: discountPct || '0' }])
  }

  function updateLine(variantId: number, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => l.variant.variant_id === variantId ? { ...l, ...patch } : l))
  }

  function removeLine(variantId: number) {
    setLines(prev => prev.filter(l => l.variant.variant_id !== variantId))
  }

  function netCost(l: DraftLine): number {
    const gross = parseFloat(l.grossCost) || 0
    const disc  = parseFloat(l.discountPct) || 0
    return gross * (1 - disc / 100)
  }

  const grandTotal = lines.reduce((sum, l) => sum + netCost(l) * (parseFloat(l.qty) || 0), 0)

  const createMut = useMutation({
    mutationFn: (p: POCreate) => purchaseOrderApi.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.purchaseOrders() })
      onClose()
    },
  })

  async function handleSave() {
    setError('')
    if (!supplierId) { setError('Supplier is required.'); return }
    if (lines.length === 0) { setError('Add at least one line item.'); return }
    for (const l of lines) {
      const qty = parseFloat(l.qty) || 0
      const gross = parseFloat(l.grossCost) || 0
      if (qty <= 0) { setError(`Quantity must be greater than 0 for ${l.variant.PID}.`); return }
      if (gross <= 0) { setError(`Gross cost must be greater than 0 for ${l.variant.PID}.`); return }
    }

    const items: POItemCreate[] = lines.map(l => ({
      variant_id: l.variant.variant_id,
      ordered_quantity: parseFloat(l.qty) || 0,
      gross_cost: parseFloat(l.grossCost) || 0,
      discount_pct: parseFloat(l.discountPct) || 0,
    }))

    setSaving(true)
    try {
      await createMut.mutateAsync({
        supplier_id: parseInt(supplierId),
        location_id: locationId ? parseInt(locationId) : null,
        expected_arrival_date: arrivalDate || null,
        items,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const iCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-1'
  const inpCls = 't-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="t-bg-surface border t-border rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
        <div className="px-5 py-3 border-b t-border shrink-0">
          <h3 className="text-sm font-semibold t-text-1">New Purchase Order</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={lCls}>Supplier *</label>
              <select className={iCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— select —</option>
                {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_code} — {s.supplier_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Destination Location</label>
              <select className={iCls} value={locationId} onChange={e => setLocationId(e.target.value)}>
                <option value="">— none —</option>
                {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Expected Arrival</label>
              <input type="date" className={iCls} value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={lCls}>Add Line Item</label>
            <input className={iCls} placeholder="Search brand, name, PID, SKU…"
              value={search} onChange={e => setSearch(e.target.value)} />
            {search.trim() && (
              <div className="mt-1 border t-border rounded max-h-40 overflow-y-auto">
                {searchResults.length === 0 && <p className="px-3 py-2 text-xs t-text-4">No items match.</p>}
                {searchResults.map(({ product: p, variant: v }) => (
                  <button key={v.variant_id}
                    onClick={() => { addLine(p, v); setSearch('') }}
                    className="w-full text-left px-3 py-2 text-xs hover:t-bg-elevated border-b t-border last:border-0">
                    <span className="t-text-2">{p.brand} — {v.variant_name}</span>
                    <span className="t-text-4 font-mono ml-2">{v.PID}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b t-border">
                  {['PID', 'Variant Name', 'Qty', 'Gross Cost', 'Discount %', 'Net Cost', 'Line Total', ''].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[10px] uppercase tracking-widest t-text-4 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-6 text-center t-text-4">No line items yet.</td></tr>
                )}
                {lines.map(l => {
                  const qty = parseFloat(l.qty) || 0
                  const net = netCost(l)
                  return (
                    <tr key={l.variant.variant_id} className="border-b t-border">
                      <td className="px-2 py-1.5 font-mono t-text-4 whitespace-nowrap">{l.variant.PID}</td>
                      <td className="px-2 py-1.5 t-text-2 whitespace-nowrap max-w-[160px] truncate">{l.variant.variant_name}</td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" className={`${inpCls} w-16`}
                          value={l.qty} onFocus={onFocusSelect}
                          onChange={e => updateLine(l.variant.variant_id, { qty: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" className={`${inpCls} w-20`}
                          value={l.grossCost} onFocus={onFocusSelect}
                          onChange={e => updateLine(l.variant.variant_id, { grossCost: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" max="100" step="any" className={`${inpCls} w-16`}
                          value={l.discountPct} onFocus={onFocusSelect}
                          onChange={e => updateLine(l.variant.variant_id, { discountPct: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 tabular-nums t-text-3">{fmtMoney(net)}</td>
                      <td className="px-2 py-1.5 tabular-nums t-text-2">{fmtMoney(net * qty)}</td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeLine(l.variant.variant_id)} className="t-text-4 hover:text-red-500">×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <p className="text-sm font-semibold t-text-1">Grand Total: {fmtMoney(grandTotal)}</p>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-2 py-1.5">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t t-border shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── List Page ──────────────────────────────────────────────────────────────────

export default function PurchaseOrders() {
  const navigate = useNavigate()

  const { data: orders = [], isLoading, isFetching } = useQuery({
    queryKey: qk.purchaseOrders(),
    queryFn:  () => purchaseOrderApi.list(),
    ...stale.transactional,
  })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusOption>('All')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    return orders.filter((po: POOut) => {
      if (statusFilter !== 'All' && po.status !== statusFilter) return false
      if (search.trim() && !(
        normalize(po.po_pid).includes(normalize(search)) ||
        normalize(po.supplier?.supplier_name ?? '').includes(normalize(search))
      )) return false
      return true
    })
  }, [orders, search, statusFilter])

  const inputCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-sm font-semibold t-text-1">Purchase Orders</h1>
        <input className={`${inputCls} w-52`} placeholder="Search PO #, supplier…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className={`${inputCls} w-44`} value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusOption)}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)}
          className="ml-auto px-3 py-1.5 text-xs rounded text-white font-medium"
          style={{ backgroundColor: 'var(--accent)' }}>
          + New PO
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['PO Number', 'Supplier', 'Destination Location', 'Order Date', 'Expected Arrival', 'Total Amount', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable rows={8} cols={7} />}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center t-text-4">No purchase orders found.</td></tr>
            )}
            {!isLoading && filtered.map((po: POOut) => (
              <tr key={po.po_id}
                onClick={() => navigate(`/procurement/purchase-orders/${po.po_id}`)}
                className="border-b t-border hover:t-bg-surface cursor-pointer transition-colors">
                <td className="px-3 py-2 font-mono t-text-2">
                  <button className="hover:underline" onClick={e => { e.stopPropagation(); navigate(`/procurement/purchase-orders/${po.po_id}`) }}>
                    {po.po_pid}
                  </button>
                </td>
                <td className="px-3 py-2 t-text-3">{po.supplier?.supplier_name ?? '—'}</td>
                <td className="px-3 py-2 t-text-3">{po.location?.location_name ?? '—'}</td>
                <td className="px-3 py-2 t-text-4">{fmtDate(po.order_date)}</td>
                <td className="px-3 py-2 t-text-4">{fmtDate(po.expected_arrival_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums t-text-2">{fmtMoney(po.total_amount)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[po.status] ?? 't-bg-elevated t-text-4'}`}>
                    {po.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
