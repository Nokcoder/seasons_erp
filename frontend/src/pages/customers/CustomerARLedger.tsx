import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { salesApi, type ArLedgerOut, type CustomerOut } from '../../services/api'
import * as XLSX from 'xlsx'

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
}

const REASONS = ['SALE', 'PAYMENT', 'RETURN', 'ADJUSTMENT', 'AR_CHARGE', 'AR_CREDIT'] as const
type BalanceFilter = 'all' | 'outstanding' | 'credit'

export default function CustomerARLedger() {
  const navigate = useNavigate()

  const [custFilter,    setCustFilter]    = useState('')
  const [reasons,       setReasons]       = useState<Set<string>>(new Set())
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [search,        setSearch]        = useState('')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')

  const filters = useMemo(() => ({
    customer_id: custFilter ? parseInt(custFilter) : undefined,
    date_from:   dateFrom || undefined,
    date_to:     dateTo   || undefined,
  }), [custFilter, dateFrom, dateTo])

  const refQueries = useQueries({
    queries: [
      { queryKey: qk.arLedger(filters as Record<string, unknown>), queryFn: () => salesApi.arLedger.list(filters), ...stale.transactional },
      { queryKey: qk.customers(),                                   queryFn: () => salesApi.customers.list(),       ...stale.reference },
    ],
  })
  const [qLedger, qCustomers] = refQueries
  const allEntries  = (qLedger.data   ?? []) as ArLedgerOut[]
  const customers   = (qCustomers.data ?? []) as CustomerOut[]
  const fetching    = refQueries.some(r => r.isFetching && !r.isLoading)

  const customerMap    = useMemo(() => new Map(customers.map(c => [c.customer_id, c.customer_name])), [customers])
  const customerBalMap = useMemo(() => new Map(customers.map(c => [c.customer_id, c.outstanding_balance])), [customers])

  const filtered = useMemo(() => {
    return allEntries.filter(e => {
      if (reasons.size > 0 && !reasons.has(e.reason)) return false
      if (search.trim()) {
        const s = search.trim().toLowerCase()
        const cName = e.customer_id ? (customerMap.get(e.customer_id) ?? '').toLowerCase() : ''
        if (!cName.includes(s) && !(e.reference_id ?? '').toLowerCase().includes(s)) return false
      }
      if (balanceFilter !== 'all') {
        const bal = e.customer_id ? customerBalMap.get(e.customer_id) : undefined
        if (balanceFilter === 'outstanding' && !(bal != null && bal > 0)) return false
        if (balanceFilter === 'credit'      && !(bal != null && bal < 0)) return false
      }
      return true
    })
  }, [allEntries, reasons, search, balanceFilter, customerMap, customerBalMap])

  function toggleReason(r: string) {
    setReasons(prev => {
      const n = new Set(prev)
      n.has(r) ? n.delete(r) : n.add(r)
      return n
    })
  }

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet(filtered.map(e => ({
      'Date':           fmtDate(e.occurred_at),
      'Customer':       e.customer_id ? (customerMap.get(e.customer_id) ?? `ID ${e.customer_id}`) : 'Walk-in',
      'Type':           e.reason,
      'Reference':      `${e.reference_type ?? ''}/${e.reference_id ?? ''}`,
      'Amount Change':  e.amount_change,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AR Ledger')
    XLSX.writeFile(wb, `ar_ledger_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const inputCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
  const labelCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'

  return (
    <div className="flex h-full overflow-hidden t-bg-base">
      <FetchingBar show={fetching} />

      {/* filter panel */}
      <aside className="w-52 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-y-auto p-3 gap-4">
        <div>
          <label className={labelCls}>Search</label>
          <input className={inputCls} placeholder="Customer, reference…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Customer</label>
          <select className={inputCls} value={custFilter} onChange={e => setCustFilter(e.target.value)}>
            <option value="">All customers</option>
            {customers.filter(c => !c.is_deleted).map(c => (
              <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          {REASONS.map(r => (
            <label key={r} className="flex items-center gap-2 text-xs t-text-2 mb-1 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]"
                checked={reasons.has(r)} onChange={() => toggleReason(r)} />
              {r}
            </label>
          ))}
        </div>
        <div>
          <label className={labelCls}>Date From</label>
          <input type="date" className={inputCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Date To</label>
          <input type="date" className={inputCls} value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Balance</label>
          {([['all', 'All'], ['outstanding', 'Outstanding'], ['credit', 'Credit']] as [BalanceFilter, string][]).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-xs t-text-2 mb-1 cursor-pointer">
              <input type="radio" name="ar-balance" className="accent-[var(--accent)]"
                checked={balanceFilter === v} onChange={() => setBalanceFilter(v)} />
              {l}
            </label>
          ))}
        </div>
        <button onClick={() => { setCustFilter(''); setReasons(new Set()); setDateFrom(''); setDateTo(''); setSearch(''); setBalanceFilter('all') }}
          className="text-[10px] t-text-4 hover:t-text-2 text-left mt-auto">Clear all</button>
      </aside>

      {/* main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
          <span className="text-xs t-text-3">{filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}</span>
          <button onClick={handleExport} className="ml-auto px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">Export XLSX</button>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="t-bg-elevated border-b t-border-strong">
                {['Date', 'Customer', 'Type', 'Reference', 'Notes', 'Amount Change'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {qLedger.isLoading && <SkeletonTable rows={10} cols={6} />}
              {!qLedger.isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center t-text-4">No entries.</td></tr>
              )}
              {filtered.map(e => (
                <tr key={e.ar_ledger_id} className="border-b t-border hover:t-bg-surface transition-colors">
                  <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(e.occurred_at)}</td>
                  <td className="px-3 py-2 t-text-2">
                    {e.customer_id
                      ? <button onClick={() => navigate(`/customers/${e.customer_id}`)} className="hover:underline">{customerMap.get(e.customer_id) ?? `ID ${e.customer_id}`}</button>
                      : <span className="t-text-4">Walk-in</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      e.reason === 'SALE'        ? 'bg-blue-950 text-blue-400' :
                      e.reason === 'PAYMENT'     ? 'bg-emerald-950 text-emerald-400' :
                      e.reason === 'RETURN'      ? 'bg-purple-950 text-purple-400' :
                      e.reason === 'AR_CHARGE'   ? 'bg-amber-950 text-amber-400' :
                      e.reason === 'AR_CREDIT'   ? 'bg-cyan-950 text-cyan-400' :
                      't-bg-elevated t-text-3'
                    }`}>{e.reason.replace('_', ' ')}</span>
                  </td>
                  <td className="px-3 py-2 t-text-3 font-mono text-[10px]">
                    {e.reference_type === 'sales' ? (
                      <button onClick={() => navigate(`/sales/ledger/${e.reference_id}`)} className="text-blue-400 hover:underline">
                        {e.reference_type}/{e.reference_id}
                      </button>
                    ) : <span>{e.reference_type}/{e.reference_id}</span>}
                  </td>
                  <td className="px-3 py-2 t-text-3 max-w-[16rem] truncate" title={e.notes ?? undefined}>
                    {e.notes ?? <span className="t-text-4">—</span>}
                  </td>
                  <td className={`px-3 py-2 tabular-nums font-medium text-right ${e.amount_change > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {e.amount_change > 0 ? `+₱${fmt(e.amount_change)}` : `-₱${fmt(Math.abs(e.amount_change))}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
