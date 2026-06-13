import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import { salesApi, settingsApi, authApi, type CreditMemoListOut, type CreditMemoOut, type UserEntry } from '../../services/api'
import * as XLSX from 'xlsx'

const ALLOWED_ROLES = ['ADMIN', 'STORE_MANAGER']

const STATUS_OPTIONS = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED']

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayPlusDays(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC',
  })
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDatetime(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

function isExpiredDisplay(memo: CreditMemoListOut): boolean {
  if (memo.status !== 'ACTIVE') return false
  const today = todayLocal()
  return memo.valid_until < today
}

function displayStatus(memo: CreditMemoListOut): string {
  if (isExpiredDisplay(memo)) return 'EXPIRED'
  return memo.status
}

function statusBadgeCls(status: string): string {
  switch (status) {
    case 'ACTIVE':    return 'bg-green-500/15 text-green-400 border border-green-500/30'
    case 'REDEEMED':  return 'bg-[var(--surface-raised)] t-text-3 border t-border'
    case 'EXPIRED':   return 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
    case 'CANCELLED': return 'bg-red-500/15 text-red-400 border border-red-500/30'
    default:          return 'bg-[var(--surface-raised)] t-text-3 border t-border'
  }
}

function isExpiringSoon(memo: CreditMemoListOut): boolean {
  if (displayStatus(memo) !== 'ACTIVE') return false
  const today = new Date(todayLocal())
  const until = new Date(memo.valid_until)
  const diffMs = until.getTime() - today.getTime()
  return diffMs >= 0 && diffMs <= 7 * 24 * 60 * 60 * 1000
}

export default function CreditMemo() {
  const { user } = useAuth()
  if (!user || !user.roles.some(r => ALLOWED_ROLES.includes(r))) {
    return <Navigate to="/customers" replace />
  }

  const qc = useQueryClient()
  const today = todayLocal()

  // ── filters ────────────────────────────────────────────────────────────────
  const [keyword, setKeyword]               = useState('')
  const [statusFilter, setStatusFilter]     = useState<string[]>(['ACTIVE'])
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [issuedByFilter, setIssuedByFilter] = useState('')

  // ── modal states ───────────────────────────────────────────────────────────
  const [isIssueOpen, setIsIssueOpen] = useState(false)
  const [issueForm, setIssueForm]     = useState({
    amount: '', valid_until: todayPlusDays(30), return_id: '', notes: '',
  })
  const [issueError, setIssueError]   = useState('')
  const [isIssuing, setIsIssuing]     = useState(false)

  const [selectedMemoId, setSelectedMemoId] = useState<number | null>(null)
  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null)
  const [isCancelling, setIsCancelling]       = useState(false)

  const [printMemo, setPrintMemo] = useState<CreditMemoOut | null>(null)

  // ── data queries ───────────────────────────────────────────────────────────
  const filters = useMemo(() => ({
    keyword:            keyword || undefined,
    status:             statusFilter.length ? statusFilter : undefined,
    date_from:          dateFrom || undefined,
    date_to:            dateTo   || undefined,
    issued_by_user_id:  issuedByFilter ? Number(issuedByFilter) : undefined,
  }), [keyword, statusFilter, dateFrom, dateTo, issuedByFilter])

  const { data: memos = [], isLoading, isFetching } = useQuery({
    queryKey: qk.creditMemos(filters),
    queryFn:  () => salesApi.creditMemos.list(filters),
    ...stale.transactional,
  })

  const { data: detailData } = useQuery({
    queryKey: qk.creditMemo(selectedMemoId ?? 0),
    queryFn:  () => salesApi.creditMemos.get(selectedMemoId!),
    enabled:  selectedMemoId != null,
    ...stale.transactional,
  })

  const { data: storeNameData } = useQuery({
    queryKey: qk.storeName(),
    queryFn:  () => settingsApi.storeName().catch(() => null),
    staleTime: 10 * 60 * 1000,
  })
  const storeName = storeNameData?.value ?? 'Store'

  const { data: activeUsers = [] } = useQuery({
    queryKey: qk.usersActive(),
    queryFn:  () => authApi.users.allActive(),
    ...stale.reference,
  })

  // ── helpers ────────────────────────────────────────────────────────────────
  function toggleStatus(s: string) {
    setStatusFilter(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    )
  }

  async function handleIssue() {
    setIssueError('')
    const amount = parseFloat(issueForm.amount)
    if (!issueForm.amount || isNaN(amount) || amount <= 0) {
      setIssueError('Amount must be greater than zero.')
      return
    }
    if (!issueForm.valid_until || issueForm.valid_until <= today) {
      setIssueError('Valid Until must be a future date.')
      return
    }
    setIsIssuing(true)
    try {
      await salesApi.creditMemos.issue({
        amount,
        valid_until: issueForm.valid_until,
        return_id:   issueForm.return_id ? parseInt(issueForm.return_id) : undefined,
        notes:       issueForm.notes || undefined,
      })
      qc.invalidateQueries({ queryKey: qk.creditMemos({}) })
      setIsIssueOpen(false)
      setIssueForm({ amount: '', valid_until: todayPlusDays(30), return_id: '', notes: '' })
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? 'Failed to issue credit memo.'
      setIssueError(String(msg))
    } finally {
      setIsIssuing(false)
    }
  }

  async function handleCancel() {
    if (!cancelConfirmId) return
    setIsCancelling(true)
    try {
      await salesApi.creditMemos.cancel(cancelConfirmId)
      qc.invalidateQueries({ queryKey: qk.creditMemos({}) })
      if (selectedMemoId === cancelConfirmId) {
        qc.invalidateQueries({ queryKey: qk.creditMemo(cancelConfirmId) })
      }
      setCancelConfirmId(null)
    } catch {
      // keep modal open; error visible in console
    } finally {
      setIsCancelling(false)
    }
  }

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet(memos.map(m => ({
      'Memo Code':          m.code,
      'Issued Date':        fmtDate(m.issued_at),
      'Valid Until':        fmtDate(m.valid_until),
      'Amount':             Number(m.amount),
      'Status':             displayStatus(m),
      'Issued By':          m.issued_by_name ?? '',
      'Return Ref':         m.return_pid ?? '',
      'Redeemed In Sale':   m.redeemed_sale_id ?? '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Credit Memos')
    XLSX.writeFile(wb, `credit_memos_${today}.xlsx`)
  }

  // ── CSS class helpers ──────────────────────────────────────────────────────
  const inputCls    = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
  const labelCls    = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'
  const thCls       = 'text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'
  const tdCls       = 'px-3 py-2 text-xs t-text-1 whitespace-nowrap'
  const btnPrimary  = 'px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50'
  const btnGhost    = 'px-3 py-1.5 text-xs rounded border t-border t-text-2 hover:t-border-strong transition-colors'
  const btnDanger   = 'px-3 py-1.5 text-xs rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50'

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden t-bg-base">
      <FetchingBar show={isFetching && !isLoading} />

      {/* Print styles */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #cm-print-receipt { display: block !important; }
        }
        #cm-print-receipt { display: none; }
      `}</style>

      {/* Print receipt — hidden on screen, visible when printing */}
      {printMemo && (
        <div id="cm-print-receipt" style={{ fontFamily: 'monospace', fontSize: '13px', padding: '24px', maxWidth: '320px', margin: '0 auto', lineHeight: 1.6 }}>
          <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
            CREDIT MEMO
          </div>
          <div style={{ textAlign: 'center', fontSize: '11px', marginBottom: '16px', borderBottom: '1px solid #000', paddingBottom: '8px' }}>
            {storeName}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
            <tbody>
              <tr>
                <td style={{ paddingBottom: '4px', width: '50%' }}>Code:</td>
                <td style={{ paddingBottom: '4px', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '15px' }}>{printMemo.code}</td>
              </tr>
              <tr>
                <td style={{ paddingBottom: '4px' }}>Amount:</td>
                <td style={{ paddingBottom: '4px', fontWeight: 'bold' }}>₱{fmtCurrency(printMemo.amount)}</td>
              </tr>
              <tr>
                <td style={{ paddingBottom: '4px' }}>Valid Until:</td>
                <td style={{ paddingBottom: '4px' }}>{fmtDate(printMemo.valid_until)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ border: '2px solid #000', padding: '12px', textAlign: 'center', marginBottom: '16px', borderRadius: '4px' }}>
            <div style={{ fontSize: '11px', marginBottom: '6px', color: '#555' }}>Redemption Code</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '24px', letterSpacing: '3px' }}>
              {printMemo.code}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#555', borderTop: '1px solid #000', paddingTop: '8px' }}>
            <div>Issued by: {storeName}</div>
            <div>Date: {fmtDate(printMemo.issued_at)}</div>
          </div>
        </div>
      )}

      {/* ── Filter sidebar ── */}
      <aside className="w-52 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-y-auto p-3 gap-4">
        <div>
          <label className={labelCls}>Keyword</label>
          <input className={inputCls} placeholder="Code or notes…"
            value={keyword} onChange={e => setKeyword(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Status</label>
          <div className="flex flex-col gap-1">
            {STATUS_OPTIONS.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={statusFilter.includes(s)}
                  onChange={() => toggleStatus(s)}
                  className="accent-[var(--accent)]" />
                <span className="text-xs t-text-2">{s}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Issued From</label>
          <input type="date" className={inputCls}
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Issued To</label>
          <input type="date" className={inputCls}
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Issued By</label>
          <select className={inputCls} value={issuedByFilter}
            onChange={e => setIssuedByFilter(e.target.value)}>
            <option value="">All users</option>
            {(activeUsers as UserEntry[]).map(u => (
              <option key={u.user_id} value={u.user_id}>
                {u.employee
                  ? `${u.employee.first_name} ${u.employee.last_name}`
                  : u.username}
              </option>
            ))}
          </select>
        </div>

        <button className={btnGhost} onClick={() => {
          setKeyword(''); setStatusFilter(['ACTIVE']); setDateFrom(''); setDateTo(''); setIssuedByFilter('')
        }}>Clear filters</button>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
          <span className="text-xs t-text-3">{memos.length} memo{memos.length !== 1 ? 's' : ''}</span>
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} onClick={handleExport}>Export XLSX</button>
            <button className={btnPrimary} onClick={() => setIsIssueOpen(true)}>
              Issue Credit Memo
            </button>
          </div>
        </div>

        {/* table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <SkeletonTable rows={8} cols={7} />
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 t-bg-surface z-10">
                <tr className="border-b t-border">
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Issued</th>
                  <th className={thCls}>Valid Until</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">Amount</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Issued By</th>
                  <th className={thCls}>Return Ref</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody>
                {memos.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-xs t-text-3">No credit memos found.</td>
                  </tr>
                )}
                {memos.map(m => {
                  const ds = displayStatus(m)
                  const expiring = isExpiringSoon(m)
                  return (
                    <tr key={m.memo_id}
                      className="border-b t-border hover:t-bg-hover cursor-pointer transition-colors"
                      onClick={() => setSelectedMemoId(m.memo_id)}>
                      <td className={tdCls}>
                        <span className="font-mono font-bold t-text-1">{m.code}</span>
                      </td>
                      <td className={tdCls}>{fmtDate(m.issued_at)}</td>
                      <td className={tdCls}>
                        <span className={expiring ? 'text-amber-400 font-medium' : ''}>
                          {fmtDate(m.valid_until)}
                          {expiring && <span className="ml-1 text-[10px]">⚠</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs t-text-1 text-right font-mono tabular-nums">
                        ₱{fmtCurrency(m.amount)}
                      </td>
                      <td className={tdCls}>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${statusBadgeCls(ds)}`}>
                          {ds}
                        </span>
                      </td>
                      <td className={tdCls}>{m.issued_by_name ?? '—'}</td>
                      <td className={tdCls}>{m.return_pid ?? '—'}</td>
                      <td className={tdCls} onClick={e => e.stopPropagation()}>
                        {m.status === 'ACTIVE' && (
                          <button className={btnDanger}
                            onClick={() => setCancelConfirmId(m.memo_id)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ═══ Issue Modal ═══ */}
      {isIssueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="t-bg-surface rounded-lg shadow-xl border t-border w-full max-w-sm mx-4 p-5 flex flex-col gap-4">
            <h2 className="text-sm font-semibold t-text-1">Issue Credit Memo</h2>

            <div>
              <label className={labelCls}>Amount <span className="text-red-400">*</span></label>
              <input className={inputCls} type="number" min="0.01" step="0.01" placeholder="0.00"
                value={issueForm.amount}
                onChange={e => setIssueForm(f => ({ ...f, amount: e.target.value }))} />
            </div>

            <div>
              <label className={labelCls}>Valid Until <span className="text-red-400">*</span></label>
              <input className={inputCls} type="date" min={today}
                value={issueForm.valid_until}
                onChange={e => setIssueForm(f => ({ ...f, valid_until: e.target.value }))} />
            </div>

            <div>
              <label className={labelCls}>Linked Return ID <span className="t-text-3">(optional)</span></label>
              <input className={inputCls} placeholder="Return ID…"
                value={issueForm.return_id}
                onChange={e => setIssueForm(f => ({ ...f, return_id: e.target.value }))} />
            </div>

            <div>
              <label className={labelCls}>Notes <span className="t-text-3">(optional)</span></label>
              <textarea className={inputCls + ' resize-none'} rows={2}
                value={issueForm.notes}
                onChange={e => setIssueForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {issueError && <p className="text-xs text-red-400">{issueError}</p>}

            <div className="flex gap-2 justify-end">
              <button className={btnGhost} onClick={() => { setIsIssueOpen(false); setIssueError('') }}>
                Cancel
              </button>
              <button className={btnPrimary} disabled={isIssuing} onClick={handleIssue}>
                {isIssuing ? 'Issuing…' : 'Issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Detail Modal ═══ */}
      {selectedMemoId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setSelectedMemoId(null)}>
          <div className="t-bg-surface rounded-lg shadow-xl border t-border w-full max-w-md mx-4 p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}>
            {!detailData ? (
              <div className="py-8 text-center text-xs t-text-3">Loading…</div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-sm font-semibold t-text-1 font-mono">{detailData.code}</h2>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${statusBadgeCls(displayStatus(detailData))}`}>
                    {displayStatus(detailData)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <span className="t-text-3">Amount</span>
                  <span className="t-text-1 font-mono font-semibold">₱{fmtCurrency(detailData.amount)}</span>

                  <span className="t-text-3">Issued</span>
                  <span className="t-text-1">{fmtDate(detailData.issued_at)}</span>

                  <span className="t-text-3">Valid Until</span>
                  <span className={`t-text-1 ${isExpiringSoon(detailData) ? 'text-amber-400' : ''}`}>
                    {fmtDate(detailData.valid_until)}
                  </span>

                  <span className="t-text-3">Issued By</span>
                  <span className="t-text-1">{detailData.issued_by_name ?? '—'}</span>

                  {detailData.return_id && (
                    <>
                      <span className="t-text-3">Return Ref</span>
                      <span className="t-text-1">{detailData.return_pid ?? `#${detailData.return_id}`}</span>
                    </>
                  )}

                  {detailData.notes && (
                    <>
                      <span className="t-text-3">Notes</span>
                      <span className="t-text-1">{detailData.notes}</span>
                    </>
                  )}

                  {detailData.status === 'CANCELLED' && (
                    <>
                      <span className="t-text-3">Cancelled At</span>
                      <span className="t-text-1">{fmtDatetime(detailData.cancelled_at)}</span>
                    </>
                  )}
                </div>

                {detailData.status === 'REDEEMED' && detailData.redemptions.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest t-text-3 mb-2">Redemption</div>
                    {detailData.redemptions.map(r => (
                      <div key={r.redemption_id} className="text-xs t-text-2 grid grid-cols-2 gap-x-4 gap-y-1">
                        <span className="t-text-3">Sale</span>
                        <span>#{r.sale_id}</span>
                        <span className="t-text-3">Amount</span>
                        <span className="font-mono">₱{fmtCurrency(r.amount_redeemed)}</span>
                        <span className="t-text-3">Redeemed At</span>
                        <span>{fmtDatetime(r.redeemed_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 justify-end mt-2">
                  {(detailData.status === 'ACTIVE' || detailData.status === 'REDEEMED') && (
                    <button className={btnGhost} onClick={() => { setPrintMemo(detailData); setTimeout(() => window.print(), 150) }}>
                      Print
                    </button>
                  )}
                  {detailData.status === 'ACTIVE' && (
                    <button className={btnDanger} onClick={() => setCancelConfirmId(detailData.memo_id)}>
                      Cancel Memo
                    </button>
                  )}
                  <button className={btnGhost} onClick={() => setSelectedMemoId(null)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ Cancel Confirm Modal ═══ */}
      {cancelConfirmId != null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div className="t-bg-surface rounded-lg shadow-xl border t-border w-full max-w-xs mx-4 p-5 flex flex-col gap-4">
            <h2 className="text-sm font-semibold t-text-1">Cancel Credit Memo?</h2>
            <p className="text-xs t-text-2">This cannot be undone. The memo will be permanently cancelled and cannot be redeemed.</p>
            <div className="flex gap-2 justify-end">
              <button className={btnGhost} disabled={isCancelling}
                onClick={() => setCancelConfirmId(null)}>
                Keep Memo
              </button>
              <button className={btnDanger} disabled={isCancelling} onClick={handleCancel}>
                {isCancelling ? 'Cancelling…' : 'Cancel Memo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
