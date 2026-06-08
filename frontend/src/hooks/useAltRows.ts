import { useState, useCallback } from 'react'

const STORAGE_KEY = 'erp_alt_rows'

function applyAltRows(v: boolean) {
  document.documentElement.setAttribute('data-alt-rows', v ? 'true' : 'false')
}

export function useAltRows() {
  const [altRows, setAltRowsState] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === 'true'
    applyAltRows(stored)
    return stored
  })

  const setAltRows = useCallback((v: boolean) => {
    applyAltRows(v)
    localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false')
    setAltRowsState(v)
  }, [])

  return { altRows, setAltRows }
}
