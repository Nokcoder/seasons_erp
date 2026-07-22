// FunctionAssignmentPanel.jsx
//
// The "program where they work" screen: for each known function (right now
// just Sales Receipt), pick which saved template — filtered to matching
// document types — is currently active for it.

import { useTemplateLibrary } from './useTemplateLibrary';
import { useFunctionAssignments, KNOWN_FUNCTIONS } from './useFunctionAssignments';
import './designer.css';

export function FunctionAssignmentPanel({ tenantId }) {
  const { templates, loaded: templatesLoaded } = useTemplateLibrary(tenantId);
  const { assignments, loaded: assignmentsLoaded, assignTemplate, error, clearError } = useFunctionAssignments(tenantId);

  if (!templatesLoaded || !assignmentsLoaded) return <div className="designer-loading">Loading…</div>;

  return (
    <div className="function-assignment-panel">
      <h3>Where templates are used</h3>
      {error && (
        <div className="print-save-error" role="alert">
          <span>⚠ {error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss">×</button>
        </div>
      )}
      {KNOWN_FUNCTIONS.map((fn) => {
        const matching = templates.filter((t) => t.docType === fn.docType);
        return (
          <div key={fn.key} className="function-assignment-panel__row">
            <span className="function-assignment-panel__label">{fn.label}</span>
            <select
              value={assignments[fn.key] || ''}
              onChange={(e) => assignTemplate(fn.key, e.target.value || null)}
            >
              <option value="">Not assigned</option>
              {matching.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {matching.length === 0 && (
              <span className="function-assignment-panel__hint">
                No {fn.docType} templates yet — create one in the library first.
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
