// Centralised query key factory.
// All invalidations should reference these — never use raw strings.

export const qk = {
  // ── reference data (10 min stale) ────────────────────────────────────
  uoms:       () => ['uoms']              as const,
  categories: () => ['categories']       as const,
  locations:  () => ['locations']        as const,
  suppliers:  () => ['suppliers']        as const,
  roles:      () => ['roles']            as const,
  shifts:     () => ['shifts']           as const,
  registers:  () => ['registers']        as const,
  paymentModes:() => ['paymentModes']    as const,
  employees:  () => ['employees']        as const,

  // ── catalogue / inventory (transactional) ────────────────────────────
  products:   ()                  => ['products']             as const,
  product:    (id: number)        => ['products', id]         as const,
  variant:    (id: number)        => ['variants', id]         as const,
  variantStock:(id: number)       => ['variants', id, 'stock'] as const,
  priceHistory:(id: number, limit: number, offset: number) =>
    ['variants', id, 'price-history', limit, offset] as const,
  costHistory: (id: number, limit: number, offset: number) =>
    ['variants', id, 'cost-history',  limit, offset] as const,
  salesHistory:(id: number, limit: number, offset: number) =>
    ['variants', id, 'sales-history', limit, offset] as const,
  purchaseHistory:(id: number, limit: number, offset: number) =>
    ['variants', id, 'purchase-history', limit, offset] as const,

  // ── procurement ───────────────────────────────────────────────────────
  purchaseOrders:  () => ['purchaseOrders'] as const,
  purchaseOrder:   (id: number) => ['purchaseOrders', id] as const,
  shipments:       () => ['shipments']      as const,
  shipment:        (id: number) => ['shipments', id] as const,
  supplierReturns: () => ['supplierReturns'] as const,
  suppliersAll:    (includeDeleted: boolean) => ['suppliers', 'all', includeDeleted] as const,

  // ── AP ────────────────────────────────────────────────────────────────
  apAging:      (asOf?: string)       => ['ap', 'aging',   asOf ?? 'today'] as const,
  invoices:     (supplierId?: number) => ['invoices', supplierId]            as const,
  invoice:      (id: number)          => ['invoices', id]                    as const,
  invoiceMatch: (id: number)          => ['ap', 'invoices', id, 'match']    as const,
  payments:     (supplierId?: number) => ['payments',  supplierId]           as const,
  apLedger:     (supplierId?: number) => ['ap', 'ledger', supplierId]       as const,

  // ── stock movements ───────────────────────────────────────────────────
  transfers:   () => ['transfers']       as const,
  transfer:    (id: number) => ['transfers', id] as const,
  ledger:      (filters: Record<string, unknown>) => ['ledger', filters] as const,

  // ── sales ─────────────────────────────────────────────────────────────
  sales:        (filters?: Record<string, unknown>) => ['sales', filters]         as const,
  sale:         (id: number)                        => ['sales', id]              as const,
  nextSalePid:  ()                                  => ['sales', 'next-pid']        as const,
  salesSummary:    (filters?: Record<string, unknown>) => ['sales', 'summary', filters]    as const,
  salesReturns:    (filters?: Record<string, unknown>) => ['sales', 'returns', filters]   as const,
  salesReturn:     (id: number)                        => ['sales', 'returns', id]        as const,
  saleItemsReturn: (id: number)                        => ['sales', id, 'items-for-return'] as const,
  salesDrafts:  (locationId?: number)               => ['sales', 'drafts', locationId] as const,
  posCatalog:   ()                                  => ['posCatalog']             as const,
  customers:    (filters?: Record<string, unknown>) => ['customers', filters]     as const,
  customer:     (id: number)                        => ['customers', id]          as const,
  customerArLedger: (id: number, f?: Record<string, unknown>) => ['customers', id, 'ar-ledger', f] as const,
  customerSales:    (id: number)                    => ['customers', id, 'sales']    as const,
  customerPayments: (id: number)                    => ['customers', id, 'payments'] as const,
  customerReturns:  (id: number)                    => ['customers', id, 'returns']  as const,
  customerAging:    (filters?: Record<string, unknown>) => ['customers', 'aging', filters] as const,
  arLedger:          (filters?: Record<string, unknown>) => ['ar-ledger',          filters] as const,
  customerArLedgerView: (filters?: Record<string, unknown>) => ['customers', 'ar-ledger-view', filters] as const,
  creditMemos:          (filters?: Record<string, unknown>) => ['creditMemos', filters]          as const,
  creditMemo:           (id: number)                        => ['creditMemos', id]               as const,
  creditMemoValidate:   (code: string)                      => ['creditMemos', 'validate', code] as const,
  arLedgerPayments:     (saleId: number)                    => ['ar-ledger', 'payments', saleId] as const,
  pdcVault:             (filters?: Record<string, unknown>) => ['pdc-vault', filters] as const,

  // ── auth / settings ───────────────────────────────────────────────────
  users:            () => ['users'] as const,
  usersActive:      () => ['users', 'active'] as const,
  inventoryPolicy:  () => ['inventoryPolicy'] as const,
  storeName:        () => ['storeName']       as const,
  programs:         () => ['programs']        as const,
  rolePermissions:  (id: number) => ['roles', id, 'permissions'] as const,
} as const
