const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

// ── core fetch wrapper ────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = localStorage.getItem('erp_token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    throw new Error('Session expired. Please sign in again.')
  }

  if (!res.ok) {
    let detail: unknown = res.statusText
    try { detail = (await res.json()).detail } catch { /* ignore */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const get  = <T>(path: string)                => request<T>('GET',    path)
const post = <T>(path: string, body?: unknown) => request<T>('POST',   path, body)
const patch= <T>(path: string, body?: unknown) => request<T>('PATCH',  path, body)
const del  = <T>(path: string)                => request<T>('DELETE', path)

// ── AUTH ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface RoleEntry {
  role_id: number
  role_name: string
  user_count?: number
}

export interface EmployeeOut {
  employee_id: number
  first_name: string
  last_name: string
  is_active: boolean
  has_user: boolean
}

export interface EmployeeCreate {
  first_name: string
  last_name: string
}

export interface EmployeePatch {
  first_name?: string
  last_name?: string
  is_active?: boolean
}

export interface UserCreate {
  employee_id?: number
  first_name?: string
  last_name?: string
  username: string
  password: string
  role_names?: string[]
}

// ── RBAC types ────────────────────────────────────────────────────────────────

export interface ActionEntry {
  action_id:    number
  action_key:   string
  display_name: string
}

export interface ProgramEntry {
  program_id:   number
  program_key:  string
  display_name: string
  sort_order:   number
  actions:      ActionEntry[]
}

export interface ModuleGroup {
  module:   string
  programs: ProgramEntry[]
}

export interface RolePermissions {
  program_keys: string[]
  action_keys:  string[]
}

export interface UserProgramsOut {
  program_keys: string[]
  action_keys:  string[]
}

export interface UserProfileOut {
  user_id:     number
  username:    string
  employee_id: number | null
  first_name:  string | null
  last_name:   string | null
}

export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>('POST', '/auth/login', { username, password }, false),
  me: {
    programs: () => get<UserProgramsOut>('/auth/me/programs'),
    profile:  () => get<UserProfileOut>('/auth/me'),
  },
  users: {
    allActive: () => get<UserEntry[]>('/auth/users/all'),       // active only — for dropdowns
    all:       () => get<UserEntry[]>('/auth/users'),           // active + inactive — for Settings
    register:  (payload: UserCreate) => post<UserEntry>('/auth/register', payload),
    setActive: (id: number, is_active: boolean) =>
      patch<UserEntry>(`/auth/users/${id}/active`, { is_active }),
    setRoles: (id: number, role_names: string[]) =>
      request<UserEntry>('PUT', `/auth/users/${id}/roles`, { role_names }),
    changePassword: (id: number, new_password: string) =>
      patch<void>(`/auth/users/${id}/password`, { new_password }),
  },
  employees: {
    list:        ()                              => get<EmployeeOut[]>('/auth/employees'),
    withoutUser: ()                              => get<EmployeeOut[]>('/auth/employees/without-user'),
    create: (payload: EmployeeCreate)            => post<EmployeeOut>('/auth/employees', payload),
    patch:  (id: number, payload: EmployeePatch) =>
      patch<EmployeeOut>(`/auth/employees/${id}`, payload),
  },
  roles: {
    list:   ()                              => get<RoleEntry[]>('/auth/roles'),
    create: (role_name: string)             => post<RoleEntry>('/auth/roles', { role_name }),
    patch:  (id: number, role_name: string) => patch<RoleEntry>(`/auth/roles/${id}`, { role_name }),
    delete: (id: number)                    => del<void>(`/auth/roles/${id}`),
    getPermissions:  (id: number)                    => get<RolePermissions>(`/auth/roles/${id}/permissions`),
    setPermissions:  (id: number, payload: RolePermissions) =>
      request<RolePermissions>('PUT', `/auth/roles/${id}/permissions`, payload),
  },
  programs: {
    list: () => get<ModuleGroup[]>('/auth/programs'),
  },
}

// ── SHARED REFERENCE TYPES ───────────────────────────────────────────────────

export interface Shift {
  shift_id: number
  shift_name: string
  is_active: boolean
}

export interface PaymentMode {
  payment_mode_id: number
  name: string
  is_physical: boolean
  is_active: boolean
  is_ar_charge: boolean
  is_ar_credit: boolean
  is_credit_memo: boolean
  is_pdc: boolean
  is_cash: boolean
}

export interface CashRegister {
  register_id: number
  name: string
  location_id: number
  is_active: boolean
}

export interface Location {
  location_id: number
  location_name: string
  location_type: string
  status: string
  is_system: boolean
  is_deleted: boolean
}

export interface Employee {
  employee_id: number
  first_name: string
  last_name: string
  is_active: boolean
}

export interface UserEntry {
  user_id: number
  username: string
  is_active: boolean
  employee: Employee
  roles: Array<{ role_id: number; role_name: string }>
}

// ── POS CATALOG TYPES ─────────────────────────────────────────────────────────

export interface VariantBarcode {
  barcode_id: number
  variant_id: number
  barcode: string
  uom_id: number | null
  is_primary: boolean | null
}

export interface POSStockEntry {
  location_id: number
  location_name: string
  quantity: number
}

export interface POSUomOption {
  from_uom_id: number
  from_uom_code: string
  to_uom_id: number
  to_uom_code: string
  factor: number
  price: number | null
  promo_price: number | null
}

export interface POSVariant {
  variant_id: number
  PID: string
  variant_name: string
  sku?: string | null
  price: number | null
  promo_price: number | null
  attributes: Record<string, unknown> | null
  barcodes: VariantBarcode[]
  stock: POSStockEntry[]
  uom_conversions: POSUomOption[]
}

export interface POSCatalogItem {
  product_id: number
  product_brand: string
  product_type: string
  variants: POSVariant[]
}

// ── SALE TYPES ────────────────────────────────────────────────────────────────

export interface SaleLineItemIn {
  variant_id: number
  quantity: number      // qty in selected UOM; backend converts to base units
  unit_price: number    // price in selected UOM
  discount_pct?: number | null
  discount_flat?: number | null
  uom_id?: number | null
  uom_factor?: number | null
}

export interface SaleCreate {
  location_id: number
  register_id?: number | null
  employee_id?: number | null
  shift_id?: number | null
  sale_pid?: string
  idempotency_key?: string
  receipt_no?: string | null
  cart_discount_pct?: number | null
  cart_discount_flat?: number | null
  discount_amount?: number
  receipt_grand_total?: number | null
  items: SaleLineItemIn[]
}

export interface SalePatch {
  register_id?: number | null
  employee_id?: number | null
  shift_id?: number | null
  receipt_no?: string | null
  cart_discount_pct?: number | null
  cart_discount_flat?: number | null
  discount_amount?: number | null
  receipt_grand_total?: number | null
  items?: SaleLineItemIn[]
}

export interface SaleTenderIn {
  payment_mode_id: number
  amount: number
  reference_number?: string
  check_number?: string
  check_date?: string
  bank_name?: string
}

