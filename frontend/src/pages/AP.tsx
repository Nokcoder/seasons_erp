import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { lazy, Suspense } from 'react'

const InvoiceList   = lazy(() => import('./ap/InvoiceList'))
const InvoiceDetail = lazy(() => import('./ap/InvoiceDetail'))
const ApPayments    = lazy(() => import('./ap/ApPayments'))
const ApLedger      = lazy(() => import('./ap/ApLedger'))
const SupplierAging = lazy(() => import('./ap/SupplierAging'))

const TAB_CLS = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-xs font-medium rounded transition-colors ${isActive ? 'bg-gray-800 t-text-1' : 't-text-4 hover:t-text-2'}`

function Loading() {
  return <div className="p-8 text-sm t-text-4 animate-pulse">Loading…</div>
}

export default function AP() {
  return (
    <div className="min-h-full t-bg-base flex flex-col">
      <div className="flex items-center gap-1 px-4 py-2 border-b t-border t-bg-surface shrink-0">
        <NavLink to="/ap"          end className={TAB_CLS}>Invoices</NavLink>
        <NavLink to="/ap/payments"     className={TAB_CLS}>Payments</NavLink>
        <NavLink to="/ap/ledger"       className={TAB_CLS}>AP Ledger</NavLink>
        <NavLink to="/ap/aging"        className={TAB_CLS}>Aging</NavLink>
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index                 element={<InvoiceList />} />
            <Route path="invoices/:id"   element={<InvoiceDetail />} />
            <Route path="payments"       element={<ApPayments />} />
            <Route path="ledger"         element={<ApLedger />} />
            <Route path="aging"          element={<SupplierAging />} />
            <Route path="*"              element={<Navigate to="/ap" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
