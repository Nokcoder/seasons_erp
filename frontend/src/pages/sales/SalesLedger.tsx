import { Fragment, useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import KeywordSearch from '../../components/KeywordSearch'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { normalize } from '../../lib/normalize'
import { useAuth } from '../../context/AuthContext'
import {
  salesApi, inventoryApi, authApi, catalogueApi,
  type SaleOut, type SaleItemOut, type CustomerPaymentOut, type Location,
  type EmployeeOut, type Shift, type CashRegister, type CustomerOut,
  type PaymentMode, type SalesSummaryResponse, type CollectionEntry, type SalesReturnOut,
  type SalesReturnItemOut, type InvProduct,
} from '../../services/api'
import * as XLSX from 'xlsx'
import { jsonToFormattedSheet, MONEY_FORMAT, PCT_FORMAT } from '../../lib/xlsxMoney'

// ── helpers ───────────────────────────────────────────────────────────────────

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
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function php(n: number | null | undefined) {
  if (n == null) return '—'
  return `₱${fmt(n)}`
}
// Local calendar date as YYYY-MM-DD — `toISOString()` returns the UTC date,
// which lands on the wrong day during the PH-local late-night/early-morning hours.
function todayLocal() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="relative group/tip inline-block">
      {children}
      <span className={[
        'pointer-events-none invisible group-hover/tip:visible',
        'absolute left-0 bottom-full mb-1.5 z-50',
        't-bg-elevated border t-border-strong rounded-md shadow-xl',
        'px-2.5 py-2 w-52 text-[10px] t-text-2 leading-relaxed whitespace-normal',
      ].join(' ')}>
        {tip}
      </span>
    </span>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function SkeletonDashCard() {
  return (
    <div className="rounded-lg border t-border t-bg-surface p-4 flex-1 min-w-0">
      <div className="h-2 t-bg-elevated rounded w-20 animate-pulse mb-4" />
      {[1,2,3,4].map(i => (
        <div key={i} className="flex justify-between mb-2">
          <div className="h-2 t-bg-elevated rounded w-28 animate-pulse" />
          <div className="h-2 t-bg-elevated rounded w-20 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function Dashboard({ summary, loading }: { summary: SalesSummaryResponse | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="shrink-0 border-b t-border px-4 py-3 flex gap-3">
        <SkeletonDashCard /><SkeletonDashCard /><SkeletonDashCard />
      </div>
    )
  }
  if (!summary) return null

  const varColor = summary.variances > 0 ? 'text-emerald-400' : summary.variances < 0 ? 'text-red-400' : 't-text-3'
  const profitColor = summary.gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'

  type SummaryWithRefunds = SalesSummaryResponse & { cash_refunds_total?: number }
  const cashRefundsTotal = Number((summary as SummaryWithRefunds).cash_refunds_total ?? 0)

  return (
    <div className="shrink-0 border-b t-border px-4 py-3 flex gap-3 overflow-x-auto">

      {/* Card 1 — Revenue */}
      <div className="rounded-lg border t-border t-bg-surface p-4 flex-1 min-w-[240px]">
        <p className="text-[9px] font-semibold uppercase tracking-widest t-text-3 mb-3">Revenue</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between items-baseline">
            <Tip tip="Total value of merchandise sold before discounts.">
              <span className="t-text-2 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Merchandise Gross</span>
            </Tip>
            <span className="tabular-nums t-text-1 ml-4">{php(summary.merchandise_gross)}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <Tip tip="Total value of customer returns credited back.">
              <span className="t-text-2 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Returns</span>
            </Tip>
            <span className="tabular-nums text-red-400 ml-4">−{php(summary.returns_total)}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <Tip tip="Total discounts applied at cart level.">
              <span className="t-text-2 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Cart Discounts</span>
            </Tip>
            <span className="tabular-nums text-red-400 ml-4">−{php(summary.cart_discounts)}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <Tip tip="Revenue from services, delivery charges, and non-stock items.">
              <span className="t-text-2 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Non-Merch Revenue</span>
            </Tip>
            <span className="tabular-nums t-text-2 ml-4">+{php(summary.non_merchandise_revenue)}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <Tip tip="Net difference between receipt totals entered by auditors and system-computed grand totals.">
              <span className="t-text-2 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Variances</span>
            </Tip>
            <span className={`tabular-nums ml-4 ${varColor}`}>
              {summary.variances >= 0 ? '+' : ''}{php(summary.variances)}
            </span>
          </div>
          <div className="border-t t-border pt-1.5 flex justify-between items-baseline">
            <span className="t-text-1 font-semibold">Total Revenue</span>
            <span className="tabular-nums font-bold t-text-1 text-sm ml-4">{php(summary.total_revenue)}</span>
          </div>
        </div>
      </div>

      {/* Card 2 — Profitability */}
      <div className="rounded-lg border t-border t-bg-surface p-4 flex-1 min-w-[240px]">
        <p className="text-[9px] font-semibold uppercase tracking-widest t-text-3 mb-3">Profitability</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between items-baseline">
            <Tip tip="Gross profit (revenue minus cost of goods sold) calculated only for sales where complete cost data is available. Sales with missing cost data are excluded.">
              <span className="t-text-2 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Gross Profit</span>
            </Tip>
            <span className={`tabular-nums font-semibold ml-4 ${profitColor}`}>{php(summary.gross_profit)}</span>
          </div>
          <div className="border-t t-border pt-1.5 flex justify-between items-baseline">
            <Tip tip="Revenue from sales where cost data is incomplete. Profit cannot be calculated for these sales. Confirm shipment costs to include these in gross profit.">
              <span className="t-text-3 cursor-help underline decoration-dotted t-border-strong underline-offset-2">Uncosted Revenue</span>
            </Tip>
            <span className={`tabular-nums ml-4 ${summary.uncosted_revenue > 0 ? 'text-yellow-400' : 't-text-4'}`}>
              {summary.uncosted_revenue > 0 ? php(summary.uncosted_revenue) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Card 3 — Collections */}
      <div className="rounded-lg border t-border t-bg-surface p-4 flex-1 min-w-[240px]">
        <p className="text-[9px] font-semibold uppercase tracking-widest t-text-3 mb-3">Collections</p>
        <div className="space-y-1 text-xs mb-2">
          {summary.collections.length === 0 && (
            <p className="t-text-4 text-[10px]">No payment data.</p>
          )}
          {summary.collections.map((c: CollectionEntry) => (
            <div key={c.payment_mode} className="flex items-center gap-2">
              <span className="t-text-2 min-w-0 flex-1 truncate">{c.payment_mode}</span>
              <span className={`text-[9px] font-medium uppercase px-1 py-0.5 rounded shrink-0 ${c.is_physical ? 'bg-blue-950 text-blue-400' : 'bg-purple-950 text-purple-400'}`}>
                {c.is_physical ? 'Phys' : 'Virt'}
              </span>
              <span className="tabular-nums t-text-1 text-right w-24 shrink-0">{php(c.amount)}</span>
            </div>
          ))}
          {cashRefundsTotal > 0 && (
            <div className="flex items-center gap-2">
              <span className="t-text-2 min-w-0 flex-1 truncate">Cash Refunds</span>
              <span className="text-[9px] font-medium uppercase px-1 py-0.5 rounded shrink-0 bg-blue-950 text-blue-400">
                Phys
              </span>
              <span className="tabular-nums text-red-400 text-right w-24 shrink-0">−{php(cashRefundsTotal)}</span>
            </div>
          )}
        </div>
        {summary.collections.length > 0 && (
          <div className="border-t t-border pt-1.5 space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="t-text-3 flex-1">Total Physical</span>
              <span className="tabular-nums t-text-2 text-right w-24 shrink-0">{php(summary.total_physical)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="t-text-3 flex-1">
                <Tip tip="Digital payments collected but not physically in the cash drawer.">
                  <span className="cursor-help underline decoration-dotted t-border-strong underline-offset-2">Total Virtual</span>
                </Tip>
              </span>
              <span className="tabular-nums t-text-2 text-right w-24 shrink-0">{php(summary.total_virtual)}</span>
            </div>
            <div className="flex items-center gap-2 font-semibold">
              <span className="t-text-2 flex-1">Total Collected</span>
              <span className="tabular-nums t-text-1 text-right w-24 shrink-0">{php(summary.total_collected)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Column picker persistence ─────────────────────────────────────────────────

const COL_KEY = 'erp_ledger_cols'

interface ColVis {
  shift: boolean; location: boolean; register: boolean; cashier: boolean
  customer: boolean; subtotalAmt: boolean; cartDiscPct: boolean; cartDiscFlat: boolean
  discountAmt: boolean; taxAmt: boolean; nonMerchRev: boolean; totalTendered: boolean
  variance: boolean; payStatus: boolean; saleStatus: boolean; actions: boolean
}
const COL_DEFAULTS: ColVis = {
  shift: false, location: true, register: false, cashier: true,
  customer: true, subtotalAmt: false, cartDiscPct: false, cartDiscFlat: false,
  discountAmt: false, taxAmt: false, nonMerchRev: false, totalTendered: true,
  variance: true, payStatus: true, saleStatus: true, actions: true,
}
function loadCols(): ColVis {
  try { return { ...COL_DEFAULTS, ...JSON.parse(localStorage.getItem(COL_KEY) ?? '{}') } }
  catch { return COL_DEFAULTS }
}
function saveCols(c: ColVis) { localStorage.setItem(COL_KEY, JSON.stringify(c)) }

const COL_LABELS: [keyof ColVis, string][] = [
  ['shift', 'Shift'], ['location', 'Location'], ['register', 'Register'],
  ['cashier', 'Cashier'], ['customer', 'Customer'],
  ['subtotalAmt', 'Subtotal Amount'], ['cartDiscPct', 'Cart Disc %'],
  ['cartDiscFlat', 'Cart Disc ₱'], ['discountAmt', 'Discount Amount'],
  ['taxAmt', 'Tax Amount'], ['nonMerchRev', 'Non-Merch Revenue'], ['totalTendered', 'Total Tendered'],
  ['variance', 'Variance'], ['payStatus', 'Payment Status'],
  ['saleStatus', 'Sale Status'], ['actions', 'Actions'],
]

// ── Main component ────────────────────────────────────────────────────────────

export default function SalesLedger() {
  const { user } = useAuth()
  const canExport = user?.action_keys?.includes('export_sales') ?? false
  const navigate = useNavigate()

  // ── filter state ──────────────────────────────────────────────────────────
  const [searchTags,     setSearchTags]     = useState<string[]>([])
  const [liveInput,      setLiveInput]      = useState('')
  const [dateFrom,       setDateFrom]       = useState(todayLocal)
  const [dateTo,         setDateTo]         = useState(todayLocal)
  const [locFilter,      setLocFilter]      = useState('')
  const [shiftFilter,    setShiftFilter]    = useState('')
  const [registerFilter, setRegisterFilter] = useState('')
  const [empFilter,      setEmpFilter]      = useState('')
  const [custFilter,     setCustFilter]     = useState('')
  const [saleStatus,     setSaleStatus]     = useState('Posted')
  const [payStatus,      setPayStatus]      = useState('')
  const [hasVariance,    setHasVariance]    = useState(false)
  const [hasUncosted,    setHasUncosted]    = useState(false)

  // ── column visibility ─────────────────────────────────────────────────────
  const [cols, setCols] = useState<ColVis>(loadCols)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  function updateCol(key: keyof ColVis, val: boolean) {
    setCols(prev => { const next = { ...prev, [key]: val }; saveCols(next); return next })
  }

  // ── expanded tender rows ──────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // ── reference data ─────────────────────────────────────────────────────────
  const refQueries = useQueries({
    queries: [
      { queryKey: qk.locations(),    queryFn: () => inventoryApi.locations.all(),     ...stale.reference },
      { queryKey: qk.employees(),    queryFn: () => authApi.employees.list(),          ...stale.auth     },
      { queryKey: qk.shifts(),       queryFn: () => salesApi.shifts.list(),            ...stale.reference },
      { queryKey: qk.registers(),    queryFn: () => salesApi.registers.list(),         ...stale.reference },
      { queryKey: qk.customers(),    queryFn: () => salesApi.customers.list(),         ...stale.reference },
      { queryKey: qk.paymentModes(), queryFn: () => salesApi.paymentModes.list(),      ...stale.reference },
    ],
  })
  const locations   = (refQueries[0].data ?? []) as Location[]
  const employees   = (refQueries[1].data ?? []) as EmployeeOut[]
  const shifts      = (refQueries[2].data ?? []) as Shift[]
  const registers   = (refQueries[3].data ?? []) as CashRegister[]
  const customers   = (refQueries[4].data ?? []) as CustomerOut[]
  const payModes    = (refQueries[5].data ?? []) as PaymentMode[]

  // ── shared scope params (dashboard + table) ────────────────────────────────
  const scopeParams = useMemo(() => ({
    date_from:   dateFrom    || undefined,
    date_to:     dateTo      || undefined,
    location_id: locFilter      ? parseInt(locFilter)      : undefined,
    shift_id:    shiftFilter    ? parseInt(shiftFilter)    : undefined,
    register_id: registerFilter ? parseInt(registerFilter) : undefined,
    employee_id: empFilter      ? parseInt(empFilter)      : undefined,
    customer_id: custFilter     ? parseInt(custFilter)     : undefined,
    status:      saleStatus     || undefined,
  }), [dateFrom, dateTo, locFilter, shiftFilter, registerFilter, empFilter, custFilter, saleStatus])

  const tableParams = useMemo(() => ({
    ...scopeParams,
    payment_status: payStatus    || undefined,
    has_variance:   hasVariance  || undefined,
    has_uncosted:   hasUncosted  || undefined,
    limit:          200,
  }), [scopeParams, payStatus, hasVariance, hasUncosted])

  // ── keyword search (client-side AND filter over the fetched page) ─────────
  const handleTagsChange = useCallback((tags: string[]) => setSearchTags(tags), [])
  const handlePartialChange = useCallback((v: string) => setLiveInput(v), [])

  // ── queries ────────────────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading, isFetching: summaryFetching } = useQuery({
    queryKey: qk.salesSummary(scopeParams as Record<string, unknown>),
    queryFn:  () => salesApi.sales.summary(scopeParams),
    ...stale.transactional,
  })

  const { data: resp, isLoading: tableLoading, isFetching: tableFetching } = useQuery({
    queryKey: qk.sales(tableParams as Record<string, unknown>),
    queryFn:  () => salesApi.sales.list(tableParams),
    ...stale.transactional,
  })

  const sales  = resp?.items  ?? []
  const totals = resp?.totals
  const anyFetching = summaryFetching || tableFetching || refQueries.some(r => r.isFetching)

  // ── lookup maps ────────────────────────────────────────────────────────────
  const locationMap  = useMemo(() => new Map(locations.map(l => [l.location_id, l.location_name])), [locations])
  const shiftMap     = useMemo(() => new Map(shifts.map(s => [s.shift_id, s.shift_name])), [shifts])
  const registerMap  = useMemo(() => new Map(registers.map(r => [r.register_id, r.name])), [registers])
  const employeeMap  = useMemo(() => new Map(employees.map(e => [e.employee_id, `${e.first_name} ${e.last_name}`.trim()])), [employees])
  const customerMap  = useMemo(() => new Map(customers.map(c => [c.customer_id, c.customer_name])), [customers])
  const modeMap      = useMemo(() => new Map(payModes.map(m => [m.payment_mode_id, m])), [payModes])

  function cashierName(s: SaleOut) { return s.employee_id ? (employeeMap.get(s.employee_id) ?? `EMP-${s.employee_id}`) : '—' }
  function customerName(s: SaleOut) { return s.customer_id ? (customerMap.get(s.customer_id) ?? `CUS-${s.customer_id}`) : 'Walk-in' }

  // ── keyword-filtered rows — ALL active tags (+ live partial) must match ────
  const filteredSales = useMemo(() => {
    const allTerms = [
      ...searchTags.map(t => normalize(t)),
      ...(liveInput.trim() ? [normalize(liveInput)] : []),
    ]
    if (allTerms.length === 0) return sales
    return sales.filter((s: SaleOut) => {
      const hit = (term: string) =>
        normalize(s.sale_pid ?? '').includes(term)
        || normalize(cashierName(s)).includes(term)
        || normalize(customerName(s)).includes(term)
        || (s.items ?? []).some(item =>
          normalize(item.variant?.PID ?? '').includes(term)
          || normalize(item.variant?.sku ?? '').includes(term)
        )
      return allTerms.every(hit)
    })
  }, [sales, searchTags, liveInput, employeeMap, customerMap])

  // ── export (two sheets) ───────────────────────────────────────────────────
  async function handleExport() {
    // Fetch return items for return rows so Sheet 2 can include them
    let returnItemMap = new Map<number, SalesReturnItemOut[]>()
    const returnRows = sales.filter((s: SaleOut) => s.row_type === 'return' && s.return_id != null)
    if (returnRows.length > 0) {
      try {
        const rets = await salesApi.returns.list({
          date_from:   scopeParams.date_from,
          date_to:     scopeParams.date_to,
          location_id: scopeParams.location_id,
          limit:       500,
        })
        for (const r of rets as SalesReturnOut[]) {
          returnItemMap.set(r.return_id, r.items)
        }
      } catch { /* continue without return items */ }
    }

    // Sheet 1 — Tender Breakdown (sales + returns)
    const tenderRows: Record<string, unknown>[] = []
    for (const s of sales) {
      const isRet = s.row_type === 'return'
      const hdr = {
        PID: s.sale_pid ?? '', Date: fmtDateOnly(s.transaction_date),
        Shift: s.shift_id ? (shiftMap.get(s.shift_id) ?? '') : '',
        Location: locationMap.get(s.location_id) ?? '',
        Register: s.register_id ? (registerMap.get(s.register_id) ?? '') : '',
        Cashier: cashierName(s), Customer: customerName(s),
        'Grand Total': Number(s.grand_total),
        'Receipt Total': !isRet && s.receipt_grand_total != null ? Number(s.receipt_grand_total) : undefined,
        Variance: !isRet && s.audit_variance != null ? Number(s.audit_variance) : undefined,
        'Payment Status': !isRet ? s.payment_status : '',
        'Sale Status': s.status,
      }
      if (!isRet && s.payments && s.payments.length > 0) {
        for (const p of s.payments as CustomerPaymentOut[]) {
          const mode = modeMap.get(p.payment_mode_id)
          tenderRows.push({
            ...hdr,
            'Payment Mode': mode?.name ?? `Mode ${p.payment_mode_id}`,
            Amount: Number(p.amount),
            'Reference Number': p.reference_number ?? '',
            'Money Type': mode?.is_physical ? 'Physical' : 'Virtual',
          })
        }
      } else {
        tenderRows.push({ ...hdr, 'Payment Mode': '', Amount: undefined, 'Reference Number': '', 'Money Type': '' })
      }
    }

    // Sheet 2 — Line Item Detail (sales items + return items with negative qty)
    const itemRows: Record<string, unknown>[] = []
    for (const s of sales) {
      const isRet = s.row_type === 'return'
      const hdr = {
        PID: s.sale_pid ?? '', 'Receipt No.': s.receipt_no || '',
        Date: fmtDateOnly(s.transaction_date),
        Cashier: cashierName(s), Customer: customerName(s), 'Row Type': s.status,
      }
      if (!isRet) {
        for (const item of s.items as SaleItemOut[]) {
          itemRows.push({
            ...hdr,
            Brand: item.variant?.product_brand ?? '',
            'Variant Name': item.variant?.variant_name ?? '',
            PID: item.variant?.PID ?? '',
            Qty: item.quantity, 'Unit Price': Number(item.unit_price),
            'Disc %': item.discount_pct != null ? Number(item.discount_pct) : undefined,
            'Disc ₱': item.discount_flat != null ? Number(item.discount_flat) : undefined,
            'Line Total': Number(item.line_total),
            'Net Unit Cost': item.net_unit_cost != null ? Number(item.net_unit_cost) : undefined,
            'Cost Source': item.cost_source ?? '',
            'Product Type': item.variant?.product_type ?? '',
          })
        }
      } else if (s.return_id != null) {
        const retItems = returnItemMap.get(s.return_id) ?? []
        for (const item of retItems) {
          itemRows.push({
            ...hdr,
            Brand: '', 'Variant Name': item.variant?.variant_name ?? `Variant ${item.variant_id}`,
            PID: item.variant?.PID ?? '',
            Qty: -Number(item.quantity), 'Unit Price': undefined,
            'Disc %': undefined, 'Disc ₱': undefined,
            'Line Total': -Number(item.line_total),
            'Net Unit Cost': undefined, 'Cost Source': '', 'Product Type': '',
          })
        }
      }
    }

    // Sheet 3 — Sales by Variant
    // Fetch primary supplier per variant from the catalogue
    const variantSupplierMap = new Map<number, string>()
    try {
      const products = await catalogueApi.products.list() as InvProduct[]
      for (const p of products) {
        for (const v of p.variants) {
          const primary = v.suppliers.find(sv => sv.is_primary) ?? v.suppliers[0]
          if (primary) variantSupplierMap.set(v.variant_id, primary.supplier.supplier_name)
        }
      }
    } catch { /* supplier column left blank on fetch failure */ }

    // Aggregate qty / most-recent price+cost per variant; exclude voids and return rows
    const variantAgg = new Map<number, {
      PID: string; sku: string | null; brand: string; variantName: string
      qty: number; unitPrice: number; unitCost: number | null; latestDate: string | null
    }>()
    for (const s of sales) {
      if (s.status === 'Voided' || s.row_type === 'return') continue
      for (const item of s.items as SaleItemOut[]) {
        const vid  = item.variant_id
        const date = s.transaction_date
        const agg  = variantAgg.get(vid)
        const isNewer = !agg?.latestDate || (date != null && date > agg.latestDate)
        if (!agg) {
          variantAgg.set(vid, {
            PID: item.variant?.PID ?? '', sku: item.variant?.sku ?? null,
            brand: item.variant?.product_brand ?? '',
            variantName: item.variant?.variant_name ?? '',
            qty: Number(item.quantity),
            unitPrice: Number(item.unit_price),
            unitCost: item.net_unit_cost != null ? Number(item.net_unit_cost) : null,
            latestDate: date,
          })
        } else {
          agg.qty += Number(item.quantity)
          if (isNewer) {
            agg.unitPrice  = Number(item.unit_price)
            agg.unitCost   = item.net_unit_cost != null ? Number(item.net_unit_cost) : null
            agg.latestDate = date
          }
        }
      }
    }
    const variantRows = Array.from(variantAgg.entries())
      .sort(([, a], [, b]) => {
        const bc = a.brand.localeCompare(b.brand, undefined, { sensitivity: 'base' })
        return bc !== 0 ? bc : a.variantName.localeCompare(b.variantName, undefined, { sensitivity: 'base' })
      })
      .map(([vid, v]) => ({
        PID: v.PID, SKU: v.sku ?? '', Brand: v.brand, 'Variant Name': v.variantName,
        Supplier: variantSupplierMap.get(vid) ?? '',
        Qty: v.qty, 'Unit Price': v.unitPrice,
        'Unit Cost': v.unitCost ?? undefined,
      }))

    const numFormats = {
      'Grand Total': MONEY_FORMAT, 'Receipt Total': MONEY_FORMAT, Variance: MONEY_FORMAT,
      Amount: MONEY_FORMAT, 'Unit Price': MONEY_FORMAT, 'Disc ₱': MONEY_FORMAT,
      'Line Total': MONEY_FORMAT, 'Net Unit Cost': MONEY_FORMAT, 'Unit Cost': MONEY_FORMAT,
      'Disc %': PCT_FORMAT,
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, jsonToFormattedSheet(tenderRows, numFormats),  'Tender Breakdown')
    XLSX.utils.book_append_sheet(wb, jsonToFormattedSheet(itemRows, numFormats),    'Line Item Detail')
    XLSX.utils.book_append_sheet(wb, jsonToFormattedSheet(variantRows, numFormats), 'Sales by Variant')
    const from = dateFrom || 'all'
    const to   = dateTo   || 'all'
    XLSX.writeFile(wb, `sales_export_${from}_${to}.xlsx`)
  }

  function clearAll() {
    setSearchTags([]); setLiveInput(''); setDateFrom(todayLocal()); setDateTo(todayLocal()); setLocFilter(''); setShiftFilter('')
    setRegisterFilter(''); setEmpFilter(''); setCustFilter(''); setSaleStatus('Posted')
    setPayStatus(''); setHasVariance(false); setHasUncosted(false)
  }

  const iCls = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] w-full'
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'

  // compute visible column count for colSpan
  const visibleCols = 3 /* permanent */ +
    (cols.shift ? 1 : 0) + (cols.location ? 1 : 0) + (cols.register ? 1 : 0) +
    (cols.cashier ? 1 : 0) + (cols.customer ? 1 : 0) +
    (cols.subtotalAmt ? 1 : 0) + (cols.cartDiscPct ? 1 : 0) + (cols.cartDiscFlat ? 1 : 0) +
    (cols.discountAmt ? 1 : 0) + (cols.taxAmt ? 1 : 0) + (cols.nonMerchRev ? 1 : 0) + (cols.totalTendered ? 1 : 0) +
    (cols.variance ? 1 : 0) + (cols.payStatus ? 1 : 0) + (cols.saleStatus ? 1 : 0) +
    (cols.actions ? 1 : 0) + 1 /* expand col */

  return (
    <div className="flex flex-col h-full overflow-hidden t-bg-base">
      <FetchingBar show={anyFetching} />

      {/* ── Dashboard ── */}
      <Dashboard summary={summary} loading={summaryLoading} />

      {/* ── Filter + Table ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* filter panel */}
        <aside className="w-52 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-y-auto p-3 gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest t-text-4">Filters</p>
          <div><label className={lCls}>Search</label>
            <KeywordSearch tags={searchTags} onTagsChange={handleTagsChange}
              onPartialChange={handlePartialChange}
              placeholder="Sale #, customer, reference…" /></div>
          <div><label className={lCls}>Date From</label>
            <input type="date" className={iCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div><label className={lCls}>Date To</label>
            <input type="date" className={iCls} value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
          <div><label className={lCls}>Location</label>
            <select className={iCls} value={locFilter} onChange={e => setLocFilter(e.target.value)}>
              <option value="">All</option>
              {locations.filter(l => l.status === 'Active').map(l => (
                <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
              ))}
            </select></div>
          <div><label className={lCls}>Shift</label>
            <select className={iCls} value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}>
              <option value="">All</option>
              {shifts.map(s => <option key={s.shift_id} value={s.shift_id}>{s.shift_name}</option>)}
            </select></div>
          <div><label className={lCls}>Register</label>
            <select className={iCls} value={registerFilter} onChange={e => setRegisterFilter(e.target.value)}>
              <option value="">All</option>
              {registers.map(r => <option key={r.register_id} value={r.register_id}>{r.name}</option>)}
            </select></div>
          <div><label className={lCls}>Cashier</label>
            <select className={iCls} value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
              <option value="">All</option>
              {employees.filter(e => e.is_active).map(e => (
                <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>
              ))}
            </select></div>
          <div><label className={lCls}>Customer</label>
            <select className={iCls} value={custFilter} onChange={e => setCustFilter(e.target.value)}>
              <option value="">All</option>
              {customers.filter(c => !c.is_deleted).map(c => (
                <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>
              ))}
            </select></div>
          <div><label className={lCls}>Sale Status</label>
            <select className={iCls} value={saleStatus} onChange={e => setSaleStatus(e.target.value)}>
              <option value="">Posted + Voided</option>
              <option value="Posted">Posted</option>
              <option value="Voided">Voided</option>
              <option value="Draft">Draft</option>
            </select></div>
          <div><label className={lCls}>Payment Status</label>
            <select className={iCls} value={payStatus} onChange={e => setPayStatus(e.target.value)}>
              <option value="">All</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
            </select></div>
          <div><label className={lCls}>Audit</label>
            <label className="flex items-center gap-2 text-xs t-text-2 mb-1 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]" checked={hasVariance} onChange={e => setHasVariance(e.target.checked)} />
              Has Variance
            </label>
            <label className="flex items-center gap-2 text-xs t-text-2 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]" checked={hasUncosted} onChange={e => setHasUncosted(e.target.checked)} />
              Has Uncosted Items
            </label></div>
          <button onClick={clearAll} className="text-[10px] t-text-4 hover:t-text-2 text-left mt-auto">Clear all</button>
        </aside>

        {/* table area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
            <span className="text-xs t-text-3">
              {totals ? (() => {
                const returnCount = sales.filter((s: SaleOut) => s.row_type === 'return').length
                const saleCount   = totals.count - returnCount
                return returnCount > 0
                  ? `${saleCount} sale${saleCount !== 1 ? 's' : ''}, ${returnCount} return${returnCount !== 1 ? 's' : ''}`
                  : `${totals.count} sale${totals.count !== 1 ? 's' : ''}`
              })() : '…'}
            </span>
            <div className="ml-auto flex items-center gap-2">

              {/* Column picker */}
              <div className="relative" ref={pickerRef}>
                <button onClick={() => setPickerOpen(o => !o)}
                  className="px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
                  Columns ⚙
                </button>
                {pickerOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 t-bg-surface border t-border-strong rounded-lg shadow-xl z-20 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-2">Toggle Columns</p>
                    {COL_LABELS.map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs t-text-1 mb-1 cursor-pointer">
                        <input type="checkbox" className="accent-[var(--accent)]"
                          checked={cols[key as keyof ColVis]}
                          onChange={e => updateCol(key as keyof ColVis, e.target.checked)} />
                        {label}
                      </label>
                    ))}
                    <p className="text-[9px] t-text-4 mt-2 italic">Sale PID, Date, Grand Total always visible.</p>
                  </div>
                )}
              </div>

              {canExport && (
                <button onClick={handleExport}
                  className="px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
                  Export XLSX
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="t-bg-elevated border-b t-border-strong">
                  {/* expand toggle col */}
                  <th className="w-7 px-1 py-2" />
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Sale PID</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Date</th>
                  {cols.shift      && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Shift</th>}
                  {cols.location   && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Location</th>}
                  {cols.register   && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Register</th>}
                  {cols.cashier      && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Cashier</th>}
                  {cols.customer     && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Customer</th>}
                  {cols.subtotalAmt  && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Subtotal</th>}
                  {cols.cartDiscPct  && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Cart Disc %</th>}
                  {cols.cartDiscFlat && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Cart Disc ₱</th>}
                  {cols.discountAmt  && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Discount</th>}
                  {cols.taxAmt       && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Tax</th>}
                  {cols.nonMerchRev  && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Non-Merch</th>}
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Grand Total</th>
                  {cols.totalTendered && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Tendered</th>}
                  {cols.variance     && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Variance</th>}
                  {cols.payStatus  && <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Payment</th>}
                  {cols.saleStatus && <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap">Status</th>}
                  {cols.actions    && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {tableLoading && <SkeletonTable rows={10} cols={visibleCols} />}
                {!tableLoading && filteredSales.length === 0 && (
                  <tr><td colSpan={visibleCols} className="px-3 py-10 text-center t-text-4">No sales found for the current filters.</td></tr>
                )}
                {!tableLoading && filteredSales.map((s: SaleOut) => {
                  const isReturn  = s.row_type === 'return'
                  const rowNav    = isReturn
                    ? () => navigate(`/sales/returns/${s.return_id}`)
                    : () => navigate(`/sales/ledger/${s.sale_id}`)
                  const rowKey    = isReturn ? `ret-${s.return_id}` : `sale-${s.sale_id}`
                  const variance  = s.audit_variance
                  const expanded  = !isReturn && expandedId === s.sale_id
                  const payments  = (s.payments ?? []) as CustomerPaymentOut[]
                  const gt        = Number(s.grand_total)
                  const gtColor   = isReturn ? 'text-red-400' : 't-text-1'

                  return (
                    <Fragment key={rowKey}>
                      <tr
                        className={`border-b t-border hover:t-bg-surface cursor-pointer transition-colors ${isReturn ? 'bg-purple-950/20' : ''}`}>
                        {/* expand toggle — hidden for return rows */}
                        <td className="px-1 py-2 text-center">
                          {!isReturn && (
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedId(expanded ? null : s.sale_id) }}
                              className="text-[10px] t-text-3 hover:t-text-1 w-5 h-5 flex items-center justify-center rounded hover:t-bg-elevated"
                              title={expanded ? 'Collapse tender' : 'Expand tender'}>
                              {expanded ? '▼' : '▶'}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono t-text-1 whitespace-nowrap" onClick={rowNav}>
                          {s.sale_pid ?? '—'}
                        </td>
                        <td className="px-3 py-2 t-text-3 whitespace-nowrap" onClick={rowNav}>
                          {fmtDateOnly(s.transaction_date)}
                        </td>
                        {cols.shift      && <td className="px-3 py-2 t-text-3" onClick={rowNav}>{s.shift_id ? (shiftMap.get(s.shift_id) ?? '—') : '—'}</td>}
                        {cols.location   && <td className="px-3 py-2 t-text-2" onClick={rowNav}>{locationMap.get(s.location_id) ?? '—'}</td>}
                        {cols.register   && <td className="px-3 py-2 t-text-3" onClick={rowNav}>{s.register_id ? (registerMap.get(s.register_id) ?? '—') : '—'}</td>}
                        {cols.cashier    && <td className="px-3 py-2 t-text-3" onClick={rowNav}>{cashierName(s)}</td>}
                        {cols.customer   && <td className="px-3 py-2 t-text-2" onClick={rowNav}>{customerName(s)}</td>}
                        {cols.subtotalAmt  && <td className="px-3 py-2 tabular-nums t-text-3 text-right" onClick={rowNav}>{isReturn ? '—' : `₱${fmt(s.subtotal_amount)}`}</td>}
                        {cols.cartDiscPct  && <td className="px-3 py-2 tabular-nums t-text-3 text-right" onClick={rowNav}>{!isReturn && s.cart_discount_pct != null ? `${s.cart_discount_pct}%` : '—'}</td>}
                        {cols.cartDiscFlat && <td className="px-3 py-2 tabular-nums t-text-3 text-right" onClick={rowNav}>{!isReturn && s.cart_discount_flat != null && Number(s.cart_discount_flat) > 0 ? `₱${fmt(s.cart_discount_flat)}` : '—'}</td>}
                        {cols.discountAmt  && <td className="px-3 py-2 tabular-nums t-text-4 text-right" onClick={rowNav}>{isReturn ? '—' : `₱${fmt(s.discount_amount)}`}</td>}
                        {cols.taxAmt       && <td className="px-3 py-2 tabular-nums t-text-3 text-right" onClick={rowNav}>{!isReturn && Number(s.tax_amount) > 0 ? `₱${fmt(s.tax_amount)}` : '—'}</td>}
                        {cols.nonMerchRev  && <td className="px-3 py-2 tabular-nums t-text-3 text-right" onClick={rowNav}>{!isReturn && Number(s.non_merchandise_revenue) > 0 ? `₱${fmt(s.non_merchandise_revenue)}` : ''}</td>}
                        <td className={`px-3 py-2 tabular-nums font-medium text-right ${gtColor}`} onClick={rowNav}>
                          {isReturn ? `−₱${fmt(Math.abs(gt))}` : `₱${fmt(gt)}`}
                        </td>
                        {cols.totalTendered && (() => {
                          if (isReturn) return <td className="px-3 py-2 t-text-4 text-right" onClick={rowNav}>—</td>
                          const tendered = s.balance_due != null
                            ? Number(s.grand_total) - Number(s.balance_due)
                            : Number(s.grand_total) + Number(s.audit_variance ?? 0)
                          return <td className="px-3 py-2 tabular-nums t-text-2 text-right" onClick={rowNav}>₱{fmt(tendered)}</td>
                        })()}
                        {cols.variance   && <td className={`px-3 py-2 tabular-nums font-medium text-right ${variance != null && variance !== 0 ? 'text-yellow-500' : 't-text-4'}`} onClick={rowNav}>
                          {!isReturn && variance != null && variance !== 0 ? (variance > 0 ? `+₱${fmt(variance)}` : `-₱${fmt(Math.abs(variance))}`) : '—'}
                        </td>}
                        {cols.payStatus  && <td className="px-3 py-2" onClick={rowNav}>
                          {!isReturn && <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${s.payment_status === 'Paid' ? 'bg-emerald-950 text-emerald-500' : s.payment_status === 'Partial' ? 'bg-yellow-950 text-yellow-500' : 'bg-red-950 text-red-500'}`}>{s.payment_status}</span>}
                        </td>}
                        {cols.saleStatus && <td className="px-3 py-2" onClick={rowNav}>
                          <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${s.status === 'Return' ? 'bg-purple-950 text-purple-400' : s.status === 'Posted' ? 'bg-blue-950 text-blue-400' : s.status === 'Voided' ? 't-bg-elevated t-text-4' : 't-bg-elevated t-text-3'}`}>{s.status}</span>
                        </td>}
                        {cols.actions    && <td className="px-3 py-2">
                          <button onClick={rowNav} className="text-[10px] text-blue-400 hover:underline">View</button>
                        </td>}
                      </tr>

                      {/* expanded tender sub-rows — sales only */}
                      {expanded && payments.map((p: CustomerPaymentOut) => {
                        const mode = modeMap.get(p.payment_mode_id)
                        return (
                          <tr key={`tender-${p.payment_id}`} className="t-bg-elevated border-b t-border">
                            <td className="px-1 py-1.5" />
                            <td colSpan={2} className="px-3 py-1.5 pl-6 text-[10px] t-text-3 font-medium">
                              {mode?.name ?? `Mode ${p.payment_mode_id}`}
                            </td>
                            <td colSpan={visibleCols - 4} className="px-3 py-1.5">
                              <div className="flex items-center gap-3 text-[10px]">
                                <span className="tabular-nums t-text-2">₱{fmt(p.amount)}</span>
                                {p.reference_number && <span className="t-text-3 font-mono">{p.reference_number}</span>}
                                <span className={`font-medium uppercase px-1 py-0.5 rounded ${mode?.is_physical ? 'bg-blue-950 text-blue-400' : 'bg-purple-950 text-purple-400'}`}>
                                  {mode?.is_physical ? 'Physical' : 'Virtual'}
                                </span>
                              </div>
                            </td>
                            <td />
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>

              {/* pinned summary row */}
              {totals && !tableLoading && (
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="t-bg-elevated border-t-2 t-border-strong">
                    <td />
                    <td colSpan={1 + (cols.shift ? 1 : 0) + (cols.location ? 1 : 0) + (cols.register ? 1 : 0) + (cols.cashier ? 1 : 0) + (cols.customer ? 1 : 0)}
                      className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest t-text-3">
                      {(() => {
                        const returnCount = sales.filter((s: SaleOut) => s.row_type === 'return').length
                        const saleCount   = totals.count - returnCount
                        return returnCount > 0
                          ? `${saleCount} sale${saleCount !== 1 ? 's' : ''} + ${returnCount} return${returnCount !== 1 ? 's' : ''}`
                          : `Totals (${totals.count})`
                      })()}
                    </td>
                    <td className="px-3 py-2" />
                    {cols.subtotalAmt  && <td className="px-3 py-2 tabular-nums t-text-2 font-semibold text-right">₱{fmt(totals.subtotal)}</td>}
                    {cols.cartDiscPct  && <td />}
                    {cols.cartDiscFlat && <td />}
                    {cols.discountAmt  && <td className="px-3 py-2 tabular-nums t-text-3 font-semibold text-right">₱{fmt(totals.discount)}</td>}
                    {cols.taxAmt       && <td />}
                    {cols.nonMerchRev  && <td />}
                    <td className="px-3 py-2 tabular-nums t-text-1 font-bold text-right">₱{fmt(totals.grand_total)}</td>
                    {cols.totalTendered && <td className="px-3 py-2 tabular-nums t-text-2 font-semibold text-right">₱{fmt(Number(totals.grand_total ?? 0) + Number(totals.variance ?? 0))}</td>}
                    {cols.variance   && <td className={`px-3 py-2 tabular-nums font-semibold text-right ${totals.variance != null && totals.variance !== 0 ? 'text-yellow-500' : 't-text-4'}`}>{totals.variance != null && totals.variance !== 0 ? `₱${fmt(totals.variance)}` : '—'}</td>}
                    {cols.payStatus  && <td />}
                    {cols.saleStatus && <td />}
                    {cols.actions    && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
