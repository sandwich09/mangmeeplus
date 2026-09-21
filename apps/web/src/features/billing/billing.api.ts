'use client';
import type { BillingEmailRecipient, BillingEmailRecipientOperation, BillingCatalog, BillingQuote, BillingStatus, BillingCheckoutBody, BillingCheckoutResult, BillingInvoiceItem, BillingAttemptView, BillingCollectionAction, BillingCollectionOperation, BillingPurchaseMode } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

export type BillingHistory = { items: BillingInvoiceItem[]; nextCursor: string | null };
export function billingApi(companyId: string) {
  const base = `/companies/${encodeURIComponent(companyId)}/billing`;
  const get = <T>(path: string) => authedApiFetch<T>(path, { cache: 'no-store', headers: { 'X-Company-Id': companyId }, suppressErrorToast: true });
  const post = <T>(path: string, body: unknown, key?: string) => authedApiFetch<T>(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Company-Id': companyId, ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body), suppressErrorToast: true });
  return {
    recipient: () => get<BillingEmailRecipient>(`${base}/recipient`),
    recipientPreview: () => post<BillingEmailRecipientOperation>('/recipient/preview', {}),
    recipientOperation: (id: string) => get<BillingEmailRecipientOperation>(`${base}/recipient/${encodeURIComponent(id)}`),
    recipientSubmit: (operation: BillingEmailRecipientOperation) => post<BillingEmailRecipientOperation>(`/recipient/${operation.id}/submit`,
      { expectedVersion: operation.version, previewHash: operation.previewHash, accepted: true }, `billing-recipient-${operation.id}`),
    recipientCancel: (operation: BillingEmailRecipientOperation) => post<BillingEmailRecipientOperation>(`/recipient/${operation.id}/cancel`, { expectedVersion: operation.version }),
    status: () => get<BillingStatus>(base), catalog: () => get<BillingCatalog>('/billing/catalog'),
    attempt: (attemptId: string) => get<BillingAttemptView>(`${base}/attempts/${encodeURIComponent(attemptId)}`),
    history: (cursor?: string) => get<BillingHistory>(`${base}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    // `dealId` still sends the deal's base tier and 'month' — the API prices the offer from the
    // approved snapshot, never from this body (S36).
    quote: (offerKey: string, interval: string, billingEmail: string, capacity?: BillingCapacitySelection, purchaseMode: BillingPurchaseMode = 'CARD_AUTO', dealId?: string) =>
      post<BillingQuote>('/quote', { offerKey, interval, billingEmail, capacity, purchaseMode, ...(dealId ? { dealId } : {}) }),
    capacity: (offerKey: string, interval: string) => get<BillingCapacityOptions>(`${base}/capacity?offerKey=${encodeURIComponent(offerKey)}&interval=${encodeURIComponent(interval)}`),
    repairCapacity: (attemptId: string, expectedVersion: number, selection: BillingCapacitySelection, key: string) => post<{ operationId: string; queued: boolean }>(`/attempts/${encodeURIComponent(attemptId)}/capacity`, { expectedVersion, selection, accepted: true }, key),
    checkout: (body: BillingCheckoutBody, key: string) => post<BillingCheckoutResult>('/checkout', body, key),
    resume: (attemptId: string) => post<BillingCheckoutResult>(`/attempts/${encodeURIComponent(attemptId)}/resume`, {}),
    cancelCheckout: (attemptId: string) => post<{state:'EXPIRED'|'COMPLETED'|'PENDING'}>(`/attempts/${encodeURIComponent(attemptId)}/cancel`, {}),
    refresh: () => post<{ queued: boolean }>('/refresh', {}),
    portal: () => post<{ url: string }>('/portal', { action: 'portal_payment_method' }),
    collection: (id: string) => get<BillingCollectionOperation>(`${base}/collection/${encodeURIComponent(id)}`),
    collectionPreview: (action: BillingCollectionAction, target?: { offerKey: string; interval: string; capacity: BillingCapacitySelection }) => post<BillingCollectionOperation>('/collection/preview', { action, ...target }),
    repairPlanCapacity: (id: string, expectedVersion: number, selection: BillingCapacitySelection, key: string) => post<{ operationId: string; queued: boolean }>(`/collection/${encodeURIComponent(id)}/capacity`, { expectedVersion, selection, accepted: true }, key),
    collectionSubmit: (operation: BillingCollectionOperation) => post<BillingCollectionOperation>(`/collection/${operation.id}/submit`, {
      expectedVersion: operation.version, previewHash: operation.previewHash, accepted: true }, `billing-collection-${operation.id}`),
    collectionWithdraw: (operation: BillingCollectionOperation) => post<BillingCollectionOperation>(`/collection/${operation.id}/withdraw`, { expectedVersion: operation.version }),
    document: (id: string, kind: 'invoice' | 'receipt' | 'pdf') => post<{ url: string }>(`/documents/${encodeURIComponent(id)}/open`, { kind }),
  };
}
