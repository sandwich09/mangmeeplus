import type {
  ExpenseSummary, ExpenseDetail, ExpenseCategorySummary, ExpenseStatus, ExpenseVatMode, InputVatClaimStatus,
  SignatureAssetSummary, SharedEvidenceView, AccountantPackageResult,
} from './expenses.model';
import type {
  ApproveSubstituteReceiptInput,
  CertifySubstituteReceiptInput,
  ExpenseExtractionResult,
  GenerateSubstituteReceiptInput,
  PreviewSubstituteReceiptInput,
  SourceDocumentType,
  SubstituteReceiptEvidenceSummary,
  SubstituteReceiptListFilter,
  SubstituteReceiptListResult,
  SubstituteReceiptPolicySettings,
  SubstituteReceiptRuntimePolicy,
  SubstituteReceiptPreview,
  UpdateSubstituteReceiptPolicyInput,
  UpdateExpenseDraftInput,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch, authedFetch } from '@/common/api/authed-fetch';
import { assertAllowedUploadFile, withGenericUploadError } from '@/common/files/upload-file.logic';
import type { TransactionTaxContext } from '@watchdog-bms/contracts';

// Same-origin: upload URLs stay relative and proxy through the /local-storage rewrite.
const BASE = '';

export function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

export function resolveUploadUrl(uploadUrl: string, base = BASE): string {
  if (/^https?:\/\//i.test(uploadUrl)) return uploadUrl;
  if (/^https?:\/\//i.test(base)) return new URL(uploadUrl, base).toString();
  return uploadUrl;
}

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function readErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null) as { message?: unknown; error?: unknown } | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    if (typeof message === 'string') return message;
    if (typeof body?.error === 'string') return body.error;
  }
  const text = await res.text().catch(() => '');
  if (text.trim().startsWith('<')) return res.status === 404 ? 'ยังไม่พบ API endpoint นี้ หรือ backend ยังไม่ได้รัน' : `API error ${res.status}`;
  return text || `API error ${res.status}`;
}

export async function uploadReceiptFile(
  uploadUrl: string,
  uploadMethod: string,
  file: File,
  uploadHeaders: Record<string, string> = {},
): Promise<void> {
  return withGenericUploadError(async () => {
    assertAllowedUploadFile(file);
    const res = await fetch(resolveUploadUrl(uploadUrl), {
      method: uploadMethod,
      body: file,
      headers: { ...uploadHeaders, 'Content-Type': file.type },
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
  });
}

export async function listExpenses(
  companyId: string,
  params?: {
    status?: ExpenseStatus; branchId?: string; fromDate?: string; toDate?: string; uploadedFromDate?: string; uploadedToDate?: string;
    sourceDocumentType?: string; taxEvidenceStatus?: string; expenseCategoryId?: string; captureSource?: string;
    page?: number; pageSize?: number;
  },
): Promise<{ data: ExpenseSummary[]; total: number; page: number; pageSize: number }> {
  return apiFetch(`/v1/companies/${companyId}/expenses${qs(params)}`);
}

export async function getExpense(companyId: string, expenseId: string): Promise<ExpenseDetail> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`);
}

export async function deleteExpense(companyId: string, expenseId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`, { method: 'DELETE' });
}

