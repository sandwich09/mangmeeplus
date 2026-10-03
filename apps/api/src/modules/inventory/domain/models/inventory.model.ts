// Pure domain models — no Prisma, no NestJS imports

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

export type Product = {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  kind: ProductKind;
  reorderPoint?: string; // Decimal stored as string
  salePrice?: string; // Decimal stored as string
  bookingDurationMinutes?: number;
  customerVisible: boolean;
  status: InventoryRecordStatus;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductBarcode = {
  id: string;
  companyId: string;
  productId: string;
  type: ProductBarcodeType;
  value: string;
  source?: string;
  status: InventoryRecordStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type InventoryLocation = {
  id: string;
  companyId: string;
  branchId?: string;
  code: string;
  name: string;
  type: InventoryLocationType;
  status: InventoryRecordStatus;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type InternalQrLabel = {
  id: string;
  companyId: string;
  entityType: InternalQrEntityType;
  entityId: string;
  payload: string;
  labelText: string;
  status: InventoryRecordStatus;
  printedAt?: Date;
  printedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StockMovement = {
  id: string;
  companyId: string;
  movementNumber?: string;
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  direction: StockMovementDirection;
  quantity: string; // Decimal as string
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  transferGroupId?: string;
  reversesMovementId?: string;
  actorUserId: string;
  occurredAt: Date;
  createdAt: Date;
  /** Set by the movement list, for pages and reports that show the product and place by name. */
  productName?: string;
  locationName?: string;
};

export type StockBalance = {
  productId: string;
  locationId: string;
  quantity: string; // Decimal as string, >= 0 always
  isLowStock?: boolean;
  productName?: string;
  locationName?: string;
};
