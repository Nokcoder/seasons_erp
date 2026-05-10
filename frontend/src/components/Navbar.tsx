import React from 'react';
import { Link, useLocation } from 'react-router-dom';

interface NavbarProps {
  user: any;
}

const Navbar: React.FC<NavbarProps> = ({ user }) => {
  const location = useLocation();

  const isActive = (path: string) => location.pathname.includes(path);

  // Grouping logic for clean UI
  const isProcurement = ['/suppliers', '/purchase-orders', '/shipments', '/receipts'].some(path => isActive(path));
  const isSales = ['/pos', '/sales-ledger'].some(path => isActive(path));

  return (
    <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-200 pb-4">
      
      {/* SALES GROUP */}
      <Link to="/pos" className={`px-4 py-2 rounded-md font-bold transition-colors ${
        isActive('/pos') ? 'bg-green-100 text-green-700 shadow-sm' : 'text-gray-600 hover:bg-gray-200'
      }`}>
        💳 Point of Sale
      </Link>

      <Link to="/sales-ledger" className={`px-4 py-2 rounded-md font-bold transition-colors ${
        isActive('/sales-ledger') ? 'bg-green-100 text-green-700 shadow-sm' : 'text-gray-600 hover:bg-gray-200'
      }`}>
        📊 Sales Ledger
      </Link>

      {/* INVENTORY GROUP */}
      <Link to="/products" className={`px-4 py-2 rounded-md font-medium transition-colors ${
        isActive('/products') ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200'
      }`}>
        📦 Inventory Master
      </Link>
      
      <Link to="/transfers" className={`px-4 py-2 rounded-md font-medium transition-colors ${
        isActive('/transfers') || isActive('/ledger') ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200'
      }`}>
        🚚 Internal Logistics
      </Link>

      <Link to="/locations" className={`px-4 py-2 rounded-md font-medium transition-colors ${
        isActive('/locations') ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200'
      }`}>
        📍 Locations
      </Link>
      
      {/* PROCUREMENT GROUP */}
      <Link to="/shipments" className={`px-4 py-2 rounded-md font-medium transition-colors ${
        isProcurement ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-200'
      }`}>
        🛒 Procurement
      </Link>

      {/* DYNAMIC SUB-NAV FOR PROCUREMENT */}
      {isProcurement && (
        <div className="w-full flex space-x-4 mt-4 text-sm border-l-4 border-purple-300 pl-4 py-1 animate-in fade-in slide-in-from-left-2">
          <Link to="/suppliers" className={`font-bold hover:text-purple-700 ${isActive('/suppliers') ? 'text-purple-700 underline' : 'text-gray-500'}`}>Suppliers</Link>
          <Link to="/purchase-orders" className={`font-bold hover:text-purple-700 ${isActive('/purchase-orders') ? 'text-purple-700 underline' : 'text-gray-500'}`}>Purchase Orders</Link>
          <Link to="/shipments" className={`font-bold hover:text-purple-700 ${isActive('/shipments') ? 'text-purple-700 underline' : 'text-gray-500'}`}>Inbound Shipments</Link>
          <Link to="/receipts" className={`font-bold hover:text-purple-700 ${isActive('/receipts') ? 'text-purple-700 underline' : 'text-gray-500'}`}>Goods Receipts</Link>
        </div>
      )}
    </div>
  );
};

export default Navbar;