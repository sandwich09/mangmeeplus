import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
// resolveUploadUrl is no longer imported here: the direct fetch was replaced by the shared
// uploadReceiptFile helper, which resolves the URL and turns a failed PUT into a readable message.
import { fetchSignedPreviewBlob, uploadReceiptFile as uploadFileToStorage } from '../expenses/expenses.api';
import { prepareAttachmentUpload, withGenericUploadError } from '@/common/files/upload-file.logic';
import {
  REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES,
  type ReimbursementApproverRoleOption, type ReimbursementInternalNote, type ReimbursementPolicySummary, type ReimbursementSourceOptions,
} from '@watchdog-bms/contracts';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const base = (companyId: string) => `/companies/${companyId}/reimbursements`;

export type ReimbursementDraftActionResponse =
  | { status: 'preview'; preview: any }
  | { status: 'applied'; receipt: Record<string, any> }
  | { status: 'needs_fields'; actionId: string; fieldPaths: string[]; actionRevision: number }
  | { status: 'needs_target'; actionId: string; actionRevision: number }
  | { status: 'cancelled' | 'expired' | 'stale' | 'result_unknown'; actionId: string; errorCode?: string }
  | { status: 'blocked'; errorCode: string; retryAfter?: number };

export function getReimbursementDraftAction(companyId: string, actionId: string) {
  return apiFetch<ReimbursementDraftActionResponse>(`${base(companyId)}/draft-actions/${actionId}`);
}

export function confirmReimbursementDraftAction(companyId: string, actionId: string, input: { previewRevision: number; confirmationDigest: string }) {
  return apiFetch<ReimbursementDraftActionResponse>(`${base(companyId)}/draft-actions/${actionId}/confirm`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function cancelReimbursementDraftAction(companyId: string, actionId: string, input: { previewRevision: number; confirmationDigest: string }) {
  return apiFetch<ReimbursementDraftActionResponse>(`${base(companyId)}/draft-actions/${actionId}/cancel`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function getReimbursementSourceOptions(companyId: string, params: { branchId: string; requesterUserId: string; search?: string; expenseId?: string }) {
  return apiFetch<ReimbursementSourceOptions>(`${base(companyId)}/source-options${qs(params)}`);
}

// ---- Requests ----

export function listReimbursements(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}${qs(params)}`);
}
/**
 * Every claim the session may see, newest first. The hub counts, filters and searches what it has loaded,
 * and the list endpoint answers 20 rows unless asked, so one unpaged call hid every older claim from the
 * cards — a claim still waiting for payment included.
 * ponytail: pages on the client, 100 a call; count and filter on the server once a shop has thousands of claims.
 */
export async function listAllReimbursements(companyId: string, params?: Record<string, unknown>): Promise<any[]> {
  const byId = new Map<string, any>();
  for (let page = 1; ; page += 1) {
    const result = await listReimbursements(companyId, { ...params, page, pageSize: 100 });
    // Keyed by id: a claim filed between two calls shifts the pages and would otherwise repeat a row.
    for (const item of result.items ?? []) byId.set(item.id, item);
    if (!result.items?.length || page * 100 >= result.total) return [...byId.values()];
  }
}
export function getReimbursement(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/${id}`);
}
export function addReimbursementInternalNote(companyId: string, id: string, body: string) {
  return apiFetch<ReimbursementInternalNote>(`${base(companyId)}/${id}/internal-notes`, { method: 'POST', body: JSON.stringify({ body }) });
}
export function editReimbursementInternalNote(companyId: string, id: string, noteId: string, body: string) {
  return apiFetch(`${base(companyId)}/${id}/internal-notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ body }) });
}
export function deleteReimbursementInternalNote(companyId: string, id: string, noteId: string) {
  return apiFetch(`${base(companyId)}/${id}/internal-notes/${noteId}`, { method: 'DELETE' });
}
export function createReimbursement(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(base(companyId), { method: 'POST', body: JSON.stringify(body) });
}
export function updateReimbursementDraft(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** The 3-step upload-intent flow, returning the attachment id to put on a line. */
export async function uploadReceiptFile(companyId: string, file: File, branchId: string | null | undefined): Promise<string> {
  return withGenericUploadError(async () => {
    if (!branchId?.trim()) throw Object.assign(new Error('TRANSACTION_BRANCH_REQUIRED'), { code: 'TRANSACTION_BRANCH_REQUIRED' });
    const preparedFile = await prepareAttachmentUpload(file);
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `/companies/${companyId}/attachments/upload-intent`,
      {
        method: 'POST',
        body: JSON.stringify({
          originalFileName: preparedFile.name,
          mimeType: preparedFile.type,
          byteSize: preparedFile.size,
          visibility: 'INTERNAL',
          branchId,
        }),
      },
    );
    await uploadFileToStorage(intent.uploadUrl, intent.uploadMethod, preparedFile, intent.uploadHeaders);
    await apiFetch(`/companies/${companyId}/attachments/${intent.attachmentId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ byteSize: preparedFile.size }),
    });
    return intent.attachmentId;
  });
}

