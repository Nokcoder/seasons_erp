import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import RequireProgram from './components/RequireProgram'

// Route-level code splitting — each module chunk loads on first visit
const Sales       = lazy(() => import('./pages/Sales'))
const Inventory   = lazy(() => import('./pages/Inventory'))
const Stock       = lazy(() => import('./pages/Stock'))
const Procurement = lazy(() => import('./pages/Procurement'))
const AP          = lazy(() => import('./pages/AP'))
const Customers   = lazy(() => import('./pages/Customers'))
const Settings    = lazy(() => import('./pages/Settings'))
const Admin       = lazy(() => import('./pages/Admin'))
const NoAccess    = lazy(() => import('./pages/NoAccess'))

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

              {/* Landing page for authenticated users with zero programs */}
              <Route path="/no-access" element={<NoAccess />} />

              <Route path="/sales/*" element={
                <RequireProgram program={['sales_workstation', 'sales_ledger', 'sales_returns']}>
                  <Sales />
                </RequireProgram>
              } />
              <Route path="/inventory/*" element={
                <RequireProgram program="inventory_catalogue">
                  <Inventory />
                </RequireProgram>
              } />
              <Route path="/stock/*" element={
                <RequireProgram program={['stock_transfers', 'stock_receiving', 'stock_ledger']}>
                  <Stock />
                </RequireProgram>
              } />
              <Route path="/procurement/*" element={
                <RequireProgram program={['procurement_suppliers', 'procurement_purchase_orders']}>
                  <Procurement />
                </RequireProgram>
              } />
              <Route path="/ap/*" element={
                <RequireProgram program={['ap_invoices', 'ap_payments', 'ap_ledger', 'ap_aging']}>
                  <AP />
                </RequireProgram>
              } />
              <Route path="/customers/*" element={
                <RequireProgram program={['customers_list', 'customers_aging', 'customers_ar_ledger', 'customers_credit_memo', 'customers_pdc_vault']}>
                  <Customers />
                </RequireProgram>
              } />
              <Route path="/settings/*"     element={<Settings />} />
              <Route path="/admin/*" element={
                <RequireProgram program="settings">
                  <Admin />
                </RequireProgram>
              } />

              {/* Catch-all inside shell → back to Sales */}
              <Route path="*" element={<Navigate to="/sales" replace />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
