import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { queryClient } from './lib/queryClient'

// ui_standards §10 — select-on-focus for all numeric inputs (global rule)
document.addEventListener('focusin', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number') {
    e.target.select()
  }
})

// Apply stored theme + alternating rows before first paint
const storedTheme   = localStorage.getItem('erp_theme') ?? 'dark'
const storedAltRows = localStorage.getItem('erp_alt_rows') === 'true'
document.documentElement.setAttribute('data-theme',    storedTheme)
document.documentElement.setAttribute('data-alt-rows', String(storedAltRows))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
