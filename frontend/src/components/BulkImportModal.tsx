import React, { useState } from 'react';
import * as XLSX from 'xlsx';

// Define the shape of what we expect back from the preview API
interface PreviewResult {
    new_items: Array<{ pid: string; name: string; price: number }>;
    updates: Array<{
        pid: string;
        product_name: string;
        changes: {
            price?: { old: number; new: number };
            name?: { old: string; new: string };
        };
    }>;
}

export default function BulkImportModal({ isOpen, onClose, onImportComplete }: { isOpen: boolean, onClose: () => void, onImportComplete: () => void }) {
    const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
    const [parsedRows, setParsedRows] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // 1. Handle File Selection & Parsing
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsProcessing(true);
        const reader = new FileReader();

        reader.onload = async (event) => {
            try {
                // Parse Excel with SheetJS
                const data = new Uint8Array(event.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convert to JSON
                const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

                // Map Excel Columns ("Price") to API Columns ("tag_price")
                const formattedRows = jsonData.map(row => ({
                    pid: String(row.PID || row.pid),
                    name: String(row.Name || row.name),
                    tag_price: Number(row.Price || row.price || 0)
                })).filter(row => row.pid && row.pid !== "undefined");

                setParsedRows(formattedRows);

                // Send to Preview Endpoint
                const response = await fetch('import.meta.env.VITE_API_URL/api/inventory/products/import-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formattedRows)
                });

                if (response.ok) {
                    const result = await response.json();
                    setPreviewData(result);
                }
            } catch (error) {
                console.error("Error parsing file:", error);
                alert("Failed to read the Excel file.");
            } finally {
                setIsProcessing(false);
            }
        };

        reader.readAsArrayBuffer(file);
    };

    // 2. Handle Final Confirmation
    const handleConfirm = async () => {
        setIsProcessing(true);
        try {
            const response = await fetch('import.meta.env.VITE_API_URL/api/inventory/products/import-confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsedRows)
            });

            if (response.ok) {
                alert("Import Successful!");
                setPreviewData(null);
                onImportComplete(); // Refresh the main table
                onClose(); // Close modal
            }
        } catch (error) {
            console.error("Error saving data:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Bulk Import Products</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
                </div>

                {/* Upload State */}
                {!previewData && (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center">
                        <p className="text-gray-600 mb-4">Upload an Excel file with columns: <b>PID, Name, Price</b></p>
                        <input 
                            type="file" 
                            accept=".xlsx, .xls, .csv" 
                            onChange={handleFileUpload}
                            disabled={isProcessing}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                        {isProcessing && <p className="mt-4 text-blue-600 font-medium">Processing file...</p>}
                    </div>
                )}

                {/* Preview State */}
                {previewData && (
                    <div className="space-y-6">
                        <div className="bg-blue-50 p-4 rounded-md">
                            <h3 className="font-bold text-blue-800">Preview Results</h3>
                            <p className="text-blue-600 text-sm">Review the changes before saving to the database.</p>
                        </div>

                        {/* New Items Section */}
                        {previewData.new_items.length > 0 && (
                            <div>
                                <h4 className="font-semibold text-green-700 mb-2">✨ New Items ({previewData.new_items.length})</h4>
                                <ul className="text-sm border rounded-md p-3 bg-gray-50 max-h-32 overflow-y-auto">
                                    {previewData.new_items.map(item => (
                                        <li key={item.pid}><b>{item.pid}</b> - {item.name} (₱{item.price})</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Updated Items Section */}
                        {previewData.updates.length > 0 && (
                            <div>
                                <h4 className="font-semibold text-orange-600 mb-2">🔄 Items to Update ({previewData.updates.length})</h4>
                                <ul className="text-sm border rounded-md p-3 bg-gray-50 max-h-40 overflow-y-auto space-y-2">
                                    {previewData.updates.map(update => (
                                        <li key={update.pid} className="border-b pb-1">
                                            <b>{update.pid}</b> ({update.product_name})
                                            {update.changes.price && <span className="block ml-4 text-gray-600">Price: ₱{update.changes.price.old} ➔ <b className="text-orange-600">₱{update.changes.price.new}</b></span>}
                                            {update.changes.name && <span className="block ml-4 text-gray-600">Name: {update.changes.name.old} ➔ <b className="text-orange-600">{update.changes.name.new}</b></span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="flex justify-end space-x-3 pt-4 border-t">
                            <button onClick={() => setPreviewData(null)} className="px-4 py-2 border rounded-md hover:bg-gray-50">Upload Different File</button>
                            <button 
                                onClick={handleConfirm} 
                                disabled={isProcessing}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isProcessing ? "Saving..." : "Confirm & Save"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}