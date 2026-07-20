import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { token, isAuthLoading, login } = useAuth()
  const navigate = useNavigate()

  // Org slug is not a secret and is the same on every login for a given user,
  // so we remember it across sessions to save re-typing. It's cleared only when
  // the user overwrites it, never on logout.
  const [orgSlug, setOrgSlug]   = useState(() => localStorage.getItem('erp_org_slug') ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  if (isAuthLoading) return null
  if (token) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(orgSlug.trim(), username, password)
      localStorage.setItem('erp_org_slug', orgSlug.trim())
      navigate('/', { replace: true })
    } catch (err) {
      // A bad org, bad username, and bad password all return the same 401 by
      // design (so slug existence isn't leaked) — surface one generic message
      // rather than the api wrapper's "session expired" string. A genuine
      // backend message (e.g. a deactivated account) still passes through.
      const msg = err instanceof Error ? err.message : ''
      setError(
        !msg || msg.includes('Session expired')
          ? 'Invalid organization, username, or password.'
          : msg,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-800 rounded-lg shadow-xl px-8 py-10 w-full max-w-sm">

        {/* Brand */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Season <span className="text-blue-400">ERP</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 tracking-wide">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-gray-500 mb-1.5">
              Organization
            </label>
            <input
              type="text"
              value={orgSlug}
              onChange={e => setOrgSlug(e.target.value)}
              autoFocus={!orgSlug}
              required
              autoComplete="organization"
              placeholder="your-company"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100
                         placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500
                         transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-gray-500 mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus={!!orgSlug}
              required
              autoComplete="username"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100
                         placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500
                         transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-gray-500 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100
                         placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500
                         transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white rounded py-2 text-sm font-medium transition-colors mt-2"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
