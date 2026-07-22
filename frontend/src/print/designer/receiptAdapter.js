// receiptAdapter.js
//
// Pure adapter: turns the Phase-1 receipt-data contract ({header, lineItems})
// into the `data` shape TemplateRenderer consumes. Line items are passed through
// as raw rows — the lineItemRow template resolves each cell's binding against a
// row at render time (via resolveBindingValue), so there is no column
// pre-resolution step here anymore (that was the old positioned-table path).
//
// Scope: only fields already in receipt-data. companyAddress / customerAddress /
// logoUrl are intentionally blank here (deferred — buyer TIN/address, business
// style, VAT breakdown are not part of this phase).

export function receiptDataToTemplateData(receiptData) {
  const header = (receiptData && receiptData.header) || {};
  const lineItems = (receiptData && receiptData.lineItems) || [];

  return {
    logoUrl: null,
    companyName: header.businessName ?? '',
    companyAddress: '',                                  // deferred
    customerName: header.customerName ?? '',
    customerAddress: '',                                 // deferred
    documentNumber: header.receiptNo ?? header.salePid ?? '',
    documentDate: header.date ?? '',
    lineItems,                                           // raw rows; cells resolve per-row
    subtotal: header.subtotal ?? '',
    tax: header.tax ?? '',
    total: header.grandTotal ?? '',
    // Raw header (keyed by RECEIPT_HEADER_SOURCES ids) for header field cells to
    // resolve against — a pass-through, no reshaping.
    header,
  };
}
