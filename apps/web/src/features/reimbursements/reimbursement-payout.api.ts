import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type { AddSavedPayoutAccountInput, SavedPayoutAccountListResponse, SavedPayoutAccountSummary, MemberPayoutAccountResponse, PayoutAccountReveal, SetMemberPayoutAccountInput } from '@watchdog-bms/contracts';

// Payout account calls. Every answer carries the last 4 digits only, except the two `reveal…` calls:
// those return the full number, and the server writes an audit row before it answers.

const base = (companyId: string) => `/companies/${companyId}/reimbursements/payout-accounts`;
const put = (input: SetMemberPayoutAccountInput) => ({ method: 'PUT', body: JSON.stringify(input) });

export function getMyPayoutAccount(companyId: string) {
  return apiFetch<MemberPayoutAccountResponse>(`${base(companyId)}/me`);
}
export function setMyPayoutAccount(companyId: string, input: SetMemberPayoutAccountInput) {
  return apiFetch<MemberPayoutAccountResponse>(`${base(companyId)}/me`, put(input));
}
export function deleteMyPayoutAccount(companyId: string) {
  return apiFetch<MemberPayoutAccountResponse>(`${base(companyId)}/me`, { method: 'DELETE' });
}
export function revealMyPayoutAccount(companyId: string) {
  return apiFetch<PayoutAccountReveal>(`${base(companyId)}/me/reveal`, { method: 'POST', body: '{}' });
}

/** An employee's account, for whoever may read or edit employee data. Never reveals the number. */
export function getMemberPayoutAccount(companyId: string, userId: string) {
  return apiFetch<MemberPayoutAccountResponse>(`${base(companyId)}/members/${userId}`);
}
export function setMemberPayoutAccount(companyId: string, userId: string, input: SetMemberPayoutAccountInput) {
  return apiFetch<MemberPayoutAccountResponse>(`${base(companyId)}/members/${userId}`, put(input));
}

/** The full number of a claim's own snapshot; the server answers only the claim's reveal group. */
export function revealClaimPayoutAccount(companyId: string, requestId: string) {
  return apiFetch<PayoutAccountReveal>(`/companies/${companyId}/reimbursements/${requestId}/payout-destination/reveal`, { method: 'POST', body: '{}' });
}

const savedBase = (companyId: string) => `${base(companyId)}/me/saved`;
export function getMySavedPayoutAccounts(companyId: string) {
  return apiFetch<SavedPayoutAccountListResponse>(savedBase(companyId));
}
export function addMySavedPayoutAccount(companyId: string, input: AddSavedPayoutAccountInput) {
  return apiFetch<SavedPayoutAccountSummary>(savedBase(companyId), { method: 'POST', body: JSON.stringify(input) });
}
export function deleteMySavedPayoutAccount(companyId: string, accountId: string) {
  return apiFetch<void>(`${savedBase(companyId)}/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
}
export function revealMySavedPayoutAccount(companyId: string, accountId: string) {
  return apiFetch<PayoutAccountReveal>(`${savedBase(companyId)}/${encodeURIComponent(accountId)}/reveal`, { method: 'POST', body: '{}' });
}
export function makeMySavedPayoutAccountDefault(companyId: string, accountId: string) {
  return apiFetch<MemberPayoutAccountResponse>(`${savedBase(companyId)}/${encodeURIComponent(accountId)}/make-default`, { method: 'POST', body: '{}' });
}
