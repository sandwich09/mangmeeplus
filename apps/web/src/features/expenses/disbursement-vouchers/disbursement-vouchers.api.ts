import { notifyNotificationsChanged } from '@/features/dashboard-notifications/dashboard-notifications.api';
import { authedApiFetch, authedFetch } from '@/common/api/authed-fetch';
import type { PayDisbursementVoucherInput, RemindDisbursementVoucherInput, IssueDisbursementVoucherInput, ReissueDisbursementVoucherInput } from './disbursement-vouchers.model';
import type { DisbursementApprover, DisbursementVoucherCommandInput, SubmitDisbursementVoucherInput, EndDisbursementVoucherInput, CreateDisbursementVoucherDraftInput, UpdateDisbursementVoucherDraftInput, DisbursementVoucherHeader, DisbursementPayeePage, DisbursementPayeeQuery, DisbursementPayableExpense, DisbursementPayableExpenseQuery, DisbursementVoucherDetail, DisbursementVoucherListPage, DisbursementVoucherListQuery } from './disbursement-vouchers.model';

import { uploadPaymentSlip } from '@/common/files/slip-upload.api';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { checkedPreviewBlob, downloadBlob, responseError, fetchSignedPreviewBlob } from '../expenses.api';

const pendingCommands = new Set<Promise<unknown>>();
export const isDisbursementCommandInFlight = () => pendingCommands.size > 0;

const changed = async <T>(request: Promise<T>): Promise<T> => {
  pendingCommands.add(request);
  try {
    const answer = await request;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') notifyNotificationsChanged();
    return answer;
  } finally { pendingCommands.delete(request); }
};

const base = (companyId: string) => `/v1/companies/${encodeURIComponent(companyId)}/disbursement-vouchers`;

export function listDisbursementVouchers(companyId: string, query: DisbursementVoucherListQuery): Promise<DisbursementVoucherListPage> {
  return authedApiFetch<DisbursementVoucherListPage>(`${base(companyId)}?${sourceQuery(query)}`);
}

export function getDisbursementVoucher(companyId: string, id: string, options?: { suppressErrorToast?: boolean }): Promise<DisbursementVoucherDetail> {
  return authedApiFetch<DisbursementVoucherDetail>(`${base(companyId)}/${encodeURIComponent(id)}`, options);
}

export function deleteDisbursementVoucherDraft(companyId: string, id: string): Promise<void> {
  return changed(authedApiFetch<void>(`${base(companyId)}/${encodeURIComponent(id)}`, { method: 'DELETE', suppressErrorToast: true }));
}

const sourceQuery = (query: object) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  return params;
};
export function listDisbursementPayees(companyId: string, query: DisbursementPayeeQuery): Promise<DisbursementPayeePage> {
  return authedApiFetch(`${base(companyId)}/payees?${sourceQuery(query)}`);
}
export function listDisbursementPayableExpenses(companyId: string, query: DisbursementPayableExpenseQuery, options?: { suppressErrorToast?: boolean }): Promise<DisbursementPayableExpense[]> {
  return authedApiFetch(`${base(companyId)}/payable-expenses?${sourceQuery(query)}`, options);
}
export function createDisbursementVoucherDraft(companyId: string, input: CreateDisbursementVoucherDraftInput): Promise<DisbursementVoucherHeader> {
  return changed(authedApiFetch(base(companyId), { method: 'POST', body: JSON.stringify(input), suppressErrorToast: true }));
}
export function updateDisbursementVoucherDraft(companyId: string, id: string, input: UpdateDisbursementVoucherDraftInput): Promise<DisbursementVoucherHeader> {
  return changed(authedApiFetch(`${base(companyId)}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input), suppressErrorToast: true }));
}

export function listDisbursementApprovers(companyId: string, branchId: string): Promise<DisbursementApprover[]> {
  return authedApiFetch(`${base(companyId)}/approvers?${sourceQuery({ branchId })}`, { suppressErrorToast: true });
}
const lifecycle = (companyId: string, id: string, action: string, input: DisbursementVoucherCommandInput) =>
  changed(authedApiFetch<DisbursementVoucherHeader>(`${base(companyId)}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(input), suppressErrorToast: true }));
export const submitDisbursementVoucher = (companyId: string, id: string, input: SubmitDisbursementVoucherInput) => lifecycle(companyId, id, 'submit', input);
export const remindDisbursementVoucher = (companyId: string, id: string, input: RemindDisbursementVoucherInput) => lifecycle(companyId, id, 'remind', input);
export const approveDisbursementVoucher = (companyId: string, id: string, input: DisbursementVoucherCommandInput) => lifecycle(companyId, id, 'approve', input);
export const returnDisbursementVoucher = (companyId: string, id: string, input: EndDisbursementVoucherInput) => lifecycle(companyId, id, 'return', input);
export const withdrawDisbursementVoucher = (companyId: string, id: string, input: EndDisbursementVoucherInput) => lifecycle(companyId, id, 'withdraw', input);
export const cancelDisbursementVoucher = (companyId: string, id: string, input: EndDisbursementVoucherInput) => lifecycle(companyId, id, 'cancel', input);
export const payDisbursementVoucher = (companyId: string, id: string, input: PayDisbursementVoucherInput) => lifecycle(companyId, id, 'pay', input);
export const issueDisbursementVoucherFromPayment = (companyId: string, input: IssueDisbursementVoucherInput): Promise<DisbursementVoucherHeader> =>
  changed(authedApiFetch(`${base(companyId)}/from-payment`, { method: 'POST', body: JSON.stringify(input), suppressErrorToast: true }));
export const reissueDisbursementVoucher = (companyId: string, id: string, input: ReissueDisbursementVoucherInput): Promise<DisbursementVoucherHeader> =>
  changed(authedApiFetch(`${base(companyId)}/${encodeURIComponent(id)}/reissue`, { method: 'POST', body: JSON.stringify(input), suppressErrorToast: true }));

export async function downloadDisbursementVoucherDocument(companyId: string, id: string, documentNumber: string): Promise<void> {
  const response = await authedFetch(`${base(companyId)}/${encodeURIComponent(id)}/document.pdf`);
  if (!response.ok) throw await responseError(response);
  downloadBlob(await checkedPreviewBlob(response, 'application/pdf'), `${documentNumber}.pdf`);
}
export function revealDisbursementVoucherAccount(companyId: string, id: string, signal?: AbortSignal): Promise<{ accountNumber: string }> {
  return authedApiFetch(`${base(companyId)}/${encodeURIComponent(id)}/payee-account/reveal`, { method: 'POST', signal, suppressErrorToast: true });
}

export function uploadDisbursementVoucherSlip(companyId: string, id: string, file: File): Promise<string> {
  return uploadPaymentSlip(`${base(companyId)}/${encodeURIComponent(id)}`, file, {
    code: 'disbursement_slip_invalid', message: DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_slip_invalid,
  }, true);
}
export function attachDisbursementVoucherSlip(companyId: string, id: string, attachmentId: string): Promise<Pick<DisbursementVoucherDetail, 'header' | 'slip'>> {
  return changed(authedApiFetch(`${base(companyId)}/${encodeURIComponent(id)}/slip`, {
    method: 'POST', body: JSON.stringify({ attachmentId }), suppressErrorToast: true,
  }));
}
export async function fetchDisbursementVoucherSlipBlob(companyId: string, id: string): Promise<Blob> {
  const { downloadUrl } = await authedApiFetch<{ downloadUrl: string }>(`${base(companyId)}/${encodeURIComponent(id)}/slip`, { suppressErrorToast: true });
  return fetchSignedPreviewBlob(downloadUrl);
}
