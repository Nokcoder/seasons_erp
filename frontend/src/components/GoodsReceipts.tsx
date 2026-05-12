import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { fetchSuppliers, fetchProducts, fetchLocations } from '../services/api';

interface GRNLineItem {
  product_id?: number;
  pid: string;
  name: string;
  sku: string;
  brand: string;
  units_per_bundle: number; 
  bundles: number;
  qty: number;
}

export default function GoodsReceipts() {
  const [receipts, setReceipts] = useState<any[]>([]); 
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]); 
  const [users, setUsers] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);

  // --- DASHBOARD CONTROLS STATE ---
  const [topX, setTopX] = useState(25); 
  const [sortConfig, setSortConfig] = useState({ key: 'grn_id', direction: 'desc' });
  
  // Unified Search State
  const [activeSearchTerms, setActiveSearchTerms] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');

  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [viewGRN, setViewGRN] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Form State
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [checkedById, setCheckedById] = useState(''); 
  const [rcvDocId, setRcvDocId] = useState('');
  const [vanNumber, setVanNumber] = useState('');
  const [dateChecked, setDateChecked] = useState('');
  const [totalBundles, setTotalBundles] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [lineItems, setLineItems] = useState<GRNLineItem[]>([]);

  const loadData = () => {
    setLoading(true);
    fetch(import.meta.env.VITE_API_URL + '/api/procurement/receipts')
      .then(res => res.json())
      .then(data => setReceipts(data))
      .catch(console.error);

    fetch(import.meta.env.VITE_API_URL + '/api/auth/users') 
      .then(res => res.ok ? res.json() : [])
      .then(data => setUsers(data))
      .catch(console.error);
      
    Promise.all([fetchSuppliers(), fetchProducts(), fetchLocations()]).then(
      ([supData, prdData, locData]) => {
        setSuppliers(supData);
        setProducts(prdData);
        setLocations(locData);
        setLoading(false);
      }
    ).catch(console.error);
  };

  useEffect(() => { loadData(); }, []);

  // --- NORMALIZATION TOOL (Ignores spaces, hyphens, and underscores) ---
  const normalizeText = (str: string | undefined | null) => 
    (str || '').toString().toLowerCase().replace(/[\s_-]/g, '');

  // --- DASHBOARD FILTER LOGIC ---
  const filteredAndSortedReceipts = useMemo(() => {
    let result = [...receipts];

    // Combine locked tags and whatever is currently typed in the input
    const rawTerms = [...activeSearchTerms, searchInput].filter(t => t.trim() !== '');
    const normalizedTerms = rawTerms.map(normalizeText);

    if (normalizedTerms.length > 0) {
      result = result.filter(r => {
        // Construct a giant invisible string of all GRN data, completely normalized
        const searchableData = normalizeText(`
          grn${String(r.grn_id).padStart(5, '0')}
          ${r.grn_id}
          ${r.supplier?.name}
          ${r.location?.name}
          ${r.rcv_document_id}
          ${r.van_number}
          ${r.checked_by?.username}
          ${r.checked_by?.first_name}
          ${r.status}
        `);

        // AND LOGIC: Every search term provided must be found somewhere in the GRN data
        return normalizedTerms.every(term => searchableData.includes(term));
      });
    }

    // Sorting
    result.sort((a, b) => {
      let aValue: any = a[sortConfig.key];
      let bValue: any = b[sortConfig.key];

      if (sortConfig.key === 'supplier') aValue = a.supplier?.name || '';
      if (sortConfig.key === 'location') aValue = a.location?.name || '';
      if (sortConfig.key === 'checked_by') aValue = a.checked_by?.username || a.checked_by?.first_name || '';

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return topX === -1 ? result : result.slice(0, topX);
  }, [receipts, activeSearchTerms, searchInput, sortConfig, topX]);

  // --- SEARCH BAR EVENT HANDLERS ---
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && searchInput.trim()) {
      e.preventDefault();
      // Allow user to type comma-separated items and hit enter
      const newTerms = searchInput.split(',').map(t => t.trim()).filter(Boolean);
      setActiveSearchTerms([...activeSearchTerms, ...newTerms]);
      setSearchInput('');
    } else if (e.key === 'Backspace' && searchInput === '' && activeSearchTerms.length > 0) {
      // Delete the last tag if pressing backspace on empty input
      setActiveSearchTerms(activeSearchTerms.slice(0, -1));
    }
  };

  const handleSearchPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    // Split by comma or newline so they can paste lists of IDs or names directly!
    const newTerms = pastedText.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
    setActiveSearchTerms([...activeSearchTerms, ...newTerms]);
  };

  const removeSearchTerm = (index: number) => {
    setActiveSearchTerms(activeSearchTerms.filter((_, i) => i !== index));
  };

  const requestSort = (key: string) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return '↕️';
    return sortConfig.direction === 'asc' ? '🔼' : '🔽';
  };

  // --- CREATE FORM SEARCH LOGIC ---
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const lowerQuery = normalizeText(searchQuery);
    return products.filter(p => {
      const searchable = normalizeText(`${p.pid} ${p.sku} ${p.brand} ${p.name}`);
      return searchable.includes(lowerQuery);
    }).slice(0, 5);
  }, [searchQuery, products]);

  const addProductToTally = (product: any) => {
    if (lineItems.find(item => item.product_id === product.product_id || item.pid === product.pid)) {
      setSearchQuery(''); return; 
    }
    setLineItems([...lineItems, { 
      product_id: product.product_id, pid: product.pid, name: product.name, 
      sku: product.sku || '', brand: product.brand || '', 
      units_per_bundle: product.units_per_bundle || 1,
      bundles: 0, qty: 1
    }]);
    setSearchQuery('');
  };

  // --- EXCEL & LINE ITEM LOGIC ---
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

        const importedItems: GRNLineItem[] = jsonData.map(row => {
          const pidStr = String(row.PID || '');
          const matchedProduct = products.find(p => p.pid === pidStr);
          const upb = matchedProduct?.units_per_bundle || 1;
          const importedQty = Number(row.QTY || row.Qty || 0);
          return {
            product_id: matchedProduct?.product_id, pid: pidStr, brand: String(matchedProduct?.brand || 'Unknown'),
            name: String(matchedProduct?.name || 'Unknown Item'), sku: String(matchedProduct?.sku || ''),
            units_per_bundle: upb, bundles: Math.floor(importedQty / upb), qty: importedQty
          };
        }).filter(item => item.pid && item.qty > 0);

        const existingPids = new Set(lineItems.map(i => i.pid));
        const newItems = importedItems.filter(i => !existingPids.has(i.pid));
        setLineItems([...lineItems, ...newItems]);
      } catch (error) {
        alert("Failed to parse Excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const updateLineItem = (index: number, field: keyof GRNLineItem, value: string) => {
    const updated = [...lineItems];
    const numValue = Number(value);
    const upb = updated[index].units_per_bundle;

    if (field === 'bundles') {
      updated[index].bundles = numValue;
      updated[index].qty = numValue * upb; 
    } else if (field === 'qty') {
      updated[index].qty = numValue;
      updated[index].bundles = Math.floor(numValue / upb); 
    }
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => setLineItems(lineItems.filter((_, i) => i !== index));

  const resetForm = () => {
    setEditingId(null); setSupplierId(''); setLocationId(''); setCheckedById(''); setRcvDocId(''); 
    setVanNumber(''); setDateChecked(''); setTotalBundles(0); setLineItems([]);
  };

  const openEditForm = (grn: any) => {
    setViewGRN(null); setEditingId(grn.grn_id); setSupplierId(String(grn.supplier_id || ''));
    setLocationId(String(grn.location_id || '')); setCheckedById(String(grn.checked_by_id || ''));
    setRcvDocId(grn.rcv_document_id || ''); setVanNumber(grn.van_number || '');
    setDateChecked(grn.date_collected ? grn.date_collected.split('T')[0] : ''); setTotalBundles(grn.bundle_count || 0);
    
    const loadedItems = grn.items.map((i: any) => ({
      product_id: i.product_id, pid: i.product?.pid || '', name: i.product?.name || 'Unknown', sku: i.product?.sku || '', 
      brand: i.product?.brand || '', units_per_bundle: i.product?.units_per_bundle || 1,
      bundles: Number(i.bundling || 0), qty: Number(i.received_qty)
    }));
    setLineItems(loadedItems); setIsFormModalOpen(true);
  };

  // --- API ACTIONS ---
  const handleSaveAndAction = async (isDirectConfirm = false) => {
    if (!supplierId || !locationId) return alert("Please select a Vendor and Destination Location.");
    setSaving(true);
    const payload = {
        supplier_id: Number(supplierId), shipment_id: null, rcv_document_id: rcvDocId ? rcvDocId : null, 
        van_number: vanNumber ? vanNumber : null, bundle_count: Number(totalBundles) || 0, 
        date_checked: dateChecked ? dateChecked + "T00:00:00Z" : null, 
        location_id: Number(locationId), checked_by_id: checkedById ? Number(checkedById) : null,
        items: lineItems.map(i => ({ pid: String(i.pid), product_id: i.product_id ? Number(i.product_id) : null, bundles: Number(i.bundles) || 0, received_qty: Number(i.qty) }))
    };
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `import.meta.env.VITE_API_URL/api/procurement/receipts/${editingId}` : `import.meta.env.VITE_API_URL/api/procurement/receipts`;
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (isDirectConfirm && data.grn_id) await fetch(`import.meta.env.VITE_API_URL/api/procurement/receipts/${data.grn_id}/confirm`, { method: 'PUT' });
      setIsFormModalOpen(false); resetForm(); loadData();
    } catch (err) { alert("Failed to save draft."); } finally { setSaving(false); }
  };

  const handleConfirmGRN = async (grnId: number) => {
    if (!window.confirm("Are you sure? This will officially add stock to the warehouse.")) return;
    try {
      await fetch(`import.meta.env.VITE_API_URL/api/procurement/receipts/${grnId}/confirm`, { method: 'PUT' });
      setViewGRN(null); loadData(); alert("Stock successfully added!");
    } catch (err) { alert("Failed to confirm stock."); }
  };

  const handleDeleteDraft = async (grnId: number) => {
    if (!window.confirm("Are you sure you want to completely delete this Draft?")) return;
    try {
      await fetch(`import.meta.env.VITE_API_URL/api/procurement/receipts/${grnId}`, { method: 'DELETE' });
      setViewGRN(null); loadData();
    } catch (err) { alert("Failed to delete draft."); }
  };

  const handleVoidGRN = async (grnId: number) => {
    if (!window.confirm("WARNING: This will officially reverse the inventory stock and mark this GRN as VOID. This action is permanent. Continue?")) return;
    try {
      await fetch(`import.meta.env.VITE_API_URL/api/procurement/receipts/${grnId}/void`, { method: 'PUT' });
      setViewGRN(null); loadData(); alert("GRN voided and stock correctly reversed.");
    } catch (err) { alert("Failed to void GRN."); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Loading Goods Receipts...</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Goods Receipts</h2>
          <p className="text-gray-500 mt-1">Manage incoming stock and track warehouse intake.</p>
        </div>
        <button onClick={() => { resetForm(); setIsFormModalOpen(true); }} className="px-5 py-2.5 bg-green-600 text-white font-medium rounded-lg shadow hover:bg-green-700 transition">
          + Encode Receiving Form
        </button>
      </div>

      {/* --- UNIFIED MULTI-TERM SEARCH BAR --- */}
      <div className="bg-white p-4 rounded-t-lg border border-b-0 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shadow-sm">
        
        <div className="flex-grow w-full max-w-4xl">
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Filter Records (Hit Enter to add tag)</label>
          <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-300 p-2 rounded-md focus-within:ring-2 focus-within:ring-green-500 transition cursor-text min-h-[46px]" onClick={() => document.getElementById('unifiedSearch')?.focus()}>
            <span className="text-gray-400 pl-1">🔍</span>
            
            {/* Render Locked Search Terms */}
            {activeSearchTerms.map((term, index) => (
              <span key={index} className="flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-sm font-medium border border-green-200">
                {term}
                <button onClick={(e) => { e.stopPropagation(); removeSearchTerm(index); }} className="hover:text-red-600 ml-1 font-bold">✖</button>
              </span>
            ))}

            <input
              id="unifiedSearch"
              type="text"
              placeholder={activeSearchTerms.length === 0 ? "Type Vendor, Form #, or paste IDs..." : ""}
              className="flex-grow border-none focus:ring-0 text-sm bg-transparent outline-none min-w-[200px]"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onPaste={handleSearchPaste}
            />
            
            {/* Clear All Button */}
            {(activeSearchTerms.length > 0 || searchInput) && (
              <button 
                onClick={() => { setActiveSearchTerms([]); setSearchInput(''); }} 
                className="text-xs text-gray-500 hover:text-red-500 font-bold uppercase tracking-wider ml-auto pr-2"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        
        {/* Top X Dropdown */}
        <div className="flex items-center gap-2 md:border-l pl-0 md:pl-4 mt-4 md:mt-0">
          <label className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap">Show Top:</label>
          <select 
            className="border rounded text-sm p-1.5 focus:ring-green-500 bg-white outline-none"
            value={topX}
            onChange={(e) => setTopX(Number(e.target.value))}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={-1}>All</option>
          </select>
        </div>
      </div>

      {/* --- MASTER GRN TABLE --- */}
      <div className="bg-white shadow-md rounded-b-lg overflow-hidden border border-gray-200">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 select-none">
            <tr>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('grn_id')}>
                GRN ID {getSortIcon('grn_id')}
              </th>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('supplier')}>
                Supplier {getSortIcon('supplier')}
              </th>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('location')}>
                Location {getSortIcon('location')}
              </th>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('date_collected')}>
                Date Checked {getSortIcon('date_collected')}
              </th>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('rcv_document_id')}>
                Form # {getSortIcon('rcv_document_id')}
              </th>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('checked_by')}>
                Checked By {getSortIcon('checked_by')}
              </th>
              <th className="px-4 py-3 font-semibold text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-600">
            {filteredAndSortedReceipts.map(grn => (
              <tr 
                key={grn.grn_id} onClick={() => setViewGRN(grn)} 
                className="hover:bg-green-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 font-bold text-green-700">GRN-{String(grn.grn_id).padStart(5, '0')}</td>
                <td className="px-4 py-3 font-medium">{grn.supplier?.name || `ID: ${grn.supplier_id}`}</td>
                <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs border border-blue-100 font-medium">
                        {grn.location?.name || 'Unknown'}
                    </span>
                </td>
                <td className="px-4 py-3">
                  {grn.date_collected ? new Date(grn.date_collected).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Pending'}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{grn.rcv_document_id || 'N/A'}</td>
                <td className="px-4 py-3">{grn.checked_by?.username || grn.checked_by?.first_name || 'Not Recorded'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 rounded text-xs font-bold shadow-sm ${
                    grn.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' : 
                    grn.status === 'VOIDED' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                  }`}>{grn.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredAndSortedReceipts.length === 0 && (
          <div className="p-12 text-center text-gray-400 italic bg-gray-50">No matching records found.</div>
        )}
      </div>

      {/* --- MODAL 1: VIEW/ACTION GRN --- */}
      {viewGRN && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-gray-800">
                GRN-{String(viewGRN.grn_id).padStart(5, '0')} Details
                <span className={`ml-4 px-2 py-1 text-sm rounded font-medium ${viewGRN.status === 'VOIDED' ? 'bg-red-100 text-red-800' : 'bg-gray-200'}`}>{viewGRN.status}</span>
              </h3>
              <button onClick={() => setViewGRN(null)} className="text-gray-400 hover:text-gray-800 font-bold text-xl">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow bg-white">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 bg-gray-50 p-4 rounded-lg border">
                <div><p className="text-xs text-gray-500 font-bold uppercase">Location</p><p className="font-medium text-blue-700">{viewGRN.location?.name || 'N/A'}</p></div>
                <div><p className="text-xs text-gray-500 font-bold uppercase">Checked By</p><p className="font-medium">{viewGRN.checked_by?.username || viewGRN.checked_by?.first_name || 'Not Recorded'}</p></div>
                <div><p className="text-xs text-gray-500 font-bold uppercase">Form #</p><p className="font-mono">{viewGRN.rcv_document_id || 'N/A'}</p></div>
                <div><p className="text-xs text-gray-500 font-bold uppercase">Van Number</p><p className="font-mono">{viewGRN.van_number || 'N/A'}</p></div>
              </div>

              <h4 className="font-bold text-gray-700 mb-2 border-b pb-2">Received Items</h4>
              <div className="border rounded-lg overflow-x-auto">
                <table className="min-w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Product</th>
                      <th className="px-3 py-2 font-semibold text-center">Bundle Config</th>
                      <th className="px-3 py-2 font-semibold text-right">Received Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {viewGRN.items?.map((item: any, idx: number) => {
                      const upb = item.product?.units_per_bundle || 1;
                      const bundles = Math.floor(item.received_qty / upb);
                      const remainder = item.received_qty % upb;
                      return (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <div className="font-bold">{item.product?.name || `Product ID: ${item.product_id}`}</div>
                          <div className="text-xs text-gray-500">{item.product?.pid}</div>
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          <span className="bg-gray-100 px-2 py-1 rounded font-mono border">{upb}s</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="font-bold text-green-700 text-lg">{item.received_qty}</div>
                          {upb > 1 && <div className="text-xs text-gray-400 font-mono italic">{bundles} + ({remainder})</div>}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-between items-center rounded-b-lg">
              <div>
                 {viewGRN.status === 'DRAFT' && (
                    <button onClick={() => handleDeleteDraft(viewGRN.grn_id)} className="text-red-500 hover:text-red-700 font-bold text-sm underline transition">Delete Draft</button>
                 )}
                 {viewGRN.status === 'CONFIRMED' && (
                    <button onClick={() => handleVoidGRN(viewGRN.grn_id)} className="text-red-600 hover:text-red-800 font-bold text-sm underline transition">Correct Entry (Void)</button>
                 )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setViewGRN(null)} className="px-4 py-2 border rounded hover:bg-gray-100 transition">Close</button>
                {viewGRN.status === 'DRAFT' && (
                  <>
                    <button onClick={() => openEditForm(viewGRN)} className="px-6 py-2 bg-blue-100 text-blue-700 font-bold rounded shadow hover:bg-blue-200 transition border border-blue-200">Edit Draft</button>
                    <button onClick={() => handleConfirmGRN(viewGRN.grn_id)} className="px-6 py-2 bg-green-600 text-white font-bold rounded shadow hover:bg-green-700 transition">Confirm & Add</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: FORM/CREATE/EDIT GRN --- */}
      {isFormModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-gray-800">{editingId ? 'Edit Draft Encoding' : 'New Stock Encoding Form'}</h3>
              <button onClick={() => setIsFormModalOpen(false)} className="text-gray-400 hover:text-gray-800 font-bold text-xl">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow bg-gray-50">
              <div className="space-y-6">
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded border shadow-sm">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Supplier *</label>
                    <select className="w-full border p-2 rounded focus:ring-green-500 transition" required value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                      <option value="">-- Select --</option>
                      {suppliers.map((s: any) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Destination Location *</label>
                    <select className="w-full border p-2 rounded focus:ring-green-500 transition" required value={locationId} onChange={e => setLocationId(e.target.value)}>
                      <option value="">-- Select Location --</option>
                      {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Checked By (Employee)</label>
                    <select className="w-full border p-2 rounded focus:ring-green-500 transition" value={checkedById} onChange={e => setCheckedById(e.target.value)}>
                      <option value="">-- Select Employee --</option>
                      {users.map((u: any) => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.username || u.first_name || `User ID: ${u.user_id}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Date Checked</label>
                    <input type="date" className="w-full border p-2 rounded focus:ring-green-500 transition" value={dateChecked} onChange={e => setDateChecked(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Form #</label>
                    <input type="text" className="w-full border p-2 rounded focus:ring-green-500 transition" value={rcvDocId} onChange={e => setRcvDocId(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Van Number</label>
                    <input type="text" className="w-full border p-2 rounded focus:ring-green-500 transition" value={vanNumber} onChange={e => setVanNumber(e.target.value)} />
                  </div>
                </div>

                <div className="bg-white p-4 rounded border shadow-sm">
                  <div className="flex justify-between items-end gap-4 mb-4">
                    <div className="flex-grow relative">
                      <label className="block text-sm font-bold text-gray-800 mb-2">Search Products:</label>
                      <input type="text" placeholder="Type PID, SKU, Brand, or Name..." className="w-full border border-gray-300 p-2 rounded transition focus:border-green-500 outline-none" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                      {searchResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg overflow-hidden">
                          {searchResults.map((p: any) => (
                            <div key={p.product_id} onClick={() => addProductToTally(p)} className="p-3 hover:bg-green-50 cursor-pointer border-b last:border-0 flex justify-between items-center transition">
                              <div><span className="font-bold">{p.name}</span><span className="ml-2 text-xs text-gray-500 border px-1 rounded">{p.sku || p.pid}</span></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="border-l pl-4">
                      <label className="block text-sm font-bold text-gray-800 mb-2">Bulk Import:</label>
                      <input type="file" accept=".xlsx, .csv" onChange={handleExcelImport} className="text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-100 transition cursor-pointer" />
                    </div>
                  </div>

                  <div className="border rounded-lg overflow-x-auto">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-100 border-b">
                        <tr>
                          <th className="px-3 py-2 font-semibold">PID / Details</th>
                          <th className="px-3 py-2 font-semibold text-center w-24">Config</th>
                          <th className="px-3 py-2 font-semibold w-24">Bundles</th>
                          <th className="px-3 py-2 font-semibold w-28">Total Qty</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lineItems.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 italic">Search or Import to add items.</td></tr>
                        ) : (
                          lineItems.map((item, idx) => (
                            <tr key={idx} className="bg-white hover:bg-gray-50 transition">
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-800">{item.name} <span className="text-xs text-gray-500 ml-1 font-mono">{item.pid}</span></div>
                              </td>
                              <td className="px-3 py-2 text-center"><span className="bg-gray-100 px-2 py-1 rounded text-xs font-mono border">{item.units_per_bundle}s</span></td>
                              <td className="px-3 py-2"><input type="number" className="w-full border p-1 rounded focus:ring-1 focus:ring-green-500 outline-none" value={item.bundles} onChange={e => updateLineItem(idx, 'bundles', e.target.value)} /></td>
                              <td className="px-3 py-2">
                                <input type="number" className="w-full border p-1 rounded font-bold focus:ring-1 focus:ring-green-500 outline-none" required value={item.qty} onChange={e => updateLineItem(idx, 'qty', e.target.value)} />
                                {item.units_per_bundle > 1 && (
                                  <div className="text-xs text-gray-400 mt-1 font-mono italic text-right">{Math.floor(item.qty / item.units_per_bundle)} + ({item.qty % item.units_per_bundle})</div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeLineItem(idx)} className="text-red-500 hover:text-red-700 font-bold px-2 transition">✖</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t bg-white flex justify-end gap-3 rounded-b-lg">
              <button type="button" onClick={() => setIsFormModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded font-medium transition">Cancel</button>
              <button type="button" onClick={() => handleSaveAndAction(false)} disabled={saving || lineItems.length === 0} className="px-6 py-2 bg-blue-100 text-blue-700 font-bold rounded shadow hover:bg-blue-200 border border-blue-200 transition disabled:opacity-50">Save Draft</button>
              <button type="button" onClick={() => handleSaveAndAction(true)} disabled={saving || lineItems.length === 0} className="px-6 py-2 bg-green-600 text-white font-bold rounded shadow hover:bg-green-700 transition disabled:opacity-50">Encode & Receive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}