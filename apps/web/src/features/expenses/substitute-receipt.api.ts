import type { SubstituteReceiptCandidateFilter, SubstituteReceiptCandidatePage } from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { uploadReceiptFile } from './expenses.api';

export function listSubstituteReceiptCandidates(companyId: string, filter: SubstituteReceiptCandidateFilter): Promise<SubstituteReceiptCandidatePage> {
  const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  return apiFetch(`/v1/companies/${companyId}/substitute-receipts/candidates?${query}`);
}

export async function uploadSubstituteReceiptEvidence(companyId: string, expenseId: string, file: File, purpose: 'expense.receipt.supporting' | 'expense.payment.evidence'): Promise<string> {
  const base = `/v1/companies/${companyId}/expenses/${expenseId}/substitute-receipt/evidence-upload`;
  const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(base, {
    method: 'POST', body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size, purpose }),
  });
  await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
  await apiFetch(`${base}/${intent.attachmentId}/complete`, { method: 'POST', body: JSON.stringify({ byteSize: file.size, purpose }) });
  return intent.attachmentId;
}

export async function findEvidenceExpenseId(companyId: string, evidenceId: string): Promise<string> {
  const result = await apiFetch<{ expenseId: string }>(`/v1/companies/${companyId}/substitute-receipts/${encodeURIComponent(evidenceId)}/expense`);
  return result.expenseId;
}
