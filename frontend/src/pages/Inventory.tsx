import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'

const Catalogue  = lazy(() => import('./inventory/Catalogue'))
const Detail     = lazy(() => import('./inventory/Detail'))
const NewProduct = lazy(() => import('./inventory/NewProduct'))

function Loading() {
  return <div className="p-8 text-sm text-gray-500 animate-pulse">Loading…</div>
}

export default function Inventory() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route index       element={<Catalogue />} />
        <Route path="new"  element={<NewProduct />} />
        {/* :variantId must come after static routes */}
        <Route path=":variantId" element={<Detail />} />
        <Route path="*"    element={<Navigate to="/inventory" replace />} />
      </Routes>
    </Suspense>
  )
}
