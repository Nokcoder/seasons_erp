import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { authApi } from '../services/api'
import * as authStore from '../lib/authStore'

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
  isAuthLoading: boolean
  login: (orgSlug: string, username: string, password: string) => Promise<void>
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

// ── context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  // Re-fetches program_keys/action_keys from the live DB state and updates
  // both authStore and in-memory state. A 401 here is handled by the
  // global 'auth:unauthorized' listener below (dispatched by the api request
  // wrapper), so we only need to swallow the rejection — any other error
  // (network, 500) is also swallowed, leaving the cached values untouched.
  const refreshPrograms = useCallback(async () => {
    try {
      const result = await authApi.me.programs()
      // setUser's functional form is used only to read the latest `prev`
      // synchronously and compute `updated` — no async work happens inside
      // the updater itself. The store write is sequenced separately below.
      let updated: AuthUser | null = null
      setUser(prev => {
        if (!prev) return prev
        updated = {
          ...prev,
          programs:           result.program_keys,
          action_keys:        result.action_keys ?? [],
          is_cashiering_mode: result.is_cashiering_mode ?? false,
        }
        return updated
      })
      if (updated) await authStore.setUser(updated)
    } catch {
      // 401 already handled globally; anything else fails silently.
    }
  }, [])

  // Loads the persisted session from authStore on mount. Reproduces the same
  // expiry check the old localStorage-backed useState initializer performed
  // synchronously — now done asynchronously, gating first render behind
  // isAuthLoading so consumers don't see a false "logged out" flash.
  useEffect(() => {
    (async () => {
      try {
        const t = await authStore.getToken()
        if (!t || !isTokenAlive(t)) {
          await authStore.clearAuth()
          return
        }
        const raw = await authStore.getUser()
        if (raw) {
          // Backwards-compat: records saved before these fields existed default to [] / false
          const parsed = raw as Partial<AuthUser>
          setUser({ programs: [], action_keys: [], is_cashiering_mode: false, ...parsed } as AuthUser)
        }
        setToken(t)
        // Mirrors the old mount-only "if (token) refreshPrograms()" effect,
        // which relied on token being populated synchronously before first
        // render. That's no longer true, so the trigger lives here instead.
        refreshPrograms()
      } finally {
        setIsAuthLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global 401 handler — fired by the api request wrapper
  useEffect(() => {
    const handle = async () => {
      await authStore.clearAuth()
      setToken(null)
      setUser(null)
    }
    window.addEventListener('auth:unauthorized', handle)
    return () => window.removeEventListener('auth:unauthorized', handle)
  }, [])

  const login = useCallback(async (orgSlug: string, username: string, password: string) => {
    const data = await authApi.login(orgSlug, username, password)
    const payload = decodePayload(data.access_token)

    const roles: string[] = Array.isArray(payload.roles)
      ? (payload.roles as string[])
      : []

    // Store the token before calling /me/programs so the fetch can authenticate
    await authStore.setToken(data.access_token)

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

    await authStore.setUser(authUser)
    setToken(data.access_token)
    setUser(authUser)
  }, [])

  const logout = useCallback(async () => {
    await authStore.clearAuth()
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, isAuthLoading, login, logout, refreshPrograms }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
