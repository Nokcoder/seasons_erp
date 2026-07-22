// sampleData.js
//
// Sample data for the designer's Preview & Test Print. `lineItems` are raw rows
// in the receipt-data line-item shape (qty/price/lineTotal/brand/description/
// sku/pid) so a lineItemRow's cell bindings resolve exactly as they will on a
// real sale.
export function getSampleData(docType) {
  return {
    logoUrl: null,
    companyName: 'Sample Company Ltd.',
    companyAddress: '123 Example Street, Sample City',
    customerName: 'Jane Doe',
    customerAddress: '456 Test Avenue, Testville',
    documentNumber: docType === 'receipt' ? 'R-0001' : 'INV-0001',
    documentDate: new Date().toLocaleDateString(),
    lineItems: [
      { qty: 2, price: '10.00', lineTotal: '20.00', brand: 'Acme',   description: 'Widget',  sku: 'WDG-01', pid: 'P-1001' },
      { qty: 1, price: '25.00', lineTotal: '25.00', brand: 'Globex', description: 'Gadget',  sku: 'GDG-07', pid: 'P-1002' },
      { qty: 3, price: '5.00',  lineTotal: '15.00', brand: 'Initech', description: 'Sprocket', sku: 'SPR-12', pid: 'P-1003' },
    ],
    subtotal: '60.00',
    tax: '4.80',
    total: '64.80',
    // Header values keyed by RECEIPT_HEADER_SOURCES ids, so header field cells
    // resolve the same way they will against a real sale's receipt-data header.
    header: {
      date: new Date().toISOString().slice(0, 10),
      customerName: 'Jane Doe',
      grandTotal: '64.80',
      subtotal: '60.00',
      tax: '4.80',
      receiptNo: docType === 'receipt' ? 'R-0001' : 'INV-0001',
      salePid: 'SALE-00001',
      businessName: 'Sample Company Ltd.',
    },
  };
}
