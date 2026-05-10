// frontend/src/components/ProductTable.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchProducts } from '../services/api';
import type { Product } from '../services/api';

interface DisplayProduct extends Product {
  displayLocation: string;
  displayQuantity: number;
  uniqueRowId: string; 
  locationId?: number; // Add locationId for ledger linking
  displayBundleString: string;
}

export default function ProductTable() {
  const [rawProducts, setRawProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & UI States
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  
  // View Toggle State
  const [isConsolidated, setIsConsolidated] = useState(true);

  useEffect(() => {
    fetchProducts().then(data => {
      setRawProducts(data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  // --- TAG FILTER LOGIC ---
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && currentInput.trim()) {
      e.preventDefault();
      const newTag = currentInput.trim();
      if (!searchTags.includes(newTag)) setSearchTags([...searchTags, newTag]);
      setCurrentInput('');
      setCurrentPage(1);
    }
  };

  const removeTag = (tagToRemove: string) => {
    setSearchTags(searchTags.filter(tag => tag !== tagToRemove));
    setCurrentPage(1);
  };

  // --- AUTO-TOGGLE LOGIC (FIXED) ---
  const knownLocations = useMemo(() => {
    const locs = new Set<string>();
    rawProducts.forEach(p => p.current_stock.forEach(s => locs.add(s.location.name.replace(/[\s-]/g, '').toLowerCase())));
    return Array.from(locs);
  }, [rawProducts]);

  const hasLocationFilter = useMemo(() => {
    const activeFilters = [...searchTags, currentInput.trim()].filter(Boolean).map(t => t.replace(/[\s-]/g, '').toLowerCase());
    // THE FIX: Only lock the toggle if the typed string is 3+ letters AND matches a location
    return activeFilters.some(filter => filter.length >= 3 && knownLocations.some(loc => loc.includes(filter)));
  }, [searchTags, currentInput, knownLocations]);

  const effectiveConsolidated = isConsolidated && !hasLocationFilter;

  // --- DATA PIPELINES ---
// --- DATA PIPELINES ---
 // --- DATA PIPELINES ---
  const baseProducts = useMemo(() => {
    const output: DisplayProduct[] = [];
    
    rawProducts.forEach(p => {
      // 1. Get the conversion rate (fallback to 1 if not set)
      const upb = p.units_per_bundle || 1;

      // 2. Helper function to generate the string cleanly
      const getBundleStr = (qty: number) => {
        if (upb <= 1) return "-"; // If it's a single-unit item, just show a dash
        const bundles = Math.floor(qty / upb);
        const loose = qty % upb;
        return loose > 0 ? `${bundles} bdl (+${loose})` : `${bundles} bdl`;
      };

      if (!p.current_stock || p.current_stock.length === 0) {
        output.push({ 
          ...p, displayLocation: 'Unassigned', displayQuantity: 0, uniqueRowId: `${p.product_id}-unassigned`, 
          displayBundleString: getBundleStr(0) 
        });
      } else if (effectiveConsolidated) {
        const totalQty = p.current_stock.reduce((sum, stock) => sum + Number(stock.quantity), 0);
        const isSingleLoc = p.current_stock.length === 1;
        const locName = isSingleLoc ? p.current_stock[0].location.name : 'All Locations';
        const locId = isSingleLoc ? (p.current_stock[0].location as any).location_id : undefined; 
        
        output.push({ 
          ...p, displayLocation: locName, displayQuantity: totalQty, uniqueRowId: `${p.product_id}-consolidated`, locationId: locId, 
          displayBundleString: getBundleStr(totalQty) 
        });
      } else {
        p.current_stock.forEach(stock => {
          output.push({ 
            ...p, displayLocation: stock.location.name, displayQuantity: Number(stock.quantity), uniqueRowId: `${p.product_id}-${stock.location.name}`, locationId: (stock.location as any).location_id, 
            displayBundleString: getBundleStr(Number(stock.quantity)) 
          });
        });
      }
    });
    return output;
  }, [rawProducts, effectiveConsolidated]);

  const filteredProducts = useMemo(() => {
    if (searchTags.length === 0 && !currentInput.trim()) return baseProducts;

    const activeFilters = [...searchTags];
    if (currentInput.trim()) activeFilters.push(currentInput.trim());

    const normalize = (str: string) => str.replace(/[\s-]/g, '').toLowerCase();
    const normalizedFilters = activeFilters.map(normalize);

    return baseProducts.filter(p => {
      const rawSearchableText = [
        p.name, p.pid, p.sku, p.brand, p.variant, p.displayLocation,
        p.categories.map(c => c.category_name).join(' ')
      ].filter(Boolean).join(' ');

      const normalizedText = normalize(rawSearchableText);
      return normalizedFilters.every(tag => normalizedText.includes(tag));
    });
  }, [baseProducts, searchTags, currentInput]);

  const sortedProducts = useMemo(() => {
    const sortableItems = [...filteredProducts];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof DisplayProduct];
        let bValue: any = b[sortConfig.key as keyof DisplayProduct];

        if (sortConfig.key === 'categories') {
          aValue = a.categories.map(c => c.category_name).join(', ');
          bValue = b.categories.map(c => c.category_name).join(', ');
        }

        if (aValue === null || aValue === undefined) aValue = '';
        if (bValue === null || bValue === undefined) bValue = '';

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredProducts, sortConfig]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedProducts.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedProducts, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(sortedProducts.length / rowsPerPage);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };
const exportToCSV = () => {
    const headers = ['PID', 'Brand', 'Name', 'Variant', 'SKU', 'Tag Price', 'Net Price', 'Categories', 'Location', 'Quantity'];
    
    const rows = sortedProducts.map(p => {
      const cats = p.categories ? p.categories.map(c => c.category_name).join('; ') : '';
      
      return [
        p.pid, p.brand || '', p.name, p.variant || '', p.sku || '',
        p.tag_price || '', p.net_price || '', cats, p.displayLocation, p.displayQuantity
      ].map(val => {
        // Fix CSV corruption by safely escaping double-quotes inside product names
        const safeVal = String(val).replace(/"/g, '""');
        return `"${safeVal}"`;
      }).join(',');
    });

    const csvString = [headers.join(','), ...rows].join('\n');
    
    // THE FIX: Use a Blob instead of encodeURI to bypass browser URL limits
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `inventory_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    
    // Clean up to prevent memory leaks
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig?.key !== columnKey) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) return <div className="p-8 text-gray-500">Loading Inventory...</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Inventory Master</h2>
          <p className="text-gray-500 mt-1">Manage and track your product catalog.</p>
        </div>
        <Link to="/products/new" className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow hover:bg-blue-700 transition">
          + New Product
        </Link>
      </div>

      <div className="flex flex-col mb-4 bg-white p-4 rounded-lg shadow-sm border border-gray-100 gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
          
          <div className="w-full md:w-1/2">
            <div className="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-md focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white min-h-[42px]">
              {searchTags.map(tag => (
                <span key={tag} className="flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="ml-1 text-blue-500 hover:text-blue-700 font-bold px-1">×</button>
                </span>
              ))}
              <input 
                type="text" 
                placeholder={searchTags.length === 0 ? "Type filter and press Enter..." : "Add filter..."}
                value={currentInput}
                onChange={(e) => { setCurrentInput(e.target.value); setCurrentPage(1); }}
                onKeyDown={handleKeyDown}
                className="flex-grow outline-none text-sm bg-transparent min-w-[150px]"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1 ml-1">Ignores hyphens and spaces! E.g. 'wok001' finds 'WOK-001'.</p>
          </div>
          
          <div className="flex items-center space-x-4 w-full md:w-auto justify-end">
            
            {/* THE NEW, HIGHLY CLICKABLE TOGGLE */}
            <div className="flex items-center space-x-3 border-r border-gray-200 pr-4">
              <button 
                type="button"
                onClick={() => !hasLocationFilter && setIsConsolidated(true)}
                disabled={hasLocationFilter}
                className={`text-sm focus:outline-none ${effectiveConsolidated ? 'text-blue-700 font-bold' : 'text-gray-500 hover:text-gray-700'} ${hasLocationFilter ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Overview
              </button>

              <button
                type="button"
                onClick={() => !hasLocationFilter && setIsConsolidated(!isConsolidated)}
                disabled={hasLocationFilter}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${hasLocationFilter ? 'bg-gray-200 cursor-not-allowed' : effectiveConsolidated ? 'bg-blue-600' : 'bg-gray-400'}`}
                title={hasLocationFilter ? "Disabled: Location filter active" : "Toggle View"}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${effectiveConsolidated ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>

              <button 
                type="button"
                onClick={() => !hasLocationFilter && setIsConsolidated(false)}
                disabled={hasLocationFilter}
                className={`text-sm focus:outline-none ${!effectiveConsolidated ? 'text-blue-700 font-bold' : 'text-gray-500 hover:text-gray-700'} ${hasLocationFilter ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Ledger
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-600">Rows:</label>
              <select 
                value={rowsPerPage} 
                onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="border-gray-300 rounded-md p-1.5 border text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            <button onClick={exportToCSV} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition shadow-sm focus:ring-2 focus:ring-green-500 focus:ring-offset-1">
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('pid')}>PID <SortIcon columnKey="pid"/></th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('brand')}>Brand <SortIcon columnKey="brand"/></th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('name')}>Product Name <SortIcon columnKey="name"/></th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('variant')}>Variant <SortIcon columnKey="variant"/></th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('sku')}>SKU <SortIcon columnKey="sku"/></th>
                <th className="px-4 py-3 font-semibold text-right">Tag Price</th>
                <th className="px-4 py-3 font-semibold text-right">Net Price</th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('categories')}>Category <SortIcon columnKey="categories"/></th>
                <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('displayLocation')}>Location <SortIcon columnKey="displayLocation"/></th>
                <th className="px-4 py-3 font-semibold text-right">Bundles</th>
                <th className="px-4 py-3 font-semibold text-right cursor-pointer hover:bg-gray-100 transition" onClick={() => handleSort('displayQuantity')}>Qty <SortIcon columnKey="displayQuantity"/></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-600">
              {paginatedProducts.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500 italic">No products match your active filters.</td></tr>
              ) : (
                paginatedProducts.map((product) => (
                  <tr key={product.uniqueRowId} className="hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-blue-600 hover:underline">
                      <Link to={`/products/${product.product_id}`}>{product.pid || '-'}</Link>
                    </td>
                    <td className="px-4 py-3">{product.brand || '-'}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{product.name}</td>
                    <td className="px-4 py-3">{product.variant || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{product.sku || '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{product.tag_price !== null && product.tag_price !== undefined ? Number(product.tag_price).toFixed(2) : '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{product.net_price !== null && product.net_price !== undefined ? Number(product.net_price).toFixed(2) : '-'}</td>
                    <td className="px-4 py-3">
                      {product.categories && product.categories.length > 0
                        ? <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-xs">{product.categories.map((c) => c.category_name).join(', ')}</span>
                        : <span className="text-gray-400 italic text-xs">Uncategorized</span>}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {product.locationId ? (
                    <Link to={`/ledger/${product.product_id}/${product.locationId}`} className="text-blue-600 hover:underline">
      {product.displayLocation}
    </Link>
  ) : (
    <span className={product.displayLocation === 'All Locations' ? 'text-gray-800 font-semibold' : 'text-gray-400 italic'}>
      {product.displayLocation}
    </span>
  )}
</td>

<td className="px-4 py-3 text-right text-gray-500 text-xs font-mono">
  {product.displayBundleString}
</td>




                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800">
                      {product.displayLocation === 'Unassigned' ? <span className="text-gray-400 font-normal">0</span> : product.displayQuantity}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 flex items-center justify-between sm:px-6">
          <div className="text-sm text-gray-700">
            Showing <span className="font-medium">{paginatedProducts.length > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0}</span> to <span className="font-medium">{Math.min(currentPage * rowsPerPage, sortedProducts.length)}</span> of <span className="font-medium">{sortedProducts.length}</span> results
          </div>
          <div className="flex space-x-2">
            <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400">Previous</button>
            <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages || totalPages === 0} className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}