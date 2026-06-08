import React, { useState, useEffect } from 'react';
import { fetchLocations, createLocation, updateLocation } from '../services/api'; // <-- IMPORT ADDED
import type { TransferLocation } from '../services/api';

interface LocationNodeProps {
  location: TransferLocation;
  allLocations: TransferLocation[];
  onAddSub: (parentId: number) => void;
  onEdit: (loc: TransferLocation) => void; // <-- PROP ADDED
}

// THE RECURSIVE TREE NODE
const LocationNode: React.FC<LocationNodeProps> = ({ location, allLocations, onAddSub, onEdit }) => {
  const [expanded, setExpanded] = useState(true);
  const children = allLocations.filter(loc => (loc as any).parent_location_id === location.location_id);

  return (
    <div className="ml-6 mt-2 border-l-2 border-gray-200 pl-4">
      <div className="flex items-center gap-3 bg-gray-50 p-2 rounded border border-gray-200 shadow-sm group">
        {children.length > 0 ? (
          <button onClick={() => setExpanded(!expanded)} className="text-gray-500 font-mono w-4">
            {expanded ? '[-]' : '[+]'}
          </button>
        ) : <span className="w-4" />}
        
        <span className="font-bold text-gray-700">{location.name}</span>
        
        {/* NEW: The Edit Button (Appears on hover) */}
        <button 
          onClick={() => onEdit(location)} 
          className="text-xs text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition px-1"
          title="Rename Location"
        >
          ✎ Edit
        </button>

        <button onClick={() => onAddSub(location.location_id)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition ml-auto">
          + Add Sub-Location
        </button>
      </div>
      
      {expanded && children.map(child => (
        <LocationNode key={child.location_id} location={child} allLocations={allLocations} onAddSub={onAddSub} onEdit={onEdit} />
      ))}
    </div>
  );
};

export default function LocationManager() {
  const [locations, setLocations] = useState<TransferLocation[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newLocName, setNewLocName] = useState('');
  
  // STATE MACHINE: Determines if we are editing or creating
  const [parentId, setParentId] = useState<number | null>(null);
  const [editingLoc, setEditingLoc] = useState<TransferLocation | null>(null);

  const loadLocs = () => fetchLocations().then(setLocations).catch(console.error);
  useEffect(() => { loadLocs(); }, []);

  // THE MASTER SAVE FUNCTION
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingLoc) {
      // EDIT MODE
      await updateLocation(editingLoc.location_id, newLocName);
    } else {
      // CREATE MODE
      await createLocation({ name: newLocName, parent_location_id: parentId, type: 'ZONE' });
    }
    
    setNewLocName('');
    setShowModal(false);
    setEditingLoc(null);
    setParentId(null);
    loadLocs();
  };

  const openAddModal = (pId: number | null) => {
    setEditingLoc(null);
    setParentId(pId);
    setNewLocName('');
    setShowModal(true);
  };

  const openEditModal = (loc: TransferLocation) => {
    setEditingLoc(loc);
    setParentId(null);
    setNewLocName(loc.name);
    setShowModal(true);
  };

  const rootLocations = locations.filter(loc => !(loc as any).parent_location_id);

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mt-6">
      <div className="flex justify-between items-center mb-4 border-b pb-4">
        <h3 className="text-lg font-bold text-gray-800">Warehouse Hierarchy</h3>
        <button onClick={() => openAddModal(null)} className="bg-green-600 text-white px-4 py-2 rounded shadow font-bold text-sm hover:bg-green-700 transition">
          + New Top-Level Location
        </button>
      </div>

      <div className="bg-white p-4">
        {rootLocations.length === 0 ? <p className="text-gray-500 italic">No locations configured.</p> : null}
        {rootLocations.map(loc => (
          <LocationNode key={loc.location_id} location={loc} allLocations={locations} onAddSub={openAddModal} onEdit={openEditModal} />
        ))}
      </div>

      {/* THE DUAL-PURPOSE MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-96 shadow-xl">
            <h4 className="font-bold mb-4">
              {editingLoc ? 'Rename Location' : parentId ? 'Add Sub-Location' : 'Add Top-Level Location'}
            </h4>
            <form onSubmit={handleSave}>
              <input 
                type="text" 
                value={newLocName} 
                onChange={(e) => setNewLocName(e.target.value)} 
                placeholder="Location Name" 
                className="w-full border p-2 rounded mb-4 focus:ring-blue-500 focus:border-blue-500" 
                required autoFocus
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded font-bold">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}