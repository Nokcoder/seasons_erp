import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import KeywordSearch from '../../components/KeywordSearch'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { useAuth } from '../../context/AuthContext'
import { inventoryApi, stockApi, type LedgerEntry } from '../../services/api'
import { normalize } from '../../lib/normalize'
import * as XLSX from 'xlsx'

const REASONS = ['RECEIVE','TRANSFER_IN','TRANSFER_OUT','RETURN_IN','RETURN_OUT','ADJUST'] as const
type Reason = typeof REASONS[number]

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

const REASON_COLORS: Record<string, string> = {
  RECEIVE:      'text-emerald-400',
  TRANSFER_IN:  'text-blue-400',
  RETURN_IN:    'text-blue-300',
  TRANSFER_OUT: 'text-orange-400',
  RETURN_OUT:   'text-orange-300',
  ADJUST:       'text-yellow-400',
}

const PAGE = 100

function DocIdCell({ entry }: { entry: LedgerEntry }) {
  const navigate = useNavigate()
  const pid = entry.document_pid
  if (!pid) return <span className="t-text-4">—</span>

  if (entry.reason === 'TRANSFER_IN' || entry.reason === 'TRANSFER_OUT') {
    return (
      <button
        onClick={e => { e.stopPropagation(); navigate(`/stock/transfers/${entry.reference_id}`) }}
        className="font-mono text-blue-400 hover:underline text-[10px]">
        {pid}
      </button>
    )
  }
  if (entry.reason === 'RECEIVE') {
    return (
      <button
        onClick={e => { e.stopPropagation(); navigate(`/stock/receiving/${entry.reference_id}`) }}
        className="font-mono text-blue-400 hover:underline text-[10px]">
        {pid}
      </button>
    )
  }
  return <span className="font-mono t-text-4 text-[10px]">{pid}</span>
}

