import { WHT_EXTERNAL_FILE } from '@watchdog-bms/contracts';
import { uploadPaymentSlip } from '@/common/files/slip-upload.api';
import { SIGNATURE_FILE_TYPES_LABEL } from '@watchdog-bms/contracts';
import { removeSubstituteReceiptDisplayMetadata } from '@watchdog-bms/contracts';
import type {
  ExpenseSummary, ExpenseDetail, ExpenseCategorySummary, ExpenseStatus,
  SignatureAssetSummary, SharedEvidenceView, AccountantPackageResult,
} from './expenses.model';
import type { ExpenseReadStatusResult } from './expense-capture-status.logic';
import type {
  AccountantEvidenceBundlePlan,
  CompleteExpenseReceiptUploadInput,
  ExpenseCaptureCapabilityDto,
  ApproveSubstituteReceiptInput,
  CertifySubstituteReceiptInput,
  CreateExpenseDraftInput,
  ExpenseExtractionResult,
  ExpenseVatSourceOverrideInput,
  GenerateSubstituteReceiptInput,
  AmendSubstituteReceiptInput,
  LineSubstituteReceiptPrefill,
  PreviewSubstituteReceiptInput,
  RecordExpensePaymentInput,
  RemoveExpenseReceiptInput,
  SourceDocumentType,
  SubstituteReceiptEvidenceSummary,
  SubstituteReceiptListFilter,
  SubstituteReceiptListResult,
  SubstituteReceiptPolicySettings,
  SubstituteReceiptRuntimePolicy,
  SubstituteReceiptPreview,
  UpdateSubstituteReceiptPolicyInput,
  UpdateExpenseDraftInput,
  ExpenseSourceDraftInput,
  ExpenseDraftTotalsPreview,
  ExpenseHistoryResult,
  WhtCertificateHandoffDto,
  WhtCertificateHandoffPageDto,
  WhtCertificateDto,
  WhtCertificateHistoryDto,
} from '@watchdog-bms/contracts';
import type { TaxExportArtifact } from '../tax/tax.api';
import { authedApiFetch as apiFetch, authedFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { emitToast } from '@/common/feedback/toast-bus';
import { assertAllowedUploadFile, prepareAttachmentUpload, withGenericUploadError } from '@/common/files/upload-file.logic';

// Same-origin: upload URLs stay relative and proxy through the /local-storage rewrite.
const BASE = '';
const PREVIEW_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf']);
const PREVIEW_SIGNATURE_READ_BYTES = 4096;

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

export async function responseError(res: Response): Promise<Error> {
  const body = await res.clone().json().catch(() => null) as Record<string, unknown> | null;
  const requestId = res.headers.get('x-request-id');
  const details = requestId && typeof body?.['requestId'] !== 'string'
    ? { ...body, requestId }
    : body;
  return Object.assign(new Error(await readErrorMessage(res)), {
    status: res.status,
    ...(details && { details }),
    ...(typeof body?.['code'] === 'string' && { code: body['code'] }),
  });
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
    /** GAP-11: full tax invoices whose seller address is still empty. The API pins the document
     *  type itself, so this is the whole filter — `qs` sends the literal `true` it looks for. */
    vendorAddressMissing?: boolean;
    page?: number; pageSize?: number;
  },
): Promise<{ data: ExpenseSummary[]; total: number; page: number; pageSize: number }> {
  return apiFetch(`/v1/companies/${companyId}/expenses${qs(params)}`);
}

export async function getExpense(companyId: string, expenseId: string): Promise<ExpenseDetail> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`);
}

export async function getExpenseHistory(companyId: string, expenseId: string, page = 1): Promise<ExpenseHistoryResult> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/history${qs({ page })}`);
}

export async function removeExpenseReceipt(companyId: string, expenseId: string, attachmentId: string, body: RemoveExpenseReceiptInput): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/receipts/${attachmentId}`, { method: 'DELETE', body: JSON.stringify(body) });
}

export async function deleteExpense(companyId: string, expenseId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`, { method: 'DELETE' });
}