export interface SalePostRequest {
  tenders: SaleTenderIn[]
  is_cashiering_mode?: boolean
  transaction_date?: string
}

export interface SaleItemOut {
  sale_item_id: number
  sale_id: number
  variant_id: number
  cost_layer_id: number | null
  quantity: number
  unit_price: number
  discount_pct: number | null
  discount_flat: number | null
  line_total: number
  gross_cost: number | null
  supplier_discount: number | null
  net_unit_cost: number | null
  cost_source: string | null
  variant?: { variant_id: number; PID: string; variant_name: string; sku?: string | null; product_brand?: string | null; product_type?: string | null }
  already_returned?: number  // set by /sale/:id/items-for-return
}

export interface CustomerPaymentOut {
  payment_id: number
  customer_id: number | null
  payment_mode_id: number
  amount: number
  payment_date: string | null
  reference_number: string | null
  notes: string | null
  unapplied_amount: number
  applications: { apply_id: number; payment_id: number; sale_id: number; amount_applied: number; applied_at: string }[]
  payment_mode_name: string | null
  payment_mode_is_physical: boolean | null
  check_number: string | null
  check_date: string | null
  bank_name: string | null
  check_status: string | null
}

export interface ArLedgerOut {
  ar_ledger_id: number
  customer_id: number | null
  amount_change: number
  reason: string
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  occurred_at: string | null
}

export interface CustomerARLedgerRowOut {
  sale_id:          number
  sale_pid:         string
  customer_id:      number
  customer_name:    string
  transaction_date: string  // "YYYY-MM-DD"
  due_date:         string  // "YYYY-MM-DD"
  grand_total:      number
  balance_due:      number
  status:           string  // Open | Partial | Paid | Overdue
}

export interface ARLedgerPaymentRowOut {
  payment_id:       number
  payment_date:     string  // "YYYY-MM-DD"
  payment_mode:     string
  reference_number: string | null
  amount_applied:   number
}

export interface CustomerAgingOut {
  customer_id:   number
  customer_name: string
  invoice_id:    number
  invoice_date:  string   // "YYYY-MM-DD"
  due_date:      string   // "YYYY-MM-DD"
  current_amt:   number
  days_1_30:     number
  days_31_60:    number
  days_61_90:    number
  days_91_plus:  number
}

export interface CustomerOut {
  customer_id: number
  customer_name: string
  credit_limit: number | null
  terms_days: number
  outstanding_balance: number
  is_deleted: boolean
  has_bounced_check: boolean
  is_overdue: boolean
}

export interface PDCEntryOut {
  payment_id:          number
  customer_id:         number
  customer_name:       string
  check_number:        string
  check_date:          string   // "YYYY-MM-DD"
  bank_name:           string
  check_status:        string   // IN_VAULT | DEPOSITED | BOUNCED
  amount:              number
  payment_date:        string | null
  days_until_maturity: number
  sale_ids:            number[]
  sale_refs:           string[]
}

export interface PDCMaturitySummary {
  maturing_today:       number
  maturing_next_7_days: number
  total_uncleared:      number
  total_overdue:        number
}

export interface PDCMaturityResponse {
  summary: PDCMaturitySummary
  entries: PDCEntryOut[]
}

export interface SaleOut {
  sale_id: number
  sale_pid: string | null
  transaction_date: string | null
  posted_at: string | null
  location_id: number
  register_id: number | null
  customer_id: number | null
  employee_id: number | null
  shift_id: number | null
  origin_sale_id: number | null
  created_by_user_id: number | null
  subtotal_amount: number
  cart_discount_pct: number | null
  cart_discount_flat: number | null
  discount_amount: number
  tax_amount: number
  grand_total: number
  receipt_grand_total: number | null
  audit_variance: number | null
  due_date: string | null
  payment_status: string
  balance_due: number
  status: string
  voided_at: string | null
  void_reason: string | null
  idempotency_key: string | null
  receipt_no: string | null
  non_merchandise_revenue: number
  items: SaleItemOut[]
  payments: CustomerPaymentOut[]
  row_type: string          // 'sale' | 'return'
  return_id: number | null  // set when row_type === 'return'
}

export interface SaleTotals {
  count: number
  subtotal: number
  discount: number
  grand_total: number
  receipt_total: number | null
  variance: number | null
}

export interface CollectionEntry {
  payment_mode: string
  amount:       number
  is_physical:  boolean
}

export interface SalesSummaryResponse {
  merchandise_gross:       number
  cart_discounts:          number
  non_merchandise_revenue: number
  variances:               number
  returns_total:           number
  total_revenue:           number
  gross_profit:            number
  uncosted_revenue:        number
  collections:             CollectionEntry[]
  total_physical:          number
  total_virtual:           number
  total_collected:         number
}

export interface SalesListResponse {
  items: SaleOut[]
  totals: SaleTotals
  next_cursor: number | null
}

// ── SETTINGS CRUD TYPES ───────────────────────────────────────────────────────

export interface LocationCreate {
  location_name: string
  location_type: string
  parent_location_id?: number | null
  address?: string | null
}

export interface LocationUpdate {
  location_name?: string
  location_type?: string
  status?: string
  address?: string | null
  parent_location_id?: number | null
}

export interface ShiftCreate  { shift_name: string; is_active?: boolean }
export interface ShiftPatch   { shift_name?: string; is_active?: boolean }

export interface RegisterCreate { name: string; location_id: number; is_active?: boolean }
export interface RegisterPatch  { name?: string; location_id?: number; is_active?: boolean }

export interface PaymentModeCreate { name: string; is_physical?: boolean; is_active?: boolean; is_ar_charge?: boolean; is_ar_credit?: boolean; is_credit_memo?: boolean; is_pdc?: boolean; is_cash?: boolean }
export interface PaymentModePatch  { name?: string; is_physical?: boolean; is_active?: boolean; is_ar_charge?: boolean; is_ar_credit?: boolean; is_credit_memo?: boolean; is_pdc?: boolean; is_cash?: boolean }

// ── SALES API ─────────────────────────────────────────────────────────────────

