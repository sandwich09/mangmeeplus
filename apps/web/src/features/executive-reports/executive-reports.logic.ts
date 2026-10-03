import {
  EXECUTIVE_REPORT_LABELS, EXECUTIVE_FLAG_LABELS, EXECUTIVE_SORT_OPTIONS, type ExecutiveContext, type ExecutiveCount, type ExecutiveMoney,
  type ExecutiveRatio, type ExecutiveSourceCoverage, type ExecutiveOwnerContact, type ExecutiveDrilldownFilters, type ExecutiveRankingMetric, type ExecutiveEnvelope,
} from '@watchdog-bms/contracts';
import { deserializeListQuery } from '../../common/functions/list-query';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth } from '../../common/i18n/thai-date';
import { apiErrorCode, executiveReasonMessage } from '../../common/api/api-error-message';
import { W, RANK_LABELS, REPORT_VIEWS, thaiLabel } from './executive-reports.words';

export type ReportSection = 'overview' | 'companies' | 'usage' | 'revenue' | 'customers' | 'compare' | 'detail';
export const EXECUTIVE_ACCESS_DENIED_EVENT = 'watchdog:executive-access-denied';
export const FILTER_URL = { industry: 'filter_industry', discovery: 'filter_discovery', referringSales: 'filter_sales', companyStatus: 'filter_companyStatus', planState: 'filter_planState', usageGroup: 'filter_usage', paidEver: 'filter_paidEver', receiptAdoption: 'filter_receipt', spendCohort: 'filter_spend', signupRail: 'filter_signupRail' } as const;
export const GLOBAL_FILTERS = ['industry', 'discovery', 'referringSales'] as const;
export const DIRECTORY_FILTERS = ['companyStatus', 'planState', 'usageGroup', 'paidEver', 'receiptAdoption', 'spendCohort', 'signupRail'] as const;
export const reportPath = (section: string) => section === 'overview' ? '/system/executive' : `/system/executive/${section}`;
export const pageNumber = (raw: string | null) => raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : 1;
export function reportContextParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of ['month', ...GLOBAL_FILTERS.map(key => FILTER_URL[key])]) if (params.has(key)) next.set(key, params.get(key)!);
  return next;
}
export const menuHref = (section: string, params: URLSearchParams) => `${reportPath(section)}${reportContextParams(params).size ? `?${reportContextParams(params)}` : ''}`;
export function normalizedMonth(params: URLSearchParams, context: ExecutiveContext): string {
  const month = params.get('month') ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= context.currentMonth && (!context.months || month >= context.months.first) ? month : context.defaultMonth;
}
export function filterValue(key: keyof typeof FILTER_URL, params: URLSearchParams, context: ExecutiveContext): string {
  const value = params.get(FILTER_URL[key]);
  return context.filters[key].some(option => option.value === value) ? value! : 'ALL';
}
export function reportView(section: 'usage' | 'revenue' | 'customers', params: URLSearchParams): string {
  return REPORT_VIEWS[section].find(view => view.value === params.get('view'))?.value ?? REPORT_VIEWS[section][0].value;
}
export function drillFilters(params: URLSearchParams): ExecutiveDrilldownFilters | null {
  if (!params.has('pick')) return null;
  const picked = new URLSearchParams(params.get('pick') ?? '');
  const allowed = [...Object.keys(FILTER_URL), 'usageAssessed', 'activeInPeriod', 'paidInPeriod', 'positiveNetInPeriod', 'fullyRefunded', 'sortBy', 'sortDir'];
  if ([...picked.keys()].some(key => !allowed.includes(key))) return null;
  const result = Object.fromEntries(picked) as ExecutiveDrilldownFilters;
  for (const [key, value] of Object.entries(result)) {
    if (key in EXECUTIVE_REPORT_LABELS && key !== 'referringSales' && !Object.hasOwn(EXECUTIVE_REPORT_LABELS[key as keyof typeof EXECUTIVE_REPORT_LABELS], value)) return null;
    if (key === 'referringSales' && !/^[A-Za-z0-9_-]{1,40}$/.test(value)) return null;
    if (key === 'sortBy' && !EXECUTIVE_SORT_OPTIONS.some(option => option.sortBy === value)) return null;
    if (key === 'sortDir' && !['asc', 'desc'].includes(value)) return null;
    if (['activeInPeriod', 'paidInPeriod', 'positiveNetInPeriod', 'fullyRefunded'].includes(key) && value !== 'true') return null;
    if (key === 'usageAssessed' && !['true', 'false'].includes(value)) return null;
  }
  return result;
}
export function reportQuery(section: ReportSection, params: URLSearchParams, context: ExecutiveContext, search = ''): Record<string, string | number> {
  const month = normalizedMonth(params, context);
  if (section === 'detail') return { month };
  if (section === 'compare') {
    const dimension = ['industry', 'discovery', 'referringSales', 'company'].includes(params.get('by') ?? '') ? params.get('by')! : 'industry';
    return { month, section, dimension, sideA: params.get('a') ?? '', sideB: params.get('b') ?? '' };
  }
  const global = Object.fromEntries(GLOBAL_FILTERS.map(key => [key, filterValue(key, params, context)]));
  if (section === 'overview') return { month, ...global };
  if (section !== 'companies') {
    const view = reportView(section, params);
    const rank = params.get('rank') as ExecutiveRankingMetric;
    return { month, ...global, section, view, ...(section === 'usage' && view === 'ranking' ? { metric: Object.hasOwn(RANK_LABELS, rank) ? rank : 'expenseReceiptCount' } : {}) };
  }
  const picked = drillFilters(params);
  const directory = Object.fromEntries(DIRECTORY_FILTERS.flatMap(key => { const value = filterValue(key, params, context); return value === 'ALL' ? [] : [[key, value]]; }));
  const list = deserializeListQuery(params);
  const order = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === list.sortBy) ?? EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === picked?.sortBy) ?? EXECUTIVE_SORT_OPTIONS[0];
  return { month, ...(picked ?? global), ...directory, sortBy: order.sortBy, sortDir: list.sortDir ?? picked?.sortDir ?? order.sortDir, page: pageNumber(params.get('page')), pageSize: 20, ...(search.trim() ? { q: search.trim().slice(0, 120) } : {}) };
}
export function drilldownHref(params: URLSearchParams, from: string, filters: ExecutiveDrilldownFilters): string {
  const next = reportContextParams(params);
  next.set('pick', new URLSearchParams(filters as Record<string, string>).toString());
  next.set('from', from);
  return `${reportPath('companies')}?${next}`;
}
export function drillLabels(filters: ExecutiveDrilldownFilters, context: ExecutiveContext): string[] {
  return Object.entries(filters).flatMap(([key, value]) => {
    if (value === 'ALL' || ['sortBy', 'sortDir'].includes(key)) return [];
    const label = EXECUTIVE_REPORT_LABELS[key as keyof typeof EXECUTIVE_REPORT_LABELS]?.[value]
      ?? EXECUTIVE_FLAG_LABELS[key as keyof typeof EXECUTIVE_FLAG_LABELS]?.[value]
      ?? context.filters.referringSales.find(option => option.value === value)?.label ?? W.unknown;
    return [thaiLabel(label, value)];
  });
}
export function reportFilterChips(applied: ExecutiveEnvelope['appliedFilters'] | undefined, picked: ExecutiveDrilldownFilters | null, context: ExecutiveContext): { picked: string[]; active: string[] } {
  return {
    picked: picked ? drillLabels(picked, context) : [],
    active: [...Object.entries(applied?.global ?? {}), ...Object.entries(applied?.directory ?? {})]
      .filter(([key, option]) => option.value !== 'ALL' && picked?.[key as keyof ExecutiveDrilldownFilters] !== option.value)
      .map(([, option]) => thaiLabel(option.label, option.value)),
  };
}
export function changedParams(params: URLSearchParams, changes: Record<string, string>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
  const picked = drillFilters(params);
  if (picked && !Object.hasOwn(changes, 'pick')) {
    for (const key of GLOBAL_FILTERS) if (Object.hasOwn(changes, FILTER_URL[key])) {
      if (changes[FILTER_URL[key]] === 'ALL') delete picked[key];
      else picked[key] = changes[FILTER_URL[key]];
    }
    next.set('pick', new URLSearchParams(picked as Record<string, string>).toString());
  }
  if (!Object.hasOwn(changes, 'page')) next.set('page', '1');
  next.delete('q'); next.delete('search'); next.delete('buildId');
  return next;
}
export function clearedParams(params: URLSearchParams): URLSearchParams {
  return new URLSearchParams({ month: params.get('month') ?? '', filter_industry: 'ALL', filter_discovery: 'ALL', filter_sales: 'ALL' });
}
export function comparisonProblem(params: URLSearchParams, context: ExecutiveContext): 'choose' | 'same' | null {
  const by = params.get('by') ?? 'industry', a = params.get('a'), b = params.get('b');
  if (!a || !b || !['industry', 'discovery', 'referringSales', 'company'].includes(by)) return 'choose';
  if (by !== 'company' && (!context.filters[by as 'industry' | 'discovery' | 'referringSales'].some(option => option.value === a && a !== 'ALL') || !context.filters[by as 'industry' | 'discovery' | 'referringSales'].some(option => option.value === b && b !== 'ALL'))) return 'choose';
  return a === b ? 'same' : null;
}
export function swappedParams(params: URLSearchParams): URLSearchParams {
  return changedParams(params, { a: params.get('b') ?? '', b: params.get('a') ?? '' });
}
export const money = (satang: number) => `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
export const countText = (figure: ExecutiveCount) => figure.value !== null ? figure.value.toLocaleString('th-TH') : figure.knownValue !== undefined ? `${W.atLeast} ${figure.knownValue.toLocaleString('th-TH')}` : '—';
export const moneyText = (figure: ExecutiveMoney, measured = false) => figure.value !== null ? money(figure.value) : figure.knownValue !== undefined ? `${money(figure.knownValue)} (${measured ? W.partialMeasuredMoney : W.partialMoney})` : '—';
export const ratioText = (figure: ExecutiveRatio | null | undefined, unit = '%') => figure?.value === null || figure?.value === undefined ? '—' : `${figure.value.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`;
export const reportMonth = formatThaiMonth, reportDate = formatThaiDate, reportDateTime = formatThaiDateTime;
export function sourceCount(value: number, source: ExecutiveSourceCoverage): ExecutiveCount {
  return { value: source.coverage === 'complete' ? value : null, ...(source.coverage === 'partial' ? { knownValue: value } : {}), ...source };
}
export const sourceMoney = (value: number, source: ExecutiveSourceCoverage): ExecutiveMoney => ({ ...sourceCount(value, source), currency: 'THB' });
export const negativeMoneyNote = (value: number | null | undefined) => value !== null && value !== undefined && value < 0 ? W.negative : null;
export const reasonText = executiveReasonMessage;
export function queryFieldErrors(error: unknown): Record<string, string> {
  const e = error as { fieldErrors?: unknown; details?: { fieldErrors?: unknown } };
  const fields = e?.fieldErrors ?? e?.details?.fieldErrors;
  return fields && typeof fields === 'object' ? Object.fromEntries(Object.keys(fields).map(field => [field, reasonText('EXECUTIVE_QUERY_INVALID')])) : {};
}
export function reportFailure(error: unknown, monthRequested = true): { kind: 'denied' | 'notFound' | 'noData' | 'error'; text: string } {
  const code = apiErrorCode(error), status = (error as { status?: number })?.status;
  if (status === 403 || code === 'EXECUTIVE_ACCESS_DENIED') return { kind: 'denied', text: reasonText('EXECUTIVE_ACCESS_DENIED') };
  if (code === 'COMPANY_NOT_FOUND') return { kind: 'notFound', text: reasonText(code) };
  if (monthRequested && status === 503 && code === 'SOURCE_UNAVAILABLE') return { kind: 'noData', text: W.noData };
  // Unknown diagnostics never reach a report screen, including a plain Error without metadata.
  return { kind: 'error', text: code ? reasonText(code) : W.readFailed };
}
export function keepLoadedReport(error: unknown, historyOnly: boolean): boolean {
  return reportFailure(error, !historyOnly).kind === 'error' && (historyOnly || (error as { status?: number })?.status === undefined);
}
export async function readCurrentBuild<T extends { build: { id: string }; buildChanged: boolean }>(load: (buildId?: string) => Promise<T>, buildId?: string, refreshContext?: () => Promise<void>): Promise<{ data: T; changed: boolean }> {
  const first = await load(buildId);
  const data = first.buildChanged ? await load(first.build.id) : first;
  if (first.buildChanged) await refreshContext?.();
  return { data, changed: first.buildChanged };
}
export function contactFields(contact: ExecutiveOwnerContact): Array<['email' | 'phoneNumber', string]> {
  if (contact.status === 'NOT_PERMITTED') return [];
  const missing = contact.status === 'OK' ? W.contactMissing : contact.status === 'MULTIPLE_OWNERS' ? W.multipleOwners : contact.status === 'NO_CURRENT_OWNER' ? W.noOwner : reasonText('SOURCE_UNAVAILABLE');
  return [['email', contact.status === 'OK' ? contact.email || missing : missing], ['phoneNumber', contact.status === 'OK' ? contact.phoneNumber || missing : missing]];
}
export const rankingTieText = (tie: { count: number; value: number } | undefined, metric: ExecutiveRankingMetric) => tie && tie.count > 0 ? W.rankingTie(tie.count, tie.value.toLocaleString('th-TH'), RANK_LABELS[metric].unit) : null;
export const spendTieText = (tie: { count: number; netSatang: number } | undefined) => tie && tie.count > 0 ? W.spendTie(tie.count, money(tie.netSatang)) : null;
export function sortLabel(sortBy: string, sortDir: string): string {
  const option = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === sortBy) ?? EXECUTIVE_SORT_OPTIONS[0];
  return sortDir === option.sortDir ? option.label : option.label.replace('มาก → น้อย', 'น้อย → มาก').replace('ก → ฮ', 'ฮ → ก').replace('ล่าสุดก่อน', 'เก่าสุดก่อน');
}
export function retryDelaySeconds(error: unknown): number {
  const e = error as { status?: number; retryAfterSeconds?: unknown; details?: { retryAfterSeconds?: unknown } };
  const seconds = e?.details?.retryAfterSeconds ?? e?.retryAfterSeconds;
  return e?.status === 429 && typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
}
/**
 * Our own keys of a history entry. Next's patched pushState/replaceState treat a state that carries its `__NA`/`_N` as its own
 * call and leave the router (useSearchParams) on the old URL; without them Next follows the new URL and adds its keys back.
 */
export function ownHistoryState(state: Record<string, unknown> | null): Record<string, unknown> {
  const { __NA: _na, _N: _n, __PRIVATE_NEXTJS_INTERNALS_TREE: _tree, ...own } = state ?? {};
  return own;
}
export function reportHistoryState(previous: Record<string, unknown> | null, search: string, replace: boolean): Record<string, unknown> {
  const own = ownHistoryState(previous);
  const distance = typeof own.executiveBackDistance === 'number' && Number.isSafeInteger(own.executiveBackDistance) ? own.executiveBackDistance : 1;
  return { ...own, executiveSearch: search, ...(own.executiveBack ? { executiveBackDistance: distance + (replace ? 0 : 1) } : {}) };
}
export function backSection(path: string): ReportSection {
  const route = path.split('?')[0];
  if (route.startsWith('/system/executive/companies/')) return 'detail';
  return (['usage', 'revenue', 'customers', 'compare', 'companies'] as const).find(section => route === reportPath(section)) ?? 'overview';
}
