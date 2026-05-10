import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function TopNavigation() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    return location.pathname.startsWith(path) 
      ? "bg-blue-800 text-white font-bold shadow-inner" 
      : "text-blue-100 hover:bg-blue-700 hover:text-white font-medium";
  };

  return (
    <nav className="bg-blue-900 shadow-md w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        {/* Changed from strict h-16 to a flexible py-3 gap layout */}
        <div className="flex flex-col md:flex-row md:justify-between py-3 gap-4">
          
          {/* LEFT SIDE: Logo and Links */}
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
            <div className="flex items-center">
              <span className="text-white font-black text-2xl tracking-wider">
                ERP<span className="text-blue-400">SYS</span>
              </span>
            </div>
            
            {/* THE BUTTONS - Guaranteed to be visible, wrapping naturally */}
            <div className="flex flex-wrap gap-2">
              <Link to="/pos" className={`px-3 py-2 rounded-md text-sm transition ${isActive('/pos')}`}>
                💳 POS
              </Link>
              <Link to="/products" className={`px-3 py-2 rounded-md text-sm transition ${isActive('/products')}`}>
                📦 Inventory
              </Link>
              <Link to="/transfers" className={`px-3 py-2 rounded-md text-sm transition ${isActive('/transfers')}`}>
                🚛 Logistics
              </Link>
              <Link to="/locations" className={`px-3 py-2 rounded-md text-sm transition ${isActive('/locations')}`}>
                📍 Warehouse
              </Link>
            </div>
          </div>

          {/* RIGHT SIDE: User & Logout */}
          <div className="flex items-center gap-4">
            {user && (
              <div className="text-sm text-blue-200">
                <span className="font-semibold text-white">{user.username}</span> 
                <span className="hidden sm:inline"> ({user.role.replace('_', ' ')})</span>
              </div>
            )}
            <button 
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded hover:bg-red-700 transition shadow-sm whitespace-nowrap"
            >
              Log Out
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
}