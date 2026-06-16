import { Fragment, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import {
  apApi, stockApi,
  type InvoiceAmend, type InvoiceVettingUpdate, type InvoiceCheckDraftUpdate,
  type ApVettingWarning, type SupplierInvoiceItemUpdate,
} from '../../services/api'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDateOnly(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { dateStyle: 'short', timeZone: 'UTC' })
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
}
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtQty(n: number | null | undefined) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
function php(n: number | null | undefined) {
  if (n == null) return '—'
  return `₱${fmt(n)}`
}
function fmtVarianceQty(n: number) {
  if (n === 0) return <span className="t-text-4">0.000</span>
  const sign = n > 0 ? '+' : ''
  return <span className={n > 0 ? 'text-green-600' : 'text-red-600'}>{sign}{fmtQty(n)}</span>
}
function fmtVarianceCurrency(n: number) {
  if (n === 0) return <span className="t-text-4">{php(0)}</span>
  const abs = Math.abs(n)
  const sign = n > 0 ? '+' : '−'
  return <span className={n > 0 ? 'text-green-600' : 'text-red-600'}>{sign}₱{fmt(abs)}</span>
}

// ── class constants ───────────────────────────────────────────────────────────

const lCls = 'text-[10px] font-medium t-text-3 uppercase tracking-wide'
const vCls = 'text-xs t-text-1 mt-0.5'
const inputCls = 'w-full px-2.5 py-1.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'
const btnPrimary   = 'px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors'
const btnSecondary = 'px-3 py-1.5 text-xs font-medium t-bg-elevated border t-border t-text-1 rounded hover:t-bg-surface disabled:opacity-50 transition-colors'
const btnDanger    = 'px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors'
const btnGreen     = 'px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors'

// ── badge maps ────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  Unpaid:  'bg-red-100 text-red-700',
  Partial: 'bg-yellow-100 text-yellow-700',
  Paid:    'bg-green-100 text-green-700',
}
const VETTING_CLS: Record<string, string> = {
  Pending_Review: 'bg-gray-100 text-gray-600',
  Approved:       'bg-emerald-100 text-emerald-700',
  Rejected:       'bg-rose-100 text-rose-700',
}
const VETTING_LABEL: Record<string, string> = {
  Pending_Review: 'Pending Review',
  Approved:       'Approved',
  Rejected:       'Rejected',
}
const DISC_CLS: Record<string, string> = {
  None:              'bg-gray-100 text-gray-500',
  Flagged:           'bg-red-100 text-red-700',
  Supplier_Notified: 'bg-orange-100 text-orange-700',
  Resolved:          'bg-green-100 text-green-700',
  Waived:            'bg-blue-100 text-blue-700',
}

// ── MatchTab ──────────────────────────────────────────────────────────────────

