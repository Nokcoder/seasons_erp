// columnResolution.js
//
// Pure resolution of a line-item cell's binding against a single line-item row
// (from the receipt-data contract). No React / storage / network, so it is
// unit-testable in isolation.
//
// A binding is:
//   { source }                                  // single bound source
//   { composed: { sources:[], separator } }     // composed field
//
// `source`/`composed` are mutually exclusive; `composed` takes precedence if both
// are somehow present. This is the shape a lineItemRow cell's `binding` carries —
// the row-template pivot replaced the old positioned-table column config, but the
// per-value resolution logic is unchanged.

import { getSourceLabel } from './receiptSources';

// Resolve one binding's display value for one line-item row.
export function resolveBindingValue(binding, row) {
  if (binding && binding.composed) {
    const { sources = [], separator = ' ' } = binding.composed;
    return sources
      .map((id) => row[id])
      .filter((v) => v !== null && v !== undefined && v !== '')
      .join(separator);
  }
  const v = row[binding ? binding.source : undefined];
  return v === null || v === undefined ? '' : v;
}

// ── Date formatting for date-bound header fields ────────────────────────────
// The pre-printed "Date: ____" needs the value in a specific shape, not raw ISO.
export const DATE_FORMAT_OPTIONS = [
  { id: 'raw', label: 'As stored' },
  { id: 'mdy', label: 'MM/DD/YYYY' },
  { id: 'dmy', label: 'DD/MM/YYYY' },
  { id: 'longMdy', label: 'Month D, YYYY' },
  { id: 'medMdy', label: 'Mon D, YYYY' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse date-only strings (YYYY-MM-DD) as LOCAL midnight to avoid the UTC
// off-by-one; fall back to the Date constructor for anything else.
function parseDate(value) {
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Format a date value per a DATE_FORMAT_OPTIONS id. Unparseable/empty → raw value.
export function formatDate(value, format) {
  if (value == null || value === '') return '';
  if (!format || format === 'raw') return String(value);
  const d = parseDate(value);
  if (!d) return String(value);
  const day = d.getDate();
  const mon = d.getMonth();
  const yr = d.getFullYear();
  const p2 = (n) => String(n).padStart(2, '0');
  switch (format) {
    case 'mdy': return `${p2(mon + 1)}/${p2(day)}/${yr}`;
    case 'dmy': return `${p2(day)}/${p2(mon + 1)}/${yr}`;
    case 'longMdy': return `${MONTHS[mon]} ${day}, ${yr}`;
    case 'medMdy': return `${MONTHS_ABBR[mon]} ${day}, ${yr}`;
    default: return String(value);
  }
}

// Human-readable summary of a binding, for the designer (cell label + inspector).
export function describeBinding(binding, scope = 'lineItem') {
  if (binding && binding.composed) {
    const sources = binding.composed.sources || [];
    return sources.map((id) => getSourceLabel(scope, id)).join(' + ');
  }
  return binding && binding.source ? getSourceLabel(scope, binding.source) : '(unbound)';
}

// Built-in default cell set for the salesReceipt line-item row, matching the
// Philippine BIR-style Cash Sales Invoice reference:
//   Qty | Description (composed) | U/P | Amount
// Positions/widths (mm) are relative to the row's origin; total width 190mm.
// Cells are id-less here — callers assign stable/unique ids when instantiating.
export const DEFAULT_LINE_ITEM_CELLS = [
  { x: 0,   y: 0, width: 20,  height: 5, binding: { source: 'qty' }, align: 'right' },
  { x: 20,  y: 0, width: 110, height: 5, binding: { composed: { sources: ['brand', 'description', 'sku', 'pid'], separator: ' ' } }, align: 'left' },
  { x: 130, y: 0, width: 30,  height: 5, binding: { source: 'price' }, align: 'right' },
  { x: 160, y: 0, width: 30,  height: 5, binding: { source: 'lineTotal' }, align: 'right' },
];

// Default row-template geometry (mm). repeatIntervalMm is the vertical pitch
// between successive line items; maxRows null = uncapped (interim, pre-pagination).
// width matches the default cells' extent (they span 0..190mm) so a new band hugs
// its content instead of claiming the full paper width; it is user-resizable.
export const DEFAULT_LINE_ITEM_ROW = {
  x: 10,
  y: 60,
  width: 190,
  repeatIntervalMm: 6,
  maxRows: null,
};
