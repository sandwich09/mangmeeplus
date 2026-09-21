'use client';
import type {
  SalesAgentCreateBody,
  SalesAgentCreateResult,
  SalesAgentCredentialHandoff,
  SalesAgentListDto,
  SalesAgentProfileDto,
  SalesAgentUpdateBody,
  SalesAgentView,
  SalesCompanySearchDto,
  SalesDealDecisionBody,
  SalesDealListDto,
  SalesDealSaveBody,
  SalesDealStatus,
  SalesDealSubmitBody,
  SalesDealView,
  SalesAttributionFlagListDto,
  SalesAttributionFlagReviewBody,
  SalesMyWorkDto,
  SalesReferralUpdateBody,
  SalesReportSummary,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

/**
 * Sales console client (spec §11). Every call is read-your-own-scope on the API side — the console
 * never passes a company header, because these routes live on the platform tenant and the session's
 * `sales.*` permissions are the whole authorization story.
 *
 * `suppressErrorToast` throughout: each screen shows the failure where the action was taken (the
 * form, the row, the picker), so the shared toast would be a second copy of the same sentence.
 */

export function searchSalesCompanies(q: string, init?: { signal?: AbortSignal }): Promise<SalesCompanySearchDto> {
  return apiFetch<SalesCompanySearchDto>(`/v1/sales/companies?q=${encodeURIComponent(q)}`, { ...init, suppressErrorToast: true });
}

export function listSalesDeals(
  params: { status?: SalesDealStatus; salesUserId?: string } = {},
  init?: { signal?: AbortSignal },
): Promise<SalesDealListDto> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.salesUserId) query.set('salesUserId', params.salesUserId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch<SalesDealListDto>(`/v1/sales/deals${suffix}`, { ...init, suppressErrorToast: true });
}

export function getSalesDeal(id: string, init?: { signal?: AbortSignal }): Promise<SalesDealView> {
  return apiFetch<SalesDealView>(`/v1/sales/deals/${encodeURIComponent(id)}`, { ...init, suppressErrorToast: true });
}

export function createSalesDeal(body: SalesDealSaveBody): Promise<SalesDealView> {
  return apiFetch<SalesDealView>('/v1/sales/deals', { method: 'POST', body: JSON.stringify(body), suppressErrorToast: true });
}

