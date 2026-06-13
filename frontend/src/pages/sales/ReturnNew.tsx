import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  salesApi, inventoryApi,
  type SaleItemOut, type SaleOut, type Location, type CustomerOut,
  type POSCatalogItem, type POSVariant, type Shift, type CashRegister,
} from '../../services/api'
import { normalize } from '../../lib/normalize'

const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function todayManila() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

interface ReturnLine {
  sale_item_id:    number | null
  variant_id:      number
  label:           string
  unit_price:      number
  unit_price_str:  string
  max_qty:         number    // Infinity for blind returns
  return_qty:      string
}

export default function ReturnNew() {
  const navigate      = useNavigate()
  const [sp]          = useSearchParams()
  const qc            = useQueryClient()
  const saleId        = sp.get('sale_id') ? parseInt(sp.get('sale_id')!) : null

  // ── form state ────────────────────────────────────────────────────────────
  const [disposition,  setDisposition]  = useState<'cash_refund' | 'credit_to_account'>('cash_refund')
  const [locationId,   setLocationId]   = useState('')
  const [customerId,   setCustomerId]   = useState('')
  const [shiftId,      setShiftId]      = useState('')
  const [registerId,   setRegisterId]   = useState('')
  const [reason,       setReason]       = useState('')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [returnDate,   setReturnDate]   = useState(todayManila)

  // ── blind return item search ──────────────────────────────────────────────
  const [catalogSearch, setCatalogSearch] = useState('')

  // ── line items state ──────────────────────────────────────────────────────
  const [lines, setLines] = useState<ReturnLine[]>([])

  // ── reference data ────────────────────────────────────────────────────────
  const { data: locations = [] } = useQuery({
    queryKey: qk.locations(),
    queryFn:  inventoryApi.locations.all,
    ...stale.reference,
  })
  const { data: customers = [] } = useQuery({
    queryKey: qk.customers(),
    queryFn:  () => salesApi.customers.list(),
    ...stale.reference,
  })
  const { data: shifts = [] } = useQuery({
    queryKey: qk.shifts(),
    queryFn:  () => salesApi.shifts.list(),
    ...stale.reference,
  })
  const { data: registers = [] } = useQuery({
    queryKey: qk.registers(),
    queryFn:  () => salesApi.registers.list(),
    ...stale.reference,
  })
  const { data: catalog = [] } = useQuery({
    queryKey: qk.posCatalog(),
    queryFn:  inventoryApi.posCatalog,
    ...stale.reference,
    enabled: !saleId,
  })

  // ── linked sale data ──────────────────────────────────────────────────────
  const { data: sale, isLoading: saleLoading } = useQuery({
    queryKey: qk.sale(saleId ?? 0),
    queryFn:  () => salesApi.sales.get(saleId!),
    enabled:  !!saleId,
    ...stale.transactional,
  })
  const { data: saleItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: qk.saleItemsReturn(saleId ?? 0),
    queryFn:  () => salesApi.returns.itemsForReturn(saleId!),
    enabled:  !!saleId,
    ...stale.transactional,
  })

  // ── auto-populate from linked sale ────────────────────────────────────────
  useEffect(() => {
    if (!sale) return
    if ((sale as SaleOut).location_id) setLocationId(String((sale as SaleOut).location_id))
    if ((sale as SaleOut).customer_id) setCustomerId(String((sale as SaleOut).customer_id))
  }, [(sale as SaleOut | undefined)?.sale_id])

  useEffect(() => {
    if (saleItems.length === 0) return
    setLines(saleItems.map((i: SaleItemOut) => {
      const alreadyRet = i.already_returned ?? 0
      const avail = Math.max(0, Number(i.quantity) - alreadyRet)
      return {
        sale_item_id:   i.sale_item_id,
        variant_id:     i.variant_id,
        label:          i.variant ? `${i.variant.variant_name}` : `Variant ${i.variant_id}`,
        unit_price:     Number(i.unit_price),
        unit_price_str: Number(i.unit_price).toFixed(2),
        max_qty:        avail,
        return_qty:     String(avail),
      }
    }))
  }, [saleItems.length])

  // ── blind return catalog search ───────────────────────────────────────────
  const catalogResults = useMemo(() => {
    if (!catalogSearch.trim()) return []
    const results: Array<{ item: POSCatalogItem; variant: POSVariant }> = []
    for (const item of (catalog as POSCatalogItem[])) {
      for (const v of item.variants) {
        if (
          normalize(v.variant_name).includes(normalize(catalogSearch)) ||
          normalize(v.PID).includes(normalize(catalogSearch)) ||
          normalize(item.product_brand).includes(normalize(catalogSearch))
        ) {
          results.push({ item, variant: v })
          if (results.length >= 20) return results
        }
      }
    }
    return results
  }, [catalogSearch, catalog])

  function addBlindItem(item: POSCatalogItem, variant: POSVariant) {
    if (lines.find(l => l.variant_id === variant.variant_id)) return
    setLines(prev => [...prev, {
      sale_item_id:   null,
      variant_id:     variant.variant_id,
      label:          `${item.product_brand} — ${variant.variant_name}`,
      unit_price:     Number(variant.price ?? 0),
      unit_price_str: Number(variant.price ?? 0).toFixed(2),
      max_qty:        Infinity,
      return_qty:     '1',
    }])
    setCatalogSearch('')
  }

  function removeBlindItem(idx: number) {
    setLines(prev => prev.filter((_, i) => i !== idx))
  }

  // ── derived values ────────────────────────────────────────────────────────
  const activeLines = lines.filter(l => {
    const qty = parseFloat(l.return_qty)
    return qty > 0 && (l.max_qty === Infinity || l.max_qty > 0)
  })
  const returnTotal = activeLines.reduce((s, l) => s + (parseFloat(l.return_qty) || 0) * l.unit_price, 0)
  const allReturned = saleId ? lines.length > 0 && lines.every(l => l.max_qty === 0) : false

  const selectedCustomer = (customers as CustomerOut[]).find(
    (c: CustomerOut) => c.customer_id === parseInt(customerId)
  )
  const canCreditAccount = !!selectedCustomer

  const physLocs = (locations as Location[]).filter((l: Location) => !l.is_deleted)

  // ── submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (activeLines.length === 0) { setError('No items selected for return.'); return }
    if (!returnDate)              { setError('Return date is required.'); return }
    if (!locationId)              { setError('Return location is required.'); return }
    setSaving(true); setError('')
    try {
      const ret = await salesApi.returns.create({
        sale_id:     saleId,
        location_id: parseInt(locationId),
        customer_id: customerId ? parseInt(customerId) : undefined,
        shift_id:    shiftId    ? parseInt(shiftId)    : undefined,
        register_id: registerId ? parseInt(registerId) : undefined,
        disposition,
        reason:      reason.trim() || undefined,
        return_date: returnDate,
        items:       activeLines.map(l => ({
          sale_item_id: l.sale_item_id,
          variant_id:   l.variant_id,
          quantity:     parseFloat(l.return_qty) || 0,
          unit_price:   l.unit_price,
        })),
      })
      await qc.invalidateQueries({ queryKey: qk.salesReturns() })
      navigate(`/sales/returns/${ret.return_id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Return failed')
    } finally { setSaving(false) }
  }

  const loading = saleLoading || itemsLoading
  const lCls  = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-0.5'
  const vCls  = 'text-sm t-text-2'
  const inpCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-2 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5 max-w-4xl min-h-full">
      <FetchingBar show={loading} />

      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-xs t-text-4 mb-4">
        <button onClick={() => navigate('/sales/returns')} className="hover:t-text-2">Returns</button>
        <span>/</span>
        <span className="t-text-2">
          New Return{saleId ? ` — Sale ${(sale as SaleOut)?.sale_pid ?? saleId}` : ' (Blind)'}
        </span>
      </div>

      {/* header form */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">

          {/* linked sale info */}
          {saleId && sale && (
            <>
              <div>
                <label className={lCls}>Original Sale</label>
                <p className={`${vCls} font-mono`}>{(sale as SaleOut).sale_pid ?? '—'}</p>
              </div>
              <div>
                <label className={lCls}>Grand Total</label>
                <p className={`${vCls} font-semibold`}>₱{fmt((sale as SaleOut).grand_total)}</p>
              </div>
            </>
          )}

          {/* return date */}
          <div>
            <label className={lCls}>Return Date <span className="text-red-500">*</span></label>
            <input type="date" className={`${inpCls} w-full`}
              value={returnDate}
              max={todayManila()}
              onChange={e => setReturnDate(e.target.value || todayManila())} />
          </div>

          {/* return location */}
          <div>
            <label className={lCls}>Return Location <span className="text-red-500">*</span></label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)}
              className={`${inpCls} w-full`}>
              <option value="">Select location…</option>
              {physLocs.map((l: Location) => (
                <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
              ))}
            </select>
          </div>

          {/* shift */}
          <div>
            <label className={lCls}>Shift</label>
            <select value={shiftId} onChange={e => setShiftId(e.target.value)}
              className={`${inpCls} w-full`}>
              <option value="">None</option>
              {(shifts as Shift[]).filter(s => s.is_active).map(s => (
                <option key={s.shift_id} value={s.shift_id}>{s.shift_name}</option>
              ))}
            </select>
          </div>

          {/* register */}
          <div>
            <label className={lCls}>Register</label>
            <select value={registerId} onChange={e => setRegisterId(e.target.value)}
              className={`${inpCls} w-full`}>
              <option value="">None</option>
              {(registers as CashRegister[]).filter(r => r.is_active).map(r => (
                <option key={r.register_id} value={r.register_id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* customer */}
          <div>
            <label className={lCls}>Customer</label>
            <select
              value={customerId}
              onChange={e => {
                setCustomerId(e.target.value)
                if (!e.target.value) setDisposition('cash_refund')
              }}
              className={`${inpCls} w-full`}
              disabled={!!saleId && !!(sale as SaleOut | undefined)?.customer_id}
            >
              <option value="">Walk-in</option>
              {(customers as CustomerOut[]).map((c: CustomerOut) => (
                <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>
              ))}
            </select>
          </div>

          {/* disposition */}
          <div>
            <label className={lCls}>Disposition</label>
            <div className="flex gap-4 mt-1.5">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name="disposition" value="cash_refund"
                  checked={disposition === 'cash_refund'}
                  onChange={() => setDisposition('cash_refund')} />
                <span className="t-text-2">Cash Refund</span>
              </label>
              <label className={`flex items-center gap-1.5 text-xs ${!canCreditAccount ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input type="radio" name="disposition" value="credit_to_account"
                  checked={disposition === 'credit_to_account'}
                  onChange={() => canCreditAccount && setDisposition('credit_to_account')}
                  disabled={!canCreditAccount} />
                <span className="t-text-2">Credit to Account</span>
              </label>
            </div>
            {!canCreditAccount && (
              <p className="text-[10px] t-text-4 mt-0.5">Requires a registered customer.</p>
            )}
          </div>

          {/* reason */}
          <div className="col-span-2">
            <label className={lCls}>Reason (optional)</label>
            <input className={`${inpCls} w-full max-w-sm`}
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Defective, wrong item, customer preference…" />
          </div>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 t-bg-elevated border border-red-900 rounded px-3 py-2 mb-3">{error}</div>
      )}

      {/* blind return: item search */}
      {!saleId && (
        <div className="t-bg-surface border t-border rounded-lg p-4 mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-2">Add Items</p>
          <div className="relative max-w-sm">
            <input className={`${inpCls} w-full`}
              value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)}
              placeholder="Search by name or PID…" />
            {catalogResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 t-bg-elevated border t-border rounded mt-1 max-h-48 overflow-y-auto shadow-lg">
                {catalogResults.map(({ item, variant }) => (
                  <button key={variant.variant_id}
                    onClick={() => addBlindItem(item, variant)}
                    className="w-full text-left px-3 py-2 text-xs t-text-2 hover:t-bg-surface flex justify-between items-center gap-3">
                    <span>
                      <span className="t-text-1 font-medium">{item.product_brand}</span>
                      {' '}—{' '}{variant.variant_name}
                    </span>
                    <span className="t-text-4 font-mono shrink-0">{variant.PID}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* all-returned guard */}
      {allReturned && (
        <div className="t-bg-elevated border t-border rounded-lg p-4 text-yellow-500 text-sm mb-5">
          All items on this sale have already been returned. No further returns are possible.
        </div>
      )}

      {/* line items grid */}
      {!allReturned && (saleId ? lines.length > 0 : true) && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-2">Items to Return</p>
          <div className="t-bg-surface border t-border rounded-lg overflow-x-auto mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b t-border">
                  {(saleId
                    ? ['Variant','PID','Unit Price','Sold Qty','Already Returned','Available','Return Qty']
                    : ['Variant','Unit Price','Return Qty','']
                  ).map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <SkeletonTable rows={4} cols={saleId ? 7 : 4} />}
                {!loading && lines.length === 0 && !saleId && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center t-text-4">Use the search above to add items.</td></tr>
                )}
                {!loading && lines.map((line, i) => (
                  saleId ? (
                    <tr key={`${line.variant_id}-${i}`} className={`border-b t-border ${line.max_qty === 0 ? 'opacity-40' : ''}`}>
                      <td className="px-3 py-1.5 t-text-2">{line.label}</td>
                      <td className="px-3 py-1.5 font-mono t-text-4">{saleItems[i]?.variant?.PID ?? '—'}</td>
                      <td className="px-3 py-1.5 tabular-nums t-text-3">₱{fmt(line.unit_price)}</td>
                      <td className="px-3 py-1.5 tabular-nums t-text-3">{saleItems[i] ? Number(saleItems[i].quantity).toFixed(0) : '—'}</td>
                      <td className="px-3 py-1.5 tabular-nums t-text-4">
                        {((saleItems[i]?.already_returned ?? 0) > 0) ? (saleItems[i]?.already_returned ?? 0).toFixed(0) : '—'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums t-text-3">{line.max_qty.toFixed(0)}</td>
                      <td className="px-3 py-1.5">
                        <input type="number" min="0" max={line.max_qty} step="1"
                          className={`t-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-2 w-20 focus:outline-none focus:ring-1 focus:ring-blue-500 ${line.max_qty === 0 ? 'cursor-not-allowed' : ''}`}
                          value={line.return_qty}
                          disabled={line.max_qty === 0}
                          onFocus={onFocusSelect}
                          onChange={e => {
                            const v = e.target.value
                            setLines(prev => prev.map((l, li) => li === i ? { ...l, return_qty: v } : l))
                          }} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={`blind-${line.variant_id}-${i}`} className="border-b t-border">
                      <td className="px-3 py-1.5 t-text-2">{line.label}</td>
                      <td className="px-3 py-1.5">
                        <input type="number" min="0" step="0.01"
                          className="t-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-2 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={line.unit_price_str}
                          onFocus={onFocusSelect}
                          onChange={e => {
                            const v = e.target.value
                            setLines(prev => prev.map((l, li) => li === i
                              ? { ...l, unit_price_str: v, unit_price: parseFloat(v) || 0 }
                              : l))
                          }} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" min="0" step="1"
                          className="t-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-2 w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={line.return_qty}
                          onFocus={onFocusSelect}
                          onChange={e => {
                            const v = e.target.value
                            setLines(prev => prev.map((l, li) => li === i ? { ...l, return_qty: v } : l))
                          }} />
                      </td>
                      <td className="px-3 py-1.5">
                        <button onClick={() => removeBlindItem(i)} className="text-[10px] text-red-400 hover:underline">Remove</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* summary + action */}
      {!allReturned && (
        <div className="t-bg-surface border t-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] t-text-4 uppercase tracking-widest">Return Total</p>
              <p className="text-2xl font-bold t-text-1 tabular-nums">₱{fmt(returnTotal)}</p>
              <p className="text-[10px] t-text-4 mt-0.5">{activeLines.length} item{activeLines.length !== 1 ? 's' : ''} selected</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigate('/sales/returns')}
                className="px-4 py-2 text-xs border t-border rounded t-text-3 hover:t-border-strong">
                Cancel
              </button>
              <button onClick={handleSubmit}
                disabled={saving || activeLines.length === 0 || !locationId}
                className="px-5 py-2 text-xs rounded text-white font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent)' }}>
                {saving ? 'Processing…' : 'Submit Return'}
              </button>
            </div>
          </div>
          <p className="text-[10px] t-text-4 mt-3">
            {disposition === 'credit_to_account' && canCreditAccount
              ? `A credit of ₱${fmt(returnTotal)} will be posted to ${selectedCustomer?.customer_name}'s AR ledger.`
              : 'Cash refund — settled at counter. No AR entry.'}
          </p>
        </div>
      )}
    </div>
  )
}