export async function createExpenseDraft(
  companyId: string,
  body: CreateExpenseDraftInput,
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses`, { method: 'POST', body: JSON.stringify(body) });
}

export async function updateExpenseDraft(
  companyId: string,
  expenseId: string,
  body: UpdateExpenseDraftInput & { expectedUpdatedAt: string },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** No receipt mutation: same authoritative calculation as the following save. */
export async function previewExpenseDraftTotals(companyId: string, expenseId: string,
  body: UpdateExpenseDraftInput & { expectedUpdatedAt: string }, signal?: AbortSignal): Promise<ExpenseDraftTotalsPreview> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/totals-preview`, {
    method: 'POST', body: JSON.stringify(body), signal, suppressErrorToast: true,
  });
}

/** Source-fact saves stay on the narrow contract; they cannot carry financial review fields. */
export async function updateExpenseSourceDraft(
  companyId: string,
  expenseId: string,
  expectedUpdatedAt: string,
  sourceDraft: ExpenseSourceDraftInput,
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedUpdatedAt, sourceDraft }),
  });
}

export async function updateExpenseReviewFields(
  companyId: string,
  expenseId: string,
  body: UpdateExpenseDraftInput & { expectedUpdatedAt: string },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/review-fields`, { method: 'PATCH', suppressErrorToast: true, body: JSON.stringify(body) });
}

export async function overrideNonExpenseClassification(
  companyId: string,
  expenseId: string,
  body: { sourceDocumentType: SourceDocumentType; acknowledged: true; reason: string; expectedUpdatedAt: string },
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/non-expense-classification-override`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function acknowledgeOcrTotal(
  companyId: string,
  expenseId: string,
  body: { acknowledged: true; acknowledgedTotalAmount: string; reason: string; expectedUpdatedAt: string },
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
  /** Spec §16.4: which intent this is, and the revision/target the user was looking at. */
  fileIntent?: Omit<CompleteExpenseReceiptUploadInput, 'byteSize' | 'purpose' | 'checksumSha256'>,
): Promise<string> {
  return withGenericUploadError(async () => {
    file = await prepareAttachmentUpload(file);
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
          metadataJson: { expenseReceiptExpenseId: expenseId },
        }),
      },
    );
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await completeReceiptUpload(companyId, expenseId, intent.attachmentId, { byteSize: file.size, purpose, ...fileIntent });
    return intent.attachmentId;
  });
}

export async function completeReceiptUpload(
  companyId: string,
  expenseId: string,
  attachmentId: string,
  body?: CompleteExpenseReceiptUploadInput,
): Promise<ExpenseSummary> {
  return withGenericUploadError(() =>
    apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/receipt-uploads/${attachmentId}/complete`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  );
}

// ── Capture (appendix §25): the capability the panel reads, and the read status ─────────────
//
// The allocation/group routes stay on the server (dormant, permission-checked) but nothing in the
// web calls them any more — the owner withdrew the group screens on 2026-09-19.

export async function getExpenseCaptureCapability(companyId: string): Promise<ExpenseCaptureCapabilityDto> {
  return apiFetch(`/v1/companies/${companyId}/expenses/capture-capability`);
}

/** Polling read (appendix §9). It neither starts, resumes nor re-prices a read. */
export async function getExpenseReadStatus(
  companyId: string,
  expenseId: string,
): Promise<ExpenseReadStatusResult> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/read-status`);
}

