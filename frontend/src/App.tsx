import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import Login from './pages/Login'

// Route-level code splitting — each module chunk loads on first visit
const Sales       = lazy(() => import('./pages/Sales'))
const Inventory   = lazy(() => import('./pages/Inventory'))
const Stock       = lazy(() => import('./pages/Stock'))
const Procurement = lazy(() => import('./pages/Procurement'))
const AP          = lazy(() => import('./pages/AP'))
const Customers   = lazy(() => import('./pages/Customers'))
const Settings    = lazy(() => import('./pages/Settings'))
const Admin       = lazy(() => import('./pages/Admin'))

function PageFallback() {
  return (
    <div className="p-8 text-sm text-gray-400 animate-pulse">Loading…</div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected — all pages require a valid token */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              {/* Root → redirect to Sales (first meaningful page) */}
              <Route index element={<Navigate to="/sales" replace />} />

              <Route path="/sales/*"        element={<Sales />} />
              <Route path="/inventory/*"    element={<Inventory />} />
              <Route path="/stock/*"        element={<Stock />} />
              <Route path="/procurement/*"  element={<Procurement />} />
              <Route path="/ap/*"           element={<AP />} />
              <Route path="/customers/*"    element={<Customers />} />
              <Route path="/settings/*"     element={<Settings />} />
              <Route path="/admin/*"        element={<Admin />} />

              {/* Catch-all inside shell → back to Sales */}
              <Route path="*" element={<Navigate to="/sales" replace />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
