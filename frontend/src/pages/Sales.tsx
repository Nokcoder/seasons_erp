import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { useAuth } from '../context/AuthContext'

const Workstation  = lazy(() => import('./sales/Workstation'))
const SalesLedger  = lazy(() => import('./sales/SalesLedger'))
const SaleDetail   = lazy(() => import('./sales/SaleDetail'))
const ReturnNew    = lazy(() => import('./sales/ReturnNew'))
const ReturnDetail = lazy(() => import('./sales/ReturnDetail'))

const TAB_CLS = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-xs font-medium rounded transition-colors ${isActive ? 't-bg-elevated t-text-1' : 't-text-4 hover:t-text-2'}`

function Loading() {
  return <div className="p-8 text-sm t-text-3 animate-pulse">Loading…</div>
}

export default function Sales() {
  const { user } = useAuth()
  const programs = user?.programs ?? []
  const hasLedger  = programs.includes('sales_ledger')
  const hasReturns = programs.includes('sales_returns')

  return (
    <div className="min-h-full t-bg-base flex flex-col">
      <div className="flex items-center gap-1 px-4 py-2 border-b t-border t-bg-surface shrink-0">
        <NavLink to="/sales/new"    className={TAB_CLS}>New Sale</NavLink>
        {hasLedger  && <NavLink to="/sales/ledger"  className={TAB_CLS}>Sales Ledger</NavLink>}
        {hasReturns && <NavLink to="/sales/returns" className={TAB_CLS}>Returns</NavLink>}
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="new" element={<Workstation />} />
            {hasLedger && (
              <>
                <Route path="ledger"         element={<SalesLedger />} />
                <Route path="ledger/:saleId" element={<SaleDetail />} />
              </>
            )}
            {hasReturns && (
              <>
                <Route path="returns/new"           element={<ReturnNew />} />
                <Route path="returns/:returnId"     element={<ReturnDetail />} />
              </>
            )}
            <Route index element={<Navigate to="new" replace />} />
            <Route path="*" element={<Navigate to="new" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
