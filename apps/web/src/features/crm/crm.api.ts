import type { CrmBookingSettings, CrmBookingSummary, CreateCrmBookingInput, UpdateCrmBookingInput, UpdateCrmBookingSettingsInput } from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type {
  CreateCrmCustomerInput,
  CreateCrmCustomerResult,
  ConvertCrmLeadInput,
  ConvertCrmLeadResult,
  CrmCustomerDetail,
  CrmProjectedCustomerDetail,
  CrmCustomerProfileExtractResult,
  CrmCustomerSummary,
  CrmReportsSummary,
  DashboardPeriodKind,
  LinkCrmCustomerLineIdentityInput,
  LinkCrmCustomerLineIdentityResult,
  ListCrmCustomersFilter,
  ListCrmCustomersResult,
  MergeCrmCustomersInput,
  MergeCrmCustomersResult,
  PreviewCrmCustomerMergeResult,
  UpdateCrmCustomerInput,
  UpdateCrmCustomerResult,
} from '@watchdog-bms/contracts';

function qs(params?: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const base = (companyId: string) => `/companies/${companyId}/crm`;

// ---- Dashboard / AI ----
export const getCrmDashboard = (c: string, scope?: string) => apiFetch<any>(`${base(c)}/dashboard/summary${qs({ scope })}`);
export const getCrmFollowUpPriorities = (c: string, scope?: string) => apiFetch<any>(`${base(c)}/ai/follow-up-priorities${qs({ scope })}`);
export const getCrmPipelineAiSummary = (c: string, scope?: string) => apiFetch<any>(`${base(c)}/ai/pipeline-summary${qs({ scope })}`);

// ---- Reports ----
export const getCrmReportsSummary = (c: string, p?: { branchId?: string; period?: DashboardPeriodKind }) => apiFetch<CrmReportsSummary>(`${base(c)}/reports/summary${qs(p)}`);

// ---- Customers ----
export const listCrmCustomers = (c: string, p?: ListCrmCustomersFilter) => apiFetch<ListCrmCustomersResult>(`${base(c)}/customers${qs(p)}`);
export const getCrmCustomer = (c: string, id: string) => apiFetch<CrmProjectedCustomerDetail>(`${base(c)}/customers/${id}`);
export const getCrmCustomer360 = (c: string, id: string) => apiFetch<any>(`${base(c)}/customers/${id}/summary360`);
export const getCrmCustomerTimeline = (c: string, id: string, p?: Record<string, unknown>) => apiFetch<any>(`${base(c)}/customers/${id}/timeline${qs(p)}`);
export const createCrmCustomer = (c: string, body: CreateCrmCustomerInput) => apiFetch<CreateCrmCustomerResult>(`${base(c)}/customers`, { method: 'POST', body: JSON.stringify(body) });
export const updateCrmCustomer = (c: string, id: string, body: UpdateCrmCustomerInput) => apiFetch<UpdateCrmCustomerResult>(`${base(c)}/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const archiveCrmCustomer = (c: string, id: string, body: { reason: string; override?: boolean }) => apiFetch<CrmCustomerSummary>(`${base(c)}/customers/${id}/archive`, { method: 'POST', body: JSON.stringify(body) });
export const assignCrmCustomer = (c: string, id: string, ownerUserId: string) => apiFetch<CrmCustomerSummary>(`${base(c)}/customers/${id}/assign`, { method: 'POST', body: JSON.stringify({ ownerUserId }) });
export const previewCrmCustomerMerge = (c: string, body: MergeCrmCustomersInput) => apiFetch<PreviewCrmCustomerMergeResult>(`${base(c)}/customers/merge/preview`, { method: 'POST', body: JSON.stringify(body) });
export const mergeCrmCustomers = (c: string, body: MergeCrmCustomersInput) => apiFetch<MergeCrmCustomersResult>(`${base(c)}/customers/merge`, { method: 'POST', body: JSON.stringify(body) });
export const linkCrmCustomerLineIdentity = (c: string, customerId: string, identityId: string, body: LinkCrmCustomerLineIdentityInput) => apiFetch<LinkCrmCustomerLineIdentityResult>(`${base(c)}/customers/${customerId}/line-identities/${identityId}/link`, { method: 'POST', body: JSON.stringify(body) });
export const extractCrmCustomerProfile = (c: string, body: { text: string; locale?: string }) => apiFetch<CrmCustomerProfileExtractResult>(`${base(c)}/customers/ai-profile-extract`, { method: 'POST', body: JSON.stringify(body) });
export const eraseCrmCustomer = (c: string, id: string, reason?: string) => apiFetch<{ customerId: string; messagesRedacted: number; mediaPurged: number }>(`${base(c)}/customers/${id}/erase`, { method: 'POST', body: JSON.stringify({ reason }) });
export const listCustomerBookings = (c: string, customerId: string) => apiFetch<{ items: CrmBookingSummary[] }>(`${base(c)}/bookings/by-customer/${customerId}`);
export const listCrmContacts = (c: string, customerId: string) => apiFetch<any>(`${base(c)}/customers/${customerId}/contacts`);
export const createCrmContact = (c: string, customerId: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/customers/${customerId}/contacts`, { method: 'POST', body: JSON.stringify(body) });

// ---- Leads ----
export const listCrmLeads = (c: string, p?: Record<string, unknown>) => apiFetch<any>(`${base(c)}/leads${qs(p)}`);
export const createCrmLead = (c: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/leads`, { method: 'POST', body: JSON.stringify(body) });
export const assignCrmLead = (c: string, id: string, assignedToUserId: string) => apiFetch<any>(`${base(c)}/leads/${id}/assign`, { method: 'POST', body: JSON.stringify({ assignedToUserId }) });
export const convertCrmLead = (c: string, id: string, body: ConvertCrmLeadInput) => apiFetch<ConvertCrmLeadResult>(`${base(c)}/leads/${id}/convert`, { method: 'POST', body: JSON.stringify(body) });
export const disqualifyCrmLead = (c: string, id: string, reason: string) => apiFetch<any>(`${base(c)}/leads/${id}/disqualify`, { method: 'POST', body: JSON.stringify({ reason }) });

// ---- Pipeline / opportunities ----
export const listCrmStages = (c: string) => apiFetch<any>(`${base(c)}/pipeline/stages`);
export const getCrmBoard = (c: string, scope?: string) => apiFetch<any>(`${base(c)}/opportunities/board${qs({ scope })}`);
export const listCrmOpportunities = (c: string, p?: Record<string, unknown>) => apiFetch<any>(`${base(c)}/opportunities${qs(p)}`);
export const getCrmOpportunity = (c: string, id: string) => apiFetch<any>(`${base(c)}/opportunities/${id}`);
export const createCrmOpportunity = (c: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/opportunities`, { method: 'POST', body: JSON.stringify(body) });
export const moveCrmOpportunityStage = (c: string, id: string, stageId: string, note?: string) => apiFetch<any>(`${base(c)}/opportunities/${id}/stage`, { method: 'POST', body: JSON.stringify({ stageId, note }) });
export const closeCrmOpportunity = (c: string, id: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/opportunities/${id}/close`, { method: 'POST', body: JSON.stringify(body) });
export const reopenCrmOpportunity = (c: string, id: string, reason: string) => apiFetch<any>(`${base(c)}/opportunities/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) });
export const createCrmQuotationDraft = (c: string, id: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/opportunities/${id}/quotation-drafts`, { method: 'POST', body: JSON.stringify(body) });

// ---- Activities ----
export const listCrmActivities = (c: string, p?: Record<string, unknown>) => apiFetch<any>(`${base(c)}/activities${qs(p)}`);
export const createCrmActivity = (c: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/activities`, { method: 'POST', body: JSON.stringify(body) });

