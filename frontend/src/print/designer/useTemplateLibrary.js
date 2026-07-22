// useTemplateLibrary.js
//
// Server-backed template library (settings.print_templates via /print/templates),
// so templates are shared across a tenant's terminals rather than device-local.
// Keeps the same interface the UI already uses ({ templates, loaded, create/
// update/duplicate/delete }) via optimistic local state + async API sync. A save
// that fails surfaces via `error` (the admin sees it) rather than silently
// appearing to succeed.

import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { printApi } from '../../services/api';
import { toClientTemplate, toServerBody } from './templateAdapter';

export const PAPER_PRESETS_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

const PATCH_DEBOUNCE_MS = 400;

export function useTemplateLibrary(tenantId) {
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // draftRef mirrors the latest template per id — the source of truth for
  // debounced saves, so rapid successive edits accumulate without stale reads.
  const draftRef = useRef({});
  const saveTimers = useRef({});

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    printApi.templates
      .list()
      .then((rows) => {
        if (cancelled) return;
        const clients = rows.map(toClientTemplate);
        draftRef.current = {};
        clients.forEach((t) => { draftRef.current[t.id] = t; });
        setTemplates(clients);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Couldn't load templates from the server: ${e.message}`);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [tenantId, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const createTemplate = useCallback((fields) => {
    const id = uuidv4();
    const t = {
      id,
      name: fields.name,
      docType: fields.docType,
      paperPreset: fields.paperPreset ?? 'A4',
      paperWidthMm: fields.paperWidthMm ?? 210,
      paperHeightMm: fields.paperHeightMm ?? 297,
      elements: [],
      updatedAt: new Date().toISOString(),
    };
    draftRef.current[id] = t;
    setTemplates((prev) => [...prev, t]); // optimistic
    printApi.templates
      .create({ ...toServerBody(t), template_id: id })
      .then((row) => {
        const saved = toClientTemplate(row);
        draftRef.current[id] = saved;
        setTemplates((prev) => prev.map((x) => (x.id === id ? saved : x)));
      })
      .catch((e) => {
        setError(`Couldn't save the new template: ${e.message}`);
        delete draftRef.current[id];
        setTemplates((prev) => prev.filter((x) => x.id !== id)); // roll back
      });
    return id;
  }, []);

  const updateTemplate = useCallback((id, patch) => {
    const base = draftRef.current[id];
    if (!base) return;
    const updated = { ...base, ...patch, updatedAt: new Date().toISOString() };
    draftRef.current[id] = updated; // accumulates synchronously across rapid edits
    setTemplates((prev) => prev.map((x) => (x.id === id ? updated : x))); // optimistic
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      const body = draftRef.current[id];
      if (!body) return;
      printApi.templates
        .patch(id, toServerBody(body))
        .catch((e) => setError(`Couldn't save template "${body.name}": ${e.message}`));
    }, PATCH_DEBOUNCE_MS);
  }, []);

  const duplicateTemplate = useCallback((id) => {
    const source = draftRef.current[id];
    if (!source) return null;
    const newId = uuidv4();
    const copy = { ...source, id: newId, name: `${source.name} (copy)`, updatedAt: new Date().toISOString() };
    draftRef.current[newId] = copy;
    setTemplates((prev) => [...prev, copy]); // optimistic
    printApi.templates
      .create({ ...toServerBody(copy), template_id: newId })
      .then((row) => {
        const saved = toClientTemplate(row);
        draftRef.current[newId] = saved;
        setTemplates((prev) => prev.map((x) => (x.id === newId ? saved : x)));
      })
      .catch((e) => {
        setError(`Couldn't duplicate the template: ${e.message}`);
        delete draftRef.current[newId];
        setTemplates((prev) => prev.filter((x) => x.id !== newId));
      });
    return newId;
  }, []);

  const deleteTemplate = useCallback((id) => {
    const removed = draftRef.current[id];
    delete draftRef.current[id];
    setTemplates((prev) => prev.filter((x) => x.id !== id)); // optimistic
    printApi.templates.remove(id).catch((e) => {
      setError(`Couldn't delete template "${removed?.name ?? ''}": ${e.message}`);
      if (removed) {
        draftRef.current[id] = removed;
        setTemplates((prev) => [...prev, removed]); // restore
      }
    });
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return { templates, loaded, error, clearError, reload, createTemplate, updateTemplate, duplicateTemplate, deleteTemplate };
}
