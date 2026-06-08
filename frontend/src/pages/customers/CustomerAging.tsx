import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import { salesApi, type CustomerAgingOut } from '../../services/api'
import * as XLSX from 'xlsx'

const ALLOWED_ROLES = ['ADMIN', 'STORE_MANAGER']

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function termsLabel(days: number) {
  if (days === 0) return 'COD'
  return `Net ${days}`
}

type BalanceFilter = 'outstanding' | 'all'
type Bucket = 'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_90_plus'
type SortKey = 'customer_name' | 'total_outstanding'
type SortDir = 'asc' | 'desc'

const BUCKETS: { key: Bucket; label: string; cellCls: string }[] = [
  { key: 'current',      label: 'Current',    cellCls: 't-text-2' },
  { key: 'days_1_30',    label: '1-30 Days',  cellCls: 'text-yellow-400' },
  { key: 'days_31_60',   label: '31-60 Days', cellCls: 'text-amber-400' },
  { key: 'days_61_90',   label: '61-90 Days', cellCls: 'text-orange-400' },
  { key: 'days_90_plus', label: '90+ Days',   cellCls: 'text-red-400 font-semibold' },
]

export default function CustomerAging() {
  const navigate = useNavigate()
  const { user } = useAuth()
  if (!user || !user.roles.some(r => ALLOWED_ROLES.includes(r))) return <Navigate to="/customers" replace />

  const [search,        setSearch]        = useState('')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('outstanding')
  const [bucketFilter,  setBucketFilter]  = useState<Set<Bucket>>(new Set())
  const [sortKey,       setSortKey]       = useState<SortKey>('total_outstanding')
  const [sortDir,       setSortDir]       = useState<SortDir>('desc')

  const params = useMemo(() => ({ include_zero_balance: balanceFilter === 'all' }), [balanceFilter])

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: qk.customerAging(params as Record<string, unknown>),
    queryFn:  () => salesApi.customers.aging(params),
    ...stale.transactional,
  })

  function toggleBucket(b: Bucket) {
    setBucketFilter(prev => {
      const n = new Set(prev)
      n.has(b) ? n.delete(b) : n.add(b)
      return n
    })
  }

  const filtered = useMemo(() => {
    let list = rows.filter(r => {
      if (search.trim() && !r.customer_name.toLowerCase().includes(search.trim().toLowerCase())) return false
      if (bucketFilter.size > 0 && ![...bucketFilter].some(b => Number(r[b]) > 0)) return false
      return true
    })
    list = [...list].sort((a, b) => {
      let cmp = 0
      if      (sortKey === 'customer_name')      cmp = a.customer_name.localeCompare(b.customer_name)
      else if (sortKey === 'total_outstanding')  cmp = a.total_outstanding - b.total_outstanding
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [rows, search, bucketFilter, sortKey, sortDir])

  const totals = useMemo(() => {
    const t = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, total_outstanding: 0 }
    for (const r of filtered) {
      t.current           += r.current
      t.days_1_30         += r.days_1_30
      t.days_31_60        += r.days_31_60
      t.days_61_90        += r.days_61_90
      t.days_90_plus      += r.days_90_plus
      t.total_outstanding += r.total_outstanding
    }
    return t
  }, [filtered])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'customer_name' ? 'asc' : 'desc') }
  }
  function sortIcon(key: SortKey) {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet([
      ...filtered.map((r: CustomerAgingOut) => ({
        'Customer Name':      r.customer_name,
        'Terms':              termsLabel(r.terms_days),
        'Current':            r.current,
        '1-30 Days':          r.days_1_30,
        '31-60 Days':         r.days_31_60,
        '61-90 Days':         r.days_61_90,
        '90+ Days':           r.days_90_plus,
        'Total Outstanding':  r.total_outstanding,
      })),
      {
        'Customer Name':      'TOTAL',
        'Terms':              '',
        'Current':            totals.current,
        '1-30 Days':          totals.days_1_30,
        '31-60 Days':         totals.days_31_60,
        '61-90 Days':         totals.days_61_90,
        '90+ Days':           totals.days_90_plus,
        'Total Outstanding':  totals.total_outstanding,
      },
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AR Aging')
    XLSX.writeFile(wb, `ar_aging_${todayLocal()}.xlsx`)
  }

  const inputCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
  const labelCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'
  const thCls    = 'text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'
  const thSortCls = `${thCls} cursor-pointer hover:t-text-1 select-none`
  const thNumCls  = 'text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'

  return (
    <div className="flex h-full overflow-hidden t-bg-base">
      <FetchingBar show={isFetching && !isLoading} />

      {/* filter panel */}
      <aside className="w-52 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-y-auto p-3 gap-4">
        <div>
          <label className={labelCls}>Keyword</label>
          <input className={inputCls} placeholder="Customer name…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Balance</label>
          <div className="flex flex-col gap-1">
            {([['outstanding', 'Outstanding only'], ['all', 'All active customers']] as [BalanceFilter, string][]).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-xs t-text-2 cursor-pointer">
                <input type="radio" name="aging-balance" className="accent-[var(--accent)]"
                  checked={balanceFilter === v} onChange={() => setBalanceFilter(v)} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Aging Bucket</label>
          {BUCKETS.map(b => (
            <label key={b.key} className="flex items-center gap-2 text-xs t-text-2 mb-1 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]"
                checked={bucketFilter.has(b.key)} onChange={() => toggleBucket(b.key)} />
              {b.label}
            </label>
          ))}
          {bucketFilter.size > 0 && (
            <button onClick={() => setBucketFilter(new Set())}
              className="text-[10px] t-text-4 hover:t-text-2 mt-1">Clear bucket filter</button>
          )}
        </div>
      </aside>

      {/* main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
          <span className="text-xs t-text-3">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={handleExport}
            className="ml-auto px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
            Export XLSX
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="t-bg-elevated border-b t-border-strong">
                <th className={thSortCls} onClick={() => toggleSort('customer_name')}>Customer Name{sortIcon('customer_name')}</th>
                <th className={thCls}>Terms</th>
                {BUCKETS.map(b => (
                  <th key={b.key} className={thNumCls}>{b.label}</th>
                ))}
                <th className={`${thNumCls} cursor-pointer hover:t-text-1 select-none`} onClick={() => toggleSort('total_outstanding')}>
                  Total Outstanding{sortIcon('total_outstanding')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <SkeletonTable rows={8} cols={8} />}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center t-text-4">No customers match the current filters.</td></tr>
              )}
              {!isLoading && filtered.map(r => (
                <tr key={r.customer_id}
                  onClick={() => navigate(`/customers/${r.customer_id}`)}
                  className="border-b t-border hover:t-bg-surface cursor-pointer transition-colors">
                  <td className="px-3 py-2 t-text-1 font-medium">{r.customer_name}</td>
                  <td className="px-3 py-2 t-text-3">{termsLabel(r.terms_days)}</td>
                  {BUCKETS.map(b => (
                    <td key={b.key} className={`px-3 py-2 tabular-nums text-right ${b.cellCls}`}>
                      {r[b.key] !== 0 ? `₱${fmt(r[b.key])}` : <span className="t-text-4">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 tabular-nums text-right font-semibold">
                    <span className={r.total_outstanding > 0 ? 'text-yellow-400' : 't-text-3'}>
                      {r.total_outstanding !== 0 ? `₱${fmt(r.total_outstanding)}` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {!isLoading && filtered.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="t-bg-elevated border-t t-border-strong font-semibold">
                  <td className="px-3 py-2 t-text-1" colSpan={2}>Totals</td>
                  <td className="px-3 py-2 tabular-nums text-right t-text-2">{totals.current !== 0 ? `₱${fmt(totals.current)}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-yellow-400">{totals.days_1_30 !== 0 ? `₱${fmt(totals.days_1_30)}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-amber-400">{totals.days_31_60 !== 0 ? `₱${fmt(totals.days_31_60)}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-orange-400">{totals.days_61_90 !== 0 ? `₱${fmt(totals.days_61_90)}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-red-400">{totals.days_90_plus !== 0 ? `₱${fmt(totals.days_90_plus)}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-yellow-400">{totals.total_outstanding !== 0 ? `₱${fmt(totals.total_outstanding)}` : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
