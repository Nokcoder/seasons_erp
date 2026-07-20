// useAssignedTemplate.js
//
// The one hook an actual print trigger point needs: given a function key
// (e.g. 'salesReceipt'), resolves which template is currently assigned to
// it and returns it ready to hand to TemplateRenderer.
//
// Usage at the point where a sale completes:
//   const { template, loaded } = useAssignedTemplate(tenantId, 'salesReceipt');
//   ...
//   <TemplateRenderer template={template} data={saleData} />

import { useTemplateLibrary } from './useTemplateLibrary';
import { useFunctionAssignments } from './useFunctionAssignments';

export function useAssignedTemplate(tenantId, functionKey) {
  const { templates, loaded: templatesLoaded } = useTemplateLibrary(tenantId);
  const { assignments, loaded: assignmentsLoaded } = useFunctionAssignments(tenantId);

  const loaded = templatesLoaded && assignmentsLoaded;
  const templateId = assignments[functionKey];
  const template = loaded ? templates.find((t) => t.id === templateId) || null : null;

  return { template, loaded };
}
