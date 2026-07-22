// TemplateLibrary.jsx
//
// Top-level entry point for the template library: lists saved templates,
// lets you create new ones (by document type), and opens TemplateDesigner
// to edit a selected one. This is the screen users land on — designing a
// specific template is one level in.

import { useState } from 'react';
import { useTemplateLibrary, PAPER_PRESETS_MM } from './useTemplateLibrary';
import { TemplateDesigner } from './TemplateDesigner';
import { ImportLocalTemplates } from './ImportLocalTemplates';
import './designer.css';

const DOC_TYPES = [
  { key: 'receipt', label: 'Receipt' },
  { key: 'invoice', label: 'Invoice' },
];

export function TemplateLibrary({ tenantId }) {
  const { templates, loaded, error, clearError, reload, createTemplate, updateTemplate, duplicateTemplate, deleteTemplate } =
    useTemplateLibrary(tenantId);
  const [editingId, setEditingId] = useState(null);
  const [creatingDocType, setCreatingDocType] = useState('');

  // A save/load failure must be visible to the admin — never a silent success.
  // Rendered in both the library and the designer view (edits fail while editing).
  const banner = error ? (
    <div className="print-save-error" role="alert">
      <span>⚠ {error}</span>
      <button type="button" onClick={clearError} aria-label="Dismiss">×</button>
    </div>
  ) : null;

  if (!loaded) return <div className="designer-loading">Loading templates…</div>;

  const editingTemplate = templates.find((t) => t.id === editingId);

  if (editingTemplate) {
    return (
      <>
        {banner}
        <TemplateDesigner
          template={editingTemplate}
          onChange={(patch) => updateTemplate(editingTemplate.id, patch)}
          onClose={() => setEditingId(null)}
        />
      </>
    );
  }

  return (
    <>
    {banner}
    <div className="template-library">
      <div className="template-library__header">
        <h3>Print templates</h3>
        <div className="template-library__new">
          <select value={creatingDocType} onChange={(e) => setCreatingDocType(e.target.value)}>
            <option value="">Choose type…</option>
            {DOC_TYPES.map((dt) => (
              <option key={dt.key} value={dt.key}>
                {dt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="designer-palette__item designer-palette__item--accent template-library__new-btn"
            disabled={!creatingDocType}
            onClick={() => {
              const preset = PAPER_PRESETS_MM.A4;
              const label = DOC_TYPES.find((d) => d.key === creatingDocType)?.label;
              const id = createTemplate({
                name: `New ${label}`,
                docType: creatingDocType,
                paperWidthMm: preset.width,
                paperHeightMm: preset.height,
                paperPreset: 'A4',
              });
              setCreatingDocType('');
              setEditingId(id);
            }}
          >
            + New template
          </button>
        </div>
      </div>

      <ImportLocalTemplates tenantId={tenantId} onImported={reload} />

      {templates.length === 0 ? (
        <p className="template-library__empty">No templates yet — choose a type above and create one.</p>
      ) : (
        <table className="template-library__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Paper</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{DOC_TYPES.find((d) => d.key === t.docType)?.label || t.docType}</td>
                <td>{t.paperPreset === 'Custom' ? `${t.paperWidthMm}×${t.paperHeightMm}mm` : t.paperPreset}</td>
                <td>{new Date(t.updatedAt).toLocaleString()}</td>
                <td className="template-library__actions">
                  <button type="button" onClick={() => setEditingId(t.id)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => duplicateTemplate(t.id)}>
                    Duplicate
                  </button>
                  <button type="button" className="template-library__delete" onClick={() => deleteTemplate(t.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    </>
  );
}
