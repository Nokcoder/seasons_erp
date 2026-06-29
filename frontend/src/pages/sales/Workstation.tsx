import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchingBar } from '../../components/Skeleton'
import KeywordSearch from '../../components/KeywordSearch'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import {
  salesApi, inventoryApi, authApi,
  type Shift, type PaymentMode, type CashRegister, type Location, type EmployeeOut,
  type POSCatalogItem, type POSVariant, type POSUomOption, type SaleOut, type CustomerOut,
} from '../../services/api'
import { normalize } from '../../lib/normalize'

// ── local types ───────────────────────────────────────────────────────────────

interface SessionHeader {
  saleDate:     string
  shiftId:      string
  locationId:   string
  registerId:   string
  employeeId:   string
  customerId:   string   // '' = walk-in
  originSaleId: string   // '' = none; stores numeric sale_id as string
  salePID:      string
  pidMode:      'auto' | 'manual'
  receiptNo:    string
}

interface CartItem {
  localId:     string
  variant_id:  number
  label:       string
  unit_price:  string
  isPromoPrice: boolean
  qty:         string
  disc_pct:    string
  disc_flat:   string
  uom_id:      number | null
  uom_factor:  number
  uom_label:   string
  uom_options: POSUomOption[]
}

interface TenderRow {
  localId:             string
  payment_mode_id:     string
  amount:              string
  reference_number:    string
  memo_code:           string
  memo_valid:          boolean | null
  memo_invalid_reason: string
  check_number:        string
  check_date:          string
  bank_name:           string
}

// ── helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10) }

// Matches a catalog item/variant against every normalized keyword term (AND).
function matchesAllTerms(item: POSCatalogItem, v: POSVariant, terms: string[]): boolean {
  return terms.every(term =>
    normalize(item.product_brand).includes(term)
    || normalize(v.variant_name).includes(term)
    || normalize(v.PID).includes(term)
    || normalize(v.sku ?? '').includes(term)
    || v.barcodes.some(b => normalize(b.barcode).includes(term))
  )
}

// Local calendar date as YYYY-MM-DD — `toISOString()` returns the UTC date,
// which lands on the wrong day during the PH-local late-night/early-morning hours.
function today() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Sticky transaction date — remembers the last value chosen at this terminal so
// it carries forward as the default for the next transaction in the session
// (e.g. when batch-entering backdated sales) instead of resetting to today.
const SALE_DATE_KEY      = 'erp_pos_sale_date'
const STICKY_SHIFT_KEY    = 'pos_sticky_shift'
const STICKY_LOCATION_KEY = 'pos_sticky_location'
const STICKY_REGISTER_KEY = 'pos_sticky_register'

function loadSaleDate(): string {
  try { return localStorage.getItem(SALE_DATE_KEY) || today() }
  catch { return today() }
}
function saveSaleDate(d: string) {
  try { localStorage.setItem(SALE_DATE_KEY, d) } catch { /* ignore */ }
}
function loadSticky(key: string): string {
  try { return localStorage.getItem(key) || '' }
  catch { return '' }
}
function saveSticky(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* ignore */ }
}

function calcLineTotal(item: CartItem): number {
  const price = parseFloat(item.unit_price) || 0
  const qty   = parseFloat(item.qty)        || 0
  const pct   = parseFloat(item.disc_pct)   || 0
  const flat  = parseFloat(item.disc_flat)  || 0
  return Math.max(0, (price * (1 - pct / 100) - flat) * qty)
}

function fmt(n: number): string {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}


function effectivePrice(v: POSVariant): number {
  return v.promo_price ?? v.price ?? 0
}

function uomEffectivePrice(opt: POSUomOption): number {
  return opt.promo_price ?? opt.price ?? 0
}

// ui_standards §10 — onFocus selects all
const onFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

// ── shared input classes (theme-aware) ────────────────────────────────────────

const cellInput =
  'w-full bg-transparent border-0 text-sm text-right t-text-1 focus:outline-none focus:ring-0 p-0'

const hdrSelect =
  'text-xs t-bg-input border t-border-strong rounded px-2 py-1 t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors'

const hdrInput = hdrSelect

// ── component ─────────────────────────────────────────────────────────────────

