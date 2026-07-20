// useTemplateLibrary.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { getStore } from '../../lib/platformStore';
import { v4 as uuidv4 } from 'uuid';

const STORE_FILE = 'print-settings.json';
const LIBRARY_KEY_PREFIX = 'templateLibrary';

export const PAPER_PRESETS_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

export function useTemplateLibrary(tenantId) {
  const storageKey = `${LIBRARY_KEY_PREFIX}:${tenantId}`;
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore(STORE_FILE);
      const saved = await store.get(storageKey);
      if (!cancelled) {
        setTemplates(saved || []);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  const flushNow = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const payload = pendingRef.current;
    if (!payload) return;
    pendingRef.current = null;
    const store = await getStore(STORE_FILE);
    await store.set(storageKey, payload);
    await store.save();
  }, [storageKey]);

  useEffect(() => {
    window.addEventListener('beforeunload', flushNow);
    return () => window.removeEventListener('beforeunload', flushNow);
  }, [flushNow]);

  const persist = useCallback((next) => {
    pendingRef.current = next;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(flushNow, 150);
  }, [flushNow]);

  const createTemplate = useCallback(({ name, docType, paperWidthMm = 210, paperHeightMm = 297, paperPreset = 'A4' }) => {
    const newTemplate = {
      id: uuidv4(), name, docType, paperPreset, paperWidthMm, paperHeightMm,
      elements: [], updatedAt: Date.now(),
    };
    setTemplates((prev) => {
      const next = [...prev, newTemplate];
      persist(next);
      return next;
    });
    return newTemplate.id;
  }, [persist]);

  const updateTemplate = useCallback((id, patch) => {
    setTemplates((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t));
      persist(next);
      return next;
    });
  }, [persist]);

  const duplicateTemplate = useCallback((id) => {
    let newId = null;
    setTemplates((prev) => {
      const source = prev.find((t) => t.id === id);
      if (!source) return prev;
      newId = uuidv4();
      const copy = { ...source, id: newId, name: `${source.name} (copy)`, updatedAt: Date.now() };
      const next = [...prev, copy];
      persist(next);
      return next;
    });
    return newId;
  }, [persist]);

  const deleteTemplate = useCallback((id) => {
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  return { templates, loaded, createTemplate, updateTemplate, duplicateTemplate, deleteTemplate };
}