export const salesApi = {
  shifts: {
    list:   ()                                  => get<Shift[]>('/sales/shifts'),
    create: (p: ShiftCreate)                    => post<Shift>('/sales/shifts', p),
    patch:  (id: number, p: ShiftPatch)         => patch<Shift>(`/sales/shifts/${id}`, p),
  },
  paymentModes: {
    list:   ()                                  => get<PaymentMode[]>('/sales/payment-modes'),
    create: (p: PaymentModeCreate)              => post<PaymentMode>('/sales/payment-modes', p),
    patch:  (id: number, p: PaymentModePatch)   => patch<PaymentMode>(`/sales/payment-modes/${id}`, p),
  },
  registers: {
    list:   ()                                  => get<CashRegister[]>('/sales/registers'),
    create: (p: RegisterCreate)                 => post<CashRegister>('/sales/registers', p),
    patch:  (id: number, p: RegisterPatch)      => patch<CashRegister>(`/sales/registers/${id}`, p),
  },
  drafts: {
    create:  (payload: SaleCreate)            => post<SaleOut>('/sales/drafts', payload),
    list:    (locationId?: number)            => get<SaleOut[]>(`/sales/drafts${locationId ? `?location_id=${locationId}` : ''}`),
    get:     (id: number)                     => get<SaleOut>(`/sales/drafts/${id}`),
    patch:   (id: number, payload: SalePatch) => patch<SaleOut>(`/sales/drafts/${id}`, payload),
    delete:  (id: number)                     => del<void>(`/sales/drafts/${id}`),
    post:    (id: number, payload: SalePostRequest) => post<SaleOut>(`/sales/drafts/${id}/post`, payload),
  },
  sales: {
    list: (params?: {
      search?: string
      date_from?: string
      date_to?: string
      location_id?: number
      shift_id?: number
      register_id?: number
      employee_id?: number
      customer_id?: number
      payment_status?: string
      status?: string
      has_variance?: boolean
      has_uncosted?: boolean
      cursor?: number
      limit?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.search)         q.set('search',          params.search)
      if (params?.date_from)      q.set('date_from',       params.date_from)
      if (params?.date_to)        q.set('date_to',         params.date_to)
      if (params?.location_id)    q.set('location_id',     String(params.location_id))
      if (params?.shift_id)       q.set('shift_id',        String(params.shift_id))
      if (params?.register_id)    q.set('register_id',     String(params.register_id))
      if (params?.employee_id)    q.set('employee_id',     String(params.employee_id))
      if (params?.customer_id)    q.set('customer_id',     String(params.customer_id))
      if (params?.payment_status) q.set('payment_status',  params.payment_status)
      if (params?.status)         q.set('status',          params.status)
      if (params?.has_variance)   q.set('has_variance',    'true')
      if (params?.has_uncosted)   q.set('has_uncosted',    'true')
      if (params?.cursor)         q.set('cursor',          String(params.cursor))
      if (params?.limit)          q.set('limit',           String(params.limit))
      const qs = q.toString()
      return get<SalesListResponse>(`/sales/${qs ? '?' + qs : ''}`)
    },
    get:     (id: number)                              => get<SaleOut>(`/sales/${id}`),
    items:   (id: number)                              => get<SaleItemOut[]>(`/sales/${id}/items`),
    void:    (id: number, void_reason: string)         => post<SaleOut>(`/sales/${id}/void`, { void_reason }),
    nextPid: ()                                        => get<{ next_pid: string }>('/sales/next-pid'),
    summary: (params?: {
      date_from?: string; date_to?: string
      location_id?: number; shift_id?: number; register_id?: number
      employee_id?: number; customer_id?: number; status?: string
    }) => {
      const q = new URLSearchParams()
      if (params?.date_from)    q.set('date_from',   params.date_from)
      if (params?.date_to)      q.set('date_to',     params.date_to)
      if (params?.location_id)  q.set('location_id', String(params.location_id))
      if (params?.shift_id)     q.set('shift_id',    String(params.shift_id))
      if (params?.register_id)  q.set('register_id', String(params.register_id))
      if (params?.employee_id)  q.set('employee_id', String(params.employee_id))
      if (params?.customer_id)  q.set('customer_id', String(params.customer_id))
      if (params?.status)       q.set('status',      params.status)
      const qs = q.toString()
      return get<SalesSummaryResponse>(`/sales/summary${qs ? '?' + qs : ''}`)
    },
  },
  customers: {
    list:    (params?: { search?: string; include_deleted?: boolean }) => {
      const q = new URLSearchParams()
      if (params?.search)           q.set('search',          params.search)
      if (params?.include_deleted)  q.set('include_deleted', 'true')
      const qs = q.toString()
      return get<CustomerOut[]>(`/sales/customers${qs ? '?' + qs : ''}`)
    },
    get:     (id: number)                                         => get<CustomerOut>(`/sales/customers/${id}`),
    create:  (p: { customer_name: string; credit_limit?: number | null; terms_days?: number }) =>
               post<CustomerOut>('/sales/customers', p),
    patch:   (id: number, p: { customer_name?: string; credit_limit?: number | null; terms_days?: number }) =>
               patch<CustomerOut>(`/sales/customers/${id}`, p),
    delete:  (id: number)                                         => del<void>(`/sales/customers/${id}`),
    arLedger: (id: number, params?: { date_from?: string; date_to?: string; reason?: string; limit?: number; cursor?: number }) => {
      const q = new URLSearchParams()
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to)   q.set('date_to',   params.date_to)
      if (params?.reason)    q.set('reason',     params.reason)
      if (params?.limit)     q.set('limit',      String(params.limit))
      if (params?.cursor)    q.set('cursor',     String(params.cursor))
      const qs = q.toString()
      return get<ArLedgerOut[]>(`/sales/customers/${id}/ar-ledger${qs ? '?' + qs : ''}`)
    },
    sales:    (id: number, cursor?: number, limit?: number) => {
      const q = new URLSearchParams()
      if (cursor) q.set('cursor', String(cursor))
      if (limit)  q.set('limit',  String(limit))
      const qs = q.toString()
      return get<SaleOut[]>(`/sales/customers/${id}/sales${qs ? '?' + qs : ''}`)
    },
    payments: (id: number, cursor?: number, limit?: number) => {
      const q = new URLSearchParams()
      if (cursor) q.set('cursor', String(cursor))
      if (limit)  q.set('limit',  String(limit))
      const qs = q.toString()
      return get<CustomerPaymentOut[]>(`/sales/customers/${id}/payments${qs ? '?' + qs : ''}`)
    },
    recordPayment: (id: number, p: { payment_mode_id: number; amount: number; payment_date?: string; reference_number?: string; notes?: string; sale_id?: number; check_number?: string; check_date?: string; bank_name?: string }) =>
                     post<CustomerPaymentOut>(`/sales/customers/${id}/payment`, p),
    clearBouncedFlag: (id: number) =>
                     patch<CustomerOut>(`/sales/customers/${id}/clear-bounced-flag`, {}),
    aging: (params?: { search?: string }) => {
      const qs = params?.search ? `?search=${encodeURIComponent(params.search)}` : ''
      return get<CustomerAgingOut[]>(`/sales/customers/aging${qs}`)
    },
  },
  returns: {
    list: (params?: {
      search?: string; date_from?: string; date_to?: string
      location_id?: number; customer_id?: number; sale_id?: number
      has_exchange?: boolean; cursor?: number; limit?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.search)       q.set('search',       params.search)
      if (params?.date_from)    q.set('date_from',    params.date_from)
      if (params?.date_to)      q.set('date_to',      params.date_to)
      if (params?.location_id)  q.set('location_id',  String(params.location_id))
      if (params?.customer_id)  q.set('customer_id',  String(params.customer_id))
      if (params?.sale_id)      q.set('sale_id',      String(params.sale_id))
      if (params?.has_exchange) q.set('has_exchange', 'true')
      if (params?.cursor)       q.set('cursor',       String(params.cursor))
      if (params?.limit)        q.set('limit',        String(params.limit))
      const qs = q.toString()
      return get<SalesReturnOut[]>(`/sales/returns${qs ? '?' + qs : ''}`)
    },
    get:     (id: number)                               => get<SalesReturnOut>(`/sales/returns/${id}`),
    create:  (p: {
      sale_id?: number | null; location_id?: number | null
      customer_id?: number | null; disposition?: string
      reason?: string; return_date?: string
      shift_id?: number | null; register_id?: number | null
      items: { sale_item_id?: number | null; variant_id: number; quantity: number; unit_price: number }[]
    }) => post<SalesReturnOut>('/sales/returns', p),
    exchange: (
      p: { sale_id: number; location_id?: number | null; reason?: string
           items: { sale_item_id?: number | null; variant_id: number; quantity: number; unit_price: number }[] },
      opts?: { register_id?: number | null; shift_id?: number | null; employee_id?: number | null }
    ) => {
      const q = new URLSearchParams()
      if (opts?.register_id) q.set('register_id', String(opts.register_id))
      if (opts?.shift_id)    q.set('shift_id',    String(opts.shift_id))
      if (opts?.employee_id) q.set('employee_id', String(opts.employee_id))
      const qs = q.toString()
      return post<ExchangeResult>(`/sales/returns/exchange${qs ? '?' + qs : ''}`, p)
    },
    itemsForReturn: (sale_id: number) => get<SaleItemOut[]>(`/sales/sale/${sale_id}/items-for-return`),
  },
  customerArLedger: {
    list: (params?: {
      customer_id?: number
      date_from?: string
      date_to?: string
      status?: string[]
      search?: string
      limit?: number
      cursor?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.customer_id) q.set('customer_id', String(params.customer_id))
      if (params?.date_from)   q.set('date_from',   params.date_from)
      if (params?.date_to)     q.set('date_to',     params.date_to)
      if (params?.status?.length) params.status.forEach(s => q.append('status', s))
      if (params?.search)      q.set('search',      params.search)
      if (params?.limit  != null) q.set('limit',  String(params.limit))
      if (params?.cursor != null) q.set('cursor', String(params.cursor))
      const qs = q.toString()
      return get<CustomerARLedgerRowOut[]>(`/sales/customers/ar-ledger${qs ? '?' + qs : ''}`)
    },
    payments: (saleId: number) =>
      get<ARLedgerPaymentRowOut[]>(`/sales/customers/ar-ledger/${saleId}/payments`),
  },
  arLedger: {
    list: (params?: { customer_id?: number; reason?: string; date_from?: string; date_to?: string; cursor?: number }) => {
      const q = new URLSearchParams()
      if (params?.customer_id) q.set('customer_id', String(params.customer_id))
      if (params?.reason)      q.set('reason',      params.reason)
      if (params?.date_from)   q.set('date_from',   params.date_from)
      if (params?.date_to)     q.set('date_to',     params.date_to)
      if (params?.cursor)      q.set('cursor',      String(params.cursor))
      const qs = q.toString()
      return get<ArLedgerOut[]>(`/sales/ar-ledger${qs ? '?' + qs : ''}`)
    },
  },
  pdc: {
    list: (params?: { status?: string; bank_name?: string; date_from?: string; date_to?: string; as_of?: string }) => {
      const q = new URLSearchParams()
      if (params?.status)    q.set('status',    params.status)
      if (params?.bank_name) q.set('bank_name', params.bank_name)
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to)   q.set('date_to',   params.date_to)
      if (params?.as_of)     q.set('as_of',     params.as_of)
      const qs = q.toString()
      return get<PDCMaturityResponse>(`/sales/pdc${qs ? '?' + qs : ''}`)
    },
    deposit: (paymentId: number, deposited_at: string) =>
      patch<CustomerPaymentOut>(`/sales/pdc/${paymentId}/deposit`, { deposited_at }),
    bounce: (paymentId: number, bounce_notes?: string) =>
      patch<CustomerPaymentOut>(`/sales/pdc/${paymentId}/bounce`, { bounce_notes: bounce_notes ?? null }),
  },
  creditMemos: {
    list: (params?: {
      keyword?: string
      status?: string[]
      date_from?: string
      date_to?: string
      issued_by_user_id?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.keyword)             q.set('keyword',             params.keyword)
      if (params?.status?.length)      params.status.forEach(s => q.append('status', s))
      if (params?.date_from)           q.set('date_from',           params.date_from)
      if (params?.date_to)             q.set('date_to',             params.date_to)
      if (params?.issued_by_user_id)   q.set('issued_by_user_id',   String(params.issued_by_user_id))
      const qs = q.toString()
      return get<CreditMemoListOut[]>(`/sales/credit-memos${qs ? '?' + qs : ''}`)
    },
    get:      (id: number)              => get<CreditMemoOut>(`/sales/credit-memos/${id}`),
    issue:    (p: CreditMemoCreate)     => post<CreditMemoOut>('/sales/credit-memos', p),
    cancel:   (id: number)              => post<CreditMemoOut>(`/sales/credit-memos/${id}/cancel`, {}),
    validate: (code: string)            => get<CreditMemoValidateOut>(`/sales/credit-memos/validate?code=${encodeURIComponent(code)}`),
  },
}

