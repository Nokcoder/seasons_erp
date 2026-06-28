import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { authApi } from '../services/api'

// ── types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  user_id: number
  username: string
  roles: string[]
  programs: string[]
  action_keys: string[]
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

// ── helpers ───────────────────────────────────────────────────────────────────

function decodePayload(token: string): Record<string, unknown> {
  const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(b64))
}

function isTokenAlive(token: string): boolean {
  try {
    const { exp } = decodePayload(token) as { exp?: number }
    return exp ? exp * 1000 > Date.now() : true
  } catch {
    return false
  }
}

function clearStorage() {
  localStorage.removeItem('erp_token')
  localStorage.removeItem('erp_user')
}

// ── context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const t = localStorage.getItem('erp_token')
    if (!t || !isTokenAlive(t)) { clearStorage(); return null }
    return t
  })

  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('erp_user')
    if (!raw) return null
    // Backwards-compat: records saved before `programs`/`action_keys` was added default to []
    const parsed = JSON.parse(raw) as Partial<AuthUser>
    return { programs: [], action_keys: [], ...parsed } as AuthUser
  })

  // Global 401 handler — fired by the api request wrapper
  useEffect(() => {
    const handle = () => {
      clearStorage()
      setToken(null)
      setUser(null)
    }
    window.addEventListener('auth:unauthorized', handle)
    return () => window.removeEventListener('auth:unauthorized', handle)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const data = await authApi.login(username, password)
    const payload = decodePayload(data.access_token)

    const roles: string[] = Array.isArray(payload.roles)
      ? (payload.roles as string[])
      : []

    // Store the token before calling /me/programs so the fetch can authenticate
    localStorage.setItem('erp_token', data.access_token)

    let programs: string[] = []
    let action_keys: string[] = []
    try {
      const result = await authApi.me.programs()
      programs    = result.program_keys
      action_keys = result.action_keys ?? []
    } catch {
      // Programs fetch failed — user can re-login to retry
    }

    const authUser: AuthUser = {
      user_id: payload.id as number,
      username: payload.sub as string,
      roles,
      programs,
      action_keys,
    }

    localStorage.setItem('erp_user', JSON.stringify(authUser))
    setToken(data.access_token)
    setUser(authUser)
  }, [])

  const logout = useCallback(() => {
    clearStorage()
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
