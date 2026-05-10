// frontend/src/App.tsx
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';

// 1. EAGER IMPORTS (Only load things needed immediately on boot)
import Login from './components/Login';

// 2. LAZY IMPORTS (Downloaded on-demand when the user navigates to them)
// Inventory
const ProductTable = lazy(() => import('./components/ProductTable'));
const ProductDetail = lazy(() => import('./components/ProductDetail'));
const ItemLedger = lazy(() => import('./components/ItemLedger'));
const LocationManager = lazy(() => import('./components/LocationManager'));

// Logistics
const TransferList = lazy(() => import('./components/TransferList'));
const TransferForm = lazy(() => import('./components/TransferForm'));
const TransferReport = lazy(() => import('./components/TransferReport'));

// Procurement
const SupplierMaster = lazy(() => import('./components/SupplierMaster'));
const PurchaseOrders = lazy(() => import('./components/PurchaseOrders'));
const InboundShipments = lazy(() => import('./components/InboundShipments'));
const GoodsReceipts = lazy(() => import('./components/GoodsReceipts'));

// Sales
const POS = lazy(() => import('./pages/POS'));
const SalesLedger = lazy(() => import('./pages/SalesLedger'));

// 3. THE BOUNCER (Authentication Guard)
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

// 4. THE LOADING FALLBACK (Shown while a lazy component downloads)
const PageLoader = () => (
  <div className="flex items-center justify-center h-[60vh]">
    <div className="text-gray-400 font-bold text-lg animate-pulse">
      Loading Module...
    </div>
  </div>
);

// 5. THE MAIN LAYOUT
const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        
        {/* GLOBAL HEADER */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">ERP Master Dashboard</h1>
            <p className="text-sm text-gray-500 font-medium">Enterprise Resource Planning v1.0</p>
          </div>
          
          <div className="flex items-center gap-4 mb-1">
            <div className="text-right">
              <span className="block text-xs font-bold text-gray-400 uppercase">Current User</span>
              <strong className="text-blue-700">{user?.username}</strong>
            </div>
            <button 
              onClick={logout} 
              className="text-xs bg-red-50 text-red-600 border border-red-100 px-3 py-2 rounded-md font-bold hover:bg-red-600 hover:text-white transition-all shadow-sm"
            >
              Logout
            </button>
          </div>
        </div>

        {/* NAVIGATION */}
        <Navbar user={user} />

        {/* MAIN CONTENT AREA WITH SUSPENSE */}
        <main className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 min-h-[500px]">
          <Suspense fallback={<PageLoader />}>
            {children}
          </Suspense>
        </main>

      </div>
    </div>
  );
};

// 6. THE APP ROOT
export default function App() {
  return (
    <AuthProvider>
      {/* BrowserRouter should wrap the entire app, usually handled in main.tsx/index.tsx, but kept here if it's your root */}

        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Protected Application Routes */}
          <Route path="/*" element={
            <ProtectedRoute>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<Navigate to="/pos" />} />
                  
                  {/* Inventory */}
                  <Route path="/products" element={<ProductTable />} />
                  <Route path="/products/new" element={<ProductDetail />} />
                  <Route path="/products/:id" element={<ProductDetail />} />
                  <Route path="/ledger/:productId/:locationId" element={<ItemLedger />} />
                  <Route path="/locations" element={<LocationManager />} />
                  
                  {/* Logistics */}
                  <Route path="/transfers" element={<TransferList />} />
                  <Route path="/transfers/new" element={<TransferForm />} />
                  <Route path="/transfers/:id" element={<TransferReport />} />

                  {/* Procurement */}
                  <Route path="/suppliers" element={<SupplierMaster />} />
                  <Route path="/purchase-orders" element={<PurchaseOrders />} />
                  <Route path="/shipments" element={<InboundShipments />} />
                  <Route path="/receipts" element={<GoodsReceipts />} />

                  {/* Sales */}
                  <Route path="/pos" element={<POS />} />
                  <Route path="/sales-ledger" element={<SalesLedger />} />

                  {/* 404 Fallback */}
                  <Route path="*" element={
                    <div className="flex flex-col items-center justify-center h-[50vh] text-center">
                      <h2 className="text-4xl font-black text-gray-300 mb-2">404</h2>
                      <p className="text-gray-500 font-bold">Module Not Found</p>
                    </div>
                  } />
                </Routes>
              </MainLayout>
            </ProtectedRoute>
          } />
        </Routes>

    </AuthProvider>
  );
}