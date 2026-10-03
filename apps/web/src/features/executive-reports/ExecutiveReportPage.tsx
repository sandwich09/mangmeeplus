'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  EXECUTIVE_SORT_OPTIONS,
  type ExecutiveContext, type ExecutiveCompanyHistory, type ExecutiveCompanyDetail, type ExecutiveCompanies, type ExecutiveOverview, type ExecutiveAnalysis,
} from '@watchdog-bms/contracts';
import { MangmeePage, MangmeeBadge } from '@/common/components/mangmee';
import { Button } from '@/common/components/button';
import { SelectField, TextField, FieldError } from '@/common/components/field/Field';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { Pagination } from '@/common/components/data-table/Pagination';
import { LoadingState, EmptyState, ErrorState, ForbiddenState, CoverLoader } from '@/common/components/state';
import { WorkspaceLocaleContext } from '@/common/i18n/locale-context';
import { getExecutiveContext, getExecutiveReport, getExecutiveHistory, type ReportData } from './executive-reports.api';
import {
  FILTER_URL, GLOBAL_FILTERS, DIRECTORY_FILTERS, reportQuery, reportView, filterValue, normalizedMonth, changedParams, clearedParams, comparisonProblem,
  swappedParams, reportFailure, keepLoadedReport, queryFieldErrors, readCurrentBuild, drillFilters, drillLabels, menuHref, reportDateTime, reportDate, pageNumber, reasonText,
  EXECUTIVE_ACCESS_DENIED_EVENT, sortLabel, retryDelaySeconds, reportHistoryState, ownHistoryState, backSection, type ReportSection,
} from './executive-reports.logic';
import { W, REPORT_VIEWS, DETAIL_TABS, RANK_LABELS, thaiLabel } from './executive-reports.words';
import { OverviewContent, CompaniesContent, AnalysisContent, CompanyContent, ReportLink, Reasons } from './ExecutiveReportContent';

type Failure = ReturnType<typeof reportFailure>;
type ReportContext = { context: ExecutiveContext | null; failure: Failure | null; retry?: () => void; retryWait: number; build: MutableRefObject<string | undefined>; admin: boolean; deny: () => void };
const Context = createContext<ReportContext | null>(null);
let navigationOrigin: string | null = null;
function rememberNavigation() { navigationOrigin = window.location.pathname + window.location.search; }
function useRetryWait() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

export function ExecutiveReportProvider({ children, admin }: { children: ReactNode; admin: boolean }) {
  const [context, setContext] = useState<ExecutiveContext | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retryWait, setRetryWait] = useRetryWait();
  const build = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    setFailure(null); setContext(null); setRetryWait(0);
    getExecutiveContext(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!result.capabilities.readReport.allowed) { setFailure({ kind: 'denied', text: reasonText('EXECUTIVE_ACCESS_DENIED') }); window.dispatchEvent(new Event(EXECUTIVE_ACCESS_DENIED_EVENT)); return; }
      setContext(result); build.current = result.build?.id;
    }).catch(error => { if (!controller.signal.aborted) { const failed = reportFailure(error, false); setFailure(failed); setRetryWait(retryDelaySeconds(error)); if (failed.kind === 'denied') window.dispatchEvent(new Event(EXECUTIVE_ACCESS_DENIED_EVENT)); } });
    return () => controller.abort();
  }, [attempt]);
  return <WorkspaceLocaleContext.Provider value="th"><Context.Provider value={{ context, failure, retry: retryWait > 0 ? undefined : () => setAttempt(n => n + 1), retryWait, build, admin, deny: () => { setContext(null); setFailure({ kind: 'denied', text: reasonText('EXECUTIVE_ACCESS_DENIED') }); window.dispatchEvent(new Event(EXECUTIVE_ACCESS_DENIED_EVENT)); } }}>{children}</Context.Provider></WorkspaceLocaleContext.Provider>;
}

