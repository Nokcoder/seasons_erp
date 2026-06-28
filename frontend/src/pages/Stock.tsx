import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Transfers        = lazy(() => import('./stock/Transfers'))
const TransferNew      = lazy(() => import('./stock/TransferNew'))
const TransferDetail   = lazy(() => import('./stock/TransferDetail'))
const Receiving        = lazy(() => import('./stock/Receiving'))
const ReceivingNew     = lazy(() => import('./stock/ReceivingNew'))
const ReceivingDetail  = lazy(() => import('./stock/ReceivingDetail'))
const ReceivingConfirm = lazy(() => import('./stock/ReceivingConfirm'))
const Ledger           = lazy(() => import('./stock/Ledger'))

const TAB_CLS = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-xs font-medium rounded transition-colors ${isActive ? 't-bg-elevated t-text-1' : 't-text-4 hover:t-text-2'}`

export default function Stock() {
  const { user } = useAuth()
  const programs = user?.programs ?? []
  const hasTransfers  = programs.includes('stock_transfers')
  const hasReceiving  = programs.includes('stock_receiving')
  const hasLedger     = programs.includes('stock_ledger')

  const defaultTab = hasTransfers ? 'transfers' : hasReceiving ? 'receiving' : 'ledger'

  return (
    <div className="min-h-full t-bg-base flex flex-col">
      <div className="flex items-center gap-1 px-4 py-2 border-b t-border t-bg-surface shrink-0">
        {hasTransfers && <NavLink to="/stock/transfers" className={TAB_CLS}>Transfers</NavLink>}
        {hasReceiving && <NavLink to="/stock/receiving" className={TAB_CLS}>Receiving</NavLink>}
        {hasLedger    && <NavLink to="/stock/ledger"    className={TAB_CLS}>Ledger</NavLink>}
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<div className="p-8 text-sm t-text-4 animate-pulse">Loading…</div>}>
          <Routes>
            <Route index element={<Navigate to={defaultTab} replace />} />
            {hasTransfers && (
              <>
                <Route path="transfers"             element={<Transfers />} />
                <Route path="transfers/new"         element={<TransferNew />} />
                <Route path="transfers/:transferId" element={<TransferDetail />} />
              </>
            )}
            {hasReceiving && (
              <>
                <Route path="receiving"                             element={<Receiving />} />
                <Route path="receiving/new"                         element={<ReceivingNew />} />
                <Route path="receiving/:shipmentId/confirm"         element={<ReceivingConfirm />} />
                <Route path="receiving/:shipmentId"                 element={<ReceivingDetail />} />
              </>
            )}
            {hasLedger && <Route path="ledger" element={<Ledger />} />}
            <Route path="*" element={<Navigate to={defaultTab} replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
