import type {
  CounterpartySummary,
  DocumentSummary,
  DocumentDetail,
  PaymentSummary,
  PaginatedResult,
  AccountingDocumentType,
  AccountingOutputTaxCode,
  AccountingVatMode,
  AccountingPaymentDirection,
  AccountingPaymentMethod,
  DocumentLineSummary,
} from './accounting-documents.model';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { assertAllowedUploadFile, withGenericUploadError } from '@/common/files/upload-file.logic';
import { uploadReceiptFile } from '@/features/expenses/expenses.api';
import type {
  AccountingAdjustmentReasonCode,
  CreateRevenueCategoryInput,
  IncomeExpenseLedgerEntries,
  IncomeExpenseLedgerEntryType,
  IncomeExpenseLedgerExport,
  IncomeExpenseLedgerSummary,
  RecordSimpleIncomeInput,
  RecordSimpleIncomeResult,
  RevenueCategorySummary,
  TransactionTaxContext,
  UpdateRevenueCategoryInput,
} from '@watchdog-bms/contracts';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- Counterparties ----
export async function listCounterparties(companyId: string, params?: { page?: number; pageSize?: number }): Promise<{ data: CounterpartySummary[]; total: number }> {
  return apiFetch(`/v1/companies/${companyId}/accounting/counterparties${qs(params)}`);
}

export async function createCounterparty(companyId: string, body: { type: string; displayName: string; taxId?: string; email?: string; phone?: string }): Promise<CounterpartySummary> {
  return apiFetch(`/v1/companies/${companyId}/accounting/counterparties`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Documents ----
export async function listDocuments(
  companyId: string,
  params?: { documentType?: AccountingDocumentType; status?: string; paymentStatus?: string; counterpartyId?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number },
): Promise<PaginatedResult<DocumentSummary>> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents${qs(params)}`);
}

export async function getDocument(companyId: string, documentId: string): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}`);
}

export async function createDocument(
  companyId: string,
  body: {
    documentType: AccountingDocumentType;
    branchId?: string;
    documentDate: string;
    dueDate?: string;
    counterpartyId?: string;
    sourceDocumentId?: string;
    sourceDocumentType?: string;
    convertedFromDocumentId?: string;
    idempotencyKey?: string;
    currency?: string;
    vatMode: AccountingVatMode;
    outputTaxCode?: AccountingOutputTaxCode;
    note?: string;
    adjustmentReasonCode?: AccountingAdjustmentReasonCode;
    adjustmentReasonText?: string;
    lines: Array<{ lineNumber: number; description: string; quantity: string; unitPrice: string; discountAmount?: string; vatRate?: string; whtRate?: string; revenueCategoryId?: string; taxCodeDefinitionId?: string; externalTaxCode?: string; transactionContext?: TransactionTaxContext }>;
  },
): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents`, { method: 'POST', body: JSON.stringify(body) });
}

export async function updateDocument(
  companyId: string,
  documentId: string,
  body: {
    expectedUpdatedAt: string;
    branchId?: string | null;
    documentDate?: string;
    dueDate?: string | null;
    counterpartyId?: string | null;
    currency?: string;
    vatMode?: AccountingVatMode;
    outputTaxCode?: AccountingOutputTaxCode | null;
    note?: string | null;
    internalMemo?: string | null;
    lines?: Array<{ lineNumber: number; productId?: string; skuSnapshot?: string; description: string; unitName?: string; quantity: string; unitPrice: string; discountAmount?: string; vatRate?: string; whtRate?: string; taxCategory?: string; revenueCategory?: string; taxCodeDefinitionId?: string; externalTaxCode?: string; transactionContext?: TransactionTaxContext }>;
  },
): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function issueDocument(companyId: string, documentId: string): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}/issue`, { method: 'POST', body: '{}' });
}

export async function voidDocument(companyId: string, documentId: string, reason: string): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function submitQuotationApproval(companyId: string, documentId: string): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}/submit-approval`, { method: 'POST', body: '{}' });
}

export async function approveQuotation(companyId: string, documentId: string, note?: string): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}/approve`, { method: 'POST', body: JSON.stringify({ note }) });
}

export async function rejectQuotation(companyId: string, documentId: string, note: string): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
}

export async function convertDocument(companyId: string, documentId: string, targetType: AccountingDocumentType): Promise<DocumentDetail> {
  return apiFetch(`/v1/companies/${companyId}/accounting/documents/${documentId}/convert`, { method: 'POST', body: JSON.stringify({ targetType }) });
}