export async function requestExpenseExtraction(companyId: string, expenseId: string, requestId?: string): Promise<ExpenseExtractionResult> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/extraction-request`, {
    method: 'POST',
    body: '{}',
    ...(requestId ? { headers: { 'X-Request-Id': requestId } } : {}),
  });
}

export async function getAttachmentDownloadUrl(companyId: string, attachmentId: string, options?: { disposition?: 'inline' }): Promise<{ downloadUrl: string; expiresAt: string }> {
  // The preview path fetches this URL as bytes before creating a Blob URL. `inline` keeps safe
  // PNG/JPEG/PDF responses browser-friendly; SVG deliberately remains attachment-only server-side.
  return apiFetch(`/v1/companies/${companyId}/attachments/${attachmentId}/download-url${options?.disposition === 'inline' ? '?disposition=inline' : ''}`);
}

function checkedPreviewMimeType(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]!.trim().toLowerCase();
  if (!PREVIEW_MIME_TYPES.has(normalized)) throw new Error('ไม่รองรับไฟล์ชนิดนี้สำหรับการดูตัวอย่าง');
  return normalized;
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function isExpectedSvgMarkup(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes).trimStart();
  if (/^(?:<!doctype\s+html\b|<html\b)/i.test(text)) return false;
  if (/^<svg(?:\s|>)/i.test(text)) return true;
  if (!text.startsWith('<?xml')) return false;
  const declarationEnd = text.indexOf('?>');
  if (declarationEnd < 0) return false;
  const root = text.slice(declarationEnd + 2).trimStart();
  if (/^(?:<!doctype\s+html\b|<html\b)/i.test(root)) return false;
  return /^<svg(?:\s|>)/i.test(root);
}

async function assertPreviewBlobSignature(blob: Blob, mimeType: string): Promise<void> {
  const bytes = new Uint8Array(await blob.slice(0, PREVIEW_SIGNATURE_READ_BYTES).arrayBuffer());
  const valid = mimeType === 'application/pdf'
    ? startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
    : mimeType === 'image/png'
      ? startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : mimeType === 'image/jpeg'
        ? startsWithBytes(bytes, [0xff, 0xd8]) // JPEG start-of-image marker
        : mimeType === 'image/svg+xml' && isExpectedSvgMarkup(bytes);
  if (!valid) throw new Error('เนื้อหาไฟล์สำหรับดูตัวอย่างไม่ตรงกับชนิดเอกสาร');
}

export async function checkedPreviewBlob(response: Response, expectedMimeType?: string): Promise<Blob> {
  if (!response.ok) throw new Error(apiErrorMessage({ status: response.status }));
  // The storage response is authoritative when older DTOs expose only an attachment ID.
  // It must still be one of the renderer's exact allowlisted MIME types.
  const actual = checkedPreviewMimeType(response.headers.get('content-type') ?? '');
  if (expectedMimeType !== undefined && actual !== checkedPreviewMimeType(expectedMimeType)) {
    throw new Error('ชนิดไฟล์สำหรับดูตัวอย่างไม่ตรงกับข้อมูลเอกสาร');
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('ไฟล์สำหรับดูตัวอย่างไม่มีข้อมูล');
  await assertPreviewBlobSignature(blob, actual);
  return blob;
}

/** The bytes behind a signed download URL, under the same checks every preview gets (type allowlist, magic bytes). */
export async function fetchSignedPreviewBlob(downloadUrl: string, expectedMimeType?: string): Promise<Blob> {
  return checkedPreviewBlob(await fetch(resolveUploadUrl(downloadUrl), { mode: 'cors', credentials: 'omit' }), expectedMimeType);
}

export async function fetchAttachmentPreviewBlob(
  companyId: string,
  attachmentId: string,
  expectedMimeType?: string,
): Promise<Blob> {
  if (expectedMimeType !== undefined) checkedPreviewMimeType(expectedMimeType);
  const { downloadUrl } = await getAttachmentDownloadUrl(companyId, attachmentId, { disposition: 'inline' });
  const blob = await fetchSignedPreviewBlob(downloadUrl, expectedMimeType);
  return blob.type === 'image/svg+xml'
    ? new Blob([removeSubstituteReceiptDisplayMetadata(await blob.text())], { type: blob.type })
    : blob;
}

export async function markExpenseReady(companyId: string, expenseId: string, requestedReviewerUserId?: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/mark-ready`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ ...(requestedReviewerUserId && { requestedReviewerUserId }) }) });
}

