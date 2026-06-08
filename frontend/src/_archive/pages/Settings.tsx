// frontend/src/pages/Settings.tsx
import React, { useState, useEffect } from 'react';
import { fetchSettingsData, saveSettingsData, fetchUsers } from '../services/api';

// --- DATA MODELS ---
interface Location { id: number; name: string; address: string; type: string; status: 'Active' | 'Inactive'; }
interface Register { id: number; location_id: number; name: string; status: 'Active' | 'Inactive'; }
interface Shift { id: number; name: string; start_time: string; end_time: string; }
interface PaymentMethod { id: number; name: string; type: 'Till' | 'Non-Till'; status: 'Active' | 'Inactive'; }
interface User { id: number; username: string; full_name: string; role: 'Admin' | 'Manager' | 'Cashier'; status: 'Active' | 'Inactive'; }

type TabType = 'Locations' | 'Registers' | 'Shifts' | 'Payments' | 'Users';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabType>('Locations');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // --- REAL STATE (Populated by database) ---
  const [locations, setLocations] = useState<Location[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Modal State
  const [editingItem, setEditingItem] = useState<any>(null);

  // --- FETCH DATA FROM POSTGRESQL ---
  const loadAllData = async () => {
    setLoading(true);
    try {
      const [locs, regs, shfts, pays, usrs] = await Promise.all([
        fetchSettingsData('locations'),
        fetchSettingsData('registers'),
        fetchSettingsData('shifts'),
        fetchSettingsData('payments'),
        fetchUsers()
      ]);
      setLocations(locs);
      setRegisters(regs);
      setShifts(shfts);
      setPaymentMethods(pays);
      setUsers(usrs);
    } catch (error) {
      console.error("Failed to load settings data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const openModal = (item: any = null) => {
    setEditingItem(item || {}); // Initialize with empty object if new
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setEditingItem(null);
    setIsModalOpen(false);
  };

const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Map the active tab to the correct backend endpoint
    const endpointMap: Record<TabType, string> = {
      'Locations': 'locations',
      'Registers': 'registers',
      'Shifts': 'shifts',
      'Payments': 'payments',
      'Users': 'auth/users' // Notice: Make sure this uses the new auth route if applicable!
    };
    
    const endpoint = endpointMap[activeTab];

    try {
      const formData = { ...editingItem }; 
      
      // 1. Password protection
      if (activeTab === 'Users' && !formData.password) {
          delete formData.password; 
      }

      // 2. ID cleanup for New Items (Ensures backend generates it)
      // If id is empty/undefined, delete it so Pydantic doesn't see it during POST
      if (!formData.id) {
          delete formData.id;
      }

      // 3. STRICT NUMBER COERCION (Engineering Principle #3)
      if (activeTab === 'Registers' && formData.location_id) {
          formData.location_id = Number(formData.location_id);
      }

      await saveSettingsData(endpoint, formData);
      await loadAllData(); // Refresh the tables immediately
      closeModal();
    } catch (error) {
      console.error("Failed to save", error);
      alert("Failed to save changes. Check the console.");
    }
  };

  const getLocationName = (loc_id: number) => locations.find(l => l.id === loc_id)?.name || 'Unknown';
  const singularTabName = activeTab.endsWith('s') ? activeTab.slice(0, -1) : activeTab;

  return (
    <div className="p-6 bg-gray-100 min-h-screen flex flex-col">
      
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">System Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage master data: locations, cash registers, operations, and personnel.</p>
      </div>

      {/* TABS & CONTENT AREA */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-grow flex flex-col overflow-hidden">
        
        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-4 pt-4 gap-2 overflow-x-auto">
          {(['Locations', 'Registers', 'Shifts', 'Payments', 'Users'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-bold text-sm rounded-t-lg border-t border-l border-r transition-colors whitespace-nowrap ${
                activeTab === tab 
                  ? 'bg-white text-blue-700 border-gray-200 border-b-white translate-y-[1px]' 
                  : 'bg-transparent text-gray-500 border-transparent hover:text-gray-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
          <h2 className="text-xl font-bold text-gray-800">
            {activeTab === 'Locations' ? 'Store Locations' : 
             activeTab === 'Registers' ? 'Cash Registers' : 
             activeTab === 'Shifts' ? 'Operating Shifts' :
             activeTab === 'Payments' ? 'Accepted Payment Methods' :
             'System Users & Personnel'}
          </h2>
          <button 
            onClick={() => openModal()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm"
          >
            + Add {singularTabName}
          </button>
        </div>

        {/* DATA TABLES */}
        <div className="overflow-x-auto flex-grow bg-white p-6 pt-0">
          {loading ? (
            <div className="text-center py-10 text-gray-500 font-bold animate-pulse">Loading Database Records...</div>
          ) : (
            <>
              {/* --- LOCATIONS TABLE --- */}
              {activeTab === 'Locations' && (
                <table className="min-w-full text-left text-sm border-collapse">
                  <thead className="bg-gray-100 text-gray-600 border-b-2 border-gray-200">
                    <tr>
                      <th className="p-4 font-bold">ID</th>
                      <th className="p-4 font-bold">Location Name</th>
                      <th className="p-4 font-bold">Type</th>
                      <th className="p-4 font-bold">Address</th>
                      <th className="p-4 font-bold text-center">Status</th>
                      <th className="p-4 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {locations.map(loc => (
                      <tr key={loc.id} className="hover:bg-gray-50">
                        <td className="p-4 font-mono text-gray-500">{loc.id}</td>
                        <td className="p-4 font-bold text-gray-900">{loc.name}</td>
                        <td className="p-4 font-semibold text-gray-700">{loc.type || 'Store'}</td>
                        <td className="p-4 text-gray-600">{loc.address}</td>
                        <td className="p-4 text-center">
                          <span className={`px-2 py-1 text-xs font-bold rounded ${loc.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {loc.status}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button onClick={() => openModal(loc)} className="text-blue-600 hover:underline font-bold">Edit</button>
                        </td>
                      </tr>
                    ))}
                    {locations.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">No records found.</td></tr>}
                  </tbody>
                </table>
              )}

              {/* --- REGISTERS TABLE --- */}
              {activeTab === 'Registers' && (
                <table className="min-w-full text-left text-sm border-collapse">
                  <thead className="bg-gray-100 text-gray-600 border-b-2 border-gray-200">
                    <tr>
                      <th className="p-4 font-bold">System ID</th>
                      <th className="p-4 font-bold">Register Name</th>
                      <th className="p-4 font-bold">Assigned Location</th>
                      <th className="p-4 font-bold text-center">Status</th>
                      <th className="p-4 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {registers.map(reg => (
                      <tr key={reg.id} className="hover:bg-gray-50">
                        <td className="p-4 font-mono font-bold text-blue-600">{reg.id}</td>
                        <td className="p-4 font-bold text-gray-900">{reg.name}</td>
                        <td className="p-4 text-gray-600">{getLocationName(reg.location_id)}</td>
                        <td className="p-4 text-center">
                          <span className={`px-2 py-1 text-xs font-bold rounded ${reg.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {reg.status}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button onClick={() => openModal(reg)} className="text-blue-600 hover:underline font-bold">Edit</button>
                        </td>
                      </tr>
                    ))}
                    {registers.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500">No records found.</td></tr>}
                  </tbody>
                </table>
              )}

              {/* --- SHIFTS TABLE --- */}
              {activeTab === 'Shifts' && (
                <table className="min-w-full text-left text-sm border-collapse">
                  <thead className="bg-gray-100 text-gray-600 border-b-2 border-gray-200">
                    <tr>
                      <th className="p-4 font-bold">Shift ID</th>
                      <th className="p-4 font-bold">Shift Name</th>
                      <th className="p-4 font-bold">Start Time</th>
                      <th className="p-4 font-bold">End Time</th>
                      <th className="p-4 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shifts.map(shift => (
                      <tr key={shift.id} className="hover:bg-gray-50">
                        <td className="p-4 font-mono font-bold text-purple-700">{shift.id}</td>
                        <td className="p-4 font-bold text-gray-900">{shift.name}</td>
                        <td className="p-4 text-gray-600 tabular-nums">{shift.start_time}</td>
                        <td className="p-4 text-gray-600 tabular-nums">{shift.end_time}</td>
                        <td className="p-4 text-center">
                          <button onClick={() => openModal(shift)} className="text-blue-600 hover:underline font-bold">Edit</button>
                        </td>
                      </tr>
                    ))}
                    {shifts.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500">No records found.</td></tr>}
                  </tbody>
                </table>
              )}

              {/* --- PAYMENTS TABLE --- */}
              {activeTab === 'Payments' && (
                <table className="min-w-full text-left text-sm border-collapse">
                  <thead className="bg-gray-100 text-gray-600 border-b-2 border-gray-200">
                    <tr>
                      <th className="p-4 font-bold">ID</th>
                      <th className="p-4 font-bold">Method Name</th>
                      <th className="p-4 font-bold">Category</th>
                      <th className="p-4 font-bold text-center">Status</th>
                      <th className="p-4 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paymentMethods.map(pm => (
                      <tr key={pm.id} className="hover:bg-gray-50">
                        <td className="p-4 font-mono text-gray-500">{pm.id}</td>
                        <td className="p-4 font-bold text-gray-900">{pm.name}</td>
                        <td className="p-4 text-gray-600">
                          <span className="bg-gray-100 px-2 py-1 rounded text-xs font-bold text-gray-600">{pm.type}</span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`px-2 py-1 text-xs font-bold rounded ${pm.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {pm.status}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button onClick={() => openModal(pm)} className="text-blue-600 hover:underline font-bold">Edit</button>
                        </td>
                      </tr>
                    ))}
                    {paymentMethods.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500">No records found.</td></tr>}
                  </tbody>
                </table>
              )}

              {/* --- USERS TABLE --- */}
              {activeTab === 'Users' && (
                <table className="min-w-full text-left text-sm border-collapse">
                  <thead className="bg-gray-100 text-gray-600 border-b-2 border-gray-200">
                    <tr>
                      <th className="p-4 font-bold">ID</th>
                      <th className="p-4 font-bold">Full Name</th>
                      <th className="p-4 font-bold">Username</th>
                      <th className="p-4 font-bold">Role</th>
                      <th className="p-4 font-bold text-center">Status</th>
                      <th className="p-4 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="p-4 font-mono text-gray-500">{user.id}</td>
                        <td className="p-4 font-bold text-gray-900">{user.full_name}</td>
                        <td className="p-4 text-blue-600 font-medium">{user.username}</td>
                        <td className="p-4 text-gray-600 font-bold">{user.role}</td>
                        <td className="p-4 text-center">
                          <span className={`px-2 py-1 text-xs font-bold rounded ${user.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {user.status}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button onClick={() => openModal(user)} className="text-blue-600 hover:underline font-bold">Edit</button>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">No records found.</td></tr>}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      {/* --- UNIFIED CREATE/EDIT MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
              <h3 className="font-black text-gray-800 text-lg">
                {editingItem?.id || editingItem?.username ? 'Edit' : 'Create New'} {singularTabName}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-red-500 font-bold">✖</button>
            </div>
            
            <div className="overflow-y-auto p-6">
              <form id="settingsForm" onSubmit={handleSave} className="space-y-4">
                
                {/* --- LOCATIONS FORM --- */}
                {activeTab === 'Locations' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Location Name</label>
                      <input type="text" value={editingItem?.name || ''} onChange={e => setEditingItem({...editingItem, name: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Location Type</label>
                      <select value={editingItem?.type || 'Store'} onChange={e => setEditingItem({...editingItem, type: e.target.value})} className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="Store">Physical Store</option>
                        <option value="Warehouse">Warehouse / Stockroom</option>
                        <option value="Virtual">Virtual / Admin Void</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Address</label>
                      <input type="text" value={editingItem?.address || ''} onChange={e => setEditingItem({...editingItem, address: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Status</label>
                      <select value={editingItem?.status || 'Active'} onChange={e => setEditingItem({...editingItem, status: e.target.value})} className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </>
                )}

                {/* --- REGISTERS FORM --- */}
                {activeTab === 'Registers' && (
                  <>
                    {/* <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">System ID (e.g. REG-01)</label>
                      <input type="text" value={editingItem?.id || ''} onChange={e => setEditingItem({...editingItem, id: e.target.value})} readOnly={!!editingItem?.name} required className="w-full p-2 border rounded bg-gray-50 font-mono text-sm focus:ring-blue-500" />
                    </div> */}
                                        {editingItem?.id && (
                      <div>
                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">System ID</label>
                        <div className="w-full p-2 border rounded bg-gray-100 text-gray-500 font-mono text-sm">
                          {editingItem.id}
                        </div>
                      </div>
                    )}  

                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Register Name</label>
                      <input type="text" value={editingItem?.name || ''} onChange={e => setEditingItem({...editingItem, name: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Assign to Location</label>
                      <select value={editingItem?.location_id || ''} onChange={e => setEditingItem({...editingItem, location_id: Number(e.target.value)})} required className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="">Select a location...</option>
                        {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Status</label>
                      <select value={editingItem?.status || 'Active'} onChange={e => setEditingItem({...editingItem, status: e.target.value})} className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </>
                )}

                {/* --- SHIFTS FORM --- */}
                {activeTab === 'Shifts' && (
                  <>
 {editingItem?.id && (
                      <div>
                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">System Shift ID</label>
                        <div className="w-full p-2 border rounded bg-gray-100 text-gray-500 font-mono text-sm">
                          {editingItem.id}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Shift Name</label>
                      <input type="text" value={editingItem?.name || ''} onChange={e => setEditingItem({...editingItem, name: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Start Time</label>
                        <input type="time" value={editingItem?.start_time || ''} onChange={e => setEditingItem({...editingItem, start_time: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">End Time</label>
                        <input type="time" value={editingItem?.end_time || ''} onChange={e => setEditingItem({...editingItem, end_time: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                      </div>
                    </div>
                  </>
                )}

                  `{/* --- PAYMENTS FORM --- */}
                {activeTab === 'Payments' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Method Name (e.g. GCash, Visa, Cash)</label>
                      <input type="text" value={editingItem?.name || ''} onChange={e => setEditingItem({...editingItem, name: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Reconciliation Category</label>
                      {/* Changed default fallback to 'Till' and updated the options */}
                      <select value={editingItem?.type || 'Till'} onChange={e => setEditingItem({...editingItem, type: e.target.value})} className="w-full p-2 border rounded bg-gray-50 font-medium text-blue-800 focus:ring-blue-500">
                        <option value="Till">Physical Till (Cash/Check)</option>
                        <option value="Non-Till">Non-Till / Digital (Auto-Reconciled)</option>
                      </select>
                      <p className="text-[10px] text-gray-500 mt-1">
                        Determines if cashiers must physically count this money at shift end.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Status</label>
                      <select value={editingItem?.status || 'Active'} onChange={e => setEditingItem({...editingItem, status: e.target.value})} className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </>
                )}

                {/* --- USERS FORM --- */}
                {activeTab === 'Users' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Username (Login ID)</label>
                      <input type="text" value={editingItem?.username || ''} onChange={e => setEditingItem({...editingItem, username: e.target.value})} readOnly={!!editingItem?.id} required className={`w-full p-2 border rounded focus:ring-blue-500 ${editingItem?.id ? 'bg-gray-50' : 'bg-white'}`} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Full Name</label>
                      <input type="text" value={editingItem?.full_name || ''} onChange={e => setEditingItem({...editingItem, full_name: e.target.value})} required className="w-full p-2 border rounded focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">System Role</label>
                      <select value={editingItem?.role || 'Cashier'} onChange={e => setEditingItem({...editingItem, role: e.target.value})} className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="Admin">Admin</option>
                        <option value="Manager">Manager</option>
                        <option value="Cashier">Cashier</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Status</label>
                      <select value={editingItem?.status || 'Active'} onChange={e => setEditingItem({...editingItem, status: e.target.value})} className="w-full p-2 border rounded focus:ring-blue-500">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                    <div className="pt-2">
                      <label className="block text-xs font-bold text-red-600 uppercase mb-1">
                        {editingItem?.id ? 'Reset Password (Optional)' : 'Initial Password'}
                      </label>
                      <input type="password" placeholder="••••••••" value={editingItem?.password || ''} onChange={e => setEditingItem({...editingItem, password: e.target.value})} required={!editingItem?.id} className="w-full p-2 border border-red-200 bg-red-50 rounded focus:ring-red-500" />
                    </div>
                  </>
                )}
              </form>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 mt-auto">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded transition-colors">Cancel</button>
              <button type="submit" form="settingsForm" className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded shadow-sm transition-colors">Save Changes</button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}