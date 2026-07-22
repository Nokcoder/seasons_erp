// importPreview.js
//
// Pure decision logic for the local-templates import (no imports, so unit-testable
// in isolation). Idempotent + non-clobbering:
//   toUpload      = local templates whose id is NOT already on the server
//   alreadyThere  = local templates already on the server (skipped)
//   assignments   = local assignments whose target will exist AND whose function
//                   the server has NOT already assigned (fill-only — a re-run
//                   never overwrites a server-set assignment)

export function computeImportPreview(localTemplates, localAssignments, serverRows, serverAssigns) {
  const serverIds = new Set((serverRows || []).map((r) => r.template_id));
  const assignedKeys = new Set((serverAssigns || []).filter((a) => a.template_id).map((a) => a.function_key));
  const toUpload = localTemplates.filter((t) => !serverIds.has(t.id));
  const alreadyThere = localTemplates.filter((t) => serverIds.has(t.id));
  const willExist = new Set([...serverIds, ...toUpload.map((t) => t.id)]);
  const assignments = Object.entries(localAssignments || {})
    .filter(([key, tid]) => tid && willExist.has(tid) && !assignedKeys.has(key))
    .map(([key, tid]) => ({ key, templateId: tid, name: (localTemplates.find((t) => t.id === tid) || {}).name || tid }));
  return { toUpload, alreadyThere, assignments };
}
