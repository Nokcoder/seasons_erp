import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { salesApi, type SalesReturnItemOut } from '../../services/api'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReturnDetail() {
  const { returnId } = useParams<{ returnId: string }>()
  const navigate     = useNavigate()
  const rid          = parseInt(returnId ?? '0')

  const { data: ret, isLoading, isFetching } = useQuery({
    queryKey: qk.salesReturn(rid),
    queryFn:  () => salesApi.returns.get(rid),
    ...stale.transactional,
    enabled:  !!rid,
  })

  if (isLoading) return (
    <div className="p-5">
      <div className="h-4 bg-gray-800 rounded w-40 animate-pulse mb-4" />
      <SkeletonTable rows={4} cols={5} />
    </div>
  )
  if (!ret) return <div className="p-8 text-sm text-gray-500">Return not found.</div>

  const lCls = 'block text-[10px] font-medium uppercase tracking-widest text-gray-600 mb-0.5'
  const vCls = 'text-sm text-gray-300'

  return (
    <div className="p-5 max-w-4xl bg-gray-950 min-h-full text-gray-100">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-2 text-xs text-gray-600 mb-4">
        <button onClick={() => navigate('/sales/returns')} className="hover:text-gray-400">Returns</button>
        <span>/</span>
        <span className="text-gray-400">{ret.return_pid ?? `RET-${rid}`}</span>
      </div>

      {/* header */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className={lCls}>Return PID</label><p className={`${vCls} font-mono`}>{ret.return_pid ?? '—'}</p></div>
          <div><label className={lCls}>Date</label><p className={vCls}>{fmtDate(ret.return_date)}</p></div>
          <div><label className={lCls}>Grand Total</label><p className="text-sm font-bold text-white">₱{fmt(ret.grand_total)}</p></div>
          <div><label className={lCls}>Reason</label><p className={vCls}>{ret.reason || '—'}</p></div>
          <div>
            <label className={lCls}>Original Sale</label>
            {ret.sale_id
              ? <button onClick={() => navigate(`/sales/ledger/${ret.sale_id}`)} className="text-sm text-blue-400 hover:underline font-mono">
                  {ret.sale_id}
                </button>
              : <p className={vCls}>Blind Return</p>}
          </div>
          {ret.exchange_sale_pid && (
            <div>
              <label className={lCls}>Exchange Sale</label>
              <button onClick={() => navigate(`/sales/ledger/${ret.exchange_sale_id}`)}
                className="text-sm text-emerald-400 hover:underline font-mono">
                {ret.exchange_sale_pid}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* line items */}
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2">Returned Items</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {['Variant','PID','Qty Returned','Unit Price','Line Total'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(ret.items ?? []).map((item: SalesReturnItemOut) => (
              <tr key={item.return_item_id} className="border-b border-gray-800">
                <td className="px-3 py-2 text-gray-300">{item.variant?.variant_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-gray-500">{item.variant?.PID ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums text-gray-300">{Number(item.quantity).toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums text-gray-400">₱{fmt(item.line_total / (item.quantity || 1))}</td>
                <td className="px-3 py-2 tabular-nums text-gray-200 font-medium">₱{fmt(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
