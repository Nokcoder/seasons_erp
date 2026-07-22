// receiptResolution.js
//
// Pure resolution logic for receipt printing — no React, no storage, no network,
// so it can be unit-tested in isolation. The hooks in useReceiptSettings.js wire
// these to the actual data sources (platformStore per-terminal override, the
// tenant-wide backend flag, and useAssignedTemplate).

import { DEFAULT_LINE_ITEM_CELLS, DEFAULT_LINE_ITEM_ROW } from './columnResolution';

// Per-terminal override states. 'inherit' defers to the tenant-wide setting;
// 'force-on'/'force-off' override it for this device only.
export const RECEIPT_OVERRIDE_STATES = ['inherit', 'force-on', 'force-off'];
export const DEFAULT_RECEIPT_OVERRIDE = 'inherit';

/**
 * Resolve whether a receipt should print for a checkout, given this terminal's
 * override and the tenant-wide flag. Terminal override wins; 'inherit' (or any
 * unrecognized value) falls back to the tenant-wide setting.
 *
 * NOTE: this governs default *checkout* printing only. SaleDetail's "Reprint
 * receipt" is a deliberate retrieval of history and must NOT consult this — it
 * stays available regardless of the toggle (locked Phase-2 scope decision).
 */
export function resolveShouldPrintReceipt(terminalOverride, tenantEnabled) {
  if (terminalOverride === 'force-on') return true;
  if (terminalOverride === 'force-off') return false;
  return !!tenantEnabled; // 'inherit'
}

/**
 * Resolve whether a completed sale should auto-print (skip the confirm-preview).
 * Same three-state logic as resolveShouldPrintReceipt, on the separate auto-print
 * axis. This only matters when printing is available at all (see decideReceiptAction).
 */
export function resolveShouldAutoPrint(terminalOverride, tenantAutoPrint) {
  if (terminalOverride === 'force-on') return true;
  if (terminalOverride === 'force-off') return false;
  return !!tenantAutoPrint; // 'inherit'
}

/**
 * The single decision the Workstation completion path makes, extracted so it is
 * unit-testable independent of the POST flow:
 *   - 'none'   : printing unavailable -> no print UI at all
 *   - 'auto'   : available + auto-print -> print directly, skip confirm-preview
 *   - 'button' : available, manual -> show a Print Receipt button (confirm-preview)
 * receipts_enabled (shouldPrint) gates everything; auto-print is a sub-axis.
 */
export function decideReceiptAction(shouldPrint, shouldAutoPrint) {
  if (!shouldPrint) return 'none';
  return shouldAutoPrint ? 'auto' : 'button';
}

// Minimal built-in fallback template, used when no template is assigned to the
// salesReceipt function (or the assigned one isn't present on this device), so
// printing never silently no-ops. Same shape as user-designed templates
// (id/name/docType/paper*/elements) so it flows through TemplateRenderer
// unchanged. Covers the header (company + document meta + customer), the
// repeating line-item row, and totals — nothing fancy.
export const DEFAULT_RECEIPT_TEMPLATE = {
  id: 'builtin-default-receipt',
  name: 'Default receipt',
  docType: 'receipt',
  paperPreset: 'A4',
  paperWidthMm: 210,
  paperHeightMm: 297,
  isBuiltinDefault: true,
  elements: [
    { id: 'def-companyInfo',   kind: 'block', blockType: 'companyInfo',  x: 10,  y: 10, width: 90, height: 20 },
    // Document number and date as SEPARATE positioned field cells (not a combined
    // documentMeta block) — on a pre-printed form these blanks sit in different
    // physical places, so each is independently movable/bindable.
    { id: 'def-docno', kind: 'field', binding: { source: 'receiptNo' }, x: 120, y: 10, width: 80, height: 6, align: 'left' },
    { id: 'def-date',  kind: 'field', binding: { source: 'date' }, dateFormat: 'raw', x: 120, y: 17, width: 80, height: 6, align: 'left' },
    { id: 'def-customerInfo',  kind: 'block', blockType: 'customerInfo', x: 10,  y: 35, width: 90, height: 20 },
    // Qty | Description(brand+description+sku+pid) | U/P | Amount — the BIR-style
    // reference layout, now as a positioned, repeating row instead of a table.
    {
      id: 'def-lineItemRow',
      kind: 'lineItemRow',
      x: DEFAULT_LINE_ITEM_ROW.x,
      y: DEFAULT_LINE_ITEM_ROW.y,
      width: DEFAULT_LINE_ITEM_ROW.width,
      repeatIntervalMm: DEFAULT_LINE_ITEM_ROW.repeatIntervalMm,
      maxRows: DEFAULT_LINE_ITEM_ROW.maxRows,
      cells: DEFAULT_LINE_ITEM_CELLS.map((c, i) => ({ ...c, id: `def-cell-${i}` })),
    },
    { id: 'def-totals',        kind: 'block', blockType: 'totals',       x: 120, y: 250, width: 80, height: 30 },
  ],
};

/**
 * Return the assigned template if present, else the built-in default so printing
 * never no-ops for lack of a configured template.
 */
export function resolveReceiptTemplate(assignedTemplate) {
  return assignedTemplate || DEFAULT_RECEIPT_TEMPLATE;
}
