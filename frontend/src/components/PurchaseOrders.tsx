// frontend/src/components/PurchaseOrders.tsx
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { fetchPurchaseOrders, createPurchaseOrder, fetchSuppliers, fetchProducts } from '../services/api';
import type { PurchaseOrder, Supplier, Product } from '../services/api';

interface POLineItem {
  product_id?: number;
  pid: string;
  name: string;
  sku: string;
  brand: string;
  bundling: string;
  qty: number;
  cost: number;
  discount: number;
}

export default function PurchaseOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [viewPO, setViewPO] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State (Creation)
  const [supplierId, setSupplierId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lineItems, setLineItems] = useState<POLineItem[]>([]);

  const loadData = () => {
    setLoading(true);
    Promise.all([fetchPurchaseOrders(), fetchSuppliers(), fetchProducts()]).then(
      ([poData, supData, prdData]) => {
        setOrders(poData);
        setSuppliers(supData.filter(s => s.is_active));
        setProducts(prdData);
        setLoading(false);
      }
    ).catch(console.error);
  };

  useEffect(() => { loadData(); }, []);

  // --- SEARCH & EXCEL LOGIC (Unchanged from your working version) ---
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const lowerQuery = searchQuery.toLowerCase().replace(/[\s-]/g, '');
    return products.filter(p => {
      const searchable = `${p.pid} ${p.sku} ${p.brand} ${p.name}`.toLowerCase().replace(/[\s-]/g, '');
      return searchable.includes(lowerQuery);
    }).slice(0, 5);
  }, [searchQuery, products]);

  const addProductToTally = (product: Product) => {
    if (lineItems.find(item => item.product_id === product.product_id || item.pid === product.pid)) {
      setSearchQuery(''); return; 
    }
    setLineItems([...lineItems, { 
      product_id: product.product_id, pid: product.pid, name: product.name, sku: product.sku || '', brand: product.brand || '',
      bundling: product.units_per_bundle ? String(product.units_per_bundle) : '',
      qty: 1, cost: product.gross_cost ? Number(product.gross_cost) : 0, discount: product.cost_discount ? Number(product.cost_discount) : 0
    }]);
    setSearchQuery('');
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        const importedItems: POLineItem[] = jsonData.map(row => {
          const pidStr = String(row.PID || '');
          const matchedProduct = products.find(p => p.pid === pidStr);
          return {
            product_id: matchedProduct?.product_id, pid: pidStr, brand: String(row.Brand || matchedProduct?.brand || ''),
            name: String(row.Item_Name || row.Name || matchedProduct?.name || ''), sku: String(row.SKU || matchedProduct?.sku || ''),
            bundling: String(row.Bundling || ''), qty: Number(row.QTY || row.Qty || 1),
            cost: Number(row.Cost || matchedProduct?.gross_cost || 0), discount: Number(row.Discounting || matchedProduct?.cost_discount || 0)
          };
        }).filter(item => item.pid && item.qty > 0);

        const existingPids = new Set(lineItems.map(i => i.pid));
        const newItems = importedItems.filter(i => !existingPids.has(i.pid));
        setLineItems([...lineItems, ...newItems]);
      } catch (error) {
        alert("Failed to parse Excel file. Please check headers.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const downloadPOTemplate = () => {
    const templateData = [{ QTY: 100, PID: 'ITM-1001', Brand: 'Example', Item_Name: 'Widget', SKU: 'WGT-01', Bundling: '12s', Cost: 50.00, Discounting: 0.10 }];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "PO_Items");
    XLSX.writeFile(workbook, 'PO_Item_Import_Template.xlsx');
  };

  const updateLineItem = (index: number, field: keyof POLineItem, value: string) => {
    const updated = [...lineItems];
    (updated[index] as any)[field] = Number(value);
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => setLineItems(lineItems.filter((_, i) => i !== index));

  const grandTotal = lineItems.reduce((sum, item) => sum + (item.qty * (item.cost * (1 - item.discount))), 0);

  // --- API HANDLERS ---
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) return alert("Please select a Vendor.");
    if (lineItems.length === 0) return alert("Please add at least one product.");

    setSaving(true);
    try {
        const payload = {
        supplier_id: Number(supplierId), document_id: `PO-${Date.now()}`, target_delivery_date: targetDate || undefined,
        items: lineItems.map(item => ({
          product_id: item.product_id || undefined, pid: item.pid, brand: item.brand, name: item.name,
          sku: item.sku, bundling: item.bundling, requested_qty: item.qty, unit_gross_cost: item.cost, discount: item.discount
        }))
      };
      await createPurchaseOrder(payload);
      setIsCreateModalOpen(false);
      loadData();
    } catch (err) {
      alert("Failed to create Purchase Order.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (poId: number, newStatus: string) => {
    try {
      await fetch(`import.meta.env.VITE_API_URL/api/procurement/orders/${poId}/status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      setViewPO(null); // Close modal
      loadData(); // Refresh table
    } catch (error) {
      alert("Failed to update status.");
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Purchase Orders...</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Purchase Orders (Manifests)</h2>
          <p className="text-gray-500 mt-1">Manage expected cargo lifecycles.</p>
        </div>
        <button onClick={() => {
          setSupplierId(''); setTargetDate(''); setLineItems([]); setIsCreateModalOpen(true);
        }} className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow hover:bg-blue-700 transition">
          + Draft New PO
        </button>
      </div>

      {/* MASTER PO TABLE (NOW CLICKABLE!) */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-700">
            <tr>
              <th className="px-4 py-3 font-semibold">PO Number</th>
              <th className="px-4 py-3 font-semibold">Supplier</th>
              <th className="px-4 py-3 font-semibold">Target Delivery</th>
              <th className="px-4 py-3 font-semibold text-right">Total Value</th>
              <th className="px-4 py-3 font-semibold text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-600">
            {orders.map(po => {
              const total = po.items?.reduce((sum, item) => sum + (item.requested_qty * (item.unit_gross_cost * (1 - (item.discount || 0)))), 0) || po.total_value || 0;
              return (
                <tr 
                  key={po.po_id} 
                  onClick={() => setViewPO(po)} 
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                  title="Click to view details"
                >
                  <td className="px-4 py-3 font-bold text-blue-600">PO-{String(po.po_id).padStart(5, '0')}</td>
                  <td className="px-4 py-3 font-medium">{po.supplier?.name}</td>
                  <td className="px-4 py-3">{po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString() : 'Unscheduled'}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      po.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                      po.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {po.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No Purchase Orders drafted yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* --- MODAL 1: VIEW/ACTION PO --- */}
      {viewPO && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-gray-800">
                PO-{String(viewPO.po_id).padStart(5, '0')} Details
                <span className="ml-4 px-2 py-1 bg-gray-200 text-sm rounded font-medium">{viewPO.status}</span>
              </h3>
              <button onClick={() => setViewPO(null)} className="text-gray-400 hover:text-gray-800 font-bold text-xl">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow bg-white">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div><p className="text-sm text-gray-500 font-bold uppercase">Vendor</p><p className="text-lg font-medium">{viewPO.supplier?.name}</p></div>
                <div><p className="text-sm text-gray-500 font-bold uppercase">Target Delivery</p><p className="text-lg">{viewPO.expected_delivery_date ? new Date(viewPO.expected_delivery_date).toLocaleDateString() : 'N/A'}</p></div>
              </div>

              <h4 className="font-bold text-gray-700 mb-2 border-b pb-2">Manifest Items</h4>
              <div className="border rounded-lg overflow-x-auto">
                <table className="min-w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="px-3 py-2 font-semibold">PID / Product</th>
                      <th className="px-3 py-2 font-semibold text-right">Qty</th>
                      <th className="px-3 py-2 font-semibold text-right">Net Cost</th>
                      <th className="px-3 py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {viewPO.items?.map((item: any, idx: number) => {
                      const net = item.unit_gross_cost * (1 - (item.discount || 0));
                      const total = item.requested_qty * net;
                      return (
                        <tr key={idx}>
                          <td className="px-3 py-2">
                            <div className="font-bold">{item.product?.name || 'Unknown Item'}</div>
                            <div className="text-xs text-gray-500">{item.product?.pid}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-bold">{item.requested_qty}</td>
                          <td className="px-3 py-2 text-right">{net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-right font-bold">Grand Total:</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-lg">
                        {Number(viewPO.total_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg">
              <button onClick={() => setViewPO(null)} className="px-4 py-2 border rounded hover:bg-gray-100">Close</button>
              
              {/* ACTION BUTTONS BASED ON STATUS */}
              {viewPO.status === 'DRAFT' && (
                <button onClick={() => updateStatus(viewPO.po_id, 'CONFIRMED')} className="px-6 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700">
                  Confirm Order
                </button>
              )}
              {viewPO.status === 'CONFIRMED' && (
                <button disabled className="px-6 py-2 bg-green-600 text-white font-bold rounded shadow opacity-50 cursor-not-allowed" title="Next step: Log via Incoming Containers">
                  Awaiting Delivery...
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: CREATE PO (Unchanged layout, just renamed state variable) --- */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-gray-800">Draft Purchase Order</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-gray-800 font-bold text-xl">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow bg-gray-50">
              <form id="poForm" onSubmit={handleCreate} className="space-y-6">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded border shadow-sm">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Vendor *</label>
                    <select className="w-full border p-2 rounded focus:ring-blue-500" required value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                      <option value="">-- Choose Vendor --</option>
                      {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Target Delivery Date</label>
                    <input type="date" className="w-full border p-2 rounded focus:ring-blue-500" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
                  </div>
                </div>

                <div className="bg-white p-4 rounded border shadow-sm">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-4">
                    <div className="flex-grow relative w-full md:w-auto">
                      <label className="block text-sm font-bold text-gray-800 mb-2">Search Products Manually:</label>
                      <input 
                        type="text" placeholder="Type PID, SKU, Brand, or Name..." 
                        className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500 text-sm"
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      />
                      {searchResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
                          {searchResults.map(p => (
                            <div key={p.product_id} onClick={() => addProductToTally(p)} className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 flex justify-between items-center">
                              <div><span className="font-bold text-gray-800">{p.name}</span><span className="ml-2 text-xs text-gray-500 border px-1 rounded">{p.sku || p.pid}</span></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="border-l pl-4 flex flex-col justify-end w-full md:w-auto">
                      <label className="block text-sm font-bold text-gray-800 mb-2">Or Import via Excel:</label>
                      <div className="flex items-center gap-2">
                        <input type="file" accept=".xlsx, .csv" onChange={handleExcelImport} className="text-sm text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
                        <button type="button" onClick={downloadPOTemplate} className="text-xs text-blue-600 underline hover:text-blue-800">Template</button>
                      </div>
                    </div>
                  </div>

                  <div className="border rounded-lg overflow-x-auto">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-100 border-b">
                        <tr>
                          <th className="px-3 py-2 font-semibold">PID</th>
                          <th className="px-3 py-2 font-semibold">Item Details</th>
                          <th className="px-3 py-2 font-semibold w-24">Qty</th>
                          <th className="px-3 py-2 font-semibold w-28">Gross Cost</th>
                          <th className="px-3 py-2 font-semibold w-28">Discount</th>
                          <th className="px-3 py-2 font-semibold text-right w-28">Line Total</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lineItems.length === 0 ? (
                          <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 italic">Use the search bar or Excel import to add products.</td></tr>
                        ) : (
                          lineItems.map((item, idx) => {
                            const net = item.cost * (1 - item.discount);
                            return (
                              <tr key={idx} className="bg-white">
                                <td className="px-3 py-2 font-mono text-gray-600">{item.pid}</td>
                                <td className="px-3 py-2"><div className="font-medium text-gray-800">{item.name}</div></td>
                                <td className="px-3 py-2"><input type="number" step="1" min="1" className="w-full border p-1 rounded" required value={item.qty} onChange={e => updateLineItem(idx, 'qty', e.target.value)} /></td>
                                <td className="px-3 py-2"><input type="number" step="0.01" min="0" className="w-full border p-1 rounded" required value={item.cost} onChange={e => updateLineItem(idx, 'cost', e.target.value)} /></td>
                                <td className="px-3 py-2"><input type="number" step="0.01" min="0" max="1" className="w-full border p-1 rounded" value={item.discount} onChange={e => updateLineItem(idx, 'discount', e.target.value)} /></td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-gray-700">{(item.qty * net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeLineItem(idx)} className="text-red-500 font-bold">✖</button></td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t">
                        <tr>
                          <td colSpan={5} className="px-3 py-3 text-right font-bold text-gray-600">Grand Total:</td>
                          <td className="px-3 py-3 text-right font-mono font-bold text-blue-700 text-lg">{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </form>
            </div>
            
            <div className="p-4 border-t bg-white flex justify-end gap-3 rounded-b-lg">
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded font-medium">Cancel</button>
              <button type="submit" form="poForm" disabled={saving || lineItems.length === 0} className="px-6 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700">
                {saving ? 'Saving...' : 'Draft PO Manifest'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}