export async function markExpenseReadyAsReviewer(companyId: string, expenseId: string, requestedReviewerUserId?: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/reviewer-mark-ready`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ ...(requestedReviewerUserId && { requestedReviewerUserId }) }) });
}

/** Plan 13.11.B: `vatSourceOverride` is the reviewer's "ใช้ยอดตามเอกสาร"; omitted, this is the
 *  ordinary confirm and an unreconciled VAT total still blocks. */
export async function confirmExpense(
  companyId: string,
  expenseId: string,
  vatSourceOverride?: ExpenseVatSourceOverrideInput,
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/confirm`, {
    method: 'POST', suppressErrorToast: true,
    body: JSON.stringify(vatSourceOverride ? { vatSourceOverride } : {}),
  });
}

export async function rejectExpense(companyId: string, expenseId: string, reason: string): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/reject`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ reason }) });
}

export async function voidExpense(companyId: string, expenseId: string, reason: string, taxFilingAttested?: true): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/void`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ reason, ...(taxFilingAttested === true ? { taxFilingAttested } : {}) }) });
}

export async function recordExpensePayment(
  companyId: string,
  expenseId: string,
  body: RecordExpensePaymentInput,
): Promise<ExpenseSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/payment`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify(body) });
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

/** Vendor-address §8 Slice 2: "ยืนยันว่าใช้ได้ พร้อมเหตุผล" on a printed buyer that does not match the registry. */
export async function confirmExpenseBuyerMatch(companyId: string, expenseId: string, reason: string): Promise<void> {
  await apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/buyer-match/confirm`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function listExpenseCategories(companyId: string): Promise<ExpenseCategorySummary[]> {
  return apiFetch(`/v1/companies/${companyId}/expense-categories`);
}

export type WhtIncomeCategoryOption = { filingRoute?: import('@watchdog-bms/contracts').WhtFilingRoute; code: string; nameTh: string; formType: string; defaultRate: string };

/**
 * ACTIVE income categories only (WHT certificate system issuance plan §1.2, mirrors
 * accounts-payable.api.ts's listWhtIncomeCategories). The catalog ships DRAFT pending accountant
 * review, so an empty list means withholding is not set up yet — not that the endpoint failed.
 */
export async function listExpenseWhtIncomeCategories(companyId: string): Promise<WhtIncomeCategoryOption[]> {
  return apiFetch(`/v1/companies/${companyId}/expenses/wht-income-categories`);
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

export async function generateSubstituteReceipt(companyId: string, expenseId: string, body: GenerateSubstituteReceiptInput, locale: 'th' | 'en' = 'th'): Promise<SubstituteReceiptEvidenceSummary> {
  try {
    return await apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt`, { method: 'POST', body: JSON.stringify(body), suppressErrorToast: true });
  } catch (error) {
    emitToast({ tone: 'error', message: apiErrorMessage(error, locale) });
    throw error;
  }
}

export async function amendSubstituteReceipt(companyId: string, expenseId: string, evidenceId: string, body: AmendSubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function loadLineSubstituteReceiptPrefill(
  companyId: string,
  expenseId: string,
  workflowId: string,
): Promise<LineSubstituteReceiptPrefill> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/continuations/${encodeURIComponent(workflowId)}`);
}

export async function downloadSubstituteReceiptPdf(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  documentNumber: string,
): Promise<void> {
  downloadBlob(await fetchSubstituteReceiptPdfBlob(companyId, expenseId, evidenceId), `${documentNumber}.pdf`);
}

export async function fetchSubstituteReceiptPdfBlob(
  companyId: string,
  expenseId: string,
  evidenceId: string,
): Promise<Blob> {
  const response = await authedFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/artifact.pdf`);
  if (!response.ok) throw await responseError(response);
  return checkedPreviewBlob(response, 'application/pdf');
}

/** R8 `แบบฟอร์มรอลงนาม`: derived from the PREPARED snapshot on every request, never stored, so there
 *  is no attachment id to pass and nothing to open as "the issued document". */
export async function downloadSubstituteReceiptFormPdf(
  companyId: string,
  expenseId: string,
  evidenceId: string,
  documentNumber: string,
): Promise<void> {
  const response = await authedFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/form.pdf`);
  if (!response.ok) throw await responseError(response);
  downloadBlob(await checkedPreviewBlob(response, 'application/pdf'), `${documentNumber}-UNSIGNED.pdf`);
}

