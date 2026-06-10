import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import { salesApi } from '../../services/api'
import * as XLSX from 'xlsx'

const ALLOWED_ROLES = ['ADMIN', 'STORE_MANAGER']

interface AgingRowOut {
  customer_id:  number
  customer_name: string
  invoice_id:   number
  invoice_date: string  // "YYYY-MM-DD"
  due_date:     string  // "YYYY-MM-DD"
  current_amt:  number
  days_1_30:    number
  days_31_60:   number
  days_61_90:   number
  days_91_plus: number
}

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmt(n: number) {
  if (n === 0) return ''
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC',
  })
}

const BUCKET_COLS: { key: keyof AgingRowOut & string; label: string; cellCls: string }[] = [
  { key: 'current_amt',  label: 'Current',    cellCls: 't-text-2' },
  { key: 'days_1_30',    label: '1–30 Days',  cellCls: 'text-yellow-400' },
  { key: 'days_31_60',   label: '31–60 Days', cellCls: 'text-amber-400' },
  { key: 'days_61_90',   label: '61–90 Days', cellCls: 'text-orange-400' },
  { key: 'days_91_plus', label: '90+ Days',   cellCls: 'text-red-400' },
]

type BucketKey = 'current_amt' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_91_plus'
const ZERO_TOTALS = { current_amt: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0 }

export default function CustomerAging() {
  const { user } = useAuth()
  if (!user || !user.roles.some(r => ALLOWED_ROLES.includes(r))) return <Navigate to="/customers" replace />

  const [search, setSearch] = useState('')

  const { data: rawData, isLoading, isFetching } = useQuery({
    queryKey: qk.customerAging({} as Record<string, unknown>),
    queryFn:  () => salesApi.customers.aging() as unknown as Promise<AgingRowOut[]>,
    ...stale.transactional,
  })
  const rows: AgingRowOut[] = rawData ?? []

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.trim().toLowerCase()
    return rows.filter(r => r.customer_name.toLowerCase().includes(s))
  }, [rows, search])

  const totals = useMemo(() =>
    filtered.reduce<Record<BucketKey, number>>((acc, r) => ({
      current_amt:  acc.current_amt  + Number(r.current_amt),
      days_1_30:    acc.days_1_30    + Number(r.days_1_30),
      days_31_60:   acc.days_31_60   + Number(r.days_31_60),
      days_61_90:   acc.days_61_90   + Number(r.days_61_90),
      days_91_plus: acc.days_91_plus + Number(r.days_91_plus),
    }), { ...ZERO_TOTALS }),
  [filtered])

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet([
      ...filtered.map(r => ({
        'Customer':     r.customer_name,
        'Invoice #':    r.invoice_id,
        'Invoice Date': fmtDate(r.invoice_date),
        'Due Date':     fmtDate(r.due_date),
        'Current':      r.current_amt   || '',
        '1-30 Days':    r.days_1_30     || '',
        '31-60 Days':   r.days_31_60    || '',
        '61-90 Days':   r.days_61_90    || '',
        '90+ Days':     r.days_91_plus  || '',
      })),
      {
        'Customer':     'Total',
        'Invoice #':    '',
        'Invoice Date': '',
        'Due Date':     '',
        'Current':      totals.current_amt   || '',
        '1-30 Days':    totals.days_1_30     || '',
        '31-60 Days':   totals.days_31_60    || '',
        '61-90 Days':   totals.days_61_90    || '',
        '90+ Days':     totals.days_91_plus  || '',
      },
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AR Aging')
    XLSX.writeFile(wb, `ar_aging_${todayLocal()}.xlsx`)
  }

  const inputCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
  const labelCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'
  const thCls    = 'text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'
  const thNumCls = 'text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'

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
      </aside>

      {/* main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
          <span className="text-xs t-text-3">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={handleExport}
            className="ml-auto px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
            Export XLSX
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="t-bg-elevated border-b t-border-strong">
                <th className={thCls}>Customer</th>
                <th className={thCls}>Invoice #</th>
                <th className={thCls}>Invoice Date</th>
                <th className={thCls}>Due Date</th>
                {BUCKET_COLS.map(b => (
                  <th key={b.key} className={thNumCls}>{b.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <SkeletonTable rows={8} cols={9} />}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center t-text-4">No outstanding invoices.</td></tr>
              )}
              {!isLoading && filtered.map((r, idx) => {
                const isFirst = idx === 0 || filtered[idx - 1].customer_id !== r.customer_id
                return (
                  <tr key={r.invoice_id} className="border-b t-border">
                    <td className="px-3 py-2 t-text-1 font-medium">
                      {isFirst ? r.customer_name : ''}
                    </td>
                    <td className="px-3 py-2 t-text-3 font-mono">{r.invoice_id}</td>
                    <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(r.invoice_date)}</td>
                    <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(r.due_date)}</td>
                    {BUCKET_COLS.map(b => (
                      <td key={b.key} className={`px-3 py-2 tabular-nums text-right ${b.cellCls}`}>
                        {fmt(r[b.key] as number)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
            {!isLoading && filtered.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="t-bg-elevated border-t t-border-strong font-semibold">
                  <td className="px-3 py-2 t-text-1" colSpan={4}>Total</td>
                  {BUCKET_COLS.map(b => (
                    <td key={b.key} className={`px-3 py-2 tabular-nums text-right ${b.cellCls}`}>
                      {fmt(totals[b.key as BucketKey])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
