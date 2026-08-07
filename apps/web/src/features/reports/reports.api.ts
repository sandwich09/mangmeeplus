import type {
  CreateReportExportInput,
  CreateReportViewInput,
  ReportCatalogDto,
  ReportExportDownloadDto,
  ReportExportRequestDto,
  ReportQueryInput,
  ReportRunHistoryPageDto,
  ReportResultDto,
  ReportViewDto,
} from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';

function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return authedApiFetch<T>(`/v1${path}`, init);
}

const base = (companyId: string) => `/companies/${companyId}/reports`;

export function listReportCatalog(companyId: string) {
  return apiFetch<ReportCatalogDto>(`${base(companyId)}/catalog`);
}

export function runReportQuery(companyId: string, body: ReportQueryInput) {
  return apiFetch<ReportResultDto>(`${base(companyId)}/query`, { method: 'POST', body: JSON.stringify(body) });
}

export function listReportRuns(companyId: string, pageSize = 8, cursor?: string) {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (cursor) query.set('cursor', cursor);
  return apiFetch<ReportRunHistoryPageDto>(`${base(companyId)}/runs?${query.toString()}`);
}

export function listReportViews(companyId: string) {
  return apiFetch<ReportViewDto[]>(`${base(companyId)}/views`);
}

export function createReportView(companyId: string, body: CreateReportViewInput) {
  return apiFetch<ReportViewDto>(`${base(companyId)}/views`, { method: 'POST', body: JSON.stringify(body) });
}

export function createReportExport(companyId: string, body: CreateReportExportInput) {
  return apiFetch<ReportExportRequestDto>(`${base(companyId)}/exports`, { method: 'POST', body: JSON.stringify(body) });
}

export function listReportExports(companyId: string) {
  return apiFetch<ReportExportRequestDto[]>(`${base(companyId)}/exports`);
}

export function downloadReportExport(companyId: string, exportId: string) {
  return apiFetch<ReportExportDownloadDto>(`${base(companyId)}/exports/${exportId}/download`);
}
