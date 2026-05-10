// frontend/src/components/TransferReport.tsx
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { fetchTransfer, fetchProducts, fetchUsers, releaseTransfer, receiveTransfer, updateTransferHeader } from '../services/api';
import type { StockTransfer, Product, User } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function TransferReport() {
  const { user } = useAuth(); // Grab the logged-in user
  const isAdmin = user?.role === 'ADMIN'; // Check their role
  
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<User[]>([]); 
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // --- ADMIN EDIT STATE ---
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [headerData, setHeaderData] = useState({ document_id: '', released_by_id: 0, received_by_id: 0 });

  // State for Live Inputs
  const [actionItems, setActionItems] = useState<Record<number, number>>({});
  
  // State for Unexpected Items (The Wrong Item Scenario)
  const [unexpectedItems, setUnexpectedItems] = useState<{ product_id: number; received_qty: number; bundling: string }[]>([]);
  const [selectedNewProduct, setSelectedNewProduct] = useState('');

  useEffect(() => {
    if (id) {
      Promise.all([fetchTransfer(id), fetchProducts(), fetchUsers()]).then(([tData, pData, uData]) => {
        setTransfer(tData);
        setProducts(pData);
        setUsers(uData);
        
        // Prep the Admin Edit State
        setHeaderData({
          document_id: tData.document_id || '',
          released_by_id: tData.released_by?.user_id || 0,
          received_by_id: tData.received_by?.user_id || 0
        });

        // Auto-fill inputs with the expected quantities to save typing
        const initialInputs: Record<number, number> = {};
        tData.items.forEach(item => {
          if (tData.status === 'REQUESTED') initialInputs[item.item_id] = item.requested_qty;
          if (tData.status === 'IN_TRANSIT') initialInputs[item.item_id] = item.released_qty || item.requested_qty;
        });
        setActionItems(initialInputs);
        setLoading(false);
      }).catch(err => {
        console.error(err);
        setLoading(false);
      });
    }
  }, [id]);

  // Handlers
  const handleItemChange = (itemId: number, val: string) => setActionItems(prev => ({ ...prev, [itemId]: Number(val) }));

  const addUnexpectedItem = () => {
    if (!selectedNewProduct) return;
    setUnexpectedItems([...unexpectedItems, { product_id: Number(selectedNewProduct), received_qty: 1, bundling: '' }]);
    setSelectedNewProduct('');
  };

  const updateUnexpectedItem = (index: number, field: string, val: string | number) => {
    const newArr = [...unexpectedItems];
    newArr[index] = { ...newArr[index], [field]: val };
    setUnexpectedItems(newArr);
  };

  // --- SAVE EDITED HEADER ---
  const handleSaveHeader = async () => {
    if (!transfer) return;
    setProcessing(true);
    try {
      const updatedTransfer = await updateTransferHeader(transfer.transfer_id, {
        document_id: headerData.document_id || undefined,
        released_by_id: headerData.released_by_id || undefined,
        received_by_id: headerData.received_by_id || undefined
      });
      setTransfer(updatedTransfer); // Update UI without reloading
      setIsEditingHeader(false);
    } catch (error) {
      alert("Failed to update header details.");
    } finally {
      setProcessing(false);
    }
  };

  const handleAction = async () => {
    if (!transfer) return;
    setProcessing(true);
    try {
      if (transfer.status === 'REQUESTED') {
        await releaseTransfer(transfer.transfer_id, actionItems);
      } else if (transfer.status === 'IN_TRANSIT') {
        await receiveTransfer(transfer.transfer_id, actionItems, unexpectedItems);
      }
      window.location.reload();
    } catch (error) {
      alert("Failed to process document.");
    } finally {
      setProcessing(false);
    }
  };

  // Helper function to format the strict bundle string: "2 + (1/12)"
  const formatBundleText = (bundles: number, remainder: number, upb: number) => {
    if (upb <= 1) return '-'; 
    if (remainder === 0) return `${bundles}`; 
    return `${bundles} + (${remainder}/${upb})`; 
  };

  if (loading) return <div className="p-8 text-center text-gray-500 mt-10 font-medium">Loading Document...</div>;
  if (!transfer) return <div className="p-8 text-center text-red-500 mt-10 font-bold">Transfer not found.</div>;

  return (
    <div className="max-w-6xl mx-auto mt-8 px-4 mb-20">
      <div className="mb-6">
        <button onClick={() => navigate('/transfers')} className="text-blue-600 hover:underline font-medium text-sm transition">← Back to Overview</button>
      </div>

      <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
        
        {/* HEADER */}
        <div className="bg-gray-50 p-6 border-b border-gray-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">
                  TRN-{String(transfer.transfer_id).padStart(5, '0')}
                </h2>
                {/* ADMIN EDIT BUTTON */}
                {isAdmin && !isEditingHeader && transfer.status !== 'COMPLETED' && (
                  <button onClick={() => setIsEditingHeader(true)} className="text-xs bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-1 rounded hover:bg-yellow-200 font-bold transition shadow-sm">
                    ✎ Edit Header
                  </button>
                )}
              </div>
              
              {/* CONDITIONAL RENDER: STATIC VS EDIT MODE */}
              {isEditingHeader ? (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">Ref:</span>
                  <input type="text" value={headerData.document_id} onChange={e => setHeaderData({...headerData, document_id: e.target.value})} className="p-1.5 text-sm border border-blue-300 focus:ring-blue-500 rounded w-64 shadow-sm" placeholder="Document ID" />
                </div>
              ) : (
                <p className="text-gray-500 font-mono mt-1 text-sm">Ref: {transfer.document_id || 'N/A'}</p>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <span className={`px-4 py-1.5 rounded-md text-sm font-bold shadow-sm border ${
                transfer.status === 'REQUESTED' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                transfer.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                'bg-green-100 text-green-800 border-green-200'
              }`}>
                {transfer.status}
              </span>
              {transfer.has_discrepancy && (
                <span className="px-3 py-1 rounded-md text-xs font-bold bg-red-100 text-red-800 border border-red-200 shadow-sm">
                  ⚠️ Discrepancy Flagged
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6 p-4 bg-white rounded border shadow-sm">
            <div><p className="text-xs text-gray-400 font-bold uppercase mb-1">Date</p><p className="font-medium text-gray-800">{new Date(transfer.transfer_date).toLocaleDateString()}</p></div>
            <div><p className="text-xs text-gray-400 font-bold uppercase mb-1">Route</p><p className="font-bold text-blue-700">{transfer.from_location?.name} → {transfer.to_location?.name}</p></div>
            
            {/* CONDITIONAL RENDER: RELEASED BY */}
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase mb-1">Released By</p>
              {isEditingHeader ? (
                <select value={headerData.released_by_id} onChange={e => setHeaderData({...headerData, released_by_id: Number(e.target.value)})} className="p-1.5 text-sm border border-blue-300 focus:ring-blue-500 rounded w-full shadow-sm">
                  <option value={0}>Unknown</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}
                </select>
              ) : (
                <p className="font-medium text-gray-800">{transfer.released_by?.username || 'Unknown'}</p>
              )}
            </div>

            {/* CONDITIONAL RENDER: RECEIVED BY */}
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase mb-1">Received By</p>
              {isEditingHeader ? (
                <select value={headerData.received_by_id} onChange={e => setHeaderData({...headerData, received_by_id: Number(e.target.value)})} className="p-1.5 text-sm border border-blue-300 focus:ring-blue-500 rounded w-full shadow-sm">
                  <option value={0}>Unknown</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}
                </select>
              ) : (
                <p className="font-medium text-gray-800">{transfer.received_by?.username || 'Pending...'}</p>
              )}
            </div>
          </div>

          {/* SAVE/CANCEL BUTTONS FOR EDIT MODE */}
          {isEditingHeader && (
            <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setIsEditingHeader(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded font-bold transition">Cancel</button>
              <button onClick={handleSaveHeader} disabled={processing} className="px-4 py-2 text-sm bg-blue-600 text-white rounded font-bold shadow hover:bg-blue-700 transition">Save Changes</button>
            </div>
          )}

        </div>

        {/* ITEMS TABLE */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-800 text-white">
              <tr>
                <th rowSpan={2} className="px-4 py-3 font-semibold align-bottom border-b-2 border-gray-900">PID</th>
                <th rowSpan={2} className="px-4 py-3 font-semibold align-bottom border-b-2 border-gray-900">Product Description</th>
                <th rowSpan={2} className="px-4 py-3 font-semibold text-center w-24 align-bottom border-b-2 border-gray-900">Config</th>
                
                <th colSpan={2} className="px-4 py-2 font-bold text-center border-l border-b border-gray-600 bg-gray-700 text-orange-100 tracking-wider">RELEASED</th>
                <th colSpan={2} className="px-4 py-2 font-bold text-center border-l border-b border-gray-600 bg-gray-700 text-green-100 tracking-wider">RECEIVED</th>
              </tr>
              <tr>
                <th className="px-4 py-2 font-semibold text-center border-l border-b-2 border-gray-900 border-l-gray-600 bg-gray-700/80 text-xs text-orange-200 w-28">Bundles</th>
                <th className="px-4 py-2 font-semibold text-center border-b-2 border-gray-900 bg-gray-700/80 text-xs text-orange-200 w-28">Pieces</th>
                
                <th className="px-4 py-2 font-semibold text-center border-l border-b-2 border-gray-900 border-l-gray-600 bg-gray-700/80 text-xs text-green-200 w-28">Bundles</th>
                <th className="px-4 py-2 font-semibold text-center border-b-2 border-gray-900 bg-gray-700/80 text-xs text-green-200 w-28">Pieces</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transfer.items.map((item) => {
                const upb = item.product?.units_per_bundle || 1;
                
                // Static DB values
                const relQty = item.released_qty || 0;
                const rcvQty = item.received_qty || 0;

                // Live Input Math (what the user is currently typing)
                const currentActionQty = actionItems[item.item_id] ?? 0;
                const actionBundles = Math.floor(currentActionQty / upb);
                const actionRem = currentActionQty % upb;

                // Display logic based on current transfer status
                const displayRelBundles = transfer.status === 'REQUESTED' ? actionBundles : Math.floor(relQty / upb);
                const displayRelRem = transfer.status === 'REQUESTED' ? actionRem : relQty % upb;

                const displayRcvBundles = transfer.status === 'IN_TRANSIT' ? actionBundles : Math.floor(rcvQty / upb);
                const displayRcvRem = transfer.status === 'IN_TRANSIT' ? actionRem : rcvQty % upb;

                return (
                  <tr key={item.item_id} className={item.requested_qty === 0 ? "bg-red-50" : "hover:bg-gray-50 transition"}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 font-bold">{item.product?.pid}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-800">
                        {item.product?.name} 
                        {item.requested_qty === 0 && <span className="ml-2 text-xs text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded border border-red-200">Unexpected</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">SKU: {item.product?.sku || 'N/A'}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono border text-gray-600">{upb}s</span>
                    </td>
                    
                    {/* --- RELEASED COLUMNS --- */}
                    <td className="px-4 py-3 text-center border-l bg-orange-50/40">
                      <span className={`font-mono text-sm ${displayRelRem > 0 ? 'text-orange-600 font-bold' : 'text-gray-600'}`}>
                        {formatBundleText(displayRelBundles, displayRelRem, upb)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center bg-orange-50/40">
                      {transfer.status === 'REQUESTED' ? (
                        <input type="number" min="0" value={actionItems[item.item_id] ?? 0} onChange={e => handleItemChange(item.item_id, e.target.value)} className="w-20 p-1 text-center border border-orange-400 rounded bg-white focus:ring-orange-500 font-bold shadow-sm" />
                      ) : (
                        <span className="font-bold text-gray-800 text-base">{relQty}</span>
                      )}
                    </td>
                    
                    {/* --- RECEIVED COLUMNS --- */}
                    <td className="px-4 py-3 text-center border-l bg-green-50/40">
                      <span className={`font-mono text-sm ${displayRcvRem > 0 ? 'text-orange-600 font-bold' : 'text-gray-600'}`}>
                        {formatBundleText(displayRcvBundles, displayRcvRem, upb)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center bg-green-50/40">
                      {transfer.status === 'IN_TRANSIT' ? (
                        <input type="number" min="0" value={actionItems[item.item_id] ?? 0} onChange={e => handleItemChange(item.item_id, e.target.value)} className="w-20 p-1 text-center border border-green-400 rounded bg-white focus:ring-green-500 font-bold shadow-sm" />
                      ) : (
                        <span className="font-bold text-gray-800 text-base">{rcvQty}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              
              {/* UNEXPECTED ITEMS ENTRY ZONE (Only visible during receipt) */}
              {transfer.status === 'IN_TRANSIT' && unexpectedItems.map((uItem, idx) => {
                const prod = products.find(p => p.product_id === uItem.product_id);
                const upb = prod?.units_per_bundle || 1;
                const rcvQty = uItem.received_qty || 0;
                const rcvBundles = Math.floor(rcvQty / upb);
                const rcvRem = rcvQty % upb;

                return (
                  <tr key={`new-${idx}`} className="bg-red-50/50 border-l-4 border-l-red-500 transition">
                    <td className="px-4 py-3 font-mono text-xs text-red-700 font-bold">{prod?.pid}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-red-800">{prod?.name} <span className="text-xs ml-2 bg-red-200 text-red-800 px-2 py-0.5 rounded font-bold">Adding...</span></div>
                      <input type="text" placeholder="Note (Optional)" value={uItem.bundling} onChange={e => updateUnexpectedItem(idx, 'bundling', e.target.value)} className="mt-1 w-full p-1 text-xs border border-red-300 rounded shadow-sm outline-none focus:border-red-500" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-red-100 px-2 py-0.5 rounded text-xs font-mono border border-red-200 text-red-700">{upb}s</span>
                    </td>
                    <td className="px-4 py-3 text-center border-l bg-orange-50/20 text-gray-400 font-mono text-sm">-</td>
                    <td className="px-4 py-3 text-center bg-orange-50/20 text-gray-400 font-bold">0</td>
                    
                    <td className="px-4 py-3 text-center border-l bg-green-50/40">
                       <span className={`font-mono text-sm ${rcvRem > 0 ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                        {formatBundleText(rcvBundles, rcvRem, upb)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center bg-green-50/40">
                      <input type="number" min="1" value={uItem.received_qty} onChange={e => updateUnexpectedItem(idx, 'received_qty', e.target.value)} className="w-20 p-1 text-center border border-red-400 rounded bg-white focus:ring-red-500 font-bold shadow-sm text-red-700" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ADD UNEXPECTED ITEM TOOLBAR */}
          {transfer.status === 'IN_TRANSIT' && (
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center gap-3">
              <span className="text-sm font-bold text-gray-700">Wrong item arrived?</span>
              <select value={selectedNewProduct} onChange={e => setSelectedNewProduct(e.target.value)} className="p-2 border border-gray-300 rounded text-sm w-72 shadow-sm focus:ring-blue-500">
                <option value="">Select Unexpected Product...</option>
                {products.map(p => <option key={p.product_id} value={p.product_id}>[{p.pid}] {p.name}</option>)}
              </select>
              <button onClick={addUnexpectedItem} disabled={!selectedNewProduct} className="px-4 py-2 bg-white border border-gray-300 text-gray-800 text-sm font-bold rounded shadow-sm hover:bg-gray-100 disabled:opacity-50 transition">
                + Add Extra Row
              </button>
            </div>
          )}
        </div>

        {/* WORKFLOW ACTION BAR */}
        {transfer.status !== 'COMPLETED' && (
          <div className="bg-gray-100 p-6 border-t border-gray-200 flex justify-end">
            <button onClick={handleAction} disabled={processing} className={`px-8 py-3 rounded-lg font-bold text-white shadow-md transition ${transfer.status === 'REQUESTED' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'}`}>
              {processing ? 'Processing...' : transfer.status === 'REQUESTED' ? 'Confirm Items Released' : 'Confirm Items Received'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}