// ImportLocalTemplates.jsx
//
// One-time admin migration: upload templates + assignments that still live in the
// device-local platformStore (the pre-server-storage keys templateLibrary:{tenant}
// and templateAssignments:{tenant}) to the server.
//
// - Shows a preview of exactly what will upload before doing anything.
// - Preserves existing UUIDs (POST with template_id), so ids stay stable and
//   assignments keep resolving.
// - Idempotent on re-run: templates already on the server are skipped (matched by
//   id), and assignments are FILL-ONLY — applied only for functions the server has
//   not already assigned, so a re-run never clobbers server-side state.
// - On a fully clean import, clears the local keys so the button doesn't linger.

import { useState, useEffect } from 'react';
import { getStore } from '../../lib/platformStore';
import { printApi } from '../../services/api';
import { toServerBody } from './templateAdapter';
import { computeImportPreview } from './importPreview';

const STORE_FILE = 'print-settings.json';
const libKey = (t) => `templateLibrary:${t}`;
const assignKey = (t) => `templateAssignments:${t}`;

export function ImportLocalTemplates({ tenantId, onImported }) {
  const [local, setLocal] = useState(null);   // { templates, assignments }
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getStore(STORE_FILE);
        const templates = (await store.get(libKey(tenantId))) || [];
        const assignments = (await store.get(assignKey(tenantId))) || {};
        if (!cancelled) setLocal({ templates, assignments });
      } catch {
        if (!cancelled) setLocal({ templates: [], assignments: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function buildPreview() {
    setError('');
    try {
      const [serverRows, serverAssigns] = await Promise.all([
        printApi.templates.list(),
        printApi.functions.list(),
      ]);
      setPreview(computeImportPreview(local.templates, local.assignments, serverRows, serverAssigns));
    } catch (e) {
      setError(`Couldn't read the server's current templates: ${e.message}`);
    }
  }

  async function doImport() {
    setBusy(true);
    setError('');
    const res = { uploaded: 0, skipped: preview.alreadyThere.length, assigned: 0, errors: [] };
    for (const t of preview.toUpload) {
      try {
        await printApi.templates.create({ ...toServerBody(t), template_id: t.id });
        res.uploaded += 1;
      } catch (e) {
        res.errors.push(`Template "${t.name}": ${e.message}`);
      }
    }
    for (const a of preview.assignments) {
      try {
        await printApi.functions.assign(a.key, a.templateId);
        res.assigned += 1;
      } catch (e) {
        res.errors.push(`Assign ${a.key}: ${e.message}`);
      }
    }
    // Fully clean import → clear the local keys so this doesn't re-offer forever.
    if (res.errors.length === 0) {
      try {
        const store = await getStore(STORE_FILE);
        await store.delete(libKey(tenantId));
        await store.delete(assignKey(tenantId));
        await store.save();
        setLocal({ templates: [], assignments: {} });
      } catch { /* best-effort cleanup */ }
    }
    setResult(res);
    setBusy(false);
    if (onImported) onImported();
  }

  // Nothing local to import → render nothing.
  if (!local || local.templates.length === 0) return null;

  return (
    <div className="template-import">
      {error && <div className="print-save-error"><span>⚠ {error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

      {!preview && !result && (
        <button type="button" className="template-import__btn" onClick={buildPreview}>
          Import {local.templates.length} local template{local.templates.length !== 1 ? 's' : ''} to the server
        </button>
      )}

      {preview && !result && (
        <div className="template-import__panel">
          <h4>Import local templates to the server</h4>
          <p className="template-import__summary">
            {preview.toUpload.length} will upload
            {preview.alreadyThere.length > 0 ? `, ${preview.alreadyThere.length} already on the server (skipped)` : ''}.
          </p>
          {preview.toUpload.length > 0 && (
            <ul className="template-import__list">
              {preview.toUpload.map((t) => (
                <li key={t.id}>{t.name} <span className="template-import__muted">({t.docType})</span></li>
              ))}
            </ul>
          )}
          {preview.assignments.length > 0 && (
            <p className="template-import__summary">
              Assignments to apply (only where the server has none): {preview.assignments.map((a) => `${a.key} → ${a.name}`).join(', ')}.
            </p>
          )}
          <div className="template-import__actions">
            <button
              type="button"
              className="template-import__confirm"
              disabled={busy || (preview.toUpload.length === 0 && preview.assignments.length === 0)}
              onClick={doImport}
            >
              {busy ? 'Importing…' : 'Confirm import'}
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="template-import__panel">
          <p className="template-import__summary">
            Imported {result.uploaded} template{result.uploaded !== 1 ? 's' : ''}
            {result.skipped > 0 ? `, skipped ${result.skipped} already present` : ''}
            {result.assigned > 0 ? `, applied ${result.assigned} assignment${result.assigned !== 1 ? 's' : ''}` : ''}.
          </p>
          {result.errors.length > 0 && (
            <ul className="template-import__list template-import__errors">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <div className="template-import__actions">
            <button type="button" onClick={() => { setResult(null); setPreview(null); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