export async function downloadPaymentVoucherPdf(
  companyId: string,
  expenseId: string,
  expenseNumber: string | null,
  params: { paymentDate?: string; payeeName?: string; payeeAddress?: string; payeeTaxId?: string },
): Promise<void> {
  const res = await authedFetch(`/v1/companies/${companyId}/expenses/${expenseId}/payment-voucher.pdf${qs(params)}`);
  if (!res.ok) throw await responseError(res);
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

export async function listSubstituteReceiptPayers(companyId: string, expenseId: string): Promise<Array<{ userId: string; displayName: string; isOwner?: boolean }>> {
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

export async function correctSubstituteDocument(companyId: string, expenseId: string, evidenceId: string, body: { reason: string; expectedEvidenceUpdatedAt: string }): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/correct-document`, { method: 'POST', body: JSON.stringify(body) });
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
      body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size }),
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
    branchId?: string;
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

export async function planAccountantEvidenceBundle(companyId: string, body: Record<string, unknown>): Promise<AccountantEvidenceBundlePlan> {
  return apiFetch(`/v1/companies/${companyId}/expenses/accountant-package/bundle-plan`, { method: 'POST', body: JSON.stringify(body), suppressErrorToast: true });
}

export async function fetchAccountantEvidenceBundle(companyId: string, body: Record<string, unknown>, part: number): Promise<{ blob: Blob; fileName: string }> {
  const response = await authedFetch(`/v1/companies/${companyId}/expenses/accountant-package/bundle/${part}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw await responseError(response);
  const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('content-disposition') ?? '')?.[1];
  const blob = await response.blob();
  if (blob.type.split(';')[0] !== 'application/zip' || blob.size === 0) throw new Error('ดาวน์โหลดไฟล์ไม่สำเร็จ ลองอีกครั้ง');
  return { blob, fileName: name ? decodeURIComponent(name) : 'หลักฐาน.zip' };
}

/** Saves the package index as a real .xlsx (headers are Thai labels, amounts are numbers). */
export function downloadIndexXlsx(result: AccountantPackageResult, fileName = 'รายจ่าย.xlsx'): void {
  const bytes = Uint8Array.from(atob(result.indexXlsxBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, fileName);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export async function submitSubstitutePaperFile(companyId: string, expenseId: string, evidenceId: string, file: File, input: Omit<import('@watchdog-bms/contracts').SubmitSubstituteReceiptPaperInput, 'attachmentId' | 'checksumSha256' | 'byteSize'>): Promise<SubstituteReceiptEvidenceSummary> {
  file = await prepareAttachmentUpload(file);
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 10_000_000) throw new Error(`ใช้ PDF หรือ${SIGNATURE_FILE_TYPES_LABEL} ขนาดไม่เกิน 10 เมกะไบต์`);
  const base = `/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/paper`;
  const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(`${base}/upload-intent`, {
    method: 'POST', body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size }),
  });
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const checksumSha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
  return apiFetch(`${base}/submit`, { method: 'POST', body: JSON.stringify({ ...input, attachmentId: intent.attachmentId, checksumSha256, byteSize: file.size }) });
}

export function previewIssuedSubstitutePaper(companyId: string, expenseId: string, evidenceId: string): Promise<import('@watchdog-bms/contracts').SubstituteReceiptPaperPreview> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/artifact-preview`);
}

export function previewSubstitutePaper(companyId: string, expenseId: string, evidenceId: string): Promise<import('@watchdog-bms/contracts').SubstituteReceiptPaperPreview> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/paper/preview`, { method: 'POST' });
}