/** Detail line summaries → draft-update inputs (a draft update replaces the lines wholesale). */
export function toLineInputs(lines: any[]): Record<string, unknown>[] {
  return (lines ?? []).map((line) => ({
    lineNo: line.lineNo,
    incurredDate: line.incurredDate,
    description: line.description,
    purpose: line.purpose,
    categoryKey: line.categoryKey,
    categoryLabel: line.categoryLabelSnapshot,
    amount: line.amount,
    attachmentId: line.attachmentId ?? null,
    sourceExpenseUpdatedAt: line.sourceExpenseSnapshot?.expenseUpdatedAt,
    linkedExpenseId: line.linkedExpenseId ?? null,
  }));
}

/** Upload (or clear) the receipt of ONE line, keeping the other lines as they are. */
export async function setLineReceipt(companyId: string, requestId: string, lines: any[], lineNo: number, file: File | null, branchId: string | null | undefined) {
  return withGenericUploadError(async () => {
    const attachmentId = file ? await uploadReceiptFile(companyId, file, branchId) : null;
    const next = toLineInputs(lines).map((line) => (line.lineNo === lineNo ? { ...line, attachmentId } : line));
    return updateReimbursementDraft(companyId, requestId, { lines: next });
  });
}
export function submitReimbursement(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/${id}/submit`, { method: 'POST', body: '{}' });
}
export function cancelReimbursement(companyId: string, id: string, reason?: string) {
  return apiFetch<any>(`${base(companyId)}/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}
