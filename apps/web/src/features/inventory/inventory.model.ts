// Client-side inventory models (mirrors contracts, avoids server-only imports)

export type ProductKind = 'STOCKABLE' | 'SERVICE' | 'NON_STOCK';
export type InventoryRecordStatus = 'ACTIVE' | 'ARCHIVED';
export type InventoryLocationType = 'MAIN' | 'WAREHOUSE' | 'STOREFRONT' | 'VEHICLE' | 'VIRTUAL' | 'OTHER';
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
  barcodes: { id: string; type: string; value: string; status: InventoryRecordStatus }[];
};

export type LocationSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  code: string;
  name: string;
  type: InventoryLocationType;
  status: InventoryRecordStatus;
};

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
};

export type StockBalance = {
  productId: string;
  locationId: string;
  quantity: string;
  isLowStock?: boolean;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