export function acceptSubstitutePaper(companyId: string, expenseId: string, evidenceId: string, input: import('@watchdog-bms/contracts').AcceptSubstituteReceiptPaperInput): Promise<SubstituteReceiptEvidenceSummary> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/${evidenceId}/paper/accept`, { method: 'POST', body: JSON.stringify(input) });
}

// ── WHT certificate system issuance (plan §4.2) ───────────────────────────────
// Same Tax-module endpoints accounts-payable.api.ts already calls — each module keeps its own thin
// copy rather than a shared cross-feature client (repo convention).

export function listWhtHandoffs(companyId: string, params?: { status?: string; sourcePaymentId?: string }): Promise<WhtCertificateHandoffDto[]> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs${qs(params)}`);
}

export function listWhtHandoffsPaged(companyId: string, params: { status?: string; sourcePaymentId?: string; search?: string; branchId?: string; page: number; pageSize: number }): Promise<WhtCertificateHandoffPageDto> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs${qs(params)}`, { suppressErrorToast: true });
}

export function linkExternalWhtCertificate(companyId: string, handoffId: string, body: import('@watchdog-bms/contracts').LinkExternalWhtCertificateDto): Promise<WhtCertificateHandoffDto> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/external-certificate`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify(body) });
}

export function changeExternalWhtCertificate(companyId: string, handoffId: string, body: import('@watchdog-bms/contracts').ChangeExternalWhtCertificateDto): Promise<WhtCertificateHandoffDto> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/external-certificate/change`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify(body) });
}

export function removeExternalWhtCertificate(companyId: string, handoffId: string, body: import('@watchdog-bms/contracts').RemoveExternalWhtCertificateDto): Promise<WhtCertificateHandoffDto> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/external-certificate/remove`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify(body) });
}

export function setWhtHandoffPayeeAddress(companyId: string, handoffId: string, body: import('@watchdog-bms/contracts').SetWhtHandoffPayeeAddressDto): Promise<WhtCertificateHandoffDto> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/payee-address`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify(body) });
}

// A refusal is shown where the person pressed, once; callers may still pass their own options.
export function issueSystemWhtCertificate(companyId: string, handoffId: string, options?: { suppressErrorToast?: boolean; paymentId?: string }): Promise<WhtCertificateDto & { pdfArtifact: TaxExportArtifact }> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/system-certificate`, { method: 'POST', suppressErrorToast: true, ...options, body: JSON.stringify({ paymentId: options?.paymentId }) });
}

// Correction & replacement plan §5.2 — same endpoints accounts-payable.api.ts calls.
export function correctSystemWhtCertificate(companyId: string, handoffId: string, body: import('@watchdog-bms/contracts').CorrectWhtCertificateDto): Promise<WhtCertificateDto & { pdfArtifact: TaxExportArtifact }> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/system-certificate/correction`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify(body) });
}

export function issueSystemWhtReplacementCopy(companyId: string, handoffId: string, options?: { suppressErrorToast?: boolean }): Promise<WhtCertificateDto & { pdfArtifact: TaxExportArtifact }> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/system-certificate/replacement-copy`, { method: 'POST', ...options });
}


export function reopenExpense(companyId: string, expenseId: string, reason: string, taxFilingAttested?: true) {
  return apiFetch<ExpenseDetail>(`/v1/companies/${companyId}/expenses/${expenseId}/reopen`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ reason, ...(taxFilingAttested === true ? { taxFilingAttested } : {}) }) });
}

export function getExpenseCertificateHistory(companyId: string, expenseId: string): Promise<WhtCertificateHistoryDto[]> {
  return apiFetch(`/companies/${companyId}/wht/expenses/${expenseId}/certificate-history`, { suppressErrorToast: true });
}

