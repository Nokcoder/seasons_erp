import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient, useQueries } from '@tanstack/react-query'
import { SkeletonTable, FetchingBar } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  salesApi, inventoryApi, authApi,
  type SaleItemOut, type CustomerPaymentOut, type Location, type EmployeeOut,
  type Shift, type CashRegister, type CustomerOut, type PaymentMode,
  type SaleOut, type SalesReturnOut,
} from '../../services/api'
import * as XLSX from 'xlsx'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
// For plain calendar-date strings ("YYYY-MM-DD", e.g. transaction_date) — formats
// the date components directly so the displayed day never shifts with the
// viewer's local timezone (new Date(dateOnlyString) parses as UTC midnight,
// which `toLocaleString` would otherwise convert to local time and possibly
// roll back a day).
function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'UTC' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function CostSourceBadge({ source }: { source: string | null }) {
  if (!source) return null
  const cfg: Record<string, string> = {
    fifo:          'bg-blue-950 text-blue-400',
    supplier_list: 't-bg-elevated t-text-3',
    none:          'bg-yellow-950 text-yellow-500',
  }
  const label: Record<string, string> = {
    fifo:          'FIFO',
    supplier_list: 'List Price',
    none:          'No Cost',
  }
  return (
    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${cfg[source] ?? 't-bg-elevated t-text-4'}`}>
      {label[source] ?? source}
    </span>
  )
}

export default function SaleDetail() {
  const { saleId }  = useParams<{ saleId: string }>()
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const sid         = parseInt(saleId ?? '0')

  const refQueries = useQueries({
    queries: [
      { queryKey: qk.sale(sid),           queryFn: () => salesApi.sales.get(sid),                              ...stale.transactional, enabled: !!sid },
      { queryKey: qk.locations(),         queryFn: () => inventoryApi.locations.all(),                         ...stale.reference },
      { queryKey: qk.employees(),         queryFn: () => authApi.employees.list(),                              ...stale.auth },
      { queryKey: qk.shifts(),            queryFn: () => salesApi.shifts.list(),                                ...stale.reference },
      { queryKey: qk.registers(),         queryFn: () => salesApi.registers.list(),                             ...stale.reference },
      { queryKey: qk.customers(),         queryFn: () => salesApi.customers.list({ include_deleted: true }),    ...stale.reference },
      { queryKey: qk.paymentModes(),      queryFn: () => salesApi.paymentModes.list(),                          ...stale.reference },
      { queryKey: qk.salesReturns({ sale_id: sid }), queryFn: () => salesApi.returns.list({ sale_id: sid }),   ...stale.transactional, enabled: !!sid },
    ],
  })
  const [qSale, qLocs, qEmps, qShifts, qRegs, qCusts, qModes, qReturns] = refQueries
  const sale         = qSale.data
  const locations    = (qLocs.data    ?? []) as Location[]
  const employees    = (qEmps.data    ?? []) as EmployeeOut[]
  const shifts       = (qShifts.data  ?? []) as Shift[]
  const registers    = (qRegs.data    ?? []) as CashRegister[]
  const customers    = (qCusts.data   ?? []) as CustomerOut[]
  const paymentModes = (qModes.data   ?? []) as PaymentMode[]
  const saleReturns  = (qReturns.data ?? []) as SalesReturnOut[]
  const fetching     = refQueries.some(r => r.isFetching && !r.isLoading)

  const locationMap  = new Map(locations.map(l => [l.location_id, l.location_name]))
  const employeeMap  = new Map(employees.map(e => [e.employee_id, `${e.first_name} ${e.last_name}`.trim()]))
  const shiftMap     = new Map(shifts.map(s => [s.shift_id, s.shift_name]))
  const registerMap  = new Map(registers.map(r => [r.register_id, r.name]))
  const customerMap  = new Map(customers.map(c => [c.customer_id, c]))
  const modeMap      = new Map(paymentModes.map(m => [m.payment_mode_id, m]))

  const returnedByItemId = useMemo(() => {
    const map = new Map<number, number>()
    saleReturns.forEach((r: SalesReturnOut) => {
      r.items.forEach(item => {
        if (item.sale_item_id != null) {
          map.set(item.sale_item_id, (map.get(item.sale_item_id) ?? 0) + Number(item.quantity))
        }
      })
    })
    return map
  }, [saleReturns])

  const allReturned = useMemo(() => {
    if (!sale?.items?.length) return false
    return (sale.items as SaleItemOut[]).every((item: SaleItemOut) =>
      (returnedByItemId.get(item.sale_item_id) ?? 0) >= Number(item.quantity)
    )
  }, [sale?.items, returnedByItemId])

  // ── void action ───────────────────────────────────────────────────────────
  const [showVoid,  setShowVoid]  = useState(false)
  const [voidReason,setVoidReason]= useState('')
  const [voiding,   setVoiding]   = useState(false)
  const [voidErr,   setVoidErr]   = useState('')

  async function handleVoid() {
    if (!voidReason.trim()) { setVoidErr('Void reason is required.'); return }
    setVoiding(true); setVoidErr('')
    try {
      await salesApi.sales.void(sid, voidReason.trim())
      await qc.invalidateQueries({ queryKey: qk.sale(sid) })
      await qc.invalidateQueries({ queryKey: qk.sales() })
      setShowVoid(false)
    } catch (e: unknown) {
      setVoidErr(e instanceof Error ? e.message : 'Void failed')
    } finally { setVoiding(false) }
  }

  function handleExport() {
    if (!sale) return
    const hdr = {
      'Sale PID': sale.sale_pid ?? '', 'Date': fmtDateOnly(sale.transaction_date),
      'Cashier': sale.employee_id ? (employeeMap.get(sale.employee_id) ?? '') : '',
      'Customer': sale.customer_id ? (customerMap.get(sale.customer_id)?.customer_name ?? '') : 'Walk-in',
      'Grand Total': sale.grand_total, 'Receipt Total': sale.receipt_grand_total ?? '',
      'Variance': sale.audit_variance ?? '', 'Payment Status': sale.payment_status, 'Sale Status': sale.status,
    }
    // Sheet 1 — Tender Breakdown
    const tenderRows = ((sale as SaleOut).payments ?? []).map((p: CustomerPaymentOut) => {
      const fallback   = modeMap.get(p.payment_mode_id)
      const modeName   = p.payment_mode_name ?? fallback?.name ?? `Mode ${p.payment_mode_id}`
      const isPhysical = p.payment_mode_is_physical != null ? p.payment_mode_is_physical : (fallback?.is_physical ?? true)
      return { ...hdr, 'Payment Mode': modeName, Amount: p.amount, 'Reference Number': p.reference_number ?? '', 'Money Type': isPhysical ? 'Physical' : 'Virtual' }
    })
    if (tenderRows.length === 0) tenderRows.push({ ...hdr, 'Payment Mode': '', Amount: '', 'Reference Number': '', 'Money Type': '' })

    // Sheet 2 — Line Item Detail
    const itemRows = (sale.items ?? []).map((i: SaleItemOut) => ({
      ...hdr,
      Brand: i.variant?.product_brand ?? '', 'Variant Name': i.variant?.variant_name ?? '', PID: i.variant?.PID ?? '',
      Qty: i.quantity, 'Unit Price': i.unit_price, 'Disc %': i.discount_pct ?? '', 'Disc ₱': i.discount_flat ?? '',
      'Line Total': i.line_total, 'Net Unit Cost': i.net_unit_cost ?? '',
      'Cost Source': i.cost_source ?? '', 'Product Type': i.variant?.product_type ?? '',
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tenderRows), 'Tender Breakdown')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows),   'Line Item Detail')
    XLSX.writeFile(wb, `sale_${sale.sale_pid ?? sid}.xlsx`)
  }

  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-0.5'
  const vCls = 'text-sm t-text-1'

  if (qSale.isLoading) return (
    <div className="p-6 t-bg-base min-h-full">
      <div className="h-4 t-bg-elevated rounded w-48 animate-pulse mb-6" />
      <SkeletonTable rows={5} cols={8} />
    </div>
  )
  if (!sale) return <div className="p-8 t-text-4 text-sm">Sale not found.</div>

  const variance = sale.audit_variance
  const customer = sale.customer_id ? customerMap.get(sale.customer_id) : null

  return (
    <div className="p-5 max-w-6xl t-bg-base min-h-full">
      <FetchingBar show={fetching} />

      {/* breadcrumb + actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-xs t-text-4">
          <button onClick={() => navigate('/sales/ledger')} className="hover:t-text-2">Sales Ledger</button>
          <span>/</span>
          <span className="t-text-2">{sale.sale_pid ?? `SALE-${sid}`}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport}
            className="px-3 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
            Export XLSX
          </button>
          {sale.status === 'Posted' && (
            <>
              <button onClick={() => navigate(`/sales/returns/new?sale_id=${sid}`)}
                disabled={allReturned}
                title={allReturned ? 'All items on this sale have already been returned' : undefined}
                className="px-3 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Process Return
              </button>
              <button onClick={() => setShowVoid(true)}
                className="px-3 py-1 text-xs border border-red-900 text-red-500 rounded hover:bg-red-950 transition-colors">
                Void
              </button>
            </>
          )}
          {sale.status === 'Draft' && (
            <>
              <button onClick={() => navigate(`/sales/new`)}
                className="px-3 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
                Edit in Workstation
              </button>
            </>
          )}
        </div>
      </div>

      {/* header */}
      <div className="t-bg-surface border t-border rounded-lg p-5 mb-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          <div><label className={lCls}>Sale PID</label><p className={`${vCls} font-mono`}>{sale.sale_pid ?? '—'}</p></div>
          <div><label className={lCls}>Date</label><p className={vCls}>{fmtDateOnly(sale.transaction_date)}</p></div>
          <div><label className={lCls}>Status</label>
            <span className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${
              sale.status === 'Posted' ? 'bg-blue-950 text-blue-400' :
              sale.status === 'Voided' ? 't-bg-elevated t-text-4' : 't-bg-elevated t-text-3'
            }`}>{sale.status}</span>
          </div>
          <div><label className={lCls}>Payment</label>
            <span className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${
              sale.payment_status === 'Paid'    ? 'bg-emerald-950 text-emerald-500' :
              sale.payment_status === 'Partial' ? 'bg-yellow-950 text-yellow-500'  :
              'bg-red-950 text-red-500'
            }`}>{sale.payment_status}</span>
          </div>

          {sale.shift_id    && <div><label className={lCls}>Shift</label><p className={vCls}>{shiftMap.get(sale.shift_id) ?? '—'}</p></div>}
          <div><label className={lCls}>Location</label><p className={vCls}>{locationMap.get(sale.location_id) ?? '—'}</p></div>
          {sale.register_id && <div><label className={lCls}>Register</label><p className={vCls}>{registerMap.get(sale.register_id) ?? '—'}</p></div>}
          <div><label className={lCls}>Cashier</label><p className={vCls}>{sale.employee_id ? (employeeMap.get(sale.employee_id) ?? '—') : '—'}</p></div>
          <div><label className={lCls}>Customer</label>
            {customer
              ? <button onClick={() => navigate(`/customers/${customer.customer_id}`)} className="text-sm text-blue-400 hover:underline">{customer.customer_name}</button>
              : <p className={vCls}>Walk-in</p>}
          </div>

          <div><label className={lCls}>Subtotal</label><p className={vCls}>₱{fmt(sale.subtotal_amount)}</p></div>
          {(sale.cart_discount_pct || sale.cart_discount_flat) && (
            <div><label className={lCls}>Cart Disc</label>
              <p className={vCls}>
                {sale.cart_discount_pct ? `${sale.cart_discount_pct}%` : ''}{sale.cart_discount_pct && sale.cart_discount_flat ? ' + ' : ''}{sale.cart_discount_flat ? `₱${fmt(sale.cart_discount_flat)}` : ''}
              </p>
            </div>
          )}
          <div><label className={lCls}>Discount</label><p className={vCls}>₱{fmt(sale.discount_amount)}</p></div>
          <div><label className={lCls}>Grand Total</label><p className="text-sm font-bold t-text-1">₱{fmt(sale.grand_total)}</p></div>
          <div><label className={lCls}>Balance Due</label><p className={`text-sm font-medium ${sale.balance_due > 0 ? 'text-red-400' : 't-text-1'}`}>₱{fmt(sale.balance_due)}</p></div>
          <div><label className={lCls}>Receipt Total</label><p className={vCls}>{sale.receipt_grand_total != null ? `₱${fmt(sale.receipt_grand_total)}` : '—'}</p></div>
          <div><label className={lCls}>Variance</label>
            <p className={`text-sm font-medium ${variance != null && variance !== 0 ? 'text-yellow-500' : 't-text-4'}`}>
              {variance != null && variance !== 0 ? (variance > 0 ? `+₱${fmt(variance)}` : `-₱${fmt(Math.abs(variance))}`) : '—'}
            </p>
          </div>
          {sale.created_by_user_id && <div><label className={lCls}>Created By (User)</label><p className={vCls}>{sale.created_by_user_id}</p></div>}
          {sale.void_reason && (
            <div className="col-span-2"><label className={lCls}>Void Reason</label><p className="text-sm text-red-400">{sale.void_reason}</p></div>
          )}
        </div>
      </div>

      {/* line items */}
      <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">Line Items</h2>
      <div className="t-bg-surface border t-border rounded-lg overflow-x-auto mb-5">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border-strong">
              {[
                'Brand','Variant','PID','Qty','Unit Price','Disc %','Disc ₱','Line Total','Net Unit Cost','Cost Source',
                ...(saleReturns.length > 0 ? ['Returned','Returnable'] : []),
              ].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(!sale.items || sale.items.length === 0) && (
              <tr><td colSpan={10 + (saleReturns.length > 0 ? 2 : 0)} className="px-3 py-6 text-center t-text-4">No line items.</td></tr>
            )}
            {(sale.items ?? []).map((item: SaleItemOut) => {
              const qtyReturned = returnedByItemId.get(item.sale_item_id) ?? 0
              const qtyReturnable = Math.max(0, Number(item.quantity) - qtyReturned)
              return (
                <tr key={item.sale_item_id} className="border-b t-border">
                  <td className="px-3 py-2 t-text-3">{item.variant?.variant_name ?? '—'}</td>
                  <td className="px-3 py-2 t-text-1">{item.variant?.variant_name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono t-text-3">{item.variant?.PID ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums t-text-2">{Number(item.quantity).toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums t-text-2">₱{fmt(item.unit_price)}</td>
                  <td className="px-3 py-2 tabular-nums t-text-3">{item.discount_pct != null ? `${item.discount_pct}%` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums t-text-3">{item.discount_flat != null ? `₱${fmt(item.discount_flat)}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums t-text-1 font-medium">₱{fmt(item.line_total)}</td>
                  <td className="px-3 py-2 tabular-nums t-text-3">{item.net_unit_cost != null ? `₱${fmt(item.net_unit_cost)}` : '—'}</td>
                  <td className="px-3 py-2"><CostSourceBadge source={item.cost_source} /></td>
                  {saleReturns.length > 0 && (
                    <>
                      <td className="px-3 py-2 tabular-nums t-text-3">{qtyReturned > 0 ? qtyReturned.toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 tabular-nums">
                        <span className={qtyReturnable === 0 ? 't-text-4' : 'text-emerald-400'}>{qtyReturnable.toLocaleString()}</span>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* tenders */}
      {sale.payments && sale.payments.length > 0 && (
        <>
          <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">Tender</h2>
          <div className="t-bg-surface border t-border rounded-lg overflow-hidden mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b t-border-strong">
                  {['Payment Mode', 'Amount', 'Reference', 'Money Type'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(sale.payments as CustomerPaymentOut[]).map(p => {
                  // Use backend-resolved name/is_physical; fall back to modeMap for older data
                  const fallback = modeMap.get(p.payment_mode_id)
                  const modeName    = p.payment_mode_name    ?? fallback?.name    ?? `Mode ${p.payment_mode_id}`
                  const isPhysical  = p.payment_mode_is_physical != null ? p.payment_mode_is_physical : (fallback?.is_physical ?? true)
                  return (
                    <tr key={p.payment_id} className="border-b t-border">
                      <td className="px-3 py-2 t-text-2">{modeName}</td>
                      <td className="px-3 py-2 tabular-nums t-text-1">₱{fmt(p.amount)}</td>
                      <td className="px-3 py-2 font-mono t-text-3 text-[10px]">{p.reference_number || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${isPhysical ? 'bg-blue-950 text-blue-400' : 'bg-purple-950 text-purple-400'}`}>
                          {isPhysical ? 'Physical' : 'Virtual'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="t-bg-elevated border-t t-border">
                {(() => {
                  const pmts = sale.payments as CustomerPaymentOut[]
                  const resolvePhysical = (p: CustomerPaymentOut) =>
                    p.payment_mode_is_physical != null ? p.payment_mode_is_physical : (modeMap.get(p.payment_mode_id)?.is_physical ?? true)
                  const physical = pmts.filter(p => resolvePhysical(p)).reduce((s, p) => s + Number(p.amount), 0)
                  const virtual  = pmts.filter(p => !resolvePhysical(p)).reduce((s, p) => s + Number(p.amount), 0)
                  return (
                    <>
                      {physical > 0 && <tr><td className="px-3 py-1.5 text-[10px] t-text-3">Total Physical</td><td className="px-3 py-1.5 tabular-nums t-text-2">₱{fmt(physical)}</td><td /><td /></tr>}
                      {virtual  > 0 && <tr><td className="px-3 py-1.5 text-[10px] t-text-3">Total Virtual</td><td className="px-3 py-1.5 tabular-nums t-text-2">₱{fmt(virtual)}</td><td /><td /></tr>}
                      <tr>
                        <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest t-text-3">Total Tendered</td>
                        <td className="px-3 py-2 tabular-nums font-bold t-text-1">₱{fmt(physical + virtual)}</td>
                        <td /><td />
                      </tr>
                    </>
                  )
                })()}
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* returns */}
      {saleReturns.length > 0 && (
        <>
          <h2 className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">Returns</h2>
          <div className="t-bg-surface border t-border rounded-lg overflow-x-auto mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b t-border-strong">
                  {['Return PID', 'Date', 'Disposition', 'Reason', 'Items Returned', 'Return Total'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {saleReturns.map((r: SalesReturnOut) => (
                  <tr key={r.return_id} className="border-b t-border">
                    <td className="px-3 py-2 font-mono t-text-2">
                      <button onClick={() => navigate(`/sales/returns/${r.return_id}`)} className="text-blue-400 hover:underline">
                        {r.return_pid ?? `RET-${r.return_id}`}
                      </button>
                    </td>
                    <td className="px-3 py-2 t-text-3 whitespace-nowrap">{fmtDate(r.return_date)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${r.disposition === 'credit_to_account' ? 'bg-purple-950 text-purple-400' : 't-bg-elevated t-text-3'}`}>
                        {r.disposition === 'credit_to_account' ? 'Credit' : 'Cash Refund'}
                      </span>
                    </td>
                    <td className="px-3 py-2 t-text-3">{r.reason || '—'}</td>
                    <td className="px-3 py-2 tabular-nums t-text-2">{r.items.reduce((s, i) => s + Number(i.quantity), 0).toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums text-purple-400 font-medium">−₱{fmt(r.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="t-bg-elevated border-t t-border">
                <tr>
                  <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest t-text-3" colSpan={5}>Total Returned</td>
                  <td className="px-3 py-2 tabular-nums font-bold text-purple-400">
                    −₱{fmt(saleReturns.reduce((s, r) => s + Number(r.grand_total), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* Void Modal */}
      {showVoid && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowVoid(false)}>
          <div className="t-bg-surface border t-border-strong rounded-lg p-5 w-96 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold t-text-1 mb-1">Void Sale</p>
            <p className="text-xs t-text-3 mb-4">{sale.sale_pid} — ₱{fmt(sale.grand_total)}</p>
            {voidErr && <p className="text-xs text-red-400 mb-3">{voidErr}</p>}
            <div className="mb-4">
              <label className="block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1">Void Reason *</label>
              <textarea
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                rows={3}
                placeholder="Reason for voiding this sale…"
                className="t-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] w-full resize-none"
              />
            </div>
            <p className="text-[10px] text-yellow-500 mb-4">
              This will reverse all stock movements and AR entries. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={handleVoid} disabled={voiding}
                className="flex-1 py-1.5 text-xs rounded text-white bg-red-700 hover:bg-red-600 disabled:opacity-40">
                {voiding ? 'Voiding…' : 'Confirm Void'}
              </button>
              <button onClick={() => setShowVoid(false)}
                className="px-4 py-1.5 text-xs border t-border rounded t-text-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
