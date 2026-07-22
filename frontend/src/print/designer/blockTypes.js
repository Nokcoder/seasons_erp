// blockTypes.js
//
// The fixed set of data blocks available to place on a template, plus their
// default starting size (mm) when added. Shared by BlockPalette and
// TemplateDesigner — kept separate from any specific persistence hook so it
// doesn't matter how templates are stored.

// Line items are no longer a "block" — they are a positioned, repeating row
// template (kind: 'lineItemRow') added via its own palette action, not from this
// fixed block set. See columnResolution.js / DesignerCanvas / TemplateRenderer.
export const BLOCK_LABELS = {
  logo: 'Logo',
  companyInfo: 'Company info',
  customerInfo: 'Customer info',
  documentMeta: 'Document number / date',
  totals: 'Totals',
};

export const AVAILABLE_BLOCKS = Object.keys(BLOCK_LABELS);

export const BLOCK_DEFAULTS = {
  logo: { width: 40, height: 20 },
  companyInfo: { width: 80, height: 25 },
  customerInfo: { width: 80, height: 25 },
  documentMeta: { width: 60, height: 20 },
  totals: { width: 70, height: 30 },
};

// Whole-box (uniform) text styling. TEXT_DEFAULTS is the single source of truth
// for the `?? ` fallbacks used at both render sites (DesignerCanvas preview and
// TemplateRenderer print output), so older saved templates that predate
// fontFamily/color still render consistently.
export const FONT_FAMILY_OPTIONS = [
  'Arial',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
];

export const TEXT_DEFAULTS = {
  fontSize: 10,
  align: 'left',
  fontFamily: 'Arial',
  color: '#000000',
};
