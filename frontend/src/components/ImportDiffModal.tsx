// ImportDiffModal — shows a diff of incoming import rows vs current DB values.
// Supports row-by-row confirm/skip and bulk confirm all.
// ui_standards §2

import { useState } from 'react'
import { post } from '../services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportPreviewVariant {
  PID:         string
  mode:        'create' | 'update'
  old_values:  Record<string, unknown> | null
  new_values:  Record<string, unknown>
  diff_fields: string[]
}

export interface ImportPreviewRow {
  brand:        string
  product_mode: 'create' | 'update'
  product_id:   number | null
  variants:     ImportPreviewVariant[]
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[]
}

interface Props {
  preview:  ImportPreviewResponse
  onConfirm: (confirmedPids: string[]) => Promise<void>
  onCancel:  () => void
}

// ── helpers ───────────────────────────────────────────────────────────────────

function diffClass(field: string, diffFields: string[]) {
  return diffFields.includes(field) ? 'font-semibold text-yellow-400' : 'text-gray-600'
}

function fmt(v: unknown): string {
  if (v == null || v === '') return '—'
  return String(v)
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ImportDiffModal({ preview, onConfirm, onCancel }: Props) {
  const allPids = preview.rows.flatMap(r => r.variants.map(v => v.PID))
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set(allPids))
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  function togglePid(pid: string) {
    setConfirmed(prev => {
      const n = new Set(prev)
      n.has(pid) ? n.delete(pid) : n.add(pid)
      return n
    })
  }
  function confirmAll() { setConfirmed(new Set(allPids)) }
  function skipAll()    { setConfirmed(new Set()) }

  async function handleApply() {
    setApplying(true); setError('')
    try {
      await onConfirm(Array.from(confirmed))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally { setApplying(false) }
  }

  const createCount = allPids.filter(p => preview.rows.flatMap(r => r.variants).find(v => v.PID === p)?.mode === 'create').length
  const updateCount = allPids.length - createCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-sm font-semibold text-gray-200">Import Preview</p>
            <p className="text-[10px] text-gray-600 mt-0.5">
              {createCount} to create · {updateCount} to update · {allPids.length - confirmed.size} skipped
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={confirmAll} className="text-[10px] text-blue-500 hover:text-blue-400 font-medium">Confirm all</button>
            <span className="text-gray-700">·</span>
            <button onClick={skipAll}    className="text-[10px] text-gray-500 hover:text-gray-400">Skip all</button>
            <button onClick={onCancel}   className="text-gray-600 hover:text-gray-400 text-xl leading-none ml-2">×</button>
          </div>
        </div>

        {/* diff table */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2 mb-3">{error}</div>}

          {preview.rows.map(row => (
            <div key={row.brand + (row.product_id ?? '')} className="mb-5">
              {/* product row header */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-medium uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  row.product_mode === 'create' ? 'bg-emerald-950 text-emerald-500' : 'bg-yellow-950 text-yellow-500'
                }`}>{row.product_mode}</span>
                <span className="text-sm font-semibold text-gray-300">{row.brand}</span>
              </div>

              {/* variant rows */}
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-2 py-1 text-left text-[10px] uppercase text-gray-600 w-6"></th>
                    <th className="px-2 py-1 text-left text-[10px] uppercase text-gray-600">PID</th>
                    <th className="px-2 py-1 text-left text-[10px] uppercase text-gray-600">Mode</th>
                    <th className="px-2 py-1 text-left text-[10px] uppercase text-gray-600">Field</th>
                    <th className="px-2 py-1 text-left text-[10px] uppercase text-gray-600">Current</th>
                    <th className="px-2 py-1 text-left text-[10px] uppercase text-gray-600">Incoming</th>
                  </tr>
                </thead>
                <tbody>
                  {row.variants.map(v => {
                    const isConfirmed = confirmed.has(v.PID)
                    const fields = v.mode === 'create'
                      ? Object.keys(v.new_values).filter(k => v.new_values[k] != null && v.new_values[k] !== '')
                      : v.diff_fields.length > 0 ? v.diff_fields : ['(no changes)']

                    return fields.map((field, fi) => (
                      <tr key={`${v.PID}-${field}`}
                        className={`border-b border-gray-800 ${isConfirmed ? '' : 'opacity-40'}`}>
                        {fi === 0 && (
                          <td rowSpan={fields.length} className="px-2 py-1.5 align-top">
                            <input type="checkbox" className="accent-blue-500 mt-0.5"
                              checked={isConfirmed}
                              onChange={() => togglePid(v.PID)} />
                          </td>
                        )}
                        {fi === 0 && (
                          <td rowSpan={fields.length} className="px-2 py-1.5 font-mono text-gray-400 align-top">
                            {v.PID}
                          </td>
                        )}
                        {fi === 0 && (
                          <td rowSpan={fields.length} className="px-2 py-1.5 align-top">
                            <span className={`text-[10px] font-medium uppercase px-1 py-0.5 rounded ${
                              v.mode === 'create' ? 'bg-emerald-950 text-emerald-500' : 'bg-yellow-950 text-yellow-500'
                            }`}>{v.mode}</span>
                          </td>
                        )}
                        <td className={`px-2 py-1.5 ${diffClass(field, v.diff_fields)}`}>{field}</td>
                        <td className="px-2 py-1.5 text-gray-500">{v.old_values ? fmt(v.old_values[field]) : '—'}</td>
                        <td className={`px-2 py-1.5 ${v.diff_fields.includes(field) ? 'text-yellow-300 font-medium' : 'text-gray-400'}`}>
                          {field === '(no changes)' ? <span className="text-gray-700 italic">no field changes</span> : fmt(v.new_values[field])}
                        </td>
                      </tr>
                    ))
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-800 shrink-0">
          <span className="text-xs text-gray-500">
            {confirmed.size} of {allPids.length} rows selected
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={onCancel}
              className="px-4 py-1.5 text-xs border border-gray-700 rounded text-gray-400 hover:border-gray-600">
              Cancel
            </button>
            <button onClick={handleApply} disabled={applying || confirmed.size === 0}
              className="px-5 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent)' }}>
              {applying ? 'Applying…' : `Apply ${confirmed.size} rows`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
