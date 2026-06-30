import { useState, type ReactNode, lazy, Suspense } from 'react'
const ImportHub = lazy(() => import('./settings/ImportHub'))
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useTheme, type Theme } from '../hooks/useTheme'
import { useAltRows } from '../hooks/useAltRows'
import { SkeletonTable, FetchingBar } from '../components/Skeleton'
import { qk } from '../lib/queryKeys'
import { stale } from '../lib/queryClient'
import {
  salesApi, inventoryApi, authApi, catalogueApi, settingsApi,
  type Shift, type CashRegister, type PaymentMode, type Location,
  type EmployeeOut, type UserEntry, type RoleEntry,
  type UOM, type Category,
  type ModuleGroup, type RolePermissions,
} from '../services/api'

// ── access guard ─────────────────────────────────────────────────────────────

// ── tab definition ────────────────────────────────────────────────────────────

const TABS = [
  'Locations', 'Shifts', 'Registers', 'Payment Modes',
  'UOMs', 'Categories', 'Employees & Users', 'Roles', 'Appearance', 'Inventory Policy', 'Import',
] as const
type TabName = typeof TABS[number]

const TAB_ACTION_MAP: Partial<Record<TabName, string>> = {
  'Locations':         'manage_locations',
  'Shifts':            'manage_shifts',
  'Registers':         'manage_registers',
  'Payment Modes':     'manage_payment_modes',
  'UOMs':              'manage_uoms',
  'Categories':        'manage_categories',
  'Employees & Users': 'manage_users',
  'Roles':             'manage_roles',
  'Appearance':        'manage_appearance',
  'Inventory Policy':  'manage_inventory_policy',
  // 'Import' is intentionally absent — visibility is derived from data-type actions below
}

const IMPORT_DATA_ACTIONS = ['manage_products', 'manage_suppliers', 'manage_customers'] as const

// ── shared UI primitives ──────────────────────────────────────────────────────

const inputCls =
  't-bg-input border t-border-strong rounded px-2 py-1.5 text-sm t-text-1 ' +
  'placeholder:t-text-4 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
const selectCls =
  't-bg-input border t-border-strong rounded px-2 py-1.5 text-sm t-text-1 ' +
  'focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
const labelCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'

