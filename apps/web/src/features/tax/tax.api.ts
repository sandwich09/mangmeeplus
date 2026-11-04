import type { WhtCertificateHandoffListQuery, WithholdingMonthDto, WithholdingMonthsDto, WhtCertificateHandoffPageDto, WhtFormType, WhtHandoffStatus, WhtReportDto } from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { prepareAttachmentUpload, withGenericUploadError } from '@/common/files/upload-file.logic';
import { uploadReceiptFile } from '../expenses/expenses.api';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export type TaxPeriod = {
  id: string;
  taxType: string;
  formType: string;
  periodKey: string;
  status: string;
  dueDate: string | null;
  filedAt: string | null;
  paidAt: string | null;
  reviewNote: string | null;
};

export type TaxEvent = {
  id: string;
  eventType: string;
  status: string;
  periodKey: string;
  eventDate: string;
  taxableBase: string;
  taxAmount: string;
  currency: string;
  vatMode: string | null;
  outputTaxCode: 'O7' | 'OX' | 'O0' | null;
  whtFormType: string | null;
  payeeSnapshot: { name: string; taxId: string | null } | null;
  incomeCategoryCode?: string | null;
  whtRate?: string | null;
  grossAmount?: string | null;
  withheldAmount?: string | null;
  netPaidAmount?: string | null;
  taxInvoiceNumber: string | null;
  sourceType: string;
  sourceId: string;
};

export type ReviewIssue = {
  id: string;
  severity: string;
  status: string;
  issueCode: string;
  description: string;
  sourceType: string | null;
  sourceId: string | null;
};

export type SyncResult = {
  vatOutputCreated: number;
  vatInputCreated: number;
  whtCreated: number;
  reviewIssuesCreated: number;
  skippedLocked: number;
};

// Mirrors the WhtIncomeCategory row the endpoint returns. `descriptionTh` used to be declared
// here and never existed on the wire — the column is nameTh — so nothing could render it.
export type WhtCategory = { id: string; code: string; nameTh: string; nameEn?: string | null; formType: string; defaultRate: string; status: string; conditionNote?: string | null };
export type TaxExportFormat = 'REVIEW_JSON' | 'CSV' | 'XLSX' | 'PDF';
export type TaxExportArtifact = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  checksum: string;
  byteLength: number;
};
export type TaxFilingPackageResult = {
  id: string;
  exportNumber: string;
  exportFormat: TaxExportFormat;
  checksum: string | null;
  artifact: TaxExportArtifact;
};

export function listTaxPeriods(companyId: string, params?: { taxType?: string; status?: string }): Promise<{ items: TaxPeriod[]; total: number }> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods${qs(params)}`);
}

export function listPnd53Periods(companyId: string): Promise<{ items: TaxPeriod[]; total: number }> {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/periods`);
}

export function syncPnd53(companyId: string): Promise<{ synced: true }> {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/sync`, { method: 'POST' });
}

export function generatePnd53(companyId: string, periodId: string) {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/periods/${periodId}/report`, { method: 'POST' });
}

export function exportPnd53(companyId: string, periodId: string, exportFormat: TaxExportFormat): Promise<TaxFilingPackageResult> {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/periods/${periodId}/export`,
    { method: 'POST', body: JSON.stringify({ exportFormat }) });
}

export function listPnd53Issues(companyId: string, periodId: string): Promise<ReviewIssue[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/periods/${periodId}/review-issues`);
}