export function reopenReimbursement(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/${id}/reopen`, { method: 'POST', body: '{}' });
}

// ---- Approval ----

export function listApprovalQueue(companyId: string) {
  return apiFetch<any>(`${base(companyId)}/approval-queue`);
}
export function approveReimbursement(companyId: string, id: string, comment?: string, approvalSnapshotHash?: string) {
  return apiFetch<any>(`${base(companyId)}/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment, approvalSnapshotHash }) });
}
export function rejectReimbursement(companyId: string, id: string, reason: string) {
  return apiFetch<any>(`${base(companyId)}/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Finance & payment ----

export function listFinanceQueue(companyId: string) {
  return apiFetch<any>(`${base(companyId)}/finance-queue`);
}
export function financeReviewReimbursement(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/${id}/finance-review`, { method: 'POST', body: JSON.stringify(body) });
}
export function recordReimbursementPayment(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/${id}/payments`, { method: 'POST', body: JSON.stringify(body) });
}
export function voidReimbursementPayment(companyId: string, id: string, paymentId: string, reason: string) {
  return apiFetch<any>(`${base(companyId)}/${id}/payments/${paymentId}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Payment slips ----

/**
 * 3-step upload of a payment slip, prepared like a receipt (HEIC/HEIF/GIF are converted first). The
 * intent is tagged with the claim server-side, so the file can only become a slip of this claim,
 * recorded by the person who uploaded it. Returns the attachment id to record the payment with.
 */
export async function uploadReimbursementPaymentSlip(companyId: string, requestId: string, file: File): Promise<string> {
  return withGenericUploadError(async () => {
    const prepared = await prepareAttachmentUpload(file);
    if (prepared.size > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) throw Object.assign(new Error('payment_slip_invalid'), { code: 'payment_slip_invalid' });
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `${base(companyId)}/${requestId}/payments/slip-upload-intent`,
      { method: 'POST', body: JSON.stringify({ originalFileName: prepared.name, mimeType: prepared.type, byteSize: prepared.size }) },
    );
    await uploadFileToStorage(intent.uploadUrl, intent.uploadMethod, prepared, intent.uploadHeaders);
    await apiFetch(`${base(companyId)}/${requestId}/payments/slip-uploads/${intent.attachmentId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ byteSize: prepared.size }),
    });
    return intent.attachmentId;
  });
}

/** Adds a slip to a recorded payment: a slip just uploaded, or a file already attached to the claim. Returns the claim detail. */
export function attachReimbursementPaymentSlip(companyId: string, requestId: string, paymentId: string, attachmentId: string) {
  return apiFetch<any>(`${base(companyId)}/${requestId}/payments/${paymentId}/slips`, { method: 'POST', body: JSON.stringify({ attachmentId }) });
}

/** A slip's bytes for the viewer. The claim's slip endpoint decides who gets them; the generic attachment download never serves a slip. */
export async function fetchReimbursementPaymentSlipBlob(companyId: string, requestId: string, paymentId: string, attachmentId: string): Promise<Blob> {
  const { downloadUrl } = await apiFetch<{ downloadUrl: string }>(
    `${base(companyId)}/${requestId}/payments/${paymentId}/slips/${attachmentId}/download-url?disposition=inline`,
  );
  return fetchSignedPreviewBlob(downloadUrl);
}

// ---- Printable claim form (ใบเบิกค่าใช้จ่าย) ----

/** Renders the claim form on demand; the SVG data URL is shown in the viewer and printed by the browser. */
export function previewReimbursementClaimForm(companyId: string, id: string) {
  return apiFetch<{ svgDataUrl: string; pageSvgDataUrls?: string[]; checksumSha256: string }>(`${base(companyId)}/${id}/claim-form/preview`, { method: 'POST', body: '{}' });
}

// ---- Claim-form signatures + signed copies ----

/**
 * 3-step upload of ONE role's signature image. The intent is tagged with the
 * claim and the role server-side, so the file can only ever be used to sign that
 * block by this signer.
 */
export async function uploadClaimSignature(companyId: string, requestId: string, role: string, file: File): Promise<string> {
  return withGenericUploadError(async () => {
    file = await prepareAttachmentUpload(file, 'image');
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `${base(companyId)}/${requestId}/claim-form/signature-upload-intent`,
      { method: 'POST', body: JSON.stringify({ role, originalFileName: file.name, mimeType: file.type, byteSize: file.size }) },
    );
    await uploadFileToStorage(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await apiFetch(`${base(companyId)}/${requestId}/claim-form/signature-uploads/${intent.attachmentId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ role, byteSize: file.size }),
    });
    return intent.attachmentId;
  });
}

/** `snapshotHash` is the claim's live ack hash from the detail — the server rejects a stale one. */
export function signReimbursementClaimForm(companyId: string, requestId: string, body: { role: string; signatureAttachmentId?: string; snapshotHash: string }) {
  return apiFetch<any>(`${base(companyId)}/${requestId}/claim-form/signatures`, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Uploads a scan/photo of the wet-ink signed form and links it to the claim. `confirmedRequestNo` is the A4
 * declaration (both signatures, this claim number): the scan then counts as signed on paper. Without it, archive only.
 */
export async function uploadSignedClaimFormCopy(companyId: string, requestId: string, file: File, branchId: string | null | undefined, confirmedRequestNo?: string) {
  return withGenericUploadError(async () => {
    const attachmentId = await uploadReceiptFile(companyId, file, branchId);
    return apiFetch<any>(`${base(companyId)}/${requestId}/claim-form/signed-copies`, {
      method: 'POST',
      body: JSON.stringify({ attachmentId, ...(confirmedRequestNo && { acknowledgedComplete: true, confirmedRequestNo }) }),
    });
  });
}

/** Signed viewer URL for an attached file (same endpoint the expenses viewer uses). */
export { fetchAttachmentPreviewBlob, getAttachmentDownloadUrl } from '../expenses/expenses.api';

// ---- Policy ----

export function getReimbursementPolicy(companyId: string) {
  return apiFetch<ReimbursementPolicySummary>(`/companies/${companyId}/reimbursement-policy`);
}
export function listReimbursementApproverOptions(companyId: string) {
  return apiFetch<ReimbursementApproverRoleOption[]>(`/companies/${companyId}/reimbursement-policy/approver-options`);
}
export function updateReimbursementPolicy(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/reimbursement-policy`, { method: 'PUT', body: JSON.stringify(body) });
}