// ── INVENTORY API ─────────────────────────────────────────────────────────────

export const inventoryApi = {
  locations: {
    all:    ()                                          => get<Location[]>('/transfers/locations/all'),
    create: (p: LocationCreate)                        => post<Location>('/transfers/locations', p),
    update: (id: number, p: LocationUpdate)            => request<Location>('PUT', `/transfers/locations/${id}`, p),
  },
  posCatalog: () => get<POSCatalogItem[]>('/products/pos-catalog'),
}

// ── CATALOGUE TYPES ───────────────────────────────────────────────────────────

export interface UOM { uom_id: number; uom_code: string; uom_name: string | null; is_deleted: boolean }
export interface Category { category_id: number; category_name: string; parent_category_id: number | null; is_deleted: boolean }
export interface InvSupplier {
  supplier_id: number
  supplier_code: string
  supplier_name: string
  bank_account_name: string | null
  terms: number
  is_deleted: boolean
}

export interface SupplierCreate {
  supplier_code: string
  supplier_name: string
  bank_account_name?: string | null
  terms: number
}

export interface SupplierUpdate {
  supplier_name?: string
  bank_account_name?: string | null
  terms?: number
}

export interface SupplierPatch {
  supplier_name?: string
  bank_account_name?: string | null
  terms?: number
  is_deleted?: boolean
}

export interface StockEntry {
  quantity: number
  location: { location_id: number; location_name: string; location_type: string; status: string }
}
export interface CostLayerEntry {
  layer_id: number; gross_cost: number; supplier_discount: number; net_unit_cost: number
  original_quantity: number; quantity_remaining: number; location_id: number; created_at: string
}
export interface InvBarcode { barcode_id: number; variant_id: number; barcode: string; uom_id: number | null; is_primary: boolean }
export interface InvUomConversion {
  variant_id: number
  from_uom_id: number
  to_uom_id: number
  factor: number
  is_warehouse_bundle: boolean
  price: number | null
  promo_price: number | null
}
export interface InvVariantSupplier {
  id: number; supplier_sku: string | null; gross_cost: number | null; supplier_discount: number; is_primary: boolean
  supplier: { supplier_id: number; supplier_code: string; supplier_name: string }
}
export interface BundleComp {
  bundle_variant_id: number
  component_variant_id: number
  quantity: number
  component_variant?: { variant_id: number; PID: string; variant_name: string } | null
}

