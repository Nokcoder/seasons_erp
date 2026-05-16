// frontend/src/components/ProductDetail.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { fetchProduct, fetchProducts, createProduct, updateProduct } from '../services/api';
import type { Product } from '../services/api';

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  // --- STANDARD FORM STATE ---
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('price');
  const [fullProduct, setFullProduct] = useState<Product | null>(null);

  const [formData, setFormData] = useState({
    pid: '', name: '', sku: '', brand: '', variant: '', description: '', categories: '',
    units_per_bundle: 1, is_active: true,
    
    // Costing
    gross_cost: '', cost_discount: '0', 
    
    // Tag Pricing (Customer)
    tag_price: '', tag_markup: '', tag_margin: '',
    
    // Net Pricing (Promo/Floor)
    net_price: '', net_markup: '', net_margin: ''
  });

  // --- BULK IMPORT STATE ---
  const [creationMode, setCreationMode] = useState<'single' | 'bulk'>('single');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [previewData, setPreviewData] = useState<{ new_items: any[], updates: any[] } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // --- DATA FETCHING ---
  useEffect(() => {
    if (isNew) {
      fetchProducts().then(data => setAllProducts(data)).catch(console.error);
    } else if (id) {
      fetchProduct(Number(id)).then(data => {
        setFullProduct(data);
        
        const grossCost = data.gross_cost || 0;
        const costDiscPct = (data.cost_discount || 0) * 100; 
        const liveNetCost = grossCost * (1 - (costDiscPct / 100));

        // TypeScript Safe String Conversion
        const initTag = data.tag_price !== null && data.tag_price !== undefined ? String(data.tag_price) : '';
        const initNet = data.net_price !== null && data.net_price !== undefined ? String(data.net_price) : '';
        const initGross = data.gross_cost !== null && data.gross_cost !== undefined ? String(data.gross_cost) : '';

        const numTag = parseFloat(initTag) || 0;
        const numNet = parseFloat(initNet) || 0;

        setFormData({
          pid: data.pid,
          name: data.name,
          sku: data.sku || '',
          brand: data.brand || '',
          variant: data.variant || '',
          description: data.description || '',
          categories: Array.isArray(data.categories) 
              ? data.categories.map((c: any) => c.category_name).join(', ') 
              : '',
          units_per_bundle: data.units_per_bundle || 1,
          is_active: data.is_active !== false,
          
          gross_cost: initGross,
          cost_discount: costDiscPct ? costDiscPct.toString() : '0',
          
          tag_price: initTag,
          tag_markup: liveNetCost > 0 && numTag > 0 ? (((numTag - liveNetCost) / liveNetCost) * 100).toFixed(2) : '',
          tag_margin: numTag > 0 ? (((numTag - liveNetCost) / numTag) * 100).toFixed(2) : '',
          
          net_price: initNet,
          net_markup: liveNetCost > 0 && numNet > 0 ? (((numNet - liveNetCost) / liveNetCost) * 100).toFixed(2) : '',
          net_margin: numNet > 0 ? (((numNet - liveNetCost) / numNet) * 100).toFixed(2) : '',
        });
        setLoading(false);
      }).catch(err => {
        console.error("Error loading product", err);
        setLoading(false);
      });
    }
  }, [id, isNew]);

  // --- STANDARD HANDLERS ---
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // --- THE BIDIRECTIONAL PRICING ENGINE ---
  const handlePricingChange = (field: string, val: string) => {
    let next = { ...formData, [field]: val };

    const parse = (v: string) => parseFloat(v) || 0;
    const format = (n: number) => Number.isFinite(n) ? parseFloat(n.toFixed(2)).toString() : '';

    const gross = parse(next.gross_cost);
    const costDiscPct = parse(next.cost_discount); 
    const netCost = Math.max(0, gross * (1 - (costDiscPct / 100)));

    const syncRow = (prefix: 'tag' | 'net') => {
      const priceKey = `${prefix}_price` as keyof typeof next;
      const markupKey = `${prefix}_markup` as keyof typeof next;
      const marginKey = `${prefix}_margin` as keyof typeof next;

      if (field === priceKey) {
        const price = parse(next[priceKey] as string);
        next[markupKey] = netCost > 0 && price > 0 ? format(((price - netCost) / netCost) * 100) : '';
        next[marginKey] = price > 0 ? format(((price - netCost) / price) * 100) : '';
      } else if (field === markupKey) {
        const markup = parse(next[markupKey] as string);
        const price = netCost * (1 + (markup / 100));
        next[priceKey] = price > 0 ? format(price) : '';
        next[marginKey] = price > 0 ? format(((price - netCost) / price) * 100) : '';
      } else if (field === marginKey) {
        const margin = parse(next[marginKey] as string);
        const price = margin < 100 ? netCost / (1 - (margin / 100)) : 0;
        next[priceKey] = price > 0 ? format(price) : '';
        next[markupKey] = netCost > 0 && price > 0 ? format(((price - netCost) / netCost) * 100) : '';
      } else {
        const price = parse(next[priceKey] as string);
        if (price > 0) {
          next[markupKey] = netCost > 0 ? format(((price - netCost) / netCost) * 100) : '';
          next[marginKey] = format(((price - netCost) / price) * 100);
        }
      }
    };

    syncRow('tag');
    syncRow('net');
    setFormData(next);
  };

  const liveNetCost = Math.max(0, (parseFloat(formData.gross_cost) || 0) * (1 - ((parseFloat(formData.cost_discount) || 0) / 100)));

  // --- SUBMIT HANDLER ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedTag = formData.tag_price !== '' ? parseFloat(formData.tag_price) : null;
      const parsedNet = formData.net_price !== '' ? parseFloat(formData.net_price) : null;
      
      // TypeScript Math Fix: Ensure no math is done on a null value
      const safeTag = parsedTag || 0;
      const safeNet = parsedNet !== null ? parsedNet : safeTag;
      const priceDiscountFraction = safeTag > 0 ? ((safeTag - safeNet) / safeTag) : 0;
      const costDiscountFraction = (parseFloat(formData.cost_discount) || 0) / 100;

      const submitData = {
        pid: formData.pid,
        name: formData.name,
        brand: formData.brand || null,
        variant: formData.variant || null,
        description: formData.description || null,
        
        category_text: typeof formData.categories === 'string' && formData.categories.trim() !== '' ? formData.categories : null,
        
        tag_price: parsedTag,
        net_price: parsedNet,
        price_discount: parseFloat(priceDiscountFraction.toFixed(4)),
        
        gross_cost: formData.gross_cost !== '' ? parseFloat(formData.gross_cost) : null,
        cost_discount: parseFloat(costDiscountFraction.toFixed(4)),
        units_per_bundle: formData.units_per_bundle ? Number(formData.units_per_bundle) : 1, 
      };

      if (isNew) {
        await createProduct({ ...submitData, sku: formData.sku || null });
      } else {
        await updateProduct(Number(id), { ...submitData, sku: formData.sku || null });
      }
      
      navigate('/products');
      
    } catch (error: any) {
      console.error("Save Error Details:", error.response?.data || error.message || error);
      alert("Failed to save product. Check the developer console (F12) for exact details.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!window.confirm("Are you sure you want to archive this product?")) return;
    setSaving(true);
    try {
      await updateProduct(Number(id), { is_active: false });
      alert("Product archived successfully.");
      navigate('/products');
    } catch (error) {
      console.error(error);
      alert("Failed to archive product.");
    } finally {
      setSaving(false);
    }
  };

  // --- SMART UPSERT BULK LOGIC ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const jsonData: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const new_items: any[] = [];
        const updates: any[] = [];

        jsonData.forEach(row => {
          const rawPid = String(row.PID || row.pid || '').trim();
          if (!rawPid) return; 

          const existingProduct = allProducts.find(p => p.pid.toLowerCase() === rawPid.toLowerCase());

          const rowTagPrice = Number(row['Tag Price'] || 0);
          const rowNetPrice = Number(row['Promo Price'] || row['Net Price'] || rowTagPrice);
          const rowDiscountFraction = rowTagPrice > 0 ? ((rowTagPrice - rowNetPrice) / rowTagPrice) : 0;

          if (!existingProduct) {
            new_items.push({
              pid: rawPid,
              brand: String(row.Brand || ''),
              name: String(row.Name || ''),
              variant: String(row.Variant || ''),
              sku: String(row.SKU || ''),
              tag_price: rowTagPrice,
              price_discount: parseFloat(rowDiscountFraction.toFixed(4)), 
              gross_cost: Number(row['Gross Cost'] || 0),
              category_text: String(row.Categories || ''), // <-- FIXED payload field
              units_per_bundle: Number(row['Bundle Count'] || 1),
              _ui_net_price: rowNetPrice 
            });
          } else {
            const changes: Record<string, { old: any, new: any }> = {};
            const payload: Record<string, any> = {};

            const checkField = (fieldKey: keyof Product, excelKey: string, isNumeric: boolean = false) => {
              const rawVal = row[excelKey];
              if (rawVal === undefined || rawVal === null || rawVal === '') return;

              const strVal = String(rawVal).trim();
              if (strVal === '-') {
                if (existingProduct[fieldKey]) {
                  changes[fieldKey] = { old: existingProduct[fieldKey], new: 'Cleared' };
                  const payloadKey = fieldKey === 'categories' ? 'category_text' : fieldKey;
                  payload[payloadKey] = isNumeric ? null : ''; 
                }
                return;
              }

              const newVal = isNumeric ? Number(rawVal) : strVal;
              // Compare visually. The DB sends back categories as an array, so we must be careful.
              const oldVal = fieldKey === 'categories' && Array.isArray(existingProduct.categories) 
                    ? existingProduct.categories.map((c: any) => c.category_name).join(', ')
                    : existingProduct[fieldKey];

              if (newVal !== oldVal) {
                changes[fieldKey] = { old: oldVal || 'None', new: newVal };
                // Send category_text to FastAPI!
                const payloadKey = fieldKey === 'categories' ? 'category_text' : fieldKey;
                payload[payloadKey] = newVal;
              }
            };

            checkField('name', 'Name');
            checkField('brand', 'Brand');
            checkField('variant', 'Variant');
            checkField('sku', 'SKU');
            checkField('categories', 'Categories'); // Safely translates to category_text above
            checkField('tag_price', 'Tag Price', true);
            checkField('gross_cost', 'Gross Cost', true); 
            checkField('units_per_bundle', 'Bundle Count', true);

            const excelNetKey = row['Promo Price'] !== undefined ? 'Promo Price' : 'Net Price';
            if (row[excelNetKey] !== undefined && row[excelNetKey] !== '') {
               const newNet = Number(row[excelNetKey]);
               if (newNet !== existingProduct.net_price) {
                 changes['net_price'] = { old: existingProduct.net_price, new: newNet };
                 payload['net_price'] = newNet;
                 const tagToUse = payload['tag_price'] || existingProduct.tag_price || 0;
                 const newDiscountFrac = tagToUse > 0 ? ((tagToUse - newNet) / tagToUse) : 0;
                 payload['price_discount'] = parseFloat(newDiscountFrac.toFixed(4));
               }
            }

            if (Object.keys(payload).length > 0) {
              updates.push({ product_id: existingProduct.product_id, pid: existingProduct.pid, name: existingProduct.name, changes, payload });
            }
          }
        });

        setPreviewData({ new_items, updates });

      } catch (error) {
        console.error("File parse error:", error);
        alert("Failed to read the Excel file.");
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; 
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;
    setIsProcessing(true);
    
    try {
      const createPromises = previewData.new_items.map(prod => {
         const { _ui_net_price, ...dbPayload } = prod; 
         return createProduct(dbPayload);
      });
      const updatePromises = previewData.updates.map(update => updateProduct(update.product_id, update.payload));

      await Promise.all([...createPromises, ...updatePromises]);

      alert(`Success! Created ${previewData.new_items.length} new items and updated ${previewData.updates.length} items.`);
      navigate('/products');
    } catch (error: any) {
      console.error("Save error:", error.response?.data || error.message || error);
      alert("An error occurred during saving. Check console for details.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { PID: 'ITM-1001', Brand: 'Stanley', Name: 'Claw Hammer', Variant: '16oz', SKU: 'STN-CH-16', 'Tag Price': 450.00, 'Promo Price': 380.00, 'Gross Cost': 200.00, Categories: 'Hardware', 'Bundle Count': 12 },
      { PID: 'ITM-1002', Brand: '-', Name: '', Variant: '20oz', SKU: '', 'Tag Price': '', 'Promo Price': '', 'Gross Cost': '', Categories: '', 'Bundle Count': '' }
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
    XLSX.writeFile(workbook, 'Smart_Upsert_Template.xlsx');
  };

  if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Loading Product Data...</div>;

  return (
    <div className="max-w-5xl mx-auto mt-8 space-y-6 px-4 mb-20">
      
      {isNew && (
        <div className="flex border-b border-gray-200 mb-6">
          <button onClick={() => setCreationMode('single')} className={`py-2 px-6 font-medium text-sm transition-colors duration-200 ${creationMode === 'single' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Create Single Item</button>
          <button onClick={() => setCreationMode('bulk')} className={`py-2 px-6 font-medium text-sm transition-colors duration-200 flex items-center gap-2 ${creationMode === 'bulk' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Smart Bulk Upsert <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-bold">NEW</span></button>
        </div>
      )}

      {isNew && creationMode === 'bulk' ? (
        
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
          {!previewData ? (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Upload Smart Spreadsheet</h3>
              <div className="text-gray-600 text-sm mb-6 max-w-xl mx-auto space-y-2">
                  <p>The system will use the <strong>PID</strong> to determine if it should create a new item or update an existing one.</p>
                  <ul className="bg-white border text-left p-3 rounded-md text-xs space-y-1 shadow-sm">
                    <li><span className="font-bold text-gray-800">Blank Cell</span> = Ignore (Keep existing data)</li>
                    <li><span className="font-bold text-red-600">Hyphen (-)</span> = Erase/Clear the existing data</li>
                    <li><span className="font-bold text-green-600">Text/Number</span> = Overwrite with new data</li>
                  </ul>
              </div>
              <div className="mb-6">
                <button type="button" onClick={handleDownloadTemplate} className="text-sm text-blue-600 hover:text-blue-800 font-bold underline underline-offset-2 transition-colors">Download Smart Template</button>
              </div>
              <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={isProcessing} className="block w-full max-w-xs mx-auto text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-bold file:bg-blue-600 file:text-white cursor-pointer transition-colors hover:file:bg-blue-700 shadow-sm" />
              {isProcessing && <p className="mt-4 text-blue-600 animate-pulse font-bold">Scanning Document...</p>}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-gray-50 border border-gray-200 p-4 rounded-md shadow-sm">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Review Import Data</h3>
                  <p className="text-sm text-gray-600">Ready to create <strong>{previewData.new_items.length}</strong> new items and modify <strong>{previewData.updates.length}</strong> existing items.</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setPreviewData(null)} className="px-4 py-2 bg-white text-gray-600 border border-gray-300 rounded hover:bg-gray-50 font-bold transition shadow-sm">Cancel</button>
                  <button onClick={handleConfirmImport} disabled={isProcessing || (previewData.new_items.length === 0 && previewData.updates.length === 0)} className="px-6 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700 disabled:opacity-50 transition">
                    {isProcessing ? "Processing..." : "Confirm & Save Data"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-green-200 rounded-md bg-white shadow-sm overflow-hidden flex flex-col max-h-[32rem]">
                  <div className="bg-green-50 p-3 border-b border-green-200 flex justify-between items-center">
                    <h4 className="font-bold text-green-800">✨ New Products ({previewData.new_items.length})</h4>
                  </div>
                  <ul className="text-sm space-y-2 p-3 overflow-y-auto flex-grow bg-gray-50">
                    {previewData.new_items.length === 0 ? (
                      <li className="text-center text-gray-400 italic py-8">No new PIDs detected.</li>
                    ) : previewData.new_items.map((item: any, idx: number) => (
                      <li key={idx} className="bg-white p-3 border border-gray-200 rounded shadow-sm">
                        <div className="flex justify-between border-b pb-1 mb-1">
                          <span className="font-mono font-bold text-gray-700">{item.pid}</span>
                          <span className="font-bold text-green-700">₱{item.tag_price.toFixed(2)}</span>
                        </div>
                        <div className="truncate font-medium text-gray-800">{item.name} <span className="text-gray-400 font-normal">{item.variant}</span></div>
                        <div className="text-xs text-gray-500 mt-1">Promo Price: ₱{item._ui_net_price.toFixed(2)} | UPB: {item.units_per_bundle}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border border-orange-200 rounded-md bg-white shadow-sm overflow-hidden flex flex-col max-h-[32rem]">
                  <div className="bg-orange-50 p-3 border-b border-orange-200 flex justify-between items-center">
                    <h4 className="font-bold text-orange-800">🔄 Records to Update ({previewData.updates.length})</h4>
                  </div>
                  <ul className="text-sm space-y-2 p-3 overflow-y-auto flex-grow bg-gray-50">
                    {previewData.updates.length === 0 ? (
                      <li className="text-center text-gray-400 italic py-8">No changed fields detected for existing PIDs.</li>
                    ) : previewData.updates.map((update: any, idx: number) => (
                      <li key={idx} className="bg-white p-3 border border-gray-200 rounded shadow-sm">
                        <div className="flex justify-between border-b pb-1 mb-2">
                          <span className="font-mono font-bold text-gray-700">{update.pid}</span>
                          <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded font-bold">{Object.keys(update.changes).length} changes</span>
                        </div>
                        <div className="truncate font-medium text-gray-800 mb-2">{update.name}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-100 space-y-1">
                          {Object.entries(update.changes).map(([field, vals]: [string, any]) => (
                            <div key={field} className="text-xs grid grid-cols-3 gap-2 items-center">
                              <span className="font-bold text-gray-500 uppercase">{field.replace('_', ' ')}</span>
                              <span className="text-gray-400 truncate line-through text-right">{vals.old}</span>
                              <span className={`font-bold truncate ${vals.new === 'Cleared' ? 'text-red-500' : 'text-green-600'}`}>➔ {vals.new}</span>
                            </div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

      ) : (

        /* --- SINGLE PRODUCT FORM --- */
        <div className="p-6 bg-white shadow-md rounded-lg border border-gray-100">
          <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-3">
            {isNew ? 'Create New Product' : `Product Details: ${formData.pid}`}
            {!isNew && !formData.is_active && (
              <span className="px-3 py-1 text-sm font-semibold bg-red-100 text-red-800 rounded-full border border-red-200">ARCHIVED</span>
            )}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Product Info Block */}
              <div className="space-y-4 col-span-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">PID *</label>
                    <input name="pid" value={formData.pid} onChange={handleChange} disabled={!isNew} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border disabled:bg-gray-100 transition focus:ring-blue-500 focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">SKU</label>
                    <input name="sku" value={formData.sku} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border transition focus:ring-blue-500 focus:border-blue-500"/>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Product Name *</label>
                  <input name="name" value={formData.name} onChange={handleChange} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border transition focus:ring-blue-500 focus:border-blue-500"/>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Brand</label>
                    <input name="brand" value={formData.brand} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border transition focus:ring-blue-500 focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Variant</label>
                    <input name="variant" value={formData.variant} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border transition focus:ring-blue-500 focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Units / Bundle</label>
                    <input type="number" min="1" name="units_per_bundle" value={formData.units_per_bundle} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border bg-yellow-50 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. 12"/>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Categories</label>
                    <input name="categories" value={formData.categories} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border transition focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. Hardware, Tools"/>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Product Notes / Description</label>
                    <textarea name="description" value={formData.description} onChange={handleChange} rows={3} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border transition focus:ring-blue-500 focus:border-blue-500"/>
                  </div>
                </div>
              </div>

              {/* Advanced Pricing Block */}
              <div className="space-y-4 bg-gray-50 p-4 rounded-md border border-gray-200">
                
                <h3 className="font-bold text-gray-800 border-b border-gray-300 pb-2">Supplier Costing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase">Gross Cost</label>
                    <input type="number" step="0.01" value={formData.gross_cost} onChange={e => handlePricingChange('gross_cost', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-medium"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase">Discount %</label>
                    <div className="relative">
                      <input type="number" step="0.01" value={formData.cost_discount} onChange={e => handlePricingChange('cost_discount', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-medium pr-8"/>
                      <span className="absolute right-3 top-3 text-gray-400 font-bold">%</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm text-green-800 bg-green-100 p-2.5 rounded border border-green-200">
                    <span className="font-bold">Live Net Cost:</span> 
                    <span className="font-bold text-base tabular-nums">₱{liveNetCost.toFixed(2)}</span>
                </div>

                <h3 className="font-bold text-gray-800 border-b border-gray-300 pb-2 mt-6">Customer Pricing</h3>
                
                {/* Tag Price Row */}
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase">Tag Price</label>
                    <input type="number" step="0.01" value={formData.tag_price} onChange={e => handlePricingChange('tag_price', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-bold text-blue-700"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase text-center w-full">Markup %</label>
                    <input type="number" step="0.01" value={formData.tag_markup} onChange={e => handlePricingChange('tag_markup', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-mono text-center text-gray-700"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase text-center w-full">Margin %</label>
                    <input type="number" step="0.01" value={formData.tag_margin} onChange={e => handlePricingChange('tag_margin', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-mono text-center text-gray-700"/>
                  </div>
                </div>

                {/* Net/Promo Price Row */}
                <div className="grid grid-cols-3 gap-3 items-end mt-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase">Promo Price</label>
                    <input type="number" step="0.01" value={formData.net_price} onChange={e => handlePricingChange('net_price', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-bold text-orange-600"/>
                  </div>
                  <div>
                    <input type="number" step="0.01" value={formData.net_markup} onChange={e => handlePricingChange('net_markup', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-mono text-center text-gray-700"/>
                  </div>
                  <div>
                    <input type="number" step="0.01" value={formData.net_margin} onChange={e => handlePricingChange('net_margin', e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 p-2 border focus:ring-blue-500 focus:border-blue-500 font-mono text-center text-gray-700"/>
                  </div>
                </div>

              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t mt-6">
              <div>
                {!isNew && formData.is_active && (
                  <button type="button" onClick={handleArchive} disabled={saving} className="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md font-medium transition-colors">Archive Product</button>
                )}
              </div>
              <div className="flex space-x-3">
                <button type="button" onClick={() => navigate('/products')} className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50 transition">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 shadow-sm transition-colors">
                  {saving ? 'Saving...' : 'Save Product Data'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* --- BOTTOM TABS (For Existing Products) --- */}
      {!isNew && fullProduct && (
        <div className="p-6 bg-white shadow-md rounded-lg border border-gray-100">
          <div className="flex border-b mb-4">
            <button type="button" onClick={() => setActiveTab('price')} className={`px-4 py-2 font-medium transition ${activeTab === 'price' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Price History</button>
            <button type="button" onClick={() => setActiveTab('sales')} className={`px-4 py-2 font-medium transition ${activeTab === 'sales' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Sales History</button>
            <button type="button" onClick={() => setActiveTab('purchases')} className={`px-4 py-2 font-medium transition ${activeTab === 'purchases' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Purchase History</button>
          </div>

          {activeTab === 'price' && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-left text-sm border-collapse">
                <thead className="bg-gray-800 text-white border-b">
                  <tr>
                    <th className="px-4 py-3">Date Changed</th>
                    <th className="px-4 py-3 text-right">Tag Price</th>
                    <th className="px-4 py-3 text-right text-orange-300">Promo Price</th>
                    <th className="px-4 py-3 text-right text-green-300">Net Cost</th>
                    <th className="px-4 py-3 text-center border-l border-gray-600">Markup %</th>
                    <th className="px-4 py-3 text-center">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {fullProduct.price_history.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400 italic bg-gray-50">No price changes recorded yet.</td></tr>
                  ) : (
                    fullProduct.price_history.map(log => {
                      const tagPrice = log.new_tag_price || 0;
                      const promoPrice = log.new_net_price || tagPrice; 
                      const cost = log.new_net_cost || 0;
                      
                      const markupPercent = cost > 0 ? (((tagPrice - cost) / cost) * 100).toFixed(2) : 'N/A';
                      const marginPercent = tagPrice > 0 ? (((tagPrice - cost) / tagPrice) * 100).toFixed(2) : 'N/A';
                      
                      return (
                        <tr key={log.history_id} className="border-b hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-gray-600">{new Date(log.changed_at).toLocaleString()}</td>
                          <td className="px-4 py-3 font-bold text-blue-700 text-right tabular-nums">{Number(tagPrice).toFixed(2)}</td>
                          <td className="px-4 py-3 font-bold text-orange-600 text-right tabular-nums">{Number(promoPrice).toFixed(2)}</td>
                          <td className="px-4 py-3 font-medium text-gray-800 text-right tabular-nums">{Number(cost).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center border-l border-gray-100 font-mono text-gray-600 bg-gray-50">{markupPercent}%</td>
                          <td className={`px-4 py-3 text-center font-mono font-bold bg-gray-50 ${Number(marginPercent) > 0 ? 'text-green-600' : 'text-red-600'}`}>{marginPercent}%</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'sales' && <div className="p-12 text-center text-gray-400 bg-gray-50 rounded border border-dashed italic">Sales Ledger Module is pending construction.</div>}
          {activeTab === 'purchases' && <div className="p-12 text-center text-gray-400 bg-gray-50 rounded border border-dashed italic">Purchasing Ledger Module is pending construction.</div>}
        </div>
      )}
    </div>
  );
}