export function saveSalesDeal(id: string, body: SalesDealSaveBody): Promise<SalesDealView> {
  return apiFetch<SalesDealView>(`/v1/sales/deals/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body), suppressErrorToast: true });
}

/** `end` = D-P5-6 "จบดีล": a lead stops an auto-renewing deal, and the shop returns to the catalog
 *  price at the end of the cycle it has paid for. Same `sales.deal.approve` right as an approval. */
export type SalesDealAction = 'submit' | 'approve' | 'reject' | 'cancel' | 'end';

export function actSalesDeal(
  id: string, action: SalesDealAction, body: SalesDealSubmitBody | SalesDealDecisionBody,
): Promise<SalesDealView> {
  return apiFetch<SalesDealView>(`/v1/sales/deals/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

export function getSalesMyWork(init?: { signal?: AbortSignal }): Promise<SalesMyWorkDto> {
  return apiFetch<SalesMyWorkDto>('/v1/sales/my-work', { ...init, suppressErrorToast: true });
}

// ── team (หัวหน้า: `sales.team.manage`, no tax/bank fields) ──

export function listSalesTeam(init?: { signal?: AbortSignal }): Promise<SalesAgentListDto> {
  return apiFetch<SalesAgentListDto>('/v1/sales/team', { ...init, suppressErrorToast: true });
}

export function createSalesTeamMember(body: SalesAgentCreateBody): Promise<SalesAgentCreateResult> {
  return apiFetch<SalesAgentCreateResult>('/v1/sales/team', { method: 'POST', body: JSON.stringify(body), suppressErrorToast: true });
}

export function resetSalesTeamCredential(userId: string): Promise<SalesAgentCredentialHandoff> {
  return apiFetch<SalesAgentCredentialHandoff>(`/v1/sales/team/${encodeURIComponent(userId)}/credential`, {
    method: 'POST', body: JSON.stringify({}), suppressErrorToast: true,
  });
}

// ── admin console (`/system/sales-team`: SYSTEM_ADMIN, tax/bank PII, CSV) ──

export function listSalesAgents(init?: { signal?: AbortSignal }): Promise<SalesAgentListDto> {
  return apiFetch<SalesAgentListDto>('/v1/system/sales-agents', { ...init, suppressErrorToast: true });
}

export function createSalesAgent(body: SalesAgentCreateBody): Promise<SalesAgentCreateResult> {
  return apiFetch<SalesAgentCreateResult>('/v1/system/sales-agents', { method: 'POST', body: JSON.stringify(body), suppressErrorToast: true });
}

export function updateSalesAgent(userId: string, body: SalesAgentUpdateBody): Promise<SalesAgentView> {
  return apiFetch<SalesAgentView>(`/v1/system/sales-agents/${encodeURIComponent(userId)}`, {
    method: 'PATCH', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

export function resetSalesAgentCredential(userId: string): Promise<SalesAgentCredentialHandoff> {
  return apiFetch<SalesAgentCredentialHandoff>(`/v1/system/sales-agents/${encodeURIComponent(userId)}/credential`, {
    method: 'POST', body: JSON.stringify({}), suppressErrorToast: true,
  });
}

/** S10: every read of this is audited MEDIUM, so it is only ever fetched on an explicit tap. */
export function getSalesAgentProfile(userId: string): Promise<SalesAgentProfileDto> {
  return apiFetch<SalesAgentProfileDto>(`/v1/system/sales-agents/${encodeURIComponent(userId)}/profile`, { suppressErrorToast: true });
}

/** Plain navigation, not a fetch: the CSV is a download and the cookie session carries the auth. */
export const SALES_AGENT_CSV_URL = '/api/v1/system/sales-agents/export.csv';

/**
 * D6 referral repair: SYSTEM_ADMIN sets or corrects the credited เซลล์ within 30 days of the shop
 * being created, always with a reason (audit HIGH `sales.referral.changed`). `salesCode: null`
 * clears the credit. The server is the authority on the window — the UI only stops offering it.
 */
export function setCompanyReferral(companyId: string, body: SalesReferralUpdateBody): Promise<unknown> {
  return apiFetch<unknown>(`/v1/system/partners/${encodeURIComponent(companyId)}/referral`, {
    method: 'PATCH', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

// ── Phase 4: report and anti-gaming flags ──

export function getSalesReportSummary(
  params: { from: string; to: string; teamLeadUserId?: string; salesUserId?: string },
  init?: { signal?: AbortSignal },
): Promise<SalesReportSummary> {
  // `from`/`to` are Bangkok month keys ('2026-09'), exactly what `reportRange` parses server-side.
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.teamLeadUserId) query.set('teamLeadUserId', params.teamLeadUserId);
  if (params.salesUserId) query.set('salesUserId', params.salesUserId);
  return apiFetch<SalesReportSummary>(`/v1/sales/reports/summary?${query.toString()}`, { ...init, suppressErrorToast: true });
}

export function listSalesAttributionFlags(init?: { signal?: AbortSignal }): Promise<SalesAttributionFlagListDto> {
  return apiFetch<SalesAttributionFlagListDto>('/v1/system/sales-attribution/flags', { ...init, suppressErrorToast: true });
}

/** `keep: true` = "ตัดออกจากยอด" (the flag stands); `false` = "ยืนยันว่าไม่ผิดปกติ". */
export function reviewSalesAttributionFlag(companyId: string, body: SalesAttributionFlagReviewBody): Promise<SalesAttributionFlagListDto> {
  return apiFetch<SalesAttributionFlagListDto>(`/v1/system/sales-attribution/${encodeURIComponent(companyId)}/review`, {
    method: 'POST', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