export default function ExecutiveReportPage({ section, targetCompanyId }: { section: ReportSection; targetCompanyId?: string }) {
  const shared = useContext(Context)!;
  const { context } = shared;
  const pathname = usePathname(), router = useRouter(), searchParams = useSearchParams();
  const paramsString = searchParams.toString();
  const params = new URLSearchParams(paramsString);
  const [data, setData] = useState<ReportData | null>(null);
  const [history, setHistory] = useState<ExecutiveCompanyHistory | null>(null);
  const [dataKey, setDataKey] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [updated, setUpdated] = useState(false);
  const [term, setTerm] = useState(''), [search, setSearch] = useState('');
  const [contactReadAt, setContactReadAt] = useState('');
  const [retryWait, setRetryWait] = useRetryWait();
  const [backTitle, setBackTitle] = useState<string | null>(null);
  const requestKey = `${section}:${targetCompanyId ?? ''}:${paramsString}:${search}`;
  const tab = DETAIL_TABS.find(tab => tab.value === params.get('tab'))?.value ?? 'company';
  const problem = context && section === 'compare' ? comparisonProblem(params, context) : null;

  function navigateParams(next: URLSearchParams, replace = false, searchValue = term) {
    const href = `${pathname}?${next}`;
    const state = reportHistoryState(window.history.state, searchValue, replace);
    if (replace) window.history.replaceState(state, '', href);
    else window.history.pushState(state, '', href);
  }
  function update(changes: Record<string, string>) { navigateParams(changedParams(params, changes)); }
  function clear() { setTerm(''); setSearch(''); navigateParams(clearedParams(params), false, ''); }
  function back(fallback: string) {
    if (window.history.state?.executiveBack?.startsWith('/system/executive')) {
      const distance = window.history.state.executiveBackDistance;
      if (Number.isSafeInteger(distance) && distance > 1) window.history.go(-distance);
      else window.history.back();
    }
    else router.push(fallback);
  }
  useEffect(() => {
    if (navigationOrigin && navigationOrigin !== window.location.pathname + window.location.search) {
      window.history.replaceState({ ...window.history.state, executiveBack: navigationOrigin, executiveBackDistance: 1 }, '', window.location.href);
      navigationOrigin = null;
    }
    const origin = window.history.state?.executiveBack;
    setBackTitle(typeof origin === 'string' ? W[backSection(origin)] : null);
    function restoreSearch() {
      const restored = typeof window.history.state?.executiveSearch === 'string' ? window.history.state.executiveSearch : '';
      setTerm(restored); setSearch(restored.trim().slice(0, 120));
    }
    restoreSearch();
    window.addEventListener('popstate', restoreSearch);
    return () => window.removeEventListener('popstate', restoreSearch);
  }, [pathname]);
  useEffect(() => {
    if (section !== 'companies') return;
    const timer = setTimeout(() => {
      const next = term.trim().slice(0, 120);
      if (next !== search) {
        const current = new URLSearchParams(window.location.search);
        current.set('page', '1');
        window.history.replaceState({ ...ownHistoryState(window.history.state), executiveSearch: term }, '', `${pathname}?${current}`);
        setSearch(next);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [term, search, pathname, section]);
  useEffect(() => {
    if (!context) return;
    const next = new URLSearchParams(paramsString);
    next.set('month', normalizedMonth(next, context));
    for (const key of GLOBAL_FILTERS) next.set(FILTER_URL[key], filterValue(key, next, context));
    next.delete('q'); next.delete('search'); next.delete('buildId'); next.delete('export');
    // URL only (Next's own state keeps the router where it is): every read normalises the same way, so a router update would read twice.
    if (next.toString() !== paramsString) window.history.replaceState(window.history.state, '', `${pathname}?${next}`);
  }, [context, paramsString, pathname]);

  useEffect(() => {
    if (!context || problem) { setData(null); setHistory(null); setLoading(false); return; }
    const controller = new AbortController();
    const query = reportQuery(section, new URLSearchParams(paramsString), context, search);
    let readingHistory = false;
    setLoading(true); setFailure(null); setFieldErrors({}); setUpdated(false); setRetryWait(0);
    // One response owns every card/table; nothing from an older request may overwrite it.
    readCurrentBuild(buildId => getExecutiveReport(section, { ...query, ...(buildId ? { buildId } : {}) }, controller.signal, targetCompanyId), shared.build.current)
      .then(async result => {
        if (controller.signal.aborted) return;
        shared.build.current = result.data.build.id;
        setData(result.data); setHistory(null); setDataKey(requestKey); setUpdated(result.changed); setContactReadAt(new Date().toISOString());
        readingHistory = section === 'detail' && tab === 'history';
        const companyHistory = readingHistory ? await getExecutiveHistory(targetCompanyId!, pageNumber(new URLSearchParams(paramsString).get('page')), controller.signal) : null;
        if (controller.signal.aborted) return;
        setHistory(companyHistory);
        const pagination = companyHistory?.pagination ?? ('pagination' in result.data ? result.data.pagination : null);
        if (pagination && pageNumber(new URLSearchParams(paramsString).get('page')) !== pagination.page) {
          const next = new URLSearchParams(window.location.search); next.set('page', String(pagination.page));
          window.history.replaceState(window.history.state, '', `${pathname}?${next}`); // URL only, as above
        }
      }).catch(error => {
        if (controller.signal.aborted) return;
        const failed = reportFailure(error, !readingHistory);
        setFailure(failed); setFieldErrors(queryFieldErrors(error)); setRetryWait(retryDelaySeconds(error));
        if (!keepLoadedReport(error, readingHistory)) { setData(null); setHistory(null); }
        if (failed.kind === 'denied') shared.deny();
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // shared actions are intentionally excluded: provider renders are not new report requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, section, targetCompanyId, paramsString, search, attempt, problem, tab]);

  const visibleData = dataKey === requestKey ? data : null;
  const retry = retryWait > 0 ? undefined : () => setAttempt(n => n + 1);
  const failed = shared.failure ?? failure;
  const title = section === 'detail' && visibleData && 'company' in visibleData ? visibleData.company.displayName : W[section];
  const nav = { params, from: section, remember: rememberNavigation };
  const from = params.get('from');
  const origin = ['overview', 'usage', 'revenue', 'customers', 'compare'].includes(from ?? '') ? from as Exclude<ReportSection, 'detail' | 'companies'> : 'overview';
  const fallback = section === 'detail' ? menuHref('companies', params) : menuHref(origin, params);
  const selected = [params.get('a'), params.get('b')].filter((value): value is string => !!value);
  function selectCompany(id: string) {
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id].slice(0, 2);
    update({ a: next[0] ?? '', b: next[1] ?? '' });
  }
  const filterCount = context ? GLOBAL_FILTERS.filter(key => filterValue(key, params, context) !== 'ALL').length : 0;
  function filterControl(key: keyof typeof FILTER_URL) {
    return context && <SelectField key={key} id={`executive-${key}`} label={W.filterLabels[key]} value={filterValue(key, params, context)} error={fieldErrors[key]} searchable={key === 'referringSales'} className="!min-h-11 !text-base" onChange={event => update({ [FILTER_URL[key]]: event.target.value })}>
      {context.filters[key].map(option => <option key={option.value} value={option.value}>{thaiLabel(option.label, option.value)}</option>)}
    </SelectField>;
  }
  const activeLabels = visibleData ? [...Object.values(visibleData.appliedFilters.global), ...Object.values(visibleData.appliedFilters.directory)].filter(option => option.value !== 'ALL') : [];
  const picked = drillFilters(params);
  const pickLabels = picked && context ? drillLabels(picked, context) : [];
  const pagination = section === 'companies' && visibleData && 'pagination' in visibleData ? visibleData.pagination : tab === 'history' && section === 'detail' ? history?.pagination : null;
  return <main className="executive-report mx-auto min-w-0 max-w-7xl p-4 text-base [overflow-wrap:anywhere] sm:p-6 [&_button]:min-h-11 [&_button]:min-w-11 [&_.mangmee-stat-value]:!text-lg [&_.mangmee-stat-card]:!p-3 [&_.mangmee-stat-sub]:!text-sm">
    <MangmeePage eyebrow={W.report} title={title} actions={section === 'overview' ? <ReportLink href={menuHref('companies', params)} remember={rememberNavigation}>{W.allCompanies}</ReportLink> : ((section === 'companies' && from) || section === 'detail') ? <Button variant="secondary" onClick={() => back(fallback)}>{W.back(backTitle ?? (section === 'detail' ? W.companies : W[origin]))}</Button> : undefined}>
      <div className="space-y-4">
        {context && <>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="w-44"><label htmlFor="executive-month" className="text-sm">{W.month}</label><ThemedDate id="executive-month" aria-label={W.month} aria-invalid={!!fieldErrors.month} aria-describedby={fieldErrors.month ? 'executive-month-error' : undefined} mode="month" allowClear={false} value={normalizedMonth(params, context)} min={context.months?.first} max={context.months?.last ?? context.currentMonth} selectable={context.builtMonths} onChange={event => event.target.value && update({ month: event.target.value })} className="!min-h-11 !text-base" />{fieldErrors.month && <FieldError id="executive-month-error">{fieldErrors.month}</FieldError>}</div>
            {visibleData && <><span className="text-sm">{W.through(reportDateTime(visibleData.dataThrough.oldest))}</span>{visibleData.period.isPartialMonth && <><MangmeeBadge tone="amber">{W.partialMonth}</MangmeeBadge>{context.months && visibleData.period.month > context.months.first && <Button variant="ghost" onClick={() => { const date = new Date(`${visibleData.period.month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); update({ month: date.toISOString().slice(0, 7) }); }}>{W.previousMonth}</Button>}</>}{visibleData.build.monthRevisedAt && <MangmeeBadge>{W.revised(reportDateTime(visibleData.build.monthRevisedAt))}</MangmeeBadge>}</>}
          </div>
          {section === 'compare' || section === 'detail' ? <p className="text-sm">{section === 'compare' ? W.compareBase : W.detailBase}</p> : <details><summary className="flex min-h-11 cursor-pointer items-center font-semibold">{W.filters} · {filterCount}</summary><div className="grid min-w-0 gap-3 py-3 sm:grid-cols-3">{GLOBAL_FILTERS.map(filterControl)}</div></details>}
          {section === 'companies' && <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2"><TextField id="executive-search" label={W.search} type="search" maxLength={120} value={term} hint={W.searchHint} error={fieldErrors.q} className="!min-h-11 !text-base" onChange={event => { setTerm(event.target.value); window.history.replaceState({ ...window.history.state, executiveSearch: event.target.value }, '', window.location.href); }} />
              <SelectField id="executive-sort" label={W.sort} value={String(reportQuery('companies', params, context).sortBy)} error={fieldErrors.sortBy ?? fieldErrors.sortDir} className="!min-h-11 !text-base" onChange={event => { const sort = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === event.target.value)!; update({ sortBy: sort.sortBy, sortDir: sort.sortDir }); }}>{context.sortOptions.map(option => <option key={option.sortBy} value={option.sortBy}>{sortLabel(option.sortBy, option.sortBy === reportQuery('companies', params, context).sortBy ? String(reportQuery('companies', params, context).sortDir) : option.sortDir)}</option>)}</SelectField>
            </div>
            <details><summary className="flex min-h-11 cursor-pointer items-center font-semibold">{W.filters} · {DIRECTORY_FILTERS.filter(key => filterValue(key, params, context) !== 'ALL').length}</summary><div className="grid min-w-0 gap-3 py-3 sm:grid-cols-3">{DIRECTORY_FILTERS.map(filterControl)}</div></details>
            {from === 'compare' && <p>{W.compareList}</p>}
            {params.has('pick') && picked && <div className="flex flex-wrap items-center gap-2"><span>{W.pick}</span>{pickLabels?.map((label, i) => <MangmeeBadge key={i}>{thaiLabel(label)}</MangmeeBadge>)}<Button variant="ghost" onClick={() => update({ pick: '' })}>{W.removePick}</Button></div>}
            {selected.length === 2 && <ReportLink href={`${menuHref('compare', params)}&by=company&a=${encodeURIComponent(selected[0])}&b=${encodeURIComponent(selected[1])}`} remember={rememberNavigation}>{W.compareTwo}</ReportLink>}
          </>}
          {section !== 'compare' && section !== 'detail' && (filterCount > 0 || DIRECTORY_FILTERS.some(key => params.get(FILTER_URL[key]) && params.get(FILTER_URL[key]) !== 'ALL') || term || params.has('pick')) && <Button variant="secondary" onClick={clear}>{W.clear}</Button>}
          <div className="flex flex-wrap gap-2">{activeLabels.map((option, i) => <MangmeeBadge key={i}>{thaiLabel(option.label, option.value)}</MangmeeBadge>)}</div>
          {(section === 'usage' || section === 'revenue' || section === 'customers') && <>
            <nav className="flex flex-wrap gap-2" aria-label={W[section]}>{REPORT_VIEWS[section].map(view => <Button key={view.value} variant={reportView(section, params) === view.value ? 'primary' : 'secondary'} aria-pressed={reportView(section, params) === view.value} onClick={() => update({ view: view.value })}>{view.label}</Button>)}</nav>
            {section === 'usage' && reportView(section, params) === 'ranking' && <SelectField label={W.ranking} value={Object.hasOwn(RANK_LABELS, params.get('rank') ?? '') ? params.get('rank')! : 'expenseReceiptCount'} error={fieldErrors.metric} className="!min-h-11 !text-base" onChange={event => update({ rank: event.target.value })}>{Object.entries(RANK_LABELS).map(([value, words]) => <option key={value} value={value}>{words.label}</option>)}</SelectField>}
            {section === 'customers' && reportView(section, params) === 'sales' && <SelectField label={W.sales} value={params.get('seller') === 'credited' ? 'credited' : 'referring'} className="!min-h-11 !text-base" onChange={event => update({ seller: event.target.value })}><option value="referring">{W.referring}</option><option value="credited">{W.credited}</option></SelectField>}
          </>}
          {section === 'detail' && <nav className="flex flex-wrap gap-2" aria-label={W.detail}>{DETAIL_TABS.map(item => <Button key={item.value} variant={tab === item.value ? 'primary' : 'secondary'} aria-pressed={tab === item.value} onClick={() => update({ tab: item.value })}>{item.label}</Button>)}</nav>}
          {section === 'compare' && <>
            <SelectField label={W.dimension} value={['industry', 'discovery', 'referringSales', 'company'].includes(params.get('by') ?? '') ? params.get('by')! : 'industry'} error={fieldErrors.dimension} className="!min-h-11 !text-base" onChange={event => update({ by: event.target.value, a: '', b: '' })}>{[['industry', W.industry], ['discovery', W.discovery], ['referringSales', W.referring], ['company', W.company]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
            {params.get('by') === 'company' ? <ReportLink href={menuHref('companies', params)} remember={rememberNavigation}>{W.chooseCompanies}</ReportLink> : <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(['a', 'b'] as const).map(side => <SelectField key={side} label={side === 'a' ? W.sideA : W.sideB} value={params.get(side) ?? ''} error={fieldErrors[side === 'a' ? 'sideA' : 'sideB']} searchable className="!min-h-11 !text-base" onChange={event => update({ [side]: event.target.value })}><option value="">{W.choose}</option>{context.filters[(params.get('by') === 'discovery' || params.get('by') === 'referringSales' ? params.get('by') : 'industry') as 'industry' | 'discovery' | 'referringSales'].filter(option => option.value !== 'ALL').map(option => <option key={option.value} value={option.value}>{thaiLabel(option.label, option.value)}</option>)}</SelectField>)}</div>}
            {!problem && <Button variant="secondary" onClick={() => navigateParams(swappedParams(params))}>{W.swap}</Button>}
          </>}
        </>}
        {updated && <p role="status">{W.updated}</p>}
        {Math.max(retryWait, shared.retryWait) > 0 && <p role="status">{W.wait(Math.max(retryWait, shared.retryWait))}</p>}
        {visibleData?.reasonCodes.includes('SOURCE_STALE') && <p role="status" className="rounded-lg border border-warning-600 bg-warning-50 p-3">{reasonText('SOURCE_STALE')} {W.staleAt(reportDateTime(visibleData.build.asOf))}</p>}
        {visibleData?.dataThrough.lagging.map(source => <p key={source} className="text-sm">{source === 'billing' ? W.moneyThrough(reportDate(visibleData.dataThrough.billing)) : `${source === 'activity' ? W.usage : source === 'aiCost' ? W.aiCost : W.companyTab} · ${W.through(reportDateTime(visibleData.dataThrough[source]))}`}</p>)}
        {visibleData && <Reasons codes={visibleData.reasonCodes.filter(code => code !== 'SOURCE_STALE')} />}
        {failed?.kind === 'denied' ? <ForbiddenState title={failed.text} description="" helpText="" /> : failed?.kind === 'notFound' ? <EmptyState title={failed.text} description="" action={<Button variant="secondary" onClick={() => back(menuHref('companies', params))}>{W.back(W.companies)}</Button>} /> : failed?.kind === 'noData' ? <EmptyState title={failed.text} description="" action={<Button variant="secondary" onClick={shared.failure ? shared.retry : retry}>{W.retry}</Button>} /> : failed && !visibleData ? <ErrorState title={failed.text} onRetry={shared.failure ? shared.retry : retry} /> : null}
        {failed && visibleData && <ErrorState title={failed.text} description={W.staleAt(reportDateTime(visibleData.build.asOf))} onRetry={retry} />}
        {!context && !shared.failure && <LoadingState label={W.loading} />}
        {context && problem && <EmptyState title={W[problem]} description="" />}
        {context && !problem && !failed && !visibleData && <LoadingState label={W.loading} />}
        <CoverLoader active={loading && !!visibleData} label={W.loading}>
          <div className="min-w-0 space-y-4" aria-busy={loading}>
            {visibleData && section === 'overview' && <OverviewContent data={visibleData as ExecutiveOverview} nav={nav} />}
            {visibleData && section === 'companies' && <CompaniesContent data={visibleData as ExecutiveCompanies} nav={nav} selected={selected} select={selectCompany} />}
            {visibleData && section === 'detail' && <CompanyContent data={visibleData as ExecutiveCompanyDetail} tab={tab} history={history} admin={shared.admin} nav={nav} contactReadAt={contactReadAt} />}
            {visibleData && ['usage', 'revenue', 'customers', 'compare'].includes(section) && <AnalysisContent data={visibleData as ExecutiveAnalysis} nav={nav} seller={params.get('seller')} />}
          </div>
        </CoverLoader>
        {pagination && pagination.totalPages > 0 && <Pagination page={pagination.page} totalPages={pagination.totalPages} disabled={loading} onPageChange={page => update({ page: String(page) })} />}
      </div>
    </MangmeePage>
  </main>;
}
