import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import {
  apApi, catalogueApi,
  type InvoiceOut, type ApPaymentCreate, type InvoiceApplicationCreate,
} from '../../services/api'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function php(n: number | null | undefined) {
  if (n == null) return '—'
  return `₱${fmt(n)}`
}
function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── class constants ───────────────────────────────────────────────────────────

const selCls   = 'px-2 py-1.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'
const inputCls = 'w-full px-2.5 py-1.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'
const btnPrimary   = 'px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors'
const btnSecondary = 'px-3 py-1.5 text-xs font-medium t-bg-elevated border t-border t-text-1 rounded hover:t-bg-surface disabled:opacity-50 transition-colors'

// ── ApplyRow ──────────────────────────────────────────────────────────────────

interface ApplyRowProps {
  invoices: InvoiceOut[]
  app: { invoice_id: number; amount_applied: string }
  onChange: (invoice_id: number, amount: string) => void
  onRemove: () => void
}

function ApplyRow({ invoices, app, onChange, onRemove }: ApplyRowProps) {
  const inv = invoices.find(i => i.invoice_id === app.invoice_id)
  const effective = inv ? (inv.amended_amount ?? inv.total_amount) : null

  return (
    <div className="flex gap-2 items-center">
      <div className="flex-1 text-xs t-text-1">
        {inv ? (
          <span className="font-mono">{inv.invoice_number ?? `#${inv.invoice_id}`}</span>
        ) : (
          <span className="t-text-4">Invoice #{app.invoice_id}</span>
        )}
        {effective != null && <span className="t-text-3 ml-2">({php(effective)})</span>}
      </div>
      <input
        type="number"
        step="0.01"
        placeholder="Amount applied"
        value={app.amount_applied}
        onChange={e => onChange(app.invoice_id, e.target.value)}
        className="w-32 px-2 py-1 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button onClick={onRemove} className="text-xs text-red-500 hover:text-red-700 shrink-0">✕</button>
    </div>
  )
}

// ── New Payment Form ──────────────────────────────────────────────────────────

interface NewPaymentFormProps {
  onClose: () => void
  onSaved: () => void
}

