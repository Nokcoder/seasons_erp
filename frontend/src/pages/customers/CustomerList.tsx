import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { salesApi } from '../../services/api'
import * as XLSX from 'xlsx'

const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function termsLabel(days: number) {
  if (days === 0) return 'COD'
  return `Net ${days}`
}

type BalanceFilter = 'all' | 'outstanding' | 'overdue' | 'credit'
type SortKey = 'customer_name' | 'outstanding_balance' | 'terms_days'
type SortDir = 'asc' | 'desc'

export default function CustomerList() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // ── filters ───────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState<'Active' | 'Both' | 'Inactive'>('Active')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')
  const [sortKey,       setSortKey]       = useState<SortKey>('customer_name')
  const [sortDir,       setSortDir]       = useState<SortDir>('asc')

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: allCustomers = [], isLoading, isFetching } = useQuery({
    queryKey: qk.customers(),
    queryFn:  () => salesApi.customers.list({ include_deleted: true }),
    ...stale.transactional,
  })

  // ── new customer modal ────────────────────────────────────────────────────
  const [showNew,    setShowNew]    = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newLimit,   setNewLimit]   = useState('')
  const [newTerms,   setNewTerms]   = useState('0')
  const [creating,   setCreating]   = useState(false)
  const [createErr,  setCreateErr]  = useState('')

  async function handleCreate() {
    if (!newName.trim()) { setCreateErr('Customer name is required.'); return }
    setCreating(true); setCreateErr('')
    try {
      await salesApi.customers.create({
        customer_name: newName.trim(),
        credit_limit:  newLimit ? parseFloat(newLimit) : null,
        terms_days:    parseInt(newTerms) || 0,
      })
      await qc.invalidateQueries({ queryKey: qk.customers() })
      setShowNew(false); setNewName(''); setNewLimit(''); setNewTerms('0')
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : 'Create failed')
    } finally { setCreating(false) }
  }

  // ── filtered + sorted ─────────────────────────────────────────────────────
  const rows = useMemo(() => {
    let list = allCustomers.filter(c => {
      if (statusFilter === 'Active'   && c.is_deleted)  return false
      if (statusFilter === 'Inactive' && !c.is_deleted) return false
      if (search.trim()) {
        if (!c.customer_name.toLowerCase().includes(search.trim().toLowerCase())) return false
      }
      if (balanceFilter === 'outstanding' && !(c.outstanding_balance > 0)) return false
      if (balanceFilter === 'overdue'     && !c.is_overdue)                return false
      if (balanceFilter === 'credit'      && !(c.outstanding_balance < 0)) return false
      return true
    })
    list = [...list].sort((a, b) => {
      let cmp = 0
      if      (sortKey === 'customer_name')        cmp = a.customer_name.localeCompare(b.customer_name)
      else if (sortKey === 'outstanding_balance')  cmp = a.outstanding_balance - b.outstanding_balance
      else if (sortKey === 'terms_days')           cmp = a.terms_days - b.terms_days
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [allCustomers, search, statusFilter, balanceFilter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  function sortIcon(key: SortKey) {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet(rows.map(c => ({
      'Customer Name':       c.customer_name,
      'Terms':               termsLabel(c.terms_days),
      'Credit Limit':        c.credit_limit ?? '',
      'Outstanding Balance': c.outstanding_balance,
      'Status':              c.is_deleted ? 'Inactive' : 'Active',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Customers')
    XLSX.writeFile(wb, `customers_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const inputCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
  const labelCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'
  const thCls =
    `text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap cursor-pointer hover:t-text-1 select-none`

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
          <label className={labelCls}>Status</label>
          <div className="flex rounded overflow-hidden border t-border-strong text-[11px]">
            {(['Active', 'Both', 'Inactive'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`flex-1 py-1 transition-colors ${statusFilter === s ? 'text-white' : 't-text-2 hover:t-bg-elevated'}`}
                style={statusFilter === s ? { backgroundColor: 'var(--accent)' } : undefined}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Balance</label>
          {([['all', 'All'], ['outstanding', 'Has Outstanding Balance'], ['overdue', 'Overdue'], ['credit', 'Has Credit']] as [BalanceFilter, string][]).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-xs t-text-2 mb-1 cursor-pointer">
              <input type="radio" name="balance" className="accent-[var(--accent)]"
                checked={balanceFilter === v} onChange={() => setBalanceFilter(v)} />
              {l}
            </label>
          ))}
        </div>
      </aside>

      {/* main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
          <span className="text-xs t-text-3">{rows.length} customer{rows.length !== 1 ? 's' : ''}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={handleExport}
              className="px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
              Export XLSX
            </button>
            <button onClick={() => setShowNew(true)}
              className="px-3 py-1 text-xs rounded text-white font-medium"
              style={{ backgroundColor: 'var(--accent)' }}>
              + New Customer
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="t-bg-elevated border-b t-border-strong">
                <th className={thCls}    onClick={() => toggleSort('customer_name')}>Customer Name{sortIcon('customer_name')}</th>
                <th className={thCls}       onClick={() => toggleSort('terms_days')}>Terms{sortIcon('terms_days')}</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">Credit Limit</th>
                <th className={thCls} onClick={() => toggleSort('outstanding_balance')}>Outstanding Balance{sortIcon('outstanding_balance')}</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <SkeletonTable rows={8} cols={6} />}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center t-text-4">No customers match the current filters.</td></tr>
              )}
              {!isLoading && rows.map(c => (
                <tr key={c.customer_id}
                  onClick={() => navigate(`/customers/${c.customer_id}`)}
                  className={`border-b t-border hover:t-bg-surface cursor-pointer transition-colors ${c.is_deleted ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 t-text-1 font-medium">{c.customer_name}</td>
                  <td className="px-3 py-2 t-text-3">{termsLabel(c.terms_days)}</td>
                  <td className="px-3 py-2 tabular-nums t-text-3 text-right">{c.credit_limit != null ? `₱${fmt(c.credit_limit)}` : 'No Limit'}</td>
                  <td className="px-3 py-2 tabular-nums text-right">
                    <span className={c.outstanding_balance > 0 ? 'text-yellow-400 font-medium' : c.outstanding_balance < 0 ? 'font-medium' : 't-text-3'}
                      style={c.outstanding_balance < 0 ? { color: 'var(--accent)' } : undefined}>
                      {c.outstanding_balance !== 0 ? `₱${fmt(c.outstanding_balance)}` : '—'}
                    </span>
                    {c.is_overdue && (
                      <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-yellow-950 text-yellow-500 align-middle">Overdue</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${!c.is_deleted ? 'bg-emerald-950 text-emerald-500' : 't-bg-elevated t-text-3'}`}>
                      {c.is_deleted ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={e => { e.stopPropagation(); navigate(`/customers/${c.customer_id}`) }}
                      className="text-[10px] t-text-3 hover:t-text-1">View →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Customer Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowNew(false)}>
          <div className="t-bg-surface border t-border-strong rounded-lg p-5 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold t-text-1 mb-4">New Customer</p>
            {createErr && <p className="text-xs text-red-400 mb-3">{createErr}</p>}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Customer Name *</label>
                <input className={inputCls} value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onFocus={onFocusSelect} />
              </div>
              <div>
                <label className={labelCls}>Credit Limit (blank = no limit)</label>
                <input type="number" min="0" step="0.01" className={inputCls}
                  value={newLimit} onChange={e => setNewLimit(e.target.value)}
                  onFocus={onFocusSelect} placeholder="—" />
              </div>
              <div>
                <label className={labelCls}>Terms Days (0 = COD)</label>
                <input type="number" min="0" step="1" className={inputCls}
                  value={newTerms} onChange={e => setNewTerms(e.target.value)}
                  onFocus={onFocusSelect} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleCreate} disabled={creating}
                className="flex-1 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent)' }}>
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setShowNew(false)}
                className="px-4 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
