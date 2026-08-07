import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { withGenericUploadError } from '@/common/files/upload-file.logic';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- Bank Accounts ----

export function listBankAccounts(companyId: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts`);
}

export function createBankAccount(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateBankAccount(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deactivateBankAccount(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/deactivate`, { method: 'POST', body: '{}' });
}

export function listStatementLines(companyId: string, id: string, status?: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/statement-lines${qs({ status })}`);
}

export function listStatementImports(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/statement-imports`);
}

export function extractStatementFile(companyId: string, id: string, body: { fileBase64: string; mimeType: string; fileName: string }) {
  return withGenericUploadError(() =>
    apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/statement-imports/extract`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function previewStatementImport(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/statement-imports/preview`, { method: 'POST', body: JSON.stringify(body) });
}

export function commitStatementImport(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/statement-imports/commit`, { method: 'POST', body: JSON.stringify(body) });
}

export function addManualStatementLine(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${id}/statement-lines`, { method: 'POST', body: JSON.stringify(body) });
}

export function getMatchCandidates(companyId: string, bankAccountId: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/bank-accounts/${bankAccountId}/match-candidates`);
}

// ---- Statement Imports ----

export function voidStatementImport(companyId: string, importId: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/statement-imports/${importId}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Statement Lines / Matches ----

export function confirmMatch(companyId: string, lineId: string, body: { sourceType: string; sourceId: string; sourceDisplayNumber?: string; allocatedAmount: string; currency: string; overrideReason?: string }) {
  return apiFetch<any>(`/companies/${companyId}/banking/statement-lines/${lineId}/matches`, { method: 'POST', body: JSON.stringify(body) });
}

export function ignoreLine(companyId: string, lineId: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/statement-lines/${lineId}/ignore`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function rejectMatch(companyId: string, matchId: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/matches/${matchId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function voidMatch(companyId: string, matchId: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/matches/${matchId}/void`, { method: 'POST', body: '{}' });
}

// ---- Adjustments ----

export function listAdjustments(companyId: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/adjustments`);
}

export function createAdjustment(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/adjustments`, { method: 'POST', body: JSON.stringify(body) });
}

export function submitAdjustment(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/adjustments/${id}/submit`, { method: 'POST', body: '{}' });
}

export function approveAdjustment(companyId: string, id: string, body: { ledgerDebitAccountId: string; ledgerCreditAccountId: string }) {
  return apiFetch<any>(`/companies/${companyId}/banking/adjustments/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}

export function voidAdjustment(companyId: string, id: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/adjustments/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Reconciliations ----

export function listReconciliations(companyId: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/reconciliations`);
}

export function createReconciliation(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`/companies/${companyId}/banking/reconciliations`, { method: 'POST', body: JSON.stringify(body) });
}

export function getReconciliation(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/reconciliations/${id}`);
}

export function completeReconciliation(companyId: string, id: string, snapshotLines: unknown[]) {
  return apiFetch<any>(`/companies/${companyId}/banking/reconciliations/${id}/complete`, { method: 'POST', body: JSON.stringify({ snapshotLines }) });
}

export function reopenReconciliation(companyId: string, id: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/reconciliations/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Cash Position ----

export function getCashPosition(companyId: string) {
  return apiFetch<any>(`/companies/${companyId}/banking/cash-position`);
}
