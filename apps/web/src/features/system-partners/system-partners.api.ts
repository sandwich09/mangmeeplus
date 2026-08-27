import type {
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
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedPartnersDto> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<PaginatedPartnersDto>(`/v1/system/partners${qs}`);
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
): Promise<{ companyId: string; modelId: string | null; monthlyBudgetSatang: number | null; updatedAt: string }> {
  return apiFetch(`/v1/system/partners/${companyId}/ai-model`, {
    method: 'PUT',
    body: JSON.stringify(dto),
    suppressErrorToast: true,
  });
}

export async function getPartnerAiUsage(companyId: string): Promise<PartnerAiUsageDto> {
  return apiFetch<PartnerAiUsageDto>(`/v1/system/partners/${companyId}/ai-usage`);
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

export async function getPartnerMembers(companyId: string): Promise<PartnerMembersDto> {
  return apiFetch<PartnerMembersDto>(`/v1/system/partners/${companyId}/members`);
}

export async function unlinkPartnerMemberLine(companyId: string, memberUserId: string): Promise<{ unlinked: true }> {
  return apiFetch<{ unlinked: true }>(`/v1/system/partners/${companyId}/members/${memberUserId}/line-unlink`, {
    method: 'POST',
    suppressErrorToast: true,
  });
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

export async function setSharedLineCredential(
  credentialKind: 'LINE_MESSAGING_API' | 'LINE_LOGIN' | 'LINE_LIFF',
  dto: SetSharedLineCredentialDto,
): Promise<SharedLineCredentialMetadataDto> {
  return apiFetch<SharedLineCredentialMetadataDto>(
    `/v1/system/line/shared-credentials/${credentialKind}`,
    { method: 'PUT', body: JSON.stringify(dto) },
  );
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
