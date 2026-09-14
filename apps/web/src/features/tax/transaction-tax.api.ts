import type {
  CreateTaxCodeProfileInput,
  CreateTradeTaxEvidenceInput,
  Pp30BoxesDto,
  ResolveTransactionTaxPreviewDto,
  TaxAccountDeterminationRuleDto,
  TaxCodeDefinitionDto,
  TaxCodeProfileTemplateKey,
  TaxCodeProfileDto,
  TaxProfileSetupReadiness,
  TaxReconciliationDetailDto,
  TaxReconciliationRunDto,
  TaxReportMappingRuleDto,
  TaxReportForm,
  TradeTaxEvidenceDto,
  TransactionTaxDirection,
  TransactionTaxLineInput,
  UpsertTaxAccountDeterminationRuleInput,
  UpsertTaxCodeDefinitionInput,
  UpsertTaxReportMappingRuleInput,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { uploadReceiptFile } from '../expenses/expenses.api';
import { prepareAttachmentUpload, withGenericUploadError } from '@/common/files/upload-file.logic';

function qs(params?: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : '';
}

const base = (companyId: string) => `/companies/${companyId}/tax`;

export const listTaxCodeProfiles = (companyId: string, filters?: Record<string, unknown>) =>
  apiFetch<TaxCodeProfileDto[]>(`${base(companyId)}/code-profiles${qs(filters)}`);
export type TaxCodeProfileTemplate = {
  key: TaxCodeProfileTemplateKey;
  name: string;
  sourceSystem: 'WATCHDOG' | 'SAP_ERP' | 'SAP_S4HANA';
  sourceUrl: string | null;
  warning: string;
  definitionCount: number;
};
export const listTaxCodeProfileTemplates = (companyId: string) =>
  apiFetch<TaxCodeProfileTemplate[]>(`${base(companyId)}/code-profile-templates`);
export const createTaxCodeProfileFromTemplate = (companyId: string, templateKey: TaxCodeProfileTemplate['key'], effectiveFrom: string) =>
  apiFetch<{ profile: TaxCodeProfileDto; created: boolean; warning: string }>(`${base(companyId)}/code-profile-templates/${templateKey}`, { method: 'POST', body: JSON.stringify({ effectiveFrom }) });
export const createTaxCodeProfile = (companyId: string, body: CreateTaxCodeProfileInput) =>
  apiFetch<TaxCodeProfileDto>(`${base(companyId)}/code-profiles`, { method: 'POST', body: JSON.stringify(body) });
export const updateTaxCodeProfile = (companyId: string, profileId: string, body: Partial<CreateTaxCodeProfileInput>) =>
  apiFetch<TaxCodeProfileDto>(`${base(companyId)}/code-profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const getTaxCodeProfileReadiness = (companyId: string, profileId: string) =>
  apiFetch<TaxProfileSetupReadiness>(`${base(companyId)}/code-profiles/${profileId}/readiness`);
export const activateTaxCodeProfile = (companyId: string, profileId: string) =>
  apiFetch<TaxCodeProfileDto>(`${base(companyId)}/code-profiles/${profileId}/activate`, { method: 'POST', body: '{}' });
export const retireTaxCodeProfile = (companyId: string, profileId: string) =>
  apiFetch<TaxCodeProfileDto>(`${base(companyId)}/code-profiles/${profileId}/retire`, { method: 'POST', body: '{}' });

export type TaxCodeImportPreview = {
  profileId: string;
  checksum: string;
  canApply: boolean;
  rows: Array<{ rowNumber: number; definition: UpsertTaxCodeDefinitionInput | null; errors: string[]; conflict: boolean }>;
};
export const previewTaxCodeImport = (companyId: string, profileId: string, body: { format: 'CSV' | 'JSON'; content: string }) =>
  apiFetch<TaxCodeImportPreview>(`${base(companyId)}/code-profiles/${profileId}/import-preview`, { method: 'POST', body: JSON.stringify(body) });
export const applyTaxCodeImport = (companyId: string, profileId: string, body: { format: 'CSV' | 'JSON'; content: string; expectedChecksum: string }) =>
  apiFetch<{ checksum: string; imported: number }>(`${base(companyId)}/code-profiles/${profileId}/import-apply`, { method: 'POST', body: JSON.stringify(body) });

export const listTaxCodeDefinitions = (companyId: string, filters?: Record<string, unknown>) =>
  apiFetch<TaxCodeDefinitionDto[]>(`${base(companyId)}/code-definitions${qs(filters)}`);
export const upsertTaxCodeDefinition = (companyId: string, body: UpsertTaxCodeDefinitionInput) =>
  apiFetch<TaxCodeDefinitionDto>(
    body.id ? `${base(companyId)}/code-definitions/${body.id}` : `${base(companyId)}/code-definitions`,
    {
      method: body.id ? 'PATCH' : 'POST',
      body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'id'))),
    },
  );

export const resolveTransactionTaxPreview = (
  companyId: string,
  input: TransactionTaxLineInput,
  options?: { profileId?: string; direction?: TransactionTaxDirection; sourceModule?: string },
) => apiFetch<ResolveTransactionTaxPreviewDto>(`${base(companyId)}/resolve-preview`, {
  method: 'POST', body: JSON.stringify({ input, ...options }),
});

export const listTaxAccountRules = (companyId: string, filters?: Record<string, unknown>) =>
  apiFetch<TaxAccountDeterminationRuleDto[]>(`${base(companyId)}/account-determination${qs(filters)}`);
export const upsertTaxAccountRule = (companyId: string, body: UpsertTaxAccountDeterminationRuleInput) =>
  apiFetch<TaxAccountDeterminationRuleDto>(`${base(companyId)}/account-determination`, { method: 'PUT', body: JSON.stringify(body) });
export const listTaxReportMappings = (companyId: string, filters?: Record<string, unknown>) =>
  apiFetch<TaxReportMappingRuleDto[]>(`${base(companyId)}/report-mappings${qs(filters)}`);
export const upsertTaxReportMapping = (companyId: string, body: UpsertTaxReportMappingRuleInput) =>
  apiFetch<TaxReportMappingRuleDto>(`${base(companyId)}/report-mappings`, { method: 'PUT', body: JSON.stringify(body) });

export const listTradeTaxEvidence = (companyId: string, filters?: Record<string, unknown>) =>
  apiFetch<TradeTaxEvidenceDto[]>(`${base(companyId)}/trade-evidence${qs(filters)}`);
export const createTradeTaxEvidence = (companyId: string, body: CreateTradeTaxEvidenceInput) =>
  apiFetch<TradeTaxEvidenceDto>(`${base(companyId)}/trade-evidence`, { method: 'POST', body: JSON.stringify(body) });
export const verifyTradeTaxEvidence = (companyId: string, evidenceId: string, status: 'VERIFIED' | 'REJECTED') =>
  apiFetch<TradeTaxEvidenceDto>(`${base(companyId)}/trade-evidence/${evidenceId}/verify`, { method: 'POST', body: JSON.stringify({ status }) });
export const getTradeTaxEvidenceAttachmentDownloadUrl = (companyId: string, attachmentId: string) =>
  apiFetch<{ downloadUrl: string; expiresAt: string }>(`/companies/${companyId}/attachments/${attachmentId}/download-url`);

export async function uploadTradeTaxEvidenceAttachment(companyId: string, branchId: string | undefined, file: File): Promise<string> {
  return withGenericUploadError(async () => {
    file = await prepareAttachmentUpload(file);
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `/companies/${companyId}/attachments/upload-intent`,
      { method: 'POST', body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size, visibility: 'INTERNAL', ...(branchId ? { branchId } : {}) }) },
    );
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await apiFetch(`/companies/${companyId}/attachments/${intent.attachmentId}/complete`, { method: 'POST', body: JSON.stringify({ byteSize: file.size }) });
    return intent.attachmentId;
  });
}

export const createTaxReconciliation = (companyId: string, body: { formType: TaxReportForm; periodKey: string; branchId?: string }) =>
  apiFetch<TaxReconciliationRunDto>(`${base(companyId)}/reconciliations`, { method: 'POST', body: JSON.stringify(body) });
export const listTaxReconciliations = (companyId: string, filters?: { formType?: TaxReportForm; periodKey?: string; branchId?: string; page?: number; pageSize?: number }) =>
  apiFetch<TaxReconciliationRunDto[]>(`${base(companyId)}/reconciliations${qs(filters)}`);
export const getTaxReconciliation = (companyId: string, runId: string, filters?: { page?: number; pageSize?: number }) =>
  apiFetch<TaxReconciliationDetailDto>(`${base(companyId)}/reconciliations/${runId}${qs(filters)}`);
export const reviewTaxReconciliation = (companyId: string, runId: string, note?: string) =>
  apiFetch<TaxReconciliationRunDto>(`${base(companyId)}/reconciliations/${runId}/review`, { method: 'POST', body: JSON.stringify({ note }) });
export const getPp30Boxes = (companyId: string, periodKey: string, branchId?: string) =>
  apiFetch<Pp30BoxesDto>(`${base(companyId)}/reports/pp30-boxes${qs({ periodKey, branchId })}`);
