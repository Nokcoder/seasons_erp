import React, { useState, useEffect } from 'react';
import { fetchSuppliers, createSupplier, updateSupplier, type Supplier } from '../services/api';

export default function SupplierMaster() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '', contact_person: '', phone: '', email: '', 
    address: '', payment_terms: '', banking_details: '', contact_notes: ''
  });

  const loadData = () => {
    setLoading(true);
    fetchSuppliers().then(data => {
      setSuppliers(data);
      setLoading(false);
    }).catch(console.error);
  };

  useEffect(() => { loadData(); }, []);

  // Filter Logic
  const filteredSuppliers = suppliers.filter(s => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return s.name.toLowerCase().includes(term) || 
           (s.contact_person && s.contact_person.toLowerCase().includes(term)) ||
           (s.payment_terms && s.payment_terms.toLowerCase().includes(term));
  });

  // Modal Handlers
  const openCreateModal = () => {
    setEditingSupplier(null);
    setFormData({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', banking_details: '', contact_notes: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      payment_terms: supplier.payment_terms || '',
      banking_details: supplier.banking_details || '',
      contact_notes: supplier.contact_notes || ''
    });
    setIsModalOpen(true);
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.supplier_id, formData);
      } else {
        await createSupplier(formData);
      }
      setIsModalOpen(false);
      loadData(); // Refresh table
    } catch (err) {
      alert("Failed to save supplier details.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Suppliers...</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8">
      
      {/* HEADER */}
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Supplier Master</h2>
          <p className="text-gray-500 mt-1">Manage vendor contact and billing information.</p>
          <input 
            type="text" 
            placeholder="Search by Name, Contact, or Terms..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mt-4 w-80 p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 shadow-sm text-sm"
          />
        </div>
        <button onClick={openCreateModal} className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg shadow hover:bg-purple-700 transition">
          + Add Supplier
        </button>
      </div>

      {/* TABLE */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Supplier Name</th>
                <th className="px-4 py-3 font-semibold">Contact Person</th>
                <th className="px-4 py-3 font-semibold">Phone / Email</th>
                <th className="px-4 py-3 font-semibold">Payment Terms</th>
                <th className="px-4 py-3 font-semibold text-center">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-600">
              {filteredSuppliers.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">No suppliers found.</td></tr>
              ) : (
                filteredSuppliers.map((sup) => (
                  <tr key={sup.supplier_id} className="hover:bg-purple-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-gray-800">{sup.name}</td>
                    <td className="px-4 py-3">{sup.contact_person || '-'}</td>
                    <td className="px-4 py-3">
                      <div>{sup.phone || '-'}</div>
                      <div className="text-xs text-gray-400">{sup.email || '-'}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">{sup.payment_terms || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${sup.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {sup.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEditModal(sup)} className="text-purple-600 hover:underline font-medium text-xs border border-purple-200 px-2 py-1 rounded bg-white hover:bg-purple-50">
                        Edit Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-gray-800">{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-800 font-bold text-xl">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto flex-grow">
              <form id="supplierForm" onSubmit={handleSave} className="space-y-4">
                
                {/* Core Info */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Company Name *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleFormChange} required className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Contact Person</label>
                    <input type="text" name="contact_person" value={formData.contact_person} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Terms</label>
                    <input type="text" name="payment_terms" placeholder="e.g. Net 30, COD" value={formData.payment_terms} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
                    <input type="text" name="phone" value={formData.phone} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                    <input type="email" name="email" value={formData.email} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Physical Address</label>
                  <textarea name="address" rows={2} value={formData.address} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Banking Details</label>
                  <textarea name="banking_details" rows={2} placeholder="Account Name, Number, Bank Code..." value={formData.banking_details} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Internal Notes</label>
                  <textarea name="contact_notes" rows={2} value={formData.contact_notes} onChange={handleFormChange} className="w-full border border-gray-300 rounded p-2 focus:ring-purple-500 focus:border-purple-500 bg-yellow-50" />
                </div>

              </form>
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded font-medium transition">Cancel</button>
              <button type="submit" form="supplierForm" disabled={saving} className="px-6 py-2 bg-purple-600 text-white font-bold rounded shadow hover:bg-purple-700 disabled:bg-gray-400 transition">
                {saving ? 'Saving...' : 'Save Supplier'}
              </button>
            </div>
            
          </div>
        </div>
      )}
      
    </div>
  );
}