export interface BundleAvailableStock {
  location_id:   number
  location_name: string
  available:     number
}

export interface InvVariant {
  variant_id: number
  product_id: number
  PID: string
  variant_name: string
  sku: string | null
  price: number | null
  promo_price: number | null
  is_default: boolean
  is_deleted: boolean
  include_in_ordering: boolean
  attributes: Record<string, unknown> | null
  current_stock: StockEntry[]
  suppliers: InvVariantSupplier[]
  cost_layers: CostLayerEntry[]
  barcodes: InvBarcode[]
  uom_conversions: InvUomConversion[]
  bundle_components: BundleComp[]
  bundle_available_stock: BundleAvailableStock[]
}

export interface InvProduct {
  product_id: number
  brand: string
  product_type: string
  description: string | null
  status: string
  is_deleted: boolean
  base_uom_id: number | null
  base_uom: UOM | null
  categories: Category[]
  variants: InvVariant[]
}

export interface PriceHistoryItem {
  history_id: number; variant_id: number
  old_price: number | null; new_price: number | null
  old_promo_price: number | null; new_promo_price: number | null
  changed_by_user_id: number | null; changed_by_username: string | null; changed_at: string
}
export interface CostHistoryItem {
  history_id: number; variant_id: number; supplier_id: number; supplier_name: string | null
  old_gross_cost: number | null; new_gross_cost: number | null
  old_supplier_discount: number | null; new_supplier_discount: number | null
  changed_by_user_id: number | null; changed_by_username: string | null; changed_at: string
}
export interface SalesHistoryItem {
  sale_pid: string | null; transaction_date: string | null; cashier: string | null
  quantity: number; unit_price: number; line_total: number; sale_status: string
}
export interface PurchaseHistoryItem {
  shipment_pid: string | null; received_at: string | null; supplier_name: string | null
  quantity_received: number; net_unit_cost: number | null; qc_status: string | null
}

// ── CATALOGUE API ─────────────────────────────────────────────────────────────

export const catalogueApi = {
  products: {
    list:   ()                                    => get<InvProduct[]>('/products/'),
    get:    (id: number)                          => get<InvProduct>(`/products/${id}`),
    create: (p: Record<string, unknown>)          => post<InvProduct>('/products/', p),
    update: (id: number, p: Record<string, unknown>) => request<InvProduct>('PUT', `/products/${id}`, p),
  },
  variants: {
    get:    (id: number)                          => get<InvVariant>(`/products/variants/${id}`),
    update: (id: number, p: Record<string, unknown>) => request<InvVariant>('PUT', `/products/variants/${id}`, p),
    delete: (id: number)                          => del<void>(`/products/variants/${id}`),
    addToProduct: (productId: number, p: Record<string, unknown>) =>
      post<InvProduct>(`/products/${productId}/variants`, p),
    priceHistory:    (id: number, limit=10, offset=0) =>
      get<PriceHistoryItem[]>(`/products/variants/${id}/price-history?limit=${limit}&offset=${offset}`),
    costHistory:     (id: number, limit=10, offset=0) =>
      get<CostHistoryItem[]>(`/products/variants/${id}/cost-history?limit=${limit}&offset=${offset}`),
    salesHistory:    (id: number, limit=10, offset=0) =>
      get<SalesHistoryItem[]>(`/products/variants/${id}/sales-history?limit=${limit}&offset=${offset}`),
    purchaseHistory: (id: number, limit=10, offset=0) =>
      get<PurchaseHistoryItem[]>(`/products/variants/${id}/purchase-history?limit=${limit}&offset=${offset}`),
  },
  barcodes: {
    create: (vid: number, p: Record<string, unknown>) => post<InvBarcode>(`/products/variants/${vid}/barcodes`, p),
    update: (vid: number, bid: number, p: Record<string, unknown>) => request<InvBarcode>('PUT', `/products/variants/${vid}/barcodes/${bid}`, p),
    delete: (vid: number, bid: number) => del<void>(`/products/variants/${vid}/barcodes/${bid}`),
  },
  uomConversions: {
    create: (vid: number, p: Record<string, unknown>) => post<InvUomConversion>(`/products/variants/${vid}/uom-conversions`, p),
    update: (vid: number, fromId: number, toId: number, p: Record<string, unknown>) =>
      request<InvUomConversion>('PUT', `/products/variants/${vid}/uom-conversions/${fromId}/${toId}`, p),
    delete: (vid: number, fromId: number, toId: number) => del<void>(`/products/variants/${vid}/uom-conversions/${fromId}/${toId}`),
  },
  bundleComponents: {
    create: (vid: number, p: Record<string, unknown>) => post<BundleComp>(`/products/variants/${vid}/bundle-components`, p),
    update: (vid: number, compId: number, p: Record<string, unknown>) => request<BundleComp>('PUT', `/products/variants/${vid}/bundle-components/${compId}`, p),
    delete: (vid: number, compId: number) => del<void>(`/products/variants/${vid}/bundle-components/${compId}`),
  },
  supplierLinks: {
    create: (vid: number, p: Record<string, unknown>) => post<InvVariantSupplier>(`/products/variants/${vid}/suppliers`, p),
    update: (vid: number, sid: number, p: Record<string, unknown>) => request<InvVariantSupplier>('PUT', `/products/variants/${vid}/suppliers/${sid}`, p),
    delete: (vid: number, sid: number) => del<void>(`/products/variants/${vid}/suppliers/${sid}`),
  },
  uoms: {
    list:   ()                                          => get<UOM[]>('/products/uoms'),
    create: (p: { uom_code: string; uom_name?: string }) => post<UOM>('/products/uoms', p),
    patch:  (id: number, p: { uom_name?: string })       => patch<UOM>(`/products/uoms/${id}`, p),
    delete: (id: number)                                => del<void>(`/products/uoms/${id}`),
  },
  categories: {
    list:   ()                                                   => get<Category[]>('/products/categories'),
    create: (p: { category_name: string; parent_category_id?: number | null }) =>
      post<Category>('/products/categories', p),
    patch:  (id: number, p: { category_name?: string; parent_category_id?: number | null }) =>
      patch<Category>(`/products/categories/${id}`, p),
    delete: (id: number)                                         => del<void>(`/products/categories/${id}`),
  },
  suppliers: {
    list:        (includeDeleted = false) =>
      get<InvSupplier[]>(`/products/suppliers/all${includeDeleted ? '?include_deleted=true' : ''}`),
    get:         (id: number)             => get<InvSupplier>(`/products/suppliers/${id}`),
    create:      (p: SupplierCreate)      => post<InvSupplier>('/products/suppliers', p),
    update:      (id: number, p: SupplierUpdate) =>
      request<InvSupplier>('PUT', `/products/suppliers/${id}`, p),
    patch:       (id: number, p: SupplierPatch) =>
      request<InvSupplier>('PATCH', `/products/suppliers/${id}`, p),
    deactivate:  (id: number) =>
      request<InvSupplier>('PATCH', `/products/suppliers/${id}`, { is_deleted: true }),
    reactivate:  (id: number) =>
      request<InvSupplier>('PATCH', `/products/suppliers/${id}`, { is_deleted: false }),
  },
  importOps: {
    preview: (rows: unknown[]) => post<{ rows: unknown[] }>('/products/import/preview', rows),
    confirm: (rows: unknown[], confirmedPids: string[]) =>
      post<InvProduct[]>('/products/import/confirm', { rows, confirmed_pids: confirmedPids }),
  },
}

