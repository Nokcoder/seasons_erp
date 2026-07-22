// receiptSources.js
//
// The data-source registry for the receipt / line-item-row composition system.
// This is the SINGLE SOURCE OF TRUTH for which fields exist in each scope — the
// cell binding editor, the resolver, and the adapter all read from here, so there
// are no hardcoded field lists scattered elsewhere.
//
// Scope is strictly the data already present in the Phase-1 receipt-data
// contract ({header, lineItems}). VAT breakdown, buyer TIN/address, and
// business-style fields are deliberately NOT here — they are deferred.

export const RECEIPT_HEADER_SOURCES = [
  { id: 'date',         label: 'Date' },
  { id: 'customerName', label: 'Customer name' },
  { id: 'grandTotal',   label: 'Grand total' },
  { id: 'subtotal',     label: 'Subtotal' },
  { id: 'tax',          label: 'Tax' },
  { id: 'receiptNo',    label: 'Receipt no.' },
  { id: 'salePid',      label: 'Sale PID' },
  { id: 'businessName', label: 'Business name' },
];

export const RECEIPT_LINE_ITEM_SOURCES = [
  { id: 'qty',         label: 'Qty' },
  { id: 'price',       label: 'Price' },
  { id: 'lineTotal',   label: 'Line total' },
  { id: 'brand',       label: 'Brand' },
  { id: 'description', label: 'Description' },
  { id: 'sku',         label: 'SKU' },
  { id: 'pid',         label: 'PID' },
];

// scope -> ordered source list
export const RECEIPT_SOURCES = {
  header: RECEIPT_HEADER_SOURCES,
  lineItem: RECEIPT_LINE_ITEM_SOURCES,
};

export function getSources(scope) {
  return RECEIPT_SOURCES[scope] || [];
}

export function isValidSource(scope, id) {
  return getSources(scope).some((s) => s.id === id);
}

export function getSourceLabel(scope, id) {
  const s = getSources(scope).find((x) => x.id === id);
  return s ? s.label : id;
}
