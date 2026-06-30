import { useAuth } from '../context/AuthContext'

export default function NoAccess() {
  const { logout } = useAuth()
  return (
    <div className="min-h-full t-bg-base flex flex-col items-center justify-center gap-3">
      <p className="text-sm font-medium t-text-1">Your account has no assigned permissions.</p>
      <p className="text-xs t-text-3">Contact your administrator to request access.</p>
      <button
        onClick={logout}
        className="mt-2 px-4 py-1.5 text-xs rounded border t-border t-text-2 hover:t-border-strong transition-colors"
      >
        Log out
      </button>
    </div>
  )
}
