// useAssignedTemplate.js
//
// The one hook a print trigger point (checkout) needs: given a function key
// (e.g. 'salesReceipt'), resolves the currently assigned template from the SERVER
// and returns it ready for TemplateRenderer.
//
// Fallback chain (checkout printing must survive a network blip):
//   server → local cache → built-in default
// - Server resolve returns { assigned, template }. assigned=true → use it AND
//   write it to a per-tenant+function read-through cache. assigned=false is a
//   normal answer meaning "unassigned or soft-deleted" → return null so the
//   caller falls through to the built-in default (NOT the cache).
// - Only when the server is unreachable do we read the cache; if the cache is
//   empty too, null → built-in default.
//
// The cache lives in the same device-local print-settings.json store as the
// per-terminal overrides — it is a fallback cache, never the source of truth.

import { useState, useEffect } from 'react';
import { getStore } from '../../lib/platformStore';
import { printApi } from '../../services/api';
import { toClientTemplate } from './templateAdapter';

const STORE_FILE = 'print-settings.json';
const cacheKey = (tenantId, functionKey) => `templateCache:${tenantId}:${functionKey}`;

export function useAssignedTemplate(tenantId, functionKey) {
  const [template, setTemplate] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const res = await printApi.functions.resolve(functionKey);
        if (cancelled) return;
        if (res.assigned && res.template) {
          const t = toClientTemplate(res.template);
          setTemplate(t);
          setLoaded(true);
          // Read-through cache: keep the last resolved template for offline use.
          try {
            const store = await getStore(STORE_FILE);
            await store.set(cacheKey(tenantId, functionKey), t);
            await store.save();
          } catch { /* cache write is best-effort */ }
        } else {
          // assigned=false → intentionally unassigned/soft-deleted → built-in.
          setTemplate(null);
          setLoaded(true);
        }
      } catch {
        // Server unreachable → fall back to the cached template, then built-in.
        if (cancelled) return;
        let cached = null;
        try {
          const store = await getStore(STORE_FILE);
          cached = await store.get(cacheKey(tenantId, functionKey));
        } catch { /* ignore */ }
        setTemplate(cached || null);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, functionKey]);

  return { template, loaded };
}
