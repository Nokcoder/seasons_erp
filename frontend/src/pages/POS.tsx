// frontend/src/pages/POS.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchProducts, fetchLocations, createSale, fetchPosSettings } from '../services/api';

interface CartItem {
  product_id: number;
  pid: string;
  name: string;
  brand: string;
  sku: string;
  net_cost: number;
  price: number;
  qty: number;
  discount_pct: number;
  discount_flat: number;
}

export default function POS() {
  const { user } = useAuth();

  // --- ROBUST AUTH CHECK ---
  const isBackdateAllowed = useMemo(() => {
    if (!user) return false;
    const role = String(user.role || user.user_type || '').toUpperCase();
    const name = String(user.username || '').toLowerCase();
    return (
      role === 'ADMIN' || 
      role === 'OFFICE_CLERK' || 
      name === 'admin' || 
      user.is_superuser === true
    );
  }, [user]);

  // --- UI MODE STATE ---
  const [mode, setMode] = useState<'LIVE' | 'BATCH'>('LIVE');

  useEffect(() => {
    if (isBackdateAllowed) {
      setMode('BATCH');
    }
  }, [isBackdateAllowed]);

  // --- MASTER DATA & SETTINGS ---
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [posSettings, setPosSettings] = useState({ is_vat_enabled: false, vat_rate: 0.12 });
  const [searchQuery, setSearchQuery] = useState('');

  // --- BATCH ENTRY SPECIFIC STATE ---
  const [batchInput, setBatchInput] = useState({ pid: '', qty: 1, discount_pct: 0, discount_flat: 0 });
  const batchPidRef = useRef<HTMLInputElement>(null);

  // --- TRANSACTION STATE ---
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payments, setPayments] = useState([{ method: 'Cash', amount: 0 }]);
  const [receiptDiscount, setReceiptDiscount] = useState<number>(0);
  
  // FIX 1: Use en-CA to safely grab the local timezone YYYY-MM-DD (prevents UTC shift bugs)
  const localToday = new Date().toLocaleDateString('en-CA');

  const [header, setHeader] = useState({
    date: localToday,
    shift: '1', 
    sales_invoice_id: '',
    delivery_receipt_id: '',
    customer_name: '',
    register_id: 'REG-01', 
    location_id: '',
  });

  const [parkedSales, setParkedSales] = useState<any[]>([]);
  const [showParkedModal, setShowParkedModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  // --- DRAG TO COPY STATE ---
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);

  // Global mouse up to stop dragging if they let go of the mouse outside the table
  useEffect(() => {
    const handleGlobalMouseUp = () => setDragSourceIdx(null);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // --- INITIALIZATION ---
  useEffect(() => {
    Promise.all([fetchProducts(), fetchLocations(), fetchPosSettings()]).then(([pData, lData, sData]) => {
      setProducts(pData);
      setLocations(lData);
      if (sData) setPosSettings(sData);
    });

    const stickyDate = localStorage.getItem('pos_sticky_date');
    const stickyLoc = localStorage.getItem('pos_sticky_loc');
    const stickyReg = localStorage.getItem('pos_sticky_reg');
    
    if (isBackdateAllowed) {
      setHeader(prev => ({ 
        ...prev, 
        date: stickyDate || prev.date,
        location_id: stickyLoc || prev.location_id,
        register_id: stickyReg || prev.register_id
      }));
    }
  }, [isBackdateAllowed]);

  // --- FINANCIAL MATH ---
  const rawCartTotal = cart.reduce((sum, item) => {
    const pctAmt = item.price * ((item.discount_pct || 0) / 100);
    const totalItemDisc = pctAmt + (item.discount_flat || 0);
    const finalPrice = Math.max(0, item.price - totalItemDisc);
    return sum + (finalPrice * item.qty);
  }, 0);
  
  const grandTotal = Math.max(0, rawCartTotal - receiptDiscount);

  let vatableSales = grandTotal;
  let taxAmount = 0;
  
  if (posSettings.is_vat_enabled) {
      vatableSales = grandTotal / (1 + posSettings.vat_rate);
      taxAmount = grandTotal - vatableSales;
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = grandTotal - totalPaid;

  useEffect(() => {
    if (mode === 'BATCH') {
      setPayments([{ method: 'Cash', amount: grandTotal }]);
    }
  }, [grandTotal, mode]);

  // --- HANDLERS ---
  const handleHeaderChange = (field: string, val: string) => {
    setHeader(prev => ({ ...prev, [field]: val }));
    if (isBackdateAllowed) {
      if (field === 'date') localStorage.setItem('pos_sticky_date', val);
      if (field === 'location_id') localStorage.setItem('pos_sticky_loc', val);
      if (field === 'register_id') localStorage.setItem('pos_sticky_reg', val);
    }
  };

  const addToCart = (p: any, forcedQty: number = 1, forcedPct: number = 0, forcedFlat: number = 0) => {
    const existingIdx = cart.findIndex(item => item.product_id === p.product_id);
    if (existingIdx >= 0) {
      const newCart = [...cart];
      newCart[existingIdx].qty += forcedQty;
      newCart[existingIdx].discount_pct = forcedPct || newCart[existingIdx].discount_pct;
      newCart[existingIdx].discount_flat = forcedFlat || newCart[existingIdx].discount_flat;
      setCart(newCart);
    } else {
      const netCost = Number(p.gross_cost || 0) * (1 - (Number(p.cost_discount || 0) / 100));
      const activePrice = Number(p.net_price) || Number(p.tag_price) || 0;

      setCart([...cart, {
        product_id: p.product_id, pid: p.pid, name: p.name, brand: p.brand || '', sku: p.sku || '',
        net_cost: netCost, price: activePrice, qty: forcedQty, discount_pct: forcedPct, discount_flat: forcedFlat
      }]);
    }
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || mode === 'BATCH') return [];
    const q = searchQuery.toLowerCase().replace(/[\s-]/g, '');
    return products.filter(p => `${p.pid} ${p.sku} ${p.name} ${p.brand}`.toLowerCase().replace(/[\s-]/g, '').includes(q)).slice(0, 5);
  }, [searchQuery, products, mode]);

  const handleBatchSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = batchInput.pid.toLowerCase().replace(/[\s-]/g, '');
      const product = products.find(p => p.pid.toLowerCase().replace(/[\s-]/g, '') === q || (p.sku && p.sku.toLowerCase().replace(/[\s-]/g, '') === q));
      
      if (product) {
        addToCart(product, Number(batchInput.qty), Number(batchInput.discount_pct), Number(batchInput.discount_flat));
        setBatchInput({ pid: '', qty: 1, discount_pct: 0, discount_flat: 0 }); 
        setTimeout(() => batchPidRef.current?.focus(), 50); 
      } else {
        alert("Product PID/SKU not found.");
      }
    }
  };

  const removeCartItem = (index: number) => setCart(cart.filter((_, i) => i !== index));

  // --- ADVANCED DISCOUNT SPREADING LOGIC ---
  const copyDiscountDownOne = (startIndex: number) => {
    if (startIndex >= cart.length - 1) return;
    const newCart = [...cart];
    newCart[startIndex + 1].discount_pct = newCart[startIndex].discount_pct;
    newCart[startIndex + 1].discount_flat = newCart[startIndex].discount_flat;
    setCart(newCart);
  };

  const copyDiscountToAllBelow = (startIndex: number) => {
    if (startIndex >= cart.length - 1) return;
    const newCart = [...cart];
    const sourcePct = newCart[startIndex].discount_pct;
    const sourceFlat = newCart[startIndex].discount_flat;
    for (let i = startIndex + 1; i < newCart.length; i++) {
      newCart[i].discount_pct = sourcePct;
      newCart[i].discount_flat = sourceFlat;
    }
    setCart(newCart);
  };

  const handleDragEnterRow = (targetIndex: number) => {
    if (dragSourceIdx === null || dragSourceIdx === targetIndex) return;
    const newCart = [...cart];
    newCart[targetIndex].discount_pct = newCart[dragSourceIdx].discount_pct;
    newCart[targetIndex].discount_flat = newCart[dragSourceIdx].discount_flat;
    setCart(newCart);
  };

  const parkTransaction = () => {
    if (cart.length === 0) return alert("Cart is empty.");
    const ref = prompt("Enter reference for parked sale:");
    if (!ref) return;
    setParkedSales([...parkedSales, { id: Date.now().toString(), refName: ref, header: { ...header }, cart: [...cart], payments: [...payments] }]);
    setCart([]); setPayments([{ method: 'Cash', amount: 0 }]);
    setHeader({ ...header, sales_invoice_id: '', delivery_receipt_id: '', customer_name: '' });
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return alert("Cart is empty.");
    if (balanceDue > 0 && mode === 'LIVE') return alert("Balance must be fully paid before checking out.");
    if (!header.location_id) return alert("Please select a location/store.");

    const cashierId = user?.user_id || user?.id || user?.userId || 1;

    setProcessing(true);
    try {
      const payload = { 
        header: { 
          location_id: Number(header.location_id),
          cashier_id: Number(cashierId), 
          date: header.date,
          shift: header.shift,
          sales_invoice_id: header.sales_invoice_id || null,
          delivery_receipt_id: header.delivery_receipt_id || null,
          subtotal_amount: Number(vatableSales.toFixed(2)),
          discount_amount: Number(receiptDiscount.toFixed(2)),
          tax_amount: Number(taxAmount.toFixed(2)),
          total_amount: Number(grandTotal.toFixed(2)),
          customer_id: null,
          customer_name: header.customer_name || null,
          register_id: header.register_id,
          idempotency_key: crypto.randomUUID()
        }, 
        items: cart.map(item => ({
          product_id: Number(item.product_id),
          qty: Number(item.qty),
          price: Number(item.price.toFixed(2)),
          discount_pct: Number((item.discount_pct || 0).toFixed(2)),
          discount_flat: Number((item.discount_flat || 0).toFixed(2)),
          net_cost: Number(item.net_cost.toFixed(2))
        })),
        payments: payments
          .filter(p => Number(p.amount) > 0)
          .map(p => ({
            method: p.method,
            amount: Number(Number(p.amount).toFixed(2))
          }))
      };
      
      const result = await createSale(payload);
      alert(`Sale Completed! Receipt #: ${result.document_id}`);
      
      setCart([]);
      setReceiptDiscount(0);
      setPayments([{ method: 'Cash', amount: 0 }]);
      // Note: We deliberately leave date and location intact here so it stays sticky!
      setHeader(prev => ({ ...prev, sales_invoice_id: '', delivery_receipt_id: '', customer_name: '' }));
      
      if (mode === 'BATCH') {
        document.getElementById('sales_invoice_input')?.focus();
      }
    } catch (err: any) {
      alert(err.message || "Checkout failed.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pt-4 px-4 pb-10">
      
      {/* TOP NAVBAR */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-white p-4 rounded-lg shadow-sm mb-4 gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-800 tracking-tight">Point of Sale</h2>
          <p className="text-sm text-gray-500 font-medium mt-1">Operator: <span className="text-blue-600">{user?.username}</span> | Reg: {header.register_id}</p>
        </div>

        {isBackdateAllowed && (
          <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
            <button onClick={() => setMode('LIVE')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition ${mode === 'LIVE' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              🏬 Live Register
            </button>
            <button onClick={() => setMode('BATCH')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition ${mode === 'BATCH' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              ⌨️ Batch Entry
            </button>
          </div>
        )}

        {mode === 'LIVE' && (
          <div className="flex items-center gap-4">
            <button onClick={() => setShowParkedModal(true)} className="px-4 py-2 bg-yellow-100 text-yellow-800 font-bold border border-yellow-300 rounded shadow-sm hover:bg-yellow-200">
              P {parkedSales.length > 0 && <span className="bg-red-500 text-white rounded-full px-2 py-0.5 text-xs ml-1">{parkedSales.length}</span>}
            </button>
            <button onClick={parkTransaction} className="px-4 py-2 bg-gray-200 text-gray-700 font-bold rounded shadow-sm hover:bg-gray-300">Park Sale ⏸</button>
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 h-full">
        <div className={`w-full ${mode === 'LIVE' ? 'lg:w-2/3' : 'lg:w-3/4'} flex flex-col gap-4`}>
          
          {/* HEADER METADATA */}
          <div className={`bg-white p-4 rounded-lg shadow-sm grid grid-cols-2 md:grid-cols-5 gap-4 border-l-4 ${mode === 'BATCH' ? 'border-purple-500 bg-purple-50/10' : 'border-blue-500'}`}>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Location *</label>
              <select value={header.location_id} onChange={e => handleHeaderChange('location_id', e.target.value)} className="w-full p-2 border rounded text-sm font-bold focus:ring-blue-500 bg-white">
                <option value="">Select Store/Warehouse...</option>
                {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              {/* FIX 2: Unlocked the date input for Admins regardless of LIVE/BATCH mode */}
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Date {isBackdateAllowed ? '(Override)' : ''}
              </label>
              <input 
                type="date" 
                value={header.date} 
                onChange={e => handleHeaderChange('date', e.target.value)} 
                disabled={!isBackdateAllowed} 
                className={`w-full p-2 border rounded text-sm focus:ring-blue-500 ${!isBackdateAllowed ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Shift</label>
              <input type="number" min="1" max="10" value={header.shift} onChange={e => handleHeaderChange('shift', e.target.value)} className="w-full p-2 border rounded text-sm focus:ring-blue-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Register ID</label>
              <input type="text" value={header.register_id} onChange={e => handleHeaderChange('register_id', e.target.value)} disabled={!isBackdateAllowed} className={`w-full p-2 border rounded text-sm focus:ring-blue-500 ${!isBackdateAllowed ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}/>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Customer Name</label>
              <input type="text" placeholder="Walk-in" value={header.customer_name} onChange={e => handleHeaderChange('customer_name', e.target.value)} className="w-full p-2 border rounded text-sm focus:ring-blue-500"/>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sales Invoice #</label>
              <input id="sales_invoice_input" type="text" value={header.sales_invoice_id} onChange={e => handleHeaderChange('sales_invoice_id', e.target.value)} className="w-full p-2 border border-blue-300 rounded text-sm font-bold focus:ring-blue-500 shadow-inner"/>
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Delivery Receipt #</label>
              <input type="text" value={header.delivery_receipt_id} onChange={e => handleHeaderChange('delivery_receipt_id', e.target.value)} className="w-full p-2 border rounded text-sm focus:ring-blue-500"/>
            </div>
          </div>

          {mode === 'LIVE' && (
            <div className="relative bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center p-3">
                <span className="text-xl mr-3">🔍</span>
                <input type="text" placeholder="Scan Barcode or Search..." value={searchQuery} onChange={e => {setSearchQuery(e.target.value);}} className="w-full outline-none text-lg font-medium"/>
              </div>
              {searchResults.length > 0 && (
                <div className="absolute z-20 w-full bg-white shadow-xl border rounded-b-lg top-full left-0 overflow-hidden">
                  {searchResults.map((p: any) => (
                    <div key={p.product_id} onClick={() => {addToCart(p); setSearchQuery('');}} className="p-4 hover:bg-blue-50 cursor-pointer border-b flex justify-between items-center transition">
                      <div><span className="font-mono text-gray-500 text-xs mr-2">[{p.pid}]</span><span className="font-bold text-gray-800">{p.name}</span></div>
                      <span className="font-bold text-green-700">{Number(p.net_price || p.tag_price || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex-grow flex flex-col overflow-hidden min-h-[400px]">
            <div className="overflow-auto flex-grow">
              <table className="min-w-full text-left text-sm whitespace-nowrap">
                <thead className={`${mode === 'BATCH' ? 'bg-purple-800' : 'bg-gray-800'} text-white sticky top-0 z-10 transition-colors`}>
                  <tr>
                    <th className="px-3 py-3 w-10"></th>
                    <th className="px-3 py-3">Item / PID</th>
                    <th className="px-3 py-3 text-right">Unit Price</th>
                    <th className="px-3 py-3 text-center w-24">Qty</th>
                    <th className="px-3 py-3 text-right w-40">Discount (% & Flat)</th>
                    <th className="px-3 py-3 text-right font-bold w-32">Subtotal</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-gray-100 ${dragSourceIdx !== null ? 'cursor-grabbing' : ''}`}>
                  {cart.map((item, idx) => (
                    <tr 
                      key={`${item.product_id}-${idx}`} 
                      className={`hover:bg-gray-50 group ${dragSourceIdx === idx ? 'bg-blue-50' : ''}`}
                      onMouseEnter={() => handleDragEnterRow(idx)}
                    >
                      <td className="px-3 py-3 text-center"><button onClick={() => removeCartItem(idx)} className="text-gray-300 hover:text-red-500 font-bold">✖</button></td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-gray-900">{item.name}</div>
                        <div className="text-xs text-gray-500 font-mono">[{item.pid}]</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-600 font-medium">{item.price.toFixed(2)}</td>
                      <td className="px-3 py-3 text-center">
                        <input type="number" min="1" value={item.qty || ''} onChange={e => {const newCart = [...cart]; newCart[idx].qty = Number(e.target.value); setCart(newCart);}} className="w-full p-1.5 border border-gray-300 rounded text-center font-bold focus:ring-blue-500" />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input type="number" min="0" max="100" value={item.discount_pct || ''} onChange={e => {const newCart = [...cart]; newCart[idx].discount_pct = Number(e.target.value); setCart(newCart);}} className="w-16 p-1.5 border border-gray-300 rounded text-right font-medium text-orange-600 focus:ring-blue-500" placeholder="%"/>
                          <input type="number" min="0" step="0.01" value={item.discount_flat || ''} onChange={e => {const newCart = [...cart]; newCart[idx].discount_flat = Number(e.target.value); setCart(newCart);}} className="w-20 p-1.5 border border-gray-300 rounded text-right font-medium text-red-600 focus:ring-blue-500" placeholder="Flat"/>
                          
                          {/* THE UPGRADED DRAG/CLICK HANDLE */}
                          {idx < cart.length - 1 && (
                            <button 
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setDragSourceIdx(idx);
                              }}
                              onClick={() => copyDiscountDownOne(idx)}
                              onDoubleClick={() => copyDiscountToAllBelow(idx)}
                              title="Drag down | Click: 1 row | Dbl-Click: All rows" 
                              className="p-1.5 text-blue-500 hover:bg-blue-100 hover:text-blue-700 rounded opacity-0 group-hover:opacity-100 transition-all font-bold cursor-grab active:cursor-grabbing select-none"
                            >
                              ⏬
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-black text-gray-800 text-base tabular-nums">
                        {Math.max(0, ((item.price - (item.price * ((item.discount_pct || 0) / 100))) - (item.discount_flat || 0)) * item.qty).toFixed(2)}
                      </td>
                    </tr>
                  ))}

                  {mode === 'BATCH' && (
                    <tr className="bg-purple-50/30 border-b-2 border-purple-200">
                      <td className="px-3 py-3 text-center text-purple-300">⌨️</td>
                      <td className="px-3 py-3">
                        <input ref={batchPidRef} type="text" placeholder="PID + Enter" value={batchInput.pid} onChange={e => setBatchInput({...batchInput, pid: e.target.value})} onKeyDown={handleBatchSubmit} className="w-full p-1.5 border border-purple-300 rounded font-mono text-sm shadow-inner uppercase"/>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-400 italic">Auto</td>
                      <td className="px-3 py-3 text-center">
                        <input type="number" min="1" value={batchInput.qty} onChange={e => setBatchInput({...batchInput, qty: Number(e.target.value)})} onKeyDown={handleBatchSubmit} className="w-full p-1.5 border border-purple-300 rounded text-center font-bold" />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input type="number" value={batchInput.discount_pct || ''} onChange={e => setBatchInput({...batchInput, discount_pct: Number(e.target.value)})} onKeyDown={handleBatchSubmit} className="w-16 p-1.5 border border-purple-300 rounded text-right text-orange-600" placeholder="%"/>
                          <input type="number" value={batchInput.discount_flat || ''} onChange={e => setBatchInput({...batchInput, discount_flat: Number(e.target.value)})} onKeyDown={handleBatchSubmit} className="w-20 p-1.5 border border-purple-300 rounded text-right text-red-600" placeholder="Flat"/>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-400 italic">Auto</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="bg-gray-50 p-4 border-t border-gray-200 mt-auto">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Subtotal (Vatable)</span>
                <span>{vatableSales.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Receipt Discount</span>
                <input type="number" className="w-32 p-1 border border-gray-300 rounded text-right" value={receiptDiscount} onChange={e => setReceiptDiscount(Number(e.target.value))} min="0"/>
              </div>
              {posSettings.is_vat_enabled && (
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>VAT ({(posSettings.vat_rate * 100).toFixed(0)}%)</span>
                  <span>{taxAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl font-black text-gray-900 mt-2 border-t border-gray-300 pt-2">
                <span>Amount Due</span>
                <span>{grandTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={`w-full ${mode === 'LIVE' ? 'lg:w-1/3' : 'lg:w-1/4'} flex flex-col gap-4`}>
          <div className={`${mode === 'BATCH' ? 'bg-purple-900' : 'bg-gray-800'} text-white p-6 rounded-lg shadow-sm flex flex-col justify-center items-end`}>
            <span className="text-gray-400 font-bold uppercase tracking-wider text-sm mb-1">Total Amount</span>
            <span className="text-4xl lg:text-5xl font-black tracking-tighter tabular-nums">{grandTotal.toFixed(2)}</span>
          </div>

          <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex-grow flex flex-col">
            <h3 className="font-bold text-gray-800 mb-4 border-b pb-2">Payment Details</h3>
            <div className="flex-grow space-y-3 overflow-y-auto">
              {payments.map((pay, idx) => (
                <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded border border-gray-100">
                  <select value={pay.method} onChange={e => {const np = [...payments]; np[idx].method = e.target.value; setPayments(np);}} className="p-2 border rounded font-medium text-sm w-1/2 bg-white">
                    <option value="Cash">Cash</option>
                    <option value="GCash">GCash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Account">Charge to Account</option>
                  </select>
                  <div className="relative w-1/2">
                    <input type="number" step="0.01" value={pay.amount || ''} onChange={e => {const np = [...payments]; np[idx].amount = Number(e.target.value); setPayments(np);}} className="w-full p-2 border rounded text-right font-bold focus:ring-blue-500 bg-white" placeholder="0.00" disabled={mode === 'BATCH'} />
                  </div>
                  {mode === 'LIVE' && payments.length > 1 && (
                    <button onClick={() => setPayments(payments.filter((_, i) => i !== idx))} className="px-2 text-red-400 font-bold">✖</button>
                  )}
                </div>
              ))}
            </div>

            {mode === 'LIVE' && (
              <button onClick={() => setPayments([...payments, { method: 'GCash', amount: Math.max(0, balanceDue) }])} disabled={balanceDue <= 0} className="w-full py-2 mt-4 border border-dashed border-blue-400 text-blue-600 font-bold rounded hover:bg-blue-50 disabled:opacity-50">+ Split Payment</button>
            )}

            <div className="mt-6 pt-4 border-t-2 border-dashed">
              <div className="flex justify-between items-center text-gray-500 font-medium mb-1">
                <span>Total Paid:</span><span>{totalPaid.toFixed(2)}</span>
              </div>
              <div className={`flex justify-between items-center text-xl font-black ${balanceDue > 0 ? 'text-red-600' : balanceDue < 0 ? 'text-orange-500' : 'text-green-600'}`}>
                <span>{balanceDue < 0 ? 'Change Due:' : 'Balance Due:'}</span>
                <span>{Math.abs(balanceDue).toFixed(2)}</span>
              </div>
            </div>

            <button onClick={handleCheckout} disabled={processing || cart.length === 0 || (balanceDue > 0 && mode === 'LIVE')} className={`w-full py-4 mt-6 text-white text-xl font-black rounded-lg shadow-lg disabled:bg-gray-300 ${mode === 'BATCH' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {processing ? 'Processing...' : mode === 'BATCH' ? 'Save Record (Enter)' : 'Complete Sale'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}