import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'

const Catalogue  = lazy(() => import('./inventory/Catalogue'))
const Detail     = lazy(() => import('./inventory/Detail'))
const NewProduct = lazy(() => import('./inventory/NewProduct'))

function Loading() {
  return <div className="p-8 text-sm text-gray-500 animate-pulse">Loading…</div>
}

function RequireManageProducts({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user?.programs.includes('manage_products')) {
    return <Navigate to="/inventory" replace />
  }
  return <>{children}</>
}

export default function Inventory() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route index       element={<Catalogue />} />
        <Route path="new"  element={<NewProduct />} />
        {/* :variantId must come after static routes */}
        <Route path=":variantId" element={
          <RequireManageProducts>
            <Detail />
          </RequireManageProducts>
        } />
        <Route path="*"    element={<Navigate to="/inventory" replace />} />
      </Routes>
    </Suspense>
  )
}
