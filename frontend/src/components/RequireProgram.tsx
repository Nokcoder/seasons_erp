import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface Props {
  program: string | string[]
  children: ReactNode
}

export default function RequireProgram({ program, children }: Props) {
  const { user } = useAuth()
  const required = Array.isArray(program) ? program : [program]
  const hasAccess = required.some(p => user?.programs?.includes(p))
  if (!hasAccess) {
    return <Navigate to="/no-access" replace />
  }
  return <>{children}</>
}
