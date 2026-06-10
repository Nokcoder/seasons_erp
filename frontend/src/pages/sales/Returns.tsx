import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  salesApi, inventoryApi,
  type SalesReturnOut, type Location, type CustomerOut,
} from '../../services/api'
import * as XLSX from 'xlsx'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
}
function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'UTC' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Returns() {
  const navigate = useNavigate()

  const [search,      setSearch]      = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [locFilter,   setLocFilter]   = useState('')
  const [custFilter,  setCustFilter]  = useState('')
  const [hasExchange, setHasExchange] = useState(false)

  const refQ = useQueries({
    queries: [
      { queryKey: qk.locations(),  queryFn: inventoryApi.locations.all, ...stale.reference },
      { queryKey: qk.customers(),  queryFn: salesApi.customers.list,    ...stale.reference },
    ],
  })
  const locations = (refQ[0].data ?? []) as Location[]
  const customers = (refQ[1].data ?? []) as CustomerOut[]

  const params = useMemo(() => ({
    search:      search.trim() || undefined,
    date_from:   dateFrom || undefined,
    date_to:     dateTo   || undefined,
    location_id: locFilter  ? parseInt(locFilter)  : undefined,
    customer_id: custFilter ? parseInt(custFilter) : undefined,
    has_exchange: hasExchange || undefined,
    limit: 200,
  }), [search, dateFrom, dateTo, locFilter, custFilter, hasExchange])

  const { data: returns = [], isLoading, isFetching } = useQuery({
    queryKey: qk.salesReturns(params as Record<string, unknown>),
    queryFn:  () => salesApi.returns.list(params),
    ...stale.transactional,
  })

  const locationMap = useMemo(() => new Map(locations.map(l => [l.location_id, l.location_name])), [locations])
  const customerMap = useMemo(() => new Map(customers.map(c => [c.customer_id, c.customer_name])), [customers])

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet((returns as SalesReturnOut[]).map(r => ({
      'Return PID':    r.return_pid ?? '',
      'Date':          fmtDateOnly(r.return_date),
      'Original Sale': r.sale_id ?? '',
      'Customer':      r.customer_id ? (customerMap.get(r.customer_id) ?? '') : '',
      'Location':      locationMap.get(r.location_id) ?? '',
      'Return Total':  r.grand_total,
      'Exchange Sale': r.exchange_sale_pid ?? '',
      'Reason':        r.reason ?? '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Returns')
    XLSX.writeFile(wb, `returns_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const totalValue = (returns as SalesReturnOut[]).reduce((s, r) => s + Number(r.grand_total), 0)

  const iCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] w-full'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'

  return (
    <div className="flex flex-col h-full overflow-hidden t-bg-base">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* filter panel */}
        <aside className="w-52 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-y-auto p-3 gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest t-text-4">Filters</p>
          <div>
            <label className={lCls}>Search</label>
            <input className={iCls} placeholder="Return PID…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div>
            <label className={lCls}>Date From</label>
            <input type="date" className={iCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className={lCls}>Date To</label>
            <input type="date" className={iCls} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div>
            <label className={lCls}>Location</label>
            <select className={iCls} value={locFilter} onChange={e => setLocFilter(e.target.value)}>
              <option value="">All</option>
              {locations.filter(l => l.status === 'Active').map(l => (
                <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lCls}>Customer</label>
            <select className={iCls} value={custFilter} onChange={e => setCustFilter(e.target.value)}>
              <option value="">All</option>
              {customers.filter(c => !c.is_deleted).map(c => (
                <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs t-text-2 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]"
                checked={hasExchange} onChange={e => setHasExchange(e.target.checked)} />
              Has Exchange
            </label>
          </div>
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setLocFilter(''); setCustFilter(''); setHasExchange(false) }}
            className="text-[10px] t-text-4 hover:t-text-2 text-left mt-auto">Clear all</button>
        </aside>

        {/* table */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
            <span className="text-xs t-text-3">{returns.length} return{returns.length !== 1 ? 's' : ''}</span>
            <span className="text-xs t-text-4">· Total ₱{fmt(totalValue)}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={handleExport} className="px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">Export XLSX</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="t-bg-elevated border-b t-border-strong">
                  {['Return PID','Date','Original Sale','Customer','Location','Return Total','Exchange Sale','Reason',''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && <SkeletonTable rows={8} cols={9} />}
                {!isLoading && returns.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-10 text-center t-text-4">No returns found.</td></tr>
                )}
                {!isLoading && (returns as SalesReturnOut[]).map(r => (
                  <tr key={r.return_id}
                    onClick={() => navigate(`/sales/returns/${r.return_id}`)}
                    className="border-b t-border hover:t-bg-surface cursor-pointer transition-colors">
                    <td className="px-3 py-2 font-mono t-text-1">{r.return_pid ?? '—'}</td>
                    <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDateOnly(r.return_date)}</td>
                    <td className="px-3 py-2">
                      {r.sale_id
                        ? <button onClick={e => { e.stopPropagation(); navigate(`/sales/ledger/${r.sale_id}`) }}
                            className="font-mono text-blue-400 hover:underline">
                            {r.sale_id}
                          </button>
                        : <span className="t-text-4">Blind</span>}
                    </td>
                    <td className="px-3 py-2 t-text-2">
                      {r.customer_id ? customerMap.get(r.customer_id) ?? '—' : 'Walk-in'}
                    </td>
                    <td className="px-3 py-2 t-text-3">{locationMap.get(r.location_id) ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums t-text-1 font-medium text-right">₱{fmt(r.grand_total)}</td>
                    <td className="px-3 py-2">
                      {r.exchange_sale_pid
                        ? <button onClick={e => { e.stopPropagation(); navigate(`/sales/ledger/${r.exchange_sale_id}`) }}
                            className="font-mono text-emerald-400 hover:underline">
                            {r.exchange_sale_pid}
                          </button>
                        : <span className="t-text-4">—</span>}
                    </td>
                    <td className="px-3 py-2 t-text-3 max-w-[160px] truncate">{r.reason || '—'}</td>
                    <td className="px-3 py-2">
                      <button className="text-[10px] text-blue-400 hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
