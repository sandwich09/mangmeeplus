import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

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

export function markFiled(companyId: string, periodId: string, note?: string): Promise<TaxPeriod> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/mark-filed`, { method: 'PATCH', body: JSON.stringify({ note }) });
}

export function markPaid(companyId: string, periodId: string, note?: string): Promise<TaxPeriod> {
  return apiFetch(`/v1/companies/${companyId}/tax/periods/${periodId}/mark-paid`, { method: 'PATCH', body: JSON.stringify({ note }) });
}

export function listWhtCategories(companyId: string, status?: string): Promise<WhtCategory[]> {
  return apiFetch(`/v1/companies/${companyId}/tax/wht-categories${qs({ status })}`);
}

/**
 * Records that an accountant has checked a statutory rate against the RD. Nothing may withhold
 * under a category until this has been done — the catalog ships DRAFT for exactly that reason.
 */
export function setWhtCategoryStatus(companyId: string, code: string, status: 'ACTIVE' | 'DRAFT'): Promise<WhtCategory> {
  return apiFetch(`/v1/companies/${companyId}/tax/wht-categories/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}
