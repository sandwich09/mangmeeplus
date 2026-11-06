'use client';
import type {
  SalesAgentCreateBody,
  SalesAgentCreateResult,
  SalesAgentCredentialHandoff,
  SalesAgentListDto,
  SalesAgentProfileDto,
  SalesAgentSelfProfileInput,
  SalesAgentUpdateBody,
  SalesAgentView,
  SalesCompanySearchDto,
  SalesDealDecisionBody,
  SalesDealListDto,
  SalesDealSaveBody,
  SalesDealStatus,
  SalesDealSubmitBody,
  SalesDealView,
  SalesEventAgentSearch,
  SalesEventBatchInput,
  SalesEventBatchList,
  SalesEventBatchStateBody,
  SalesEventBatchUpdate,
  SalesEventBatchView,
  SalesEventQr,
  SalesEventTicketList,
  SalesEventTicketRevokeBody,
  SalesEventTicketView,
  SalesAttributionFlagListDto,
  SalesAttributionFlagReviewBody,
  SalesMyWorkDto,
  SalesReferralUpdateBody,
  SalesReportSummary,
  SalesEventReport,
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

export type SalesDemoLink = { url: string; expiresAt: string; aiCredit: number };

export function createSalesDemoLink(aiCredit = 80): Promise<SalesDemoLink> {
  return apiFetch<SalesDemoLink>('/v1/sales/demo-links', {
    method: 'POST', body: JSON.stringify({ aiCredit }), suppressErrorToast: true,
  });
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

// ── team and own profile ──

export function getMySalesProfile(init?: { signal?: AbortSignal }): Promise<SalesAgentProfileDto> {
  return apiFetch<SalesAgentProfileDto>('/v1/sales/me/profile', { ...init, suppressErrorToast: true });
}

export function updateMySalesProfile(body: SalesAgentSelfProfileInput): Promise<SalesAgentProfileDto> {
  return apiFetch<SalesAgentProfileDto>('/v1/sales/me/profile', {
    method: 'PATCH', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

export function getSalesTeamProfile(userId: string): Promise<SalesAgentProfileDto> {
  return apiFetch<SalesAgentProfileDto>(`/v1/sales/team/${encodeURIComponent(userId)}/profile`, { suppressErrorToast: true });
}

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

/** Sales-event report (spec §10): separate from the sales figures above — never sales credit. */
export function getSalesEventReport(
  params: { from: string; to: string; teamLeadUserId?: string },
  init?: { signal?: AbortSignal },
): Promise<SalesEventReport> {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.teamLeadUserId) query.set('teamLeadUserId', params.teamLeadUserId);
  return apiFetch<SalesEventReport>(`/v1/sales/events/report?${query.toString()}`, { ...init, suppressErrorToast: true });
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

// ── ส่วนลดจากงาน (sales-event-discounts spec §7.1) ──

function withCursor(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return query.size > 0 ? `${path}?${query.toString()}` : path;
}

export function listSalesEventBatches(cursor?: string | null, init?: { signal?: AbortSignal }): Promise<SalesEventBatchList> {
  return apiFetch<SalesEventBatchList>(withCursor('/v1/sales/events/batches', { cursor }), { ...init, suppressErrorToast: true });
}

export function getSalesEventBatch(batchId: string, init?: { signal?: AbortSignal }): Promise<SalesEventBatchView> {
  return apiFetch<SalesEventBatchView>(`/v1/sales/events/batches/${encodeURIComponent(batchId)}`, { ...init, suppressErrorToast: true });
}

export function createSalesEventBatch(body: SalesEventBatchInput): Promise<SalesEventBatchView> {
  return apiFetch<SalesEventBatchView>('/v1/sales/events/batches', { method: 'POST', body: JSON.stringify(body), suppressErrorToast: true });
}

export function updateSalesEventBatch(batchId: string, body: SalesEventBatchUpdate): Promise<SalesEventBatchView> {
  return apiFetch<SalesEventBatchView>(`/v1/sales/events/batches/${encodeURIComponent(batchId)}`, {
    method: 'PATCH', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

export function changeSalesEventBatchState(batchId: string, body: SalesEventBatchStateBody): Promise<SalesEventBatchView> {
  return apiFetch<SalesEventBatchView>(`/v1/sales/events/batches/${encodeURIComponent(batchId)}/state`, {
    method: 'POST', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

export function searchSalesEventAgents(q: string, cursor?: string | null, init?: { signal?: AbortSignal }): Promise<SalesEventAgentSearch> {
  return apiFetch<SalesEventAgentSearch>(withCursor('/v1/sales/events/agents', { q: q.trim(), cursor }), { ...init, suppressErrorToast: true });
}

/** A fresh QR on every call; the previous one keeps working until its own five minutes run out. */
export function issueSalesEventQr(batchId: string): Promise<SalesEventQr> {
  return apiFetch<SalesEventQr>(`/v1/sales/events/batches/${encodeURIComponent(batchId)}/qr`, {
    method: 'POST', body: JSON.stringify({}), suppressErrorToast: true,
  });
}

export function listSalesEventTickets(batchId: string, cursor?: string | null, init?: { signal?: AbortSignal }): Promise<SalesEventTicketList> {
  return apiFetch<SalesEventTicketList>(withCursor(`/v1/sales/events/batches/${encodeURIComponent(batchId)}/tickets`, { cursor }), {
    ...init, suppressErrorToast: true,
  });
}

export function revokeSalesEventTicket(ticketId: string, body: SalesEventTicketRevokeBody): Promise<SalesEventTicketView> {
  return apiFetch<SalesEventTicketView>(`/v1/sales/events/tickets/${encodeURIComponent(ticketId)}/revoke`, {
    method: 'POST', body: JSON.stringify(body), suppressErrorToast: true,
  });
}
