import {
  EXECUTIVE_REPORT_LABELS, EXECUTIVE_SHEET_WORDS as S, EXECUTIVE_FLAG_LABELS, EXECUTIVE_SORT_OPTIONS, EXECUTIVE_PERIOD_WORDS as P, executivePeriodLabel, executivePeriodFilterLabel, executivePeriodSortLabel, executiveMoneyQualifier, type ExecutiveContext, type ExecutiveCount, type ExecutiveMoney,
  type ExecutiveRatio, type ExecutiveSourceCoverage, type ExecutiveOwnerContact, type ExecutiveDrilldownFilters, type ExecutiveRankingMetric,
} from '@watchdog-bms/contracts';
import { deserializeListQuery } from '../../common/functions/list-query';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth } from '../../common/i18n/thai-date';
import { apiErrorCode, executiveReasonMessage } from '../../common/api/api-error-message';
import { W, RANK_LABELS, REPORT_VIEWS, thaiLabel } from './executive-reports.words';

export type ReportSection = 'overview' | 'companies' | 'usage' | 'revenue' | 'customers' | 'detail';
export const EXECUTIVE_ACCESS_DENIED_EVENT = 'watchdog:executive-access-denied';
export const FILTER_URL = { industry: 'filter_industry', discovery: 'filter_discovery', referringSales: 'filter_sales', companyStatus: 'filter_companyStatus', planState: 'filter_planState', usageGroup: 'filter_usage', paidEver: 'filter_paidEver', receiptAdoption: 'filter_receipt', spendCohort: 'filter_spend', signupRail: 'filter_signupRail', receiptBucket: 'filter_receiptBucket', packageLabel: 'filter_packageLabel', churned: 'filter_churned', neverUsed: 'filter_neverUsed', receiptAdded7: 'filter_receiptAdded7', receiptAdded30: 'filter_receiptAdded30', receiptDays30AtLeast2: 'filter_receiptDays30AtLeast2' } as const;
export const INFOGRAPHIC_FILTERS = [
  { key: 'neverUsed', value: 'true', label: S.neverUsed }, { key: 'receiptAdded7', value: 'true', label: S.receipts7 }, { key: 'receiptAdded30', value: 'true', label: S.receipts30 }, { key: 'churned', value: 'true', label: S.churn },
  ...(['ZERO', 'ONE_TO_FIVE', 'SIX_PLUS'] as const).map(value => ({ key: 'receiptBucket', value, label: S.receiptBucket[value] })),
] as const;
export const GLOBAL_FILTERS = ['industry', 'discovery', 'referringSales'] as const;
export const DIRECTORY_FILTERS = ['companyStatus', 'planState', 'usageGroup', 'paidEver', 'receiptAdoption', 'spendCohort', 'signupRail', 'receiptBucket', 'packageLabel', 'churned', 'neverUsed', 'receiptAdded7', 'receiptAdded30', 'receiptDays30AtLeast2'] as const;
export const reportPath = (section: string) => section === 'overview' ? '/system/executive' : `/system/executive/${section}`;
export const pageNumber = (raw: string | null) => raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : 1;
export function reportContextParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of ['from', 'to', 'periodPreset', 'month', ...GLOBAL_FILTERS.map(key => FILTER_URL[key])]) if (params.has(key)) next.set(key, params.get(key)!);
  return next;
}
export function executiveHref(path: string, params: URLSearchParams | Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}
export function menuHref(section: string, params: URLSearchParams, extra: Record<string, string> = {}): string {
  const query = reportContextParams(params);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return executiveHref(reportPath(section), query);
}
const origins = ['overview', 'usage', 'revenue', 'customers', 'compare', 'companies'];
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
export function validPeriod(from: string, to: string, context: ExecutiveContext, builtOnly = false): boolean {
  return monthPattern.test(from) && monthPattern.test(to) && from <= to && to <= context.currentMonth
    && (!context.months || from >= context.months.first)
    && (!builtOnly || context.builtMonths.includes(from) && context.builtMonths.includes(to));
}
/** Migrate the old navigation `from` before interpreting the period; invalid URLs stay visible. */
export function periodParams(params: URLSearchParams, context: ExecutiveContext): URLSearchParams {
  const next = new URLSearchParams(params);
  if (origins.includes(next.get('from') ?? '') && next.has('month') && !next.has('to')) {
    next.set('origin', next.get('from')!); next.delete('from');
  }
  if (!next.has('from') && !next.has('to')) {
    const legacy = next.get('month');
    const range = context.defaultPeriod ?? { from: context.defaultMonth, to: context.defaultMonth, appliedPreset: null };
    next.set('from', legacy ?? range.from); next.set('to', legacy ?? range.to);
    if (!legacy && range.appliedPreset) next.set('periodPreset', range.appliedPreset);
  }
  next.delete('month');
  const preset = context.presets?.find(p => p.available && p.key === next.get('periodPreset') && p.from === next.get('from') && p.to === next.get('to'));
  if (context.presets && !preset) next.delete('periodPreset');
  return next;
}
export function selectedPeriod(params: URLSearchParams, context: ExecutiveContext) {
  const next = periodParams(params, context), from = next.get('from') ?? '', to = next.get('to') ?? '';
  return validPeriod(from, to, context) ? { from, to, appliedPreset: next.get('periodPreset') } : null;
}
export function periodText(period: { from?: string; to?: string; month?: string }): string {
  return executivePeriodLabel(period.from ?? period.month!, period.to ?? period.month!);
}
export function filterOptions(key: keyof typeof FILTER_URL, context: ExecutiveContext) {
  return key in EXECUTIVE_FLAG_LABELS ? [{ value: 'ALL', label: EXECUTIVE_REPORT_LABELS.companyStatus.ALL! }, { value: 'true', label: EXECUTIVE_FLAG_LABELS[key as keyof typeof EXECUTIVE_FLAG_LABELS].true! }] : context.filters[key as keyof typeof context.filters] ?? [];
}
export function filterLabel(key: keyof typeof FILTER_URL): string {
  return key === 'receiptBucket' ? S.receiptDistribution : key === 'packageLabel' ? S.package : key in EXECUTIVE_FLAG_LABELS ? EXECUTIVE_FLAG_LABELS[key as keyof typeof EXECUTIVE_FLAG_LABELS].true! : W.filterLabels[key as keyof typeof W.filterLabels];
}
export function filterValue(key: keyof typeof FILTER_URL, params: URLSearchParams, context: ExecutiveContext): string {
  const value = params.get(FILTER_URL[key]);
  return filterOptions(key, context).some(option => option.value === value) ? value! : 'ALL';
}
export function reportView(section: 'usage' | 'revenue' | 'customers', params: URLSearchParams): string {
  return REPORT_VIEWS[section].find(view => view.value === params.get('view'))?.value ?? REPORT_VIEWS[section][0].value;
}
export function drillFilters(params: URLSearchParams): ExecutiveDrilldownFilters | null {
  if (!params.has('pick')) return null;
  const picked = new URLSearchParams(params.get('pick') ?? '');
  const allowed = [...Object.keys(FILTER_URL), 'usageAssessed', 'activeInPeriod', 'paidInPeriod', 'positiveNetInPeriod', 'fullyRefunded', 'atDataDate', 'sortBy', 'sortDir'];
  if ([...picked.keys()].some(key => !allowed.includes(key))) return null;
  const result = Object.fromEntries(picked) as ExecutiveDrilldownFilters;
  for (const [key, value] of Object.entries(result)) {
    if (key in EXECUTIVE_REPORT_LABELS && key !== 'referringSales' && key !== 'packageLabel' && !Object.hasOwn(EXECUTIVE_REPORT_LABELS[key as keyof typeof EXECUTIVE_REPORT_LABELS], value)) return null;
    if (key === 'packageLabel' && (!value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value))) return null;
    if (key === 'referringSales' && !/^[A-Za-z0-9_-]{1,40}$/.test(value)) return null;
    if (key === 'sortBy' && !EXECUTIVE_SORT_OPTIONS.some(option => option.sortBy === value)) return null;
    if (key === 'sortDir' && !['asc', 'desc'].includes(value)) return null;
    if (['activeInPeriod', 'paidInPeriod', 'positiveNetInPeriod', 'fullyRefunded', 'churned', 'neverUsed', 'receiptAdded7', 'receiptAdded30', 'receiptDays30AtLeast2', 'atDataDate'].includes(key) && value !== 'true') return null;
    if (key === 'usageAssessed' && !['true', 'false'].includes(value)) return null;
  }
  return result;
}
export function reportQuery(section: ReportSection, params: URLSearchParams, context: ExecutiveContext, search = ''): Record<string, string | number> {
  const period = selectedPeriod(params, context);
  if (!period) return {};
  const { from, to } = period;
  if (section === 'detail') return { from, to };
  const global = Object.fromEntries(GLOBAL_FILTERS.map(key => [key, filterValue(key, params, context)]));
  if (section === 'overview') return { from, to, ...global };
  if (section !== 'companies') {
    const selectedView = reportView(section, params);
    const view = section === 'revenue' && selectedView !== 'top' ? 'summary' : section === 'usage' && selectedView !== 'ranking' ? 'adoption' : selectedView;
    const rank = params.get('rank') as ExecutiveRankingMetric;
    return { from, to, ...global, section, view, ...(section === 'usage' && view === 'ranking' ? { metric: Object.hasOwn(RANK_LABELS, rank) ? rank : 'expenseReceiptCount' } : {}) };
  }
  const picked = drillFilters(params);
  const directory = Object.fromEntries(DIRECTORY_FILTERS.flatMap(key => { const value = filterValue(key, params, context); return value === 'ALL' ? [] : [[key, value]]; }));
  const list = deserializeListQuery(params);
  const order = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === list.sortBy) ?? EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === picked?.sortBy) ?? EXECUTIVE_SORT_OPTIONS[0];
  return { from, to, ...(picked ?? global), ...directory, ...(Object.entries({ ...picked, ...directory }).some(([key, value]) => ['neverUsed', 'receiptAdded7', 'receiptAdded30', 'receiptDays30AtLeast2', 'receiptBucket', 'packageLabel'].includes(key) && value !== 'ALL') ? { atDataDate: 'true' } : {}), sortBy: order.sortBy, sortDir: list.sortDir ?? picked?.sortDir ?? order.sortDir, page: pageNumber(params.get('page')), pageSize: 10, ...(search.trim() ? { q: search.trim().slice(0, 120) } : {}) };
}
export function drilldownHref(params: URLSearchParams, from: string, filters: ExecutiveDrilldownFilters): string {
  const next = reportContextParams(params);
  if (filters.from && filters.to) { next.delete('month'); next.delete('periodPreset'); next.set('from', filters.from); next.set('to', filters.to); }
  const { from: _from, to: _to, ...picked } = filters;
  next.set('pick', new URLSearchParams(picked as Record<string, string>).toString());
  next.set('origin', from);
  return executiveHref(reportPath('companies'), next);
}
export function drillLabels(filters: ExecutiveDrilldownFilters, context: ExecutiveContext): string[] {
  return Object.entries(filters).flatMap(([key, value]) => {
    if (value === 'ALL' || ['sortBy', 'sortDir', 'from', 'to', 'atDataDate'].includes(key)) return [];
    const label = key === 'packageLabel' ? value : (key === 'referringSales' ? undefined : executivePeriodFilterLabel(key, value))
      ?? context.filters.referringSales.find(option => option.value === value)?.label ?? W.unknown;
    return [thaiLabel(label, key === 'packageLabel' ? undefined : value)];
  });
}
export function changedParams(params: URLSearchParams, changes: Record<string, string>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
  const picked = drillFilters(params);
  if (picked && !Object.hasOwn(changes, 'pick')) {
    for (const key of [...GLOBAL_FILTERS, ...DIRECTORY_FILTERS]) if (Object.hasOwn(changes, FILTER_URL[key])) {
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
  const next = reportContextParams(params);
  for (const key of GLOBAL_FILTERS) next.set(FILTER_URL[key], 'ALL');
  return next;
}
export const money = (satang: number) => `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${W.unitBaht}`;
export const countText = (figure: ExecutiveCount) => figure.value !== null ? figure.value.toLocaleString('th-TH') : figure.knownValue !== undefined ? `${W.atLeast} ${figure.knownValue.toLocaleString('th-TH')}` : '—';
export const moneyText = (figure: ExecutiveMoney, measured = false) => figure.value !== null ? money(figure.value) : figure.knownValue !== undefined ? `${money(figure.knownValue)} (${executiveMoneyQualifier(figure, measured)})` : '—';
export const ratioText = (figure: ExecutiveRatio | null | undefined, unit = '%') => figure?.value === null || figure?.value === undefined ? '–' : `${figure.value.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`;
export const reportMonth = formatThaiMonth, reportDate = formatThaiDate, reportDateTime = formatThaiDateTime;
export function sourceCount(value: number | null, source: ExecutiveSourceCoverage): ExecutiveCount {
  return { value: source.coverage === 'complete' ? value : null, ...(source.coverage === 'partial' && value !== null ? { knownValue: value } : {}), ...source };
}
export const sourceMoney = (value: number | null, source: ExecutiveSourceCoverage): ExecutiveMoney => ({ ...sourceCount(value, source), currency: 'THB' });
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
  if (code === 'EXECUTIVE_REPORT_UNAVAILABLE') {
    const months = (error as { details?: { unbuiltMonths?: string[] } }).details?.unbuiltMonths ?? [];
    return { kind: 'noData', text: months.length ? P.unbuilt(months.map(reportShortMonth).join(', ')) : P.noneBuilt };
  }
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
  const label = executivePeriodSortLabel(option);
  return sortDir === option.sortDir ? label : label.replace('มาก → น้อย', 'น้อย → มาก').replace('ก → ฮ', 'ฮ → ก').replace('ล่าสุดก่อน', 'เก่าสุดก่อน');
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
  return (['usage', 'revenue', 'customers', 'companies'] as const).find(section => route === reportPath(section)) ?? 'overview';
}

/** All rendered values must share an incomplete source before a column can carry its mark. */
export function hoistedSource(values: Array<{ coverage: string; source: string; empty?: boolean }>): string | null {
  const nonEmpty = values.filter(value => !value.empty);
  return nonEmpty.length && nonEmpty.every(value => value.coverage !== 'complete' && value.source === nonEmpty[0].source) ? nonEmpty[0].source : null;
}
export const reportShortDate = (date: string | null | undefined) => reportDate(date, '–').replace(/25(\d{2})$/, '$1');
export const reportShortMonth = (month: string) => reportMonth(month).replace(/25(\d{2})$/, '$1');
/** A date with its time and a two-digit year, as the tables print dates: for the narrow lines of a phone. */
export const reportShortDateTime = (at: string | null | undefined) => reportDateTime(at).replace(/\b25(\d{2})\b/, '$1');
export const figureNumber = (value: ExecutiveCount, moneyValue = false) => {
  const number = value.value ?? value.knownValue;
  return number === undefined ? '–' : (moneyValue ? number / 100 : number).toLocaleString('th-TH', moneyValue ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined);
};
