// frontend/src/pages/SalesLedger.tsx
import React, { useState, useEffect } from 'react';
import { fetchSalesDashboard, exportSalesToExcel, fetchSaleDetails } from '../services/api';

export default function SalesLedger() {
  const [salesData, setSalesData] = useState<any[]>([]);
  const [kpis, setKpis] = useState({ gross_sales: 0, net_sales: 0, partial_gross: 0 });
  
  // Main Table Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [shift, setShift] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [loading, setLoading] = useState(false);

  // --- DRAWER STATE ---
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [saleDetails, setSaleDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Load Main Dashboard
  const loadData = async () => {
    setLoading(true);
    try {
      // Pass the new filters to the backend
      const data = await fetchSalesDashboard({ 
        start_date: startDate, 
        end_date: endDate, 
        search,
        shift,
        register_id: registerId
      });
      setSalesData(data.sales);
      setKpis(data.kpis);
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

  // Handle Row Click (Open Drawer)
  const handleRowClick = async (sales_id: number) => {
    setSelectedSaleId(sales_id);
    setIsDrawerOpen(true);
    setLoadingDetails(true);
    try {
      const details = await fetchSaleDetails(sales_id);
      setSaleDetails(details);
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
    }, 300); // Wait for animation to finish before clearing data
  };

  // Determine if any filters are active
  const isFilterActive = Boolean(startDate || endDate || search || shift || registerId);

  return (
    <div className="relative h-full flex flex-col">
      
      {/* --- MAIN PAGE CONTENT --- */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex-grow flex flex-col">
        
        {/* HEADER & FILTERS */}
        <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col xl:flex-row justify-between gap-4 items-start xl:items-end">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Sales Ledger</h2>
            <p className="text-sm text-gray-500 mt-1">Review historical transactions and performance.</p>
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
            
            {/* NEW SHIFT FILTER */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Shift</label>
              <select value={shift} onChange={e => setShift(e.target.value)} className="p-2 border rounded-md text-sm focus:ring-blue-500 bg-white">
                <option value="">All</option>
                <option value="1">Shift 1</option>
                <option value="2">Shift 2</option>
                <option value="3">Shift 3</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>

            {/* NEW REGISTER FILTER */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Register</label>
              <select value={registerId} onChange={e => setRegisterId(e.target.value)} className="p-2 border rounded-md text-sm focus:ring-blue-500 bg-white">
                <option value="">All</option>
                <option value="REG-01">REG-01</option>
                <option value="REG-02">REG-02</option>
                <option value="REG-03">REG-03</option>
                <option value="REG-04">REG-04</option>
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

        {/* KPI RIBBON */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 bg-gray-100 border-b border-gray-200">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-blue-500">
            <p className="text-sm font-bold text-gray-500 uppercase">Gross Sales</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{kpis.gross_sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-green-500">
            <p className="text-sm font-bold text-gray-500 uppercase">Net Sales (Margin)</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{kpis.net_sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-orange-500 relative group">
            <p className="text-sm font-bold text-gray-500 uppercase flex items-center gap-1">
              Partial Gross <span className="cursor-help text-orange-400">ⓘ</span>
            </p>
            <p className="text-3xl font-black text-gray-900 mt-1">{kpis.partial_gross.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            <div className="absolute hidden group-hover:block bottom-full mb-2 left-0 w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-10">
              Revenue from items that have NO cost recorded in the system. Their margins cannot be calculated.
            </div>
          </div>
        </div>

        {/* CONDITIONAL INVOICE COUNT BADGE */}
        {isFilterActive && (
          <div className="px-6 pt-4 pb-0 bg-white">
            <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 font-bold text-xs uppercase tracking-wider rounded-full border border-blue-200 shadow-sm">
              Filtered Results: {salesData.length} Invoice(s) found
            </span>
          </div>
        )}

        {/* DATA TABLE */}
        <div className="overflow-x-auto flex-grow p-0">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white text-gray-500 sticky top-0 border-b-2 border-gray-200 z-10">
              <tr>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Date & Time</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Invoice #</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Location / Reg</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Customer</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-500 font-bold">Loading Ledger...</td></tr>
              ) : salesData.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-500 font-bold">No sales found for this period/filter.</td></tr>
              ) : (
                salesData.map((sale) => (
                  <tr 
                    key={sale.sales_id} 
                    onClick={() => handleRowClick(sale.sales_id)}
                    className="hover:bg-blue-50 transition cursor-pointer group"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-bold text-gray-900">{sale.date}</div>
                      <div className="text-xs text-gray-500 font-medium">
                        {new Date(sale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} (Shift {sale.shift})
                      </div>
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
                    <td className="px-6 py-4 text-right font-black text-gray-900 tabular-nums">{parseFloat(sale.total_amount).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- SLIDE-OUT DRAWER --- */}
      
      {/* Background Overlay */}
      <div 
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-40 ${isDrawerOpen ? 'opacity-40 visible' : 'opacity-0 invisible'}`}
        onClick={closeDrawer}
      ></div>

      {/* Drawer Panel */}
      <div className={`fixed inset-y-0 right-0 w-full md:w-[500px] lg:w-[600px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {loadingDetails || !saleDetails ? (
          <div className="flex-grow flex items-center justify-center text-gray-500 font-bold animate-pulse">
            Loading Transaction Details...
          </div>
        ) : (
          <>
            {/* Drawer Header */}
            <div className="p-6 border-b border-gray-200 bg-gray-50 flex justify-between items-start">
              <div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                  {saleDetails.header.sales_invoice_id || "Walk-in Receipt"}
                </h3>
                <p className="text-sm font-mono text-gray-500 mt-1">{saleDetails.header.document_id}</p>
                <span className="inline-block mt-2 px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full uppercase border border-green-200">
                  {saleDetails.header.status || 'Posted'}
                </span>
              </div>
              <button onClick={closeDrawer} className="text-gray-400 hover:text-gray-800 transition">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Drawer Body - Scrollable */}
            <div className="p-6 overflow-y-auto flex-grow bg-white">
              
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-4 mb-6 text-sm border-b pb-6 border-dashed border-gray-200">
                <div>
                  <p className="text-gray-500 font-bold text-xs uppercase mb-1">Customer</p>
                  <p className="font-medium text-gray-900">{saleDetails.header.customer_name}</p>
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

              {/* Line Items Table */}
              <h4 className="font-bold text-gray-800 mb-3 border-l-4 border-blue-500 pl-2">Line Items</h4>
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
                      <tr key={idx} className="bg-white hover:bg-gray-50 transition">
                        <td className="p-3">
                          <div className="font-bold text-gray-900">{item.product_name}</div>
                          <div className="text-xs text-gray-400 font-mono">[{item.pid}]</div>
                          {/* DUAL DISCOUNT BREAKDOWN */}
                          <div className="flex gap-2 mt-1">
                            {item.discount_pct > 0 && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">-{item.discount_pct}%</span>}
                            {item.discount_flat > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">-{parseFloat(item.discount_flat).toFixed(2)}</span>}
                          </div>
                        </td>
                        <td className="p-3 text-center font-medium text-gray-700">{item.qty}</td>
                        <td className="p-3 text-right font-medium text-gray-700 tabular-nums">{parseFloat(item.price).toFixed(2)}</td>
                        <td className="p-3 text-right font-black text-gray-900 tabular-nums">{parseFloat(item.line_total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial & Audit Breakdown */}
              <div className="grid grid-cols-2 gap-6">
                
                {/* Margin Analysis */}
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h4 className="font-bold text-blue-800 mb-2 text-sm uppercase">Audit & Margin</h4>
                  <div className="space-y-1 text-sm">
                    {saleDetails.items.map((item: any, idx: number) => {
                      const marginPct = item.line_total > 0 ? (item.margin / item.line_total) * 100 : 0;
                      return (
                        <div key={idx} className="flex justify-between border-b border-blue-100 border-dashed pb-1">
                          <span className="text-gray-600 truncate w-24" title={item.product_name}>{item.pid}</span>
                          <span className={`font-bold tabular-nums ${item.margin > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {parseFloat(item.margin).toFixed(2)} <span className="text-xs font-normal">({marginPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Final Totals & Payment */}
                <div className="bg-gray-800 text-white p-4 rounded-lg shadow-inner flex flex-col justify-between">
                  <div>
                    <h4 className="text-gray-400 font-bold mb-2 text-sm uppercase tracking-wider">Grand Total</h4>
                    <p className="text-3xl font-black tracking-tighter tabular-nums">{parseFloat(saleDetails.header.total_amount).toFixed(2)}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-gray-600 space-y-1 text-sm font-medium">
                    {saleDetails.header.payments.map((p: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-gray-300">
                        <span>{p.method}</span>
                        <span className="tabular-nums">{parseFloat(p.amount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            {/* Drawer Footer Actions */}
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