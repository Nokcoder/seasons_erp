import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchTransfers } from '../services/api';
import type { StockTransfer } from '../services/api';

export default function TransferList() {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  // --- DASHBOARD CONTROLS STATE ---
  const [topX, setTopX] = useState(25);
  const [sortConfig, setSortConfig] = useState({ key: 'transfer_id', direction: 'desc' });
  
  // Unified Search State
  const [activeSearchTerms, setActiveSearchTerms] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    fetchTransfers().then(data => {
      setTransfers(data);
      setLoading(false);
    });
  }, []);

  // --- NORMALIZATION TOOL (Ignores spaces, hyphens, and underscores) ---
  const normalizeText = (str: string | undefined | null) => 
    (str || '').toString().toLowerCase().replace(/[\s_-]/g, '');

  // --- THE FILTER & SORT ENGINE ---
  const filteredAndSortedTransfers = useMemo(() => {
    let result = [...transfers];

    // 1. Unified Tag Filtering
    const rawTerms = [...activeSearchTerms, searchInput].filter(t => t.trim() !== '');
    const normalizedTerms = rawTerms.map(normalizeText);

    if (normalizedTerms.length > 0) {
      result = result.filter(t => {
        // Construct a giant invisible string of all Transfer data, completely normalized
        const searchableData = normalizeText(`
          trn${String(t.transfer_id).padStart(5, '0')}
          ${t.transfer_id}
          ${t.document_id}
          ${t.from_location?.name}
          ${t.to_location?.name}
          ${t.released_by?.username}
          ${t.received_by?.username}
          ${t.status}
        `);

        // AND LOGIC: Every search term provided must be found somewhere in the data
        return normalizedTerms.every(term => searchableData.includes(term));
      });
    }

    // 2. Sorting
    result.sort((a, b) => {
      let aValue: any = a[sortConfig.key as keyof StockTransfer];
      let bValue: any = b[sortConfig.key as keyof StockTransfer];

      // Handle nested object sorting
      if (sortConfig.key === 'from_location') aValue = a.from_location?.name || '';
      if (sortConfig.key === 'to_location') aValue = a.to_location?.name || '';
      if (sortConfig.key === 'released_by') aValue = a.released_by?.username || '';
      if (sortConfig.key === 'received_by') aValue = a.received_by?.username || '';

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    // 3. Top X Limit
    return topX === -1 ? result : result.slice(0, topX);
  }, [transfers, activeSearchTerms, searchInput, sortConfig, topX]);

  // --- SEARCH BAR EVENT HANDLERS ---
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && searchInput.trim()) {
      e.preventDefault();
      const newTerms = searchInput.split(',').map(t => t.trim()).filter(Boolean);
      setActiveSearchTerms([...activeSearchTerms, ...newTerms]);
      setSearchInput('');
    } else if (e.key === 'Backspace' && searchInput === '' && activeSearchTerms.length > 0) {
      setActiveSearchTerms(activeSearchTerms.slice(0, -1));
    }
  };

  const handleSearchPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
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

  // --- SPLIT THE DATA ---
  const pendingTransfers = filteredAndSortedTransfers.filter(t => t.status !== 'COMPLETED');
  const completedTransfers = filteredAndSortedTransfers.filter(t => t.status === 'COMPLETED');

  if (loading) return <div className="p-8 text-gray-500 text-center font-medium mt-10">Loading Logistics Data...</div>;

  const renderTableRows = (transferList: StockTransfer[], isPending: boolean) => {
    if (transferList.length === 0) {
      return (
        <tr>
          <td colSpan={9} className="px-6 py-8 text-center text-gray-400 italic">
            No {isPending ? 'pending' : 'completed'} transfers found matching your search.
          </td>
        </tr>
      );
    }

    return transferList.map((transfer) => (
      <tr key={transfer.transfer_id} className={`transition-colors ${isPending ? 'hover:bg-yellow-50' : 'hover:bg-gray-50'}`}>
        <td className="px-4 py-3 font-bold text-blue-600 hover:underline">
          <Link to={`/transfers/${transfer.transfer_id}`}>
            TRN-{String(transfer.transfer_id).padStart(5, '0')}
          </Link>
        </td>
        <td className="px-4 py-3 font-mono text-xs">{transfer.document_id || '-'}</td>
        <td className="px-4 py-3 text-gray-500">{new Date(transfer.transfer_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
        <td className="px-4 py-3 text-gray-800 font-medium">{transfer.from_location?.name || 'Unknown'}</td>
        <td className="px-4 py-3 text-gray-800 font-medium">{transfer.to_location?.name || 'Unknown'}</td>
        <td className="px-4 py-3 text-gray-600">{transfer.released_by?.username || '-'}</td>
        <td className="px-4 py-3 text-gray-600">{transfer.received_by?.username || 'Pending...'}</td>
        <td className="px-4 py-3 text-right font-bold text-gray-700">{transfer.bundle_count}</td>
        <td className="px-4 py-3 text-center">
          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-bold rounded shadow-sm border ${
            transfer.status === 'REQUESTED' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
            transfer.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-800 border-blue-200' :
            'bg-green-100 text-green-800 border-green-200'
          }`}>
            {transfer.status}
          </span>
          {transfer.has_discrepancy && <span className="ml-1 text-xs" title="Discrepancy Flagged">⚠️</span>}
        </td>
      </tr>
    ));
  };

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Stock Transfers</h2>
          <p className="text-gray-500 mt-1">Overview of all internal inventory movements.</p>
        </div>
        
        <Link to="/transfers/new" className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow hover:bg-blue-700 transition">
          + New Transfer
        </Link>
      </div>

      {/* --- UNIFIED MULTI-TERM SEARCH BAR --- */}
      <div className="bg-white p-4 rounded-lg flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shadow-sm mb-8 border border-gray-200">
        
        <div className="flex-grow w-full max-w-4xl">
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Filter Records (Hit Enter to add tag)</label>
          <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-300 p-2 rounded-md focus-within:ring-2 focus-within:ring-blue-500 transition cursor-text min-h-[46px]" onClick={() => document.getElementById('unifiedSearch')?.focus()}>
            <span className="text-gray-400 pl-1">🔍</span>
            
            {activeSearchTerms.map((term, index) => (
              <span key={index} className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium border border-blue-200">
                {term}
                <button onClick={(e) => { e.stopPropagation(); removeSearchTerm(index); }} className="hover:text-red-600 ml-1 font-bold">✖</button>
              </span>
            ))}

            <input
              id="unifiedSearch"
              type="text"
              placeholder={activeSearchTerms.length === 0 ? "Type TRN, Doc ID, Location, or paste list..." : ""}
              className="flex-grow border-none focus:ring-0 text-sm bg-transparent outline-none min-w-[200px]"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onPaste={handleSearchPaste}
            />
            
            {(activeSearchTerms.length > 0 || searchInput) && (
              <button 
                onClick={() => { setActiveSearchTerms([]); setSearchInput(''); }} 
                className="text-xs text-gray-500 hover:text-red-500 font-bold uppercase tracking-wider ml-auto pr-2 transition"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2 md:border-l pl-0 md:pl-4 mt-4 md:mt-0">
          <label className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap">Show Top:</label>
          <select 
            className="border rounded text-sm p-1.5 focus:ring-blue-500 bg-white outline-none"
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

      {/* SECTION 1: PENDING TRANSFERS */}
      <div className="mb-10">
        <h3 className="text-lg font-bold text-yellow-600 mb-3 flex items-center gap-2">
          <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full text-xs border border-yellow-200">{pendingTransfers.length}</span>
          Action Required: Pending Transfers
        </h3>
        <div className="bg-white shadow-md rounded-lg overflow-x-auto border-l-4 border-yellow-400">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 select-none">
              <tr>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('transfer_id')}>Transfer ID {getSortIcon('transfer_id')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('document_id')}>Doc ID {getSortIcon('document_id')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('transfer_date')}>Date {getSortIcon('transfer_date')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('from_location')}>From {getSortIcon('from_location')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('to_location')}>To {getSortIcon('to_location')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('released_by')}>Released By {getSortIcon('released_by')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('received_by')}>Received By {getSortIcon('received_by')}</th>
                <th className="px-4 py-3 font-semibold text-right">Bundles</th>
                <th className="px-4 py-3 font-semibold text-center cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('status')}>Status {getSortIcon('status')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {renderTableRows(pendingTransfers, true)}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: COMPLETED TRANSFERS */}
      <div>
        <h3 className="text-lg font-bold text-gray-700 mb-3 flex items-center gap-2">
          Historical Records
        </h3>
        <div className="bg-white shadow-md rounded-lg overflow-x-auto border border-gray-200 opacity-90 hover:opacity-100 transition-opacity">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 select-none">
              <tr>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('transfer_id')}>Transfer ID {getSortIcon('transfer_id')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('document_id')}>Doc ID {getSortIcon('document_id')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('transfer_date')}>Date {getSortIcon('transfer_date')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('from_location')}>From {getSortIcon('from_location')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('to_location')}>To {getSortIcon('to_location')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('released_by')}>Released By {getSortIcon('released_by')}</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('received_by')}>Received By {getSortIcon('received_by')}</th>
                <th className="px-4 py-3 font-semibold text-right">Bundles</th>
                <th className="px-4 py-3 font-semibold text-center cursor-pointer hover:bg-gray-100 transition" onClick={() => requestSort('status')}>Status {getSortIcon('status')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {renderTableRows(completedTransfers, false)}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}