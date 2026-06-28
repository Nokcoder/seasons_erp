import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { useAuth } from '../context/AuthContext'

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
  const { user } = useAuth()
  const programs = user?.programs ?? []
  const hasList     = programs.includes('customers_list')
  const hasAging    = programs.includes('customers_aging')
  const hasARLedger = programs.includes('customers_ar_ledger')
  const hasMemo     = programs.includes('customers_credit_memo')
  const hasPDC      = programs.includes('customers_pdc_vault')

  const defaultTab = hasList ? '' : hasAging ? 'aging' : hasARLedger ? 'ledger' : hasMemo ? 'credit-memo' : 'pdc-vault'

  return (
    <div className="min-h-full t-bg-base flex flex-col">
      <div className="flex items-center gap-1 px-4 py-2 border-b t-border t-bg-surface shrink-0">
        {hasList     && <NavLink to="/customers"           end className={TAB_CLS}>Customers</NavLink>}
        {hasAging    && <NavLink to="/customers/aging"         className={TAB_CLS}>Aging Report</NavLink>}
        {hasARLedger && <NavLink to="/customers/ledger"        className={TAB_CLS}>AR Ledger</NavLink>}
        {hasMemo     && <NavLink to="/customers/credit-memo"   className={TAB_CLS}>Credit Memo</NavLink>}
        {hasPDC      && <NavLink to="/customers/pdc-vault"     className={TAB_CLS}>PDC Vault</NavLink>}
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<Loading />}>
          <Routes>
            {hasList ? (
              <>
                <Route index             element={<CustomerList />} />
                <Route path=":customerId" element={<CustomerDetail />} />
              </>
            ) : (
              <Route index element={<Navigate to={defaultTab} replace />} />
            )}
            {hasAging    && <Route path="aging"       element={<CustomerAging />} />}
            {hasARLedger && <Route path="ledger"      element={<CustomerARLedger />} />}
            {hasMemo     && <Route path="credit-memo" element={<CreditMemo />} />}
            {hasPDC      && <Route path="pdc-vault"   element={<PDCVault />} />}
            <Route path="*" element={<Navigate to={defaultTab || '.'} replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