export function resolvePnd53Issue(companyId: string, issueId: string, note: string): Promise<ReviewIssue> {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/review-issues/${issueId}/resolve`, { method: 'PATCH', body: JSON.stringify({ note }) });
}

export function markPnd53Filed(companyId: string, periodId: string): Promise<TaxPeriod> {
  return apiFetch(`/v1/companies/${companyId}/tax/pnd53/periods/${periodId}/mark-filed`, { method: 'PATCH', body: JSON.stringify({}) });
}

export type CompanyTaxProfile = {
  companyId: string;
  vatRegistered: boolean;
  branchPolicy: string;
  taxReviewerRole: string;
  /** WHT certificate system issuance plan §3: v1 is signature-only, no seal field. */
  signatureMode: 'BLANK' | 'AUTO_STAMP';
  signatureImageAttachmentId: string | null;
};

export function getTaxProfile(companyId: string): Promise<CompanyTaxProfile> {
  return apiFetch(`/v1/companies/${companyId}/tax/profile`);
}

export type CompanyTaxSignature = Pick<CompanyTaxProfile, 'signatureMode' | 'signatureImageAttachmentId'> & { signatureImageUrl: string | null; signatureStoredAt: string | null };

export function getTaxSignature(companyId: string): Promise<CompanyTaxSignature> {
  return apiFetch(`/v1/companies/${companyId}/tax/profile/signature`);
}

/** §3.3 (Decision B): OWNER-only (`company.tax_signature.manage`). */
export function updateTaxSignature(companyId: string, body: { signatureMode: 'BLANK' | 'AUTO_STAMP'; signatureAttachmentId?: string }): Promise<{ signatureMode: 'BLANK' | 'AUTO_STAMP'; signatureImageAttachmentId: string | null }> {
  return apiFetch(`/v1/companies/${companyId}/tax/profile/signature`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** Reuses the generic attachment upload flow (mirrors `uploadTradeTaxEvidenceAttachment`) — no
 *  dedicated upload endpoint for this feature (§3.2). */
export async function uploadCompanyTaxSignatureAttachment(companyId: string, file: File): Promise<string> {
  return withGenericUploadError(async () => {
    file = await prepareAttachmentUpload(file, 'image');
    const intent = await apiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
      `/companies/${companyId}/attachments/upload-intent`,
      { method: 'POST', body: JSON.stringify({ originalFileName: file.name, mimeType: file.type, byteSize: file.size, visibility: 'INTERNAL' }) },
    );
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await apiFetch(`/companies/${companyId}/attachments/${intent.attachmentId}/complete`, { method: 'POST', body: JSON.stringify({ byteSize: file.size }) });
    return intent.attachmentId;
  });
}

export function syncTaxEvents(companyId: string, since?: string): Promise<SyncResult> {
  return apiFetch(`/v1/companies/${companyId}/tax/sync`, { method: 'POST', body: JSON.stringify({ since }) });
}

export function listTaxEvents(companyId: string, periodId: string): Promise<TaxEvent[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/events`);
}

export function generateVatReport(companyId: string, periodId: string, periodKey: string, formType: 'PP30' | 'PP36' = 'PP30') {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/vat-report`, { method: 'POST', body: JSON.stringify({ formType, periodKey }) });
}

export function generateWhtReport(companyId: string, periodId: string, periodKey: string, formType: 'PND3' | 'PND53' = 'PND53') {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/wht-report`, { method: 'POST', body: JSON.stringify({ formType, periodKey }) });
}

export function generateFilingPackage(companyId: string, periodId: string, exportFormat: TaxExportFormat): Promise<TaxFilingPackageResult> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/filing-packages`, { method: 'POST', body: JSON.stringify({ exportFormat }) });
}

export function listReviewIssues(companyId: string, periodId: string, status?: string): Promise<ReviewIssue[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/review-issues${qs({ status })}`);
}

export function resolveReviewIssue(companyId: string, issueId: string, note: string): Promise<ReviewIssue> {
  return apiFetch(`/v1/companies/${companyId}/tax/review-issues/${issueId}/resolve`, { method: 'PATCH', body: JSON.stringify({ note }) });
}

export function markFiled(companyId: string, periodId: string, note?: string, establishmentCode?: string, sequence?: number): Promise<TaxPeriod> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/mark-filed`, { method: 'PATCH', body: JSON.stringify({ note, establishmentCode, sequence }) });
}

export function markPaid(companyId: string, periodId: string, note?: string): Promise<TaxPeriod> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/mark-paid`, { method: 'PATCH', body: JSON.stringify({ note }) });
}

