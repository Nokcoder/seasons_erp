import { useState, useRef, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import Tooltip from '../../components/Tooltip'
import {
  importApi,
  type ImportDiffRow, type ImportErrorRow, type ImportPreviewResponse,
} from '../../services/api'
import * as XLSX from 'xlsx'

// ── Entity config ─────────────────────────────────────────────────────────────

interface EntityConfig {
  id:          string
  label:       string
  description: string
  anchor:      string
  columns:     string[]
  actionKey:   string
}

const ENTITIES: EntityConfig[] = [
  {
    id:          'customers',
    label:       'Customers',
    description: 'Create or update customer records. Existing customers are matched by name.',
    anchor:      'customer_name',
    columns:     ['customer_name', 'credit_limit', 'terms_days'],
    actionKey:   'manage_customers',
  },
  {
    id:          'suppliers',
    label:       'Suppliers',
    description: 'Create or update supplier records. Existing suppliers are matched by supplier_code.',
    anchor:      'supplier_code',
    columns:     ['supplier_code', 'supplier_name', 'terms', 'bank_account_name', 'contact_person', 'phone', 'email', 'address'],
    actionKey:   'manage_suppliers',
  },
  {
    id:          'stock-balances',
    label:       'Opening Stock Balances',
    description: 'Set stock quantities for variants at specific locations via ADJUST ledger entries. Use for physical counts and opening balances.',
    anchor:      'PID + location_name',
    columns:     ['PID', 'location_name', 'quantity', 'notes'],
    actionKey:   'manage_products',
  },
  {
    id:          'variant-prices',
    label:       'Variant Prices',
    description: 'Bulk update variant prices and promo prices. Each change is recorded in price history.',
    anchor:      'PID',
    columns:     ['PID', 'price', 'promo_price', 'clear_promo'],
    actionKey:   'manage_products',
  },
  {
    id:          'variant-costs',
    label:       'Variant Costs',
    description: 'Bulk update supplier cost and discount for existing variant-supplier links. Each change is recorded in cost history.',
    anchor:      'PID + supplier_code',
    columns:     ['PID', 'supplier_code', 'gross_cost', 'supplier_discount'],
    actionKey:   'manage_products',
  },
]

// ── Diff modal ────────────────────────────────────────────────────────────────

function DiffModal({
  entity,
  preview,
  rawRows,
  onConfirm,
  onClose,
}: {
  entity: EntityConfig
  preview: ImportPreviewResponse
  rawRows: Record<string, unknown>[]
  onConfirm: (written: number) => void
  onClose: () => void
}) {
  const actionable = preview.valid_rows.filter(r => r.mode !== 'noop')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(actionable.map(r => r.anchor))
  )
  const [applying, setApplying] = useState(false)
  const [err, setErr] = useState('')

  function toggle(anchor: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(anchor) ? n.delete(anchor) : n.add(anchor)
      return n
    })
  }

  async function handleApply() {
    if (selected.size === 0) return
    setApplying(true); setErr('')
    try {
      const result = await importApi.confirm(entity.id, Array.from(selected), rawRows)
      if (result.errors.length > 0) {
        setErr(`${result.written} written, but ${result.errors.length} error(s): ${result.errors[0].error}`)
      } else {
        onConfirm(result.written)
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Confirm failed')
    } finally { setApplying(false) }
  }

  function fmt(v: unknown): string {
    if (v == null || v === '') return '—'
    return String(v)
  }

  const creates = actionable.filter(r => r.mode === 'create').length
  const updates = actionable.filter(r => r.mode === 'update').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="t-bg-surface border t-border-strong rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b t-border shrink-0">
          <div>
            <p className="text-sm font-semibold t-text-1">Review Import — {entity.label}</p>
            <p className="text-[10px] t-text-3 mt-0.5">
              {creates > 0 && `${creates} to create`}
              {creates > 0 && updates > 0 && ' · '}
              {updates > 0 && `${updates} to update`}
              {preview.summary.noops > 0 && ` · ${preview.summary.noops} no-ops (skipped)`}
              {' · '}{selected.size} selected
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(new Set(actionable.map(r => r.anchor)))}
              className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>
              Select all
            </button>
            <button onClick={() => setSelected(new Set())}
              className="text-[10px] t-text-3 hover:t-text-1">Deselect all</button>
            <button onClick={onClose} className="t-text-3 hover:t-text-1 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        {/* diff list */}
        <div className="flex-1 overflow-y-auto">
          {err && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded mx-5 mt-3 px-3 py-2">{err}</div>}
          {actionable.length === 0 && (
            <p className="text-xs t-text-4 text-center py-8">No changes to apply — all rows are no-ops.</p>
          )}
          <table className="w-full text-xs">
            <thead className="sticky top-0 t-bg-elevated border-b t-border-strong z-10">
              <tr>
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest t-text-3">Anchor</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest t-text-3 w-16">
                  <Tooltip content="Create = new record; Update = an existing record matched by the anchor.">Mode</Tooltip>
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest t-text-3">Field</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest t-text-3">Current</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest t-text-3">Incoming</th>
              </tr>
            </thead>
            <tbody>
              {actionable.map((row: ImportDiffRow) => {
                const isSelected = selected.has(row.anchor)
                const fields = row.mode === 'create'
                  ? Object.keys(row.new_values).filter(k => row.new_values[k] != null && row.new_values[k] !== '')
                  : row.diff_fields.length > 0 ? row.diff_fields : ['(no changes)']

                return fields.map((field, fi) => (
                  <tr key={`${row.anchor}-${field}`}
                    className={`border-b t-border transition-opacity ${isSelected ? '' : 'opacity-40'}`}>
                    {fi === 0 && (
                      <td rowSpan={fields.length} className="px-3 py-2 align-top w-8">
                        <input type="checkbox" className="accent-[var(--accent)] mt-0.5"
                          checked={isSelected} onChange={() => toggle(row.anchor)} />
                      </td>
                    )}
                    {fi === 0 && (
                      <td rowSpan={fields.length} className="px-3 py-2 font-mono t-text-2 align-top text-[10px] max-w-[180px] truncate">
                        {row.anchor}
                      </td>
                    )}
                    {fi === 0 && (
                      <td rowSpan={fields.length} className="px-3 py-2 align-top w-16">
                        <span className={`text-[10px] font-medium uppercase px-1 py-0.5 rounded ${
                          row.mode === 'create' ? 'bg-emerald-950 text-emerald-500' : 'bg-yellow-950 text-yellow-500'
                        }`}>{row.mode}</span>
                      </td>
                    )}
                    <td className={`px-3 py-2 ${row.diff_fields.includes(field) ? 'text-yellow-400 font-medium' : 't-text-3'}`}>
                      {field}
                    </td>
                    <td className="px-3 py-2 t-text-3">
                      {fmt(row.old_values?.[field])}
                    </td>
                    <td className={`px-3 py-2 ${row.diff_fields.includes(field) ? 't-text-1 font-medium' : 't-text-2'}`}>
                      {field === '(no changes)' ? <span className="t-text-4 italic">no changes</span> : fmt(row.new_values[field])}
                    </td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t t-border shrink-0">
          <span className="text-xs t-text-3">{selected.size} of {actionable.length} rows selected</span>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong">
              Cancel
            </button>
            <button onClick={handleApply} disabled={applying || selected.size === 0}
              className="px-5 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent)' }}>
              {applying ? 'Applying…' : `Apply ${selected.size} row${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Import form ───────────────────────────────────────────────────────────────

function ImportForm({ entity }: { entity: EntityConfig }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsing,  setParsing]  = useState(false)
  const [preview,  setPreview]  = useState<ImportPreviewResponse | null>(null)
  const [rawRows,  setRawRows]  = useState<Record<string, unknown>[]>([])
  const [fatalErr, setFatalErr] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [success,  setSuccess]  = useState('')

  async function handleFile(file: File) {
    setParsing(true); setFatalErr(''); setPreview(null); setSuccess('')
    try {
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) throw new Error('No sheet found in the uploaded file.')
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (jsonRows.length === 0) throw new Error('The file contains no data rows.')

      // Normalise: add row_number
      const numbered = jsonRows.map((r, i) => ({ row_number: i + 2, ...r }))
      setRawRows(numbered)

      const result = await importApi.preview(entity.id, numbered)
      setPreview(result)
    } catch (e: unknown) {
      setFatalErr(e instanceof Error ? e.message : 'File processing failed')
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleSuccess(written: number) {
    setShowDiff(false)
    setPreview(null)
    setRawRows([])
    setSuccess(`Import complete — ${written} record${written !== 1 ? 's' : ''} written.`)
  }

  function downloadErrors() {
    if (!preview) return
    const rows = preview.error_rows.map((e: ImportErrorRow) => ({
      'Row': e.row_number, 'Anchor': e.anchor, 'Error': e.error,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb2 = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb2, ws, 'Errors')
    XLSX.writeFile(wb2, `${entity.id}_import_errors.xlsx`)
  }

  const hasValid = (preview?.valid_rows.filter(r => r.mode !== 'noop').length ?? 0) > 0
  const lCls = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-sm font-semibold t-text-1 mb-1">{entity.label}</h2>
      <p className="text-xs t-text-3 mb-1">{entity.description}</p>
      <p className="text-[10px] t-text-4 mb-5">
        <Tooltip
          underline={false}
          content="The column(s) used to match this row against an existing record."
          note="A match updates the existing record; no match creates a new one.">
          Anchor
        </Tooltip>: <span className="font-mono t-text-2">{entity.anchor}</span>
      </p>

      {/* actions */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => importApi.downloadTemplate(entity.id).catch(e => setFatalErr(e.message))}
          className="px-3 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong transition-colors">
          ↓ Download Template
        </button>
        <label className="px-3 py-1.5 text-xs rounded text-white cursor-pointer transition-colors"
          style={{ backgroundColor: 'var(--accent)' }}>
          {parsing ? 'Processing…' : '↑ Upload XLSX'}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
        </label>
      </div>

      {/* success banner */}
      {success && (
        <div className="bg-emerald-950 border border-emerald-900 text-emerald-400 text-xs rounded px-4 py-2.5 mb-5">
          {success}
        </div>
      )}

      {/* fatal error */}
      {fatalErr && (
        <div className="bg-red-950 border border-red-900 text-red-400 text-xs rounded px-4 py-2.5 mb-5">
          {fatalErr}
        </div>
      )}

      {/* validation results */}
      {preview && (
        <div className="t-bg-surface border t-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest t-text-3">Validation Results</p>
            <div className="flex items-center gap-2 text-[10px]">
              {preview.summary.creates > 0 && (
                <span className="bg-emerald-950 text-emerald-500 px-1.5 py-0.5 rounded">{preview.summary.creates} new</span>
              )}
              {preview.summary.updates > 0 && (
                <span className="bg-yellow-950 text-yellow-500 px-1.5 py-0.5 rounded">{preview.summary.updates} update</span>
              )}
              {preview.summary.noops > 0 && (
                <Tooltip
                  underline={false}
                  content="These rows already match what's stored — nothing to change."
                  note="Safe to re-run this preview as many times as you like; it never writes anything.">
                  <span className="t-bg-elevated t-text-3 px-1.5 py-0.5 rounded">{preview.summary.noops} no-op</span>
                </Tooltip>
              )}
              {preview.summary.errors > 0 && (
                <span className="bg-red-950 text-red-400 px-1.5 py-0.5 rounded">{preview.summary.errors} error{preview.summary.errors !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>

          {/* error list */}
          {preview.error_rows.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] t-text-3 mb-1.5">Errors (these rows will be skipped):</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {preview.error_rows.map((e: ImportErrorRow) => (
                  <div key={e.row_number} className="flex gap-2 text-[10px]">
                    <span className="t-text-4 shrink-0">Row {e.row_number}</span>
                    {e.anchor && <span className="font-mono t-text-3 shrink-0">{e.anchor}</span>}
                    <span className="text-red-400">{e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* actions */}
          <div className="flex items-center gap-2 mt-3">
            {preview.error_rows.length > 0 && (
              <button onClick={downloadErrors}
                className="px-3 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong">
                ↓ Error Report
              </button>
            )}
            <button
              disabled={!hasValid}
              onClick={() => setShowDiff(true)}
              className="ml-auto px-4 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40 transition-colors"
              style={{ backgroundColor: 'var(--accent)' }}>
              Review & Confirm → ({preview.valid_rows.filter(r => r.mode !== 'noop').length} rows)
            </button>
          </div>
        </div>
      )}

      {/* diff modal */}
      {showDiff && preview && (
        <DiffModal
          entity={entity}
          preview={preview}
          rawRows={rawRows}
          onConfirm={handleSuccess}
          onClose={() => setShowDiff(false)}
        />
      )}
    </div>
  )
}

// ── Import Hub ────────────────────────────────────────────────────────────────

export default function ImportHub() {
  const { user } = useAuth()
  const [activeId, setActiveId] = useState(ENTITIES[0].id)

  const visibleEntities = useMemo(
    () => ENTITIES.filter(e => user?.action_keys?.includes(e.actionKey) ?? false),
    [user],
  )

  if (visibleEntities.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm t-text-3">
          You do not have permission to import any data type. Contact your administrator.
        </p>
      </div>
    )
  }

  const effectiveId = visibleEntities.some(e => e.id === activeId)
    ? activeId
    : visibleEntities[0].id
  const activeEntity = ENTITIES.find(e => e.id === effectiveId) ?? visibleEntities[0]

  return (
    <div className="flex h-full min-h-[500px] overflow-hidden -mx-6 -mt-6">
      {/* sidebar */}
      <aside className="w-48 shrink-0 border-r t-border t-bg-surface flex flex-col py-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest t-text-4 px-3 mb-2">Entity Type</p>
        {visibleEntities.map(e => (
          <button key={e.id} onClick={() => setActiveId(e.id)}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              effectiveId === e.id
                ? 't-text-1 font-medium t-bg-elevated border-r-2'
                : 't-text-2 hover:t-bg-elevated'
            }`}
            style={effectiveId === e.id ? { borderRightColor: 'var(--accent)' } : undefined}>
            {e.label}
          </button>
        ))}
      </aside>

      {/* main area */}
      <div className="flex-1 overflow-y-auto">
        <ImportForm key={effectiveId} entity={activeEntity} />
      </div>
    </div>
  )
}
