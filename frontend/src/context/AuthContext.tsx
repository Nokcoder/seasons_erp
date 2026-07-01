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
  is_cashiering_mode: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshPrograms: () => Promise<void>
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
    // Backwards-compat: records saved before these fields existed default to [] / false
    const parsed = JSON.parse(raw) as Partial<AuthUser>
    return { programs: [], action_keys: [], is_cashiering_mode: false, ...parsed } as AuthUser
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

  // Re-fetches program_keys/action_keys from the live DB state and updates
  // both localStorage and in-memory state. A 401 here is handled by the
  // global 'auth:unauthorized' listener above (dispatched by the api request
  // wrapper), so we only need to swallow the rejection — any other error
  // (network, 500) is also swallowed, leaving the cached values untouched.
  const refreshPrograms = useCallback(async () => {
    try {
      const result = await authApi.me.programs()
      setUser(prev => {
        if (!prev) return prev
        const updated: AuthUser = {
          ...prev,
          programs:           result.program_keys,
          action_keys:        result.action_keys ?? [],
          is_cashiering_mode: result.is_cashiering_mode ?? false,
        }
        localStorage.setItem('erp_user', JSON.stringify(updated))
        return updated
      })
    } catch {
      // 401 already handled globally; anything else fails silently.
    }
  }, [])

  // On app load, refresh permissions from the DB in the background — the
  // localStorage-derived state above renders immediately, this just brings
  // it up to date without blocking or showing a loading state.
  useEffect(() => {
    if (token) refreshPrograms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    let is_cashiering_mode = false
    try {
      const result = await authApi.me.programs()
      programs           = result.program_keys
      action_keys        = result.action_keys ?? []
      is_cashiering_mode = result.is_cashiering_mode ?? false
    } catch {
      // Programs fetch failed — user can re-login to retry
    }

    const authUser: AuthUser = {
      user_id: payload.id as number,
      username: payload.sub as string,
      roles,
      programs,
      action_keys,
      is_cashiering_mode,
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
    <AuthContext.Provider value={{ user, token, login, logout, refreshPrograms }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
