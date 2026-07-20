// useFunctionAssignments.js
import { useState, useEffect, useCallback } from 'react';
import { getStore } from '../../lib/platformStore';

const STORE_FILE = 'print-settings.json';
const ASSIGNMENTS_KEY_PREFIX = 'templateAssignments';

export const KNOWN_FUNCTIONS = [
  { key: 'salesReceipt', label: 'Sales Receipt', docType: 'receipt' },
];

export function useFunctionAssignments(tenantId) {
  const storageKey = `${ASSIGNMENTS_KEY_PREFIX}:${tenantId}`;
  const [assignments, setAssignments] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore(STORE_FILE);
      const saved = await store.get(storageKey);
      if (!cancelled) {
        setAssignments(saved || {});
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  const assignTemplate = useCallback((functionKey, templateId) => {
    setAssignments((prev) => {
      const next = { ...prev, [functionKey]: templateId };
      (async () => {
        const store = await getStore(STORE_FILE);
        await store.set(storageKey, next);
        await store.save();
      })();
      return next;
    });
  }, [storageKey]);

  return { assignments, loaded, assignTemplate };
}