function Btn({ children, onClick, variant = 'ghost', disabled, small }: {
  children: ReactNode; onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; small?: boolean
}) {
  const base = `${small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'} font-medium uppercase tracking-wide rounded transition-colors disabled:opacity-40`
  const styles: Record<string, string> = {
    primary: 'text-[var(--accent-tx)] hover:opacity-90',
    ghost:   'border t-border t-text-2 hover:t-text-1 hover:t-border-strong',
    danger:  'border border-red-900 text-red-500 hover:bg-red-950',
  }
  return (
    <button className={`${base} ${styles[variant]}`}
      style={variant === 'primary' ? { backgroundColor: 'var(--accent)' } : undefined}
      onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${active ? 'bg-emerald-950 text-[var(--success)]' : 't-bg-elevated t-text-3'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function TableHead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b t-border">
        {cols.map(c => <th key={c} className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-widest t-text-3">{c}</th>)}
      </tr>
    </thead>
  )
}

function SubHead({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3 mt-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3">{title}</p>
      <div className="flex-1 border-b t-border" />
    </div>
  )
}

function InlineForm({ title, onCancel, onSave, loading, children }: {
  title: string; onCancel: () => void; onSave: () => void; loading: boolean; children: ReactNode
}) {
  return (
    <div className="t-bg-elevated border t-border rounded-lg p-4 mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
      <div className="mt-3 flex gap-2">
        <Btn variant="primary" onClick={onSave} disabled={loading}>{loading ? 'Saving…' : 'Save'}</Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Btn>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function LocationsTab() {
  const qc = useQueryClient()
  const { data: rawLocs = [], isLoading, isFetching } = useQuery({
    queryKey: qk.locations(), queryFn: inventoryApi.locations.all, ...stale.reference,
  })
  const items = rawLocs.slice().sort((a, b) => a.location_name.localeCompare(b.location_name))

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Location | null>(null)
  const [form, setForm] = useState({ location_name: '', location_type: 'Store', address: '' })
  const [loading, setLoading] = useState(false)

  function openAdd() { setEditing(null); setForm({ location_name: '', location_type: 'Store', address: '' }); setShowForm(true) }
  function openEdit(loc: Location) {
    setEditing(loc); setForm({ location_name: loc.location_name, location_type: loc.location_type, address: (loc as any).address ?? '' }); setShowForm(true)
  }

  async function save() {
    if (!form.location_name.trim()) return
    setLoading(true)
    try {
      const payload = { location_name: form.location_name.trim(), location_type: form.location_type, address: form.address.trim() || null }
      editing ? await inventoryApi.locations.update(editing.location_id, payload) : await inventoryApi.locations.create(payload)
      await qc.invalidateQueries({ queryKey: qk.locations() }); setShowForm(false)
    } finally { setLoading(false) }
  }

  async function setStatus(loc: Location, status: string) {
    await inventoryApi.locations.update(loc.location_id, { status })
    await qc.invalidateQueries({ queryKey: qk.locations() })
  }

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <div className="flex justify-end mb-3"><Btn variant="primary" onClick={openAdd}>+ Add Location</Btn></div>
      {showForm && (
        <InlineForm title={editing ? 'Edit Location' : 'New Location'} onCancel={() => setShowForm(false)} onSave={save} loading={loading}>
          <div><label className={labelCls}>Name *</label><input className={inputCls} value={form.location_name} onChange={e => setForm(f => ({ ...f, location_name: e.target.value }))} /></div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={selectCls} value={form.location_type} onChange={e => setForm(f => ({ ...f, location_type: e.target.value }))}>
              {['Warehouse', 'Store', 'Bin', 'Virtual'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Address</label><input className={inputCls} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
        </InlineForm>
      )}
      <table className="w-full text-sm">
        <TableHead cols={['Name', 'Type', 'Address', 'Status', 'Actions']} />
        <tbody>
          {isLoading && <SkeletonTable rows={4} cols={5} />}
          {items.map(loc => (
            <tr key={loc.location_id} className={`border-b t-border ${loc.status !== 'Active' ? 'opacity-50' : ''}`}>
              <td className="px-3 py-2 t-text-1 font-medium">{loc.location_name}</td>
              <td className="px-3 py-2 t-text-2 text-xs">{loc.location_type}</td>
              <td className="px-3 py-2 t-text-3 text-xs">{(loc as any).address || '—'}</td>
              <td className="px-3 py-2"><StatusBadge active={loc.status === 'Active'} /></td>
              <td className="px-3 py-2">
                {!loc.is_system ? (
                  <div className="flex gap-2">
                    <Btn onClick={() => openEdit(loc)}>Edit</Btn>
                    {loc.status === 'Active'
                      ? <Btn variant="danger" onClick={() => setStatus(loc, 'Inactive')}>Deactivate</Btn>
                      : <Btn variant="ghost" onClick={() => setStatus(loc, 'Active')}>Reactivate</Btn>}
                  </div>
                ) : <span className="text-[10px] t-text-4 italic">system</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — SHIFTS
// ═══════════════════════════════════════════════════════════════════════════════

function ShiftsTab() {
  const qc = useQueryClient()
  const { data: items = [], isLoading, isFetching } = useQuery({
    queryKey: qk.shifts(), queryFn: salesApi.shifts.list, ...stale.reference,
  })
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  async function save() {
    if (!name.trim()) return
    setLoading(true)
    try {
      editing ? await salesApi.shifts.patch(editing.shift_id, { shift_name: name.trim() }) : await salesApi.shifts.create({ shift_name: name.trim() })
      await qc.invalidateQueries({ queryKey: qk.shifts() }); setShowForm(false)
    } finally { setLoading(false) }
  }

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <div className="flex justify-end mb-3"><Btn variant="primary" onClick={() => { setEditing(null); setName(''); setShowForm(true) }}>+ Add Shift</Btn></div>
      {showForm && (
        <InlineForm title={editing ? 'Edit Shift' : 'New Shift'} onCancel={() => setShowForm(false)} onSave={save} loading={loading}>
          <div><label className={labelCls}>Name *</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="AM, PM, Graveyard…" /></div>
        </InlineForm>
      )}
      <table className="w-full text-sm">
        <TableHead cols={['Name', 'Status', 'Actions']} />
        <tbody>
          {isLoading && <SkeletonTable rows={3} cols={3} />}
          {items.map(s => (
            <tr key={s.shift_id} className={`border-b t-border ${!s.is_active ? 'opacity-50' : ''}`}>
              <td className="px-3 py-2 t-text-1 font-medium">{s.shift_name}</td>
              <td className="px-3 py-2"><StatusBadge active={s.is_active} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <Btn onClick={() => { setEditing(s); setName(s.shift_name); setShowForm(true) }}>Edit</Btn>
                  {s.is_active
                    ? <Btn variant="danger" onClick={async () => { await salesApi.shifts.patch(s.shift_id, { is_active: false }); qc.invalidateQueries({ queryKey: qk.shifts() }) }}>Deactivate</Btn>
                    : <Btn variant="ghost" onClick={async () => { await salesApi.shifts.patch(s.shift_id, { is_active: true }); qc.invalidateQueries({ queryKey: qk.shifts() }) }}>Reactivate</Btn>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — REGISTERS
// ═══════════════════════════════════════════════════════════════════════════════

function RegistersTab() {
  const qc = useQueryClient()
  const { data: items = [], isLoading, isFetching } = useQuery({
    queryKey: qk.registers(), queryFn: salesApi.registers.list, ...stale.reference,
  })
  const { data: rawLocations = [] } = useQuery({
    queryKey: qk.locations(), queryFn: inventoryApi.locations.all, ...stale.reference,
  })
  const locations = rawLocations.filter(l => l.status === 'Active' && l.location_type !== 'Virtual')

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CashRegister | null>(null)
  const [form, setForm] = useState({ name: '', location_id: '' })
  const [loading, setLoading] = useState(false)

  async function save() {
    if (!form.name.trim() || !form.location_id) return
    setLoading(true)
    try {
      const p = { name: form.name.trim(), location_id: parseInt(form.location_id) }
      editing ? await salesApi.registers.patch(editing.register_id, p) : await salesApi.registers.create(p)
      await qc.invalidateQueries({ queryKey: qk.registers() }); setShowForm(false)
    } finally { setLoading(false) }
  }

  const allLocs = [...locations, ...items.map(r => ({ location_id: r.location_id, location_name: '' }))]

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <div className="flex justify-end mb-3"><Btn variant="primary" onClick={() => { setEditing(null); setForm({ name: '', location_id: '' }); setShowForm(true) }}>+ Add Register</Btn></div>
      {showForm && (
        <InlineForm title={editing ? 'Edit Register' : 'New Register'} onCancel={() => setShowForm(false)} onSave={save} loading={loading}>
          <div><label className={labelCls}>Name *</label><input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Register 1" /></div>
          <div>
            <label className={labelCls}>Location *</label>
            <select className={selectCls} value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
              <option value="">— select —</option>
              {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
            </select>
          </div>
        </InlineForm>
      )}
      <table className="w-full text-sm">
        <TableHead cols={['Name', 'Location', 'Status', 'Actions']} />
        <tbody>
          {isLoading && <SkeletonTable rows={3} cols={4} />}
          {items.map(r => (
            <tr key={r.register_id} className={`border-b t-border ${!r.is_active ? 'opacity-50' : ''}`}>
              <td className="px-3 py-2 t-text-1 font-medium">{r.name}</td>
              <td className="px-3 py-2 t-text-2 text-xs">{allLocs.find(l => l.location_id === r.location_id)?.location_name ?? r.location_id}</td>
              <td className="px-3 py-2"><StatusBadge active={r.is_active} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <Btn onClick={() => { setEditing(r); setForm({ name: r.name, location_id: String(r.location_id) }); setShowForm(true) }}>Edit</Btn>
                  {r.is_active
                    ? <Btn variant="danger" onClick={async () => { await salesApi.registers.patch(r.register_id, { is_active: false }); qc.invalidateQueries({ queryKey: qk.registers() }) }}>Deactivate</Btn>
                    : <Btn variant="ghost" onClick={async () => { await salesApi.registers.patch(r.register_id, { is_active: true }); qc.invalidateQueries({ queryKey: qk.registers() }) }}>Reactivate</Btn>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 — PAYMENT MODES
// ═══════════════════════════════════════════════════════════════════════════════

function PaymentModesTab() {
  const qc = useQueryClient()
  const { data: items = [], isLoading, isFetching } = useQuery({
    queryKey: qk.paymentModes(), queryFn: salesApi.paymentModes.list, ...stale.reference,
  })
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<PaymentMode | null>(null)
  const [form, setForm]           = useState({ name: '', is_physical: 'true', is_ar_charge: false, is_ar_credit: false, is_pdc: false })
  const [loading, setLoading]     = useState(false)
  const [arError, setArError]     = useState('')

  function openNew() {
    setEditing(null)
    setForm({ name: '', is_physical: 'true', is_ar_charge: false, is_ar_credit: false, is_pdc: false })
    setArError('')
    setShowForm(true)
  }
  function openEdit(m: PaymentMode) {
    setEditing(m)
    setForm({ name: m.name, is_physical: m.is_physical ? 'true' : 'false', is_ar_charge: m.is_ar_charge, is_ar_credit: m.is_ar_credit, is_pdc: m.is_pdc })
    setArError('')
    setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) return
    if (form.is_ar_charge && form.is_ar_credit) {
      setArError('A payment mode cannot be both "Charge to AR Account" and "Draw from AR Credit" at the same time.')
      return
    }
    setArError('')
    setLoading(true)
    try {
      const p = {
        name: form.name.trim(),
        is_physical: form.is_physical === 'true',
        is_ar_charge: form.is_ar_charge,
        is_ar_credit: form.is_ar_credit,
        is_pdc: form.is_pdc,
      }
      editing
        ? await salesApi.paymentModes.patch(editing.payment_mode_id, p)
        : await salesApi.paymentModes.create(p)
      await qc.invalidateQueries({ queryKey: qk.paymentModes() })
      setShowForm(false)
    } finally { setLoading(false) }
  }

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <div className="flex justify-end mb-3">
        <Btn variant="primary" onClick={openNew}>+ Add Mode</Btn>
      </div>
      {showForm && (
        <InlineForm title={editing ? 'Edit Payment Mode' : 'New Payment Mode'} onCancel={() => setShowForm(false)} onSave={save} loading={loading}>
          <div>
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Cash, GCash, Visa…" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={selectCls} value={form.is_physical} onChange={e => setForm(f => ({ ...f, is_physical: e.target.value }))}>
              <option value="true">Physical</option>
              <option value="false">Digital</option>
            </select>
          </div>
          <div className="space-y-2 pt-1">
            <label className={labelCls}>AR Options</label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={form.is_ar_charge} onChange={e => setForm(f => ({ ...f, is_ar_charge: e.target.checked }))} />
              <span className="text-sm t-text-1">
                <span className="font-medium">Charge to AR Account</span>
                <span className="block text-xs t-text-2 mt-0.5">Selecting this mode at the POS charges the tender amount to the customer's AR account as new receivable debt. Requires a registered customer.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={form.is_ar_credit} onChange={e => setForm(f => ({ ...f, is_ar_credit: e.target.checked }))} />
              <span className="text-sm t-text-1">
                <span className="font-medium">Draw from AR Credit</span>
                <span className="block text-xs t-text-2 mt-0.5">Selecting this mode at the POS draws from the customer's existing credit balance (e.g. from prior returns or overpayments). Only visible when customer has available credit.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={form.is_pdc} onChange={e => setForm(f => ({ ...f, is_pdc: e.target.checked }))} />
              <span className="text-sm t-text-1">
                <span className="font-medium">Post Dated Check (PDC)</span>
                <span className="block text-xs t-text-2 mt-0.5">Marks this mode as a post-dated check. Requires check number, check date, and bank name at the point of sale. Tracked in the PDC Vault.</span>
              </span>
            </label>
            {arError && <p className="text-xs text-red-500 mt-1">{arError}</p>}
          </div>
        </InlineForm>
      )}
      <table className="w-full text-sm">
        <TableHead cols={['Name', 'Type', 'AR Flags', 'Status', 'Actions']} />
        <tbody>
          {isLoading && <SkeletonTable rows={3} cols={5} />}
          {items.map(m => (
            <tr key={m.payment_mode_id} className={`border-b t-border ${!m.is_active ? 'opacity-50' : ''}`}>
              <td className="px-3 py-2 t-text-1 font-medium">{m.name}</td>
              <td className="px-3 py-2 t-text-2 text-xs">{m.is_physical ? 'Physical' : 'Digital'}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {m.is_ar_charge && <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">AR Charge</span>}
                  {m.is_ar_credit && <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">AR Credit</span>}
                  {m.is_pdc && <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">PDC</span>}
                </div>
              </td>
              <td className="px-3 py-2"><StatusBadge active={m.is_active} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <Btn onClick={() => openEdit(m)}>Edit</Btn>
                  {m.is_active
                    ? <Btn variant="danger" onClick={async () => { await salesApi.paymentModes.patch(m.payment_mode_id, { is_active: false }); qc.invalidateQueries({ queryKey: qk.paymentModes() }) }}>Deactivate</Btn>
                    : <Btn variant="ghost" onClick={async () => { await salesApi.paymentModes.patch(m.payment_mode_id, { is_active: true }); qc.invalidateQueries({ queryKey: qk.paymentModes() }) }}>Reactivate</Btn>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 — EMPLOYEES & USERS
// ═══════════════════════════════════════════════════════════════════════════════

function EmployeesUsersTab() {
  const qc = useQueryClient()
  const { data: employees = [], isLoading: empLoading } = useQuery({ queryKey: qk.employees(), queryFn: authApi.employees.list, ...stale.auth })
  const { data: users = [],     isLoading: usrLoading } = useQuery({ queryKey: qk.users(),     queryFn: authApi.users.all,    ...stale.auth })
  const { data: roles = [] }                            = useQuery({ queryKey: qk.roles(),     queryFn: authApi.roles.list,   ...stale.auth })
  const isLoading = empLoading || usrLoading

  const [loading,        setLoading]        = useState(false)
  const [showEmpForm,    setShowEmpForm]    = useState(false)
  const [editingEmp,     setEditingEmp]     = useState<EmployeeOut | null>(null)
  const [empForm,        setEmpForm]        = useState({ first_name: '', last_name: '' })
  const [showUserForm,   setShowUserForm]   = useState(false)
  const [editingUser,    setEditingUser]    = useState<UserEntry | null>(null)
  const [preselectedEmp, setPreselectedEmp] = useState<EmployeeOut | null>(null)
  const [userForm,       setUserForm]       = useState({ employee_id: null as number | null, username: '', password: '' })
  const [userRoles,      setUserRoles]      = useState<string[]>([])
  const [changingPwdFor, setChangingPwdFor] = useState<number | null>(null)
  const [newPwd,         setNewPwd]         = useState('')

  // Only fetched when the Create Login / Add User form is open for a new user
  const { data: empWithoutUser = [] } = useQuery({
    queryKey: qk.employeesWithoutUser(),
    queryFn:  authApi.employees.withoutUser,
    enabled:  showUserForm && !editingUser,
    ...stale.auth,
  })

  async function invalidateAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.employees() }),
      qc.invalidateQueries({ queryKey: qk.users() }),
      qc.invalidateQueries({ queryKey: qk.employeesWithoutUser() }),
    ])
  }

  async function saveEmployee() {
    if (!empForm.first_name.trim() || !empForm.last_name.trim()) return
    setLoading(true)
    try {
      editingEmp
        ? await authApi.employees.patch(editingEmp.employee_id, { first_name: empForm.first_name.trim(), last_name: empForm.last_name.trim() })
        : await authApi.employees.create({ first_name: empForm.first_name.trim(), last_name: empForm.last_name.trim() })
      await invalidateAll(); setShowEmpForm(false)
    } finally { setLoading(false) }
  }

  async function saveUser() {
    setLoading(true)
    try {
      if (editingUser) {
        await authApi.users.setRoles(editingUser.user_id, userRoles)
      } else {
        if (!userForm.employee_id || !userForm.username.trim() || !userForm.password.trim()) { setLoading(false); return }
        await authApi.users.register({
          employee_id: userForm.employee_id,
          username:    userForm.username.trim(),
          password:    userForm.password,
          role_names:  userRoles,
        })
      }
      await invalidateAll(); setShowUserForm(false); setPreselectedEmp(null)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  function openEditUser(u: UserEntry) {
    setEditingUser(u); setUserRoles(u.roles.map(r => r.role_name)); setShowUserForm(true)
  }

  function openCreateLogin(emp: EmployeeOut) {
    setEditingUser(null)
    setPreselectedEmp(emp)
    setUserForm({ employee_id: emp.employee_id, username: '', password: '' })
    setUserRoles([])
    setShowUserForm(true)
  }

  async function savePassword() {
    if (!changingPwdFor || !newPwd.trim()) return
    setLoading(true)
    try { await authApi.users.changePassword(changingPwdFor, newPwd.trim()); setChangingPwdFor(null); setNewPwd('') }
    finally { setLoading(false) }
  }

  function userFormTitle() {
    if (editingUser) return `Edit User: ${editingUser.username}`
    if (preselectedEmp) return `Create Login — ${preselectedEmp.first_name} ${preselectedEmp.last_name}`
    return 'New User'
  }

  return (
    <div className="space-y-8">
      {/* Employees */}
      <div>
        <SubHead title="Employees" />
        <div className="flex justify-end mb-3">
          <Btn variant="primary" onClick={() => { setEditingEmp(null); setEmpForm({ first_name: '', last_name: '' }); setShowEmpForm(true) }}>+ Add Employee</Btn>
        </div>
        {showEmpForm && (
          <InlineForm title={editingEmp ? 'Edit Employee' : 'New Employee'} onCancel={() => setShowEmpForm(false)} onSave={saveEmployee} loading={loading}>
            <div><label className={labelCls}>First Name *</label><input className={inputCls} value={empForm.first_name} onChange={e => setEmpForm(f => ({ ...f, first_name: e.target.value }))} /></div>
            <div><label className={labelCls}>Last Name *</label><input className={inputCls} value={empForm.last_name} onChange={e => setEmpForm(f => ({ ...f, last_name: e.target.value }))} /></div>
          </InlineForm>
        )}
        <table className="w-full text-sm">
          <TableHead cols={['First Name', 'Last Name', 'Login', 'Status', 'Actions']} />
          <tbody>
            {isLoading && <SkeletonTable rows={4} cols={5} />}
            {employees.map(e => (
              <tr key={e.employee_id} className={`border-b t-border ${!e.is_active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 t-text-1">{e.first_name}</td>
                <td className="px-3 py-2 t-text-1">{e.last_name}</td>
                <td className="px-3 py-2">
                  {e.has_user
                    ? <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-emerald-950 text-[var(--success)]">Has Login</span>
                    : <span className="text-[10px] t-text-4 italic">No login</span>}
                </td>
                <td className="px-3 py-2"><StatusBadge active={e.is_active} /></td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 flex-wrap">
                    <Btn onClick={() => { setEditingEmp(e); setEmpForm({ first_name: e.first_name, last_name: e.last_name }); setShowEmpForm(true) }}>Edit</Btn>
                    {!e.has_user && e.is_active && (
                      <Btn variant="primary" onClick={() => openCreateLogin(e)}>Create Login</Btn>
                    )}
                    {e.is_active
                      ? <Btn variant="danger" onClick={async () => { await authApi.employees.patch(e.employee_id, { is_active: false }); invalidateAll() }}>Deactivate</Btn>
                      : <Btn variant="ghost" onClick={async () => { await authApi.employees.patch(e.employee_id, { is_active: true }); invalidateAll() }}>Reactivate</Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Users */}
      <div>
        <SubHead title="Users" />
        <div className="flex justify-end mb-3">
          <Btn variant="primary" onClick={() => {
            setEditingUser(null); setPreselectedEmp(null)
            setUserForm({ employee_id: null, username: '', password: '' })
            setUserRoles([]); setShowUserForm(true)
          }}>+ Add User</Btn>
        </div>
        {showUserForm && (
          <InlineForm title={userFormTitle()} onCancel={() => { setShowUserForm(false); setPreselectedEmp(null) }} onSave={saveUser} loading={loading}>
            {!editingUser && (
              <>
                {/* Employee selector — locked if opened from "Create Login" button */}
                <div className="col-span-full sm:col-span-2">
                  <label className={labelCls}>Employee *</label>
                  {preselectedEmp ? (
                    <div className="t-bg-input border t-border-strong rounded px-2 py-1.5 text-sm t-text-2">
                      {preselectedEmp.first_name} {preselectedEmp.last_name}
                      <span className="ml-2 text-[10px] t-text-4">(pre-selected)</span>
                    </div>
                  ) : (
                    <select
                      className={selectCls}
                      value={userForm.employee_id ?? ''}
                      onChange={e => setUserForm(f => ({ ...f, employee_id: e.target.value ? Number(e.target.value) : null }))}
                    >
                      <option value="">— select employee —</option>
                      {empWithoutUser.map(emp => (
                        <option key={emp.employee_id} value={emp.employee_id}>
                          {emp.last_name}, {emp.first_name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div><label className={labelCls}>Username *</label><input className={inputCls} value={userForm.username} onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))} /></div>
                <div><label className={labelCls}>Temp Password *</label><input type="password" className={inputCls} value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} /></div>
              </>
            )}
            <div className="col-span-full">
              <label className={labelCls}>Roles</label>
              <div className="flex flex-wrap gap-3 mt-1">
                {roles.map(r => (
                  <label key={r.role_id} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" className="accent-[var(--accent)]"
                      checked={userRoles.includes(r.role_name)}
                      onChange={() => setUserRoles(prev => prev.includes(r.role_name) ? prev.filter(x => x !== r.role_name) : [...prev, r.role_name])} />
                    <span className="text-[11px] t-text-2">{r.role_name}</span>
                  </label>
                ))}
              </div>
            </div>
          </InlineForm>
        )}
        <table className="w-full text-sm">
          <TableHead cols={['Username', 'Linked Employee', 'Roles', 'Status', 'Actions']} />
          <tbody>
            {isLoading && <SkeletonTable rows={4} cols={5} />}
            {users.map(u => (
              <tr key={u.user_id} className={`border-b t-border ${!u.is_active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 t-text-1 font-mono text-xs font-medium">{u.username}</td>
                <td className="px-3 py-2 t-text-2 text-xs">
                  {u.employee ? `${u.employee.first_name} ${u.employee.last_name}` : '—'}
                  {u.employee && !u.employee.is_active && <span className="ml-1 t-text-3 text-[10px]">(inactive)</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0
                      ? <span className="text-[10px] t-text-4 italic">none</span>
                      : u.roles.map(r => (
                          <span key={r.role_id} className="text-[10px] rounded px-1.5 py-0.5 font-medium"
                            style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>
                            {r.role_name}
                          </span>
                        ))}
                  </div>
                </td>
                <td className="px-3 py-2"><StatusBadge active={u.is_active} /></td>
                <td className="px-3 py-2">
                  {changingPwdFor === u.user_id ? (
                    <div className="flex gap-1.5 items-center">
                      <input type="password" placeholder="New password"
                        className="t-bg-elevated border t-border-strong rounded px-2 py-0.5 text-xs t-text-1 w-28 focus:outline-none focus:ring-1 ring-[var(--accent)]"
                        value={newPwd} onChange={e => setNewPwd(e.target.value)} />
                      <Btn variant="primary" onClick={savePassword} disabled={loading} small>Save</Btn>
                      <Btn variant="ghost" onClick={() => { setChangingPwdFor(null); setNewPwd('') }} small>×</Btn>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 flex-wrap">
                      <Btn onClick={() => openEditUser(u)}>Roles</Btn>
                      <Btn onClick={() => { setChangingPwdFor(u.user_id); setNewPwd('') }}>Pwd</Btn>
                      {u.is_active
                        ? <Btn variant="danger" onClick={async () => { await authApi.users.setActive(u.user_id, false); invalidateAll() }}>Deactivate</Btn>
                        : <Btn variant="ghost" onClick={async () => { await authApi.users.setActive(u.user_id, true); invalidateAll() }}>Reactivate</Btn>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] t-text-4 mt-2">Deactivating a user also deactivates their linked employee record.</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6 — ROLES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Permission Matrix (sub-component, mounted when a role is being edited) ────

function PermissionMatrix({
  role,
  onClose,
}: {
  role: RoleEntry
  onClose: () => void
}) {
  const qc = useQueryClient()

  const { data: catalogue = [], isLoading: catalogueLoading } = useQuery({
    queryKey: qk.programs(),
    queryFn: authApi.programs.list,
    ...stale.auth,
  })

  const { data: current, isLoading: permLoading } = useQuery({
    queryKey: qk.rolePermissions(role.role_id!),
    queryFn: () => authApi.roles.getPermissions(role.role_id!),
  })

  const [programKeys, setProgramKeys] = useState<Set<string>>(new Set())
  const [actionKeys,  setActionKeys]  = useState<Set<string>>(new Set())
  const [saveErr,     setSaveErr]     = useState<string | null>(null)

  // Populate from server data once loaded
  const [initialised, setInitialised] = useState(false)
  if (current && !initialised) {
    setProgramKeys(new Set(current.program_keys))
    setActionKeys(new Set(current.action_keys))
    setInitialised(true)
  }

  const saveMutation = useMutation({
    mutationFn: (payload: RolePermissions) =>
      authApi.roles.setPermissions(role.role_id!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.rolePermissions(role.role_id!) })
      setSaveErr(null)
      onClose()
    },
    onError: (e: unknown) => {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    },
  })

  function toggleProgram(pk: string, programActions: string[]) {
    setProgramKeys(prev => {
      const next = new Set(prev)
      if (next.has(pk)) {
        next.delete(pk)
        // uncheck all actions that belong to this program
        setActionKeys(ak => {
          const nextAk = new Set(ak)
          programActions.forEach(a => nextAk.delete(a))
          return nextAk
        })
      } else {
        next.add(pk)
      }
      return next
    })
  }

  function toggleAction(ak: string, pk: string) {
    setActionKeys(prev => {
      const next = new Set(prev)
      if (next.has(ak)) {
        next.delete(ak)
      } else {
        next.add(ak)
        // auto-check the parent program
        setProgramKeys(pp => {
          const nextPp = new Set(pp)
          nextPp.add(pk)
          return nextPp
        })
      }
      return next
    })
  }

  function handleSave() {
    setSaveErr(null)
    saveMutation.mutate({
      program_keys: Array.from(programKeys),
      action_keys:  Array.from(actionKeys),
    })
  }

  const isLoading = catalogueLoading || permLoading

  return (
    <div className="t-bg-elevated border t-border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3">
          Permissions — <span className="font-mono t-text-1">{role.role_name}</span>
        </p>
        <div className="flex gap-2">
          <Btn variant="primary" onClick={handleSave} disabled={saveMutation.isPending || isLoading}>
            {saveMutation.isPending ? 'Saving…' : 'Save Permissions'}
          </Btn>
          <Btn variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>Cancel</Btn>
        </div>
      </div>

      {saveErr && (
        <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">
          {saveErr}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-8 t-bg-input rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-5">
          {(catalogue as ModuleGroup[]).map(mg => (
            <div key={mg.module}>
              <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3 mb-2">
                {mg.module}
              </p>
              <div className="space-y-2 pl-2">
                {mg.programs.map(prog => {
                  const progActionKeys = prog.actions.map(a => a.action_key)
                  const progChecked    = programKeys.has(prog.program_key)
                  return (
                    <div key={prog.program_key} className="t-bg-input border t-border rounded p-2">
                      {/* Program row */}
                      <label className="flex items-center gap-2 cursor-pointer mb-1">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={progChecked}
                          onChange={() => toggleProgram(prog.program_key, progActionKeys)}
                        />
                        <span className="text-xs font-semibold t-text-1">{prog.display_name}</span>
                        <span className="text-[10px] t-text-4 font-mono">{prog.program_key}</span>
                      </label>
                      {/* Action sub-rows — only visible when program is checked */}
                      {progChecked && (
                        <div className="pl-5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                          {prog.actions.map(act => (
                            <label key={act.action_key} className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                className="accent-[var(--accent)]"
                                checked={actionKeys.has(act.action_key)}
                                onChange={() => toggleAction(act.action_key, prog.program_key)}
                              />
                              <span className="text-[11px] t-text-2">{act.display_name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── RolesTab ──────────────────────────────────────────────────────────────────

function RolesTab() {
  const qc = useQueryClient()
  const { data: roles = [], isLoading, isFetching } = useQuery({ queryKey: qk.roles(), queryFn: authApi.roles.list, ...stale.auth })
  const { data: allUsers = [] }                     = useQuery({ queryKey: qk.users(), queryFn: authApi.users.all,  ...stale.auth })
  const users = allUsers.filter(u => u.is_active)

  const [showForm,      setShowForm]      = useState(false)
  const [editing,       setEditing]       = useState<RoleEntry | null>(null)
  const [roleName,      setRoleName]      = useState('')
  const [loading,       setLoading]       = useState(false)
  const [deleteErr,     setDeleteErr]     = useState<string | null>(null)
  const [editingAssign, setEditingAssign] = useState<number | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [editingPerms,  setEditingPerms]  = useState<RoleEntry | null>(null)

  async function invalidateAll() {
    await Promise.all([qc.invalidateQueries({ queryKey: qk.roles() }), qc.invalidateQueries({ queryKey: qk.users() })])
  }

  async function saveRole() {
    if (!roleName.trim()) return
    setLoading(true)
    try {
      editing ? await authApi.roles.patch(editing.role_id!, roleName.trim()) : await authApi.roles.create(roleName.trim())
      await qc.invalidateQueries({ queryKey: qk.roles() }); setShowForm(false)
    } finally { setLoading(false) }
  }

  async function deleteRole(r: RoleEntry) {
    setDeleteErr(null)
    try { await authApi.roles.delete(r.role_id!); await qc.invalidateQueries({ queryKey: qk.roles() }) }
    catch (e: unknown) { setDeleteErr(e instanceof Error ? e.message : 'Delete failed') }
  }

  async function saveAssignment(userId: number) {
    setLoading(true)
    try {
      await authApi.users.setRoles(userId, selectedRoles)
      await qc.invalidateQueries({ queryKey: qk.users() })
      setEditingAssign(null)
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-8">
      <div>
        <SubHead title="Role Definitions" />
        <FetchingBar show={isFetching && !isLoading} />
        <div className="flex justify-end mb-3">
          <Btn variant="primary" onClick={() => { setEditing(null); setRoleName(''); setShowForm(true) }}>+ Add Role</Btn>
        </div>
        {deleteErr && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{deleteErr}</div>}
        {showForm && (
          <InlineForm title={editing ? 'Edit Role' : 'New Role'} onCancel={() => setShowForm(false)} onSave={saveRole} loading={loading}>
            <div>
              <label className={labelCls}>Role Name * (auto-uppercased)</label>
              <input className={inputCls} value={roleName} onChange={e => setRoleName(e.target.value.toUpperCase())} placeholder="MY_ROLE" />
            </div>
          </InlineForm>
        )}
        <table className="w-full text-sm">
          <TableHead cols={['Role Name', 'Assigned Users', 'Actions']} />
          <tbody>
            {isLoading && <SkeletonTable rows={3} cols={3} />}
            {roles.map(r => (
              <tr key={r.role_id} className="border-b t-border">
                <td className="px-3 py-2 t-text-1 font-medium font-mono text-xs">{r.role_name}</td>
                <td className="px-3 py-2 t-text-2 text-xs tabular-nums">{r.user_count ?? 0}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <Btn onClick={() => { setEditing(r); setRoleName(r.role_name); setShowForm(true) }}>Rename</Btn>
                    <Btn onClick={() => setEditingPerms(editingPerms?.role_id === r.role_id ? null : r)}>
                      {editingPerms?.role_id === r.role_id ? 'Close' : 'Permissions'}
                    </Btn>
                    {(r.user_count ?? 0) === 0
                      ? <Btn variant="danger" onClick={() => deleteRole(r)}>Delete</Btn>
                      : <span className="text-[10px] t-text-3 italic self-center">{r.user_count} assigned</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] t-text-4 mt-2">Roles can only be deleted when no users are assigned. Hard delete — no recovery.</p>
      </div>

      {/* Permission matrix — shown inline below the table when a role is selected */}
      {editingPerms && (
        <PermissionMatrix
          role={editingPerms}
          onClose={() => setEditingPerms(null)}
        />
      )}

      <div>
        <SubHead title="Role Assignment" />
        <table className="w-full text-sm">
          <TableHead cols={['Username', 'Current Roles', 'Actions']} />
          <tbody>
            {users.map(u => (
              <tr key={u.user_id} className="border-b t-border">
                <td className="px-3 py-2 t-text-1 font-mono text-xs w-36">{u.username}</td>
                <td className="px-3 py-2">
                  {editingAssign === u.user_id ? (
                    <div className="flex flex-wrap gap-3">
                      {roles.map(r => (
                        <label key={r.role_id} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" className="accent-[var(--accent)]"
                            checked={selectedRoles.includes(r.role_name)}
                            onChange={() => setSelectedRoles(prev => prev.includes(r.role_name) ? prev.filter(x => x !== r.role_name) : [...prev, r.role_name])} />
                          <span className="text-[11px] t-text-2">{r.role_name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0
                        ? <span className="text-[10px] t-text-4 italic">no roles</span>
                        : u.roles.map(r => (
                            <span key={r.role_id} className="text-[10px] rounded px-1.5 py-0.5 font-medium"
                              style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>
                              {r.role_name}
                            </span>
                          ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 w-32">
                  {editingAssign === u.user_id ? (
                    <div className="flex gap-1.5">
                      <Btn variant="primary" onClick={() => saveAssignment(u.user_id)} disabled={loading}>{loading ? '…' : 'Save'}</Btn>
                      <Btn variant="ghost" onClick={() => setEditingAssign(null)}>Cancel</Btn>
                    </div>
                  ) : (
                    <Btn onClick={() => { setEditingAssign(u.user_id); setSelectedRoles(u.roles.map(r => r.role_name)) }}>Edit</Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] t-text-4 mt-2">Only active users shown. Changes take effect on next login.</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 7 — UOMs
// ═══════════════════════════════════════════════════════════════════════════════

function UOMsTab() {
  const qc = useQueryClient()
  const { data: rawUoms = [], isLoading, isFetching } = useQuery({ queryKey: qk.uoms(), queryFn: catalogueApi.uoms.list, ...stale.reference })
  const items = rawUoms.filter(u => !u.is_deleted)

  const [showForm,  setShowForm]  = useState(false)
  const [editing,   setEditing]   = useState<UOM | null>(null)
  const [form,      setForm]      = useState({ uom_code: '', uom_name: '' })
  const [loading,   setLoading]   = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  function openAdd() { setEditing(null); setForm({ uom_code: '', uom_name: '' }); setDeleteErr(null); setShowForm(true) }
  function openEdit(u: UOM) { setEditing(u); setForm({ uom_code: u.uom_code, uom_name: u.uom_name ?? '' }); setDeleteErr(null); setShowForm(true) }

  async function save() {
    if (!form.uom_code.trim() && !editing) return
    setLoading(true)
    try {
      editing
        ? await catalogueApi.uoms.patch(editing.uom_id, { uom_name: form.uom_name.trim() || undefined })
        : await catalogueApi.uoms.create({ uom_code: form.uom_code.trim(), uom_name: form.uom_name.trim() || undefined })
      await qc.invalidateQueries({ queryKey: qk.uoms() }); setShowForm(false)
    } finally { setLoading(false) }
  }

  async function handleDelete(u: UOM) {
    setDeleteErr(null)
    try { await catalogueApi.uoms.delete(u.uom_id); await qc.invalidateQueries({ queryKey: qk.uoms() }) }
    catch (e: unknown) { setDeleteErr(e instanceof Error ? e.message : 'Delete failed') }
  }

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <div className="flex justify-end mb-3"><Btn variant="primary" onClick={openAdd}>+ Add UOM</Btn></div>
      {deleteErr && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{deleteErr}</div>}
      {showForm && (
        <InlineForm title={editing ? 'Edit UOM' : 'New UOM'} onCancel={() => setShowForm(false)} onSave={save} loading={loading}>
          <div>
            <label className={labelCls}>Code * {editing && <span className="t-text-4 normal-case font-normal">(read-only)</span>}</label>
            <input className={inputCls} value={form.uom_code} readOnly={!!editing}
              onChange={e => setForm(f => ({ ...f, uom_code: e.target.value.toUpperCase() }))} placeholder="PC, BOX, KG…" />
          </div>
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={form.uom_name} onChange={e => setForm(f => ({ ...f, uom_name: e.target.value }))} placeholder="Piece, Box, Kilogram…" />
          </div>
        </InlineForm>
      )}
      <table className="w-full text-sm">
        <TableHead cols={['Code', 'Name', 'Actions']} />
        <tbody>
          {isLoading && <SkeletonTable rows={4} cols={3} />}
          {items.map(u => (
            <tr key={u.uom_id} className="border-b t-border">
              <td className="px-3 py-2 t-text-1 font-mono font-medium">{u.uom_code}</td>
              <td className="px-3 py-2 t-text-2">{u.uom_name ?? '—'}</td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <Btn onClick={() => openEdit(u)}>Edit</Btn>
                  <Btn variant="danger" onClick={() => handleDelete(u)}>Delete</Btn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] t-text-4 mt-2">Hard delete — blocked if any product, barcode, or UOM conversion references this code.</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 8 — CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

function CategoriesTab() {
  const qc = useQueryClient()
  const { data: rawCats = [], isLoading, isFetching } = useQuery({ queryKey: qk.categories(), queryFn: catalogueApi.categories.list, ...stale.reference })
  const items = rawCats.filter(c => !c.is_deleted)

  const [showForm,  setShowForm]  = useState(false)
  const [editing,   setEditing]   = useState<Category | null>(null)
  const [form,      setForm]      = useState({ category_name: '', parent_category_id: '' })
  const [loading,   setLoading]   = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  function openAdd() { setEditing(null); setForm({ category_name: '', parent_category_id: '' }); setDeleteErr(null); setShowForm(true) }
  function openEdit(c: Category) {
    setEditing(c); setForm({ category_name: c.category_name, parent_category_id: c.parent_category_id ? String(c.parent_category_id) : '' })
    setDeleteErr(null); setShowForm(true)
  }

  async function save() {
    if (!form.category_name.trim()) return
    setLoading(true)
    try {
      const payload = { category_name: form.category_name.trim(), parent_category_id: form.parent_category_id ? parseInt(form.parent_category_id) : null }
      editing ? await catalogueApi.categories.patch(editing.category_id, payload) : await catalogueApi.categories.create(payload)
      await qc.invalidateQueries({ queryKey: qk.categories() }); setShowForm(false)
    } finally { setLoading(false) }
  }

  async function handleDelete(c: Category) {
    setDeleteErr(null)
    try { await catalogueApi.categories.delete(c.category_id); await qc.invalidateQueries({ queryKey: qk.categories() }) }
    catch (e: unknown) { setDeleteErr(e instanceof Error ? e.message : 'Delete failed') }
  }

  const parentOptions = items.filter(c => c.category_id !== editing?.category_id)

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <div className="flex justify-end mb-3"><Btn variant="primary" onClick={openAdd}>+ Add Category</Btn></div>
      {deleteErr && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{deleteErr}</div>}
      {showForm && (
        <InlineForm title={editing ? 'Edit Category' : 'New Category'} onCancel={() => setShowForm(false)} onSave={save} loading={loading}>
          <div><label className={labelCls}>Name *</label><input className={inputCls} value={form.category_name} onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))} /></div>
          <div>
            <label className={labelCls}>Parent Category</label>
            <select className={selectCls} value={form.parent_category_id} onChange={e => setForm(f => ({ ...f, parent_category_id: e.target.value }))}>
              <option value="">— top level —</option>
              {parentOptions.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
            </select>
          </div>
        </InlineForm>
      )}
      <table className="w-full text-sm">
        <TableHead cols={['Name', 'Parent', 'Actions']} />
        <tbody>
          {isLoading && <SkeletonTable rows={4} cols={3} />}
          {items.map(c => (
            <tr key={c.category_id} className="border-b t-border">
              <td className="px-3 py-2 t-text-1 font-medium">{c.category_name}</td>
              <td className="px-3 py-2 t-text-2 text-xs">{c.parent_category_id ? items.find(p => p.category_id === c.parent_category_id)?.category_name ?? '—' : '—'}</td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <Btn onClick={() => openEdit(c)}>Edit</Btn>
                  <Btn variant="danger" onClick={() => handleDelete(c)}>Delete</Btn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] t-text-4 mt-2">Hard delete — blocked if any products are linked or child categories exist.</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 9 — APPEARANCE (no data fetching — unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

interface ThemeOption { id: Theme; name: string; description: string; preview: { base: string; surface: string; text: string; accent: string } }
const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark',   name: 'Dark',   description: 'Neutral dark — the default. Deep grays with blue accents. Low eye strain for extended sessions.', preview: { base: '#030712', surface: '#111827', text: '#f3f4f6', accent: '#2563eb' } },
  { id: 'light',  name: 'Light',  description: 'Clean light — high contrast for bright environments. Dark nav preserved for visual anchoring.', preview: { base: '#f9fafb', surface: '#ffffff', text: '#111827', accent: '#2563eb' } },
  { id: 'carbon', name: 'Carbon', description: 'Pitch-black zinc surfaces with teal accents. Inspired by high-end financial data terminals and OLED displays. Maximum data density, minimal visual noise.', preview: { base: '#09090b', surface: '#18181b', text: '#fafafa', accent: '#14b8a6' } },
]

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const { altRows, setAltRows } = useAltRows()
  return (
    <div>
      <p className="text-xs t-text-2 mb-6">Choose a color mode. The selection is saved to your browser and applied immediately.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {THEME_OPTIONS.map(opt => {
          const active = theme === opt.id
          return (
            <button key={opt.id} onClick={() => setTheme(opt.id)}
              className={`text-left rounded-lg border-2 overflow-hidden transition-all ${active ? 'shadow-lg' : 'opacity-80 hover:opacity-100'}`}
              style={{ borderColor: active ? 'var(--accent)' : 'var(--bd)' }}>
              <div className="h-20 flex flex-col p-3 gap-1.5" style={{ background: opt.preview.base }}>
                <div className="rounded px-2 py-1 text-[10px] font-medium w-fit" style={{ background: opt.preview.surface, color: opt.preview.text }}>{opt.name}</div>
                <div className="flex gap-1.5 mt-auto">
                  <div className="h-2 w-12 rounded-full" style={{ background: opt.preview.accent }} />
                  <div className="h-2 w-8 rounded-full opacity-40" style={{ background: opt.preview.text }} />
                  <div className="h-2 w-6 rounded-full opacity-20" style={{ background: opt.preview.text }} />
                </div>
              </div>
              <div className="p-3 t-bg-surface">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold t-text-1">{opt.name}</span>
                  {active && <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)' }}>Active</span>}
                </div>
                <p className="text-[11px] t-text-3 leading-relaxed">{opt.description}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Table display ── */}
      <div className="mt-8">
        <SubHead title="Table Display" />
        <label className="flex items-start gap-3 cursor-pointer w-fit">
          <input type="checkbox" className="accent-[var(--accent)] mt-0.5 w-4 h-4 shrink-0"
            checked={altRows} onChange={e => setAltRows(e.target.checked)} />
          <div>
            <p className="text-xs font-semibold t-text-1">Alternating Rows</p>
            <p className="text-[11px] t-text-3 mt-0.5 leading-relaxed max-w-sm">
              Applies a subtle alternating background to all tables app-wide. Improves row tracking on long lists.
            </p>
          </div>
        </label>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 10 — INVENTORY POLICY
// ═══════════════════════════════════════════════════════════════════════════════

function InventoryPolicyTab() {
  const qc = useQueryClient()
  const { data: policy, isLoading, isFetching } = useQuery({
    queryKey: qk.inventoryPolicy(),
    queryFn: settingsApi.inventoryPolicy.get,
    ...stale.reference,
  })
  const [saving, setSaving] = useState(false)

  async function toggle(value: boolean) {
    setSaving(true)
    try {
      await settingsApi.inventoryPolicy.patch({ allow_negative_stock: value })
      await qc.invalidateQueries({ queryKey: qk.inventoryPolicy() })
    } finally {
      setSaving(false)
    }
  }

  const enabled = policy?.allow_negative_stock ?? false

  return (
    <div>
      <FetchingBar show={isFetching && !isLoading} />
      <p className="text-xs t-text-2 mb-6">
        Controls how the system handles stock levels during sales and transfers.
      </p>

      <SubHead title="Stock Behavior" />

      {isLoading ? (
        <div className="h-16 t-bg-elevated rounded animate-pulse" />
      ) : (
        <div className="t-bg-elevated border t-border rounded-lg p-4 max-w-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold t-text-1">Allow Negative Stock</p>
              <p className="text-[11px] t-text-3 mt-1 leading-relaxed max-w-sm">
                When enabled, sales and transfers will post even if stock levels would go below
                zero. Useful for after-the-fact auditor encoding where stock counts may not be
                current.
              </p>
            </div>
            {/* Toggle switch */}
            <button
              onClick={() => toggle(!enabled)}
              disabled={saving}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${enabled ? '' : 't-bg-input border t-border-strong'}`}
              style={enabled ? { backgroundColor: 'var(--accent)' } : undefined}
              aria-label="Toggle allow negative stock"
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${enabled ? 'bg-amber-950 text-amber-400' : 'bg-emerald-950 text-emerald-500'}`}>
              {enabled ? 'On' : 'Off'}
            </span>
            {policy?.updated_at && (
              <span className="text-[10px] t-text-4">
                Last updated {new Date(policy.updated_at).toLocaleString()}
                {policy.updated_by_username ? ` by ${policy.updated_by_username}` : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Settings() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabName>('Locations')

  if (!user || !user.programs.includes('settings')) return <Navigate to="/" replace />

  const visibleTabs = TABS.filter(tab => {
    if (tab === 'Import') {
      return IMPORT_DATA_ACTIONS.some(a => user?.action_keys?.includes(a))
    }
    const key = TAB_ACTION_MAP[tab]
    return key != null && (user?.action_keys?.includes(key) ?? false)
  })

  const tabContent: Record<TabName, ReactNode> = {
    'Locations':         <LocationsTab />,
    'Shifts':            <ShiftsTab />,
    'Registers':         <RegistersTab />,
    'Payment Modes':     <PaymentModesTab />,
    'UOMs':              <UOMsTab />,
    'Categories':        <CategoriesTab />,
    'Employees & Users': <EmployeesUsersTab />,
    'Roles':             <RolesTab />,
    'Appearance':        <AppearanceTab />,
    'Inventory Policy':  <InventoryPolicyTab />,
    'Import':            <Suspense fallback={<div className="p-4 text-xs t-text-4 animate-pulse">Loading…</div>}><ImportHub /></Suspense>,
  }

  if (visibleTabs.length === 0) {
    return (
      <div className="min-h-full t-bg-base px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-5">
            <h1 className="text-sm font-semibold t-text-1 tracking-tight">Settings</h1>
            <p className="text-xs t-text-3 mt-0.5">System configuration for all modules.</p>
          </div>
          <div className="t-bg-surface border t-border rounded-lg p-5">
            <p className="text-sm t-text-3">You do not have access to any settings sections. Contact your administrator.</p>
          </div>
        </div>
      </div>
    )
  }

  const effectiveTab = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0]!

  return (
    <div className="min-h-full t-bg-base px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-sm font-semibold t-text-1 tracking-tight">Settings</h1>
          <p className="text-xs t-text-3 mt-0.5">System configuration for all modules.</p>
        </div>
        <div className="flex gap-0.5 border-b t-border mb-6 overflow-x-auto">
          {visibleTabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                effectiveTab === tab ? 't-text-1 border-[var(--accent)]' : 't-text-3 border-transparent hover:t-text-2'
              }`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="t-bg-surface border t-border rounded-lg p-5">
          {tabContent[effectiveTab]}
        </div>
      </div>
    </div>
  )
}
