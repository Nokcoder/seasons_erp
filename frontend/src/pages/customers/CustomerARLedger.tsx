import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import {
  salesApi,
  type CustomerARLedgerRowOut,
  type CustomerOut,
  type PaymentMode,
  type ARLedgerPaymentRowOut,
} from '../../services/api'
import * as XLSX from 'xlsx'
import { jsonToFormattedSheet, MONEY_FORMAT } from '../../lib/xlsxMoney'

function uid() { return Math.random().toString(36).slice(2, 10) }

const PAGE_SIZE = 200
const STATUSES = ['Open', 'Partial', 'Overdue', 'Paid'] as const

const STATUS_BADGE: Record<string, string> = {
  Open:    'bg-blue-950 text-blue-400',
  Partial: 'bg-amber-950 text-amber-400',
  Paid:    'bg-emerald-950 text-emerald-400',
  Overdue: 'bg-red-950 text-red-400',
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: '2-digit',
  })
}

function phToday(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// ── Detail rows — rendered below master row when expanded ─────────────────────
function DetailRows({ saleId }: { saleId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: qk.arLedgerPayments(saleId),
    queryFn:  () => salesApi.customerArLedger.payments(saleId),
    ...stale.transactional,
  })

  if (isLoading) {
    return (
      <tr className="border-b t-border t-bg-surface">
        <td colSpan={9} className="px-6 py-3 text-xs t-text-4">Loading…</td>
      </tr>
    )
  }
  if (!data?.length) {
    return (
      <tr className="border-b t-border t-bg-surface">
        <td colSpan={9} className="px-6 py-2 text-xs t-text-4 italic">
          No payments recorded for this invoice.
        </td>
      </tr>
    )
  }
  return (
    <>
      {data.map((p: ARLedgerPaymentRowOut) => (
        <tr key={p.payment_id} className="border-b t-border t-bg-surface">
          <td />
          <td className="px-3 py-1.5 text-xs t-text-3">{fmtDate(p.payment_date)}</td>
          <td className="px-3 py-1.5 text-xs t-text-3">{p.payment_mode}</td>
          <td className="px-3 py-1.5 text-xs t-text-4">{p.reference_number ?? ''}</td>
          <td className="px-3 py-1.5 text-xs t-text-4">{p.collection_receipt_no ? `Rcpt: ${p.collection_receipt_no}` : ''}</td>
          <td />
          <td className="px-3 py-1.5 tabular-nums text-right text-xs t-text-4 italic">
            −₱{fmt(Number(p.amount_applied))}
          </td>
          <td /><td />
        </tr>
      ))}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CustomerARLedger() {
  const { user } = useAuth()
  const canExport = user?.action_keys?.includes('export_ar_ledger') ?? false
  const navigate = useNavigate()
  const qc       = useQueryClient()

  // ── filter state ─────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState('')
  const [customerId,   setCustomerId]   = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(['Open', 'Partial', 'Overdue'])
  )
  const [pageOffsets,  setPageOffsets]  = useState<number[]>([0])

  // ── expand state ─────────────────────────────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  // ── receive payment modal state ───────────────────────────────────────────
  const [recvSale,      setRecvSale]      = useState<CustomerARLedgerRowOut | null>(null)
  const [payDate,       setPayDate]       = useState('')
  const [payModeId,     setPayModeId]     = useState('')
  const [payAmount,     setPayAmount]     = useState('')
  const [payRef,        setPayRef]        = useState('')
  const [payReceiptNo,  setPayReceiptNo]  = useState('')
  const [payNotes,      setPayNotes]      = useState('')
  const [payCheckNum,   setPayCheckNum]   = useState('')
  const [payCheckDate,  setPayCheckDate]  = useState('')
  const [payBank,       setPayBank]       = useState('')
  const [payKey,        setPayKey]        = useState<string>(() => uid())
  const [paySubmitting, setPaySubmitting] = useState(false)
  const [payError,      setPayError]      = useState('')

  // ── API params — change resets page cursor ────────────────────────────────
  const apiParams = useMemo(() => ({
    customer_id: customerId ? Number(customerId) : undefined,
    date_from:   dateFrom   || undefined,
    date_to:     dateTo     || undefined,
    status:      statusFilter.size > 0 ? [...statusFilter] : undefined,
    search:      search.trim() || undefined,
  }), [customerId, dateFrom, dateTo, statusFilter, search])

  const prevParams = useRef(apiParams)
  useEffect(() => {
    if (prevParams.current !== apiParams) {
      prevParams.current = apiParams
      setPageOffsets([0])
    }
  }, [apiParams])

  // ── queries ───────────────────────────────────────────────────────────────
  const queries = useQueries({
    queries: [
      {
        queryKey: qk.customers(),
        queryFn:  () => salesApi.customers.list(),
        ...stale.reference,
      },
      {
        queryKey: qk.paymentModes(),
        queryFn:  () => salesApi.paymentModes.list(),
        ...stale.reference,
      },
      ...pageOffsets.map(cursor => ({
        queryKey: qk.customerArLedgerView({ ...apiParams, cursor }),
        queryFn:  () => salesApi.customerArLedger.list({ ...apiParams, limit: PAGE_SIZE, cursor }),
        ...stale.transactional,
      })),
    ],
  })

  const [qCustomers, qPayModes, ...qPages] = queries
  const customers   = (qCustomers.data ?? []) as CustomerOut[]
  const allPayModes = (qPayModes.data   ?? []) as PaymentMode[]
  const rows        = qPages.flatMap(q => (q.data ?? []) as CustomerARLedgerRowOut[])
  const isLoading   = (qPages[0]?.isLoading) ?? false
  const fetching    = queries.some(q => q.isFetching && !q.isLoading)
  const lastPage    = qPages[qPages.length - 1]?.data as CustomerARLedgerRowOut[] | undefined
  const hasMore     = lastPage !== undefined && lastPage.length === PAGE_SIZE

  const arPayModes   = allPayModes.filter(m => m.is_active && !m.is_ar_charge && !m.is_ar_credit)
  const selectedMode = arPayModes.find(m => String(m.payment_mode_id) === payModeId)

  // ── grouped rows: isFirst/isLast flags + per-customer balance subtotal ────
  const tableRows = useMemo(() => {
    const subs = new Map<number, number>()
    for (const r of rows) {
      subs.set(r.customer_id, (subs.get(r.customer_id) ?? 0) + Number(r.balance_due))
    }
    return rows.map((row, i) => ({
      ...row,
      isFirst:  i === 0 || rows[i - 1].customer_id !== row.customer_id,
      isLast:   i === rows.length - 1 || rows[i + 1].customer_id !== row.customer_id,
      subtotal: subs.get(row.customer_id) ?? 0,
    }))
  }, [rows])

  const totalAmount     = rows.reduce((s, r) => s + Number(r.grand_total), 0)
  const totalBalanceDue = rows.reduce((s, r) => s + Number(r.balance_due), 0)

  // ── handlers ──────────────────────────────────────────────────────────────
  function toggleRow(saleId: number) {
    setExpandedRows(prev => {
      const n = new Set(prev)
      n.has(saleId) ? n.delete(saleId) : n.add(saleId)
      return n
    })
  }

  function toggleStatus(s: string) {
    setStatusFilter(prev => {
      const n = new Set(prev)
      n.has(s) ? n.delete(s) : n.add(s)
      return n
    })
  }

  function clearFilters() {
    setSearch('')
    setCustomerId('')
    setDateFrom('')
    setDateTo('')
    setStatusFilter(new Set(['Open', 'Partial', 'Overdue']))
  }

  function openReceivePayment(row: CustomerARLedgerRowOut) {
    setRecvSale(row)
    setPayDate(phToday())
    setPayModeId('')
    setPayAmount(String(Number(row.balance_due)))
    setPayRef('')
    setPayReceiptNo('')
    setPayNotes('')
    setPayCheckNum('')
    setPayCheckDate('')
    setPayBank('')
    setPayError('')
  }

  function closeReceivePayment() {
    setRecvSale(null)
    setPaySubmitting(false)
    setPayCheckNum('')
    setPayCheckDate('')
    setPayBank('')
    setPayError('')
  }

  async function handlePaySubmit() {
    if (!recvSale) return
    if (!payModeId) { setPayError('Select a payment mode.'); return }
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) { setPayError('Enter a valid amount.'); return }
    if (amount > Number(recvSale.balance_due)) {
      setPayError('Amount cannot exceed balance due.'); return
    }
    if (selectedMode?.is_pdc) {
      if (!payCheckNum.trim() || !payCheckDate.trim() || !payBank.trim()) {
        setPayError('PDC payment requires check number, check date, and bank name.'); return
      }
    }
    setPaySubmitting(true)
    setPayError('')
    try {
      await salesApi.customers.recordPayment(recvSale.customer_id, {
        payment_mode_id:  parseInt(payModeId),
        amount,
        payment_date:     payDate || undefined,
        reference_number: payRef.trim()   || undefined,
        collection_receipt_no: payReceiptNo.trim() || undefined,
        notes:            payNotes.trim() || undefined,
        sale_id:          recvSale.sale_id,
        idempotency_key:  payKey,
        ...(selectedMode?.is_pdc ? {
          check_number: payCheckNum.trim() || undefined,
          check_date:   payCheckDate       || undefined,
          bank_name:    payBank.trim()     || undefined,
        } : {}),
      })
      await qc.invalidateQueries({ queryKey: ['customers', 'ar-ledger-view'] })
      await qc.invalidateQueries({ queryKey: qk.arLedgerPayments(recvSale.sale_id) })
      setPayKey(uid())
      closeReceivePayment()
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Payment failed.')
    } finally {
      setPaySubmitting(false)
    }
  }

  function handleExport() {
    const today = new Date().toISOString().slice(0, 10)
    const dataRows = tableRows.map(r => ({
      'Customer Name': r.isFirst ? r.customer_name : '',
      'Invoice #':     r.sale_pid,
      'Issue Date':    fmtDate(r.transaction_date),
      'Due Date':      fmtDate(r.due_date),
      'Status':        r.status,
      'Balance Due':   Number(r.balance_due),
      // Total Amount is a per-customer-group subtotal, shown once on the
      // group's last row only — genuinely not applicable to earlier rows.
      'Total Amount':  r.isLast ? Number(r.subtotal) : undefined,
    }))
    const totalsRow = {
      'Customer Name': 'Total',
      'Invoice #':     '',
      'Issue Date':    '',
      'Due Date':      '',
      'Status':        '',
      'Balance Due':   totalBalanceDue,
      'Total Amount':  totalAmount,
    }
    const ws = jsonToFormattedSheet([...dataRows, totalsRow], {
      'Balance Due': MONEY_FORMAT, 'Total Amount': MONEY_FORMAT,
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AR Ledger')
    XLSX.writeFile(wb, `ar_ledger_${today}.xlsx`)
  }

  const iCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-0.5'

  return (
    <div className="flex flex-col h-full overflow-hidden t-bg-base">
      <FetchingBar show={fetching} />

      {/* ── filter bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b t-border t-bg-surface px-4 py-2.5 flex flex-wrap items-end gap-3">
        <div>
          <label className={lCls}>Search</label>
          <input
            className={iCls + ' w-44'}
            placeholder="Customer name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div>
          <label className={lCls}>Customer</label>
          <select
            className={iCls + ' w-40'}
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
          >
            <option value="">All customers</option>
            {customers.filter((c: CustomerOut) => !c.is_deleted).map((c: CustomerOut) => (
              <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={lCls}>Issue Date From</label>
          <input
            type="date"
            className={iCls}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className={lCls}>To</label>
          <input
            type="date"
            className={iCls}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>

        <div>
          <label className={lCls}>Status</label>
          <div className="flex gap-1">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`text-[10px] font-medium px-2 py-1 rounded border transition-colors ${
                  statusFilter.has(s)
                    ? (STATUS_BADGE[s] ?? '') + ' border-transparent'
                    : 't-text-4 t-border t-bg-base hover:t-text-2'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={clearFilters}
          className="self-end text-[10px] t-text-4 hover:t-text-2 pb-0.5">
          Clear
        </button>

        <div className="ml-auto flex items-end gap-3">
          <span className="text-xs t-text-4 self-end pb-1">
            {rows.length} row{rows.length !== 1 ? 's' : ''}
          </span>
          {canExport && (
            <button
              onClick={handleExport}
              className="self-end px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
              Export XLSX
            </button>
          )}
        </div>
      </div>

      {/* ── table ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="t-bg-elevated border-b t-border-strong">
              <th className="w-8" />
              {([
                ['Customer Name', 'text-left'],
                ['Invoice #',     'text-left'],
                ['Issue Date',    'text-left'],
                ['Due Date',      'text-left'],
                ['Status',        'text-left'],
                ['Balance Due',   'text-right'],
                ['Total Amount',  'text-right'],
                ['Actions',       'text-left'],
              ] as [string, string][]).map(([h, align]) => (
                <th
                  key={h}
                  className={`${align} px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading && <SkeletonTable rows={10} cols={9} />}
            {!isLoading && tableRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center t-text-4">No invoices.</td>
              </tr>
            )}

            {tableRows.map(row => {
              const isExpanded = expandedRows.has(row.sale_id)
              return (
                <Fragment key={row.sale_id}>
                  <tr className="border-b t-border hover:t-bg-surface transition-colors">
                    {/* expand toggle */}
                    <td className="w-8 text-center">
                      <button
                        onClick={() => toggleRow(row.sale_id)}
                        className="px-2 py-1 t-text-4 hover:t-text-2 transition-colors text-[10px]">
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    </td>

                    {/* customer name — first row of group only, clickable */}
                    <td className="px-3 py-2 t-text-2 max-w-[14rem]">
                      {row.isFirst ? (
                        <button
                          onClick={() => navigate(`/customers/${row.customer_id}`)}
                          className="hover:underline text-left truncate block max-w-full font-medium">
                          {row.customer_name}
                        </button>
                      ) : null}
                    </td>

                    {/* invoice # — clickable to sale detail */}
                    <td className="px-3 py-2 font-mono text-[10px]">
                      <button
                        onClick={() => navigate(`/sales/ledger/${row.sale_id}`)}
                        className="text-blue-400 hover:underline">
                        {row.sale_pid}
                      </button>
                    </td>

                    {/* issue date */}
                    <td className="px-3 py-2 t-text-3 whitespace-nowrap">
                      {fmtDate(row.transaction_date)}
                    </td>

                    {/* due date — red when overdue */}
                    <td className={`px-3 py-2 whitespace-nowrap ${
                      row.status === 'Overdue' ? 'text-red-400' : 't-text-3'
                    }`}>
                      {fmtDate(row.due_date)}
                    </td>

                    {/* status badge */}
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                        STATUS_BADGE[row.status] ?? 't-bg-elevated t-text-3'
                      }`}>
                        {row.status}
                      </span>
                    </td>

                    {/* balance due — blank when 0 */}
                    <td className={`px-3 py-2 tabular-nums text-right font-medium ${
                      row.status === 'Overdue' ? 'text-red-400' : 't-text-2'
                    }`}>
                      {Number(row.balance_due) > 0 ? `₱${fmt(Number(row.balance_due))}` : null}
                    </td>

                    {/* total amount (per-customer balance_due subtotal) — last row of customer group only */}
                    <td className="px-3 py-2 tabular-nums text-right font-semibold t-text-1">
                      {row.isLast && row.subtotal > 0 ? `₱${fmt(row.subtotal)}` : null}
                    </td>

                    {/* actions */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {Number(row.balance_due) > 0 && (
                          <button
                            onClick={() => openReceivePayment(row)}
                            className="px-2 py-1 text-[10px] font-medium rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity whitespace-nowrap">
                            Receive Payment
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/sales/ledger/${row.sale_id}`)}
                          className="px-2 py-1 text-[10px] border t-border rounded t-text-3 hover:t-text-1 hover:t-border-strong transition-colors whitespace-nowrap">
                          View Invoice
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExpanded && <DetailRows saleId={row.sale_id} />}
                </Fragment>
              )
            })}
          </tbody>

          {tableRows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="t-bg-elevated border-t-2 t-border-strong">
                <td />
                <td className="px-3 py-2 text-xs font-bold t-text-1">Total</td>
                <td colSpan={4} />
                <td className="px-3 py-2 tabular-nums text-right text-xs font-bold t-text-1">
                  ₱{fmt(totalBalanceDue)}
                </td>
                <td className="px-3 py-2 tabular-nums text-right text-xs font-bold t-text-1">
                  ₱{fmt(totalAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── load more ──────────────────────────────────────────────── */}
      {hasMore && (
        <div className="shrink-0 border-t t-border px-4 py-2.5 flex justify-center">
          <button
            onClick={() => setPageOffsets(prev => [...prev, rows.length])}
            disabled={fetching}
            className="px-4 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong disabled:opacity-50 transition-colors">
            {fetching ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}

      {/* ── receive payment modal ──────────────────────────────────── */}
      {recvSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeReceivePayment} />
          <div className="relative z-10 t-bg-surface border t-border rounded-lg shadow-2xl w-full max-w-md p-6">
            <h2 className="text-sm font-semibold t-text-1 mb-4">Receive Payment</h2>

            <div className="space-y-3">
              {/* customer — read-only */}
              <div>
                <span className={lCls}>Customer</span>
                <p className="text-xs t-text-2 mt-0.5">{recvSale.customer_name}</p>
              </div>

              {/* invoice # — read-only */}
              <div>
                <span className={lCls}>Invoice #</span>
                <p className="text-xs font-mono t-text-2 mt-0.5">{recvSale.sale_pid}</p>
              </div>

              {/* payment date */}
              <div>
                <label className={lCls}>Payment Date</label>
                <input
                  type="date"
                  className={iCls + ' w-full'}
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                />
              </div>

              {/* payment mode — excludes AR Charge / AR Credit */}
              <div>
                <label className={lCls}>Payment Mode</label>
                <select
                  className={iCls + ' w-full'}
                  value={payModeId}
                  onChange={e => setPayModeId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {arPayModes.map((m: PaymentMode) => (
                    <option key={m.payment_mode_id} value={m.payment_mode_id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* amount — defaults to balance_due, capped at balance_due */}
              <div>
                <label className={lCls}>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Number(recvSale.balance_due)}
                  className={iCls + ' w-full'}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                />
              </div>

              {/* reference number — non-physical, non-PDC modes only */}
              {selectedMode && !selectedMode.is_physical && !selectedMode.is_pdc && (
                <div>
                  <label className={lCls}>Reference Number</label>
                  <input
                    className={iCls + ' w-full'}
                    placeholder="e.g. transfer ref…"
                    value={payRef}
                    onChange={e => setPayRef(e.target.value)}
                  />
                </div>
              )}

              {/* collection receipt no. — always visible, optional, unlike Reference Number */}
              <div>
                <label className={lCls}>Collection Receipt No.</label>
                <input
                  className={iCls + ' w-full'}
                  placeholder="Optional"
                  value={payReceiptNo}
                  onChange={e => setPayReceiptNo(e.target.value)}
                />
              </div>

              {/* PDC fields */}
              {selectedMode?.is_pdc && (
                <>
                  <div>
                    <label className={lCls}>Check Number <span className="text-red-400">*</span></label>
                    <input className={iCls + ' w-full'} placeholder="Check #" value={payCheckNum} onChange={e => setPayCheckNum(e.target.value)} />
                  </div>
                  <div>
                    <label className={lCls}>Check Date <span className="text-red-400">*</span></label>
                    <input type="date" className={iCls + ' w-full'} value={payCheckDate} onChange={e => setPayCheckDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={lCls}>Bank Name <span className="text-red-400">*</span></label>
                    <input className={iCls + ' w-full'} placeholder="Bank" value={payBank} onChange={e => setPayBank(e.target.value)} />
                  </div>
                </>
              )}

              {/* notes */}
              <div>
                <label className={lCls}>Notes</label>
                <input
                  className={iCls + ' w-full'}
                  placeholder="Optional"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                />
              </div>

              {/* inline error */}
              {payError && (
                <p className="text-[11px] text-red-400">{payError}</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeReceivePayment}
                disabled={paySubmitting}
                className="px-3 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong disabled:opacity-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={handlePaySubmit}
                disabled={paySubmitting}
                className="px-4 py-1.5 text-xs font-medium rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                {paySubmitting ? 'Saving…' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