function NewPaymentForm({ onClose, onSaved }: NewPaymentFormProps) {
  const qc = useQueryClient()
  const [suppId, setSuppId]   = useState('')
  const [amount, setAmount]   = useState('')
  const [date, setDate]       = useState(todayLocal())
  const [ref, setRef]         = useState('')
  const [method, setMethod]   = useState('')

  // invoice applications: list of { invoice_id, amount_applied (string for form) }
  const [apps, setApps] = useState<{ invoice_id: number; amount_applied: string }[]>([])
  const [addingInv, setAddingInv] = useState<string>('')

  const suppQ = useQuery({
    queryKey: qk.suppliers(),
    queryFn:  () => catalogueApi.suppliers.list(),
    staleTime: stale.reference,
  })

  const openInvQ = useQuery({
    queryKey: qk.invoices(suppId ? Number(suppId) : undefined),
    queryFn:  () => apApi.invoices.list({ supplier_id: Number(suppId) }),
    staleTime: stale.transactional,
    enabled:   !!suppId,
  })
  const openInvoices = useMemo<InvoiceOut[]>(
    () => (openInvQ.data ?? []).filter(i => i.status !== 'Paid'),
    [openInvQ.data],
  )
  const unappliedInvoices = openInvoices.filter(i => !apps.some(a => a.invoice_id === i.invoice_id))

  function addApplication() {
    const id = Number(addingInv)
    if (!id || apps.some(a => a.invoice_id === id)) return
    setApps(prev => [...prev, { invoice_id: id, amount_applied: '' }])
    setAddingInv('')
  }

  function updateApp(invoice_id: number, amount_applied: string) {
    setApps(prev => prev.map(a => a.invoice_id === invoice_id ? { ...a, amount_applied } : a))
  }

  function removeApp(invoice_id: number) {
    setApps(prev => prev.filter(a => a.invoice_id !== invoice_id))
  }

  const createMut = useMutation({
    mutationFn: (p: ApPaymentCreate) => apApi.payments.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['ap', 'ledger'] })
      qc.invalidateQueries({ queryKey: ['ap', 'aging'] })
      onSaved()
    },
  })

  function handleSubmit() {
    if (!suppId || !amount) return
    const applications: InvoiceApplicationCreate[] = apps
      .filter(a => a.amount_applied !== '')
      .map(a => ({ invoice_id: a.invoice_id, amount_applied: Number(a.amount_applied) }))
    createMut.mutate({
      supplier_id:      Number(suppId),
      amount:           Number(amount),
      payment_date:     date || undefined,
      reference_number: ref || undefined,
      payment_method:   method || undefined,
      applications,
    })
  }

  return (
    <div className="rounded-lg border t-border t-bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold t-text-1">Record Payment</h3>
        <button onClick={onClose} className="text-xs t-text-4 hover:t-text-2">Cancel</button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Supplier *</label>
          <select className={`${selCls} w-full mt-0.5`} value={suppId} onChange={e => { setSuppId(e.target.value); setApps([]) }}>
            <option value="">Select supplier</option>
            {(suppQ.data ?? []).map(s => (
              <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Total Amount *</label>
          <input
            type="number" step="0.01" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)}
            className={`${inputCls} mt-0.5`}
          />
        </div>

        <div>
          <label className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Payment Date</label>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className={`${inputCls} mt-0.5`}
          />
        </div>

        <div>
          <label className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Reference</label>
          <input
            type="text" placeholder="Check #, wire ref…"
            value={ref} onChange={e => setRef(e.target.value)}
            className={`${inputCls} mt-0.5`}
          />
        </div>

        <div>
          <label className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Method</label>
          <input
            type="text" placeholder="Check, wire, cash…"
            value={method} onChange={e => setMethod(e.target.value)}
            className={`${inputCls} mt-0.5`}
          />
        </div>
      </div>

      {/* invoice applications */}
      {suppId && (
        <div className="space-y-2 border-t t-border pt-3">
          <p className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Apply to Invoices</p>

          {apps.map(app => (
            <ApplyRow
              key={app.invoice_id}
              invoices={openInvoices}
              app={app}
              onChange={updateApp}
              onRemove={() => removeApp(app.invoice_id)}
            />
          ))}

          {unappliedInvoices.length > 0 && (
            <div className="flex gap-2">
              <select
                className={selCls}
                value={addingInv}
                onChange={e => setAddingInv(e.target.value)}
              >
                <option value="">Add invoice…</option>
                {unappliedInvoices.map(i => (
                  <option key={i.invoice_id} value={i.invoice_id}>
                    {i.invoice_number ?? `#${i.invoice_id}`} — {php(i.amended_amount ?? i.total_amount)} ({i.vetting_status === 'Approved' ? 'Approved' : 'Not approved'})
                  </option>
                ))}
              </select>
              <button onClick={addApplication} disabled={!addingInv} className={btnSecondary}>
                Add
              </button>
            </div>
          )}

          {openInvQ.isLoading && <p className="text-xs t-text-4 animate-pulse">Loading invoices…</p>}
        </div>
      )}

      {createMut.isError && (
        <p className="text-xs text-red-600">{String(createMut.error)}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!suppId || !amount || createMut.isPending}
          className={btnPrimary}
        >
          {createMut.isPending ? 'Saving…' : 'Record Payment'}
        </button>
        <button onClick={onClose} className={btnSecondary}>Cancel</button>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ApPayments() {
  const { user } = useAuth()
  const canManage = user?.action_keys?.includes('manage_payments') ?? false
  const [supplierId, setSupplierId] = useState('')
  const [showForm, setShowForm]     = useState(false)

  const suppQ = useQuery({
    queryKey: qk.suppliers(),
    queryFn:  () => catalogueApi.suppliers.list(),
    staleTime: stale.reference,
  })

  const listQ = useQuery({
    queryKey: qk.payments(supplierId ? Number(supplierId) : undefined),
    queryFn:  () => apApi.payments.list(supplierId ? Number(supplierId) : undefined),
    staleTime: stale.transactional,
  })

  return (
    <div className="p-4 space-y-4">
      <FetchingBar show={listQ.isFetching && !listQ.isLoading} />

      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <select
            className="px-2 py-1 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
          >
            <option value="">All Suppliers</option>
            {(suppQ.data ?? []).map(s => (
              <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
            ))}
          </select>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(v => !v)} className={btnPrimary}>
            {showForm ? 'Cancel' : '+ New Payment'}
          </button>
        )}
      </div>

      {/* new payment form */}
      {showForm && (
        <NewPaymentForm
          onClose={() => setShowForm(false)}
          onSaved={() => setShowForm(false)}
        />
      )}

      {/* payments table */}
      <div className="overflow-x-auto rounded-lg border t-border">
        <table className="w-full text-xs t-text-1">
          <thead className="t-bg-surface border-b t-border">
            <tr>
              <th className="px-3 py-2 text-left font-medium t-text-3">Payment ID</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Supplier</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Date</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Reference</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Method</th>
              <th className="px-3 py-2 text-right font-medium t-text-3">Amount</th>
              <th className="px-3 py-2 text-left font-medium t-text-3">Applied To</th>
            </tr>
          </thead>
          <tbody className="divide-y t-divide">
            {listQ.isLoading ? (
              <SkeletonTable rows={6} cols={7} />
            ) : (listQ.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center t-text-4">No payments found</td>
              </tr>
            ) : (listQ.data ?? []).map(pmt => (
              <tr key={pmt.payment_id} className="hover:t-bg-surface transition-colors">
                <td className="px-3 py-2 font-mono t-text-3">#{pmt.payment_id}</td>
                <td className="px-3 py-2">{pmt.supplier?.supplier_name ?? '—'}</td>
                <td className="px-3 py-2">{fmtDate(pmt.payment_date)}</td>
                <td className="px-3 py-2 font-mono">{pmt.reference_number ?? '—'}</td>
                <td className="px-3 py-2">{pmt.payment_method ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{php(pmt.amount)}</td>
                <td className="px-3 py-2">
                  {pmt.invoice_payments.length === 0 ? (
                    <span className="t-text-4">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {pmt.invoice_payments.map(ip => (
                        <span key={ip.invoice_id} className="inline-block px-1.5 py-0.5 rounded text-[9px] font-mono bg-gray-100 text-gray-700">
                          #{ip.invoice_id} ({php(ip.amount_applied)})
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] t-text-4">{(listQ.data ?? []).length} payment{(listQ.data ?? []).length !== 1 ? 's' : ''}</p>
    </div>
  )
}
