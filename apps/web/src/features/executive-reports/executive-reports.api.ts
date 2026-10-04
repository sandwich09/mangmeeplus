import type { ExecutiveContext, ExecutiveOverview, ExecutiveCompanies, ExecutiveAnalysis, ExecutiveCompanyDetail, ExecutiveCompanyHistory } from '@watchdog-bms/contracts';
import { authedApiFetch, authedFetch } from '../../common/api/authed-fetch';
import { executiveHref, type ReportSection } from './executive-reports.logic';

export type ReportData = ExecutiveOverview | ExecutiveCompanies | ExecutiveAnalysis | ExecutiveCompanyDetail;
export function getExecutiveContext(signal: AbortSignal): Promise<ExecutiveContext> {
  return authedApiFetch('/v1/system/executive/context', { signal, cache: 'no-store', suppressErrorToast: true });
}
export async function getExecutiveReport(section: ReportSection, query: Record<string, string | number>, signal: AbortSignal, targetCompanyId?: string): Promise<ReportData> {
  const endpoint = section === 'detail' ? `companies/${encodeURIComponent(targetCompanyId!)}` : section === 'overview' || section === 'companies' ? section : 'analysis';
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const report = await authedApiFetch<ReportData>(executiveHref(`/v1/system/executive/${endpoint}`, params), { signal, cache: 'no-store', suppressErrorToast: true });
  if (section !== 'revenue' || query.view !== 'top') return report;
  // The top endpoint has no receipt/tax/fee totals. Read the existing summary from the same build for the shared strip.
  params.set('view', 'summary'); params.set('buildId', report.build.id);
  const summary = await authedApiFetch<ExecutiveAnalysis>(executiveHref('/v1/system/executive/analysis', params), { signal, cache: 'no-store', suppressErrorToast: true });
  if (summary.buildChanged || summary.build.id !== report.build.id) throw Error('executive revenue builds differ');
  return { ...report, revenue: summary.revenue } as ExecutiveAnalysis;
}
export function getExecutiveHistory(targetCompanyId: string, page: number, signal: AbortSignal): Promise<ExecutiveCompanyHistory> {
  return authedApiFetch(executiveHref(`/v1/system/executive/companies/${encodeURIComponent(targetCompanyId)}/history`, { page: String(page), pageSize: '20' }), { signal, cache: 'no-store', suppressErrorToast: true });
}

/** API13 returns a complete XLSX directly, with no saved copy or download URL. */
export async function getExecutiveExport(body: import('@watchdog-bms/contracts').ExecutiveExportBody, signal: AbortSignal): Promise<Blob> {
  const response = await authedFetch('/v1/system/executive/exports', { method: 'POST', body: JSON.stringify(body), signal, cache: 'no-store' });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw { status: response.status, details, code: details.code, retryAfterSeconds: details.retryAfterSeconds ?? Number(response.headers.get('Retry-After')) };
  }
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (!blob.size || blob.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || signature[0] !== 0x50 || signature[1] !== 0x4b) throw Error('invalid export artifact');
  return blob;
}
export function downloadExecutiveExport(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = fileName; link.style.display = 'none'; document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
