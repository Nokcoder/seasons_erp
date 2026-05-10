import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { fetchProducts, fetchUsers, fetchLocations, createTransfer } from '../services/api';
import type { Product, User, TransferLocation } from '../services/api';

interface BatchGroup {
  document_id: string;
  from_location_id: number;
  to_location_id: number;
  released_by_id: number;
  received_by_id: number;
  from_name: string; 
  to_name: string;   
  items: { product_id: number; pid: string; name: string; sku: string; bundle_count: number; qty: number; upb: number }[];
}

interface TransferItem {
  product_id: number; 
  pid: string;
  name: string; 
  sku: string; 
  bundle_count: number; 
  qty: number;
  upb: number; 
}

export default function TransferForm() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Database References
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [locations, setLocations] = useState<TransferLocation[]>([]);

  // --- MODE STATE ---
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchGroups, setBatchGroups] = useState<BatchGroup[]>([]);

  // --- MANUAL MODE STATE ---
  const [header, setHeader] = useState({ document_id: '', from_location_id: '', to_location_id: '', released_by_id: '', received_by_id: '' });
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  
  // CART STATE
  const [items, setItems] = useState<TransferItem[]>([]);

  useEffect(() => {
    Promise.all([fetchProducts(), fetchUsers(), fetchLocations()]).then(([pData, uData, lData]) => {
      setProducts(pData);
      setUsers(uData);
      setLocations(lData);
    });
  }, []);

  // --- MANUAL SEARCH LOGIC ---
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && currentInput.trim()) {
      e.preventDefault();
      if (!searchTags.includes(currentInput.trim())) setSearchTags([...searchTags, currentInput.trim()]);
      setCurrentInput('');
    }
  };
  const removeTag = (tag: string) => setSearchTags(searchTags.filter(t => t !== tag));

  const filteredProducts = useMemo(() => {
    if (searchTags.length === 0 && !currentInput.trim()) return [];
    const activeFilters = [...searchTags];
    if (currentInput.trim()) activeFilters.push(currentInput.trim());
    
    const normalize = (str: string) => (str || '').replace(/[\s-]/g, '').toLowerCase();
    const normalizedFilters = activeFilters.map(normalize);
    
    return products.filter(p => {
      const text = normalize([p.pid, p.brand, p.name, p.variant, p.sku].filter(Boolean).join(' '));
      return normalizedFilters.every(tag => text.includes(tag));
    }).slice(0, 8); 
  }, [products, searchTags, currentInput]);

  // --- BI-DIRECTIONAL MATH HANDLERS (MANUAL CART) ---
  const handleBundleChange = (index: number, bundleValue: string) => {
    const newItems = [...items];
    const bundleCount = Number(bundleValue) || 0;
    const upb = newItems[index].upb;

    newItems[index].bundle_count = bundleCount;
    newItems[index].qty = bundleCount * upb; 
    setItems(newItems);
  };

  const handleQtyChange = (index: number, qtyValue: string) => {
    const newItems = [...items];
    const qty = Number(qtyValue) || 0;
    const upb = newItems[index].upb;

    newItems[index].qty = qty;
    newItems[index].bundle_count = Math.floor(qty / upb); 
    setItems(newItems);
  };

  const addProductToCart = (p: Product) => {
    if (items.some(i => i.product_id === p.product_id)) return;
    const upb = p.units_per_bundle || 1;
    setItems([...items, { 
      product_id: p.product_id, pid: p.pid, name: p.name, sku: p.sku || '', 
      bundle_count: 0, qty: 1, upb: upb
    }]);
  };

  // --- EXCEL LOGIC ---
  const downloadTemplate = () => {
    const templateData = [
      { 'Document ID': 'BATCH-001', 'Origin': locations[0]?.name || 'Warehouse A', 'Destination': locations[1]?.name || 'Store B', 'Released By': users[0]?.username || 'admin', 'Received By': users[1]?.username || 'manager', 'PID': 'PROD-0001', 'Bundle Count': 2, 'Qty': '' },
      { 'Document ID': 'BATCH-001', 'Origin': locations[0]?.name || 'Warehouse A', 'Destination': locations[1]?.name || 'Store B', 'Released By': users[0]?.username || 'admin', 'Received By': users[1]?.username || 'manager', 'PID': 'PROD-0002', 'Bundle Count': 0, 'Qty': 5 },
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transfers");
    XLSX.writeFile(workbook, "Multi_Transfer_Template.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      const workbook = XLSX.read(data, { type: 'array' });
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]) as any[];

      const locMap = new Map(locations.map(l => [l.name.toLowerCase().trim(), l.location_id]));
      const userMap = new Map(users.map(u => [u.username.toLowerCase().trim(), u.user_id]));

      const groupedData = new Map<string, BatchGroup>();
      const errors: string[] = [];

      json.forEach((row, index) => {
        const rowNum = index + 2;
        
        // 1. Normalize Row Headers (Makes parsing immune to typos/spaces in Excel columns)
        const normRow: any = {};
        Object.keys(row).forEach(key => {
          normRow[key.trim().toLowerCase()] = row[key];
        });

        const docId = String(normRow['document id'] || normRow['doc id'] || `UNKNOWN-${rowNum}`).trim();
        const originStr = String(normRow['origin'] || normRow['from'] || '').toLowerCase().trim();
        const destStr = String(normRow['destination'] || normRow['to'] || '').toLowerCase().trim();
        const relStr = String(normRow['released by'] || '').toLowerCase().trim();
        const recStr = String(normRow['received by'] || '').toLowerCase().trim();
        const rawPid = String(normRow['pid'] || '').toLowerCase().trim();

        const fromId = locMap.get(originStr);
        const toId = locMap.get(destStr);
        const relId = userMap.get(relStr);
        const recId = userMap.get(recStr);
        const product = products.find(p => p.pid.toLowerCase().trim() === rawPid);

        if (!fromId) errors.push(`Row ${rowNum}: Origin '${originStr}' not found.`);
        if (!toId) errors.push(`Row ${rowNum}: Destination '${destStr}' not found.`);
        if (!relId) errors.push(`Row ${rowNum}: Released By '${relStr}' not found.`);
        if (!recId) errors.push(`Row ${rowNum}: Received By '${recStr}' not found.`);
        if (!product) errors.push(`Row ${rowNum}: PID '${normRow['pid']}' not found in master inventory.`);

        if (fromId && toId && relId && recId && product) {
          if (!groupedData.has(docId)) {
            groupedData.set(docId, {
              document_id: docId,
              from_location_id: fromId, to_location_id: toId,
              released_by_id: relId, received_by_id: recId,
              from_name: String(normRow['origin'] || normRow['from']), 
              to_name: String(normRow['destination'] || normRow['to']),
              items: []
            });
          }
          
          const upb = product.units_per_bundle || 1;
          
          // 2. Strict Math Calculation
          const importedBundles = Number(normRow['bundle count'] || normRow['bundles'] || 0);
          let importedQty = Number(normRow['qty'] || normRow['quantity'] || 0);
          
          // If QTY is 0 or blank, but they provided bundles, calculate QTY
          if (importedQty === 0 && importedBundles > 0) {
            importedQty = importedBundles * upb;
          }
          
          // Fallback: If both are completely blank, default to 1 piece
          if (importedQty === 0 && importedBundles === 0) {
            importedQty = 1;
          }

          // Recalculate full bundles to ensure accuracy
          const finalBundles = Math.floor(importedQty / upb);

          groupedData.get(docId)!.items.push({
            product_id: product.product_id, 
            pid: product.pid,
            name: product.name, 
            sku: product.sku || String(normRow['sku'] || ''),
            bundle_count: finalBundles, 
            qty: importedQty,
            upb: upb
          });
        }
      });

      if (errors.length > 0) {
        alert(`🚨 Import Error:\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? '\n...and more' : ''}`);
      } else if (groupedData.size > 0) {
        setBatchGroups(Array.from(groupedData.values()));
        setIsBatchMode(true); 
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  // --- SUBMISSION HANDLER ---
  const handleSubmit = async (e: React.FormEvent, isDirect: boolean) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (isBatchMode) {
        const promises = batchGroups.map(group => {
          return createTransfer({
            document_id: group.document_id,
            from_location_id: group.from_location_id,
            to_location_id: group.to_location_id,
            released_by_id: group.released_by_id,
            received_by_id: group.received_by_id,
            bundle_count: group.items.reduce((sum, item) => sum + item.bundle_count, 0),
            is_direct: isDirect,
            items: group.items.map(i => ({ 
              product_id: i.product_id, 
              bundling: String(i.bundle_count), 
              requested_qty: Number(i.qty) 
            }))
          });
        });
        await Promise.all(promises);
      } else {
        if (items.length === 0) throw new Error("Add items to cart first.");
        await createTransfer({
          document_id: header.document_id || undefined,
          from_location_id: Number(header.from_location_id),
          to_location_id: Number(header.to_location_id),
          released_by_id: Number(header.released_by_id),
          received_by_id: Number(header.received_by_id),
          bundle_count: items.reduce((sum, item) => sum + item.bundle_count, 0),
          is_direct: isDirect,
          items: items.map(i => ({ 
            product_id: i.product_id, 
            bundling: String(i.bundle_count), 
            requested_qty: Number(i.qty) 
          }))
        });
      }
      navigate('/transfers');
    } catch (error: any) {
      alert(`Error: ${error.message || "Failed to process transfer(s)."}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto mt-8 p-6 bg-white shadow-md rounded-lg mb-20">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            {isBatchMode ? 'Batch Transfer Review' : 'Create Stock Transfer'}
          </h2>
          {isBatchMode && <p className="text-sm text-green-600 font-bold mt-1">Excel Sheet Loaded Successfully</p>}
        </div>
        
        <div className="flex gap-3">
          {isBatchMode && (
            <button onClick={() => setIsBatchMode(false)} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-bold rounded shadow-sm hover:bg-gray-200 transition">
              Clear Batch & Return to Manual
            </button>
          )}
          <button onClick={downloadTemplate} className="px-4 py-2 bg-green-50 text-green-700 border border-green-200 text-sm font-bold rounded shadow-sm hover:bg-green-100 transition">
            ↓ Download Template
          </button>
          <label className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700 transition cursor-pointer flex items-center">
            ↑ Import Excel
            <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} ref={fileInputRef} className="hidden" />
          </label>
        </div>
      </div>

      <form className="space-y-8">
        {isBatchMode ? (
          
          /* --- BATCH PREVIEW MODE WITH EXPANDED ITEMS --- */
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 rounded">
              Reviewing <strong>{batchGroups.length} separate transfer documents</strong> containing a total of <strong>{batchGroups.reduce((acc, g) => acc + g.items.length, 0)} line items</strong>.
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {batchGroups.map((group, idx) => (
                <div key={idx} className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col max-h-[32rem]">
                  {/* Batch Header */}
                  <div className="p-4 border-b bg-gray-50 rounded-t-lg">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-blue-700 text-lg">{group.document_id}</h4>
                      <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2 py-1 rounded-full border border-blue-200">{group.items.length} items</span>
                    </div>
                    <div className="text-sm text-gray-600 grid grid-cols-2 gap-2">
                      <p><span className="font-semibold text-gray-400 uppercase text-xs block">Route</span> {group.from_name} <br/>➔ {group.to_name}</p>
                      <p><span className="font-semibold text-gray-400 uppercase text-xs block">Agents</span> {users.find(u=>u.user_id===group.released_by_id)?.username} <br/>/ {users.find(u=>u.user_id===group.received_by_id)?.username}</p>
                    </div>
                  </div>
                  
                  {/* Batch Line Items Preview */}
                  <div className="overflow-y-auto flex-grow p-0">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-gray-600">PID</th>
                          <th className="px-3 py-2 font-semibold text-gray-600">Product</th>
                          <th className="px-3 py-2 font-semibold text-center text-gray-600">Config</th>
                          <th className="px-3 py-2 font-semibold text-right text-gray-600">Bundles</th>
                          <th className="px-3 py-2 font-semibold text-right text-gray-600">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {group.items.map((item, i) => {
                          const remainder = item.qty % item.upb;
                          return (
                            <tr key={i} className="hover:bg-gray-50 transition">
                              <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.pid}</td>
                              <td className="px-3 py-2 font-medium truncate max-w-[120px]" title={item.name}>{item.name}</td>
                              <td className="px-3 py-2 text-center"><span className="bg-gray-100 px-2 py-0.5 rounded text-xs border">{item.upb}s</span></td>
                              <td className="px-3 py-2 text-right">{item.bundle_count}</td>
                              <td className="px-3 py-2 text-right">
                                <span className="font-bold text-gray-800">{item.qty}</span>
                                {item.upb > 1 && remainder > 0 && (
                                  <span className="text-xs text-orange-500 ml-1" title="Broken Bundle">+{remainder}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          
          /* --- MANUAL SINGLE FORM --- */
          <>
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-5 rounded-lg border border-gray-200 shadow-sm">
              <div>
                <label className="block text-sm font-semibold text-gray-700">Document ID (Optional)</label>
                <input type="text" name="document_id" value={header.document_id} onChange={e => setHeader({...header, document_id: e.target.value})} className="mt-1 w-full rounded border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 transition" />
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-6 mt-2">
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">From Location *</label><select name="from_location_id" value={header.from_location_id} onChange={e => setHeader({...header, from_location_id: e.target.value})} required className="w-full rounded border-gray-300 p-2 border bg-white focus:ring-blue-500 transition"><option value="">Select Origin...</option>{locations.map(loc => <option key={loc.location_id} value={loc.location_id}>{loc.name}</option>)}</select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">To Location *</label><select name="to_location_id" value={header.to_location_id} onChange={e => setHeader({...header, to_location_id: e.target.value})} required className="w-full rounded border-gray-300 p-2 border bg-white focus:ring-blue-500 transition"><option value="">Select Destination...</option>{locations.map(loc => <option key={loc.location_id} value={loc.location_id}>{loc.name}</option>)}</select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Released By *</label><select name="released_by_id" value={header.released_by_id} onChange={e => setHeader({...header, released_by_id: e.target.value})} required className="w-full rounded border-gray-300 p-2 border bg-white focus:ring-blue-500 transition"><option value="">Select Employee...</option>{users.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}</select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Received By *</label><select name="received_by_id" value={header.received_by_id} onChange={e => setHeader({...header, received_by_id: e.target.value})} required className="w-full rounded border-gray-300 p-2 border bg-white focus:ring-blue-500 transition"><option value="">Select Employee...</option>{users.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}</select></div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t pt-6">
              
              {/* Product Search Panel */}
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col h-[36rem]">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-md font-bold text-gray-800 mb-2">1. Find Products</h3>
                  <div className="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-md bg-white focus-within:ring-2 focus-within:ring-blue-500 transition cursor-text" onClick={() => document.getElementById('productSearchInput')?.focus()}>
                    {searchTags.map(tag => <span key={tag} className="flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-sm font-medium border border-blue-200 rounded-md">{tag}<button type="button" onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="ml-1 text-blue-500 hover:text-red-500 font-bold px-1 transition">×</button></span>)}
                    <input id="productSearchInput" type="text" placeholder="Type PID, Brand, SKU... Press Enter" value={currentInput} onChange={e => setCurrentInput(e.target.value)} onKeyDown={handleKeyDown} className="flex-grow outline-none text-sm bg-transparent min-w-[150px]" />
                  </div>
                </div>
                <div className="overflow-y-auto flex-grow p-2">
                  <ul className="space-y-2">
                    {filteredProducts.map(p => (
                      <li key={p.product_id} className="flex justify-between items-center p-3 hover:bg-blue-50 border border-gray-100 rounded transition group">
                        <div className="w-4/5 pr-2">
                            <div className="font-semibold text-gray-800 text-sm truncate">
                                <span className="font-mono text-gray-500 text-xs mr-2">[{p.pid}]</span>
                                {p.name}
                            </div>
                            <div className="text-xs text-gray-500 mt-1 flex gap-2">
                                <span>SKU: {p.sku || 'N/A'}</span>
                                <span className="text-blue-600 bg-blue-100 px-1.5 rounded">{p.units_per_bundle || 1}s</span>
                            </div>
                        </div>
                        <button type="button" onClick={() => addProductToCart(p)} className="px-3 py-1.5 bg-gray-100 text-blue-600 font-bold text-xs rounded border border-transparent hover:border-blue-600 hover:bg-blue-600 hover:text-white transition opacity-80 group-hover:opacity-100">+ Add</button>
                      </li>
                    ))}
                    {filteredProducts.length === 0 && (
                        <div className="text-center text-gray-400 text-sm italic mt-8">No products found matching those tags.</div>
                    )}
                  </ul>
                </div>
              </div>

              {/* Cart Panel */}
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col h-[36rem]">
                <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                  <h3 className="text-md font-bold text-gray-800">2. Transfer Items</h3>
                  <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2 py-1 rounded-full">{items.length} items</span>
                </div>
                <div className="overflow-y-auto flex-grow p-4 bg-gray-50 space-y-3">
                  {items.map((item, index) => {
                      const remainder = item.qty % item.upb;
                      return (
                        <div key={item.product_id} className="bg-white border border-gray-300 p-3 rounded shadow-sm relative transition-all hover:border-blue-400">
                          <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))} className="absolute top-2 right-2 text-gray-400 hover:text-red-600 font-bold px-1 transition bg-white">✖</button>
                          
                          <div className="pr-6 mb-3">
                              <div className="font-bold text-gray-800 text-sm truncate">{item.name}</div>
                              <div className="text-xs text-gray-500 mt-0.5 font-mono">PID: {item.pid} | Config: {item.upb}s</div>
                          </div>
                          
                          {/* BI-DIRECTIONAL INPUTS */}
                          <div className="flex gap-3 bg-gray-50 p-2 rounded border border-gray-100">
                            <div className="w-1/2">
                              <label className="block text-xs font-semibold text-gray-600 mb-1">Bundle Count</label>
                              <div className="relative">
                                  <input 
                                    type="number" 
                                    min="0" 
                                    value={item.bundle_count || ''} 
                                    onChange={e => handleBundleChange(index, e.target.value)} 
                                    className="w-full rounded border-gray-300 p-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 pr-8 transition" 
                                    placeholder="0" 
                                  />
                                  <span className="absolute right-2 top-1.5 text-gray-400 text-xs font-mono">BND</span>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-center pt-5 text-gray-400 font-bold">⇄</div>

                            <div className="w-1/2">
                              <label className="block text-xs font-bold text-blue-700 mb-1">Total Pieces *</label>
                              <input 
                                type="number" 
                                min="0" 
                                value={item.qty || ''} 
                                onChange={e => handleQtyChange(index, e.target.value)} 
                                required 
                                className="w-full rounded border-blue-300 p-1.5 text-sm text-right font-bold focus:ring-blue-500 focus:border-blue-500 transition shadow-sm bg-blue-50" 
                                placeholder="0" 
                              />
                            </div>
                          </div>
                          
                          {item.upb > 1 && (
                              <div className="text-right mt-1.5">
                                  <span className={`text-xs font-mono font-medium ${remainder > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                                      Math: {item.bundle_count} full + ({remainder}/{item.upb}) broken
                                  </span>
                              </div>
                          )}

                        </div>
                    )
                  })}
                  {items.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                          <span className="text-3xl">🛒</span>
                          <span className="text-sm italic">Search and add products to begin.</span>
                      </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex justify-between pt-6 border-t border-gray-200 mt-6">
          <button type="button" onClick={() => navigate('/transfers')} className="px-5 py-2.5 text-gray-700 font-medium hover:bg-red-50 hover:text-red-600 rounded-lg transition border border-transparent hover:border-red-200">
              Cancel
          </button>
          
          <div className="flex gap-3">
            <button type="button" onClick={(e) => handleSubmit(e, false)} disabled={saving || (!isBatchMode && items.length === 0)} className="px-6 py-2.5 bg-yellow-500 text-white rounded-lg font-bold shadow hover:bg-yellow-600 disabled:opacity-50 transition border border-yellow-600">
              {saving ? 'Saving...' : `Submit Pending ${isBatchMode ? 'Transfers' : 'Transfer'}`}
            </button>
            <button type="button" onClick={(e) => handleSubmit(e, true)} disabled={saving || (!isBatchMode && items.length === 0)} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold shadow hover:bg-blue-700 disabled:opacity-50 transition border border-blue-700" title="Instantly finalizes math and marks as COMPLETED">
              {saving ? 'Processing...' : `Process ${isBatchMode ? 'Transfers' : 'Transfer'}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}