export function listWhtCategories(companyId: string, status?: string): Promise<WhtCategory[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/wht-categories${qs({ status })}`);
}


export function listWithholdingMonths(companyId: string): Promise<WithholdingMonthsDto> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/months`);
}

export function getWithholdingMonth(companyId: string, periodKey: string): Promise<WithholdingMonthDto> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/months/${encodeURIComponent(periodKey)}`);
}

export function listWithholdingPeriods(companyId: string, formType: WhtFormType): Promise<{ items: TaxPeriod[]; total: number }> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/periods`);
}

export function listWithholdingEvents(companyId: string, formType: WhtFormType, periodId: string): Promise<TaxEvent[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/periods/${periodId}/events`);
}

export function syncWithholding(companyId: string, formType: WhtFormType): Promise<{ synced: true }> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/sync`, { method: 'POST', suppressErrorToast: true });
}

export function generateWithholdingReport(companyId: string, formType: WhtFormType, periodId: string): Promise<WhtReportDto> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/periods/${periodId}/report`, { method: 'POST' });
}

export function exportWithholding(companyId: string, formType: WhtFormType, periodId: string, exportFormat: 'PDF' | 'XLSX' = 'PDF', establishmentCode?: string, sequence?: number): Promise<TaxFilingPackageResult> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/periods/${periodId}/export`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ exportFormat, establishmentCode, sequence }) });
}

export function listWithholdingIssues(companyId: string, formType: WhtFormType, periodId: string): Promise<ReviewIssue[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/periods/${periodId}/review-issues`);
}

export function resolveWithholdingIssue(companyId: string, formType: WhtFormType, issueId: string, note: string): Promise<ReviewIssue> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/review-issues/${issueId}/resolve`, { method: 'PATCH', body: JSON.stringify({ note }) });
}

export function markWithholdingFiled(companyId: string, formType: WhtFormType, periodId: string, note?: string, establishmentCode?: string, sequence?: number): Promise<TaxPeriod> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/${formType}/periods/${periodId}/mark-filed`, { method: 'PATCH', body: JSON.stringify({ note, establishmentCode, sequence }) });
}

export function listWithholdingCertificates(companyId: string, params: WhtCertificateHandoffListQuery = {}): Promise<WhtCertificateHandoffPageDto> {
  return apiFetch(`/v1/companies/${companyId}/wht/payment-handoffs${qs({ page: 1, ...params })}`);
}

export function getWhtPayerMode(companyId: string, periodKey?: string) {
  return apiFetch<import('@watchdog-bms/contracts').WhtPayerModeDto>(`/v1/companies/${companyId}/tax/withholding/payer-mode${qs({ periodKey })}`, { suppressErrorToast: true });
}
export function answerWhtPayerMode(companyId: string, answer: import('@watchdog-bms/contracts').AnswerWhtPayerModeRequest) {
  return apiFetch<import('@watchdog-bms/contracts').WhtPayerModeDto>(`/v1/companies/${companyId}/tax/withholding/payer-mode`, { method: 'POST', body: JSON.stringify(answer), suppressErrorToast: true });
}

export function confirmWithholdingRows(companyId: string, filingId: string): Promise<{ confirmed: true }> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/filings/${filingId}/confirm-rows`, { method: 'POST', suppressErrorToast: true, body: JSON.stringify({ confirmed: true }) });
}

export function exportWithholdingEWht(companyId: string, periodKey: string, establishmentCode?: string): Promise<TaxExportArtifact> {
  return apiFetch(`/v1/companies/${companyId}/tax/withholding/months/${encodeURIComponent(periodKey)}/e-wht-export${qs({ establishmentCode })}`, { suppressErrorToast: true });
}
