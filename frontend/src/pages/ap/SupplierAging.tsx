import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import { apApi, type SupplierAgingRow } from '../../services/api'
import * as XLSX from 'xlsx'
import { jsonToFormattedSheet, MONEY_FORMAT } from '../../lib/xlsxMoney'

// ── helpers ───────────────────────────────────────────────────────────────────

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDateDisplay(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', {
    month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC',
  })
}

function fmt(n: number) {
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── bucket column definitions ─────────────────────────────────────────────────

type BucketKey = 'current' | 'bucket_30' | 'bucket_60' | 'bucket_90' | 'bucket_90p'

const BUCKET_COLS: { key: BucketKey; label: string; tintCls: string }[] = [
  { key: 'current',    label: 'Current', tintCls: '' },
  { key: 'bucket_30',  label: '1–30',    tintCls: '' },
  { key: 'bucket_60',  label: '31–60',   tintCls: 'bg-amber-50 text-amber-700' },
  { key: 'bucket_90',  label: '61–90',   tintCls: 'bg-amber-100 text-amber-900' },
  { key: 'bucket_90p', label: '90+',     tintCls: 'bg-red-50 text-red-700' },
]

function BucketCell({ value, tintCls }: { value: number; tintCls: string }) {
  if (value === 0) {
    return <td className="px-3 py-2 tabular-nums text-right t-text-4">—</td>
  }
  return (
    <td className={`px-3 py-2 tabular-nums text-right ${tintCls || 't-text-2'}`}>
      ₱{fmt(value)}
    </td>
  )
}

// ── component ─────────────────────────────────────────────────────────────────

const inputCls  = 't-bg-input border t-border-strong rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 ring-[var(--accent)] transition-colors w-full'
const labelCls  = 'block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1'
const thCls     = 'text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'
const thNumCls  = 'text-right px-3 py-2 text-[10px] font-bold uppercase tracking-widest t-text-2 whitespace-nowrap'

export default function SupplierAging() {
  const { user } = useAuth()
  const canExport = user?.action_keys?.includes('export_ap_aging') ?? false
  const navigate = useNavigate()
  const [asOf, setAsOf] = useState(todayLocal())

  const { data: agingData, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: qk.apAging(asOf),
    queryFn:  () => apApi.getAging(asOf),
    staleTime: stale.transactional,
  })

  const rows    = agingData?.rows ?? []
  const totals  = agingData?.totals ?? null

  function handleExport() {
    if (!agingData) return
    const rows = [
      ...agingData.rows.map(r => ({
        'Supplier':     r.supplier_name,
        'Code':         r.supplier_code ?? '',
        'Invoices':     r.invoice_count,
        'Pending Vetting': r.has_pending_vetting ? 'Yes' : '',
        'Rejected':     r.has_rejected ? 'Yes' : '',
        'Current':      Number(r.current),
        '1-30 Days':    Number(r.bucket_30),
        '31-60 Days':   Number(r.bucket_60),
        '61-90 Days':   Number(r.bucket_90),
        '90+ Days':     Number(r.bucket_90p),
        'Total':        Number(r.total),
      })),
      {
        'Supplier':     'Total',
        'Code':         '',
        'Invoices':     agingData.totals.invoice_count,
        'Pending Vetting': '',
        'Rejected':     '',
        'Current':      agingData.totals.current,
        '1-30 Days':    agingData.totals.bucket_30,
        '31-60 Days':   agingData.totals.bucket_60,
        '61-90 Days':   agingData.totals.bucket_90,
        '90+ Days':     agingData.totals.bucket_90p,
        'Total':        agingData.totals.total,
      },
    ]
    const ws = jsonToFormattedSheet(rows, {
      'Current': MONEY_FORMAT, '1-30 Days': MONEY_FORMAT, '31-60 Days': MONEY_FORMAT,
      '61-90 Days': MONEY_FORMAT, '90+ Days': MONEY_FORMAT, 'Total': MONEY_FORMAT,
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AP Aging')
    XLSX.writeFile(wb, `ap_aging_${asOf}.xlsx`)
  }

  function handleRowClick(row: SupplierAgingRow) {
    navigate(`/ap?supplier_id=${row.supplier_id}`)
  }

  return (
    <div className="flex h-full overflow-hidden t-bg-base">
      <FetchingBar show={isFetching && !isLoading} />

      {/* ── filter panel ─────────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r t-border t-bg-surface flex flex-col overflow-y-auto p-3 gap-4">
        <div>
          <label className={labelCls}>As of Date</label>
          <input
            type="date"
            value={asOf}
            onChange={e => setAsOf(e.target.value || todayLocal())}
            className={inputCls}
          />
        </div>
      </aside>

      {/* ── main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b t-border t-bg-surface shrink-0">
          <span className="text-xs t-text-3">
            {rows.length} supplier{rows.length !== 1 ? 's' : ''}
            {agingData && <> · as of {fmtDateDisplay(agingData.as_of)}</>}
          </span>
          {canExport && (
            <button
              onClick={handleExport}
              disabled={!agingData || rows.length === 0}
              className="ml-auto px-2.5 py-1 text-xs border t-border rounded t-text-2 hover:t-border-strong disabled:opacity-40"
            >
              Export XLSX
            </button>
          )}
        </div>

        {/* table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="t-bg-elevated border-b t-border-strong">
                <th className={thCls}>Supplier</th>
                <th className={thNumCls}>Invoices</th>
                {BUCKET_COLS.map(b => (
                  <th key={b.key} className={thNumCls}>{b.label}</th>
                ))}
                <th className={thNumCls}>Total</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <SkeletonTable rows={8} cols={8} />}

              {!isLoading && isError && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center">
                    <span className="text-xs text-red-600">{String(error)}</span>
                    <br />
                    <button
                      onClick={() => refetch()}
                      className="mt-2 px-3 py-1.5 text-xs border t-border rounded t-text-2 hover:t-border-strong"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              )}

              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center t-text-4">
                    No outstanding supplier invoices as of {agingData ? fmtDateDisplay(agingData.as_of) : asOf}.
                  </td>
                </tr>
              )}

              {!isLoading && !isError && rows.map(row => (
                <tr
                  key={row.supplier_id}
                  className="border-b t-border hover:t-bg-surface cursor-pointer transition-colors"
                  onClick={() => handleRowClick(row)}
                >
                  {/* Supplier column with badges */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="t-text-1 font-medium">{row.supplier_name}</span>
                      {row.has_pending_vetting && (
                        <span className="inline-block px-1 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 leading-none">
                          Pending
                        </span>
                      )}
                      {row.has_rejected && (
                        <span className="inline-block px-1 py-0.5 rounded text-[9px] font-medium bg-red-100 text-red-700 leading-none">
                          Rejected
                        </span>
                      )}
                    </div>
                    {row.supplier_code && (
                      <p className="text-[10px] t-text-4 mt-0.5 font-mono">{row.supplier_code}</p>
                    )}
                  </td>

                  {/* Invoice count */}
                  <td className="px-3 py-2 text-right tabular-nums t-text-3">
                    {row.invoice_count}
                  </td>

                  {/* Bucket cells */}
                  {BUCKET_COLS.map(b => (
                    <BucketCell key={b.key} value={row[b.key]} tintCls={b.tintCls} />
                  ))}

                  {/* Total — always shown, bold */}
                  <td className="px-3 py-2 text-right tabular-nums t-text-1 font-semibold">
                    ₱{fmt(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* ── totals footer (from backend SupplierAgingResponse.totals) ── */}
            {!isLoading && !isError && totals && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="t-bg-elevated border-t-2 t-border-strong font-semibold">
                  <td className="px-3 py-2 t-text-1" colSpan={2}>Total</td>
                  {BUCKET_COLS.map(b => (
                    <td key={b.key} className={`px-3 py-2 tabular-nums text-right ${b.tintCls && totals[b.key] > 0 ? b.tintCls : 't-text-2'}`}>
                      {totals[b.key] === 0 ? '—' : `₱${fmt(totals[b.key])}`}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums t-text-1">
                    ₱{fmt(totals.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
