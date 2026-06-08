// frontend/src/pages/SalesLedger.tsx
import React, { useState, useEffect } from 'react';
import { fetchSalesDashboard, exportSalesToExcel, fetchSaleDetails, fetchSettingsData  } from '../services/api';

export default function SalesLedger() {
  const [salesData, setSalesData] = useState<any[]>([]);
  
  // --- STATE DEFINITIONS ---
  const [kpis, setKpis] = useState({ 
    total_collected: 0, 
    margined_net_sales: 0, 
    unmargined_gross_sales: 0, 
    margined_revenue: 0,
    logistics_total: 0,
    net_discrepancies: 0,
    total_basket_discounts: 0
  });
  
  // Main Table Filters
  const [availableRegisters, setAvailableRegisters] = useState<any[]>([]);
  const [availableShifts, setAvailableShifts] = useState<any[]>([]);

  const [startDate, setStartDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [endDate, setEndDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [search, setSearch] = useState('');
  const [shift, setShift] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [loading, setLoading] = useState(false);


  // --- DRAWER STATE ---
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [saleDetails, setSaleDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);



// --- FETCH DYNAMIC DROPDOWNS ---
  useEffect(() => {
    const loadDropdowns = async () => {
      try {
        const [regs, shfts] = await Promise.all([
          fetchSettingsData('registers'),
          fetchSettingsData('shifts')
        ]);
        setAvailableRegisters(regs);
        setAvailableShifts(shfts);
      } catch (error) {
        console.error("Failed to load filter dropdowns", error);
      }
    };
    loadDropdowns();
  }, []); // Empty array ensures this only runs once on component mount



  // Load Main Dashboard Data
  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchSalesDashboard({ 
        start_date: startDate, 
        end_date: endDate, 
        search,
        shift,
        register_id: registerId
      });
      setSalesData(data.sales || []);
      setKpis(data.kpis || { 
        total_collected: 0, 
        margined_net_sales: 0, 
        unmargined_gross_sales: 0, 
        margined_revenue: 0,
        logistics_total: 0,
        net_discrepancies: 0,
        total_basket_discounts: 0
      });
    } catch (error) {
      console.error("Failed to load dashboard", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const delay = setTimeout(() => { loadData(); }, 500);
    return () => clearTimeout(delay);
  }, [startDate, endDate, search, shift, registerId]);

  // Handle Row Click (Open Drill-Down Drawer)
  const handleRowClick = async (sales_id: number) => {
    setSelectedSaleId(sales_id);
    setIsDrawerOpen(true);
    setLoadingDetails(true);
    try {
      const details = await fetchSaleDetails(sales_id);
      const summaryData = salesData.find(s => s.sales_id === sales_id) || {};
      
      setSaleDetails({
        ...details,
        summaryExtras: summaryData 
      });
    } catch (error) {
      console.error("Failed to fetch details", error);
      alert("Could not load sale details.");
      setIsDrawerOpen(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      setSelectedSaleId(null);
      setSaleDetails(null);
    }, 300); 
  };

  const isFilterActive = Boolean(startDate || endDate || search || shift || registerId);

  // --- MODAL MATH PRE-CALCULATIONS (OPTION A) ---
  const merchandiseGross = saleDetails?.items
    ?.filter((i: any) => i.is_inventory !== false)
    .reduce((sum: number, i: any) => sum + Number(i.line_total), 0) || 0;

  const nonMerchandiseRevenue = saleDetails?.items
    ?.filter((i: any) => i.is_inventory === false)
    .reduce((sum: number, i: any) => sum + Number(i.line_total), 0) || 0;

  const basketDiscount = Number(saleDetails?.header?.basket_discount_amount || 0) + Number(saleDetails?.header?.discount_amount || 0);
  const overrideAdjust = Number(saleDetails?.header?.manual_adjustment_amount || 0);
  const verifiedTotal = Number(saleDetails?.header?.total_amount || 0);

  return (
    <div className="relative h-full flex flex-col">
      
      {/* --- MAIN PAGE CONTENT --- */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex-grow flex flex-col">
        
        {/* HEADER & FILTERS */}
        <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col xl:flex-row justify-between gap-4 items-start xl:items-end">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Sales Ledger</h2>
            <p className="text-sm text-gray-500 mt-1">Review historical transactions and performance metrics.</p>
          </div>
          
          <div className="flex flex-wrap gap-3 w-full xl:w-auto items-end">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-2 border rounded-md text-sm focus:ring-blue-500 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="p-2 border rounded-md text-sm focus:ring-blue-500 bg-white" />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-purple-600 uppercase mb-1">Shift Audit</label>
          {/* --- DYNAMIC SHIFT FILTER --- */}
          <select 
            value={shift} 
            onChange={(e) => setShift(e.target.value)}
            className="p-2 border rounded shadow-sm focus:ring-blue-500"
          >
            <option value="">All Shifts</option>
            {availableShifts.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.start_time} - {s.end_time})
              </option>
            ))}
          </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Register</label>
{/* --- DYNAMIC REGISTER FILTER --- */}
          <select 
            value={registerId} 
            onChange={(e) => setRegisterId(e.target.value)}
            className="p-2 border rounded shadow-sm focus:ring-blue-500"
          >
            <option value="">All Registers</option>
            {availableRegisters.map(reg => (
              <option key={reg.id} value={reg.id}>
                {reg.name} (ID: {reg.id})
              </option>
            ))}
          </select>
            </div>

            <div className="flex-grow min-w-[150px]">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Search</label>
              <input type="text" placeholder="Invoice #, Customer..." value={search} onChange={e => setSearch(e.target.value)} className="w-full p-2 border rounded-md text-sm focus:ring-blue-500 bg-white" />
            </div>
            
            <div>
              <button 
                onClick={() => exportSalesToExcel({ start_date: startDate, end_date: endDate, search, shift, register_id: registerId })} 
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-md transition shadow-sm h-[38px] flex items-center"
              >
                📥 Export .XLSX
              </button>
            </div>
          </div>
        </div>

        {/* --- DYNAMIC AUDITOR KPI RIBBON --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-gray-100 border-b border-gray-200">
          
          {/* Box 1: Cash Reality & Base Breakdowns */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-blue-500 relative">
            <div className="flex justify-between items-start">
              <div className="w-full">
                <p className="text-sm font-bold text-gray-500 uppercase flex items-center justify-between">
                  <span>Total Collected</span>

                  <div className="relative group cursor-help flex items-center">
                  <span className="text-gray-400 bg-gray-100 rounded-full w-5 h-5 flex items-center justify-center text-xs font-serif">i</span>
            <div className="absolute top-[105%] left-0 hidden group-hover:block w-80 bg-gray-800 text-white text-xs p-4 rounded shadow-xl z-50 pointer-events-none leading-relaxed">
              Actual cash verified across receipts. Fully maps to: (Merchandise - Basket Promos + Non-Merchandise + Cashier Overrides).
            </div>
                  </div>
                </p>
                <h2 className="text-4xl font-black text-gray-900 mt-1 tracking-tight">
                  {kpis.total_collected.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </h2>
              </div>
            </div>
            
            <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
              <div className="flex justify-between text-sm text-gray-600 font-bold">
                <span>Merchandise Gross</span>
                <span>{(kpis.margined_net_sales + kpis.unmargined_gross_sales).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm text-red-500 font-bold">
                <span>Basket Discounts</span>
                <span>- {kpis.total_basket_discounts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              
              <div className="flex justify-between text-sm text-purple-600 font-bold">
                <span>Non-Merchandise Revenue</span>
                <span>+ {kpis.logistics_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              
              {/* Net Discrepancies */}
              <div className={`flex justify-between text-sm font-black pt-2 mt-2 border-t border-dashed ${
                kpis.net_discrepancies > 0 ? 'text-green-600' : kpis.net_discrepancies < 0 ? 'text-red-600' : 'text-gray-400'
              }`}>
                <span>Net Discrepancies (Overrides)</span>
                <span>
                  {kpis.net_discrepancies > 0 ? '+' : ''} {kpis.net_discrepancies.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

          </div>

          {/* Box 2: The Hybrid Profitability Gauge */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-green-500 relative flex flex-col justify-between">
            <div>
              <p className="text-sm font-bold text-gray-500 uppercase flex items-center justify-between">
                <span>Profitability Gauge</span>

                <div className="relative group cursor-help flex items-center">
                <span className="text-gray-400 bg-gray-100 rounded-full w-5 h-5 flex items-center justify-center text-xs font-serif">i</span>
            <div className="absolute top-8 right-0 hidden group-hover:block w-80 bg-gray-800 text-white text-xs p-4 rounded shadow-xl z-50 pointer-events-none leading-relaxed">
              Revenue - Cost of Goods Sold. Next to Revenue of sales without Cost Data.
            </div>
                </div>
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-green-700 block mb-1">Gross Profit</span>
                  <span className="text-2xl font-black text-gray-900">
                    {kpis.margined_net_sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="border-t border-dashed border-gray-200 pt-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-600 block mb-1">Unmargined Gross Sales</span>
                  <span className="text-2xl font-black text-gray-900">
                    {kpis.unmargined_gross_sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
            
          </div>

        </div>

        {isFilterActive && (
          <div className="px-6 pt-4 pb-0 bg-white">
            <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 font-bold text-xs uppercase tracking-wider rounded-full border border-blue-200 shadow-sm">
              Filtered Results: {salesData.length} Invoice(s) found
            </span>
          </div>
        )}

        {/* DATA TABLE */}
        <div className="overflow-x-auto flex-grow p-0">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white text-gray-500 sticky top-0 border-b-2 border-gray-200 z-10">
              <tr>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Date & Time</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Type</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Invoice #</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Location / Reg</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Customer</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-right">Total Amount</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-right">Discrepancy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-500 font-bold">Loading Ledger...</td></tr>
              ) : salesData.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-500 font-bold">No sales found for this period/filter.</td></tr>
              ) : (
                salesData.map((sale) => (
                  <tr 
                    key={sale.sales_id} 
                    onClick={() => handleRowClick(sale.sales_id)}
                    className="hover:bg-blue-50 transition cursor-pointer group"
                  >
                    <td className="px-6 py-4">
                      <div className="font-bold text-gray-900">{sale.date}</div>
                      <div className="text-xs text-gray-500 font-medium">
                        {new Date(sale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} (Shift {sale.shift})
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 text-[10px] font-black rounded-full uppercase tracking-widest border ${
                        sale.transaction_type === 'REFUND' ? 'bg-red-50 text-red-700 border-red-200' :
                        sale.transaction_type === 'EXCHANGE' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {sale.transaction_type || 'SALE'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-blue-600 group-hover:underline">{sale.sales_invoice_id || "Walk-in Receipt"}</div>
                      <div className="text-xs text-gray-400 font-mono">{sale.document_id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-800">{sale.location_name}</div>
                      <div className="text-xs text-gray-500 font-medium">Reg: {sale.register_id}</div>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-700">{sale.customer_name || "Walk-in"}</td>
                    <td className={`px-6 py-4 text-right font-black tabular-nums ${sale.total_amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {parseFloat(sale.total_amount).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right font-bold tabular-nums">
                      {Number(sale.manual_adjustment_amount) > 0 ? (
                        <span className="text-green-600 bg-green-50 px-2 py-1 rounded">+{Number(sale.manual_adjustment_amount).toFixed(2)}</span>
                      ) : Number(sale.manual_adjustment_amount) < 0 ? (
                        <span className="text-red-600 bg-red-50 px-2 py-1 rounded">{Number(sale.manual_adjustment_amount).toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- DRILL-DOWN AUDIT PANEL DRAWER --- */}
      <div 
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-40 ${isDrawerOpen ? 'opacity-40 visible' : 'opacity-0 invisible'}`}
        onClick={closeDrawer}
      ></div>

      <div className={`fixed inset-y-0 right-0 w-full md:w-[500px] lg:w-[650px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {loadingDetails || !saleDetails ? (
          <div className="flex-grow flex items-center justify-center text-gray-500 font-bold animate-pulse">
            Loading Transaction Details...
          </div>
        ) : (
          <>
            <div className={`p-6 border-b flex justify-between items-start ${
              saleDetails.summaryExtras?.transaction_type === 'REFUND' ? 'bg-red-50 border-red-200' :
              saleDetails.summaryExtras?.transaction_type === 'EXCHANGE' ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-black text-gray-900 tracking-tight">
                    {saleDetails.header.sales_invoice_id || "Walk-in Receipt"}
                  </h3>
                  <span className={`px-2 py-1 text-[10px] font-black rounded-full uppercase tracking-widest text-white ${
                    saleDetails.summaryExtras?.transaction_type === 'REFUND' ? 'bg-red-600' :
                    saleDetails.summaryExtras?.transaction_type === 'EXCHANGE' ? 'bg-blue-600' : 'bg-gray-600'
                  }`}>
                    {saleDetails.summaryExtras?.transaction_type || 'SALE'}
                  </span>
                </div>
                <p className="text-sm font-mono text-gray-500 mt-1">{saleDetails.header.document_id}</p>
                {saleDetails.summaryExtras?.linked_receipt_id && (
                  <p className="text-sm font-bold text-blue-700 mt-2 bg-white px-2 py-1 rounded inline-block border border-blue-200 shadow-sm">
                    ↳ Linked Original ID: {saleDetails.summaryExtras.linked_receipt_id}
                  </p>
                )}
              </div>
              <button onClick={closeDrawer} className="text-gray-400 hover:text-gray-800 transition">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-grow bg-white">
              <div className="grid grid-cols-2 gap-4 mb-6 text-sm border-b pb-6 border-dashed border-gray-200">
                <div>
                  <p className="text-gray-500 font-bold text-xs uppercase mb-1">Customer</p>
                  <p className="font-medium text-gray-900">{saleDetails.header.customer_name || "Walk-in"}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-bold text-xs uppercase mb-1">Date & Shift</p>
                  <p className="font-medium text-gray-900">{saleDetails.header.date} (Shift {saleDetails.header.shift})</p>
                </div>
                <div>
                  <p className="text-gray-500 font-bold text-xs uppercase mb-1">Location & Reg</p>
                  <p className="font-medium text-gray-900">{saleDetails.header.location_name} | {saleDetails.header.register_id}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-bold text-xs uppercase mb-1">Cashier</p>
                  <p className="font-medium text-blue-600">{saleDetails.header.cashier_name}</p>
                </div>
              </div>

              <h4 className="font-bold text-gray-800 mb-3 border-l-4 border-blue-500 pl-2 text-xs uppercase tracking-wider">Line Items</h4>
              <div className="bg-gray-50 rounded-lg border border-gray-200 mb-6 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600 border-b border-gray-200">
                    <tr>
                      <th className="p-3 font-bold">Item</th>
                      <th className="p-3 font-bold text-center">Qty</th>
                      <th className="p-3 font-bold text-right">Price</th>
                      <th className="p-3 font-bold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {saleDetails.items.map((item: any, idx: number) => (
                      <tr key={idx} className={`bg-white hover:bg-gray-50 transition ${item.qty < 0 ? 'bg-red-50/50' : ''}`}>
                        <td className="p-3">
                          <div className="font-bold text-gray-900">{item.product_name}</div>
                          <div className="text-xs text-gray-400 font-mono">[{item.pid}]</div>
                          <div className="flex gap-2 mt-1">
                            {Number(item.discount_pct) > 0 && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">-{item.discount_pct}%</span>}
                            {Number(item.discount_flat) > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">-{parseFloat(item.discount_flat).toFixed(2)}</span>}
                          </div>
                        </td>
                        <td className={`p-3 text-center font-medium ${item.qty < 0 ? 'text-red-600 font-bold' : 'text-gray-700'}`}>{item.qty}</td>
                        <td className="p-3 text-right font-medium text-gray-700 tabular-nums">{parseFloat(item.price).toFixed(2)}</td>
                        <td className={`p-3 text-right font-black tabular-nums ${item.qty < 0 ? 'text-red-600' : 'text-gray-900'}`}>{parseFloat(item.line_total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* LOWER DRILL DOWN EXPANSION */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h4 className="font-bold text-blue-800 mb-2 text-sm uppercase">Pure Line Margins</h4>
                  <div className="space-y-1 text-sm">
                    {saleDetails.items.map((item: any, idx: number) => {
                      const marginPct = item.line_total > 0 ? (item.margin / item.line_total) * 100 : 0;
                      return (
                        <div key={idx} className="flex justify-between border-b border-blue-100 border-dashed pb-1">
                          <span className="text-gray-600 truncate w-24" title={item.product_name}>{item.pid}</span>
                          <span className={`font-bold tabular-nums ${item.margin > 0 ? 'text-green-600' : item.margin < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                            {parseFloat(item.margin).toFixed(2)} <span className="text-xs font-normal">({marginPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* --- OPTION A: PERFECT AUDIT BALANCE BOX --- */}
                <div className="bg-gray-800 text-white p-4 rounded-lg shadow-inner flex flex-col justify-between relative overflow-hidden font-mono text-xs">
                  <div className="z-10 space-y-2">
                    <h4 className="text-gray-400 font-bold border-b border-gray-700 pb-1 uppercase tracking-wider text-[10px]">Balanced Audit Summary</h4>
                    
                    <div className="flex justify-between text-gray-300">
                      <span>Merchandise Subtotal:</span>
                      <span>{merchandiseGross.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between text-gray-300">
                      <span>[+] Non-Merchandise Revenue:</span>
                      <span>{nonMerchandiseRevenue.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex justify-between text-red-400 font-bold">
                      <span>[-] Basket Discount:</span>
                      <span>-{basketDiscount.toFixed(2)}</span>
                    </div>

                    <div className={`flex justify-between font-bold ${
                      overrideAdjust > 0 ? 'text-green-400' : overrideAdjust < 0 ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      <span>[±] Override Adjust:</span>
                      <span>
                        {overrideAdjust > 0 ? '+' : ''}
                        {overrideAdjust.toFixed(2)}
                      </span>
                    </div>

                    <div className="border-t border-gray-600 pt-2 flex justify-between font-black text-white text-sm">
                      <span>Verified Total:</span>
                      <span>{verifiedTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {saleDetails.summaryExtras?.adjustment_reason && (
                <div className="mt-4 bg-orange-50 p-3 rounded border border-orange-200">
                  <span className="font-bold text-orange-800 text-sm">Cashier Note: </span>
                  <span className="text-sm text-orange-700">{saleDetails.summaryExtras.adjustment_reason}</span>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex gap-3">
              <button className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-100 transition">
                🖨️ Print Receipt
              </button>
              <button className="flex-1 py-2 bg-red-50 border border-red-200 text-red-700 font-bold rounded-lg shadow-sm hover:bg-red-100 transition">
                🚫 Void / Refund
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}