import { useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { salesApi, type PDCEntryOut } from '../../services/api'

type StatusFilter = 'IN_VAULT' | 'DEPOSITED' | 'BOUNCED' | 'ALL'

const statusLabel: Record<StatusFilter, string> = {
  ALL:       'All',
  IN_VAULT:  'In Vault',
  DEPOSITED: 'Deposited',
  BOUNCED:   'Bounced',
}

const statusColor: Record<string, string> = {
  IN_VAULT:  'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  DEPOSITED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  BOUNCED:   'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'short', timeZone: 'UTC' })
}
function phToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

export default function PDCVault() {
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('IN_VAULT')
  const [bankFilter,   setBankFilter]   = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')

  // ── deposit modal state ───────────────────────────────────────────────────
  const [depositTarget, setDepositTarget] = useState<PDCEntryOut | null>(null)
  const [depositDate,   setDepositDate]   = useState('')
  const [depositing,    setDepositing]    = useState(false)
  const [depositErr,    setDepositErr]    = useState('')

  // ── bounce modal state ────────────────────────────────────────────────────
  const [bounceTarget, setBounceTarget] = useState<PDCEntryOut | null>(null)
  const [bounceNotes,  setBounceNotes]  = useState('')
  const [bouncing,     setBouncing]     = useState(false)
  const [bounceErr,    setBounceErr]    = useState('')

  const filters = {
    status:    statusFilter !== 'ALL' ? statusFilter : undefined,
    bank_name: bankFilter.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  }

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: qk.pdcVault(filters),
    queryFn:  () => salesApi.pdc.list(filters),
    ...stale.transactional,
  })

  const summary   = data?.summary
  const entries   = data?.entries ?? []

  // ── deposit handlers ──────────────────────────────────────────────────────
  function openDeposit(entry: PDCEntryOut) {
    setDepositTarget(entry)
    setDepositDate(phToday())
    setDepositErr('')
  }
  function closeDeposit() {
    setDepositTarget(null)
    setDepositing(false)
    setDepositErr('')
  }
  async function handleDeposit() {
    if (!depositTarget) return
    if (!depositDate) { setDepositErr('Enter a deposit date.'); return }
    setDepositing(true); setDepositErr('')
    try {
      await salesApi.pdc.deposit(depositTarget.payment_id, { deposit_date: depositDate })
      await qc.invalidateQueries({ queryKey: ['pdc-vault'] })
      closeDeposit()
    } catch (e: unknown) {
      setDepositErr(e instanceof Error ? e.message : 'Deposit failed.')
    } finally { setDepositing(false) }
  }

  // ── bounce handlers ───────────────────────────────────────────────────────
  function openBounce(entry: PDCEntryOut) {
    setBounceTarget(entry)
    setBounceNotes('')
    setBounceErr('')
  }
  function closeBounce() {
    setBounceTarget(null)
    setBouncing(false)
    setBounceErr('')
  }
  async function handleBounce() {
    if (!bounceTarget) return
    setBouncing(true); setBounceErr('')
    try {
      await salesApi.pdc.bounce(bounceTarget.payment_id, { notes: bounceNotes.trim() || undefined })
      await qc.invalidateQueries({ queryKey: ['pdc-vault'] })
      closeBounce()
    } catch (e: unknown) {
      setBounceErr(e instanceof Error ? e.message : 'Bounce failed.')
    } finally { setBouncing(false) }
  }

  const inputCls = 'px-2 py-1 text-xs t-bg-input border t-border-strong rounded focus:outline-none focus:ring-1 ring-[var(--accent)]'
  const lCls    = 'block text-[10px] uppercase tracking-wide t-text-3 mb-1'

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <FetchingBar fetching={isFetching && !isLoading} />

      <h1 className="text-base font-semibold t-text-1">PDC Vault</h1>

      {/* summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Maturing Today',  value: summary.maturing_today,  color: 'text-amber-400' },
            { label: 'Next 7 Days',     value: summary.next_7_days,     color: 'text-blue-400' },
            { label: 'Overdue',         value: summary.overdue,         color: 'text-red-400' },
            { label: 'Total Uncleared', value: summary.total_uncleared, color: 't-text-1' },
          ].map(c => (
            <div key={c.label} className="t-bg-surface border t-border rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide t-text-3 mb-1">{c.label}</p>
              <p className={`text-lg font-bold tabular-nums ${c.color}`}>₱{fmt(c.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {(['IN_VAULT', 'DEPOSITED', 'BOUNCED', 'ALL'] as StatusFilter[]).map(s => (
          <button key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${
              statusFilter === s
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 't-border t-text-3 hover:t-border-strong'
            }`}>
            {statusLabel[s]}
          </button>
        ))}
        <input className={inputCls} placeholder="Bank name…" value={bankFilter} onChange={e => setBankFilter(e.target.value)} />
        <input type="date" className={inputCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Check date from" />
        <input type="date" className={inputCls} value={dateTo}   onChange={e => setDateTo(e.target.value)}   title="Check date to" />
        {(bankFilter || dateFrom || dateTo) && (
          <button onClick={() => { setBankFilter(''); setDateFrom(''); setDateTo('') }}
            className="text-xs t-text-3 hover:t-text-1 underline">
            Clear
          </button>
        )}
      </div>

      {/* table */}
      {error && <p className="text-xs text-red-400">{String(error)}</p>}
      <div className="t-bg-surface border t-border rounded-lg overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border t-bg-elevated">
              {['Check #','Bank','Check Date','Days','Customer','Amount','Sale(s)','Status','Actions'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-wide t-text-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable rows={5} cols={9} />}
            {!isLoading && entries.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center t-text-3">No checks found.</td></tr>
            )}
            {entries.map(e => {
              const days = e.days_until_maturity
              const daysLabel = days == null ? '—'
                : days === 0 ? 'Today'
                : days > 0   ? `+${days}d`
                : `${days}d`
              const daysColor = days == null ? ''
                : days < 0 ? 'text-red-400'
                : days === 0 ? 'text-amber-400'
                : ''
              return (
                <tr key={e.payment_id} className="border-b t-border hover:t-bg-elevated transition-colors">
                  <td className="px-3 py-2 font-mono t-text-1">{e.check_number ?? '—'}</td>
                  <td className="px-3 py-2 t-text-2">{e.bank_name ?? '—'}</td>
                  <td className="px-3 py-2 t-text-2 whitespace-nowrap">{fmtDateOnly(e.check_date)}</td>
                  <td className={`px-3 py-2 tabular-nums font-medium ${daysColor}`}>{daysLabel}</td>
                  <td className="px-3 py-2 t-text-1">{e.customer_name}</td>
                  <td className="px-3 py-2 tabular-nums text-right t-text-1">₱{fmt(e.amount_applied)}</td>
                  <td className="px-3 py-2 t-text-3">{e.sale_pids?.join(', ') ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor[e.check_status ?? ''] ?? ''}`}>
                      {e.check_status?.replace('_', ' ') ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {e.check_status === 'IN_VAULT' && (
                      <div className="flex gap-1">
                        <button onClick={() => openDeposit(e)}
                          className="px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                          Deposit
                        </button>
                        <button onClick={() => openBounce(e)}
                          className="px-2 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-700 transition-colors">
                          Bounce
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── deposit modal ───────────────────────────────────────────────────── */}
      {depositTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeDeposit} />
          <div className="relative z-10 t-bg-surface border t-border rounded-lg shadow-2xl w-80 p-5">
            <h2 className="text-sm font-semibold t-text-1 mb-1">Mark as Deposited</h2>
            <p className="text-xs t-text-3 mb-4">Check #{depositTarget.check_number} — {depositTarget.bank_name}</p>
            <div className="space-y-3">
              <div>
                <label className={lCls}>Deposit Date *</label>
                <input type="date" className={inputCls + ' w-full'} value={depositDate} onChange={e => setDepositDate(e.target.value)} />
              </div>
              {depositErr && <p className="text-xs text-red-400">{depositErr}</p>}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleDeposit} disabled={depositing}
                className="flex-1 py-1.5 text-xs rounded text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40">
                {depositing ? 'Saving…' : 'Confirm Deposit'}
              </button>
              <button onClick={closeDeposit} className="px-4 py-1.5 text-xs border t-border rounded t-text-2">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── bounce modal ────────────────────────────────────────────────────── */}
      {bounceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeBounce} />
          <div className="relative z-10 t-bg-surface border t-border rounded-lg shadow-2xl w-80 p-5">
            <h2 className="text-sm font-semibold t-text-1 mb-1">Mark as Bounced</h2>
            <p className="text-xs t-text-3 mb-1">Check #{bounceTarget.check_number} — {bounceTarget.bank_name}</p>
            <p className="text-[10px] text-amber-400 mb-4">
              This will reverse the payment and restore the customer's balance. The customer's bounced-check flag will be set.
            </p>
            <div className="space-y-3">
              <div>
                <label className={lCls}>Notes (optional)</label>
                <input className={inputCls + ' w-full'} placeholder="Reason for bounce…" value={bounceNotes} onChange={e => setBounceNotes(e.target.value)} />
              </div>
              {bounceErr && <p className="text-xs text-red-400">{bounceErr}</p>}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleBounce} disabled={bouncing}
                className="flex-1 py-1.5 text-xs rounded text-white bg-red-600 hover:bg-red-700 disabled:opacity-40">
                {bouncing ? 'Processing…' : 'Confirm Bounce'}
              </button>
              <button onClick={closeBounce} className="px-4 py-1.5 text-xs border t-border rounded t-text-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
