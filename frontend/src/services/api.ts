// frontend/src/services/api.ts

const API_BASE_URL = 'import.meta.env.VITE_API_URL/api';

// ==========================================
// 1. NESTED BLUEPRINTS (Must come first!)
// ==========================================
export interface Category {
  category_id: number;
  category_name: string;
}

export interface Location {
  name: string;
}

export interface CurrentStock {
  location: Location;
  quantity: number;
}

export interface CostLayer {
  layer_id: number;
  unit_cost: number;
  original_qty: number;
  remaining_qty: number;
  received_at: string;
}

// THIS WAS MISSING: The PriceHistory blueprint!
export interface PriceHistory {
  history_id: number;
  old_tag_price: number | null;
  new_tag_price: number | null;
  old_net_price: number | null;
  new_net_price: number | null;
  old_gross_cost: number | null;
  new_gross_cost: number | null;
  old_net_cost: number | null;
  new_net_cost: number | null;
  changed_at: string;
}

// ==========================================
// 2. MAIN PRODUCT INTERFACE
// ==========================================
export interface Product {
  product_id: number;
  pid: string;
  name: string;          
  sku: string | null;
  brand: string | null;
  variant: string | null;
  description: string | null;
  
  // FINANCIALS
  tag_price: number | null;
  price_discount: number | null;
  net_price: number | null;
  gross_cost: number | null;
  cost_discount: number | null;
  net_cost: number | null;   
  
  categories: Category[]; 
  current_stock: CurrentStock[];
  vendors: any[]; 
  price_history: PriceHistory[]; // This works now!
  cost_layers: CostLayer[];      // This works now!
  units_per_bundle: number;
}

// ==========================================
// 3. INPUT SCHEMAS
// ==========================================
export interface ProductCreate {
  pid: string;
  name: string;
  sku?: string;
  brand?: string;
  variant?: string;
  description?: string;
  tag_price?: number;
  price_discount?: number;
  gross_cost?: number;
  cost_discount?: number;
  is_bundle?: boolean;
}

export interface ProductUpdate {
  name?: string;
  sku?: string;
  brand?: string;
  variant?: string;
  description?: string;
  tag_price?: number;
  price_discount?: number;
  gross_cost?: number;
  cost_discount?: number;
  is_active?: boolean;
}

// ==========================================
// 4. API FETCH FUNCTIONS
// ==========================================
export const fetchProducts = async (): Promise<Product[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/products/`);
    if (!response.ok) {
      throw new Error('Failed to fetch products');
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching products:", error);
    return []; 
  }
};

export const fetchProduct = async (id: number): Promise<Product> => {
  const response = await fetch(`${API_BASE_URL}/products/${id}`);
  if (!response.ok) throw new Error('Failed to fetch product');
  return await response.json();
};

export const createProduct = async (data: ProductCreate): Promise<Product> => {
  const response = await fetch(`${API_BASE_URL}/products/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create product');
  return await response.json();
};

export const updateProduct = async (id: number, data: ProductUpdate): Promise<Product> => {
  const response = await fetch(`${API_BASE_URL}/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update product');
  return await response.json();
};


// --- LOGISTICS & TRANSFERS ---

export interface User {
  user_id: number;
  username: string;
  role: string;
}

export interface TransferLocation {
  location_id: number;
  name: string;
}

export interface StockTransferItem {
  item_id: number;
  product_id: number;
  bundling: string | null;
  // THE NEW THREE TRUTHS
  requested_qty: number;
  released_qty: number | null;
  received_qty: number | null;
  
  product?: Product;
}

export interface StockTransfer {
  transfer_id: number;
  document_id: string | null;
  transfer_date: string;
  bundle_count: number;
  status: string;
  from_location: TransferLocation | null;
  to_location: TransferLocation | null;
  released_by: User | null;
  received_by: User | null;
  items: StockTransferItem[];
}

export const fetchTransfers = async (): Promise<StockTransfer[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/transfers`);
    if (!response.ok) throw new Error('Failed to fetch transfers');
    return await response.json();
  } catch (error) {
    console.error("Error fetching transfers:", error);
    return [];
  }
};

// Add these to the bottom of frontend/src/services/api.ts

export const fetchUsers = async (): Promise<User[]> => {
  const response = await fetch(`${API_BASE_URL}/transfers/users/all`);
  if (!response.ok) throw new Error('Failed to fetch users');
  return await response.json();
};

export const fetchLocations = async (): Promise<TransferLocation[]> => {
  const response = await fetch(`${API_BASE_URL}/transfers/locations/all`);
  if (!response.ok) throw new Error('Failed to fetch locations');
  return await response.json();
};

