// useFunctionAssignments.js
//
// Server-backed function→template assignments (settings.print_function_assignments
// via /print/functions), shared across a tenant's terminals. Same interface the UI
// uses ({ assignments, loaded, assignTemplate }); optimistic + surfaced errors.

import { useState, useEffect, useCallback, useRef } from 'react';
import { printApi } from '../../services/api';

export const KNOWN_FUNCTIONS = [
  { key: 'salesReceipt', label: 'Sales Receipt', docType: 'receipt' },
];

export function useFunctionAssignments(tenantId) {
  const [assignments, setAssignments] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const mapRef = useRef({}); // latest committed assignments, for rollback

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    printApi.functions
      .list()
      .then((rows) => {
        if (cancelled) return;
        const m = {};
        rows.forEach((r) => { if (r.template_id) m[r.function_key] = r.template_id; });
        mapRef.current = m;
        setAssignments(m);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Couldn't load template assignments: ${e.message}`);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const assignTemplate = useCallback((functionKey, templateId) => {
    const prevVal = mapRef.current[functionKey];
    const next = { ...mapRef.current };
    if (templateId) next[functionKey] = templateId;
    else delete next[functionKey];
    mapRef.current = next;
    setAssignments(next); // optimistic
    printApi.functions.assign(functionKey, templateId || null).catch((e) => {
      setError(`Couldn't update the assignment: ${e.message}`);
      const rolled = { ...mapRef.current };
      if (prevVal) rolled[functionKey] = prevVal;
      else delete rolled[functionKey];
      mapRef.current = rolled;
      setAssignments(rolled); // roll back
    });
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return { assignments, loaded, error, clearError, assignTemplate };
}
