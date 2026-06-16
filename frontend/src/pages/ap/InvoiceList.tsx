import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { apApi, catalogueApi, type InvoiceOut } from '../../services/api'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'short', timeZone: 'UTC' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function php(n: number | null | undefined) {
  if (n == null) return '—'
  return `₱${fmt(n)}`
}

// ── badge maps ────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  Unpaid:  'bg-red-100 text-red-700',
  Partial: 'bg-yellow-100 text-yellow-700',
  Paid:    'bg-green-100 text-green-700',
}
const VETTING_CLS: Record<string, string> = {
  Pending_Review: 'bg-gray-100 text-gray-600',
  Approved:       'bg-emerald-100 text-emerald-700',
  Rejected:       'bg-rose-100 text-rose-700',
}
const VETTING_LABEL: Record<string, string> = {
  Pending_Review: 'Pending',
  Approved:       'Approved',
  Rejected:       'Rejected',
}

// ── component ─────────────────────────────────────────────────────────────────

const selCls = 'px-2 py-1 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function InvoiceList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [supplierId, setSupplierId] = useState(searchParams.get('supplier_id') ?? '')
  const [status, setStatus]         = useState('')
  const [vetting, setVetting]       = useState('')

  const suppQ = useQuery({
    queryKey: qk.suppliers(),
    queryFn:  () => catalogueApi.suppliers.list(),
    staleTime: stale.reference,
  })

  const listQ = useQuery({
    queryKey: qk.invoices(supplierId ? Number(supplierId) : undefined),
    queryFn:  () => apApi.invoices.list({
      supplier_id: supplierId ? Number(supplierId) : undefined,
      status:      status || undefined,
    }),
    staleTime: stale.transactional,
  })

  const rows = useMemo<InvoiceOut[]>(() => {
    const data = listQ.data ?? []
    return vetting ? data.filter(r => r.vetting_status === vetting) : data
  }, [listQ.data, vetting])

  return (
    <div className="p-4 space-y-3">
      <FetchingBar show={listQ.isFetching && !listQ.isLoading} />

      {/* filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select className={selCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">All Suppliers</option>
          {(suppQ.data ?? []).map(s => (
            <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
          ))}
        </select>

        <select className={selCls} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Partial">Partial</option>
          <option value="Paid">Paid</option>
        </select>

        <select className={selCls} value={vetting} onChange={e => setVetting(e.target.value)}>
          <option value="">All Vetting</option>
          <option value="Pending_Review">Pending Review</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-lg border t-border">
        <table className="w-full text-xs t-text-1">
          <thead className="t-bg-surface border-b t-border">
            <tr>
              <th className="px-3 py-2 text-left font-medium t-text-3">Invoice #</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Supplier</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Date</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Due</th>
              <th className="px-3 py-2 text-right font-medium t-text-3">Amount</th>
              <th className="px-3 py-2 text-center font-medium t-text-3">Status</th>
              <th className="px-3 py-2 text-center font-medium t-text-3">Vetting</th>
              <th className="px-3 py-2 text-center font-medium t-text-3">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y t-divide">
            {listQ.isLoading ? (
              <SkeletonTable rows={8} cols={8} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center t-text-4">No invoices found</td>
              </tr>
            ) : rows.map(inv => (
              <tr
                key={inv.invoice_id}
                className="hover:t-bg-surface cursor-pointer transition-colors"
                onClick={() => navigate(`/ap/invoices/${inv.invoice_id}`)}
              >
                <td className="px-3 py-2 font-mono">
                  {inv.invoice_number ?? `#${inv.invoice_id}`}
                </td>
                <td className="px-3 py-2">{inv.supplier?.supplier_name ?? '—'}</td>
                <td className="px-3 py-2">{fmtDateOnly(inv.invoice_date)}</td>
                <td className="px-3 py-2">{fmtDateOnly(inv.due_date)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {inv.amended_amount != null
                    ? <span title={`Original: ${php(inv.total_amount)}`}>{php(inv.amended_amount)}<span className="t-text-4 ml-0.5">*</span></span>
                    : php(inv.total_amount)
                  }
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[inv.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${VETTING_CLS[inv.vetting_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {VETTING_LABEL[inv.vetting_status] ?? inv.vetting_status}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex gap-1 justify-center">
                    {inv.paid_before_received && (
                      <span title="Paid before goods received" className="inline-block px-1 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-700">PBR</span>
                    )}
                    {inv.check_drafted && (
                      <span title="Check drafted" className="inline-block px-1 py-0.5 rounded text-[9px] font-medium bg-purple-100 text-purple-700">CHK</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] t-text-4">{rows.length} invoice{rows.length !== 1 ? 's' : ''}</p>
    </div>
  )
}
