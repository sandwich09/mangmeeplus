import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- Suppliers ----

export function listSuppliers(companyId: string, params?: { status?: string; search?: string; page?: number; pageSize?: number }) {
  return apiFetch<any>(`/companies/${companyId}/procurement/suppliers${qs(params)}`);
}

export function getSupplier(companyId: string, supplierId: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/suppliers/${supplierId}`);
}

export function createSupplier(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/procurement/suppliers`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSupplier(companyId: string, supplierId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/procurement/suppliers/${supplierId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---- Purchase Requests ----

export function listPurchaseRequests(companyId: string, params?: { status?: string; supplierId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests${qs(params)}`);
}

export function getPurchaseRequest(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests/${id}`);
}

export function createPurchaseRequest(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests`, { method: 'POST', body: JSON.stringify(body) });
}

export function submitPurchaseRequest(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests/${id}/submit`, { method: 'POST', body: '{}' });
}

export function approvePurchaseRequest(companyId: string, id: string, note?: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ note }) });
}

export function rejectPurchaseRequest(companyId: string, id: string, note: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
}

export function cancelPurchaseRequest(companyId: string, id: string, reason?: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-requests/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Purchase Orders ----

export function listPurchaseOrders(companyId: string, params?: { status?: string; supplierId?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-orders${qs(params)}`);
}

export function getPurchaseOrder(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-orders/${id}`);
}

export function createPurchaseOrder(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-orders`, { method: 'POST', body: JSON.stringify(body) });
}

export function approvePurchaseOrder(companyId: string, id: string, note?: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ note }) });
}

export function issuePurchaseOrder(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-orders/${id}/issue`, { method: 'POST', body: '{}' });
}

export function cancelPurchaseOrder(companyId: string, id: string, reason?: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/purchase-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Goods Receipts ----

export function listGoodsReceipts(companyId: string, params?: { status?: string; purchaseOrderId?: string; page?: number; pageSize?: number }) {
  return apiFetch<any>(`/companies/${companyId}/procurement/goods-receipts${qs(params)}`);
}

export function getGoodsReceipt(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/goods-receipts/${id}`);
}

export function createGoodsReceipt(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/procurement/goods-receipts`, { method: 'POST', body: JSON.stringify(body) });
}

export function postGoodsReceipt(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/goods-receipts/${id}/post`, { method: 'POST', body: '{}' });
}

export function voidGoodsReceipt(companyId: string, id: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/procurement/goods-receipts/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}
