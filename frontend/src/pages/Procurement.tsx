import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Suppliers           = lazy(() => import('./procurement/Suppliers'))
const PurchaseOrders      = lazy(() => import('./procurement/PurchaseOrders'))
const PurchaseOrderDetail = lazy(() => import('./procurement/PurchaseOrderDetail'))

const TAB_CLS = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-xs font-medium rounded transition-colors ${isActive ? 't-bg-elevated t-text-1' : 't-text-4 hover:t-text-2'}`

export default function Procurement() {
  const { user } = useAuth()
  const programs = user?.programs ?? []
  const hasSuppliers = programs.includes('procurement_suppliers')
  const hasPOs       = programs.includes('procurement_purchase_orders')

  const defaultTab = hasSuppliers ? 'suppliers' : 'purchase-orders'

  return (
    <div className="min-h-full t-bg-base flex flex-col">
      <div className="flex items-center gap-1 px-4 py-2 border-b t-border t-bg-surface shrink-0">
        {hasSuppliers && <NavLink to="/procurement/suppliers"       className={TAB_CLS}>Suppliers</NavLink>}
        {hasPOs       && <NavLink to="/procurement/purchase-orders" className={TAB_CLS}>Purchase Orders</NavLink>}
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<div className="p-8 text-sm t-text-4 animate-pulse">Loading…</div>}>
          <Routes>
            <Route index element={<Navigate to={defaultTab} replace />} />
            {hasSuppliers && <Route path="suppliers" element={<Suppliers />} />}
            {hasPOs && (
              <>
                <Route path="purchase-orders"          element={<PurchaseOrders />} />
                <Route path="purchase-orders/:po_id"   element={<PurchaseOrderDetail />} />
              </>
            )}
            <Route path="*" element={<Navigate to={defaultTab} replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
