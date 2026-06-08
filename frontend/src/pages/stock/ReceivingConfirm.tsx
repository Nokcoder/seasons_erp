import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { stockApi, authApi, type ReceivingDetail, type EmployeeOut } from '../../services/api'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
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

  // per-line unit costs keyed by detail_id
  const [costs,         setCosts]         = useState<Record<number, string>>({})
  const [inspectedById, setInspectedById] = useState('')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  function setCost(detailId: number, val: string) {
    setCosts(prev => ({ ...prev, [detailId]: val }))
  }

  function lineTotal(d: ReceivingDetail): string {
    const qty  = Number(d.quantity_actual ?? 0)
    const cost = parseFloat(costs[d.detail_id] ?? '0') || 0
    return (qty * cost).toFixed(2)
  }

  async function handleConfirm() {
    if (!shipment) return
    const details = (shipment.receiving_details ?? []).filter(d => !d.qc_status || d.qc_status !== 'Failed')
    if (details.some(d => !costs[d.detail_id] || parseFloat(costs[d.detail_id]) < 0)) {
      setError('Enter a unit cost ≥ 0 for every line item.')
      return
    }
    setSaving(true); setError('')
    try {
      const lines = details.map(d => ({
        detail_id: d.detail_id,
        unit_cost: parseFloat(costs[d.detail_id] ?? '0') || 0,
      }))
      await stockApi.shipments.confirmCosts(
        sid, lines,
        inspectedById ? parseInt(inspectedById) : null,
      )
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
      <SkeletonTable rows={4} cols={5} />
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
  const details = (shipment.receiving_details ?? []).filter(d => Number(d.quantity_actual ?? 0) > 0)

  return (
    <div className="p-5 max-w-5xl">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-2 text-xs t-text-4 mb-4">
        <button onClick={() => navigate('/stock/receiving')} className="hover:t-text-3">Receiving</button>
        <span>/</span>
        <span className="t-text-3">{shipment.shipment_pid ?? `SHP-${sid}`}</span>
        <span>/</span>
        <span className="t-text-3">Confirm Costs</span>
      </div>

      {/* header (read-only from Stage 1) */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className={lCls}>Shipment PID</label><p className={`${vCls} font-mono`}>{shipment.shipment_pid ?? '—'}</p></div>
          <div><label className={lCls}>Supplier</label><p className={vCls}>{shipment.supplier?.supplier_name ?? '—'}</p></div>
          <div><label className={lCls}>Document ID</label><p className={vCls}>{shipment.reference_number ?? '—'}</p></div>
          <div><label className={lCls}>Date Received</label><p className={vCls}>{fmtDate(shipment.received_at)}</p></div>
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

      {/* line items with editable unit cost */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['Brand','Variant','PID','Qty Received','Unit Cost','Line Total'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {details.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center t-text-4">No line items with quantity received.</td></tr>}
            {details.map((d: ReceivingDetail) => (
              <tr key={d.detail_id} className="border-b t-border">
                <td className="px-3 py-2 t-text-3">{d.variant?.product?.brand ?? '—'}</td>
                <td className="px-3 py-2 t-text-2">{d.variant?.variant_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono t-text-4">{d.variant?.PID ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums t-text-3">{Number(d.quantity_actual ?? 0).toFixed(2)}</td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01"
                    className={`${iCls} w-28`}
                    placeholder="0.00"
                    value={costs[d.detail_id] ?? ''}
                    onChange={e => setCost(d.detail_id, e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums t-text-2">{lineTotal(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={() => navigate('/stock/receiving')}
          className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={saving || details.length === 0}
          className="px-5 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent)' }}>
          {saving ? 'Confirming…' : 'Confirm Costs'}
        </button>
      </div>
    </div>
  )
}
