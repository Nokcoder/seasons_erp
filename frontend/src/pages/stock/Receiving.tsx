import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FetchingBar, SkeletonTable } from '../../components/Skeleton'
import { qk } from '../../lib/queryKeys'
import { stale } from '../../lib/queryClient'
import { stockApi, type Shipment } from '../../services/api'
import * as XLSX from 'xlsx'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

function shipmentStatus(s: Shipment): string {
  if (s.is_confirmed) return 'Confirmed'
  if (s.receiving_details && s.receiving_details.length > 0) return 'Pending Confirmation'
  return 'Pending'
}

export default function Receiving() {
  const navigate = useNavigate()
  const { data: shipments = [], isLoading, isFetching } = useQuery({
    queryKey: qk.shipments(),
    queryFn:  () => stockApi.shipments.list(),
    ...stale.transactional,
  })

  const [search,    setSearch]    = useState('')
  const [supFilter, setSupFilter] = useState('')

  const allSuppliers = useMemo(() => {
    const s = new Set<string>()
    shipments.forEach(sh => { if (sh.supplier?.supplier_name) s.add(sh.supplier.supplier_name) })
    return Array.from(s).sort()
  }, [shipments])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return shipments.filter(s => {
      if (q && !((s.shipment_pid ?? '').toLowerCase().includes(q) || (s.supplier?.supplier_name ?? '').toLowerCase().includes(q) || (s.reference_number ?? '').toLowerCase().includes(q))) return false
      if (supFilter && s.supplier?.supplier_name !== supFilter) return false
      return true
    })
  }, [shipments, search, supFilter])

  function handleExport() {
    const rows = filtered.map(s => ({
      'Shipment PID':  s.shipment_pid ?? '',
      'Supplier':      s.supplier?.supplier_name ?? '',
      'Document ID':   s.reference_number ?? '',
      'Date Received': fmtDate(s.received_at),
      'PO Reference':  s.po?.po_pid ?? '',
      'Status':        shipmentStatus(s),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Receiving')
    XLSX.writeFile(wb, `receiving_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const inputCls = 't-bg-elevated border t-border rounded px-2 py-1.5 text-xs t-text-1 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-5">
      <FetchingBar show={isFetching && !isLoading} />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-sm font-semibold t-text-1">Receiving</h1>
        <input className={`${inputCls} w-48`} placeholder="Search PID, supplier…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className={`${inputCls} w-40`} value={supFilter} onChange={e => setSupFilter(e.target.value)}>
          <option value="">All suppliers</option>
          {allSuppliers.map(s => <option key={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={handleExport} className="px-2.5 py-1 text-xs border t-border rounded t-text-3 hover:t-border-strong">
            Export XLSX
          </button>
          <button onClick={() => navigate('/stock/receiving/new')}
            className="px-3 py-1 text-xs rounded text-white font-medium"
            style={{ backgroundColor: 'var(--accent)' }}>
            + New Shipment
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b t-border">
              {['Shipment PID','Supplier','Document ID','Date Received','PO Reference','Status','Actions'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest t-text-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable rows={8} cols={7} />}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center t-text-4">No shipments found.</td></tr>
            )}
            {!isLoading && filtered.map((s: Shipment) => {
              const status = shipmentStatus(s)
              return (
                <tr key={s.shipment_id}
                  onClick={() => navigate(`/stock/receiving/${s.shipment_id}`)}
                  className="border-b t-border hover:t-bg-surface cursor-pointer transition-colors">
                  <td className="px-3 py-2 font-mono t-text-2">{s.shipment_pid ?? `SHP-${s.shipment_id}`}</td>
                  <td className="px-3 py-2 t-text-3">{s.supplier?.supplier_name ?? '—'}</td>
                  <td className="px-3 py-2 t-text-4">{s.reference_number ?? '—'}</td>
                  <td className="px-3 py-2 t-text-4">{fmtDate(s.received_at)}</td>
                  <td className="px-3 py-2 font-mono t-text-4">{s.po?.po_pid ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      status === 'Confirmed'
                        ? 'bg-emerald-950 text-emerald-500'
                        : status === 'Pending Confirmation'
                        ? 'bg-yellow-950 text-yellow-500'
                        : 't-bg-elevated t-text-4'
                    }`}>{status}</span>
                  </td>
                  <td className="px-3 py-2 flex gap-3">
                    <button className="text-[10px] text-blue-400 hover:underline"
                      onClick={e => { e.stopPropagation(); navigate(`/stock/receiving/${s.shipment_id}`) }}>
                      View
                    </button>
                    {status === 'Pending Confirmation' && (
                      <button className="text-[10px] text-emerald-400 hover:underline"
                        onClick={e => { e.stopPropagation(); navigate(`/stock/receiving/${s.shipment_id}/confirm`) }}>
                        Confirm Costs
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