// ── SALES RETURNS ─────────────────────────────────────────────────────────────

export interface SalesReturnItemOut {
  return_item_id: number
  return_id:      number
  sale_item_id:   number | null
  variant_id:     number
  cost_layer_id:  number | null
  quantity:       number
  line_total:     number
  variant?: { variant_id: number; PID: string; variant_name: string } | null
}

export interface SalesReturnOut {
  return_id:           number
  return_pid:          string | null
  sale_id:             number | null
  location_id:         number
  return_date:         string | null
  reason:              string | null
  grand_total:         number
  disposition:         string | null
  customer_id:         number | null
  created_by_user_id:  number | null
  shift_id:            number | null
  register_id:         number | null
  items:               SalesReturnItemOut[]
  exchange_sale_pid:   string | null
  exchange_sale_id:    number | null
}

export interface ExchangeResult {
  sales_return:   SalesReturnOut
  exchange_draft: SaleOut
}

// ── BULK IMPORT ───────────────────────────────────────────────────────────────

export interface ImportDiffRow {
  row_number:  number
  anchor:      string
  mode:        'create' | 'update' | 'noop'
  old_values:  Record<string, unknown> | null
  new_values:  Record<string, unknown>
  diff_fields: string[]
}

export interface ImportErrorRow {
  row_number: number
  anchor:     string
  error:      string
}

export interface ImportPreviewResponse {
  valid_rows: ImportDiffRow[]
  error_rows: ImportErrorRow[]
  summary: { creates: number; updates: number; noops: number; errors: number }
}

export interface ImportConfirmResponse {
  written: number
  skipped: number
  errors:  ImportErrorRow[]
}

// ── CREDIT MEMOS ──────────────────────────────────────────────────────────────

export interface CreditMemoRedemptionOut {
  redemption_id:       number
  memo_id:             number
  sale_id:             number
  amount_redeemed:     number
  redeemed_at:         string | null
  redeemed_by_user_id: number
}

export interface CreditMemoListOut {
  memo_id:            number
  code:               string
  amount:             number
  status:             string
  issued_at:          string
  valid_until:        string
  issued_by_user_id:  number | null
  issued_by_name:     string | null
  return_id:          number | null
  return_pid:         string | null
  notes:              string | null
  redeemed_sale_id:   number | null
}

export interface CreditMemoOut extends CreditMemoListOut {
  cancelled_by_user_id: number | null
  cancelled_at:         string | null
  redemptions:          CreditMemoRedemptionOut[]
}

export interface CreditMemoValidateOut {
  memo_id:        number | null
  code:           string
  amount:         number | null
  valid_until:    string | null
  status:         string | null
  is_valid:       boolean
  invalid_reason: string | null
}

export interface CreditMemoCreate {
  amount:      number
  valid_until?: string
  return_id?:  number | null
  notes?:      string
}

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('erp_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const importApi = {
  downloadTemplate: async (entity: string): Promise<void> => {
    const resp = await fetch(`${BASE_URL}/import/${entity}/template`, { headers: authHeader() })
    if (!resp.ok) throw new Error('Template download failed')
    const blob = await resp.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${entity}_import_template.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  },
  preview: (entity: string, rows: Record<string, unknown>[]) =>
    post<ImportPreviewResponse>(`/import/${entity}/preview`, { rows }),
  confirm: (entity: string, confirmedAnchors: string[], rows: Record<string, unknown>[]) =>
    post<ImportConfirmResponse>(`/import/${entity}/confirm`, { confirmed_anchors: confirmedAnchors, rows }),
}

// ── SYSTEM SETTINGS ───────────────────────────────────────────────────────────

export interface InventoryPolicy {
  allow_negative_stock:  boolean
  updated_at:            string | null
  updated_by_user_id:    number | null
  updated_by_username:   string | null
}

export const settingsApi = {
  inventoryPolicy: {
    get:   ()                                        => get<InventoryPolicy>('/settings/inventory-policy'),
    patch: (p: { allow_negative_stock: boolean })    => patch<InventoryPolicy>('/settings/inventory-policy', p),
  },
  storeName: () => get<{ key: string; value: string }>('/settings/system-settings/store_name'),
}

// ── STOCK MOVEMENT TYPES ──────────────────────────────────────────────────────

export interface Transfer {
  transfer_id: number
  transfer_pid: string | null
  from_location_id: number
  to_location_id: number
  from_location?: { location_id: number; location_name: string }
  to_location?:   { location_id: number; location_name: string }
  released_by_user_id:  number | null
  received_by_user_id:  number | null
  requested_by_user_id: number | null
  released_by_employee_id: number | null
  received_by_employee_id: number | null
  released_by_employee?: { employee_id: number; first_name: string; last_name: string } | null
  received_by_employee?: { employee_id: number; first_name: string; last_name: string } | null
  total_bundle_count: number | null
  occurred_at: string
  status: string
  voided_at: string | null
  void_reason: string | null
  items?: TransferItem[]
}

export interface TransferItem {
  transfer_item_id: number
  transfer_id: number
  variant_id: number
  quantity_requested: number
  quantity_released: number | null
  quantity_received: number | null
  variant?: { variant_id: number; PID: string; variant_name: string; sku: string | null
              product?: { brand: string } }
}

export interface TransferCreate {
  from_location_id: number
  to_location_id: number
  transfer_pid?: string | null
  occurred_at?: string
  requested_by_user_id?: number | null
  released_by_employee_id?: number | null
  received_by_employee_id?: number | null
  total_bundle_count?: number | null
  items: { variant_id: number; quantity_requested: number; quantity_released?: number | null }[]
}

export interface Shipment {
  shipment_id: number
  shipment_pid: string | null
  supplier_id: number | null
  po_id: number | null
  reference_number: string | null
  received_at: string | null
  is_confirmed: boolean
  discrepancy_status: string
  discrepancy_notes: string | null
  received_by_user_id:      number | null
  inspected_by_user_id:     number | null
  received_by_employee_id:  number | null
  inspected_by_employee_id: number | null
  received_by_employee?:  { employee_id: number; first_name: string; last_name: string } | null
  inspected_by_employee?: { employee_id: number; first_name: string; last_name: string } | null
  supplier?: { supplier_id: number; supplier_name: string; terms?: number }
  po?: { po_id: number; po_pid: string }
  receiving_details?: ReceivingDetail[]
}

