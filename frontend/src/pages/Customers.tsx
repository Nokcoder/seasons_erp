import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { lazy, Suspense } from 'react'

const CustomerList     = lazy(() => import('./customers/CustomerList'))
const CustomerDetail   = lazy(() => import('./customers/CustomerDetail'))
const CustomerAging    = lazy(() => import('./customers/CustomerAging'))
const CustomerARLedger = lazy(() => import('./customers/CustomerARLedger'))
const CreditMemo       = lazy(() => import('./customers/CreditMemo'))
const PDCVault         = lazy(() => import('./customers/PDCVault'))

const TAB_CLS = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-xs font-medium rounded transition-colors ${isActive ? 'bg-gray-800 t-text-1' : 't-text-4 hover:t-text-2'}`

function Loading() {
  return <div className="p-8 text-sm t-text-4 animate-pulse">Loading…</div>
}

export default function Customers() {
  return (
    <div className="min-h-full t-bg-base flex flex-col">
      <div className="flex items-center gap-1 px-4 py-2 border-b t-border t-bg-surface shrink-0">
        <NavLink to="/customers"             end className={TAB_CLS}>Customers</NavLink>
        <NavLink to="/customers/aging"         className={TAB_CLS}>Aging Report</NavLink>
        <NavLink to="/customers/ledger"        className={TAB_CLS}>AR Ledger</NavLink>
        <NavLink to="/customers/credit-memo"   className={TAB_CLS}>Credit Memo</NavLink>
        <NavLink to="/customers/pdc-vault"     className={TAB_CLS}>PDC Vault</NavLink>
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index                      element={<CustomerList />} />
            <Route path="aging"               element={<CustomerAging />} />
            <Route path="ledger"              element={<CustomerARLedger />} />
            <Route path="credit-memo"         element={<CreditMemo />} />
            <Route path="pdc-vault"           element={<PDCVault />} />
            <Route path=":customerId"         element={<CustomerDetail />} />
            <Route path="*"                   element={<Navigate to="/customers" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
