import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { apApi, catalogueApi } from '../../services/api'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function php(n: number | null | undefined) {
  if (n == null) return '—'
  return `₱${fmt(n)}`
}

// ── reason styling ────────────────────────────────────────────────────────────

const REASON_CLS: Record<string, string> = {
  INVOICE:     'bg-blue-100 text-blue-700',
  PAYMENT:     'bg-green-100 text-green-700',
  CREDIT_MEMO: 'bg-purple-100 text-purple-700',
  ADJUSTMENT:  'bg-gray-100 text-gray-600',
}

// ── component ─────────────────────────────────────────────────────────────────

const selCls = 'px-2 py-1 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function ApLedger() {
  const [supplierId, setSupplierId] = useState('')

  const suppQ = useQuery({
    queryKey: qk.suppliers(),
    queryFn:  () => catalogueApi.suppliers.list(),
    staleTime: stale.reference,
  })

  const ledgerQ = useQuery({
    queryKey: qk.apLedger(supplierId ? Number(supplierId) : undefined),
    queryFn:  () => apApi.ledger.list(supplierId ? Number(supplierId) : undefined),
    staleTime: stale.transactional,
  })

  const rows = ledgerQ.data ?? []

  return (
    <div className="p-4 space-y-3">
      <FetchingBar show={ledgerQ.isFetching && !ledgerQ.isLoading} />

      {/* filter */}
      <div className="flex items-center gap-2">
        <select className={selCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">All Suppliers</option>
          {(suppQ.data ?? []).map(s => (
            <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
          ))}
        </select>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-lg border t-border">
        <table className="w-full text-xs t-text-1">
          <thead className="t-bg-surface border-b t-border">
            <tr>
              <th className="px-3 py-2 text-left font-medium t-text-3">Date</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Supplier</th>
              <th className="px-3 py-2 text-center font-medium t-text-3">Reason</th>
              <th className="px-3 py-2 text-right font-medium t-text-3">Amount Change</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y t-divide">
            {ledgerQ.isLoading ? (
              <SkeletonTable rows={8} cols={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center t-text-4">No ledger entries</td>
              </tr>
            ) : rows.map(entry => (
              <tr key={entry.ap_ledger_id} className="hover:t-bg-surface transition-colors">
                <td className="px-3 py-2">{fmtDate(entry.occurred_at)}</td>
                <td className="px-3 py-2">
                  {entry.supplier_name ?? (
                    <span className="font-mono t-text-4">#{entry.supplier_id}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${REASON_CLS[entry.reason] ?? 'bg-gray-100 text-gray-600'}`}>
                    {entry.reason}
                  </span>
                </td>
                <td className={`px-3 py-2 text-right font-mono ${entry.amount_change < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {entry.amount_change < 0 ? '−' : '+'}{php(Math.abs(entry.amount_change))}
                </td>
                <td className="px-3 py-2 t-text-3">
                  {entry.reference_type && entry.reference_id
                    ? `${entry.reference_type} #${entry.reference_id}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] t-text-4">{rows.length} entr{rows.length !== 1 ? 'ies' : 'y'}</p>
    </div>
  )
}