export async function createExpenseDraft(
  companyId: string,
  body: {
    captureSource: string;
    expenseDate: string;
    vatMode: ExpenseVatMode;
    inputVatClaimStatus: InputVatClaimStatus;
    branchId?: string;
    note?: string;
    missingReceiptReason?: string;
    lines: Array<{ lineNumber: number; description: string; quantity: string; unitPrice: string; discountAmount?: string; vatRate?: string; whtRate?: string; taxCodeDefinitionId?: string; externalTaxCode?: string; transactionContext?: TransactionTaxContext }>;
  },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses`, { method: 'POST', body: JSON.stringify(body) });
}

export async function updateExpenseDraft(
  companyId: string,
  expenseId: string,
  body: UpdateExpenseDraftInput,
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function updateExpenseReviewFields(
  companyId: string,
  expenseId: string,
  body: UpdateExpenseDraftInput,
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/review-fields`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function overrideNonExpenseClassification(
  companyId: string,
  expenseId: string,
  body: { sourceDocumentType: SourceDocumentType; acknowledged: true; reason: string },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/non-expense-classification-override`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function acknowledgeOcrTotal(
  companyId: string,
  expenseId: string,
  body: { acknowledged: true; acknowledgedTotalAmount: string; reason: string },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/ocr-total-acknowledgement`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function initReceiptUpload(
  companyId: string,
  body: { originalFileName: string; mimeType: string; byteSize: number; expenseDate?: string; branchId?: string; note?: string },
): Promise<{ expenseId: string; attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string>; expiresAt: string }> {
  return withGenericUploadError(async () => {
    assertAllowedUploadFile({ name: body.originalFileName, type: body.mimeType });
    return apiFetch(`/v1/companies/${companyId}/expenses/receipt-uploads`, { method: 'POST', body: JSON.stringify(body) });
  });
}

export async function uploadExpenseEvidenceFile(
  companyId: string,
  expenseId: string,
  branchId: string | null,
  file: File,
  purpose: 'expense.receipt.primary' | 'expense.receipt.supporting' | 'expense.payment.evidence',
): Promise<string> {
  return withGenericUploadError(async () => {
    assertAllowedUploadFile(file);
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `/v1/companies/${companyId}/attachments/upload-intent`,
      {
        method: 'POST',
        body: JSON.stringify({
          originalFileName: file.name,
          mimeType: file.type,
          byteSize: file.size,
          visibility: 'INTERNAL',
          ...(branchId ? { branchId } : {}),
        }),
      },
    );
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await completeReceiptUpload(companyId, expenseId, intent.attachmentId, { byteSize: file.size, purpose });
    return intent.attachmentId;
  });
}

export async function completeReceiptUpload(
  companyId: string,
  expenseId: string,
  attachmentId: string,
  body?: { checksumSha256?: string; byteSize?: number; purpose?: string },
): Promise<ExpenseSummary> {
  return withGenericUploadError(() =>
    apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/receipt-uploads/${attachmentId}/complete`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  );
}

export async function requestExpenseExtraction(companyId: string, expenseId: string): Promise<ExpenseExtractionResult> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/extraction-request`, { method: 'POST', body: '{}' });
}

export async function getAttachmentDownloadUrl(companyId: string, attachmentId: string, options?: { disposition?: 'inline' }): Promise<{ downloadUrl: string; expiresAt: string }> {
  // `inline` is for <img>/<iframe> previews: Chrome's ORB blocks attachment-disposition responses
  // there. The server only honours it for image/png, image/jpeg and application/pdf.
  return apiFetch(`/v1/companies/${companyId}/attachments/${attachmentId}/download-url${options?.disposition === 'inline' ? '?disposition=inline' : ''}`);
}

export async function markExpenseReady(companyId: string, expenseId: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/mark-ready`, { method: 'POST', body: '{}' });
}

export async function markExpenseReadyAsReviewer(companyId: string, expenseId: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/reviewer-mark-ready`, { method: 'POST', body: '{}' });
}

export async function confirmExpense(companyId: string, expenseId: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/confirm`, { method: 'POST', body: '{}' });
}

export async function rejectExpense(companyId: string, expenseId: string, reason: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function voidExpense(companyId: string, expenseId: string, reason: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function recordExpensePayment(
  companyId: string,
  expenseId: string,
  body: { paidAmount: string; paymentMethod?: string; paidAt?: string; bankAccountRef?: string },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/payment`, { method: 'POST', body: JSON.stringify(body) });
}

