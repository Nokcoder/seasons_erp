import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import Tooltip from '../../components/Tooltip'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { stockApi, type ReceivingDetail } from '../../services/api'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReceivingDetail() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const navigate       = useNavigate()
  const sid            = parseInt(shipmentId ?? '0')

  const { data: shipment, isLoading, isFetching } = useQuery({
    queryKey: qk.shipment(sid),
    queryFn:  () => stockApi.shipments.get(sid),
    ...stale.transactional,
    enabled: !!sid,
  })

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  async function handleExport() {
    if (!shipment) return
    setExporting(true); setExportError('')
    try {
      await stockApi.shipments.exportInvoice(sid, `${shipment.shipment_pid ?? sid}_invoice.xlsx`)
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'Export failed')
    } finally { setExporting(false) }
  }

  if (isLoading) return (
    <div className="p-5">
      <div className="h-5 t-bg-elevated rounded w-48 animate-pulse mb-4" />
      <SkeletonTable rows={6} cols={7} />
    </div>
  )
  if (!shipment) return <div className="p-8 text-sm t-text-4">Shipment not found.</div>

  const lCls    = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-0.5'
  const vCls    = 'text-sm t-text-2'
  const details = shipment.receiving_details ?? []
  const isConfirmed = shipment.is_confirmed

  return (
    <div className="p-5 max-w-5xl">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-2 text-xs t-text-4 mb-4">
        <button onClick={() => navigate('/stock/receiving')} className="hover:t-text-3">Receiving</button>
        <span>/</span>
        <span className="t-text-3">{shipment.shipment_pid ?? `SHP-${sid}`}</span>
      </div>

      {/* header */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className={lCls}>Shipment PID</label><p className={`${vCls} font-mono`}>{shipment.shipment_pid ?? '—'}</p></div>
          <div><label className={lCls}>Supplier</label><p className={vCls}>{shipment.supplier?.supplier_name ?? '—'}</p></div>
          <div>
            <label className={lCls}>
              <Tooltip content="The supplier's own delivery or invoice reference — not the system-generated Shipment PID.">
                Document ID
              </Tooltip>
            </label>
            <p className={vCls}>{shipment.reference_number ?? '—'}</p>
          </div>
          <div><label className={lCls}>Date Received</label><p className={vCls}>{fmtDate(shipment.received_at)}</p></div>
          <div>
            <label className={lCls}>
              <Tooltip
                content="Confirmed once unit costs have been entered and the supplier invoice recorded (Stage 2)."
                note="Pending means stock already arrived and is sellable, but no cost data exists for it yet.">
                Cost Confirmation
              </Tooltip>
            </label>
            <span className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${isConfirmed ? 'bg-emerald-950 text-emerald-500' : 'bg-yellow-950 text-yellow-500'}`}>
              {isConfirmed ? 'Confirmed' : 'Pending'}
            </span>
          </div>
        </div>
      </div>

      {/* action bar */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest t-text-4">Receiving Details</p>
        <div className="flex gap-2">
          {isConfirmed && (
            <button onClick={handleExport} disabled={exporting}
              className="px-2.5 py-1 text-xs border t-border rounded t-text-3 hover:t-border-strong disabled:opacity-40">
              {exporting ? 'Exporting…' : 'Export Invoice'}
            </button>
          )}
          {!isConfirmed && (
            <button
              onClick={() => navigate(`/stock/receiving/${sid}/confirm`)}
              className="px-3 py-1 text-xs rounded text-white font-medium"
              style={{ backgroundColor: 'var(--accent)' }}>
              Confirm Costs →
            </button>
          )}
        </div>
      </div>

      {exportError && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{exportError}</div>}

      {!isConfirmed && (
        <p className="text-[10px] text-yellow-600 mb-3">
          Stock has been received (Stage 1 complete). Click "Confirm Costs" to enter unit costs, create FIFO cost layers, and generate the supplier invoice.
        </p>
      )}

      {/* line items — read-only */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {[
                'Brand','Variant','PID','Qty Declared','Qty Actual','Qty Rejected','Variance','QC Status',
                ...(isConfirmed ? ['Gross Cost','Discount %','Net Unit Cost'] : []),
              ].map(h => (
                <th key={h} className="text-left px-2 py-2 text-[10px] uppercase tracking-widest t-text-4">
                  {h === 'Variance' ? (
                    <Tooltip
                      content="Qty Actual minus Qty Declared — the difference between what was physically counted and what the supplier's delivery note claimed."
                      note="Not a comparison against the original purchase order quantity.">
                      {h}
                    </Tooltip>
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {details.length === 0 && (
              <tr><td colSpan={isConfirmed ? 11 : 8} className="px-2 py-6 text-center t-text-4">No details.</td></tr>
            )}
            {details.map((d: ReceivingDetail) => {
              const actual   = parseFloat(String(d.quantity_actual   ?? 0)) || 0
              const declared = parseFloat(String(d.quantity_declared ?? 0)) || 0
              const variance = actual - declared
              return (
                <tr key={d.detail_id} className="border-b t-border">
                  <td className="px-2 py-1.5 t-text-3">{d.variant?.product?.brand ?? '—'}</td>
                  <td className="px-2 py-1.5 t-text-2">{d.variant?.variant_name ?? '—'}</td>
                  <td className="px-2 py-1.5 font-mono t-text-4">{d.variant?.PID ?? '—'}</td>
                  <td className="px-2 py-1.5 tabular-nums t-text-3">{fmt(d.quantity_declared)}</td>
                  <td className="px-2 py-1.5 tabular-nums t-text-2">{fmt(d.quantity_actual)}</td>
                  <td className="px-2 py-1.5 tabular-nums t-text-3">{fmt(d.quantity_rejected)}</td>
                  <td className={`px-2 py-1.5 tabular-nums ${variance !== 0 ? 'text-yellow-500' : 't-text-4'}`}>
                    {variance > 0 ? `+${variance.toFixed(2)}` : variance.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 t-text-3">{d.qc_status ?? '—'}</td>
                  {isConfirmed && (
                    <>
                      <td className="px-2 py-1.5 tabular-nums t-text-2">{fmt(d.cost_layer?.gross_cost)}</td>
                      <td className="px-2 py-1.5 tabular-nums t-text-3">{fmt(d.cost_layer?.supplier_discount)}</td>
                      <td className="px-2 py-1.5 tabular-nums t-text-2">{fmt(d.cost_layer?.net_unit_cost)}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
