// frontend/src/components/InboundShipments.tsx
import React, { useState, useEffect } from 'react';
import { fetchShipments, createShipment, updateShipmentStatus, fetchUsers } from '../services/api';
import type { InboundShipment, User } from '../services/api';

export default function InboundShipments() {
  const [shipments, setShipments] = useState<InboundShipment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    logistics_name: '', logistics_doc_id: '', van_number: '', collected_by_id: ''
  });

  const loadData = () => {
    setLoading(true);
    Promise.all([fetchShipments(), fetchUsers()]).then(([sData, uData]) => {
      setShipments(sData);
      setUsers(uData);
      setLoading(false);
    }).catch(console.error);
  };

  useEffect(() => { loadData(); }, []);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const openModal = () => {

    setFormData({ logistics_name: '', logistics_doc_id: '', van_number: '', collected_by_id: '' });
    setIsModalOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createShipment({
        ...formData,
        collected_by_id: formData.collected_by_id ? Number(formData.collected_by_id) : undefined,
        status: 'IN_TRANSIT'
      });
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      alert("Failed to log incoming van.");
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = async (shipment: InboundShipment) => {
    let nextStatus = '';
    if (shipment.status === 'IN_TRANSIT') nextStatus = 'ARRIVED';
    else if (shipment.status === 'ARRIVED') nextStatus = 'PROCESSING';
    else if (shipment.status === 'PROCESSING') nextStatus = 'CLOSED';
    else return;

    try {
      await updateShipmentStatus(shipment.shipment_id, nextStatus);
      loadData();
    } catch (e) {
      alert("Failed to update status.");
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Logistics Board...</div>;

  // Split data into columns
  const cols = {
    IN_TRANSIT: shipments.filter(s => s.status === 'IN_TRANSIT'),
    ARRIVED: shipments.filter(s => s.status === 'ARRIVED'),
    PROCESSING: shipments.filter(s => s.status === 'PROCESSING'),
    CLOSED: shipments.filter(s => s.status === 'CLOSED'),
  };

  // Helper for displaying dates safely
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  };

  const ShipmentCard = ({ s }: { s: InboundShipment }) => (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-3 hover:shadow-md transition">
      <div className="flex justify-between items-start mb-2">
        <h4 className="font-bold text-gray-800 text-lg">SHP-{String(s.shipment_id).padStart(4, '0')}</h4>
        {s.status !== 'CLOSED' && (
          <button onClick={() => advanceStatus(s)} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded font-bold hover:bg-purple-200 shadow-sm border border-purple-200">
            {s.status === 'IN_TRANSIT' ? 'Mark Arrived' : s.status === 'ARRIVED' ? 'Start Unboxing' : 'Close Van'} →
          </button>
        )}
      </div>
      <div className="text-sm text-gray-600 space-y-1.5">
        <p><span className="font-semibold text-gray-700">Logistics:</span> {s.logistics_name || 'N/A'}</p>
        <p><span className="font-semibold text-gray-700">Van #:</span> <span className="font-mono bg-gray-100 px-1 rounded">{s.van_number || 'N/A'}</span></p>
        <p><span className="font-semibold text-gray-700">Waybill:</span> {s.logistics_doc_id || 'N/A'}</p>
        
        {/* Status-specific Timestamps */}
        {s.status !== 'IN_TRANSIT' && (
          <p className="text-xs text-green-700 font-semibold bg-green-50 px-1 rounded inline-block">
            Arrived: {formatDate(s.date_arrived)}
          </p>
        )}
        
        {s.collected_by && (
          <p className="pt-2 border-t mt-2">
            <span className="font-semibold text-gray-700">Agent:</span> {s.collected_by.username}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto mt-8">
      
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Inbound Logistics</h2>
          <p className="text-gray-500 mt-1">Track physical vans and shipping containers.</p>
        </div>
        <button onClick={openModal} className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg shadow hover:bg-purple-700 transition">
          + Log Incoming Van
        </button>
      </div>

      {/* KANBAN BOARD */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* Column 1 */}
        <div className="bg-gray-100 rounded-lg p-4 min-h-[500px] border border-gray-200">
          <h3 className="font-bold text-gray-700 mb-4 flex items-center justify-between">
            In Transit <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">{cols.IN_TRANSIT.length}</span>
          </h3>
          {cols.IN_TRANSIT.map(s => <ShipmentCard key={s.shipment_id} s={s} />)}
        </div>

        {/* Column 2 */}
        <div className="bg-yellow-50 rounded-lg p-4 min-h-[500px] border border-yellow-200">
          <h3 className="font-bold text-yellow-700 mb-4 flex items-center justify-between">
            Arrived / Dock <span className="bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full text-xs">{cols.ARRIVED.length}</span>
          </h3>
          {cols.ARRIVED.map(s => <ShipmentCard key={s.shipment_id} s={s} />)}
        </div>

        {/* Column 3 */}
        <div className="bg-blue-50 rounded-lg p-4 min-h-[500px] border border-blue-200">
          <h3 className="font-bold text-blue-700 mb-4 flex items-center justify-between">
            Processing GRNs <span className="bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full text-xs">{cols.PROCESSING.length}</span>
          </h3>
          {cols.PROCESSING.map(s => <ShipmentCard key={s.shipment_id} s={s} />)}
        </div>

        {/* Column 4 */}
        <div className="bg-green-50 rounded-lg p-4 min-h-[500px] border border-green-200">
          <h3 className="font-bold text-green-700 mb-4 flex items-center justify-between">
            Closed <span className="bg-green-200 text-green-800 px-2 py-0.5 rounded-full text-xs">{cols.CLOSED.length}</span>
          </h3>
          {cols.CLOSED.map(s => <ShipmentCard key={s.shipment_id} s={s} />)}
        </div>

      </div>

      {/* CREATE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-gray-800">Log Incoming Container</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-800 font-bold text-xl">&times;</button>
            </div>
            
            <div className="p-6">
              <form id="vanForm" onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Logistics Provider</label>
                  <input type="text" name="logistics_name" value={formData.logistics_name} onChange={handleFormChange} required className="w-full border border-gray-300 p-2 rounded focus:ring-purple-500 focus:border-purple-500" placeholder="e.g. FedEx, Maersk" />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Van / Plate #</label>
                    <input type="text" name="van_number" value={formData.van_number} onChange={handleFormChange} className="w-full border border-gray-300 p-2 rounded focus:ring-purple-500 focus:border-purple-500 font-mono text-sm" placeholder="ABC-1234" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Waybill ID</label>
                    <input type="text" name="logistics_doc_id" value={formData.logistics_doc_id} onChange={handleFormChange} className="w-full border border-gray-300 p-2 rounded focus:ring-purple-500 focus:border-purple-500" placeholder="WB-99281" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Receiving Agent</label>
                  <select name="collected_by_id" value={formData.collected_by_id} onChange={handleFormChange} required className="w-full border border-gray-300 p-2 rounded bg-white focus:ring-purple-500 focus:border-purple-500">
                    <option value="">Select an agent...</option>
                    {users.map(u => <option key={u.user_id} value={u.user_id}>{u.username} ({u.role})</option>)}
                  </select>
                </div>
              </form>
            </div>
            
            <div className="p-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded font-medium">Cancel</button>
              <button type="submit" form="vanForm" disabled={saving} className="px-6 py-2 bg-purple-600 text-white font-bold rounded shadow hover:bg-purple-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Van Log'}
              </button>
            </div>
            
          </div>
        </div>
      )}





      
    </div>
  );
}