import type {
  ProductSummary,
  ProductDetail,
  LocationSummary,
  StockMovementSummary,
  StockBalance,
  PaginatedResult,
  StockMovementType,
  InventoryRecordStatus,
} from './inventory.model';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

function queryString(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  }
  const text = q.toString();
  return text ? `?${text}` : '';
}

// ---- Products ----

export async function listProducts(
  companyId: string,
  params?: { status?: InventoryRecordStatus; kind?: string; customerVisible?: boolean; search?: string; page?: number; pageSize?: number },
): Promise<PaginatedResult<ProductSummary>> {
  return apiFetch(`/v1/companies/${companyId}/inventory/products${queryString(params)}`);
}

export async function getProduct(companyId: string, productId: string): Promise<ProductDetail> {
  return apiFetch(`/v1/companies/${companyId}/inventory/products/${productId}`);
}

export async function createProduct(companyId: string, body: object): Promise<ProductSummary> {
  return apiFetch(`/v1/companies/${companyId}/inventory/products`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateProduct(companyId: string, productId: string, body: object): Promise<ProductSummary> {
  return apiFetch(`/v1/companies/${companyId}/inventory/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function archiveProduct(companyId: string, productId: string): Promise<void> {
  await apiFetch(`/v1/companies/${companyId}/inventory/products/${productId}/archive`, { method: 'POST' });
}

export async function addProductBarcode(companyId: string, productId: string, body: object): Promise<object> {
  return apiFetch(`/v1/companies/${companyId}/inventory/products/${productId}/barcodes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function generateProductQr(companyId: string, productId: string): Promise<object> {
  return apiFetch(`/v1/companies/${companyId}/inventory/products/${productId}/internal-qr`, { method: 'POST', body: '{}' });
}

// ---- Locations ----

export async function listLocations(
  companyId: string,
  params?: { status?: InventoryRecordStatus; type?: string; search?: string; branchId?: string; page?: number; pageSize?: number },
): Promise<PaginatedResult<LocationSummary>> {
  return apiFetch(`/v1/companies/${companyId}/inventory/locations${queryString(params)}`);
}

export async function createLocation(companyId: string, body: object): Promise<LocationSummary> {
  return apiFetch(`/v1/companies/${companyId}/inventory/locations`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function generateLocationQr(companyId: string, locationId: string): Promise<object> {
  return apiFetch(`/v1/companies/${companyId}/inventory/locations/${locationId}/internal-qr`, { method: 'POST', body: '{}' });
}

// ---- Movements ----

export async function listMovements(
  companyId: string,
  params?: { productId?: string; locationId?: string; movementType?: StockMovementType; page?: number; pageSize?: number },
): Promise<PaginatedResult<StockMovementSummary>> {
  return apiFetch(`/v1/companies/${companyId}/inventory/movements${queryString(params)}`);
}

export async function createMovement(companyId: string, body: {
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  quantity: string;
  reason?: string;
}): Promise<StockMovementSummary> {
  const endpoint =
    body.movementType === 'STOCK_IN' ? 'receive'
      : body.movementType === 'STOCK_OUT' ? 'issue'
        : 'adjust';
  return apiFetch(`/v1/companies/${companyId}/inventory/movements/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function transferStock(companyId: string, body: {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  reason?: string;
}): Promise<StockMovementSummary[]> {
  return apiFetch(`/v1/companies/${companyId}/inventory/movements/transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function stockCount(companyId: string, body: {
  productId: string;
  locationId: string;
  countedQuantity: string;
  reason: string;
}): Promise<StockMovementSummary | null> {
  return apiFetch(`/v1/companies/${companyId}/inventory/movements/count`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---- Balance / Report ----

export async function getStockBalance(
  companyId: string,
  params?: { productId?: string; locationId?: string },
): Promise<StockBalance[]> {
  return apiFetch(`/v1/companies/${companyId}/inventory/balances${queryString(params)}`);
}

export async function getStockReport(
  companyId: string,
  params?: { productId?: string; locationId?: string; lowStockOnly?: boolean },
): Promise<{ items: StockBalance[] }> {
  return apiFetch(`/v1/companies/${companyId}/inventory/reports/stock${queryString(params)}`);
}

// ---- QR Labels ----

export async function resolveQrScan(companyId: string, payload: string): Promise<{ entityType: string; entityId: string }> {
  const q = new URLSearchParams({ payload });
  return apiFetch(`/v1/companies/${companyId}/inventory/labels/resolve?${q}`);
}
