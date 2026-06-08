import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'

interface CanProps {
  /** Roles that are allowed to see the children. */
  roles: string[]
  children: ReactNode
  /** Rendered when the user does not have an allowed role. Defaults to nothing. */
  fallback?: ReactNode
}

/**
 * Renders `children` only if the authenticated user holds at least one of the
 * specified `roles`. Use `fallback` to render alternative content.
 *
 * Example:
 *   <Can roles={['ADMIN', 'STORE_MANAGER']}>
 *     <button>Void sale</button>
 *   </Can>
 */
export default function Can({ roles, children, fallback = null }: CanProps) {
  const { user } = useAuth()
  if (!user) return <>{fallback}</>
  return <>{user.roles.some(r => roles.includes(r)) ? children : fallback}</>
}
