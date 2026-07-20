// Temporary test-only route for the print layout designer (frontend/src/print/designer/).
// Mounted at /dev/print-designer — remove once the designer is wired into a real
// settings screen. Not linked from any nav; reached only by typing the URL.
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { TemplateLibrary } from '../../print/designer/TemplateLibrary'
import { FunctionAssignmentPanel } from '../../print/designer/FunctionAssignmentPanel'

function decodeTenantId(token: string): string {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as { tenant_id?: number }
    return payload.tenant_id != null ? String(payload.tenant_id) : 'unknown-tenant'
  } catch {
    return 'unknown-tenant'
  }
}

export default function PrintDesignerDev() {
  const { token } = useAuth()
  const tenantId = token ? decodeTenantId(token) : 'unknown-tenant'
  const [view, setView] = useState<'library' | 'assignments'>('library')

  return (
    <div style={{ height: '100vh' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={() => setView('library')}>Library</button>
        <button onClick={() => setView('assignments')}>Assignments</button>
      </div>
      {view === 'library'
        ? <TemplateLibrary tenantId={tenantId} />
        : <FunctionAssignmentPanel tenantId={tenantId} />}
    </div>
  )
}