export interface ReceivingDetail {
  detail_id: number
  shipment_id: number
  variant_id: number
  location_id: number
  po_item_id: number | null
  received_at: string | null
  inspected_at: string | null
  quantity_ordered: number | null
  quantity_declared: number | null
  quantity_actual: number | null
  quantity_rejected: number | null
  qc_status: string | null
  variant?: { variant_id: number; PID: string; variant_name: string; sku: string | null
              product?: { brand: string } }
  cost_layer?: { gross_cost: number; supplier_discount: number; net_unit_cost: number } | null
}

export interface ConfirmCostsItem {
  detail_id: number
  gross_cost: number
  discount_pct: number
}

export interface ConfirmCostsPayload {
  invoice_number: string
  invoice_date: string   // ISO date string
  due_date?: string | null   // override; defaults server-side to invoice_date + supplier.terms
  items: ConfirmCostsItem[]
  inspected_by_employee_id?: number | null
}

export interface CostAutofillItem {
  detail_id: number
  variant_id: number
  gross_cost: number | null
  discount_pct: number | null
  net_unit_cost: number | null
  source: 'cost_layer' | 'variant_suppliers' | 'none'
}

export interface LedgerEntry {
  ledger_id: number
  variant_id: number
  location_id: number
  qty_change: number
  reason: string
  reference_type: string | null
  reference_id: string | null
  occurred_at: string
  document_pid: string | null
  variant?: { variant_id: number; PID: string; variant_name: string; sku?: string | null
              product?: { brand: string } }
  location?: { location_id: number; location_name: string }
}

// ── PURCHASE ORDER TYPES ───────────────────────────────────────────────────────

export interface POVariantRef { variant_id: number; PID: string; variant_name: string }
export interface POSupplierRef { supplier_id: number; supplier_code: string; supplier_name: string }
export interface POLocationRef { location_id: number; location_name: string }

export interface POItemCreate {
  variant_id: number
  ordered_quantity: number
  gross_cost: number
  discount_pct?: number
}

export interface POItemUpdate {
  ordered_quantity?: number
  gross_cost?: number
  discount_pct?: number
}

export interface POItemOut {
  po_item_id: number
  variant_id: number
  ordered_quantity: number
  received_quantity: number
  gross_cost: number
  discount_pct: number
  unit_cost: number
  variant?: POVariantRef
}

export interface POCreate {
  po_pid?: string
  supplier_id: number
  location_id?: number | null
  expected_arrival_date?: string | null
  items: POItemCreate[]
}

export interface POStatusUpdate {
  status: string
}

export interface POOut {
  po_id: number
  po_pid: string
  supplier_id: number
  location_id: number | null
  status: string
  total_amount: number
  order_date: string
  expected_arrival_date: string | null
  created_at: string
  supplier?: POSupplierRef
  location?: POLocationRef
  items: POItemOut[]
}

export interface VariantSupplierCostOut {
  gross_cost: number
  discount_pct: number
}

// ── PURCHASE ORDER API ────────────────────────────────────────────────────────

export const purchaseOrderApi = {
  list:   ()                  => get<POOut[]>('/procurement/orders'),
  get:    (po_id: number)     => get<POOut>(`/procurement/orders/${po_id}`),
  create: (p: POCreate)       => post<POOut>('/procurement/orders', p),
  updateItem: (po_id: number, po_item_id: number, p: POItemUpdate) =>
    request<POOut>('PUT', `/procurement/orders/${po_id}/items/${po_item_id}`, p),
  updateStatus: (po_id: number, p: POStatusUpdate) =>
    patch<POOut>(`/procurement/orders/${po_id}/status`, p),
  variantSupplierCost: (variant_id: number, supplier_id: number) =>
    get<VariantSupplierCostOut>(`/procurement/variant-supplier-cost?variant_id=${variant_id}&supplier_id=${supplier_id}`),
}

// ── STOCK MOVEMENT API ────────────────────────────────────────────────────────