export async function runDuplicateCheck(companyId: string, expenseId: string): Promise<{ candidatesCreated: number; openCandidates: number }> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/duplicate-check`, { method: 'POST', body: '{}' });
}

export async function dismissDuplicate(companyId: string, expenseId: string, candidateId: string, reason?: string): Promise<void> {
  await apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/duplicates/${candidateId}/dismiss`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function confirmDuplicate(companyId: string, expenseId: string, candidateId: string, reason: string): Promise<void> {
  await apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/duplicates/${candidateId}/confirm`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function listExpenseCategories(companyId: string): Promise<ExpenseCategorySummary[]> {
  return apiFetch(`/v1/companies/${companyId}/expense-categories`);
}

// ── Category management (expense.category.manage) ────────────────────────────

export async function listManageCategories(companyId: string): Promise<ExpenseCategorySummary[]> {
  return apiFetch(`/v1/companies/${companyId}/expense-categories/manage`);
}

export async function createExpenseCategory(
  companyId: string,
  body: { name: string; accountHintKey: string; defaultInputTaxCode?: string; sortOrder?: number },
): Promise<ExpenseCategorySummary> {
  return apiFetch(`/v1/companies/${companyId}/expense-categories`, { method: 'POST', body: JSON.stringify(body) });
}

export async function updateExpenseCategory(
  companyId: string,
  categoryId: string,
  body: { name?: string; accountHintKey?: string; defaultInputTaxCode?: string | null; sortOrder?: number; status?: 'ACTIVE' | 'ARCHIVED' },
): Promise<ExpenseCategorySummary> {
  return apiFetch(`/v1/companies/${companyId}/expense-categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Substitute receipt + signature fill (web review actions) ─────────────────

export async function listCompanySubstituteReceipts(
  companyId: string,
  filter: SubstituteReceiptListFilter = {},
): Promise<SubstituteReceiptListResult> {
  return apiFetch(`/v1/companies/${companyId}/substitute-receipts${qs(filter)}`);
}

export async function generateSubstituteReceipt(companyId: string, expenseId: string, body: GenerateSubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt`, { method: 'POST', body: JSON.stringify(body) });
}

export async function downloadSubstituteReceiptPdf(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  documentNumber: string,
): Promise<void> {
  const res = await authedFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/artifact.pdf`);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  downloadBlob(await res.blob(), `${documentNumber}.pdf`);
}

export async function downloadPaymentVoucherPdf(
  companyId: string,
  expenseId: string,
  expenseNumber: string | null,
  params: { paymentDate?: string; payeeName?: string; payeeAddress?: string; payeeTaxId?: string },
): Promise<void> {
  const res = await authedFetch(`/v1/companies/${companyId}/expenses/${expenseId}/payment-voucher.pdf${qs(params)}`);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  downloadBlob(await res.blob(), `ใบสำคัญรับเงิน-${expenseNumber ?? expenseId}.pdf`);
}

export async function previewSubstituteReceipt(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  body: PreviewSubstituteReceiptInput,
): Promise<SubstituteReceiptPreview> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listSubstituteReceiptPayers(companyId: string, expenseId: string): Promise<Array<{ userId: string; displayName: string }>> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/payers`);
}

export async function listSubstituteReceiptHistory(companyId: string, expenseId: string): Promise<SubstituteReceiptEvidenceSummary[]> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/history`);
}

export async function supersedeSubstituteReceipt(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  body: { reason: string; expectedEvidenceUpdatedAt: string },
): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/supersede`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function initPersonalSignatureUpload(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  file: File,
): Promise<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string>; expiresAt: string }> {
  return withGenericUploadError(async () => {
    assertAllowedUploadFile(file, 'image');
    return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/signature-upload-intent`, {
      method: 'POST',
      body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size, visibility: 'INTERNAL' }),
    });
  });
}

