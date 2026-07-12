import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import Tooltip from '../../components/Tooltip'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  stockApi, authApi, inventoryApi,
  type ReceivingDetail, type EmployeeOut, type CostAutofillItem, type Location,
} from '../../services/api'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtDateLong(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function money(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const SOURCE_LABEL: Record<string, string> = {
  cost_layer:        'Prior shipment',
  variant_suppliers: 'Supplier record',
  none:              'No prior data',
}

interface LineCost {
  gross: string
  discount: string
}

export default function ReceivingConfirm() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const navigate       = useNavigate()
  const qc             = useQueryClient()
  const sid            = parseInt(shipmentId ?? '0')

  const { data: shipment, isLoading, isFetching } = useQuery({
    queryKey: qk.shipment(sid),
    queryFn:  () => stockApi.shipments.get(sid),
    ...stale.transactional,
    enabled: !!sid,
  })

  const { data: empList = [] } = useQuery({
    queryKey: qk.employees(),
    queryFn:  () => authApi.employees.list(),
    ...stale.auth,
  })
  const employees = (empList as EmployeeOut[]).filter(e => e.is_active)

  const { data: locations = [] } = useQuery({
    queryKey: qk.locations(),
    queryFn:  () => inventoryApi.locations.all(),
    ...stale.reference,
  })

  const { data: autofill = [] } = useQuery({
    queryKey: ['shipment-cost-autofill', sid],
    queryFn:  () => stockApi.shipments.costAutofill(sid),
    enabled: !!sid && !!shipment && !shipment.is_confirmed,
  })

  const [costs,         setCosts]         = useState<Record<number, LineCost>>({})
  const [sources,       setSources]       = useState<Record<number, string>>({})
  const [prefilled,     setPrefilled]     = useState(false)
  const [inspectedById, setInspectedById] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate,   setInvoiceDate]   = useState(todayIso())
  const [dueDate,       setDueDate]       = useState('')
  const [dueDateTouched, setDueDateTouched] = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  const terms = shipment?.supplier?.terms

  // Pre-fill gross cost / discount once autofill data arrives
  useEffect(() => {
    if (prefilled || !autofill.length) return
    const nextCosts: Record<number, LineCost> = {}
    const nextSources: Record<number, string> = {}
    for (const item of autofill as CostAutofillItem[]) {
      nextCosts[item.detail_id] = {
        gross:    item.gross_cost != null ? String(item.gross_cost) : '',
        discount: item.discount_pct != null ? String(item.discount_pct) : '0',
      }
      nextSources[item.detail_id] = item.source
    }
    setCosts(nextCosts)
    setSources(nextSources)
    setPrefilled(true)
  }, [autofill, prefilled])

  // Keep due date in sync with invoice date + supplier terms unless the user overrides it
  useEffect(() => {
    if (dueDateTouched) return
    if (terms == null) { setDueDate(''); return }
    setDueDate(addDays(invoiceDate, terms))
  }, [invoiceDate, terms, dueDateTouched])

  function setCost(detailId: number, field: keyof LineCost, val: string) {
    setCosts(prev => ({ ...prev, [detailId]: { ...(prev[detailId] ?? { gross: '', discount: '0' }), [field]: val } }))
  }

  function netUnitCost(d: ReceivingDetail): number {
    const c = costs[d.detail_id]
    const gross = parseFloat(c?.gross ?? '') || 0
    const discount = parseFloat(c?.discount ?? '') || 0
    return gross * (1 - discount / 100)
  }

  function lineTotal(d: ReceivingDetail): number {
    const qty = Number(d.quantity_actual ?? 0)
    return qty * netUnitCost(d)
  }

  const details = (shipment?.receiving_details ?? [])
    .filter(d => Number(d.quantity_actual ?? 0) > 0)
    .filter(d => !d.qc_status || d.qc_status !== 'Failed')

  const grandTotal = details.reduce((sum, d) => sum + lineTotal(d), 0)

  const allGrossCostsValid = details.length > 0 && details.every(d => (parseFloat(costs[d.detail_id]?.gross ?? '') || 0) > 0)
  const canConfirm = !!invoiceNumber.trim() && !!invoiceDate && allGrossCostsValid

  const destinationLocationName = (() => {
    const firstDetail = details[0]
    if (!firstDetail) return '—'
    const loc = (locations as Location[]).find(l => l.location_id === firstDetail.location_id)
    return loc?.location_name ?? '—'
  })()

  async function handleConfirm() {
    if (!shipment || !canConfirm) return
    setSaving(true); setError('')
    try {
      const items = details.map(d => ({
        detail_id: d.detail_id,
        gross_cost: parseFloat(costs[d.detail_id]?.gross ?? '0') || 0,
        discount_pct: parseFloat(costs[d.detail_id]?.discount ?? '0') || 0,
      }))
      await stockApi.shipments.confirmCosts(sid, {
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        due_date: dueDateTouched && dueDate ? dueDate : null,
        items,
        inspected_by_employee_id: inspectedById ? parseInt(inspectedById) : null,
      })
      await qc.invalidateQueries({ queryKey: qk.shipment(sid) })
      await qc.invalidateQueries({ queryKey: qk.shipments() })
      navigate('/stock/receiving')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Confirm failed')
    } finally { setSaving(false) }
  }

  if (isLoading) return (
    <div className="p-5">
      <div className="h-5 t-bg-elevated rounded w-48 animate-pulse mb-4" />
      <SkeletonTable rows={4} cols={8} />
    </div>
  )
  if (!shipment) return <div className="p-8 text-sm t-text-4">Shipment not found.</div>
  if (shipment.is_confirmed) return (
    <div className="p-8 text-sm t-text-4">
      This shipment is already confirmed. <button onClick={() => navigate('/stock/receiving')} className="text-blue-400 hover:underline">Back to overview</button>
    </div>
  )

  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-0.5'
  const vCls = 'text-sm t-text-2'
  const iCls = 't-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5 max-w-6xl">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-2 text-xs t-text-4 mb-4">
        <button onClick={() => navigate('/stock/receiving')} className="hover:t-text-3">Receiving</button>
        <span>/</span>
        <span className="t-text-3">{shipment.shipment_pid ?? `SHP-${sid}`}</span>
        <span>/</span>
        <span className="t-text-3">Confirm Costs</span>
      </div>

      {/* header (read-only from Stage 1) */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div><label className={lCls}>Shipment PID</label><p className={`${vCls} font-mono`}>{shipment.shipment_pid ?? '—'}</p></div>
          <div><label className={lCls}>Supplier</label><p className={vCls}>{shipment.supplier?.supplier_name ?? '—'}</p></div>
          <div><label className={lCls}>Date Received</label><p className={vCls}>{fmtDate(shipment.received_at)}</p></div>
          <div>
            <label className={lCls}>
              <Tooltip content="Where this shipment's stock was received.">Destination Location</Tooltip>
            </label>
            <p className={vCls}>{destinationLocationName}</p>
          </div>
          {shipment.reference_number && (
            <div><label className={lCls}>Document ID</label><p className={vCls}>{shipment.reference_number}</p></div>
          )}
        </div>
      </div>

      {/* invoice details */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest t-text-4 mb-3">Invoice Details</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={lCls}>Invoice Number *</label>
            <input className={`${iCls} w-full`} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="INV-0001" />
          </div>
          <div>
            <label className={lCls}>Invoice Date *</label>
            <input type="date" className={`${iCls} w-full`} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className={lCls}>
              <Tooltip
                content="Calculated as Invoice Date plus the supplier's payment terms."
                note="Editing it directly stops the automatic recalculation for the rest of this session.">
                Due Date
              </Tooltip>
            </label>
            <input
              type="date" className={`${iCls} w-full`}
              value={dueDate}
              onChange={e => { setDueDate(e.target.value); setDueDateTouched(true) }}
            />
            <p className="text-[10px] t-text-4 mt-0.5">
              {terms == null
                ? 'No payment terms on file'
                : `${fmtDateLong(dueDate)} (Net ${terms} days)`}
            </p>
          </div>
          <div>
            <label className={lCls}>Inspected By</label>
            <select className={`${iCls} w-full`} value={inspectedById} onChange={e => setInspectedById(e.target.value)}>
              <option value="">— select —</option>
              {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{error}</div>}

      {/* line items grid */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['PID','Variant Name','Brand','Qty Received','Gross Cost','Discount %','Net Unit Cost','Line Total'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">
                  {h === 'Qty Received' && (
                    <Tooltip content="What was physically received for this line, recorded when the shipment first arrived.">
                      {h}
                    </Tooltip>
                  )}
                  {h === 'Gross Cost' && (
                    <Tooltip
                      content="The supplier's catalog price for this line, before any discount."
                      note="Pre-filled from the most recent cost layer or the supplier's on-file cost when available — always editable.">
                      {h}
                    </Tooltip>
                  )}
                  {h !== 'Qty Received' && h !== 'Gross Cost' && h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {details.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center t-text-4">No line items with quantity received.</td></tr>}
            {details.map((d: ReceivingDetail) => (
              <tr key={d.detail_id} className="border-b t-border">
                <td className="px-3 py-2 font-mono t-text-4">{d.variant?.PID ?? '—'}</td>
                <td className="px-3 py-2 t-text-2">{d.variant?.variant_name ?? '—'}</td>
                <td className="px-3 py-2 t-text-3">{d.variant?.product?.brand ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums t-text-3">{Number(d.quantity_actual ?? 0).toFixed(2)}</td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01"
                    className={`${iCls} w-24`}
                    placeholder="0.00"
                    value={costs[d.detail_id]?.gross ?? ''}
                    onFocus={e => e.target.select()}
                    onChange={e => setCost(d.detail_id, 'gross', e.target.value)}
                  />
                  {sources[d.detail_id] && (
                    <span className="block text-[9px] t-text-4 mt-0.5">{SOURCE_LABEL[sources[d.detail_id]] ?? sources[d.detail_id]}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" max="100" step="0.01"
                    className={`${iCls} w-20`}
                    placeholder="0.00"
                    value={costs[d.detail_id]?.discount ?? ''}
                    onFocus={e => e.target.select()}
                    onChange={e => setCost(d.detail_id, 'discount', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums t-text-2">{money(netUnitCost(d))}</td>
                <td className="px-3 py-2 tabular-nums t-text-2">{money(lineTotal(d))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {details.length > 0 && (
        <div className="flex justify-end mb-4">
          <div className="text-sm t-text-1 font-medium">
            <Tooltip
              content="Sum of all line totals shown below."
              note="Lines with zero quantity or a Failed QC outcome are excluded — they carry no cost and never appear in this table."
              side="top">
              Grand Total:
            </Tooltip> <span className="tabular-nums">₱{money(grandTotal)}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={() => navigate('/stock/receiving')}
          className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={saving || !canConfirm}
          className="px-5 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent)' }}>
          {saving ? 'Confirming…' : 'Confirm & Record Invoice'}
        </button>
      </div>
    </div>
  )
}
