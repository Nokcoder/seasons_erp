// sampleData.js
export function getSampleData(docType) {
  return {
    logoUrl: null,
    companyName: 'Sample Company Ltd.',
    companyAddress: '123 Example Street, Sample City',
    customerName: 'Jane Doe',
    customerAddress: '456 Test Avenue, Testville',
    documentNumber: docType === 'receipt' ? 'R-0001' : 'INV-0001',
    documentDate: new Date().toLocaleDateString(),
    columns: [
      { key: 'name', label: 'Item' },
      { key: 'qty', label: 'Qty' },
      { key: 'price', label: 'Price' },
    ],
    lineItems: [
      { id: '1', name: 'Sample Product A', qty: 2, price: '$10.00' },
      { id: '2', name: 'Sample Product B', qty: 1, price: '$25.00' },
      { id: '3', name: 'Sample Product C', qty: 3, price: '$5.00' },
    ],
    subtotal: '$60.00',
    tax: '$4.80',
    total: '$64.80',
  };
}
