import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import Tooltip from '../../components/Tooltip'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { purchaseOrderApi, type POOut, type POItemOut, type POItemUpdate } from '../../services/api'

const STATUS_BADGE: Record<string, string> = {
  Draft:               't-bg-elevated t-text-4',
  Open:                'bg-blue-950 text-blue-400',
  Partially_Received:  'bg-yellow-950 text-yellow-500',
  Closed:              'bg-emerald-950 text-emerald-500',
  Cancelled:           'bg-red-950 text-red-400',
}

const NEXT_STATUSES: Record<string, { label: string; status: string; style: string }[]> = {
  Draft: [
    { label: 'Confirm Order', status: 'Open',      style: 'text-white' },
    { label: 'Cancel PO',     status: 'Cancelled', style: 'border t-border t-text-3 hover:text-red-400' },
  ],
  Open: [
    { label: 'Cancel PO', status: 'Cancelled', style: 'border t-border t-text-3 hover:text-red-400' },
  ],
  Partially_Received: [
    { label: 'Cancel PO', status: 'Cancelled', style: 'border t-border t-text-3 hover:text-red-400' },
  ],
  Closed: [],
  Cancelled: [],
}

function fmtMoney(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-PH', { dateStyle: 'medium' })
}

const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

function LineItemRow({
  item, editable, onCommit,
}: {
  item: POItemOut
  editable: boolean
  onCommit: (poItemId: number, payload: POItemUpdate) => void
}) {
  const [qty, setQty]   = useState(String(item.ordered_quantity))
  const [gross, setGross] = useState(String(item.gross_cost))
  const [disc, setDisc]   = useState(String(item.discount_pct))

  useEffect(() => {
    setQty(String(item.ordered_quantity))
    setGross(String(item.gross_cost))
    setDisc(String(item.discount_pct))
  }, [item.ordered_quantity, item.gross_cost, item.discount_pct])

  const inpCls = 't-bg-elevated border t-border rounded px-2 py-1 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-20'
  const lineTotal = item.ordered_quantity * item.unit_cost

  function commitQty()   { const v = parseFloat(qty) || 0;  if (v !== item.ordered_quantity) onCommit(item.po_item_id, { ordered_quantity: v }) }
  function commitGross() { const v = parseFloat(gross) || 0; if (v !== item.gross_cost) onCommit(item.po_item_id, { gross_cost: v }) }
  function commitDisc()  { const v = parseFloat(disc) || 0; if (v !== item.discount_pct) onCommit(item.po_item_id, { discount_pct: v }) }

  return (
    <tr className="border-b t-border">
      <td className="px-2 py-1.5 font-mono t-text-4 whitespace-nowrap">{item.variant?.PID ?? '—'}</td>
      <td className="px-2 py-1.5 t-text-2 whitespace-nowrap max-w-[180px] truncate">{item.variant?.variant_name ?? '—'}</td>
      <td className="px-2 py-1.5">
        {editable ? (
          <input type="number" min="0" step="any" className={inpCls} value={qty} onFocus={onFocusSelect}
            onChange={e => setQty(e.target.value)} onBlur={commitQty} />
        ) : (
          <span className="tabular-nums t-text-3">{item.ordered_quantity}</span>
        )}
      </td>
      <td className="px-2 py-1.5 tabular-nums t-text-3 whitespace-nowrap">
        {item.received_quantity} / {item.ordered_quantity}
      </td>
      <td className="px-2 py-1.5">
        {editable ? (
          <input type="number" min="0" step="any" className={inpCls} value={gross} onFocus={onFocusSelect}
            onChange={e => setGross(e.target.value)} onBlur={commitGross} />
        ) : (
          <span className="tabular-nums t-text-3">{fmtMoney(item.gross_cost)}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {editable ? (
          <input type="number" min="0" max="100" step="any" className={inpCls} value={disc} onFocus={onFocusSelect}
            onChange={e => setDisc(e.target.value)} onBlur={commitDisc} />
        ) : (
          <span className="tabular-nums t-text-3">{item.discount_pct}%</span>
        )}
      </td>
      <td className="px-2 py-1.5 tabular-nums t-text-2">{fmtMoney(item.unit_cost)}</td>
      <td className="px-2 py-1.5 tabular-nums t-text-1 font-medium">{fmtMoney(lineTotal)}</td>
    </tr>
  )
}

export default function PurchaseOrderDetail() {
  const { po_id } = useParams<{ po_id: string }>()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const poId       = parseInt(po_id ?? '0')

  const { data: po, isLoading, isFetching } = useQuery({
    queryKey: qk.purchaseOrder(poId),
    queryFn:  () => purchaseOrderApi.get(poId),
    ...stale.transactional,
    enabled: !!poId,
  })

  const updateItemMut = useMutation({
    mutationFn: ({ po_item_id, payload }: { po_item_id: number; payload: POItemUpdate }) =>
      purchaseOrderApi.updateItem(poId, po_item_id, payload),
    onSuccess: (updated) => {
      qc.setQueryData(qk.purchaseOrder(poId), updated)
      qc.invalidateQueries({ queryKey: qk.purchaseOrders() })
    },
  })

  const statusMut = useMutation({
    mutationFn: (status: string) => purchaseOrderApi.updateStatus(poId, { status }),
    onSuccess: (updated) => {
      qc.setQueryData(qk.purchaseOrder(poId), updated)
      qc.invalidateQueries({ queryKey: qk.purchaseOrders() })
    },
  })

  if (isLoading) return (
    <div className="p-5">
      <div className="h-5 t-bg-elevated rounded w-48 animate-pulse mb-4" />
      <SkeletonTable rows={6} cols={7} />
    </div>
  )
  if (!po) return <div className="p-8 text-sm t-text-4">Purchase order not found.</div>

  const editable = po.status === 'Draft' || po.status === 'Open'
  const nextActions = NEXT_STATUSES[po.status] ?? []
  const grandTotal = po.items.reduce((sum, i) => sum + i.ordered_quantity * i.unit_cost, 0)

  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-0.5'
  const vCls = 'text-sm t-text-2'

  return (
    <div className="p-5 max-w-5xl">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-2 text-xs t-text-4 mb-4">
        <button onClick={() => navigate('/procurement/purchase-orders')} className="hover:t-text-3">Purchase Orders</button>
        <span>/</span>
        <span className="t-text-3">{po.po_pid}</span>
      </div>

      {/* header */}
      <div className="t-bg-surface border t-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold t-text-1">{po.po_pid}</h2>
          <Tooltip
            underline={false}
            content="Draft → Open → Partially Received → Closed, or Cancelled at any point before Closed."
            note="Partially Received and Closed happen automatically as goods are received — there's no manual button for them here.">
            <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[po.status] ?? 't-bg-elevated t-text-4'}`}>
              {po.status.replace('_', ' ')}
            </span>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className={lCls}>Supplier</label><p className={vCls}>{po.supplier?.supplier_name ?? '—'}</p></div>
          <div><label className={lCls}>Destination Location</label><p className={vCls}>{po.location?.location_name ?? '—'}</p></div>
          <div><label className={lCls}>Order Date</label><p className={vCls}>{fmtDate(po.order_date)}</p></div>
          <div><label className={lCls}>Expected Arrival</label><p className={vCls}>{fmtDate(po.expected_arrival_date)}</p></div>
        </div>
      </div>

      {/* status action bar */}
      {nextActions.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          {nextActions.map(a => (
            <button key={a.status} disabled={statusMut.isPending}
              onClick={() => statusMut.mutate(a.status)}
              className={`px-3 py-1.5 text-xs rounded font-medium disabled:opacity-40 ${a.style}`}
              style={a.status !== 'Cancelled' ? { backgroundColor: 'var(--accent)' } : undefined}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* line items */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['PID', 'Variant Name', 'Ordered Qty', 'Received Qty', 'Gross Cost', 'Discount %', 'Net Cost', 'Line Total'].map(h => (
                <th key={h} className="text-left px-2 py-2 text-[10px] uppercase tracking-widest t-text-4 whitespace-nowrap">
                  {h === 'Received Qty' && (
                    <Tooltip
                      content="Confirmed quantity received so far, tracked separately from what was ordered."
                      note="Only updates via the Receiving workflow — this screen can't record receiving directly.">
                      {h}
                    </Tooltip>
                  )}
                  {h === 'Gross Cost' && (
                    <Tooltip
                      content="The supplier's catalog price for this line."
                      note="Editing this recalculates Net Cost, Line Total, and the PO's Total Amount automatically.">
                      {h}
                    </Tooltip>
                  )}
                  {h === 'Net Cost' && (
                    <Tooltip content="Gross Cost after the discount — Net Cost × Qty = Line Total.">{h}</Tooltip>
                  )}
                  {!['Received Qty', 'Gross Cost', 'Net Cost'].includes(h) && h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {po.items.length === 0 && (
              <tr><td colSpan={8} className="px-2 py-6 text-center t-text-4">No line items.</td></tr>
            )}
            {po.items.map((item: POItemOut) => (
              <LineItemRow key={item.po_item_id} item={item} editable={editable}
                onCommit={(po_item_id, payload) => updateItemMut.mutate({ po_item_id, payload })} />
            ))}
          </tbody>
        </table>
      </div>

      {/* footer */}
      <div className="flex justify-end mt-3">
        <p className="text-sm font-semibold t-text-1">Grand Total: {fmtMoney(grandTotal)}</p>
      </div>
    </div>
  )
}
