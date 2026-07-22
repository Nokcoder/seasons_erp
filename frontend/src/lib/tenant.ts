// tenant.ts
//
// Single source of truth for deriving the tenant id used to key device-local
// print storage (templates, assignments, per-terminal overrides). This MUST
// match the derivation used when configuring templates in Settings, or a
// terminal would resolve a different tenant's (or no) template/settings.

import { useAuth } from '../context/AuthContext'

export function decodeTenantId(token: string | null | undefined): string {
  if (!token) return 'unknown-tenant'
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as { tenant_id?: number }
    return payload.tenant_id != null ? String(payload.tenant_id) : 'unknown-tenant'
  } catch {
    return 'unknown-tenant'
  }
}

export function useTenantId(): string {
  const { token } = useAuth()
  return decodeTenantId(token)
}
