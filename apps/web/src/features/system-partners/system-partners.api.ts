import type { SharedLineMessagingSettings } from '@watchdog-bms/contracts';
import type {
  PartnerAiAdjustmentHistory,
  PartnerPlanAdjustmentHistory,
  PaginatedPartnersDto,
  PartnerCompanyDetailDto,
  PartnerCompanyStatus,
  PartnerCompanySummaryDto,
  UpdatePartnerProfileDto,
  PartnerLifecycleTransitionDto,
  SetPartnerFeaturesDto,
  SetPartnerFeaturesResultDto,
  SetPartnerAiModelDto,
  SetPartnerOcrConfigDto,
  PartnerOcrConfigDto,
  SetSharedLineCredentialDto,
  SharedLineCredentialMetadataDto,
  PartnerFeatureEntitlementDto,
  PartnerAiConfigurationDto,
  PartnerAiUsageDto,
  PartnerAiCreditHoldActionResultDto,
  PartnerAiCreditHoldDto,
  PartnerAiCreditHoldsDto,
  PartnerAiUsageMeasuresDto,
  PartnerAiUsageMonthDto,
  PlatformAiBudgetDto,
  SetPlatformAiBudgetDto,
  PartnerCredentialHealth,
  PartnerCredentialKind,
  LineContextHealth,
  PartnerMemberDto,
  PartnerMembersDto,
  SetPartnerOwnerNameInput,
  SetPartnerOwnerNameResult,
  PartnerMemberPasswordResetDto,
  PartnerMemberTempPasswordDto,
  CompanyPlanTermDto,
  CompanyPlanTermViewDto,
  RenewCompanyPlanTermBody,
  SetCompanyPlanTermBody,
  SystemUserLookupDto,
  SystemUserLookupItemDto,
  SystemUserMembershipDto,
  SystemUserMergeTrailDto,
  EmployeeLineLinkPackage,
  PartnerTimelineDto,
  PartnerTimelineEntryDto,
  PartnerLineMessageBody,
  PartnerLineMessageResultDto,
  PartnerIdentityControlDto,
  PatchPartnerIdentityDto,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type {
  PaginatedPartnersDto,
  PartnerCompanyDetailDto,
  PartnerCompanyStatus,
  PartnerCompanySummaryDto,
  UpdatePartnerProfileDto,
  PartnerLifecycleTransitionDto,
  SetPartnerFeaturesDto,
  SetPartnerFeaturesResultDto,
  SetPartnerAiModelDto,
  SetPartnerOcrConfigDto,
  PartnerOcrConfigDto,
  SetSharedLineCredentialDto,
  SharedLineCredentialMetadataDto,
  PartnerFeatureEntitlementDto,
  PartnerAiConfigurationDto,
  PartnerAiUsageDto,
  PartnerAiCreditHoldActionResultDto,
  PartnerAiCreditHoldDto,
  PartnerAiCreditHoldsDto,
  PartnerAiUsageMeasuresDto,
  PartnerAiUsageMonthDto,
  PlatformAiBudgetDto,
  SetPlatformAiBudgetDto,
  PartnerCredentialHealth,
  PartnerCredentialKind,
  LineContextHealth,
  PartnerMemberDto,
  PartnerMembersDto,
  PartnerMemberPasswordResetDto,
  PartnerMemberTempPasswordDto,
  CompanyPlanTermDto,
  CompanyPlanTermViewDto,
  RenewCompanyPlanTermBody,
  SetCompanyPlanTermBody,
  SystemUserLookupDto,
  SystemUserLookupItemDto,
  SystemUserMembershipDto,
  SystemUserMergeTrailDto,
  EmployeeLineLinkPackage,
  PartnerTimelineDto,
  PartnerTimelineEntryDto,
  PartnerLineMessageBody,
  PartnerLineMessageResultDto,
};

/** Response of the lifecycle endpoint — status + timestamps only, NOT the full detail. */
export type PartnerLifecycleResultDto = {
  id: string;
  status: PartnerCompanyStatus;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
};

export type PlatformAccessStatus = {
  requestedState: 'OPEN' | 'CLOSED';
  effectiveState: 'OPEN' | 'CLOSED';
  canOpen: boolean;
  servingMode: 'live' | 'maintenance_only' | 'non-production' | 'unknown';
  updatedAt: string | null;
  updatedBySystemAdminUserId: string | null;
  reason: string | null;
};

export function getPlatformAccess(): Promise<PlatformAccessStatus> {
  return apiFetch<PlatformAccessStatus>('/v1/system/platform-access');
}

export function setPlatformAccess(
  state: 'OPEN' | 'CLOSED',
  reason: string,
): Promise<PlatformAccessStatus> {
  return apiFetch<PlatformAccessStatus>('/v1/system/platform-access', {
    method: 'PUT',
    body: JSON.stringify({ state, reason }),
    suppressErrorToast: true,
  });
}

export async function listPartners(params?: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedPartnersDto> {
  const q = new URLSearchParams();
  if (params?.q) q.set('q', params.q);
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<PaginatedPartnersDto>(`/v1/system/partners${qs}`, { suppressErrorToast: true });
}

export async function getPartnerDetail(companyId: string): Promise<PartnerCompanyDetailDto> {
  return apiFetch<PartnerCompanyDetailDto>(`/v1/system/partners/${companyId}`);
}

export async function updatePartnerProfile(
  companyId: string,
  dto: UpdatePartnerProfileDto,
): Promise<PartnerCompanyDetailDto> {
  return apiFetch<PartnerCompanyDetailDto>(`/v1/system/partners/${companyId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

export async function partnerLifecycleTransition(
  companyId: string,
  dto: PartnerLifecycleTransitionDto,
): Promise<PartnerLifecycleResultDto> {
  return apiFetch<PartnerLifecycleResultDto>(`/v1/system/partners/${companyId}/lifecycle`, {
    method: 'POST',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

export async function setPartnerFeatures(
  companyId: string,
  dto: SetPartnerFeaturesDto,
): Promise<SetPartnerFeaturesResultDto> {
  return apiFetch<SetPartnerFeaturesResultDto>(`/v1/system/partners/${companyId}/features`, {
    method: 'PUT',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

/** Partial update: send `modelId`, `monthlyBudgetSatang` (null clears the override), or both. */
export async function setPartnerAiModel(
  companyId: string,
  dto: SetPartnerAiModelDto,
): Promise<{ companyId: string; modelId: string | null; monthlyBudgetSatang: number | null; updatedAt: string | null }> {
  return apiFetch(`/v1/system/partners/${companyId}/ai-model`, {
    method: 'PUT',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

export async function getPartnerAiUsage(companyId: string): Promise<PartnerAiUsageDto> {
  return apiFetch<PartnerAiUsageDto>(`/v1/system/partners/${companyId}/ai-usage`);
}

/** Held credit that needs an operator decision (hold spec §4.1). The API sweeps before it lists. */
export async function getPartnerAiCreditHolds(companyId: string): Promise<PartnerAiCreditHoldsDto> {
  return apiFetch<PartnerAiCreditHoldsDto>(`/v1/system/partners/${encodeURIComponent(companyId)}/ai-credit-holds`);
}

/**
 * One writer for the three decisions (hold spec §4.2): the path segment is the only difference, and
 * `suppressErrorToast` keeps the typed 404/409 for the page's own reload-and-explain handling.
 */
export async function actOnPartnerAiCreditHold(
  companyId: string,
  reservationId: string,
  action: 'release' | 'charge-at-bound' | 'acknowledge-breach',
  reason: string,
): Promise<PartnerAiCreditHoldActionResultDto> {
  return apiFetch<PartnerAiCreditHoldActionResultDto>(
    `/v1/system/partners/${encodeURIComponent(companyId)}/ai-credit-holds/${encodeURIComponent(reservationId)}/${action}`,
    { method: 'POST', body: JSON.stringify({ reason }), suppressErrorToast: true },
  );
}

export function getPartnerAiAdjustments(companyId:string, cursor?:string):Promise<PartnerAiAdjustmentHistory> {
  return apiFetch(`/v1/system/partners/${encodeURIComponent(companyId)}/ai-adjustments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {suppressErrorToast:true});
}

export async function setPartnerOcrConfig(
  companyId: string,
  dto: SetPartnerOcrConfigDto,
): Promise<PartnerOcrConfigDto> {
  return apiFetch<PartnerOcrConfigDto>(`/v1/system/partners/${companyId}/ocr-config`, {
    method: 'PUT',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

export async function getPlatformAiBudget(): Promise<PlatformAiBudgetDto> {
  return apiFetch<PlatformAiBudgetDto>('/v1/system/ai-budget');
}

export async function setPlatformAiBudget(dto: SetPlatformAiBudgetDto): Promise<PlatformAiBudgetDto> {
  return apiFetch<PlatformAiBudgetDto>('/v1/system/ai-budget', {
    method: 'PUT',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

/** Person-centric lookup across every company: one email can own several, and merged accounts
 *  leave a trail the per-company screens cannot show. */
export async function lookupUsers(q: string, status?: string): Promise<SystemUserLookupDto> {
  const params = new URLSearchParams({ q });
  if (status) params.set('status', status);
  return apiFetch<SystemUserLookupDto>(`/v1/system/users/lookup?${params}`, {
    suppressErrorToast: true,
  });
}

export async function getPartnerMembers(companyId: string): Promise<PartnerMembersDto> {
  return apiFetch<PartnerMembersDto>(`/v1/system/partners/${companyId}/members`);
}

export async function setPartnerOwnerName(
  companyId: string,
  memberUserId: string,
  body: SetPartnerOwnerNameInput,
): Promise<SetPartnerOwnerNameResult> {
  return apiFetch<SetPartnerOwnerNameResult>(`/v1/system/partners/${companyId}/members/${memberUserId}/display-name`, {
    method: 'PATCH', body: JSON.stringify(body), suppressErrorToast: true,
  });
}

export async function unlinkPartnerMemberLine(companyId: string, memberUserId: string): Promise<{ unlinked: true }> {
  return apiFetch<{ unlinked: true }>(`/v1/system/partners/${companyId}/members/${memberUserId}/line-unlink`, {
    method: 'POST',
    suppressErrorToast: true,
  });
}

export async function setPartnerMemberContact(
  companyId: string,
  memberUserId: string,
  body: { email: string; phoneNumber: string },
): Promise<{ updated: true }> {
  return apiFetch<{ updated: true }>(`/v1/system/partners/${companyId}/members/${memberUserId}/contact`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  });
}

/** Fresh LINE-link QR for a member. Password untouched; any prior pending QR is revoked. */
export async function issuePartnerMemberLineLinkToken(
  companyId: string,
  memberUserId: string,
): Promise<{ lineLink: EmployeeLineLinkPackage }> {
  return apiFetch<{ lineLink: EmployeeLineLinkPackage }>(
    `/v1/system/partners/${companyId}/members/${memberUserId}/line-link-token`,
    { method: 'POST', suppressErrorToast: true },
  );
}

export async function resetPartnerMemberPassword(
  companyId: string,
  memberUserId: string,
): Promise<PartnerMemberPasswordResetDto> {
  return apiFetch<PartnerMemberPasswordResetDto>(
    `/v1/system/partners/${companyId}/members/${memberUserId}/password/reset`,
    { method: 'POST', suppressErrorToast: true },
  );
}

export async function revealPartnerMemberTempPassword(
  companyId: string,
  memberUserId: string,
): Promise<PartnerMemberTempPasswordDto> {
  return apiFetch<PartnerMemberTempPasswordDto>(
    `/v1/system/partners/${companyId}/members/${memberUserId}/password/reveal`,
    { method: 'POST', suppressErrorToast: true },
  );
}

/** `term` is null for a grandfathered company: no plan limits and no end date until an admin sets one. */
export async function getPartnerPlanTerm(companyId: string): Promise<CompanyPlanTermViewDto> {
  return apiFetch<CompanyPlanTermViewDto>(`/v1/system/partners/${companyId}/plan-term`);
}

export async function setPartnerPlanTerm(
  companyId: string,
  body: SetCompanyPlanTermBody,
): Promise<CompanyPlanTermViewDto> {
  return apiFetch<CompanyPlanTermViewDto>(`/v1/system/partners/${companyId}/plan-term`, {
    method: 'PUT',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  });
}

/** P10-L §9 "ตรวจแล้ว": ends the first-week ceiling early. Idempotent on a warm-up already past. */
export async function endPartnerPlanTermWarmup(companyId: string): Promise<CompanyPlanTermViewDto> {
  return apiFetch<CompanyPlanTermViewDto>(`/v1/system/partners/${companyId}/plan-term/end-warmup`, {
    method: 'POST',
    suppressErrorToast: true,
  });
}

/** P10-L §8: one shop's story, assembled server-side from rows that already exist. */
export async function getPartnerTimeline(companyId: string): Promise<PartnerTimelineDto> {
  return apiFetch<PartnerTimelineDto>(`/v1/system/partners/${companyId}/timeline`, {
    suppressErrorToast: true,
  });
}

/** SEC-05: one operator-written LINE message to this shop's OWNERs. Bounded and audited server-side. */
export async function sendPartnerLineMessage(
  companyId: string,
  body: PartnerLineMessageBody,
): Promise<PartnerLineMessageResultDto> {
  return apiFetch<PartnerLineMessageResultDto>(`/v1/system/partners/${companyId}/line-message`, {
    method: 'POST',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  });
}

export async function renewPartnerPlanTerm(
  companyId: string,
  body: RenewCompanyPlanTermBody,
): Promise<CompanyPlanTermViewDto> {
  return apiFetch<CompanyPlanTermViewDto>(`/v1/system/partners/${companyId}/plan-term/renew`, {
    method: 'POST',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  });
}

export function getSharedLineMessagingSettings() {
  return apiFetch<SharedLineMessagingSettings>('/v1/system/line/shared-credentials', { suppressErrorToast: true });
}
export function setSharedLineMessagingSettings(dto: {
  channelId: string; channelSecret: string; accessToken: string; expectedVersion: number;
  rotationId: string; reason: string; password: string;
}) {
  return apiFetch<SharedLineMessagingSettings>('/v1/system/line/shared-credentials/LINE_MESSAGING_API', {
    method: 'PUT', body: JSON.stringify(dto), suppressErrorToast: true,
  });
}

/** Answer or correct a partner company's VAT registration. `expectedVersion` comes from the
 *  detail read, so a concurrent answer from the company's own screen 409s instead of being lost. */
export async function setPartnerVatRegistration(
  companyId: string,
  dto: { status: 'REGISTERED' | 'NOT_REGISTERED'; effectiveFrom: string; expectedVersion: number },
): Promise<{ version: number }> {
  return apiFetch(`/v1/system/partners/${companyId}/vat-registration`, {
    method: 'PUT',
    body: JSON.stringify({ ...dto, commandId: crypto.randomUUID() }),
    suppressErrorToast: true,
  });
}

export function getPartnerPlanAdjustments(companyId: string, cursor?: string): Promise<PartnerPlanAdjustmentHistory> {
  return apiFetch(`/v1/system/partners/${companyId}/plan-term/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {suppressErrorToast:true});
}

// Purchase without setup PR E (R-E3, DQ9): registered name / tax id / address, one path with the
// company's own (CompanyIdentityUseCase), gated on system.identity_reconciliation.resolve.
export function getPartnerIdentityControl(companyId: string): Promise<PartnerIdentityControlDto> {
  return apiFetch(`/v1/system/partners/${companyId}/identity`, { suppressErrorToast: true });
}
export function patchPartnerIdentity(companyId: string, dto: PatchPartnerIdentityDto): Promise<PartnerCompanyDetailDto> {
  return apiFetch(`/v1/system/partners/${companyId}/identity`, { method: 'PATCH', body: JSON.stringify(dto), suppressErrorToast: true });
}