// ---- Payments ----
export async function listPayments(
  companyId: string,
  params?: { direction?: AccountingPaymentDirection; counterpartyId?: string; fromDate?: string; toDate?: string; page?: number },
): Promise<PaginatedResult<PaymentSummary>> {
  return apiFetch(`/v1/companies/${companyId}/accounting/payments${qs(params)}`);
}

export async function createPayment(
  companyId: string,
  // `amount` is cash received; `whtAmount` is tax the customer withheld, which settles the document
  // without reaching the bank and therefore requires an allocation target.
  body: { idempotencyKey?: string; branchId?: string; direction: AccountingPaymentDirection; method: AccountingPaymentMethod; amount: string; whtAmount?: string; paidAt: string; counterpartyId?: string; note?: string; externalReference?: string; allocateToDocumentId?: string },
): Promise<PaymentSummary> {
  return apiFetch(`/v1/companies/${companyId}/accounting/payments`, { method: 'POST', body: JSON.stringify(body) });
}

export function newAccountingPaymentIdempotencyKey(sourceId: string): string {
  return `payment_${sourceId.slice(0, 22)}_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
}

export async function voidPayment(companyId: string, paymentId: string, reason: string): Promise<PaymentSummary> {
  return apiFetch(`/v1/companies/${companyId}/accounting/payments/${paymentId}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Revenue categories (ledger spec F-LED-2) ----
export async function listRevenueCategories(companyId: string): Promise<RevenueCategorySummary[]> {
  return apiFetch(`/v1/companies/${companyId}/revenue-categories`);
}

export async function listManageRevenueCategories(companyId: string): Promise<RevenueCategorySummary[]> {
  return apiFetch(`/v1/companies/${companyId}/revenue-categories/manage`);
}

export async function createRevenueCategory(companyId: string, body: CreateRevenueCategoryInput): Promise<RevenueCategorySummary> {
  return apiFetch(`/v1/companies/${companyId}/revenue-categories`, { method: 'POST', body: JSON.stringify(body) });
}

export async function updateRevenueCategory(companyId: string, categoryId: string, body: UpdateRevenueCategoryInput): Promise<RevenueCategorySummary> {
  return apiFetch(`/v1/companies/${companyId}/revenue-categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---- Simple income bundle (ledger spec F-LED-1) ----
export async function recordSimpleIncome(companyId: string, body: RecordSimpleIncomeInput): Promise<RecordSimpleIncomeResult> {
  return apiFetch(`/v1/companies/${companyId}/accounting/simple-income`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Company VAT registration truth (ledger spec §7.9 / V4) ----
export async function getVatRegistrationStatus(companyId: string, asOf?: string): Promise<{ status: string }> {
  return apiFetch(`/v1/companies/${companyId}/vat-registration${qs({ asOf })}`);
}

export async function uploadAccountingDocumentSupporting(
  companyId: string,
  documentId: string,
  branchId: string | undefined,
  file: File,
): Promise<void> {
  return withGenericUploadError(async () => {
    assertAllowedUploadFile(file);
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `/companies/${companyId}/attachments/upload-intent`,
      {
        method: 'POST',
        body: JSON.stringify({
          originalFileName: file.name,
          mimeType: file.type,
          byteSize: file.size,
          visibility: 'ACCOUNTING',
          ...(branchId ? { branchId } : {}),
        }),
      },
    );
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await apiFetch(`/companies/${companyId}/attachments/${intent.attachmentId}/complete`, {
      method: 'POST', body: JSON.stringify({ byteSize: file.size }),
    });
    await apiFetch(`/companies/${companyId}/attachments/${intent.attachmentId}/links`, {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'accounting.document',
        targetId: documentId,
        purpose: 'accounting.document.supporting',
      }),
    });
  });
}

// ---- Income-expense ledger (P27 Phase 4) ----
export async function getIncomeExpenseLedgerSummary(
  companyId: string,
  params: { from: string; to: string },
): Promise<IncomeExpenseLedgerSummary> {
  return apiFetch(`/v1/companies/${companyId}/income-expense-ledger/summary${qs(params)}`);
}

export async function listIncomeExpenseLedgerEntries(
  companyId: string,
  params: { type: IncomeExpenseLedgerEntryType; categoryId?: string; status?: string; from: string; to: string; page?: number; pageSize?: number },
): Promise<IncomeExpenseLedgerEntries> {
  return apiFetch(`/v1/companies/${companyId}/income-expense-ledger/entries${qs(params)}`);
}

export async function exportIncomeExpenseLedger(
  companyId: string,
  params: { type: IncomeExpenseLedgerEntryType; categoryId?: string; status?: string; from: string; to: string },
): Promise<IncomeExpenseLedgerExport> {
  return apiFetch(`/v1/companies/${companyId}/income-expense-ledger/export${qs(params)}`);
}
