import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { stockApi, type Transfer } from '../../services/api'
import * as XLSX from 'xlsx'
import { normalize } from '../../lib/normalize'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Transfers() {
  const navigate = useNavigate()
  const { data: transfers = [], isLoading, isFetching } = useQuery({
    queryKey: qk.transfers(),
    queryFn:  () => stockApi.transfers.list(),
    ...stale.transactional,
  })

  const [search,       setSearch]       = useState('')
  const [locFilter,    setLocFilter]    = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = useMemo(() => {
    return transfers.filter(t => {
      if (search.trim() && !(
        normalize(t.transfer_pid ?? '').includes(normalize(search)) ||
        normalize(t.from_location?.location_name ?? '').includes(normalize(search)) ||
        normalize(t.to_location?.location_name   ?? '').includes(normalize(search))
      )) return false
      if (locFilter && t.from_location?.location_name !== locFilter && t.to_location?.location_name !== locFilter) return false
      if (statusFilter && (t.status ?? 'Posted') !== statusFilter) return false
      if (dateFrom && t.occurred_at < dateFrom) return false
      if (dateTo   && t.occurred_at.slice(0, 10) > dateTo) return false
      return true
    })
  }, [transfers, search, locFilter, statusFilter, dateFrom, dateTo])

  const allLocs = useMemo(() => {
    const s = new Set<string>()
    transfers.forEach(t => {
      if (t.from_location) s.add(t.from_location.location_name)
      if (t.to_location)   s.add(t.to_location.location_name)
    })
    return Array.from(s).sort()
  }, [transfers])

  function handleExport() {
    const rows = filtered.map(t => ({
      'Transfer PID':   t.transfer_pid ?? '',
      'From':           t.from_location?.location_name ?? '',
      'To':             t.to_location?.location_name ?? '',
      'Date':           fmtDate(t.occurred_at),
      'Bundle Count':   t.total_bundle_count ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Transfers')
    XLSX.writeFile(wb, `transfers_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const inputCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5">
      <FetchingBar show={isFetching && !isLoading} />

      {/* toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-sm font-semibold t-text-1">Transfers</h1>
        <input className={`${inputCls} w-48`} placeholder="Search PID, location…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className={`${inputCls} w-36`} value={locFilter} onChange={e => setLocFilter(e.target.value)}>
          <option value="">All locations</option>
          {allLocs.map(l => <option key={l}>{l}</option>)}
        </select>
        <select className={`${inputCls} w-28`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Posted">Posted</option>
          <option value="Voided">Voided</option>
        </select>
        <input type="date" className={`${inputCls} w-36`} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" className={`${inputCls} w-36`} value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        <div className="ml-auto flex gap-2">
          <button onClick={handleExport} className="px-2.5 py-1 text-xs border t-border rounded t-text-3 hover:t-border-strong">
            Export XLSX
          </button>
          <button onClick={() => navigate('/stock/transfers/new')}
            className="px-3 py-1 text-xs rounded text-white font-medium"
            style={{ backgroundColor: 'var(--accent)' }}>
            + New Transfer
          </button>
        </div>
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['Transfer PID','Route','Date','Bundle Count','Status','Actions'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable rows={8} cols={5} />}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center t-text-4">No transfers found.</td></tr>
            )}
            {!isLoading && filtered.map((t: Transfer) => (
              <tr key={t.transfer_id}
                onClick={() => navigate(`/stock/transfers/${t.transfer_id}`)}
                className="border-b t-border hover:t-bg-surface cursor-pointer transition-colors">
                <td className="px-3 py-2 font-mono t-text-2">{t.transfer_pid ?? `TRF-${t.transfer_id}`}</td>
                <td className="px-3 py-2 t-text-3">
                  {t.from_location?.location_name ?? '—'} <span className="t-text-4">→</span> {t.to_location?.location_name ?? '—'}
                </td>
                <td className="px-3 py-2 t-text-4">{fmtDate(t.occurred_at)}</td>
                <td className="px-3 py-2 tabular-nums t-text-4">{t.total_bundle_count ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                    (t.status ?? 'Posted') === 'Posted' ? 'bg-blue-950 text-blue-400' : 't-bg-elevated t-text-4'
                  }`}>{t.status ?? 'Posted'}</span>
                </td>
                <td className="px-3 py-2">
                  <button className="text-[10px] text-blue-400 hover:underline">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
