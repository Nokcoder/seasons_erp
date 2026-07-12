import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { catalogueApi, type InvSupplier, type SupplierCreate, type SupplierUpdate } from '../../services/api'
import Tooltip from '../../components/Tooltip'
import { normalize } from '../../lib/normalize'
import { useAuth } from '../../context/AuthContext'

// ── Status toggle ─────────────────────────────────────────────────────────────
type StatusFilter = 'Active' | 'Inactive' | 'Both'

// ── Field style helpers ────────────────────────────────────────────────────────
const iCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'
const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-4 mb-1'

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  mode: 'create' | 'edit'
  initial?: InvSupplier
  onClose: () => void
  onSave: (data: SupplierCreate | SupplierUpdate) => Promise<void>
  saving: boolean
  error: string
}

function SupplierModal({ mode, initial, onClose, onSave, saving, error }: ModalProps) {
  const [code, setCode]    = useState(initial?.supplier_code ?? '')
  const [name, setName]    = useState(initial?.supplier_name ?? '')
  const [bank, setBank]    = useState(initial?.bank_account_name ?? '')
  const [terms, setTerms]  = useState(String(initial?.terms ?? 0))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'create') {
      await onSave({ supplier_code: code, supplier_name: name, bank_account_name: bank || null, terms: parseInt(terms) || 0 } as SupplierCreate)
    } else {
      await onSave({ supplier_name: name, bank_account_name: bank || null, terms: parseInt(terms) || 0 } as SupplierUpdate)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="t-bg-surface border t-border rounded-lg p-6 w-full max-w-md shadow-xl">
        <h3 className="text-sm font-semibold t-text-1 mb-4">
          {mode === 'create' ? 'New Supplier' : 'Edit Supplier'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={lCls}>
              <Tooltip
                content="Permanent identifier you assign to this supplier."
                note="Unlike PIDs elsewhere in the app, this is never auto-generated and can't be changed after creation.">
                Supplier Code *
              </Tooltip>
            </label>
            {mode === 'create' ? (
              <input className={iCls} value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. SUP-001" required />
            ) : (
              <p className="text-xs t-text-3 font-mono t-bg-elevated rounded px-2 py-1.5 border t-border select-all">{initial?.supplier_code}</p>
            )}
          </div>
          <div>
            <label className={lCls}>Supplier Name *</label>
            <input className={iCls} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className={lCls}>Bank Account Name</label>
            <input className={iCls} value={bank} onChange={e => setBank(e.target.value)} />
          </div>
          <div>
            <label className={lCls}>
              <Tooltip
                content="Days until payment is due, e.g. 30 = Net 30."
                note="Feeds the due-date calculation on supplier invoices when confirming a shipment's costs — 0 means Cash on Delivery.">
                Payment Terms (days)
              </Tooltip>
            </label>
            <input type="number" min="0" step="1" className={iCls} value={terms} onChange={e => setTerms(e.target.value)} />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-2 py-1.5">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-xs border t-border rounded t-text-3 hover:t-border-strong">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Suppliers() {
  const { user } = useAuth()
  const canManage = user?.action_keys?.includes('manage_suppliers') ?? false
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Active')
  const [search, setSearch] = useState('')
  const [modal, setModal]   = useState<{ mode: 'create' | 'edit'; supplier?: InvSupplier } | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  const includeDeleted = statusFilter !== 'Active'

  const { data: suppliers = [], isLoading, isFetching } = useQuery({
    queryKey: qk.suppliersAll(includeDeleted),
    queryFn:  () => catalogueApi.suppliers.list(includeDeleted),
    ...stale.reference,
  })

  const filtered = useMemo(() => {
    return suppliers.filter(s => {
      if (statusFilter === 'Active'   && s.is_deleted)  return false
      if (statusFilter === 'Inactive' && !s.is_deleted) return false
      if (search.trim() && !(
        normalize(s.supplier_code).includes(normalize(search)) ||
        normalize(s.supplier_name).includes(normalize(search))
      )) return false
      return true
    })
  }, [suppliers, statusFilter, search])

  // ── mutations ─────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (data: SupplierCreate) => catalogueApi.suppliers.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setModal(null)
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierUpdate }) =>
      catalogueApi.suppliers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setModal(null)
    },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, is_deleted }: { id: number; is_deleted: boolean }) =>
      catalogueApi.suppliers.patch(id, { is_deleted }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })

  async function handleSave(data: SupplierCreate | SupplierUpdate) {
    setSaving(true)
    setModalError('')
    try {
      if (modal?.mode === 'create') {
        await createMut.mutateAsync(data as SupplierCreate)
      } else if (modal?.supplier) {
        await updateMut.mutateAsync({ id: modal.supplier.supplier_id, data: data as SupplierUpdate })
      }
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus(s: InvSupplier) {
    try {
      await patchMut.mutateAsync({ id: s.supplier_id, is_deleted: !s.is_deleted })
    } catch { /* error handled by mutation */ }
  }

  const inputCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5">
      <FetchingBar show={isFetching && !isLoading} />

      {/* toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-sm font-semibold t-text-1">Suppliers</h1>

        <input
          className={`${inputCls} w-52`}
          placeholder="Search code, name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Status toggle */}
        <div className="flex rounded overflow-hidden border t-border text-xs">
          {(['Active', 'Inactive', 'Both'] as StatusFilter[]).map(s => (
            <button key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 transition-colors ${statusFilter === s ? 't-bg-elevated t-text-1' : 't-bg-elevated t-text-4 hover:t-text-2'}`}>
              {s}
            </button>
          ))}
        </div>

        {canManage && (
          <button
            onClick={() => { setModalError(''); setModal({ mode: 'create' }) }}
            className="ml-auto px-3 py-1.5 text-xs rounded text-white font-medium"
            style={{ backgroundColor: 'var(--accent)' }}>
            + New Supplier
          </button>
        )}
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['Supplier Code', 'Supplier Name', 'Bank Account Name', 'Payment Terms', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">
                  {h === 'Payment Terms' && <Tooltip content="Shown as COD when terms is 0, otherwise Net {n} days.">{h}</Tooltip>}
                  {h === 'Status' && (
                    <Tooltip content="Inactive is a soft-delete — historical POs and shipments referencing this supplier are unaffected.">
                      {h}
                    </Tooltip>
                  )}
                  {h !== 'Payment Terms' && h !== 'Status' && h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable rows={8} cols={6} />}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center t-text-4">No suppliers found.</td></tr>
            )}
            {!isLoading && filtered.map(s => (
              <tr key={s.supplier_id}
                className={`border-b t-border transition-colors ${s.is_deleted ? 'opacity-40' : 'hover:t-bg-surface/50'}`}>
                <td className="px-3 py-2 font-mono t-text-2">{s.supplier_code}</td>
                <td className="px-3 py-2 t-text-1">{s.supplier_name}</td>
                <td className="px-3 py-2 t-text-3">{s.bank_account_name ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums t-text-3">
                  {s.terms === 0 ? 'COD' : `Net ${s.terms}`}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                    s.is_deleted
                      ? 't-bg-elevated t-text-4'
                      : 'bg-emerald-950 text-emerald-500'
                  }`}>
                    {s.is_deleted ? 'Inactive' : 'Active'}
                  </span>
                </td>
                <td className="px-3 py-2 flex gap-3">
                  {canManage && !s.is_deleted && (
                    <button
                      onClick={() => { setModalError(''); setModal({ mode: 'edit', supplier: s }) }}
                      className="text-[10px] text-blue-400 hover:underline">
                      Edit
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => handleToggleStatus(s)}
                      className={`text-[10px] hover:underline ${s.is_deleted ? 'text-emerald-400' : 't-text-4 hover:text-red-400'}`}>
                      {s.is_deleted ? 'Reactivate' : 'Deactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* modal */}
      {modal && (
        <SupplierModal
          mode={modal.mode}
          initial={modal.supplier}
          onClose={() => setModal(null)}
          onSave={handleSave}
          saving={saving}
          error={modalError}
        />
      )}
    </div>
  )
}