export const stockApi = {
  transfers: {
    list:   ()                        => get<Transfer[]>('/transfers/'),
    get:    (id: number)              => get<Transfer>(`/transfers/${id}`),
    create: (p: TransferCreate)       => post<Transfer>('/transfers/', p),
    void:   (id: number, void_reason: string) =>
      post<Transfer>(`/transfers/${id}/void`, { void_reason }),
    updateHeader: (id: number, p: Record<string, unknown>) =>
      request<Transfer>('PUT', `/transfers/${id}/header`, p),
  },
  shipments: {
    list:   ()                        => get<Shipment[]>('/procurement/shipments'),
    get:    (id: number)              => get<Shipment>(`/procurement/shipments/${id}`),
    create: (p: Record<string, unknown>) => post<Shipment>('/procurement/shipments', p),
    // Backend expects a LIST — always send an array, never a single object
    addDetails: (id: number, rows: Record<string, unknown>[]) =>
      post<Shipment>(`/procurement/shipments/${id}/details`, rows),
    // Stage 1: write ledger entries, stock enters immediately — no cost layers
    receive: (id: number) =>
      post<{ shipment_id: number; ledger_entries_written: number }>(
        `/procurement/shipments/${id}/receive`, {}
      ),
    // Stage 2: pre-fill gross_cost/discount_pct per line from prior cost layers or variant_suppliers
    costAutofill: (id: number) =>
      get<CostAutofillItem[]>(`/procurement/shipment-cost-autofill?shipment_id=${id}`),
    // Stage 2: create cost layers from gross_cost + discount_pct, record the invoice
    confirmCosts: (id: number, payload: ConfirmCostsPayload) =>
      post<Shipment>(`/procurement/shipments/${id}/confirm-costs`, payload),
    // Legacy combined confirm — kept for backward compat
    confirm: (id: number) => post<Record<string, unknown>>(`/procurement/shipments/${id}/confirm`, {}),
    updateDiscrepancy: (id: number, p: { discrepancy_status: string; discrepancy_notes?: string | null }) =>
      patch<Shipment>(`/procurement/shipments/${id}/discrepancy`, p),
    // Confirmed shipments only — downloads the two-sheet invoice workbook
    exportInvoice: async (id: number, filenameFallback?: string): Promise<void> => {
      const resp = await fetch(`${BASE_URL}/procurement/shipments/${id}/export`, { headers: authHeader() })
      if (!resp.ok) throw new Error('Export failed')
      const blob = await resp.blob()
      const cd = resp.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || filenameFallback || `shipment_${id}_invoice.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
  },
  ledger: {
    list: (params?: {
      reason?: string; location_id?: number; variant_id?: number
      date_from?: string; date_to?: string; limit?: number; cursor?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.reason)      q.set('reason',      params.reason)
      if (params?.location_id) q.set('location_id', String(params.location_id))
      if (params?.variant_id)  q.set('variant_id',  String(params.variant_id))
      if (params?.date_from)   q.set('date_from',   params.date_from)
      if (params?.date_to)     q.set('date_to',     params.date_to)
      if (params?.limit)       q.set('limit',       String(params.limit))
      if (params?.cursor)      q.set('cursor',      String(params.cursor))
      const qs = q.toString()
      return get<LedgerEntry[]>(`/products/ledger${qs ? '?' + qs : ''}`)
    },
    forVariant: (vid: number, params?: { limit?: number; offset?: number }) => {
      const q = new URLSearchParams()
      if (params?.limit)  q.set('limit',  String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))
      const qs = q.toString()
      return get<LedgerEntry[]>(`/products/variants/${vid}/ledger${qs ? '?' + qs : ''}`)
    },
  },
}

// ── AP TYPES ──────────────────────────────────────────────────────────────────

export interface InvoiceSupplierRef {
  supplier_id: number
  supplier_name: string
}

export interface SupplierInvoiceItemOut {
  id: number
  invoice_id: number
  po_item_id: number
  variant_id: number
  variant_name: string | null
  variant_sku: string | null
  ordered_qty: number
  received_qty: number
  rejected_qty: number
  billed_qty: number
  billed_unit_cost: number
  line_total: number
  created_at: string
  updated_at: string
}

export interface SupplierInvoiceItemUpdate {
  billed_qty?: number
  billed_unit_cost?: number
}

export interface MatchPoRef {
  id: number
  po_pid: string
  status: string
  created_at: string
  supplier_id: number
  supplier_name: string
}

export interface MatchShipmentRef {
  id: number
  is_confirmed: boolean
  discrepancy_status: string
  discrepancy_notes: string | null
  received_at: string | null
}

export interface MatchLineOut {
  variant_id: number
  variant_name: string | null
  variant_sku: string | null
  ordered_qty: number
  received_qty: number
  rejected_qty: number
  billed_qty: number
  billed_unit_cost: number
  line_total: number
  po_line_total: number
  qty_variance: number
  cost_variance: number
  has_variance: boolean
}

export interface MatchResponse {
  invoice: InvoiceOut
  po: MatchPoRef | null
  shipment: MatchShipmentRef | null
  lines: MatchLineOut[]
}

export interface SupplierAgingRow {
  supplier_id:          number
  supplier_name:        string
  supplier_code:        string | null
  invoice_count:        number
  has_pending_vetting:  boolean
  has_rejected:         boolean
  current:              number
  bucket_30:            number
  bucket_60:            number
  bucket_90:            number
  bucket_90p:           number
  total:                number
}

export interface SupplierAgingResponse {
  as_of:  string
  rows:   SupplierAgingRow[]
  totals: SupplierAgingRow
}

export interface InvoiceOut {
  invoice_id: number
  supplier_id: number
  shipment_id: number | null
  invoice_number: string | null
  invoice_date: string          // "YYYY-MM-DD"
  due_date: string | null       // "YYYY-MM-DD"
  total_amount: number
  amended_amount: number | null
  amendment_notes: string | null
  status: string                // Unpaid | Partial | Paid
  vetting_status: string        // Pending_Review | Approved | Rejected
  paid_before_received: boolean
  check_drafted: boolean
  check_drafted_note: string | null
  created_at: string
  supplier: InvoiceSupplierRef | null
  items: SupplierInvoiceItemOut[]
}

export interface InvoiceAmend {
  amended_amount?: number
  amendment_notes?: string
}

export interface InvoiceVettingUpdate {
  vetting_status: string        // Pending_Review | Approved | Rejected
  override_discrepancy?: boolean
}

export interface ApVettingWarning {
  warning: true
  message: string
}

export interface InvoiceCheckDraftUpdate {
  check_drafted: boolean
  check_drafted_note?: string | null
}

export interface InvoiceApplicationCreate {
  invoice_id: number
  amount_applied: number
}

export interface ApPaymentCreate {
  supplier_id: number
  amount: number
  payment_date?: string
  reference_number?: string
  payment_method?: string
  applications: InvoiceApplicationCreate[]
}

export interface InvoicePaymentOut {
  invoice_id: number
  payment_id: number
  amount_applied: number
}

export interface ApPaymentOut {
  payment_id: number
  supplier_id: number
  amount: number
  payment_date: string | null
  reference_number: string | null
  payment_method: string | null
  supplier: InvoiceSupplierRef | null
  invoice_payments: InvoicePaymentOut[]
}

export interface ApLedgerOut {
  ap_ledger_id: number
  supplier_id: number
  amount_change: number
  reason: string                // INVOICE | PAYMENT | CREDIT_MEMO | ADJUSTMENT
  reference_type: string | null
  reference_id: string | null
  occurred_at: string
  supplier_name: string | null
}

// ── AP API ────────────────────────────────────────────────────────────────────

export const apApi = {
  invoices: {
    list: (params?: { supplier_id?: number; status?: string }) => {
      const q = new URLSearchParams()
      if (params?.supplier_id) q.set('supplier_id', String(params.supplier_id))
      if (params?.status)      q.set('status',      params.status)
      const qs = q.toString()
      return get<InvoiceOut[]>(`/ap/invoices${qs ? '?' + qs : ''}`)
    },
    get:    (id: number)                    => get<InvoiceOut>(`/ap/invoices/${id}`),
    amend:  (id: number, p: InvoiceAmend)  => patch<InvoiceOut>(`/ap/invoices/${id}`, p),
    setVetting: (id: number, p: InvoiceVettingUpdate) =>
      patch<InvoiceOut | ApVettingWarning>(`/ap/invoices/${id}/vetting`, p),
    setCheckDraft: (id: number, p: InvoiceCheckDraftUpdate) =>
      patch<InvoiceOut>(`/ap/invoices/${id}/check-draft`, p),
    getMatch:          (id: number)                                    => get<MatchResponse>(`/ap/invoices/${id}/match`),
    updateInvoiceItem: (id: number, itemId: number, p: SupplierInvoiceItemUpdate) =>
      patch<SupplierInvoiceItemOut>(`/ap/invoices/${id}/items/${itemId}`, p),
  },
  payments: {
    list: (supplierId?: number) => {
      const qs = supplierId ? `?supplier_id=${supplierId}` : ''
      return get<ApPaymentOut[]>(`/ap/payments${qs}`)
    },
    get:    (id: number)           => get<ApPaymentOut>(`/ap/payments/${id}`),
    create: (p: ApPaymentCreate)   => post<ApPaymentOut>('/ap/payments', p),
  },
  ledger: {
    list: (supplierId?: number) => {
      const qs = supplierId ? `?supplier_id=${supplierId}` : ''
      return get<ApLedgerOut[]>(`/ap/ledger${qs}`)
    },
  },
  getAging: (asOf?: string) => {
    const qs = asOf ? `?as_of=${asOf}` : ''
    return get<SupplierAgingResponse>(`/ap/aging${qs}`)
  },
}

// ── re-export helpers ─────────────────────────────────────────────────────────
export { get, post, patch, del }
