import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
// resolveUploadUrl is no longer imported here: the direct fetch was replaced by the shared
// uploadReceiptFile helper, which resolves the URL and turns a failed PUT into a readable message.
import { uploadReceiptFile as uploadFileToStorage } from '../expenses/expenses.api';
import { prepareAttachmentUpload, withGenericUploadError } from '@/common/files/upload-file.logic';
import type { ReimbursementApproverRoleOption, ReimbursementInternalNote, ReimbursementPolicySummary, ReimbursementSourceOptions } from '@watchdog-bms/contracts';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const base = (companyId: string) => `/companies/${companyId}/reimbursements`;

export function getReimbursementSourceOptions(companyId: string, params: { branchId: string; requesterUserId: string; search?: string; expenseId?: string }) {
  return apiFetch<ReimbursementSourceOptions>(`${base(companyId)}/source-options${qs(params)}`);
}

// ---- Requests ----

export function listReimbursements(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}${qs(params)}`);
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