// ---- Follow-ups ----
export const listCrmFollowUps = (c: string, p?: Record<string, unknown>) => apiFetch<any>(`${base(c)}/follow-ups${qs(p)}`);
export const createCrmFollowUp = (c: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/follow-ups`, { method: 'POST', body: JSON.stringify(body) });
export const completeCrmFollowUp = (c: string, id: string, body: Record<string, unknown>) => apiFetch<any>(`${base(c)}/follow-ups/${id}/complete`, { method: 'POST', body: JSON.stringify(body) });
export const snoozeCrmFollowUp = (c: string, id: string, snoozedUntil: string) => apiFetch<any>(`${base(c)}/follow-ups/${id}/snooze`, { method: 'POST', body: JSON.stringify({ snoozedUntil }) });
export const cancelCrmFollowUp = (c: string, id: string, reason: string) => apiFetch<any>(`${base(c)}/follow-ups/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });

// ---- Bookings (มั่งมี Flow A, spec D8) ----
export const listCrmBookings = (c: string, params?: { branchId?: string; weekStart?: string }) =>
  apiFetch<{ items: CrmBookingSummary[]; weekStart: string; weekEnd: string }>(`${base(c)}/bookings${qs(params)}`);
export const getCrmBookingSettings = (c: string) => apiFetch<CrmBookingSettings>(`${base(c)}/bookings/settings`);
export const updateCrmBookingSettings = (c: string, body: UpdateCrmBookingSettingsInput) =>
  apiFetch<CrmBookingSettings>(`${base(c)}/bookings/settings`, { method: 'PATCH', body: JSON.stringify(body) });
export const createCrmBooking = (c: string, body: CreateCrmBookingInput) =>
  apiFetch<CrmBookingSummary>(`${base(c)}/bookings`, { method: 'POST', body: JSON.stringify(body) });
export const updateCrmBooking = (c: string, id: string, body: UpdateCrmBookingInput) =>
  apiFetch<CrmBookingSummary>(`${base(c)}/bookings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const cancelCrmBooking = (c: string, id: string) =>
  apiFetch<CrmBookingSummary>(`${base(c)}/bookings/${id}/cancel`, { method: 'POST' });
