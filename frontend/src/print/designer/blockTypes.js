// blockTypes.js
//
// The fixed set of data blocks available to place on a template, plus their
// default starting size (mm) when added. Shared by BlockPalette and
// TemplateDesigner — kept separate from any specific persistence hook so it
// doesn't matter how templates are stored.

export const BLOCK_LABELS = {
  logo: 'Logo',
  companyInfo: 'Company info',
  customerInfo: 'Customer info',
  documentMeta: 'Document number / date',
  lineItemsTable: 'Line items table',
  totals: 'Totals',
};

export const AVAILABLE_BLOCKS = Object.keys(BLOCK_LABELS);

export const BLOCK_DEFAULTS = {
  logo: { width: 40, height: 20 },
  companyInfo: { width: 80, height: 25 },
  customerInfo: { width: 80, height: 25 },
  documentMeta: { width: 60, height: 20 },
  lineItemsTable: { width: 180, height: 60 },
  totals: { width: 70, height: 30 },
};
