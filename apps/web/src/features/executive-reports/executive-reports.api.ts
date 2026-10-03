import type { ExecutiveContext, ExecutiveOverview, ExecutiveCompanies, ExecutiveAnalysis, ExecutiveCompanyDetail, ExecutiveCompanyHistory } from '@watchdog-bms/contracts';
import { authedApiFetch } from '../../common/api/authed-fetch';
import type { ReportSection } from './executive-reports.logic';

export type ReportData = ExecutiveOverview | ExecutiveCompanies | ExecutiveAnalysis | ExecutiveCompanyDetail;
export function getExecutiveContext(signal: AbortSignal): Promise<ExecutiveContext> {
  return authedApiFetch('/v1/system/executive/context', { signal, cache: 'no-store', suppressErrorToast: true });
}
export function getExecutiveReport(section: ReportSection, query: Record<string, string | number>, signal: AbortSignal, targetCompanyId?: string): Promise<ReportData> {
  const endpoint = section === 'detail' ? `companies/${encodeURIComponent(targetCompanyId!)}` : section === 'overview' || section === 'companies' ? section : 'analysis';
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return authedApiFetch(`/v1/system/executive/${endpoint}?${params}`, { signal, cache: 'no-store', suppressErrorToast: true });
}
export function getExecutiveHistory(targetCompanyId: string, page: number, signal: AbortSignal): Promise<ExecutiveCompanyHistory> {
  return authedApiFetch(`/v1/system/executive/companies/${encodeURIComponent(targetCompanyId)}/history?page=${page}&pageSize=20`, { signal, cache: 'no-store', suppressErrorToast: true });
}