export default function Ledger() {
  const { user } = useAuth()
  const canExport = user?.action_keys?.includes('export_stock_ledger') ?? false
  // ── all state declared before any derived values ──────────────────────────
  const [searchTags, setSearchTags] = useState<string[]>([])
  const [liveInput,  setLiveInput]  = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [reasons,   setReasons]   = useState<Set<Reason>>(new Set())
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [cursor,    setCursor]    = useState<number | undefined>(undefined)
  const [allEntries, setAllEntries] = useState<LedgerEntry[]>([])
  const [hasMore,   setHasMore]   = useState(false)

  // ── reference data ─────────────────────────────────────────────────────────
  const { data: locations = [] } = useQuery({
    queryKey: qk.locations(),
    queryFn:  () => inventoryApi.locations.all(),
    ...stale.reference,
  })

  // ── filter params (all state vars are now in scope) ────────────────────────
  const filterParams = useMemo(() => ({
    reason:      reasons.size > 0 ? Array.from(reasons).join(',') : undefined,
    location_id: locFilter ? parseInt(locFilter) : undefined,
    date_from:   dateFrom || undefined,
    date_to:     dateTo   || undefined,
  }), [reasons, locFilter, dateFrom, dateTo])

  // ── ledger query ───────────────────────────────────────────────────────────
  const { data: page = [], isLoading, isFetching } = useQuery({
    queryKey: qk.ledger({ ...filterParams, cursor }),
    queryFn:  () => stockApi.ledger.list({ ...filterParams, limit: PAGE, cursor }),
    ...stale.transactional,
  })

  // Accumulate pages — cursor=undefined means first page (replace), otherwise append
  useEffect(() => {
    if (cursor === undefined) {
      setAllEntries(page)
    } else {
      setAllEntries(prev => [...prev, ...page])
    }
    setHasMore(page.length === PAGE)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset accumulator when filters change (not when cursor changes)
  useEffect(() => {
    setCursor(undefined)
  }, [locFilter, dateFrom, dateTo, reasons]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleReason(r: Reason) {
    setReasons(prev => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n })
  }

  // Client-side keyword filter (brand, PID, variant name, ref ID) — AND across tags
  const filtered = useMemo(() => {
    const allTerms = [
      ...searchTags.map(t => normalize(t)),
      ...(liveInput.trim() ? [normalize(liveInput)] : []),
    ]
    if (allTerms.length === 0) return allEntries
    return allEntries.filter((e: LedgerEntry) => {
      const hit = (term: string) =>
        normalize(e.variant?.product?.brand ?? '').includes(term) ||
        normalize(e.variant?.variant_name   ?? '').includes(term) ||
        normalize(e.variant?.PID            ?? '').includes(term) ||
        normalize(e.variant?.sku            ?? '').includes(term) ||
        normalize(e.reference_id            ?? '').includes(term) ||
        normalize(e.document_pid            ?? '').includes(term)
      return allTerms.every(hit)
    })
  }, [allEntries, searchTags, liveInput])

  function handleExport() {
    const rows = filtered.map(e => ({
      Date:           fmtDate(e.occurred_at),
      Brand:          e.variant?.product?.brand ?? '',
      'Variant Name': e.variant?.variant_name ?? '',
      PID:            e.variant?.PID ?? '',
      Location:       e.location?.location_name ?? '',
      Reason:         e.reason,
      'Qty Change':   e.qty_change,
      'Document ID':  e.document_pid ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
    XLSX.writeFile(wb, `ledger_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const allLocs  = locations.filter(l => !l.is_deleted)
  const inputCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5">
      <FetchingBar show={isFetching && !isLoading} />

      {/* filters */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h1 className="text-sm font-semibold t-text-1">Inventory Ledger</h1>
        <div>
          <label className="block text-[10px] font-medium uppercase tracking-widest t-text-3 mb-1">
            Keyword
          </label>
          <KeywordSearch
            tags={searchTags}
            onTagsChange={setSearchTags}
            onPartialChange={setLiveInput}
            placeholder="Brand, PID, SKU, Doc ID…"
            className="w-56"
          />
        </div>
        <select className={`${inputCls} w-36`} value={locFilter} onChange={e => setLocFilter(e.target.value)}>
          <option value="">All locations</option>
          {allLocs.map(l => (
            <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
          ))}
        </select>
        <input type="date" className={`${inputCls} w-36`} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" className={`${inputCls} w-36`} value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        {canExport && (
          <button onClick={handleExport} className="px-2.5 py-1 text-xs border t-border rounded t-text-3 hover:t-border-strong ml-auto">
            Export XLSX
          </button>
        )}
      </div>

      {/* reason pills */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {REASONS.map(r => (
          <button key={r} onClick={() => toggleReason(r)}
            className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border transition-colors ${
              reasons.has(r)
                ? 't-bg-elevated t-border-strong t-text-1'
                : 't-border t-text-4 hover:t-border'
            }`}>
            {r}
          </button>
        ))}
        {reasons.size > 0 && (
          <button onClick={() => setReasons(new Set())} className="text-[10px] t-text-4 hover:t-text-3 ml-1">
            Clear
          </button>
        )}
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['Date','Brand','Variant Name','PID','SKU','Location','Reason','Qty Change','Document ID'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable rows={10} cols={9} />}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center t-text-4">
                  No ledger entries match the current filters.
                </td>
              </tr>
            )}
            {!isLoading && filtered.map((e: LedgerEntry) => (
              <tr key={e.ledger_id} className="border-b t-border">
                <td className="px-3 py-2 t-text-4 whitespace-nowrap">{fmtDate(e.occurred_at)}</td>
                <td className="px-3 py-2 t-text-3">{e.variant?.product?.brand ?? '—'}</td>
                <td className="px-3 py-2 t-text-2">{e.variant?.variant_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono t-text-4">{e.variant?.PID ?? '—'}</td>
                <td className="px-3 py-2 font-mono t-text-3 whitespace-nowrap">{e.variant?.sku ?? '—'}</td>
                <td className="px-3 py-2 t-text-3">{e.location?.location_name ?? '—'}</td>
                <td className={`px-3 py-2 font-medium ${REASON_COLORS[e.reason] ?? 't-text-3'}`}>{e.reason}</td>
                <td className={`px-3 py-2 tabular-nums font-medium ${Number(e.qty_change) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {Number(e.qty_change) > 0 ? '+' : ''}{Number(e.qty_change).toFixed(2)}
                </td>
                <td className="px-3 py-2"><DocIdCell entry={e} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-3 text-center">
          <button
            onClick={() => {
              const last = allEntries[allEntries.length - 1]
              if (last) setCursor(last.ledger_id)
            }}
            disabled={isFetching}
            className="text-[10px] text-blue-500 hover:text-blue-400 disabled:opacity-40 font-medium">
            {isFetching ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
