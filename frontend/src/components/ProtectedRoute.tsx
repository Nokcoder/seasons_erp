import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute() {
  const { token, isAuthLoading } = useAuth()
  if (isAuthLoading) return null
  return token ? <Outlet /> : <Navigate to="/login" replace />
}
