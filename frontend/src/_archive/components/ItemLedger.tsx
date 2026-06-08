import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { fetchItemLedger } from '../services/api';

interface LedgerEntry {
  timestamp: string;
  movement_type: string;
  document_id: string;
  transfer_id: number;
  quantity: number;
}

interface LedgerData {
  pid: string;
  product_name: string;
  location_name: string;
  current_qty: number;
  units_per_bundle: number; // <--- NEW
  ledger: LedgerEntry[];
}

export default function ItemLedger() {
  const { productId, locationId } = useParams();
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItemLedger(Number(productId), Number(locationId))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [productId, locationId]);

  // THE MATH HELPER
  const getBundleStr = (qty: number, upb: number) => {
    if (upb <= 1) return "-";
    const absQty = Math.abs(qty);
    const bundles = Math.floor(absQty / upb);
    const loose = absQty % upb;
    const sign = qty > 0 ? "+" : qty < 0 ? "-" : "";
    return loose > 0 ? `${sign}${bundles} bdl (+${loose})` : `${sign}${bundles} bdl`;
  };

  const exportToExcel = () => {
    if (!data) return;
    const exportData = data.ledger.map(entry => ({
      'Date & Time': new Date(entry.timestamp).toLocaleString(),
      'Movement Type': entry.movement_type,
      'Document No.': entry.document_id,
      'Bundles': getBundleStr(entry.quantity, data.units_per_bundle),
      'Base QTY Change': entry.quantity
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger");
    XLSX.writeFile(workbook, `${data.pid}_${data.location_name}_Ledger.xlsx`);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Ledger Data...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">Failed to load ledger.</div>;

  return (
    <div className="max-w-5xl mx-auto mt-8 p-6 bg-white shadow-md rounded-lg">
      
      {/* HEADER INFO */}
      <div className="flex justify-between items-start border-b border-gray-200 pb-6 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{data.product_name}</h2>
          <p className="text-sm text-gray-500 font-mono mt-1">PID: {data.pid} | Bundle Size: {data.units_per_bundle}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Location</p>
          <p className="text-lg font-bold text-blue-700">{data.location_name}</p>
        </div>
        <div className="text-right bg-blue-50 px-4 py-2 rounded-lg border border-blue-100">
          <p className="text-xs text-blue-500 font-bold uppercase">Current Stock</p>
          <p className="text-2xl font-black text-blue-800">
            {data.current_qty} 
            <span className="block text-sm font-normal text-blue-600 mt-1">{getBundleStr(data.current_qty, data.units_per_bundle)}</span>
          </p>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-700">Movement History</h3>
        <button onClick={exportToExcel} className="px-4 py-2 bg-green-600 text-white font-bold text-sm rounded shadow hover:bg-green-700 transition">
          ↓ Export to Excel
        </button>
      </div>

      {/* LEDGER TABLE */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-bold text-gray-500 uppercase">Time Stamp</th>
              <th className="px-6 py-3 text-left font-bold text-gray-500 uppercase">Movement Type</th>
              <th className="px-6 py-3 text-left font-bold text-gray-500 uppercase">Document No.</th>
              <th className="px-6 py-3 text-right font-bold text-gray-500 uppercase">Bundles</th>
              <th className="px-6 py-3 text-right font-bold text-gray-500 uppercase">Base QTY</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.ledger.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400 italic">No historical movements found.</td></tr>
            ) : (
              data.ledger.map((entry, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${entry.movement_type === 'TRANSFER_IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {entry.movement_type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link to={`/transfers/${entry.transfer_id}`} className="text-blue-600 hover:text-blue-800 font-semibold hover:underline">
                      {entry.document_id}
                    </Link>
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-right font-mono text-xs ${entry.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {getBundleStr(entry.quantity, data.units_per_bundle)}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-right font-bold ${entry.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}