function MatchTab({ invoiceId, isActive }: { invoiceId: number; isActive: boolean }) {
  const qc = useQueryClient()

  const matchQ = useQuery({
    queryKey: qk.invoiceMatch(invoiceId),
    queryFn:  () => apApi.invoices.getMatch(invoiceId),
    staleTime: stale.transactional,
    enabled:   isActive,
  })
  const matchData = matchQ.data

  // ── inline edit state ──────────────────────────────────────────────────────
  const [cellEdit, setCellEdit] = useState<{
    itemId: number
    field: 'billed_qty' | 'billed_unit_cost'
    draft: string
  } | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [pendingItemId, setPendingItemId] = useState<number | null>(null)

  const itemMut = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: SupplierInvoiceItemUpdate }) =>
      apApi.invoices.updateInvoiceItem(invoiceId, itemId, data),
    onMutate: ({ itemId }) => setPendingItemId(itemId),
    onSuccess: (_, { itemId }) => {
      setPendingItemId(null)
      setRowErrors(prev => { const n = { ...prev }; delete n[itemId]; return n })
      setCellEdit(null)
      qc.invalidateQueries({ queryKey: qk.invoiceMatch(invoiceId) })
      qc.invalidateQueries({ queryKey: qk.invoice(invoiceId) })
    },
    onError: (err, { itemId }) => {
      setPendingItemId(null)
      setRowErrors(prev => ({ ...prev, [itemId]: String(err) }))
      setCellEdit(null)
    },
  })

  function startEdit(itemId: number, field: 'billed_qty' | 'billed_unit_cost', current: number) {
    setRowErrors(prev => { const n = { ...prev }; delete n[itemId]; return n })
    setCellEdit({ itemId, field, draft: String(current) })
  }

  function commitEdit(itemId: number, original: { billed_qty: number; billed_unit_cost: number }) {
    if (!cellEdit || cellEdit.itemId !== itemId) return
    const { field, draft } = cellEdit
    const newVal = parseFloat(draft)
    if (isNaN(newVal) || newVal === original[field]) {
      setCellEdit(null)
      return
    }
    itemMut.mutate({ itemId, data: { [field]: newVal } })
  }

  // ── derived table data ─────────────────────────────────────────────────────
  const itemByVariant = Object.fromEntries(
    (matchData?.invoice.items ?? []).map(i => [i.variant_id, i])
  )
  const tableRows = (matchData?.lines ?? []).map(line => ({
    ...line,
    item_id: itemByVariant[line.variant_id]?.id ?? null,
  }))

  const hasVariance = tableRows.some(r => r.has_variance)
  const totalPo     = tableRows.reduce((s, r) => s + r.po_line_total, 0)
  const totalInv    = tableRows.reduce((s, r) => s + r.line_total, 0)
  const totalVar    = totalInv - totalPo

  // ── loading state ──────────────────────────────────────────────────────────
  if (matchQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-lg border t-border t-bg-surface p-3 animate-pulse space-y-2">
              <div className="h-2 t-bg-elevated rounded w-20" />
              <div className="h-3 t-bg-elevated rounded w-28" />
              <div className="h-2 t-bg-elevated rounded w-16" />
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border t-border">
          <table className="w-full text-xs">
            <tbody className="divide-y t-divide">
              <SkeletonTable rows={4} cols={11} />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── error state ────────────────────────────────────────────────────────────
  if (matchQ.isError) {
    return (
      <div className="rounded-lg border t-border t-bg-surface p-6 text-center space-y-3">
        <p className="text-xs text-red-600">{String(matchQ.error)}</p>
        <button onClick={() => matchQ.refetch()} className={btnSecondary}>
          Retry
        </button>
      </div>
    )
  }

  if (!matchData) return null

  return (
    <div className="space-y-4">
      {/* ── summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* PO card */}
        <div className="rounded-lg border t-border t-bg-surface p-3 space-y-1.5">
          <p className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Purchase Order</p>
          {matchData.po ? (
            <>
              <p className="text-sm font-mono font-medium t-text-1">{matchData.po.po_pid}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                  {matchData.po.status}
                </span>
                <span className="text-[10px] t-text-3">{fmtDateOnly(matchData.po.created_at)}</span>
              </div>
            </>
          ) : (
            <p className="text-xs t-text-4 mt-1">No linked PO</p>
          )}
        </div>

        {/* Shipment / GRN card */}
        <div className="rounded-lg border t-border t-bg-surface p-3 space-y-1.5">
          <p className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Goods Receipt</p>
          {matchData.shipment ? (
            <>
              <p className="text-sm font-mono font-medium t-text-1">#{matchData.shipment.id}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${matchData.shipment.is_confirmed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {matchData.shipment.is_confirmed ? 'Confirmed' : 'Unconfirmed'}
                </span>
                <span className="text-[10px] t-text-3">{fmtDate(matchData.shipment.received_at)}</span>
              </div>
              {['Flagged', 'Supplier_Notified'].includes(matchData.shipment.discrepancy_status) && (
                <div className="p-2 rounded bg-yellow-50 border border-yellow-200 text-[10px] text-yellow-800 leading-relaxed">
                  ⚠ Open discrepancy
                  {matchData.shipment.discrepancy_notes ? ` — ${matchData.shipment.discrepancy_notes}` : ''}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs t-text-4 mt-1">No linked shipment</p>
          )}
        </div>

        {/* Invoice summary card */}
        <div className="rounded-lg border t-border t-bg-surface p-3 space-y-1.5">
          <p className="text-[10px] font-medium t-text-3 uppercase tracking-wide">Invoice</p>
          <p className="text-sm font-mono font-medium t-text-1">{php(matchData.invoice.total_amount)}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[matchData.invoice.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {matchData.invoice.status}
            </span>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${VETTING_CLS[matchData.invoice.vetting_status] ?? 'bg-gray-100 text-gray-600'}`}>
              {VETTING_LABEL[matchData.invoice.vetting_status] ?? matchData.invoice.vetting_status}
            </span>
          </div>
        </div>
      </div>

      {/* ── ledger divergence note ─────────────────────────────────────────── */}
      {hasVariance && (
        <p className="text-[10px] t-text-4 px-0.5 leading-relaxed">
          The AP ledger entry reflects the original confirmed invoice total. Edits to billed quantities or unit costs are recorded here and update the invoice total, but the ledger entry is immutable.
        </p>
      )}

      {/* ── line items table / empty state ────────────────────────────────── */}
      {tableRows.length === 0 ? (
        <div className="rounded-lg border t-border t-bg-surface p-6 text-center">
          <p className="text-xs t-text-4">
            This invoice has no line item breakdown. 3-way match is only available for invoices generated from a confirmed shipment.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border t-border">
            <table className="w-full text-xs t-text-1 whitespace-nowrap">
              <thead className="t-bg-surface border-b t-border">
                <tr>
                  <th className="px-2 py-2 text-left font-medium t-text-3">SKU</th>
                  <th className="px-2 py-2 text-left font-medium t-text-3">Item</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Ordered</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Received</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Rejected</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Billed Qty</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Unit Cost</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Line Total</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">PO Total</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Qty Var</th>
                  <th className="px-2 py-2 text-right font-medium t-text-3">Cost Var</th>
                </tr>
              </thead>
              <tbody className="divide-y t-divide">
                {tableRows.map(row => {
                  const iid = row.item_id
                  const isPending = pendingItemId === iid
                  const isEditingQty  = cellEdit?.itemId === iid && cellEdit.field === 'billed_qty'
                  const isEditingCost = cellEdit?.itemId === iid && cellEdit.field === 'billed_unit_cost'
                  const origQty  = row.billed_qty
                  const origCost = row.billed_unit_cost

                  return (
                    <Fragment key={row.variant_id}>
                      <tr className={`transition-colors ${row.has_variance ? 'bg-red-50/50' : ''} ${isPending ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-2 font-mono t-text-3 text-[11px]">{row.variant_sku || '—'}</td>
                        <td className="px-2 py-2 max-w-[140px] truncate" title={row.variant_name ?? undefined}>{row.variant_name || '—'}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtQty(row.ordered_qty)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtQty(row.received_qty)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtQty(row.rejected_qty)}</td>

                        {/* Billed Qty — inline editable */}
                        <td className="px-2 py-2 text-right">
                          {isEditingQty ? (
                            <input
                              autoFocus
                              type="number"
                              step="0.001"
                              value={cellEdit!.draft}
                              onChange={e => setCellEdit(p => p ? { ...p, draft: e.target.value } : null)}
                              onBlur={() => iid != null && commitEdit(iid, { billed_qty: origQty, billed_unit_cost: origCost })}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && iid != null) commitEdit(iid, { billed_qty: origQty, billed_unit_cost: origCost })
                                if (e.key === 'Escape') setCellEdit(null)
                              }}
                              className="w-24 px-1.5 py-0.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-right font-mono"
                            />
                          ) : (
                            <button
                              onClick={() => iid != null && startEdit(iid, 'billed_qty', origQty)}
                              disabled={iid == null || isPending}
                              className="font-mono hover:underline hover:t-text-2 disabled:cursor-default text-xs"
                              title={iid != null ? 'Click to edit' : undefined}
                            >
                              {fmtQty(row.billed_qty)}
                            </button>
                          )}
                        </td>

                        {/* Unit Cost — inline editable */}
                        <td className="px-2 py-2 text-right">
                          {isEditingCost ? (
                            <input
                              autoFocus
                              type="number"
                              step="0.0001"
                              value={cellEdit!.draft}
                              onChange={e => setCellEdit(p => p ? { ...p, draft: e.target.value } : null)}
                              onBlur={() => iid != null && commitEdit(iid, { billed_qty: origQty, billed_unit_cost: origCost })}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && iid != null) commitEdit(iid, { billed_qty: origQty, billed_unit_cost: origCost })
                                if (e.key === 'Escape') setCellEdit(null)
                              }}
                              className="w-28 px-1.5 py-0.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-right font-mono"
                            />
                          ) : (
                            <button
                              onClick={() => iid != null && startEdit(iid, 'billed_unit_cost', origCost)}
                              disabled={iid == null || isPending}
                              className="font-mono hover:underline hover:t-text-2 disabled:cursor-default text-xs"
                              title={iid != null ? 'Click to edit' : undefined}
                            >
                              {php(row.billed_unit_cost)}
                            </button>
                          )}
                        </td>

                        <td className="px-2 py-2 text-right font-mono">{php(row.line_total)}</td>
                        <td className="px-2 py-2 text-right font-mono t-text-3">{php(row.po_line_total)}</td>
                        <td className="px-2 py-2 text-right">{fmtVarianceQty(row.qty_variance)}</td>
                        <td className="px-2 py-2 text-right">{fmtVarianceCurrency(row.cost_variance)}</td>
                      </tr>

                      {/* per-row error */}
                      {iid != null && rowErrors[iid] && (
                        <tr>
                          <td colSpan={11} className="px-2 py-1 text-[10px] text-red-600 t-bg-surface">
                            {rowErrors[iid]}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>

              {/* footer totals */}
              <tfoot className="border-t-2 t-border t-bg-surface">
                <tr>
                  <td colSpan={7} className="px-2 py-2 text-xs font-medium t-text-2 text-right">Totals</td>
                  <td className="px-2 py-2 text-right font-mono text-xs font-semibold t-text-1">{php(totalInv)}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs t-text-3">{php(totalPo)}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right">{fmtVarianceCurrency(totalVar)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── InvoiceDetail ─────────────────────────────────────────────────────────────

export default function InvoiceDetail() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const invoiceId = Number(id)

  const [activeTab, setActiveTab] = useState<'details' | 'match'>('details')

  // ── data ──────────────────────────────────────────────────────────────
  const invQ = useQuery({
    queryKey: qk.invoice(invoiceId),
    queryFn:  () => apApi.invoices.get(invoiceId),
    staleTime: stale.transactional,
    enabled:   !isNaN(invoiceId),
  })
  const invoice = invQ.data

  const shipQ = useQuery({
    queryKey: qk.shipment(invoice?.shipment_id ?? 0),
    queryFn:  () => stockApi.shipments.get(invoice!.shipment_id!),
    staleTime: stale.transactional,
    enabled:   !!invoice?.shipment_id,
  })
  const shipment = shipQ.data

  // ── vetting ───────────────────────────────────────────────────────────
  const [vettingWarn, setVettingWarn]       = useState<string | null>(null)
  const [pendingVetting, setPendingVetting] = useState<string | null>(null)
  const [overrideDisc, setOverrideDisc]     = useState(false)

  const vettingMut = useMutation({
    mutationFn: (p: InvoiceVettingUpdate) => apApi.invoices.setVetting(invoiceId, p),
    onSuccess: (data) => {
      if ('warning' in data && (data as ApVettingWarning).warning) {
        setVettingWarn((data as ApVettingWarning).message)
      } else {
        setVettingWarn(null)
        setPendingVetting(null)
        setOverrideDisc(false)
        qc.invalidateQueries({ queryKey: qk.invoice(invoiceId) })
        qc.invalidateQueries({ queryKey: ['invoices'] })
      }
    },
  })

  function doVetting(targetStatus: string) {
    if (vettingWarn) {
      vettingMut.mutate({ vetting_status: targetStatus, override_discrepancy: overrideDisc })
    } else {
      setPendingVetting(targetStatus)
      vettingMut.mutate({ vetting_status: targetStatus })
    }
  }

  // ── check-draft ───────────────────────────────────────────────────────
  const [draftNote, setDraftNote] = useState('')

  const checkDraftMut = useMutation({
    mutationFn: (p: InvoiceCheckDraftUpdate) => apApi.invoices.setCheckDraft(invoiceId, p),
    onSuccess: () => {
      setDraftNote('')
      qc.invalidateQueries({ queryKey: qk.invoice(invoiceId) })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  // ── amendment ─────────────────────────────────────────────────────────
  const [showAmend, setShowAmend] = useState(false)
  const [amendAmt, setAmendAmt]   = useState('')
  const [amendNote, setAmendNote] = useState('')

  const amendMut = useMutation({
    mutationFn: (p: InvoiceAmend) => apApi.invoices.amend(invoiceId, p),
    onSuccess: () => {
      setShowAmend(false)
      setAmendAmt('')
      setAmendNote('')
      qc.invalidateQueries({ queryKey: qk.invoice(invoiceId) })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  // ── discrepancy ───────────────────────────────────────────────────────
  const [discStatusEdit, setDiscStatusEdit] = useState<string | null>(null)
  const [discNotesEdit, setDiscNotesEdit]   = useState<string | null>(null)

  const discStatus = discStatusEdit ?? shipment?.discrepancy_status ?? 'None'
  const discNotes  = discNotesEdit  ?? shipment?.discrepancy_notes  ?? ''

  const discMut = useMutation({
    mutationFn: () => stockApi.shipments.updateDiscrepancy(invoice!.shipment_id!, {
      discrepancy_status: discStatus,
      discrepancy_notes:  discNotes || null,
    }),
    onSuccess: () => {
      setDiscStatusEdit(null)
      setDiscNotesEdit(null)
      qc.invalidateQueries({ queryKey: qk.shipment(invoice?.shipment_id ?? 0) })
      qc.invalidateQueries({ queryKey: qk.invoice(invoiceId) })
    },
  })

  // ── render ────────────────────────────────────────────────────────────
  if (invQ.isLoading) {
    return <div className="p-8 text-sm t-text-4 animate-pulse">Loading…</div>
  }
  if (!invoice) {
    return <div className="p-8 text-sm t-text-4">Invoice not found.</div>
  }

  const effectiveAmount = invoice.amended_amount ?? invoice.total_amount

  return (
    <div className="p-4 max-w-5xl space-y-4">
      {/* back link */}
      <button onClick={() => navigate('/ap')} className="text-xs t-text-4 hover:t-text-2">
        ← Back to Invoices
      </button>

      {/* ── header card (always visible) ─────────────────────────────────── */}
      <div className="rounded-lg border t-border t-bg-surface p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold t-text-1">
              {invoice.invoice_number ?? `Invoice #${invoice.invoice_id}`}
            </h2>
            <p className="text-xs t-text-3 mt-0.5">{invoice.supplier?.supplier_name ?? '—'}</p>
          </div>
          <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[invoice.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {invoice.status}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${VETTING_CLS[invoice.vetting_status] ?? 'bg-gray-100 text-gray-600'}`}>
              {VETTING_LABEL[invoice.vetting_status] ?? invoice.vetting_status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <div><p className={lCls}>Invoice Date</p><p className={vCls}>{fmtDateOnly(invoice.invoice_date)}</p></div>
          <div><p className={lCls}>Due Date</p><p className={vCls}>{fmtDateOnly(invoice.due_date)}</p></div>
          <div>
            <p className={lCls}>Amount</p>
            <p className={vCls + ' font-mono'}>{php(invoice.total_amount)}</p>
          </div>
          <div>
            <p className={lCls}>Effective Amount</p>
            <p className={vCls + ' font-mono'}>
              {php(effectiveAmount)}
              {invoice.amended_amount != null && <span className="t-text-4 ml-1 font-normal">(amended)</span>}
            </p>
          </div>
        </div>

        {(invoice.paid_before_received || invoice.check_drafted) && (
          <div className="flex gap-2 pt-1 flex-wrap">
            {invoice.paid_before_received && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">
                Paid Before Received
              </span>
            )}
            {invoice.check_drafted && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                Check Drafted{invoice.check_drafted_note ? ` — ${invoice.check_drafted_note}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b t-border">
        {(['details', 'match'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors -mb-px border-b-2 ${
              activeTab === tab
                ? 'border-blue-500 t-text-1'
                : 'border-transparent t-text-4 hover:t-text-2'
            }`}
          >
            {tab === 'details' ? 'Details' : '3-Way Match'}
          </button>
        ))}
      </div>

      {/* ── tab content ──────────────────────────────────────────────────── */}

      {activeTab === 'details' && (
        <div className="space-y-4 max-w-3xl">
          {/* ── vetting ──────────────────────────────────────────────────── */}
          <div className="rounded-lg border t-border t-bg-surface p-4 space-y-3">
            <h3 className="text-xs font-semibold t-text-2">Bill Vetting</h3>

            {vettingWarn && (
              <div className="p-3 rounded bg-yellow-50 border border-yellow-200 space-y-2.5">
                <p className="text-xs text-yellow-800">⚠ {vettingWarn}</p>
                <label className="flex items-center gap-2 text-xs text-yellow-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideDisc}
                    onChange={e => setOverrideDisc(e.target.checked)}
                    className="rounded"
                  />
                  Override discrepancy and confirm approval
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => doVetting(pendingVetting!)}
                    disabled={!overrideDisc || vettingMut.isPending}
                    className={btnPrimary}
                  >
                    {vettingMut.isPending ? 'Saving…' : 'Confirm Approval'}
                  </button>
                  <button
                    onClick={() => { setVettingWarn(null); setPendingVetting(null); setOverrideDisc(false) }}
                    className={btnSecondary}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {vettingMut.isError && (
              <p className="text-xs text-red-600">{String(vettingMut.error)}</p>
            )}

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => doVetting('Approved')}
                disabled={invoice.vetting_status === 'Approved' || vettingMut.isPending || !!vettingWarn}
                className={btnGreen}
              >
                Approve
              </button>
              <button
                onClick={() => doVetting('Rejected')}
                disabled={invoice.vetting_status === 'Rejected' || vettingMut.isPending || !!vettingWarn}
                className={btnDanger}
              >
                Reject
              </button>
              <button
                onClick={() => doVetting('Pending_Review')}
                disabled={invoice.vetting_status === 'Pending_Review' || vettingMut.isPending || !!vettingWarn}
                className={btnSecondary}
              >
                Reset to Pending
              </button>
            </div>
          </div>

          {/* ── check draft ──────────────────────────────────────────────── */}
          <div className="rounded-lg border t-border t-bg-surface p-4 space-y-3">
            <h3 className="text-xs font-semibold t-text-2">Check Draft</h3>

            {invoice.check_drafted ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs t-text-3">
                  Drafted{invoice.check_drafted_note ? ` — ${invoice.check_drafted_note}` : ''}
                </p>
                <button
                  onClick={() => checkDraftMut.mutate({ check_drafted: false, check_drafted_note: null })}
                  disabled={checkDraftMut.isPending}
                  className={btnSecondary}
                >
                  {checkDraftMut.isPending ? 'Clearing…' : 'Clear Flag'}
                </button>
              </div>
            ) : (
              <div className="flex gap-2 items-start">
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={draftNote}
                  onChange={e => setDraftNote(e.target.value)}
                  className={inputCls}
                />
                <button
                  onClick={() => checkDraftMut.mutate({ check_drafted: true, check_drafted_note: draftNote || null })}
                  disabled={checkDraftMut.isPending}
                  className={`${btnPrimary} shrink-0`}
                >
                  {checkDraftMut.isPending ? 'Saving…' : 'Mark Drafted'}
                </button>
              </div>
            )}

            {checkDraftMut.isError && (
              <p className="text-xs text-red-600">{String(checkDraftMut.error)}</p>
            )}
          </div>

          {/* ── amendment ────────────────────────────────────────────────── */}
          <div className="rounded-lg border t-border t-bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold t-text-2">Amendment</h3>
              <button
                onClick={() => setShowAmend(v => !v)}
                className="text-xs t-text-4 hover:t-text-2"
              >
                {showAmend ? 'Cancel' : 'Amend'}
              </button>
            </div>

            {invoice.amended_amount != null && !showAmend && (
              <div className="text-xs t-text-3 space-y-1">
                <p>Amended amount: <span className="t-text-1 font-mono">{php(invoice.amended_amount)}</span></p>
                {invoice.amendment_notes && <p>Notes: <span className="t-text-1">{invoice.amendment_notes}</span></p>}
              </div>
            )}

            {showAmend && (
              <div className="space-y-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder={`Amended amount (current: ${php(invoice.total_amount)})`}
                  value={amendAmt}
                  onChange={e => setAmendAmt(e.target.value)}
                  className={inputCls}
                />
                <textarea
                  placeholder="Amendment notes"
                  value={amendNote}
                  onChange={e => setAmendNote(e.target.value)}
                  rows={2}
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => amendMut.mutate({
                      amended_amount:  amendAmt ? Number(amendAmt) : undefined,
                      amendment_notes: amendNote || undefined,
                    })}
                    disabled={(!amendAmt && !amendNote) || amendMut.isPending}
                    className={btnPrimary}
                  >
                    {amendMut.isPending ? 'Saving…' : 'Save Amendment'}
                  </button>
                </div>
                {amendMut.isError && <p className="text-xs text-red-600">{String(amendMut.error)}</p>}
              </div>
            )}
          </div>

          {/* ── linked shipment ───────────────────────────────────────────── */}
          {invoice.shipment_id && (
            <div className="rounded-lg border t-border t-bg-surface p-4 space-y-3">
              <h3 className="text-xs font-semibold t-text-2">Linked Shipment</h3>

              {shipQ.isLoading ? (
                <p className="text-xs t-text-4 animate-pulse">Loading shipment…</p>
              ) : !shipment ? (
                <p className="text-xs t-text-4">Shipment #{invoice.shipment_id} not found.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                    <div>
                      <p className={lCls}>Shipment ID</p>
                      <p className={vCls + ' font-mono'}>{shipment.shipment_pid ?? `#${shipment.shipment_id}`}</p>
                    </div>
                    <div>
                      <p className={lCls}>Costs Confirmed</p>
                      <p className={vCls}>{shipment.is_confirmed ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className={lCls}>Discrepancy</p>
                      <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${DISC_CLS[shipment.discrepancy_status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {shipment.discrepancy_status}
                      </span>
                    </div>
                  </div>

                  {shipment.discrepancy_notes && (
                    <p className="text-xs t-text-3">Notes: <span className="t-text-1">{shipment.discrepancy_notes}</span></p>
                  )}

                  <div className="pt-2 border-t t-border space-y-2">
                    <p className={lCls}>Update Discrepancy</p>
                    <div className="flex gap-2 flex-wrap">
                      <select
                        value={discStatus}
                        onChange={e => setDiscStatusEdit(e.target.value)}
                        className="px-2 py-1.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="None">None</option>
                        <option value="Flagged">Flagged</option>
                        <option value="Supplier_Notified">Supplier Notified</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Waived">Waived</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Notes"
                        value={discNotes}
                        onChange={e => setDiscNotesEdit(e.target.value)}
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded border t-border t-bg-surface t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => discMut.mutate()}
                        disabled={discMut.isPending}
                        className={`${btnPrimary} shrink-0`}
                      >
                        {discMut.isPending ? 'Saving…' : 'Update'}
                      </button>
                    </div>
                    {discMut.isError && <p className="text-xs text-red-600">{String(discMut.error)}</p>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'match' && (
        <MatchTab invoiceId={invoiceId} isActive={activeTab === 'match'} />
      )}
    </div>
  )
}
