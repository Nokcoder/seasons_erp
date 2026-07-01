import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient, useQueries } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import { salesApi, type ArLedgerOut, type SaleOut, type CustomerPaymentOut, type PaymentMode, type SalesReturnOut } from '../../services/api'

const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
}
// For plain calendar-date strings ("YYYY-MM-DD", e.g. transaction_date) — formats
// the date components directly so the displayed day never shifts with the
// viewer's local timezone (new Date(dateOnlyString) parses as UTC midnight,
// which `toLocaleString` would otherwise convert to local time and possibly
// roll back a day).
function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'short', timeZone: 'UTC' })
}
function termsLabel(days: number) {
  if (days === 0) return 'COD'
  return `Net ${days}`
}

// Page sizes for "Load More" pagination (ui_standards §5 — never unbounded)
const AR_LEDGER_PAGE = 20
const SALES_PAGE     = 10
const PAYMENTS_PAGE  = 10
const RETURNS_PAGE   = 10

export default function CustomerDetail() {
  const { user } = useAuth()
  const canManage = user?.action_keys?.includes('manage_customers') ?? false
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const cid = parseInt(customerId ?? '0')

  const refQueries = useQueries({
    queries: [
      { queryKey: qk.customer(cid),         queryFn: () => salesApi.customers.get(cid),                                          ...stale.transactional, enabled: !!cid },
      { queryKey: qk.customerArLedger(cid),  queryFn: () => salesApi.customers.arLedger(cid, { limit: AR_LEDGER_PAGE }),          ...stale.transactional, enabled: !!cid },
      { queryKey: qk.customerSales(cid),     queryFn: () => salesApi.customers.sales(cid, undefined, SALES_PAGE),                ...stale.transactional, enabled: !!cid },
      { queryKey: qk.customerPayments(cid),  queryFn: () => salesApi.customers.payments(cid, undefined, PAYMENTS_PAGE),          ...stale.transactional, enabled: !!cid },
      { queryKey: qk.paymentModes(),         queryFn: () => salesApi.paymentModes.list(),                                        ...stale.reference },
      { queryKey: qk.customerReturns(cid),   queryFn: () => salesApi.returns.list({ customer_id: cid, limit: RETURNS_PAGE }),    ...stale.transactional, enabled: !!cid },
    ],
  })
  const [qCustomer, qArLedger, qSales, qPayments, qModes, qReturns] = refQueries
  const customer    = qCustomer.data
  const paymentModes = (qModes.data ?? []).filter((m: PaymentMode) => m.is_active)
  // Record Payment excludes AR Charge/Credit modes (point-of-sale only)
  const paymentModesForRecording = paymentModes.filter((m: PaymentMode) => !m.is_ar_charge && !m.is_ar_credit)
  const fetching    = refQueries.some(r => r.isFetching && !r.isLoading)

  // ── Load More pagination (ui_standards §5 — never unbounded) ──────────────
  // First page comes from React Query; subsequent pages are appended to local
  // state via cursor-based fetches (cursor = id of the last loaded row).
  const [arLedger,  setArLedger]  = useState<ArLedgerOut[]>([])
  const [arMore,    setArMore]    = useState(false)
  const [arLoading, setArLoading] = useState(false)
  useEffect(() => {
    if (qArLedger.data) { setArLedger(qArLedger.data as ArLedgerOut[]); setArMore((qArLedger.data as ArLedgerOut[]).length === AR_LEDGER_PAGE) }
  }, [qArLedger.data])
  async function loadMoreArLedger() {
    if (!arLedger.length) return
    setArLoading(true)
    try {
      const next = await salesApi.customers.arLedger(cid, { limit: AR_LEDGER_PAGE, cursor: arLedger[arLedger.length - 1].ar_ledger_id })
      setArLedger(p => [...p, ...next]); setArMore(next.length === AR_LEDGER_PAGE)
    } finally { setArLoading(false) }
  }

  const [sales,        setSales]        = useState<SaleOut[]>([])
  const [salesMore,    setSalesMore]    = useState(false)
  const [salesLoading, setSalesLoading] = useState(false)
  useEffect(() => {
    if (qSales.data) { setSales(qSales.data as SaleOut[]); setSalesMore((qSales.data as SaleOut[]).length === SALES_PAGE) }
  }, [qSales.data])
  async function loadMoreSales() {
    if (!sales.length) return
    setSalesLoading(true)
    try {
      const next = await salesApi.customers.sales(cid, sales[sales.length - 1].sale_id, SALES_PAGE)
      setSales(p => [...p, ...next]); setSalesMore(next.length === SALES_PAGE)
    } finally { setSalesLoading(false) }
  }

  const [payments,        setPayments]        = useState<CustomerPaymentOut[]>([])
  const [paymentsMore,    setPaymentsMore]    = useState(false)
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  useEffect(() => {
    if (qPayments.data) { setPayments(qPayments.data as CustomerPaymentOut[]); setPaymentsMore((qPayments.data as CustomerPaymentOut[]).length === PAYMENTS_PAGE) }
  }, [qPayments.data])
  async function loadMorePayments() {
    if (!payments.length) return
    setPaymentsLoading(true)
    try {
      const next = await salesApi.customers.payments(cid, payments[payments.length - 1].payment_id, PAYMENTS_PAGE)
      setPayments(p => [...p, ...next]); setPaymentsMore(next.length === PAYMENTS_PAGE)
    } finally { setPaymentsLoading(false) }
  }

  const [returns_,        setReturns_]        = useState<SalesReturnOut[]>([])
  const [returnsMore,     setReturnsMore]     = useState(false)
  const [returnsLoading,  setReturnsLoading]  = useState(false)
  useEffect(() => {
    if (qReturns.data) { setReturns_(qReturns.data as SalesReturnOut[]); setReturnsMore((qReturns.data as SalesReturnOut[]).length === RETURNS_PAGE) }
  }, [qReturns.data])
  async function loadMoreReturns() {
    if (!returns_.length) return
    setReturnsLoading(true)
    try {
      const next = await salesApi.returns.list({ customer_id: cid, limit: RETURNS_PAGE, cursor: returns_[returns_.length - 1].return_id })
      setReturns_(p => [...p, ...next]); setReturnsMore(next.length === RETURNS_PAGE)
    } finally { setReturnsLoading(false) }
  }

  // ── header edit ───────────────────────────────────────────────────────────
  const [editing,    setEditing]    = useState(false)
  const [editName,   setEditName]   = useState('')
  const [editLimit,  setEditLimit]  = useState('')
  const [editTerms,  setEditTerms]  = useState('0')
  const [saving,     setSaving]     = useState(false)
  const [saveErr,    setSaveErr]    = useState('')

  function startEdit() {
    if (!customer) return
    setEditName(customer.customer_name)
    setEditLimit(customer.credit_limit != null ? String(customer.credit_limit) : '')
    setEditTerms(String(customer.terms_days))
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true); setSaveErr('')
    try {
      await salesApi.customers.patch(cid, {
        customer_name: editName.trim() || undefined,
        credit_limit:  editLimit ? parseFloat(editLimit) : null,
        terms_days:    parseInt(editTerms) || 0,
      })
      await qc.invalidateQueries({ queryKey: qk.customer(cid) })
      await qc.invalidateQueries({ queryKey: qk.customers() })
      setEditing(false)
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  async function handleToggleStatus() {
    if (!customer) return
    if (!window.confirm(`${customer.is_deleted ? 'Reactivate' : 'Deactivate'} this customer?`)) return
    try {
      if (customer.is_deleted) {
        await salesApi.customers.patch(cid, {})  // reactivate not via delete
      } else {
        await salesApi.customers.delete(cid)
      }
      await qc.invalidateQueries({ queryKey: qk.customer(cid) })
      await qc.invalidateQueries({ queryKey: qk.customers() })
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  // ── record payment modal ──────────────────────────────────────────────────
  function todayLocal() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [showPayment,  setShowPayment]  = useState(false)
  const [payDate,      setPayDate]      = useState(todayLocal())
  const [payMode,      setPayMode]      = useState('')
  const [payAmount,    setPayAmount]    = useState('')
  const [payRef,       setPayRef]       = useState('')
  const [payReceiptNo, setPayReceiptNo] = useState('')
  const [payNotes,     setPayNotes]     = useState('')
  const [payCheckNum,  setPayCheckNum]  = useState('')
  const [payCheckDate, setPayCheckDate] = useState('')
  const [payBank,      setPayBank]      = useState('')
  const [paying,       setPaying]       = useState(false)
  const [payErr,       setPayErr]       = useState('')
  const [clearingBounce, setClearingBounce] = useState(false)

  const selectedMode = paymentModes.find((m: PaymentMode) => m.payment_mode_id === parseInt(payMode))
  const showRef = selectedMode && selectedMode.is_physical === false && !selectedMode.is_pdc

  function openPaymentModal() {
    setPayDate(todayLocal()); setPayMode(''); setPayAmount(''); setPayRef(''); setPayReceiptNo(''); setPayNotes('')
    setPayCheckNum(''); setPayCheckDate(''); setPayBank('')
    setPayErr('')
    setShowPayment(true)
  }

  async function handleClearBouncedFlag() {
    if (!window.confirm('Clear the bounced check flag for this customer?')) return
    setClearingBounce(true)
    try {
      await salesApi.customers.clearBouncedFlag(cid)
      await qc.invalidateQueries({ queryKey: qk.customer(cid) })
    } catch { /* ignore */ } finally { setClearingBounce(false) }
  }

  async function handleRecordPayment() {
    if (!payMode) { setPayErr('Select a payment mode.'); return }
    if (!payAmount || parseFloat(payAmount) <= 0) { setPayErr('Enter a valid amount.'); return }
    if (selectedMode?.is_pdc) {
      if (!payCheckNum.trim() || !payCheckDate.trim() || !payBank.trim()) {
        setPayErr('PDC payment requires check number, check date, and bank name.'); return
      }
    }
    setPaying(true); setPayErr('')
    try {
      await salesApi.customers.recordPayment(cid, {
        payment_mode_id: parseInt(payMode),
        amount:          parseFloat(payAmount),
        payment_date:    payDate ? `${payDate}T00:00:00` : undefined,
        reference_number: payRef || undefined,
        collection_receipt_no: payReceiptNo.trim() || undefined,
        notes:           payNotes.trim() || undefined,
        ...(selectedMode?.is_pdc ? {
          check_number: payCheckNum.trim() || undefined,
          check_date:   payCheckDate       || undefined,
          bank_name:    payBank.trim()     || undefined,
        } : {}),
      })
      await qc.invalidateQueries({ queryKey: qk.customer(cid) })
      await qc.invalidateQueries({ queryKey: qk.customerArLedger(cid) })
      await qc.invalidateQueries({ queryKey: qk.customerPayments(cid) })
      await qc.invalidateQueries({ queryKey: qk.customers() })
      setShowPayment(false); setPayMode(''); setPayAmount(''); setPayRef(''); setPayReceiptNo(''); setPayNotes('')
    } catch (e: unknown) {
      setPayErr(e instanceof Error ? e.message : 'Payment failed')
    } finally { setPaying(false) }
  }

  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'
  const vCls = 'text-sm t-text-1'
  const inputCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] w-full'

  if (qCustomer.isLoading) return (
    <div className="p-6 t-bg-base min-h-full">
      <div className="h-4 t-bg-elevated rounded w-48 animate-pulse mb-6" />
      <SkeletonTable rows={4} cols={4} />
    </div>
  )
  if (!customer) return <div className="p-8 t-text-4 text-sm">Customer not found.</div>

  // running balance for AR ledger
  // Ledger is in descending order (most recent first).
  // Start from the current outstanding_balance and subtract each entry's
  // amount_change as we walk backwards, giving the balance AFTER each event.
  let runningBalance = customer.outstanding_balance
  const arWithBalance = arLedger.map(row => {
    const displayBalance = runningBalance      // balance after this transaction
    runningBalance = runningBalance - row.amount_change  // balance before it
    return { ...row, runningBalance: displayBalance }
  })

  return (
    <div className="min-h-full t-bg-base px-6 py-6 max-w-5xl">
      <FetchingBar show={fetching} />

      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-xs t-text-4 mb-5">
        <button onClick={() => navigate('/customers')} className="hover:t-text-2">Customers</button>
        <span>/</span>
        <span className="t-text-2">{customer.customer_name}</span>
      </div>

      {/* header */}
      <div className="t-bg-surface border t-border rounded-lg p-5 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold t-text-1">{customer.customer_name}</h1>
            {customer.has_bounced_check && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">
                Bounced Check
                <button onClick={handleClearBouncedFlag} disabled={clearingBounce}
                  className="ml-1 underline text-[10px] hover:no-underline disabled:opacity-50">
                  {clearingBounce ? '…' : 'Clear'}
                </button>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {!editing && canManage && <button onClick={startEdit} className="px-3 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">Edit</button>}
            <button onClick={() => navigate(`/sales/new?customer_id=${cid}`)}
              className="px-3 py-1 text-xs rounded text-white"
              style={{ backgroundColor: 'var(--accent)' }}>New Sale</button>
            <button onClick={openPaymentModal}
              className="px-3 py-1 text-xs border t-border rounded text-emerald-400 hover:border-emerald-700">Record Payment</button>
            <button onClick={handleToggleStatus}
              className={`px-3 py-1 text-xs border rounded ${customer.is_deleted ? 'border-gray-600 t-text-3' : 'border-red-900 text-red-500 hover:bg-red-950'}`}>
              {customer.is_deleted ? 'Reactivate' : 'Deactivate'}
            </button>
          </div>
        </div>

        {editing ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label className={lCls}>Customer Name *</label>
              <input className={inputCls} value={editName} onChange={e => setEditName(e.target.value)} onFocus={onFocusSelect} />
            </div>
            <div>
              <label className={lCls}>Credit Limit (blank = no limit)</label>
              <input type="number" min="0" step="0.01" className={inputCls}
                value={editLimit} onChange={e => setEditLimit(e.target.value)} onFocus={onFocusSelect} placeholder="—" />
            </div>
            <div>
              <label className={lCls}>Terms Days (0 = COD)</label>
              <input type="number" min="0" step="1" className={inputCls}
                value={editTerms} onChange={e => setEditTerms(e.target.value)} onFocus={onFocusSelect} />
            </div>
            {saveErr && <p className="col-span-full text-xs text-red-400">{saveErr}</p>}
            <div className="col-span-full flex gap-2 mt-1">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-1.5 text-xs rounded text-white disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent)' }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(false)} className="px-4 py-1.5 text-xs border t-border rounded t-text-2">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div><label className={lCls}>Terms</label><p className={vCls}>{termsLabel(customer.terms_days)}</p></div>
            <div><label className={lCls}>Credit Limit</label><p className={vCls}>{customer.credit_limit != null ? `₱${fmt(customer.credit_limit)}` : 'No Limit'}</p></div>
            <div>
              <label className={lCls}>Outstanding Balance</label>
              <p className={`text-sm font-semibold flex items-center gap-1.5 ${
                customer.outstanding_balance > 0 ? 'text-yellow-400' :
                customer.outstanding_balance < 0 ? 'text-emerald-400' : 't-text-1'
              }`}>
                ₱{fmt(customer.outstanding_balance)}
                {customer.is_overdue && (
                  <span className="text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-yellow-950 text-yellow-500">Overdue</span>
                )}
              </p>
            </div>
            {customer.outstanding_balance < 0 && (
              <div>
                <label className={lCls}>Available Credit</label>
                <p className="text-sm font-semibold text-emerald-400">
                  ₱{fmt(Math.abs(customer.outstanding_balance))}
                </p>
              </div>
            )}
            <div>
              <label className={lCls}>Status</label>
              <span className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${!customer.is_deleted ? 'bg-emerald-950 text-emerald-500' : 't-bg-elevated t-text-3'}`}>
                {customer.is_deleted ? 'Inactive' : 'Active'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* AR Ledger */}
      <section className="mb-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">AR Ledger</h2>
        <div className="t-bg-surface border t-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b t-border-strong">
                {['Date', 'Type', 'Reference', 'Amount Change', 'Running Balance'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {qArLedger.isLoading && <SkeletonTable rows={5} cols={5} />}
              {!qArLedger.isLoading && arLedger.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center t-text-4">No AR entries.</td></tr>
              )}
              {arWithBalance.map(row => (
                <tr key={row.ar_ledger_id} className="border-b t-border">
                  <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(row.occurred_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      row.reason === 'SALE'        ? 'bg-blue-950 text-blue-400' :
                      row.reason === 'PAYMENT'     ? 'bg-emerald-950 text-emerald-400' :
                      row.reason === 'RETURN'      ? 'bg-purple-950 text-purple-400' :
                      row.reason === 'AR_CHARGE'   ? 'bg-amber-950 text-amber-400' :
                      row.reason === 'AR_CREDIT'   ? 'bg-cyan-950 text-cyan-400' :
                      't-bg-elevated t-text-3'
                    }`}>{row.reason.replace('_', ' ')}</span>
                  </td>
                  <td className="px-3 py-2 t-text-3 font-mono">
                    {row.reference_type === 'sales' ? (
                      <button onClick={() => navigate(`/sales/ledger/${row.reference_id}`)}
                        className="text-blue-400 hover:underline">{row.reference_type}/{row.reference_id}</button>
                    ) : <span>{row.reference_type}/{row.reference_id}</span>}
                  </td>
                  <td className={`px-3 py-2 tabular-nums font-medium text-right ${row.amount_change > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {row.amount_change > 0 ? `+₱${fmt(row.amount_change)}` : `-₱${fmt(Math.abs(row.amount_change))}`}
                  </td>
                  <td className="px-3 py-2 tabular-nums t-text-2 text-right">₱{fmt(row.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {arMore && (
          <button onClick={loadMoreArLedger} disabled={arLoading}
            className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors font-medium">
            {arLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      {/* Sales History */}
      <section className="mb-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">Sales History</h2>
        <div className="t-bg-surface border t-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b t-border-strong">
                {['Sale PID', 'Date', 'Grand Total', 'Payment', 'Status'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {qSales.isLoading && <SkeletonTable rows={4} cols={5} />}
              {!qSales.isLoading && sales.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center t-text-4">No sales.</td></tr>
              )}
              {sales.map((s: SaleOut) => (
                <tr key={s.sale_id}
                  onClick={() => navigate(`/sales/ledger/${s.sale_id}`)}
                  className="border-b t-border hover:t-bg-elevated cursor-pointer">
                  <td className="px-3 py-2 font-mono t-text-1">{s.sale_pid ?? '—'}</td>
                  <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDateOnly(s.transaction_date)}</td>
                  <td className="px-3 py-2 tabular-nums t-text-1 font-medium">₱{fmt(s.grand_total)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      s.payment_status === 'Paid' ? 'bg-emerald-950 text-emerald-500' :
                      s.payment_status === 'Partial' ? 'bg-yellow-950 text-yellow-500' :
                      'bg-red-950 text-red-500'
                    }`}>{s.payment_status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      s.status === 'Posted' ? 'bg-blue-950 text-blue-400' :
                      s.status === 'Voided' ? 't-bg-elevated t-text-3' : 't-bg-elevated t-text-4'
                    }`}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {salesMore && (
          <button onClick={loadMoreSales} disabled={salesLoading}
            className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors font-medium">
            {salesLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      {/* Payments */}
      <section className="mb-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">Payments</h2>
        <div className="t-bg-surface border t-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b t-border-strong">
                {['Date', 'Mode', 'Amount', 'Reference', 'Collection Receipt No.', 'Unapplied'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {qPayments.isLoading && <SkeletonTable rows={3} cols={6} />}
              {!qPayments.isLoading && payments.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center t-text-4">No payments.</td></tr>
              )}
              {payments.map((p: CustomerPaymentOut) => (
                <tr key={p.payment_id} className="border-b t-border">
                  <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                  <td className="px-3 py-2 t-text-2">{paymentModes.find((m: PaymentMode) => m.payment_mode_id === p.payment_mode_id)?.name ?? `Mode ${p.payment_mode_id}`}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-400 font-medium">₱{fmt(p.amount)}</td>
                  <td className="px-3 py-2 t-text-3 font-mono text-[10px]">{p.reference_number || '—'}</td>
                  <td className="px-3 py-2 t-text-3 font-mono text-[10px]">{p.collection_receipt_no || '—'}</td>
                  <td className="px-3 py-2 tabular-nums t-text-3">{p.unapplied_amount > 0 ? `₱${fmt(p.unapplied_amount)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {paymentsMore && (
          <button onClick={loadMorePayments} disabled={paymentsLoading}
            className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors font-medium">
            {paymentsLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      {/* Returns */}
      <section className="mb-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">Returns</h2>
        <div className="t-bg-surface border t-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b t-border-strong">
                {['Return PID', 'Date', 'Items Returned', 'Credit Amount'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {qReturns.isLoading && <SkeletonTable rows={3} cols={4} />}
              {!qReturns.isLoading && returns_.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center t-text-4">No returns.</td></tr>
              )}
              {returns_.map((r: SalesReturnOut) => (
                <tr key={r.return_id}
                  onClick={() => navigate(`/sales/returns/${r.return_id}`)}
                  className="border-b t-border hover:t-bg-elevated cursor-pointer">
                  <td className="px-3 py-2 font-mono t-text-1">{r.return_pid ?? '—'}</td>
                  <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(r.return_date)}</td>
                  <td className="px-3 py-2 t-text-2">{r.items.length} item{r.items.length !== 1 ? 's' : ''}</td>
                  <td className="px-3 py-2 tabular-nums text-purple-400 font-medium">₱{fmt(r.grand_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {returnsMore && (
          <button onClick={loadMoreReturns} disabled={returnsLoading}
            className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors font-medium">
            {returnsLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      {/* Record Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowPayment(false)}>
          <div className="t-bg-surface border t-border-strong rounded-lg p-5 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold t-text-1 mb-1">Record Payment</p>
            <p className="text-xs t-text-3 mb-4">{customer.customer_name}</p>
            {payErr && <p className="text-xs text-red-400 mb-3">{payErr}</p>}
            <div className="space-y-3">
              <div>
                <label className={lCls}>Payment Date *</label>
                <input type="date" className={inputCls} value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div>
                <label className={lCls}>Payment Mode *</label>
                <select className={inputCls} value={payMode} onChange={e => setPayMode(e.target.value)}>
                  <option value="">— select —</option>
                  {paymentModesForRecording.map((m: PaymentMode) => (
                    <option key={m.payment_mode_id} value={m.payment_mode_id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lCls}>Amount *</label>
                <input type="number" min="0" step="0.01" className={inputCls}
                  value={payAmount} onChange={e => setPayAmount(e.target.value)} onFocus={onFocusSelect}
                  placeholder="0.00" />
              </div>
              {showRef && (
                <div>
                  <label className={lCls}>Reference Number</label>
                  <input className={inputCls} value={payRef} onChange={e => setPayRef(e.target.value)}
                    placeholder="GCash ref, card approval…" />
                </div>
              )}
              <div>
                <label className={lCls}>Collection Receipt No.</label>
                <input className={inputCls} value={payReceiptNo} onChange={e => setPayReceiptNo(e.target.value)}
                  placeholder="Optional" />
              </div>
              {selectedMode?.is_pdc && (
                <>
                  <div>
                    <label className={lCls}>Check Number <span className="text-red-400">*</span></label>
                    <input className={inputCls} placeholder="Check #" value={payCheckNum} onChange={e => setPayCheckNum(e.target.value)} />
                  </div>
                  <div>
                    <label className={lCls}>Check Date <span className="text-red-400">*</span></label>
                    <input type="date" className={inputCls} value={payCheckDate} onChange={e => setPayCheckDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={lCls}>Bank Name <span className="text-red-400">*</span></label>
                    <input className={inputCls} placeholder="Bank" value={payBank} onChange={e => setPayBank(e.target.value)} />
                  </div>
                </>
              )}
              <div>
                <label className={lCls}>Notes</label>
                <textarea className={`${inputCls} resize-none`} rows={2} value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  placeholder="Optional note…" />
              </div>
              <p className="text-[10px] t-text-4">
                Current balance: <span className={customer.outstanding_balance > 0 ? 'text-yellow-400' : 't-text-3'}>₱{fmt(customer.outstanding_balance)}</span>
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleRecordPayment} disabled={paying}
                className="flex-1 py-1.5 text-xs rounded text-white disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent)' }}>
                {paying ? 'Recording…' : 'Record Payment'}
              </button>
              <button onClick={() => setShowPayment(false)}
                className="px-4 py-1.5 text-xs border t-border rounded t-text-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
