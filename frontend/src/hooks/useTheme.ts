import { useState, useCallback } from 'react'

export type Theme = 'dark' | 'light' | 'carbon'

const STORAGE_KEY = 'erp_theme'

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    const initial: Theme = stored ?? 'dark'
    applyTheme(initial)
    return initial
  })

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t)
    localStorage.setItem(STORAGE_KEY, t)
    setThemeState(t)
  }, [])

  return { theme, setTheme }
}
