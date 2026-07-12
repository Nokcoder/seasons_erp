import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import Tooltip from '../../components/Tooltip'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { stockApi, type TransferItem } from '../../services/api'
import * as XLSX from 'xlsx'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TransferDetail() {
  const { transferId } = useParams<{ transferId: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const tid      = parseInt(transferId ?? '0')

  const { data: transfer, isLoading, isFetching } = useQuery({
    queryKey: qk.transfer(tid),
    queryFn:  () => stockApi.transfers.get(tid),
    ...stale.transactional,
    enabled: !!tid,
  })

  const [voiding,    setVoiding]    = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [voidModal,  setVoidModal]  = useState(false)
  const [voidError,  setVoidError]  = useState('')

  async function handleVoid() {
    if (!voidReason.trim()) { setVoidError('Void reason is required.'); return }
    setVoiding(true); setVoidError('')
    try {
      await stockApi.transfers.void(tid, voidReason)
      await qc.invalidateQueries({ queryKey: qk.transfer(tid) })
      await qc.invalidateQueries({ queryKey: qk.transfers() })
      setVoidModal(false)
    } catch (e: unknown) {
      setVoidError(e instanceof Error ? e.message : 'Void failed')
    } finally {
      setVoiding(false)
    }
  }

  function handleExport() {
    if (!transfer?.items) return
    const rows = transfer.items.map(item => ({
      'Brand':          item.variant?.product?.brand ?? '',
      'Variant':        item.variant?.variant_name ?? '',
      'PID':            item.variant?.PID ?? '',
      'SKU':            item.variant?.sku ?? '',
      'Qty Requested':  item.quantity_requested,
      'Qty Released':   item.quantity_released ?? '',
      'Qty Received':   item.quantity_received ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Transfer Items')
    XLSX.writeFile(wb, `transfer_${transfer.transfer_pid ?? tid}_items.xlsx`)
  }

  if (isLoading) return (
    <div className="p-5">
      <div className="h-5 t-bg-elevated rounded w-48 animate-pulse mb-4" />
      <SkeletonTable rows={6} cols={7} />
    </div>
  )
  if (!transfer) return <div className="p-8 text-sm t-text-4">Transfer not found.</div>

  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-0.5'
  const vCls = 'text-sm t-text-2'

  return (
    <div className="p-5 max-w-5xl">
      <FetchingBar show={isFetching && !isLoading} />

      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-xs t-text-4 mb-4">
        <button onClick={() => navigate('/stock/transfers')} className="hover:t-text-3">Transfers</button>
        <span>/</span>
        <span className="t-text-3">{transfer.transfer_pid ?? `TRF-${tid}`}</span>
      </div>

      {/* header */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className={lCls}>Transfer PID</label><p className={`${vCls} font-mono`}>{transfer.transfer_pid ?? '—'}</p></div>
          <div><label className={lCls}>From</label><p className={vCls}>{transfer.from_location?.location_name ?? '—'}</p></div>
          <div><label className={lCls}>To</label><p className={vCls}>{transfer.to_location?.location_name ?? '—'}</p></div>
          <div><label className={lCls}>Date</label><p className={vCls}>{fmtDate(transfer.occurred_at)}</p></div>
          <div>
            <label className={lCls}>
              <Tooltip
                content="Staff-entered count of physical boxes or cases in this transfer."
                note="Informational only — it isn't validated against the line-item quantities below.">
                Bundle Count
              </Tooltip>
            </label>
            <p className={vCls}>{transfer.total_bundle_count ?? '—'}</p>
          </div>
          <div>
            <label className={lCls}>Released By</label>
            <p className={vCls}>
              {transfer.released_by_employee
                ? `${transfer.released_by_employee.first_name} ${transfer.released_by_employee.last_name}`
                : '—'}
            </p>
          </div>
          <div>
            <label className={lCls}>Received By</label>
            <p className={vCls}>
              {transfer.received_by_employee
                ? `${transfer.received_by_employee.first_name} ${transfer.received_by_employee.last_name}`
                : '—'}
            </p>
          </div>
          {(transfer.status ?? 'Posted') === 'Voided' && transfer.void_reason && (
            <div className="col-span-2"><label className={lCls}>Void Reason</label><p className="text-sm text-red-400">{transfer.void_reason}</p></div>
          )}
        </div>
      </div>

      {/* line items */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest t-text-4">Line Items</p>
        <div className="flex gap-2">
          <button onClick={handleExport} className="px-2.5 py-1 text-xs border t-border rounded t-text-3 hover:t-border-strong">
            Export XLSX
          </button>
          {(transfer.status ?? 'Posted') === 'Posted' && (
            <button onClick={() => setVoidModal(true)}
              className="px-2.5 py-1 text-xs border border-red-900 rounded text-red-400 hover:bg-red-950 transition-colors">
              Void
            </button>
          )}
        </div>
      </div>

      {/* void badge */}
      {(transfer.status ?? 'Posted') === 'Voided' && (
        <div className="mb-4 px-3 py-2 t-bg-elevated border t-border rounded text-xs t-text-3">
          <span className="font-semibold t-text-2">Voided</span>
          {transfer.void_reason && <span className="ml-2">— {transfer.void_reason}</span>}
        </div>
      )}

      {/* void modal */}
      {voidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="t-bg-surface border t-border rounded-lg p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-sm font-semibold t-text-1 mb-3">Void Transfer</h3>
            <p className="text-xs t-text-3 mb-3">This will reverse all stock movements for this transfer.</p>
            <label className="block text-[10px] uppercase tracking-widest t-text-4 mb-1">Void Reason *</label>
            <input
              className="t-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={voidReason} onChange={e => setVoidReason(e.target.value)}
              placeholder="Enter reason for voiding…" autoFocus />
            {voidError && <p className="text-xs text-red-400 mt-2">{voidError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setVoidModal(false); setVoidReason(''); setVoidError('') }}
                className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
                Cancel
              </button>
              <button onClick={handleVoid} disabled={voiding}
                className="px-4 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40 bg-red-700 hover:bg-red-600">
                {voiding ? 'Voiding…' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['Brand','Variant','PID','SKU','Qty Requested','Qty Released','Qty Received'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">
                  {h === 'Qty Requested' && <Tooltip content="What was entered on the transfer before posting.">{h}</Tooltip>}
                  {h === 'Qty Released' && (
                    <Tooltip content="What actually left the source location." note="Normally matches Qty Requested unless adjusted during processing.">
                      {h}
                    </Tooltip>
                  )}
                  {h === 'Qty Received' && (
                    <Tooltip content="What was physically confirmed as arrived at the destination, if reconciled separately from what was released.">
                      {h}
                    </Tooltip>
                  )}
                  {h !== 'Qty Requested' && h !== 'Qty Released' && h !== 'Qty Received' && h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(!transfer.items || transfer.items.length === 0) && (
              <tr><td colSpan={7} className="px-3 py-6 text-center t-text-4">No line items.</td></tr>
            )}
            {(transfer.items ?? []).map((item: TransferItem) => (
              <tr key={item.transfer_item_id} className="border-b t-border">
                <td className="px-3 py-2 t-text-3">{item.variant?.product?.brand ?? '—'}</td>
                <td className="px-3 py-2 t-text-2">{item.variant?.variant_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono t-text-3">{item.variant?.PID ?? '—'}</td>
                <td className="px-3 py-2 font-mono t-text-4">{item.variant?.sku ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums t-text-2">{fmt(item.quantity_requested)}</td>
                <td className="px-3 py-2 tabular-nums t-text-3">{fmt(item.quantity_released)}</td>
                <td className="px-3 py-2 tabular-nums t-text-3">{fmt(item.quantity_received)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
