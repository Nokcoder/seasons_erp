import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../hooks/useTheme'
import { useAltRows } from '../hooks/useAltRows'

interface NavItem {
  label: string
  path: string
  programs: string[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Sales',       path: '/sales',       programs: ['sales_workstation', 'sales_ledger', 'sales_returns'] },
  { label: 'Inventory',   path: '/inventory',   programs: ['inventory_catalogue'] },
  { label: 'Stock',       path: '/stock',        programs: ['stock_transfers', 'stock_receiving', 'stock_ledger'] },
  { label: 'Procurement', path: '/procurement', programs: ['procurement_suppliers', 'procurement_purchase_orders'] },
  { label: 'AP',          path: '/ap',          programs: ['ap_invoices', 'ap_payments', 'ap_ledger', 'ap_aging'] },
  { label: 'Customers',   path: '/customers',   programs: ['customers_list', 'customers_aging', 'customers_ar_ledger', 'customers_credit_memo', 'customers_pdc_vault'] },
  { label: 'Settings',    path: '/settings',    programs: ['settings'] },
  { label: 'Admin',       path: '/admin/users', programs: ['settings'] },
]

export default function AppShell() {
  const { user, logout } = useAuth()
  useTheme()    // ensures theme is initialized and reactive
  useAltRows()  // ensures alternating-rows state is initialized and reactive

  const programs = user?.programs ?? []
  const visibleNav = NAV_ITEMS.filter(item =>
    item.programs.some(p => programs.includes(p))
  )

  return (
    <div className="min-h-screen t-bg-base flex flex-col">
      {/* ── top nav ── */}
      <nav className="t-nav-bg border-b t-nav-bd h-11 flex items-center px-4 gap-0.5 shrink-0 select-none">
        {/* Brand */}
        <span className="text-sm font-bold text-white tracking-tight mr-3">
          Season <span style={{ color: 'var(--accent)' }}>ERP</span>
        </span>

        <span className="t-text-4 mr-2 text-xs">|</span>

        {/* Nav links */}
        {visibleNav.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `px-3 py-1 rounded text-sm font-medium transition-colors ${
                isActive
                  ? 'text-white'
                  : 't-nav-tx hover:text-white'
              }`
            }
            style={({ isActive }) => isActive ? { backgroundColor: 'var(--accent)' } : undefined}
          >
            {item.label}
          </NavLink>
        ))}

        {/* Right side — user info */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs t-text-2">{user?.username}</span>
          {user?.roles.length ? (
            <span className="text-[10px] font-medium tracking-wide uppercase t-text-3 t-bg-elevated border t-border rounded px-1.5 py-0.5">
              {user.roles[0]}
            </span>
          ) : null}
          <button
            onClick={logout}
            className="text-xs t-text-3 hover:text-red-400 transition-colors ml-1 font-medium"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* ── page content ── */}
      <main className="flex-1 overflow-auto t-bg-base">
        <Outlet />
      </main>
    </div>
  )
}