export function cancelExpensePayment(companyId: string, expenseId: string, paymentId: string, reason: string) {
  return apiFetch<ExpenseDetail>(`/v1/companies/${companyId}/expenses/${expenseId}/payments/${paymentId}/cancel`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ reason }) });
}

export function downloadSystemWhtCertificate(companyId: string, handoffId: string, options?: { suppressErrorToast?: boolean }): Promise<WhtCertificateDto & { pdfArtifact: TaxExportArtifact }> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/system-certificate`, options);
}

export async function getExpenseReviewers(companyId: string, expenseId: string): Promise<Array<{ userId: string; displayName: string }>> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/reviewers`, { suppressErrorToast: true });
}

export async function decideExpenseInputVat(companyId: string, expenseId: string, input: import('@watchdog-bms/contracts').DecideExpenseInputVatInput): Promise<import('@watchdog-bms/contracts').ExpenseInputVatRightView> {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/input-vat-decision`, { method: 'POST', body: JSON.stringify(input) });
}

export function uploadExpensePaymentSlip(companyId: string, expenseId: string, file: File): Promise<string> {
  return uploadPaymentSlip(`/v1/companies/${companyId}/expenses/${expenseId}/payments`, file,
    { code: 'payment_slip_invalid', message: 'แนบ PDF หรือรูปภาพ ไม่เกิน 10 เมกะไบต์' }, true);
}

export function confirmExpensePaymentDate(companyId: string, expenseId: string, paymentId: string, paidAt: string) {
  return apiFetch(`/v1/companies/${companyId}/expenses/${expenseId}/payments/${paymentId}/confirm-date`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ paidAt }) });
}


export async function uploadExternalWhtFile(companyId: string, handoffId: string, file: File): Promise<string> {
  if (file.size <= 0 || file.size > WHT_EXTERNAL_FILE.maxBytes) throw Error(WHT_EXTERNAL_FILE.invalid);
  file = await prepareAttachmentUpload(file);
  if (file.size > WHT_EXTERNAL_FILE.maxBytes) throw Error(WHT_EXTERNAL_FILE.invalid);
  const endpoint = `/companies/${companyId}/wht/payment-handoffs/${handoffId}/external-certificate`;
  const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(`${endpoint}/file-upload-intent`, {
    method: 'POST', body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size }),
  });
  await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
  await apiFetch(`${endpoint}/file-uploads/${intent.attachmentId}/complete`, { method: 'POST', body: JSON.stringify({ byteSize: file.size }) });
  return intent.attachmentId;
}

export function getExternalWhtFile(companyId: string, handoffId: string, attachmentId: string): Promise<{ downloadUrl: string; name: string; mimeType: string }> {
  return apiFetch(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/external-certificate/files/${attachmentId}`);
}

export function setCategoryAccountantAccount(companyId: string, categoryId: string, input: import('@watchdog-bms/contracts').SetExpenseCategoryAccountantAccountInput) {
  return apiFetch<import('@watchdog-bms/contracts').ExpenseCategoryAccountantAccount>(`/v1/companies/${companyId}/expense-categories/${categoryId}/accountant-account`, { method: 'PUT', body: JSON.stringify(input), suppressErrorToast: true });
}
export function clearCategoryAccountantAccount(companyId: string, categoryId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/expense-categories/${categoryId}/accountant-account`, { method: 'DELETE', suppressErrorToast: true });
}
export function createAccountingSoftwareExport(companyId: string, input: import('@watchdog-bms/contracts').AccountingSoftwareExportRequest) {
  return apiFetch<import('@watchdog-bms/contracts').AccountingSoftwareExportResult>(`/v1/companies/${companyId}/expenses/accounting-software-export`, { method: 'POST', body: JSON.stringify(input), suppressErrorToast: true });
}
export function downloadAccountingSoftwareExport(result: import('@watchdog-bms/contracts').AccountingSoftwareExportResult): void {
  for (const file of result.files) {
    const bytes = Uint8Array.from(atob(file.xlsxBase64), character => character.charCodeAt(0));
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file.fileName);
  }
}
