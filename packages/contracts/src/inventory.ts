// ---- Inventory MVP (Item 05) ----

export type ProductKind = 'STOCKABLE' | 'SERVICE' | 'NON_STOCK';
export type InventoryRecordStatus = 'ACTIVE' | 'ARCHIVED';
export type InventoryLocationType = 'MAIN' | 'WAREHOUSE' | 'STOREFRONT' | 'VEHICLE' | 'VIRTUAL' | 'OTHER';
export type ProductBarcodeType = 'INTERNAL_QR' | 'EAN13' | 'UPC' | 'CODE128' | 'SUPPLIER' | 'OTHER';
export type InternalQrEntityType = 'PRODUCT' | 'LOCATION';
export type StockMovementType =
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'COUNT_ADJUSTMENT_IN'
  | 'COUNT_ADJUSTMENT_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';
export type StockMovementDirection = 'IN' | 'OUT';

// --- Product ---
export type ProductSummary = {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  category?: string;
  unit: string;
  kind: ProductKind;
  reorderPoint?: string;
  salePrice?: string;
  bookingDurationMinutes?: number;
  customerVisible: boolean;
  status: InventoryRecordStatus;
};

export type ProductDetail = ProductSummary & {
  description?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  barcodes: ProductBarcodeSummary[];
};

export type CreateProductDto = {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  kind?: ProductKind;
  reorderPoint?: string;
  salePrice?: string;
  bookingDurationMinutes?: number;
  customerVisible?: boolean;
};

export type UpdateProductDto = {
  name?: string;
  description?: string;
  category?: string;
  unit?: string;
  reorderPoint?: string;
  salePrice?: string | null;
  bookingDurationMinutes?: number | null;
  customerVisible?: boolean;
  status?: InventoryRecordStatus;
};

export type ListProductsQuery = {
  status?: InventoryRecordStatus;
  kind?: ProductKind;
  customerVisible?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedProductsDto = {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// --- Barcode ---
export type ProductBarcodeSummary = {
  id: string;
  type: ProductBarcodeType;
  value: string;
  source?: string;
  status: InventoryRecordStatus;
};

export type AddBarcodeDto = {
  type: ProductBarcodeType;
  value: string;
  source?: string;
};

// --- Internal QR Label ---
export type InternalQrLabelDto = {
  id: string;
  companyId: string;
  entityType: InternalQrEntityType;
  entityId: string;
  payload: string;
  labelText: string;
  status: InventoryRecordStatus;
  printedAt?: string;
};

export type QrLabelScanResult = {
  entityType: InternalQrEntityType;
  entityId: string;
};

// --- Location ---
export type LocationSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  code: string;
  name: string;
  type: InventoryLocationType;
  status: InventoryRecordStatus;
};

export type LocationDetail = LocationSummary & {
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateLocationDto = {
  code: string;
  name: string;
  type?: InventoryLocationType;
  branchId?: string;
};

export type UpdateLocationDto = {
  name?: string;
  type?: InventoryLocationType;
  status?: InventoryRecordStatus;
};

export type ListLocationsQuery = {
  status?: InventoryRecordStatus;
  type?: InventoryLocationType;
  search?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedLocationsDto = {
  items: LocationSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// --- Stock Movements ---
export type StockMovementSummary = {
  id: string;
  companyId: string;
  movementNumber?: string;
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  direction: StockMovementDirection;
  quantity: string;
  reason?: string;
  transferGroupId?: string;
  actorUserId: string;
  occurredAt: string;
  createdAt: string;
};

export type CreateStockMovementDto = {
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  quantity: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
};

export type CreateTransferDto = {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  reason?: string;
};

export type CreateStockCountDto = {
  productId: string;
  locationId: string;
  countedQuantity: string;
  reason: string;
};

export type ListMovementsQuery = {
  productId?: string;
  locationId?: string;
  movementType?: StockMovementType;
  actorUserId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedMovementsDto = {
  items: StockMovementSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// --- Stock Balance / Report ---
export type StockBalanceDto = {
  productId: string;
  locationId: string;
  quantity: string;
  isLowStock?: boolean;
};

export type ListStockBalanceQuery = {
  productId?: string;
  locationId?: string;
  lowStockOnly?: boolean;
};

export type StockReportDto = {
  items: StockBalanceDto[];
};

// --- Outbox event payloads ---
export type InventoryMovementCreatedPayload = {
  companyId: string;
  movementId: string;
  movementType: StockMovementType;
  productId: string;
  locationId: string;
  quantity: string;
  actorUserId: string;
  occurredAt: string;
};