export default function Workstation() {
  const qc = useQueryClient()
  const { user } = useAuth()

  // ── current-user profile (employee name for cashiering mode display) ──
  const { data: myProfile, isError: myProfileError, error: myProfileErrorObj } = useQuery({
    queryKey: qk.myProfile(),
    queryFn:  authApi.me.profile,
    ...stale.reference,
    retry: false,
  })

  // ── live action_keys — guards against stale localStorage (action_keys was []
  //    for sessions saved before this field was added to the login flow) ────────
  const { data: myPrograms, isPending: myProgramsPending } = useQuery({
    queryKey: qk.myPrograms(),
    queryFn:  authApi.me.programs,
    ...stale.reference,
    retry: false,
  })

  // Live data is authoritative; localStorage value is the instant fallback while
  // myPrograms is in-flight so the badge/UI render correctly on the first paint.
  const cashieringMode =
    myPrograms?.action_keys?.includes('cashiering_mode')
    ?? (user?.action_keys?.includes('cashiering_mode') ?? false)

  // Latches to true the first time cashieringMode resolves to true and never
  // reverts. Used to guard sticky writes so they fire reliably once confirmed,
  // regardless of myPrograms re-fetches or the loading window.
  const cashieringConfirmed = useRef(false)
  useEffect(() => {
    if (cashieringMode === true) cashieringConfirmed.current = true
  }, [cashieringMode])

  // ── reference data — React Query ─────────────────────────────────────────
  const refResults = useQueries({
    queries: [
      { queryKey: qk.shifts(),       queryFn: salesApi.shifts.list,           ...stale.reference, retry: 3 },
      { queryKey: qk.locations(),    queryFn: inventoryApi.locations.all,     ...stale.reference, retry: 3 },
      { queryKey: qk.registers(),    queryFn: salesApi.registers.list,        ...stale.reference, retry: 3 },
      { queryKey: qk.paymentModes(), queryFn: salesApi.paymentModes.list,     ...stale.reference, retry: 3 },
      { queryKey: qk.employees(),    queryFn: authApi.employees.list,         ...stale.auth,      retry: 3, enabled: !myProgramsPending && !cashieringMode },
      { queryKey: qk.posCatalog(),   queryFn: inventoryApi.posCatalog,        ...stale.transactional },
    ],
  })
  const [qShifts, qLocs, qRegs, qModes, qEmps, qCatalog] = refResults
  const shifts       = qShifts.data  ?? []
  const locations    = (qLocs.data   ?? []).filter(l => !l.is_deleted && l.status === 'Active' && l.location_type !== 'Virtual')
  const allRegisters = qRegs.data    ?? []
  const paymentModes = (qModes.data  ?? []).filter(m => m.is_active)
  const employees    = ((qEmps.data  ?? []) as EmployeeOut[]).filter(e => e.is_active)
  const catalog      = qCatalog.data ?? []
  const refFetching  = refResults.some(r => r.isFetching && !r.isLoading)
  const regsError    = qRegs.isError

  // ── next PID from backend ─────────────────────────────────────────────────
  const { data: nextPidData } = useQuery({
    queryKey: qk.nextSalePid(),
    queryFn:  salesApi.sales.nextPid,
    ...stale.transactional,
  })

  // Item 8: Cash = mode flagged is_cash, fallback to name match, then first physical, then first active
  const cashModePID = useMemo(() => {
    const byCashFlag = paymentModes.find(m => m.is_cash)
    if (byCashFlag) return byCashFlag.payment_mode_id
    const byName = paymentModes.find(m => m.name.toLowerCase() === 'cash')
    if (byName) return byName.payment_mode_id
    const physical = paymentModes.find(m => m.is_physical)
    if (physical) return physical.payment_mode_id
    return paymentModes[0]?.payment_mode_id ?? null
  }, [paymentModes])

  const [drafts, setDrafts] = useState<SaleOut[]>([])

  // ── session header ────────────────────────────────────────────────────────
  const [header, setHeader] = useState<SessionHeader>({
    saleDate:     loadSaleDate(),
    shiftId:      loadSticky(STICKY_SHIFT_KEY),
    locationId:   loadSticky(STICKY_LOCATION_KEY),
    registerId:   loadSticky(STICKY_REGISTER_KEY),
    employeeId:   '',
    customerId:   '',
    originSaleId: '',
    salePID:      'SALE-00001',
    pidMode:      'auto',
    receiptNo:    '',
  })

  // ── customer search ───────────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOut[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOut | null>(null)
  const customerSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── origin sale search ────────────────────────────────────────────────────
  const [originSalePid,      setOriginSalePid]      = useState('')
  const [originSaleSearching, setOriginSaleSearching] = useState(false)

  function handleCustomerSearch(val: string) {
    setCustomerSearch(val)
    if (customerSearchRef.current) clearTimeout(customerSearchRef.current)
    if (!val.trim()) { setCustomerResults([]); return }
    customerSearchRef.current = setTimeout(async () => {
      try {
        const results = await salesApi.customers.list({ search: val.trim() })
        setCustomerResults(results.slice(0, 8))
      } catch { /* non-fatal */ }
    }, 300)
  }

  function selectCustomer(c: CustomerOut) {
    setSelectedCustomer(c)
    setHeader(h => ({ ...h, customerId: String(c.customer_id) }))
    setCustomerSearch(c.customer_name)
    setCustomerResults([])
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setHeader(h => ({ ...h, customerId: '' }))
    setCustomerSearch('')
    setCustomerResults([])
  }

  async function resolveOriginSale(pid: string) {
    const trimmed = pid.trim()
    if (!trimmed) { setHeader(h => ({ ...h, originSaleId: '' })); return }
    setOriginSaleSearching(true)
    try {
      const resp = await salesApi.sales.list({ search: trimmed, limit: 5 })
      const match = resp.items.find(
        s => s.sale_pid?.toLowerCase() === trimmed.toLowerCase()
      )
      if (match) {
        setHeader(h => ({ ...h, originSaleId: String(match.sale_id) }))
        setOriginSalePid(match.sale_pid ?? trimmed)
      } else {
        flash(`Origin sale "${trimmed}" not found.`, true)
        setHeader(h => ({ ...h, originSaleId: '' }))
      }
    } catch {
      flash('Could not look up origin sale.', true)
    } finally {
      setOriginSaleSearching(false)
    }
  }

  function clearOriginSale() {
    setOriginSalePid('')
    setHeader(h => ({ ...h, originSaleId: '' }))
  }

  // ── cart ──────────────────────────────────────────────────────────────────
  const [cartItems,    setCartItems]    = useState<CartItem[]>([])
  const [cartDiscPct,  setCartDiscPct]  = useState('')
  const [cartDiscFlat, setCartDiscFlat] = useState('')

  // ── tenders ───────────────────────────────────────────────────────────────
  const [tenders, setTenders] = useState<TenderRow[]>([
    { localId: uid(), payment_mode_id: '', amount: '', reference_number: '', memo_code: '', memo_valid: null, memo_invalid_reason: '', check_number: '', check_date: '', bank_name: '' },
  ])

  // ── ui state ──────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('')
  const [filterTags,    setFilterTags]    = useState<string[]>([])
  const [filterInput,   setFilterInput]   = useState('')
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null)
  const [trayOpen,      setTrayOpen]      = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [successMsg,    setSuccessMsg]    = useState('')
  const [txnKey,        setTxnKey]        = useState<string>(() => uid())

  // ── drag fill ─────────────────────────────────────────────────────────────
  const dragRef = useRef<{ col: 'pct' | 'flat'; fromIdx: number; value: string } | null>(null)

  // ── computed values ───────────────────────────────────────────────────────
  const subtotal        = cartItems.reduce((s, i) => s + calcLineTotal(i), 0)
  const cartDiscountAmt = subtotal * ((parseFloat(cartDiscPct) || 0) / 100) + (parseFloat(cartDiscFlat) || 0)
  const grandTotal      = Math.max(0, subtotal - cartDiscountAmt)
  const totalTendered   = tenders.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  // positive = over-tendered (change due), negative = under-tendered (balance due)
  const tenderDelta     = totalTendered - grandTotal

  const filteredRegisters = useMemo(() =>
    allRegisters.filter(r =>
      r.is_active && (!header.locationId || r.location_id === parseInt(header.locationId))
    ),
    [allRegisters, header.locationId]
  )

  const catalogVariantMap = useMemo(() => {
    const m = new Map<number, POSVariant>()
    for (const p of catalog) for (const v of p.variants) m.set(v.variant_id, v)
    return m
  }, [catalog])

  // ── search results ────────────────────────────────────────────────────────
  // Barcode scan field's own match — unchanged from before the split.
  const searchResults = useMemo(() => {
    if (!search.trim()) return [] as Array<{ item: POSCatalogItem; variant: POSVariant }>
    const out: Array<{ item: POSCatalogItem; variant: POSVariant }> = []
    for (const item of catalog) {
      for (const v of item.variants) {
        const hit =
          normalize(item.product_brand).includes(normalize(search)) ||
          normalize(v.variant_name).includes(normalize(search)) ||
          normalize(v.PID).includes(normalize(search)) ||
          normalize(v.sku ?? '').includes(normalize(search)) ||
          v.barcodes.some(b => normalize(b.barcode).includes(normalize(search)))
        if (hit) out.push({ item, variant: v })
        if (out.length >= 10) break
      }
      if (out.length >= 10) break
    }
    return out
  }, [search, catalog])

  // ── keyword filter (AND across tags + live partial) ─────────────────────────
  // Standalone — browses the full catalog independent of the barcode field —
  // and additionally narrows searchResults when the barcode field also has text.
  const handleFilterTagsChange = useCallback((tags: string[]) => setFilterTags(tags), [])
  const handleFilterPartialChange = useCallback((v: string) => setFilterInput(v), [])

  const filterTerms = useMemo(() => [
    ...filterTags.map(t => normalize(t)),
    ...(filterInput.trim() ? [normalize(filterInput)] : []),
  ], [filterTags, filterInput])

  const filteredResults = useMemo(() => {
    if (filterTerms.length === 0) return searchResults
    if (!search.trim()) {
      const out: Array<{ item: POSCatalogItem; variant: POSVariant }> = []
      for (const item of catalog) {
        for (const v of item.variants) {
          if (matchesAllTerms(item, v, filterTerms)) out.push({ item, variant: v })
          if (out.length >= 10) break
        }
        if (out.length >= 10) break
      }
      return out
    }
    return searchResults.filter(({ item, variant: v }) => matchesAllTerms(item, v, filterTerms))
  }, [searchResults, filterTerms, search, catalog])

  // ── initialise sale PID from backend next-pid endpoint ───────────────────
  useEffect(() => {
    if (nextPidData?.next_pid) {
      setHeader(h => ({
        ...h,
        salePID: h.pidMode === 'auto' ? nextPidData.next_pid : h.salePID,
      }))
    }
  }, [nextPidData?.next_pid])

  // ── cashiering mode: lock cashier to logged-in user ───────────────────────
  useEffect(() => {
    if (cashieringMode && myProfile?.employee_id != null) {
      setHeader(h => ({ ...h, employeeId: String(myProfile.employee_id) }))
    }
  }, [cashieringMode, myProfile?.employee_id])

  // ── auto-sync first Cash tender amount with grand total ───────────────────
  useEffect(() => {
    if (!cashModePID) return
    setTenders(prev => {
      if (prev.length !== 1) return prev
      const first = prev[0]
      if (first.payment_mode_id && first.payment_mode_id !== String(cashModePID)) return prev
      return [{
        ...first,
        payment_mode_id: String(cashModePID),
        amount: grandTotal > 0 ? String(grandTotal.toFixed(2)) : '',
      }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grandTotal, cashModePID])

  const refreshDrafts = useCallback(async (locationId?: string) => {
    const lid = locationId ?? header.locationId
    try {
      const list = await salesApi.drafts.list(lid ? parseInt(lid) : undefined)
      setDrafts(list.slice(0, 5))
    } catch { /* non-fatal */ }
  }, [header.locationId])

  useEffect(() => { refreshDrafts() }, [refreshDrafts])

  // ── flash helpers ─────────────────────────────────────────────────────────
  function flash(msg: string, isError = false) {
    if (isError) { setError(msg); setTimeout(() => setError(''), 5000) }
    else         { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 4000) }
  }

  // ── header handlers ───────────────────────────────────────────────────────
  function setHeaderField<K extends keyof SessionHeader>(key: K, val: SessionHeader[K]) {
    setHeader(h => {
      const next = { ...h, [key]: val }
      if (key === 'locationId') {
        const lid = parseInt(val as string)
        const regStillValid = allRegisters.some(
          r => r.register_id === parseInt(h.registerId) && r.location_id === lid
        )
        if (!regStillValid) next.registerId = ''
        if (cashieringConfirmed.current) saveSticky(STICKY_LOCATION_KEY, val as string)
      }
      if (key === 'shiftId' && cashieringConfirmed.current) {
        saveSticky(STICKY_SHIFT_KEY, val as string)
      }
      if (key === 'registerId' && cashieringConfirmed.current) {
        saveSticky(STICKY_REGISTER_KEY, val as string)
      }
      if (key === 'saleDate') {
        saveSaleDate(val as string)
      }
      return next
    })
  }

  // ── barcode UOM resolution ────────────────────────────────────────────────
  function resolveBarcodeUom(variant: POSVariant, barcodeStr: string): POSUomOption | null {
    const bc = variant.barcodes.find(b => b.barcode.toLowerCase() === barcodeStr.toLowerCase())
    if (!bc || !bc.uom_id) return null
    return (variant.uom_conversions ?? []).find(
      c => c.from_uom_id === bc.uom_id && c.price !== null
    ) ?? null
  }

  // ── cart handlers ─────────────────────────────────────────────────────────
  function addToCart(variant: POSVariant, productName: string, uomOverride?: POSUomOption | null) {
    const uomOptions  = (variant.uom_conversions ?? []).filter(c => c.price !== null)
    const isPromo     = variant.promo_price != null

    if (uomOverride) {
      setCartItems(prev => [...prev, {
        localId:      uid(),
        variant_id:   variant.variant_id,
        label:        `${productName} — ${variant.variant_name} (${variant.PID})`,
        unit_price:   String(uomEffectivePrice(uomOverride)),
        isPromoPrice: uomOverride.promo_price != null,
        qty:          '1',
        disc_pct:     '',
        disc_flat:    '',
        uom_id:       uomOverride.from_uom_id,
        uom_factor:   uomOverride.factor,
        uom_label:    uomOverride.from_uom_code,
        uom_options:  uomOptions,
      }])
      return
    }

    const existing = cartItems.findIndex(
      i => i.variant_id === variant.variant_id && i.uom_id === null
    )
    if (existing >= 0) {
      setCartItems(prev => prev.map((item, idx) =>
        idx === existing
          ? { ...item, qty: String((parseFloat(item.qty) || 0) + 1) }
          : item
      ))
    } else {
      setCartItems(prev => [...prev, {
        localId:      uid(),
        variant_id:   variant.variant_id,
        label:        `${productName} — ${variant.variant_name} (${variant.PID})`,
        unit_price:   String(effectivePrice(variant)),
        isPromoPrice: isPromo,
        qty:          '1',
        disc_pct:     '',
        disc_flat:    '',
        uom_id:       null,
        uom_factor:   1,
        uom_label:    '',
        uom_options:  uomOptions,
      }])
    }
  }

  function handleSearchEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const q = search.trim()
    if (!q) return
    const ql = q.toLowerCase()
    for (const catalogItem of catalog) {
      for (const v of catalogItem.variants) {
        const exactBc = v.barcodes.find(b => b.barcode.toLowerCase() === ql)
        if (exactBc) {
          const uomConv = resolveBarcodeUom(v, q)
          addToCart(v, catalogItem.product_brand, uomConv ?? undefined)
          setSearch('')
          return
        }
      }
    }
  }

  function handleUomChange(localId: string, fromUomId: string, variant: POSVariant | undefined) {
    if (!fromUomId) {
      setCartItems(prev => prev.map(i => i.localId === localId ? {
        ...i,
        uom_id:       null,
        uom_factor:   1,
        uom_label:    '',
        isPromoPrice: variant?.promo_price != null,
        unit_price:   String(effectivePrice(variant ?? { promo_price: null, price: null } as POSVariant)),
      } : i))
      return
    }
    const id  = parseInt(fromUomId)
    const opt = variant?.uom_conversions?.find(c => c.from_uom_id === id) ?? null
    if (!opt) return
    setCartItems(prev => prev.map(i => i.localId === localId ? {
      ...i,
      uom_id:       id,
      uom_factor:   opt.factor,
      uom_label:    opt.from_uom_code,
      isPromoPrice: opt.promo_price != null,
      unit_price:   String(uomEffectivePrice(opt)),
    } : i))
  }

  function updateCartItem(localId: string, field: keyof CartItem, value: string) {
    setCartItems(prev => prev.map(i => i.localId === localId ? { ...i, [field]: value } : i))
  }

  function removeCartItem(localId: string) {
    setCartItems(prev => prev.filter(i => i.localId !== localId))
  }

  // ── fill-down helpers ─────────────────────────────────────────────────────
  function fillDown(col: 'pct' | 'flat', fromIdx: number, toIdx: number, value: string) {
    const field = col === 'pct' ? 'disc_pct' : 'disc_flat'
    setCartItems(prev => prev.map((item, i) =>
      i > fromIdx && i <= toIdx ? { ...item, [field]: value } : item
    ))
  }

  function handleFillSingleClick(col: 'pct' | 'flat', rowIdx: number, value: string) {
    if (rowIdx < cartItems.length - 1) fillDown(col, rowIdx, rowIdx + 1, value)
  }

  function handleFillDoubleClick(col: 'pct' | 'flat', rowIdx: number, value: string) {
    fillDown(col, rowIdx, cartItems.length - 1, value)
  }

  function handleDragStart(col: 'pct' | 'flat', fromIdx: number, value: string) {
    dragRef.current = { col, fromIdx, value }
    const stop = () => { dragRef.current = null }
    window.addEventListener('mouseup', stop, { once: true })
  }

  function handleRowMouseEnter(rowIdx: number) {
    const d = dragRef.current
    if (!d || rowIdx <= d.fromIdx) return
    fillDown(d.col, d.fromIdx, rowIdx, d.value)
  }

  // ── draft tray ────────────────────────────────────────────────────────────
  async function loadDraft(draftId: number) {
    if (cartItems.length > 0 && !window.confirm('Replace current cart with this draft?')) return
    try {
      const draft = await salesApi.drafts.get(draftId)
      setActiveDraftId(draftId)
      setCartItems(draft.items.map(i => {
        const catVariant = catalog.flatMap(p => p.variants).find(v => v.variant_id === i.variant_id)
        return {
          localId:      uid(),
          variant_id:   i.variant_id,
          label:        i.variant
            ? `${i.variant.variant_name} (${i.variant.PID})`
            : `Variant ${i.variant_id}`,
          unit_price:   String(i.unit_price),
          isPromoPrice: false,
          qty:          String(i.quantity),
          disc_pct:     i.discount_pct  != null ? String(i.discount_pct)  : '',
          disc_flat:    i.discount_flat != null ? String(i.discount_flat) : '',
          uom_id:       null,
          uom_factor:   1,
          uom_label:    '',
          uom_options:  (catVariant?.uom_conversions ?? []).filter(c => c.price !== null),
        }
      }))
      setCartDiscPct(draft.cart_discount_pct  != null ? String(draft.cart_discount_pct)  : '')
      setCartDiscFlat(draft.cart_discount_flat != null ? String(draft.cart_discount_flat) : '')
      setHeader(h => ({
        ...h,
        registerId: draft.register_id  ? String(draft.register_id)  : h.registerId,
        employeeId: draft.employee_id  ? String(draft.employee_id)  : h.employeeId,
        shiftId:    draft.shift_id     ? String(draft.shift_id)     : h.shiftId,
        receiptNo:  draft.receipt_no   ?? '',
      }))
      setTrayOpen(false)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Failed to load draft', true)
    }
  }

  // ── payload builders ──────────────────────────────────────────────────────
  function resolveEmployeeId(): number | null {
    if (cashieringMode) return myProfile?.employee_id ?? null
    return header.employeeId ? parseInt(header.employeeId) : null
  }

  function buildDraftPayload() {
    return {
      location_id:        parseInt(header.locationId),
      register_id:        header.registerId    ? parseInt(header.registerId)    : null,
      employee_id:        resolveEmployeeId(),
      shift_id:           header.shiftId       ? parseInt(header.shiftId)       : null,
      customer_id:        header.customerId    ? parseInt(header.customerId)    : null,
      origin_sale_id:     header.originSaleId  ? parseInt(header.originSaleId)  : null,
      sale_pid:           header.salePID       || undefined,
      receipt_no:         header.receiptNo     || undefined,
      idempotency_key:    txnKey,
      cart_discount_pct:  cartDiscPct  ? parseFloat(cartDiscPct)  : null,
      cart_discount_flat: cartDiscFlat ? parseFloat(cartDiscFlat) : null,
      discount_amount:    cartDiscountAmt,
      items: cartItems.map(i => ({
        variant_id:    i.variant_id,
        quantity:      parseFloat(i.qty)        || 1,
        unit_price:    parseFloat(i.unit_price) || 0,
        discount_pct:  i.disc_pct  ? parseFloat(i.disc_pct)  : null,
        discount_flat: i.disc_flat ? parseFloat(i.disc_flat) : null,
        uom_id:        i.uom_id     ?? null,
        uom_factor:    i.uom_id     ? i.uom_factor : null,
      })),
    }
  }

  function buildPatchPayload() {
    return {
      register_id:        header.registerId ? parseInt(header.registerId) : null,
      employee_id:        resolveEmployeeId(),
      shift_id:           header.shiftId    ? parseInt(header.shiftId)    : null,
      customer_id:        header.customerId ? parseInt(header.customerId) : null,
      receipt_no:         header.receiptNo  || undefined,
      cart_discount_pct:  cartDiscPct  ? parseFloat(cartDiscPct)  : null,
      cart_discount_flat: cartDiscFlat ? parseFloat(cartDiscFlat) : null,
      discount_amount:    cartDiscountAmt,
      items: cartItems.map(i => ({
        variant_id:    i.variant_id,
        quantity:      parseFloat(i.qty)        || 1,
        unit_price:    parseFloat(i.unit_price) || 0,
        discount_pct:  i.disc_pct  ? parseFloat(i.disc_pct)  : null,
        discount_flat: i.disc_flat ? parseFloat(i.disc_flat) : null,
        uom_id:        i.uom_id     ?? null,
        uom_factor:    i.uom_id     ? i.uom_factor : null,
      })),
    }
  }

  // ── action handlers ───────────────────────────────────────────────────────
  async function handleSaveDraft() {
    if (!header.locationId) { flash('Select a location before saving.', true); return }
    if (cartItems.length === 0) { flash('Cart is empty.', true); return }
    setLoading(true); setError('')
    try {
      let sale: SaleOut
      if (activeDraftId) {
        sale = await salesApi.drafts.patch(activeDraftId, buildPatchPayload())
      } else {
        sale = await salesApi.drafts.create(buildDraftPayload())
      }
      setActiveDraftId(sale.sale_id)
      await refreshDrafts()
      flash('Draft saved.')
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Save failed', true)
    } finally {
      setLoading(false)
    }
  }

  async function handlePost() {
    if (!header.locationId) { flash('Select a location before posting.', true); return }
    if (!header.registerId) { flash('Register is required to post a sale.', true); return }
    if (cartItems.length === 0) { flash('Cart is empty.', true); return }
    if (cashieringMode && (myProfileError || myProfile?.employee_id == null)) {
      flash('Your account is not linked to an employee record. You cannot post sales in cashiering mode. Contact your administrator.', true)
      return
    }
    const validTenders = tenders.filter(t => t.payment_mode_id && parseFloat(t.amount) > 0)
    if (validTenders.length === 0) { flash('Add at least one tender row.', true); return }
    // AR pre-flight validation
    for (const t of validTenders) {
      const mode = paymentModes.find(m => m.payment_mode_id === parseInt(t.payment_mode_id))
      if (mode?.is_ar_charge && !selectedCustomer) {
        flash(`Payment mode "${mode.name}" requires a registered customer.`, true); return
      }
      if (mode?.is_ar_credit) {
        const avail = selectedCustomer && selectedCustomer.outstanding_balance < 0
          ? Math.abs(selectedCustomer.outstanding_balance) : 0
        if ((parseFloat(t.amount) || 0) > avail) {
          flash(`AR Credit amount exceeds available credit (₱${fmt(avail)}).`, true); return
        }
      }
      if (mode?.is_credit_memo) {
        if (!t.memo_code.trim()) {
          flash('Enter a credit memo code before posting.', true); return
        }
        if (t.memo_valid !== true) {
          flash(`Credit memo is invalid: ${t.memo_invalid_reason || 'validate the code first'}.`, true); return
        }
      }
      if (mode?.is_pdc) {
        if (!t.check_number.trim() || !t.check_date.trim() || !t.bank_name.trim()) {
          flash(`PDC payment "${mode.name}" requires check number, check date, and bank name.`, true); return
        }
      }
    }

    setLoading(true); setError('')
    try {
      let draftId = activeDraftId
      if (draftId) {
        await salesApi.drafts.patch(draftId, buildPatchPayload())
      } else {
        const draft = await salesApi.drafts.create(buildDraftPayload())
        draftId = draft.sale_id
      }

      const postPayload = {
        tenders: validTenders.map(t => {
          const mode = paymentModes.find(m => m.payment_mode_id === parseInt(t.payment_mode_id))
          return {
            payment_mode_id:  parseInt(t.payment_mode_id),
            amount:           parseFloat(t.amount),
            reference_number: t.reference_number || undefined,
            ...(mode?.is_pdc ? {
              check_number: t.check_number || undefined,
              check_date:   t.check_date   || undefined,
              bank_name:    t.bank_name    || undefined,
            } : {}),
          }
        }),
        is_cashiering_mode: cashieringMode,
        transaction_date: cashieringMode ? today() : header.saleDate,
      }
      const posted = await salesApi.drafts.post(draftId, postPayload)

      // Invalidate next-pid so useEffect refreshes the PID field for auto mode
      await qc.invalidateQueries({ queryKey: qk.nextSalePid() })

      setCartItems([])
      setCartDiscPct('');  setCartDiscFlat('')
      setTenders([{ localId: uid(), payment_mode_id: cashModePID ? String(cashModePID) : '', amount: '', reference_number: '', memo_code: '', memo_valid: null, memo_invalid_reason: '', check_number: '', check_date: '', bank_name: '' }])
      setActiveDraftId(null)
      setTxnKey(uid())
      clearOriginSale()
      setHeaderField('receiptNo', '')
      await refreshDrafts()
      flash(`Posted ${posted.sale_pid ?? 'sale'} successfully.`)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Post failed', true)
    } finally {
      setLoading(false)
    }
  }

  async function handleVoidDraft() {
    if (!activeDraftId) return
    if (!window.confirm('Void this draft? This cannot be undone.')) return
    setLoading(true)
    try {
      await salesApi.drafts.delete(activeDraftId)
      setCartItems([])
      setCartDiscPct(''); setCartDiscFlat('')
      setTenders([{ localId: uid(), payment_mode_id: cashModePID ? String(cashModePID) : '', amount: '', reference_number: '', memo_code: '', memo_valid: null, memo_invalid_reason: '', check_number: '', check_date: '', bank_name: '' }])
      setActiveDraftId(null)
      clearOriginSale()
      setHeaderField('receiptNo', '')
      await refreshDrafts()
      flash('Draft voided.')
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Void failed', true)
    } finally {
      setLoading(false)
    }
  }

  function handleNew() {
    if (cartItems.length > 0 && !window.confirm('Clear current cart and start a new transaction?')) return
    setCartItems([])
    setCartDiscPct(''); setCartDiscFlat('')
    setTenders([{ localId: uid(), payment_mode_id: cashModePID ? String(cashModePID) : '', amount: '', reference_number: '', memo_code: '', memo_valid: null, memo_invalid_reason: '', check_number: '', check_date: '', bank_name: '' }])
    setActiveDraftId(null)
    setTxnKey(uid())
    clearOriginSale()
    setHeaderField('receiptNo', '')
    setError('')
  }

  // ── tender handlers ───────────────────────────────────────────────────────
  function addTender() {
    setTenders(t => [...t, { localId: uid(), payment_mode_id: '', amount: '', reference_number: '', memo_code: '', memo_valid: null, memo_invalid_reason: '' }])
  }
  function removeTender(localId: string) {
    setTenders(t => t.filter(r => r.localId !== localId))
  }
  function updateTender(localId: string, field: keyof TenderRow, value: string) {
    setTenders(t => t.map(r => r.localId === localId ? { ...r, [field]: value } : r))
  }

  async function validateMemoCode(localId: string, code: string) {
    if (!code.trim()) {
      setTenders(t => t.map(r => r.localId === localId ? { ...r, memo_valid: null, memo_invalid_reason: '' } : r))
      return
    }
    try {
      const result = await salesApi.creditMemos.validate(code.trim())
      if (result.is_valid) {
        setTenders(t => t.map(r => r.localId === localId ? {
          ...r,
          amount: String(Number(result.amount).toFixed(2)),
          reference_number: code.trim(),
          memo_valid: true,
          memo_invalid_reason: '',
        } : r))
      } else {
        const msgs: Record<string, string> = {
          EXPIRED:   'This credit memo has expired',
          CANCELLED: 'This credit memo has been cancelled',
          REDEEMED:  'This credit memo has already been redeemed',
          NOT_FOUND: 'Credit memo not found',
        }
        const msg = msgs[result.invalid_reason ?? ''] ?? 'Invalid credit memo'
        setTenders(t => t.map(r => r.localId === localId ? {
          ...r, memo_valid: false, memo_invalid_reason: msg,
        } : r))
      }
    } catch {
      setTenders(t => t.map(r => r.localId === localId ? {
        ...r, memo_valid: false, memo_invalid_reason: 'Could not validate credit memo',
      } : r))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col t-bg-base overflow-hidden t-text-1">
      <FetchingBar show={refFetching} />

      {/* ── flash banners ── */}
      {error      && <div className="shrink-0 bg-red-950 border-b border-red-900 text-red-400 text-xs font-medium px-4 py-2">{error}</div>}
      {successMsg && <div className="shrink-0 bg-emerald-950 border-b border-emerald-900 text-emerald-400 text-xs font-medium px-4 py-2">{successMsg}</div>}


      {/* ══════════════════════════════════════════════════════════════════
          SESSION HEADER
      ══════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 t-bg-surface border-b t-border px-4 py-2.5 flex items-end gap-4 flex-wrap">

        {/* Mode badge */}
        <div className="flex flex-col gap-1 self-center">
          <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded ${cashieringMode ? 'bg-blue-950 text-blue-400' : 'bg-emerald-950 text-emerald-500'}`}>
            {cashieringMode ? 'Cashiering Mode' : 'Audit Mode'}
          </span>
        </div>

        {/* Sale Date */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Date</span>
          {cashieringMode ? (
            <span className={`${hdrSelect} t-text-2 cursor-default select-none`}>{today()}</span>
          ) : (
            <input type="date" value={header.saleDate}
              onChange={e => setHeaderField('saleDate', e.target.value)}
              className={hdrSelect} />
          )}
        </div>

        {/* Shift */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Shift</span>
          <select value={header.shiftId} onChange={e => setHeaderField('shiftId', e.target.value)} className={hdrSelect}>
            <option value="">—</option>
            {shifts.filter(s => s.is_active).map(s =>
              <option key={s.shift_id} value={s.shift_id}>{s.shift_name}</option>
            )}
          </select>
        </div>

        {/* Location */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Location</span>
          <select value={header.locationId} onChange={e => setHeaderField('locationId', e.target.value)} className={hdrSelect}>
            <option value="">— select —</option>
            {locations.map(l =>
              <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
            )}
          </select>
        </div>

        {/* Register */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">
            Register <span className="text-red-500 normal-case font-bold">*</span>
          </span>
          {regsError ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-red-400">Failed to load</span>
              <button
                onClick={() => qRegs.refetch()}
                className="text-[10px] font-medium underline"
                style={{ color: 'var(--accent)' }}>
                Retry
              </button>
            </div>
          ) : (
            <select value={header.registerId} onChange={e => setHeaderField('registerId', e.target.value)} className={hdrSelect}>
              <option value="">— select —</option>
              {filteredRegisters.map(r =>
                <option key={r.register_id} value={r.register_id}>{r.name}</option>
              )}
            </select>
          )}
          {!regsError && filteredRegisters.length === 0 && header.locationId && !qRegs.isLoading && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] t-text-4">No registers for this location</span>
              <button onClick={() => qRegs.refetch()} className="text-[10px] t-text-3 hover:t-text-1 underline">
                Refresh
              </button>
            </div>
          )}
        </div>

        {/* Cashier */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Cashier</span>
          {cashieringMode ? (
            myProfileError || myProfile?.employee_id == null ? (
              <span className={`${hdrSelect} text-red-400 cursor-default`}>Not linked</span>
            ) : (
              <span className={`${hdrSelect} t-text-2 cursor-default select-none`}>
                {([myProfile.first_name, myProfile.last_name].filter(Boolean).join(' ')) || (user?.username ?? '—')}
              </span>
            )
          ) : (
            <select value={header.employeeId} onChange={e => setHeaderField('employeeId', e.target.value)} className={hdrSelect}>
              <option value="">—</option>
              {employees.map(emp =>
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.first_name} {emp.last_name}
                </option>
              )}
            </select>
          )}
        </div>
        {/* Inline error — cashiering mode but no employee linked */}
        {cashieringMode && (myProfileError || myProfile?.employee_id == null) && (
          <div className="flex flex-col gap-1 self-center">
            <span className="text-[10px] text-red-400 max-w-xs leading-snug">
              {myProfileError
                ? (myProfileErrorObj instanceof Error ? myProfileErrorObj.message : 'Could not load your profile.')
                : 'Your account is not linked to an employee record. You cannot post sales in cashiering mode. Contact your administrator.'}
            </span>
          </div>
        )}

        {/* Customer search */}
        <div className="flex flex-col gap-1 relative">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Customer</span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={customerSearch}
              onChange={e => handleCustomerSearch(e.target.value)}
              placeholder="Walk-in"
              className={`${hdrInput} w-40`}
            />
            {selectedCustomer && (
              <button onClick={clearCustomer} className="t-text-4 hover:t-text-2 text-xs">×</button>
            )}
          </div>
          {customerResults.length > 0 && (
            <div className="absolute top-full left-0 z-50 w-56 t-bg-surface border t-border-strong rounded shadow-xl mt-1 max-h-48 overflow-y-auto">
              {customerResults.map(c => (
                <button key={c.customer_id} onClick={() => selectCustomer(c)}
                  className="w-full text-left px-3 py-1.5 text-xs t-text-1 hover:t-bg-elevated border-b t-border">
                  <span className="font-medium">{c.customer_name}</span>
                  {c.outstanding_balance > 0 && (
                    <span className="ml-2 text-yellow-500 text-[10px]">₱{fmt(c.outstanding_balance)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div className="text-[10px] t-text-3 mt-0.5 whitespace-nowrap space-y-0.5">
              <div>
                Bal:{' '}
                <span className={selectedCustomer.outstanding_balance > 0 ? 'text-yellow-400' : selectedCustomer.outstanding_balance < 0 ? 'text-emerald-400' : 't-text-2'}>
                  ₱{fmt(selectedCustomer.outstanding_balance)}
                </span>
                {selectedCustomer.credit_limit != null && (
                  <span className="ml-2">Limit: ₱{fmt(selectedCustomer.credit_limit)}</span>
                )}
              </div>
              {selectedCustomer.outstanding_balance < 0 && (
                <div className="text-emerald-400 font-medium">
                  ₱{fmt(Math.abs(selectedCustomer.outstanding_balance))} credit available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Origin Sale */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Origin Sale</span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={originSalePid}
              onChange={e => setOriginSalePid(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') resolveOriginSale(originSalePid) }}
              onBlur={() => { if (originSalePid.trim() && !header.originSaleId) resolveOriginSale(originSalePid) }}
              placeholder="SALE-XXXXX"
              className={`${hdrInput} w-28`}
            />
            {header.originSaleId && (
              <button onClick={clearOriginSale} className="t-text-4 hover:t-text-2 text-xs">×</button>
            )}
            {originSaleSearching && <span className="text-[10px] t-text-4 animate-pulse">…</span>}
          </div>
          {header.originSaleId && (
            <div className="text-[10px] text-emerald-400 mt-0.5">✓ linked</div>
          )}
        </div>

        {/* Sale PID */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Sale PID</span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={header.salePID}
              readOnly={header.pidMode === 'auto'}
              onChange={e => setHeaderField('salePID', e.target.value)}
              className={`${hdrSelect} w-28 ${header.pidMode === 'auto' ? 't-text-4 cursor-default' : 't-text-1'}`}
            />
            <button
              onClick={() => setHeaderField('pidMode', header.pidMode === 'auto' ? 'manual' : 'auto')}
              className="text-[10px] text-blue-500 hover:text-blue-400 font-medium uppercase tracking-wide transition-colors"
            >
              {header.pidMode === 'auto' ? 'Auto' : 'Manual'}
            </button>
          </div>
        </div>

        {/* Receipt No. */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Receipt No.</span>
          <input
            type="text"
            value={header.receiptNo}
            onChange={e => setHeaderField('receiptNo', e.target.value)}
            placeholder="optional"
            className={`${hdrInput} w-28`}
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TWO-PANEL BODY
      ══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex min-h-0">

        {/* ── LEFT PANEL — Item Search ── */}
        <div className="w-72 shrink-0 flex flex-col border-r t-border t-bg-surface">
          <div className="p-3 border-b t-border flex flex-col gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchEnter}
              placeholder="Scan barcode or exact PID…"
              className="w-full t-bg-input border t-border-strong rounded px-3 py-1.5 text-sm t-text-1
                         placeholder:t-text-3 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors"
            />
            <div>
              <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Keyword Filter</span>
              <KeywordSearch tags={filterTags} onTagsChange={handleFilterTagsChange}
                onPartialChange={handleFilterPartialChange}
                placeholder="Brand, name, PID, SKU…" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredResults.length === 0 && (search.trim() || filterTerms.length > 0) && (
              <p className="text-xs t-text-3 text-center mt-8 px-4">No results{search.trim() ? ` for "${search}"` : ''}</p>
            )}
            {filteredResults.length === 0 && !search.trim() && filterTerms.length === 0 && (
              <p className="text-xs t-text-4 text-center mt-8">Type to search the catalog</p>
            )}
            {filteredResults.map(({ item, variant }) => {
              const isPromo = variant.promo_price != null
              return (
                <button
                  key={variant.variant_id}
                  onClick={() => addToCart(variant, item.product_brand)}
                  className="w-full text-left px-3 py-2.5 border-b t-border hover:t-bg-elevated transition-colors"
                >
                  <p className="text-xs font-semibold t-text-1 leading-snug">{item.product_brand}</p>
                  <p className="text-xs t-text-2">{variant.variant_name}</p>
                  <p className="text-[10px] t-text-3 font-mono tracking-wide">{variant.PID}</p>
                  {isPromo ? (
                    <p className="text-sm font-bold mt-0.5 tabular-nums">
                      <span className="line-through text-xs text-gray-600 font-normal mr-1.5">₱{fmt(variant.price ?? 0)}</span>
                      <span className="text-red-400">₱{fmt(variant.promo_price!)}</span>
                    </p>
                  ) : (
                    <p className="text-sm font-bold mt-0.5 tabular-nums text-blue-400">₱{fmt(variant.price ?? 0)}</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="flex-1 flex flex-col overflow-y-auto">

          {/* ── BASKET GRID ── */}
          <div className="flex-1">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="t-bg-elevated border-b t-border-strong sticky top-0 z-10">
                  <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3 w-auto">Item</th>
                  <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3 w-28">Unit Price</th>
                  <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3 w-20">Qty</th>
                  <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3 w-24">Disc %</th>
                  <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3 w-24">Disc ₱</th>
                  <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3 w-28">Line Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {cartItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-xs t-text-4 py-12">
                      Search for items on the left and click to add them.
                    </td>
                  </tr>
                )}
                {cartItems.map((item, rowIdx) => (
                  <tr
                    key={item.localId}
                    onMouseEnter={() => handleRowMouseEnter(rowIdx)}
                    className="border-b t-border hover:t-bg-surface group t-bg-base"
                  >
                    {/* Item label + UOM selector */}
                    <td className="px-3 py-1.5 t-text-2 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{item.label}</span>
                        {item.uom_options.length > 0 && (
                          <select
                            value={item.uom_id ?? ''}
                            onChange={e => handleUomChange(item.localId, e.target.value, catalogVariantMap.get(item.variant_id))}
                            className="text-[10px] t-bg-input border t-border-strong rounded px-1.5 py-0.5 text-blue-400
                                       focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors"
                            title="Select selling unit"
                          >
                            <option value="">Base unit</option>
                            {item.uom_options.map(opt => (
                              <option key={opt.from_uom_id} value={opt.from_uom_id}>
                                {opt.from_uom_code} — ₱{fmt(uomEffectivePrice(opt))}
                                {opt.promo_price != null ? ' (promo)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {item.uom_id !== null && (
                          <span className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>
                            × {item.uom_factor} base units/ea
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Unit price — visually highlighted when promo */}
                    <td className={`px-3 py-1.5 ${item.isPromoPrice ? 'bg-red-950/40' : ''}`}>
                      {item.isPromoPrice && (
                        <span className="block text-[9px] text-red-400/70 text-right uppercase tracking-wide leading-none mb-0.5">promo</span>
                      )}
                      <input type="number" min="0" step="0.01"
                        value={item.unit_price}
                        onChange={e => updateCartItem(item.localId, 'unit_price', e.target.value)}
                        onFocus={onFocusSelect}
                        className={`${cellInput} ${item.isPromoPrice ? 'text-red-400' : ''}`} />
                    </td>

                    {/* Qty */}
                    <td className="px-3 py-1.5">
                      <input type="number" min="0" step="any"
                        value={item.qty}
                        onChange={e => updateCartItem(item.localId, 'qty', e.target.value)}
                        onFocus={onFocusSelect}
                        className={cellInput} />
                    </td>

                    {/* Disc % with fill handle */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" max="100" step="0.01"
                          value={item.disc_pct}
                          onChange={e => updateCartItem(item.localId, 'disc_pct', e.target.value)}
                          onFocus={onFocusSelect}
                          className={cellInput}
                          placeholder="—" />
                        {item.disc_pct !== '' && (
                          <span
                            className="shrink-0 cursor-ns-resize select-none t-text-4 hover:t-text-1 text-[10px] transition-colors"
                            title="Single-click: fill next row · Double-click: fill all below · Drag: fill to row"
                            onClick={() => handleFillSingleClick('pct', rowIdx, item.disc_pct)}
                            onDoubleClick={e => { e.preventDefault(); handleFillDoubleClick('pct', rowIdx, item.disc_pct) }}
                            onMouseDown={e => { e.preventDefault(); handleDragStart('pct', rowIdx, item.disc_pct) }}
                          >▼</span>
                        )}
                      </div>
                    </td>

                    {/* Disc ₱ with fill handle */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" step="0.01"
                          value={item.disc_flat}
                          onChange={e => updateCartItem(item.localId, 'disc_flat', e.target.value)}
                          onFocus={onFocusSelect}
                          className={cellInput}
                          placeholder="—" />
                        {item.disc_flat !== '' && (
                          <span
                            className="shrink-0 cursor-ns-resize select-none t-text-4 hover:t-text-1 text-[10px] transition-colors"
                            title="Single-click: fill next row · Double-click: fill all below · Drag: fill to row"
                            onClick={() => handleFillSingleClick('flat', rowIdx, item.disc_flat)}
                            onDoubleClick={e => { e.preventDefault(); handleFillDoubleClick('flat', rowIdx, item.disc_flat) }}
                            onMouseDown={e => { e.preventDefault(); handleDragStart('flat', rowIdx, item.disc_flat) }}
                          >▼</span>
                        )}
                      </div>
                    </td>

                    {/* Line total */}
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold t-text-1">
                      ₱{fmt(calcLineTotal(item))}
                    </td>

                    {/* Delete */}
                    <td className="px-1 py-1.5 text-center">
                      <button
                        onClick={() => removeCartItem(item.localId)}
                        className="opacity-0 group-hover:opacity-100 t-text-4 hover:text-red-500 transition-all text-base leading-none"
                      >×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── CART FOOTER ── */}
          <div className="shrink-0 border-t t-border t-bg-surface px-4 py-3">
            <div className="max-w-xs ml-auto space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Subtotal</span>
                <span className="tabular-nums t-text-2">₱{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Cart Disc %</span>
                <input type="number" min="0" max="100" step="0.01"
                  value={cartDiscPct}
                  onChange={e => setCartDiscPct(e.target.value)}
                  onFocus={onFocusSelect}
                  placeholder="0"
                  className="w-20 text-right text-xs t-bg-input border t-border-strong rounded px-2 py-0.5 t-text-1
                             focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-widest t-text-3">Cart Disc ₱</span>
                <input type="number" min="0" step="0.01"
                  value={cartDiscFlat}
                  onChange={e => setCartDiscFlat(e.target.value)}
                  onFocus={onFocusSelect}
                  placeholder="0.00"
                  className="w-20 text-right text-xs t-bg-input border t-border-strong rounded px-2 py-0.5 t-text-1
                             focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors" />
              </div>
              {cartDiscountAmt > 0 && (
                <div className="flex justify-between text-[10px] uppercase tracking-widest">
                  <span className="t-text-3">Discount</span>
                  <span className="tabular-nums text-red-500 font-medium">−₱{fmt(cartDiscountAmt)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t t-border pt-1.5 mt-1.5">
                <span className="text-[10px] uppercase tracking-widest t-text-2 self-center">Grand Total</span>
                <span className="tabular-nums text-lg t-text-1">₱{fmt(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* ── TENDER SECTION ── */}
          <div className="shrink-0 border-t t-border t-bg-surface px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-widest t-text-3 mb-2">Payment Tender</p>
            <div className="space-y-1.5">
              {tenders.map(row => {
                const mode = paymentModes.find(m => m.payment_mode_id === parseInt(row.payment_mode_id))
                const showRef   = mode != null && mode.is_physical === false
                const hasCustomer = !!selectedCustomer
                const availableCredit = selectedCustomer && selectedCustomer.outstanding_balance < 0
                  ? Math.abs(selectedCustomer.outstanding_balance)
                  : 0
                // AR Charge requires a customer
                const arChargeError = mode?.is_ar_charge && !hasCustomer
                  ? 'AR Charge requires a registered customer'
                  : null
                // AR Credit amount must not exceed available credit
                const arCreditAmt = parseFloat(row.amount) || 0
                const arCreditError = mode?.is_ar_credit && arCreditAmt > availableCredit && arCreditAmt > 0
                  ? `Exceeds available credit (₱${fmt(availableCredit)})`
                  : null
                // Only show AR Credit modes when customer is selected
                const visibleModes = paymentModes.filter(m =>
                  !m.is_ar_credit || hasCustomer
                )
                const memoLocked = mode?.is_credit_memo && row.memo_valid === true
                return (
                  <div key={row.localId} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.payment_mode_id}
                        onChange={e => {
                          const newModeId = e.target.value
                          setTenders(t => t.map(r => r.localId === row.localId ? {
                            ...r, payment_mode_id: newModeId, memo_code: '', memo_valid: null, memo_invalid_reason: '',
                          } : r))
                        }}
                        className="flex-none w-32 t-bg-input border t-border-strong rounded px-2 py-1 text-xs t-text-1
                                   focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors"
                      >
                        <option value="">— mode —</option>
                        {visibleModes.map(m =>
                          <option key={m.payment_mode_id} value={m.payment_mode_id}>{m.name}</option>
                        )}
                      </select>
                      {mode?.is_credit_memo && (
                        <input type="text"
                          value={row.memo_code}
                          onChange={e => updateTender(row.localId, 'memo_code', e.target.value)}
                          onBlur={e => validateMemoCode(row.localId, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') validateMemoCode(row.localId, row.memo_code) }}
                          placeholder="CM-XXXXXX"
                          className={`w-28 t-bg-input border rounded px-2 py-1 text-xs font-mono t-text-1
                                     focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors
                                     ${row.memo_valid === false ? 'border-red-500' : row.memo_valid === true ? 'border-green-500' : 't-border-strong'}`} />
                      )}
                      <input type="number" min="0" step="0.01"
                        value={row.amount}
                        readOnly={memoLocked}
                        onChange={e => !memoLocked && updateTender(row.localId, 'amount', e.target.value)}
                        onFocus={onFocusSelect}
                        placeholder="0.00"
                        className={`w-24 text-right t-bg-input border rounded px-2 py-1 text-xs t-text-1
                                   focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors
                                   ${arCreditError ? 'border-red-500' : memoLocked ? 't-border opacity-60 cursor-not-allowed' : 't-border-strong'}`} />
                      {mode?.is_ar_credit && availableCredit > 0 && (
                        <span className="text-[10px] text-emerald-400">max ₱{fmt(availableCredit)}</span>
                      )}
                      {showRef && !mode?.is_credit_memo && !mode?.is_pdc && (
                        <input type="text"
                          value={row.reference_number}
                          onChange={e => updateTender(row.localId, 'reference_number', e.target.value)}
                          placeholder="Ref # (GCash, card, transfer…)"
                          className="flex-1 t-bg-input border t-border-strong rounded px-2 py-1 text-xs t-text-1
                                     placeholder:t-text-4 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors" />
                      )}
                      {mode?.is_pdc && (
                        <>
                          <input type="text"
                            value={row.check_number}
                            onChange={e => updateTender(row.localId, 'check_number', e.target.value)}
                            placeholder="Check #"
                            className="w-24 t-bg-input border t-border-strong rounded px-2 py-1 text-xs t-text-1
                                       placeholder:t-text-4 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors" />
                          <input type="date"
                            value={row.check_date}
                            onChange={e => updateTender(row.localId, 'check_date', e.target.value)}
                            className="w-32 t-bg-input border t-border-strong rounded px-2 py-1 text-xs t-text-1
                                       focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors" />
                          <input type="text"
                            value={row.bank_name}
                            onChange={e => updateTender(row.localId, 'bank_name', e.target.value)}
                            placeholder="Bank"
                            className="flex-1 t-bg-input border t-border-strong rounded px-2 py-1 text-xs t-text-1
                                       placeholder:t-text-4 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors" />
                        </>
                      )}
                      {tenders.length > 1 && (
                        <button onClick={() => removeTender(row.localId)}
                          className="t-text-4 hover:text-red-500 text-base leading-none transition-colors">×</button>
                      )}
                    </div>
                    {arChargeError && <p className="text-[10px] text-red-400 pl-1">{arChargeError}</p>}
                    {arCreditError && <p className="text-[10px] text-red-400 pl-1">{arCreditError}</p>}
                    {mode?.is_credit_memo && row.memo_valid === false && (
                      <p className="text-[10px] text-red-400 pl-1">{row.memo_invalid_reason}</p>
                    )}
                    {mode?.is_credit_memo && row.memo_valid === true && (
                      <p className="text-[10px] text-emerald-400 pl-1">Valid — amount auto-filled</p>
                    )}
                  </div>
                )
              })}
            </div>
            <button onClick={addTender}
              className="mt-2 text-[10px] uppercase tracking-widest font-medium transition-colors"
              style={{ color: 'var(--accent)' }}>
              + Add tender row
            </button>
            <div className="mt-2.5 space-y-1 border-t t-border pt-2.5">
              <div className="flex justify-between text-xs">
                <span className="text-[10px] uppercase tracking-widest t-text-3">Total Tendered</span>
                <span className="tabular-nums font-medium t-text-1">₱{fmt(totalTendered)}</span>
              </div>

              {tenderDelta > 0.005 && (
                <div className="flex justify-between text-sm font-bold text-emerald-400">
                  <span className="text-[10px] uppercase tracking-widest self-center">Change Due</span>
                  <span className="tabular-nums">₱{fmt(tenderDelta)}</span>
                </div>
              )}
              {tenderDelta < -0.005 && (
                <div className="flex justify-between text-sm font-bold text-red-400">
                  <span className="text-[10px] uppercase tracking-widest self-center">Balance Due</span>
                  <span className="tabular-nums">₱{fmt(-tenderDelta)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── ACTION BUTTONS ── */}
          <div className="shrink-0 border-t t-border t-bg-surface px-4 py-3 flex items-center gap-2">
            <button onClick={handleSaveDraft} disabled={loading}
              className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide rounded border t-border
                         t-bg-elevated hover:opacity-80 t-text-1 disabled:opacity-40 transition-colors">
              Save Draft
            </button>
            <button onClick={handlePost} disabled={loading}
              className="px-5 py-1.5 text-xs font-bold uppercase tracking-wide rounded text-white disabled:opacity-40 transition-colors"
              style={{ backgroundColor: 'var(--accent)' }}>
              Post
            </button>
            {activeDraftId && (
              <button onClick={handleVoidDraft} disabled={loading}
                className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide rounded border border-red-900
                           text-red-500 hover:bg-red-950 disabled:opacity-40 transition-colors">
                Void Draft
              </button>
            )}
            <button onClick={handleNew} disabled={loading}
              className="ml-auto px-4 py-1.5 text-xs font-medium uppercase tracking-wide rounded border t-border
                         t-text-3 hover:t-text-1 hover:t-border-strong disabled:opacity-40 transition-colors">
              New
            </button>
            <button
              onClick={() => { setTrayOpen(o => !o); if (!trayOpen) refreshDrafts() }}
              className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide rounded border t-border
                         t-text-2 hover:t-text-1 hover:t-border-strong transition-colors relative"
            >
              Drafts
              {drafts.length > 0 && (
                <span className="ml-1 bg-blue-900 text-blue-400 text-[10px] rounded-full px-1.5 font-bold">{drafts.length}</span>
              )}
            </button>
          </div>

          {/* ── DRAFT TRAY ── */}
          {trayOpen && (
            <div className="shrink-0 border-t t-border t-bg-base px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-widest t-text-3 mb-2">Recent Drafts</p>
              {drafts.length === 0 && (
                <p className="text-xs t-text-4">No open drafts.</p>
              )}
              <div className="space-y-1.5">
                {drafts.map(d => (
                  <button
                    key={d.sale_id}
                    onClick={() => loadDraft(d.sale_id)}
                    className={`w-full text-left flex items-center justify-between px-3 py-2 rounded border text-xs
                      transition-colors ${
                        activeDraftId === d.sale_id
                          ? 'border-blue-700 bg-blue-950 text-blue-300'
                          : 't-border t-bg-surface t-text-2 hover:t-bg-elevated hover:t-border-strong'
                      }`}
                  >
                    <span className="font-semibold t-text-1">{d.sale_pid ?? 'Unsaved'}</span>
                    <span className="t-text-3">{d.items.length} item{d.items.length !== 1 ? 's' : ''}</span>
                    <span className="tabular-nums t-text-2 font-medium">₱{fmt(d.grand_total)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>{/* end right panel */}
      </div>{/* end two-panel */}
    </div>
  )
}