export const createTransfer = async (payload: any) => {
  const response = await fetch(`${API_BASE_URL}/transfers/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // THIS GRABS THE SECRET ERROR MESSAGE FROM PYTHON
    const errorData = await response.json(); 
    console.error("🚨 FASTAPI REJECTION DETAILS:", JSON.stringify(errorData, null, 2));
    throw new Error('Failed to create transfer');
  }
  
  return await response.json();
};


export const fetchTransfer = async (id: string | number): Promise<StockTransfer> => {
  const response = await fetch(`${API_BASE_URL}/transfers/${id}`);
  if (!response.ok) throw new Error('Failed to fetch transfer details');
  return await response.json();
};





// For Origin Warehouse putting boxes on the truck
export const releaseTransfer = async (id: number, items: Record<number, number>) => {
  const response = await fetch(`${API_BASE_URL}/transfers/${id}/release`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) throw new Error('Failed to release transfer');
  return await response.json();
};

// For Destination Warehouse signing for boxes (and adding unexpected ones)
export const receiveTransfer = async (
  id: number, 
  items: Record<number, number>, 
  unexpected_items: { product_id: number, received_qty: number, bundling?: string }[]
) => {
  const response = await fetch(`${API_BASE_URL}/transfers/${id}/receive`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, unexpected_items }),
  });
  if (!response.ok) throw new Error('Failed to receive transfer');
  return await response.json();
};

export const fetchItemLedger = async (productId: number, locationId: number) => {
  const response = await fetch(`${API_BASE_URL}/products/${productId}/ledger/${locationId}`);
  if (!response.ok) throw new Error("Failed to fetch ledger");
  return response.json();
};


export const createLocation = async (payload: { name: string; parent_location_id?: number | null; type: string }) => {
  const response = await fetch(`${API_BASE_URL}/transfers/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to create location");
  return response.json();
};


export const updateLocation = async (id: number, name: string) => {
  const response = await fetch(`${API_BASE_URL}/transfers/locations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error("Failed to update location");
  return response.json();
};



// --- AUTHENTICATION API ---

export const loginUser = async (credentials: any) => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) throw new Error("Invalid username or password");
  return response.json();
};

export const registerUser = async (userData: any) => {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  if (!response.ok) throw new Error("Registration failed. Username may be taken.");
  return response.json();
};


export const updateTransferHeader = async (id: number, data: { document_id?: string, released_by_id?: number, received_by_id?: number }) => {
  const response = await fetch(`${API_BASE_URL}/transfers/${id}/header`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("Failed to update transfer header");
  return response.json();
};


// --- PROCUREMENT: SUPPLIERS ---

export interface Supplier {
  supplier_id: number;
  name: string;
  contact_person: string | null;
  contact_notes: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  banking_details: string | null;
  is_active: boolean;
  registered_at: string;
}

export const fetchSuppliers = async (): Promise<Supplier[]> => {
  const response = await fetch(`${API_BASE_URL}/procurement/suppliers/`);
  if (!response.ok) throw new Error('Failed to fetch suppliers');
  return response.json();
};

export const createSupplier = async (data: Partial<Supplier>): Promise<Supplier> => {
  const response = await fetch(`${API_BASE_URL}/procurement/suppliers/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create supplier');
  return response.json();
};

export const updateSupplier = async (id: number, data: Partial<Supplier>): Promise<Supplier> => {
  const response = await fetch(`${API_BASE_URL}/procurement/suppliers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update supplier');
  return response.json();
};


// --- PROCUREMENT: SHIPMENTS ---

export interface InboundShipment {
  shipment_id: number;
  logistics_name: string | null;
  logistics_doc_id: string | null;
  van_number: string | null;
  date_loaded: string | null;
  date_sealed: string | null;
  date_arrived: string | null;
  collected_by_id: number | null;
  status: string; // IN_TRANSIT, ARRIVED, PROCESSING, CLOSED
  
  // Relationships
  collected_by?: User;
  goods_receipts?: any[]; // We'll type this strictly when we build Tier 3
}

export const fetchShipments = async (): Promise<InboundShipment[]> => {
  // FIX: Removed trailing slash
  const response = await fetch(`${API_BASE_URL}/procurement/shipments`); 
  if (!response.ok) throw new Error('Failed to fetch shipments');
  return response.json();
};

export const createShipment = async (data: Partial<InboundShipment>): Promise<InboundShipment> => {
  // FIX: Removed trailing slash
  const response = await fetch(`${API_BASE_URL}/procurement/shipments`, { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create shipment');
  return response.json();
};

export const updateShipmentStatus = async (id: number, status: string): Promise<InboundShipment> => {
  // FIX: Removed trailing slash
  const response = await fetch(`${API_BASE_URL}/procurement/shipments/${id}/status`, { 
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('Failed to update status');
  return response.json();
};

// --- PROCUREMENT: GOODS RECEIPTS (GRNs) ---

export interface GRNItem {
  grn_item_id?: number;
  product_id: number;
  bundling: string | null;
  expected_qty: number;
  received_qty: number;
  unit_gross_cost: number;
  discount: number;
  net_cost?: number;
  product?: Product;
}

export interface GoodsReceipt {
  grn_id: number;
  shipment_id: number;
  supplier_id: number;
  rcv_document_id: string | null;
  date_collected: string;
  checked_by_id: number | null;
  status: string;
  has_discrepancy: boolean;
  
  supplier?: Supplier;
  shipment?: InboundShipment;
  checked_by?: User;
  items?: GRNItem[];
}

export const fetchGRNs = async (): Promise<GoodsReceipt[]> => {
  const response = await fetch(`${API_BASE_URL}/procurement/receipts`);
  if (!response.ok) throw new Error('Failed to fetch GRNs');
  return response.json();
};

export const createGRN = async (data: Partial<GoodsReceipt>): Promise<GoodsReceipt> => {
  const response = await fetch(`${API_BASE_URL}/procurement/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create GRN');
  return response.json();
};

export const updateGRNStatus = async (id: number, status: string): Promise<GoodsReceipt> => {
  const response = await fetch(`${API_BASE_URL}/procurement/receipts/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('Failed to update GRN status');
  return response.json();
};

// --- PROCUREMENT: PURCHASE ORDERS (Tier 2) ---

export interface POItem {
  po_item_id?: number;
  product_id: number;
  requested_qty: number; // Changed
  unit_gross_cost: number;
  discount: number;      // Added
  net_cost?: number;     // Changed
  product?: Product;
}

export interface PurchaseOrder {
  po_id: number;
  document_id: string | null; // Changed
  supplier_id: number;
  status: string;
  date_drafted: string;       // Changed
  payment_terms: string | null; // Added
  total_value: number;        // Added
  
  supplier?: Supplier;
  items?: POItem[];
}

export const fetchPurchaseOrders = async (): Promise<PurchaseOrder[]> => {
  const response = await fetch(`${API_BASE_URL}/procurement/orders`);
  if (!response.ok) throw new Error('Failed to fetch POs');
  return response.json();
};

export const createPurchaseOrder = async (data: any): Promise<PurchaseOrder> => {
  const response = await fetch(`${API_BASE_URL}/procurement/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create PO');
  return response.json();
};


// --- SALES & POS API ---
export const createSale = async (payload: any) => {
  try {
    const response = await fetch(`import.meta.env.VITE_API_URL/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      
      // THE FIX: Translate FastAPI's 422 validation array into readable text
      if (Array.isArray(errorData.detail)) {
        const messages = errorData.detail.map((e: any) => `${e.loc.join(' -> ')}: ${e.msg}`);
        throw new Error(`Validation Error:\n${messages.join('\n')}`);
      }
      throw new Error(errorData.detail || "Failed to create sale");
    }

    return await response.json();
  } catch (error) {
    console.error("Error creating sale:", error);
    throw error;
  }
};


// --- ADD TO frontend/src/services/api.ts ---

export const fetchSalesDashboard = async (params: { start_date?: string, end_date?: string, search?: string }) => {
  const query = new URLSearchParams();
  if (params.start_date) query.append('start_date', params.start_date);
  if (params.end_date) query.append('end_date', params.end_date);
  if (params.search) query.append('search', params.search);

  const response = await fetch(`import.meta.env.VITE_API_URL/api/sales?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to fetch sales data");
  return await response.json();
};

export const exportSalesToExcel = async (params: { start_date?: string, end_date?: string, search?: string }) => {
  const query = new URLSearchParams();
  if (params.start_date) query.append('start_date', params.start_date);
  if (params.end_date) query.append('end_date', params.end_date);
  if (params.search) query.append('search', params.search);

  // Use window.open to let the browser natively handle the file download trigger
  window.open(`import.meta.env.VITE_API_URL/api/sales/export?${query.toString()}`, '_blank');
};

export const fetchPosSettings = async () => {
  const response = await fetch(`import.meta.env.VITE_API_URL/api/sales/settings`);
  if (!response.ok) {
    // If the settings don't exist yet, return a safe default
    return { is_vat_enabled: false, vat_rate: 0.12 };
  }
  return await response.json();
};

export const fetchSaleDetails = async (sales_id: number) => {
  const response = await fetch(`import.meta.env.VITE_API_URL/api/sales/detail/${sales_id}`);
  if (!response.ok) throw new Error("Failed to fetch sale details");
  return await response.json();
};