export async function completePersonalSignatureUpload(companyId: string, expenseId: string, evidenceId: string, attachmentId: string, byteSize: number): Promise<void> {
  await withGenericUploadError(() =>
    apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/signature-uploads/${attachmentId}/complete`, {
      method: 'POST', body: JSON.stringify({ byteSize }),
    }),
  );
}

export async function certifySubstituteReceipt(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  body: CertifySubstituteReceiptInput,
): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/certify`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function approveSubstituteReceipt(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  body: ApproveSubstituteReceiptInput,
): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/approve`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function getSubstituteReceiptPolicy(companyId: string): Promise<SubstituteReceiptPolicySettings> {
  return apiFetch(`/v1/companies/${companyId}/expense-settings/substitute-receipt`);
}

export async function getSubstituteReceiptRuntimePolicy(companyId: string): Promise<SubstituteReceiptRuntimePolicy> {
  return apiFetch(`/v1/companies/${companyId}/expense-settings/substitute-receipt/runtime`);
}

export async function updateSubstituteReceiptPolicy(
  companyId: string,
  body: UpdateSubstituteReceiptPolicyInput,
): Promise<SubstituteReceiptPolicySettings> {
  return apiFetch(`/v1/companies/${companyId}/expense-settings/substitute-receipt`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function fillSignature(
  companyId: string,
  expenseId: string,
  body: { signatureAssetId: string; renderedAttachmentId?: string; placeholder?: string },
): Promise<{ fillId: string; appliedAt: string }> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/signature-fill`, { method: 'POST', body: JSON.stringify(body) });
}

// ── Company signature assets ──────────────────────────────────────────────────

export async function listSignatureAssets(companyId: string, status?: string): Promise<SignatureAssetSummary[]> {
  return apiFetch(`/v1/companies/${companyId}/expense-signatures${qs({ status })}`);
}

export async function initSignatureUpload(
  companyId: string,
  body: { originalFileName: string; mimeType: string; byteSize: number },
): Promise<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string>; expiresAt: string }> {
  return withGenericUploadError(async () => {
    assertAllowedUploadFile({ name: body.originalFileName, type: body.mimeType }, 'image');
    return apiFetch(`/v1/companies/${companyId}/expense-signatures/uploads`, { method: 'POST', body: JSON.stringify(body) });
  });
}

export async function createSignatureAsset(
  companyId: string,
  body: { attachmentId: string; label?: string; byteSize?: number; checksumSha256?: string },
): Promise<SignatureAssetSummary> {
  return withGenericUploadError(() =>
    apiFetch(`/v1/companies/${companyId}/expense-signatures`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

export async function approveSignatureAsset(companyId: string, signatureId: string): Promise<SignatureAssetSummary> {
  return apiFetch(`/v1/companies/${companyId}/expense-signatures/${signatureId}/approve`, { method: 'POST', body: '{}' });
}

export async function rejectSignatureAsset(companyId: string, signatureId: string, reason: string): Promise<SignatureAssetSummary> {
  return apiFetch(`/v1/companies/${companyId}/expense-signatures/${signatureId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function archiveSignatureAsset(companyId: string, signatureId: string): Promise<SignatureAssetSummary> {
  return apiFetch(`/v1/companies/${companyId}/expense-signatures/${signatureId}/archive`, { method: 'POST', body: '{}' });
}

export async function setSignatureDerivedAsset(
  companyId: string,
  signatureId: string,
  body: { attachmentId: string; byteSize?: number; checksumSha256?: string },
): Promise<SignatureAssetSummary> {
  return withGenericUploadError(() =>
    apiFetch(`/v1/companies/${companyId}/expense-signatures/${signatureId}/derived`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

// ── Accountant shared evidence + export package ───────────────────────────────

export async function getSharedEvidence(
  companyId: string,
  params?: {
    dateField?: 'uploadedAt' | 'expenseDate'; fromDate?: string; toDate?: string; yearMonth?: string;
    status?: string; sourceDocumentType?: string; taxEvidenceStatus?: string; expenseCategoryId?: string;
    paymentStatus?: string; postingStatus?: string; page?: number; pageSize?: number;
  },
): Promise<SharedEvidenceView> {
  return apiFetch(`/v1/companies/${companyId}/expenses/shared-evidence${qs(params)}`);
}

export async function createAccountantPackage(
  companyId: string,
  body: Record<string, unknown>,
): Promise<AccountantPackageResult> {
  return apiFetch(`/v1/companies/${companyId}/expenses/accountant-package`, { method: 'POST', body: JSON.stringify(body) });
}

/** Saves the package index as a real .xlsx (headers are Thai labels, amounts are numbers). */
export function downloadIndexXlsx(result: AccountantPackageResult, fileName: string): void {
  const bytes = Uint8Array.from(atob(result.indexXlsxBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}
