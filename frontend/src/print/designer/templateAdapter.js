// templateAdapter.js
//
// Maps between the server row shape (settings.print_templates: template_id, name,
// doc_type, template JSONB blob, updated_at) and the flat client template shape
// the designer + renderer use ({ id, name, docType, paperPreset, paperWidthMm,
// paperHeightMm, elements, calibrationOffsetXMm?, …, updatedAt }).
//
// The design blob (paper size, elements, per-template calibration) lives in the
// `template` JSONB column; name/doc_type/id/updated_at are authoritative columns.

export function toClientTemplate(row) {
  return {
    ...(row.template || {}),        // paperPreset, dims, elements, calibrationOffset*, …
    id: row.template_id,
    name: row.name,
    docType: row.doc_type,
    updatedAt: row.updated_at,
  };
}

export function toServerBody(t) {
  // Strip the column fields; everything else is the design blob (including the
  // per-template calibrationOffsetXMm/YMm, which rides along to the server).
  const { id, name, docType, updatedAt, ...design } = t;
  return { name, doc_type: docType, template: design };
}
