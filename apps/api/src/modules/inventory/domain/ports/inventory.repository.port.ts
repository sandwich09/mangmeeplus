import {
  Product,
  ProductBarcode,
  InventoryLocation,
  InternalQrLabel,
  StockMovement,
  StockBalance,
  InventoryRecordStatus,
  StockMovementType,
} from '../models/inventory.model';

// ---- Product ----

export type CreateProductInput = {
  companyId: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  kind?: Product['kind'];
  reorderPoint?: string;
  salePrice?: string;
  bookingDurationMinutes?: number;
  customerVisible?: boolean;
  createdByUserId: string;
};

export type UpdateProductInput = {
  name?: string;
  // Nullable: the product edit form sends `description: null` to clear it, and the
  // repository has always passed that straight to Prisma.
  description?: string | null;
  category?: string;
  unit?: string;
  reorderPoint?: string;
  salePrice?: string | null;
  bookingDurationMinutes?: number | null;
  customerVisible?: boolean;
  status?: InventoryRecordStatus;
  updatedByUserId: string;
};

export type ListProductsFilter = {
  status?: InventoryRecordStatus;
  kind?: Product['kind'];
  customerVisible?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ProductPage = { items: Product[]; total: number; page: number; pageSize: number };

export interface ProductRepositoryPort {
  findById(companyId: string, id: string): Promise<Product | null>;
  findBySku(companyId: string, sku: string): Promise<Product | null>;
  list(companyId: string, filter: ListProductsFilter): Promise<ProductPage>;
  create(input: CreateProductInput): Promise<Product>;
  update(companyId: string, id: string, input: UpdateProductInput): Promise<Product>;
}

// ---- Barcode ----

export type AddBarcodeInput = {
  companyId: string;
  productId: string;
  type: ProductBarcode['type'];
  value: string;
  source?: string;
};

export interface BarcodeRepositoryPort {
  findByValue(companyId: string, value: string): Promise<ProductBarcode | null>;
  listByProduct(companyId: string, productId: string): Promise<ProductBarcode[]>;
  create(input: AddBarcodeInput): Promise<ProductBarcode>;
  archive(companyId: string, id: string): Promise<ProductBarcode>;
}

// ---- Location ----

export type CreateLocationInput = {
  companyId: string;
  branchId?: string;
  code: string;
  name: string;
  type?: InventoryLocation['type'];
  createdByUserId: string;
};

export type UpdateLocationInput = {
  name?: string;
  type?: InventoryLocation['type'];
  status?: InventoryRecordStatus;
  updatedByUserId: string;
};

export type ListLocationsFilter = {
  status?: InventoryRecordStatus;
  type?: InventoryLocation['type'];
  search?: string;
  branchId?: string;
  branchIds?: string[];
  page?: number;
  pageSize?: number;
};

export type LocationPage = { items: InventoryLocation[]; total: number; page: number; pageSize: number };

export interface LocationRepositoryPort {
  findById(companyId: string, id: string): Promise<InventoryLocation | null>;
  findByCode(companyId: string, code: string): Promise<InventoryLocation | null>;
  list(companyId: string, filter: ListLocationsFilter): Promise<LocationPage>;
  create(input: CreateLocationInput): Promise<InventoryLocation>;
  update(companyId: string, id: string, input: UpdateLocationInput): Promise<InventoryLocation>;
}

// ---- QR Label ----

export type CreateQrLabelInput = {
  companyId: string;
  entityType: InternalQrLabel['entityType'];
  entityId: string;
  payload: string;
  labelText: string;
  createdByUserId: string;
};

export interface QrLabelRepositoryPort {
  findByPayload(companyId: string, payload: string): Promise<InternalQrLabel | null>;
  findByEntity(companyId: string, entityType: InternalQrLabel['entityType'], entityId: string): Promise<InternalQrLabel[]>;
  create(input: CreateQrLabelInput): Promise<InternalQrLabel>;
  markPrinted(companyId: string, id: string, printedByUserId: string): Promise<InternalQrLabel | null>;
}

// ---- Movements ----

export type CreateMovementInput = {
  companyId: string;
  movementNumber?: string;
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  direction: StockMovement['direction'];
  quantity: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  transferGroupId?: string;
  reversesMovementId?: string;
  actorUserId: string;
};

export type ListMovementsFilter = {
  productId?: string;
  locationId?: string;
  branchIds?: string[];
  movementType?: StockMovementType;
  actorUserId?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  pageSize?: number;
};

export type MovementPage = { items: StockMovement[]; total: number; page: number; pageSize: number };

export interface MovementRepositoryPort {
  list(companyId: string, filter: ListMovementsFilter): Promise<MovementPage>;
  create(input: CreateMovementInput): Promise<StockMovement>;
  createMany(inputs: CreateMovementInput[]): Promise<StockMovement[]>;
}

// ---- Balance Query ----

export interface BalanceQueryPort {
  getBalance(companyId: string, productId: string, locationId: string): Promise<StockBalance>;
  listBalances(companyId: string, filter: { productId?: string; locationId?: string; branchIds?: string[] }): Promise<StockBalance[]>;
}
