'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, Fragment, type ReactNode, type MutableRefObject } from 'react';
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
import { EmptyState, ErrorState, ForbiddenState, CoverLoader } from '@/common/components/state';
import { WorkspaceLocaleContext } from '@/common/i18n/locale-context';
import { getExecutiveContext, getExecutiveReport, getExecutiveHistory, type ReportData } from './executive-reports.api';
import {
  FILTER_URL, GLOBAL_FILTERS, DIRECTORY_FILTERS, reportQuery, reportView, filterValue, normalizedMonth, changedParams, clearedParams, comparisonProblem,
  swappedParams, reportFailure, keepLoadedReport, queryFieldErrors, readCurrentBuild, drillFilters, drillLabels, reportFilterChips, menuHref, reportDateTime, pageNumber, reasonText,
  EXECUTIVE_ACCESS_DENIED_EVENT, sortLabel, retryDelaySeconds, reportHistoryState, ownHistoryState, backSection, type ReportSection,
} from './executive-reports.logic';
import { EXECUTIVE_PAGE_CLASS, ExecutiveSectionCard, ExecutiveTabs, ReasonNotes, ReportStatus } from './ExecutiveReportDesign';
import { ExecutiveFilters } from './ExecutiveFilters';
import { ExecutiveExportPanel } from './ExecutiveExportPanel';
import { canExport } from './executive-export.logic';
import { W, REPORT_VIEWS, DETAIL_TABS, RANK_LABELS, thaiLabel } from './executive-reports.words';
import { OverviewContent, CompaniesContent, AnalysisContent, CompanyContent, ReportLink, ReportSkeleton } from './ExecutiveReportContent';

type Failure = ReturnType<typeof reportFailure>;
type ReportContext = { context: ExecutiveContext | null; failure: Failure | null; retry?: () => void; retryWait: number; build: MutableRefObject<string | undefined>; admin: boolean; deny: () => void; refresh: (signal: AbortSignal) => Promise<void> };
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
  async function refresh(signal: AbortSignal) {
    try {
      const result = await getExecutiveContext(signal);
      if (signal.aborted) return;
      if (!result.capabilities.readReport.allowed) throw { code: 'EXECUTIVE_ACCESS_DENIED', status: 403 };
      setFailure(null); setContext(result); build.current = result.build?.id;
    } catch (error) {
      if (!signal.aborted) {
        const failed = reportFailure(error, false);
        setFailure(failed); setRetryWait(retryDelaySeconds(error));
        if (failed.kind === 'denied') { setContext(null); window.dispatchEvent(new Event(EXECUTIVE_ACCESS_DENIED_EVENT)); }
      }
      throw error;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setFailure(null); setContext(null); setRetryWait(0);
    void refresh(controller.signal).catch(() => {}); // refresh owns the provider's failure state
    return () => controller.abort();
  }, [attempt]);
  return <WorkspaceLocaleContext.Provider value="th"><Context.Provider value={{ context, failure, retry: retryWait > 0 ? undefined : () => setAttempt(n => n + 1), retryWait, build, admin, refresh, deny: () => { setContext(null); setFailure({ kind: 'denied', text: reasonText('EXECUTIVE_ACCESS_DENIED') }); window.dispatchEvent(new Event(EXECUTIVE_ACCESS_DENIED_EVENT)); } }}>{children}</Context.Provider></WorkspaceLocaleContext.Provider>;
}

export default function ExecutiveReportPage({ section, targetCompanyId }: { section: ReportSection; targetCompanyId?: string }) {
  const shared = useContext(Context)!;
  const { context } = shared;
  const pathname = usePathname(), router = useRouter(), searchParams = useSearchParams();
  const paramsString = searchParams.toString();
  const params = new URLSearchParams(paramsString);
  const exportOpen = params.get('export') === '1' && canExport(context);
  const [exportNotice, setExportNotice] = useState('');
  const [exportDenied, setExportDenied] = useState(false);
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
  const tabFocus = useRef<string | null>(null);
  const tab = DETAIL_TABS.find(tab => tab.value === (params.get('view') ?? params.get('tab')))?.value ?? 'company';
  const problem = context && section === 'compare' ? comparisonProblem(params, context) : null;
  const queryKey = context ? JSON.stringify(reportQuery(section, params, context, search)) : null;
  const historyPage = section === 'detail' && tab === 'history' ? pageNumber(params.get('page')) : 1;
  const requestKey = `${section}:${targetCompanyId ?? ''}:${queryKey}:${tab}:${historyPage}`;

  function navigateParams(next: URLSearchParams, replace = false, searchValue = term) {
    const href = `${pathname}?${next}`;
    const state = reportHistoryState(window.history.state, searchValue, replace);
    if (replace) window.history.replaceState(state, '', href);
    else window.history.pushState(state, '', href);
  }
  useEffect(() => {
    if (!loading && tabFocus.current) {
      if (document.activeElement === document.body || document.activeElement?.getAttribute('role') === 'tab') document.getElementById(`executive-tab-${tabFocus.current}`)?.focus();
      tabFocus.current = null;
    }
  }, [loading, paramsString]);
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
    next.delete('q'); next.delete('search'); next.delete('buildId'); if (next.get('export') !== '1' || !canExport(context)) next.delete('export');
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
    readCurrentBuild(buildId => getExecutiveReport(section, { ...query, ...(buildId ? { buildId } : {}) }, controller.signal, targetCompanyId), shared.build.current, () => shared.refresh(controller.signal))
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
    // Depend on the normalised query, not context identity: refreshing builtMonths must not read the report a third time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, section, targetCompanyId, attempt, problem, tab, historyPage]);

  const closeExport = useCallback(() => {
    const next = new URLSearchParams(window.location.search); next.delete('export');
    window.history.replaceState(ownHistoryState(window.history.state), '', `${window.location.pathname}?${next}`);
  }, []);
  const reloadExport = useCallback(() => { closeExport(); setExportNotice(W.export.expired); setAttempt(n => n + 1); }, [closeExport]);
  // API13 refuses a lost export or contacts right with the same code as a lost read right: re-read the rights first, so only a
  // reader who lost the report itself gets the report's denial (plain-language spec, E5 denial).
  const denyExport = useCallback(() => { setExportDenied(true); void shared.refresh(new AbortController().signal).catch(() => {}); }, [shared]);
  const visibleData = dataKey === requestKey ? data : null;
  const retry = retryWait > 0 ? undefined : () => setAttempt(n => n + 1);
  const failed = shared.failure ?? failure;
  const title = section === 'detail' && visibleData && 'company' in visibleData ? visibleData.company.displayName : W[section];
  const nav = { params, from: section, remember: rememberNavigation, navigate: (href: string) => router.push(href) };
  const from = params.get('from');
  const origin = ['overview', 'usage', 'revenue', 'customers', 'compare'].includes(from ?? '') ? from as Exclude<ReportSection, 'detail' | 'companies'> : 'overview';
  const fallback = section === 'detail' ? menuHref('companies', params) : menuHref(origin, params);
  const selected = [params.get('a'), params.get('b')].filter((value): value is string => !!value);
  function selectCompany(id: string) {
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id].slice(0, 2);
    update({ a: next[0] ?? '', b: next[1] ?? '' });
  }
  const effectiveQuery = context ? reportQuery(section, params, context, search) : {};
  const filterValues = Object.fromEntries(GLOBAL_FILTERS.map(key => [key, String(effectiveQuery[key] ?? 'ALL')])) as Record<typeof GLOBAL_FILTERS[number], string>;
  const filterCount = GLOBAL_FILTERS.filter(key => filterValues[key] !== 'ALL').length;
  function filterControl(key: keyof typeof FILTER_URL) {
    return context && <SelectField key={key} id={`executive-${key}`} label={W.filterLabels[key]} value={filterValue(key, params, context)} error={fieldErrors[key]} searchable={key === 'referringSales'} className="!min-h-11 !text-base" onChange={event => update({ [FILTER_URL[key]]: event.target.value })}>
      {context.filters[key].map(option => <option key={option.value} value={option.value}>{thaiLabel(option.label, option.value)}</option>)}
    </SelectField>;
  }
  const picked = drillFilters(params);
  const { active: activeLabels } = context ? reportFilterChips(visibleData ? { ...visibleData.appliedFilters, global: {} } : undefined, picked, context) : { active: [] };
  const pickLabels = context && picked ? drillLabels(Object.fromEntries(Object.entries(picked).filter(([key]) => !GLOBAL_FILTERS.some(global => global === key))), context) : [];
  const pagination = section === 'companies' && visibleData && 'pagination' in visibleData ? visibleData.pagination : tab === 'history' && section === 'detail' ? history?.pagination : null;
  const comparison = visibleData && 'comparison' in visibleData ? visibleData.comparison : null;
  return <ReasonNotes.Provider value={!exportOpen}><main className={`executive-report mx-auto max-w-7xl p-4 text-base sm:p-6 ${EXECUTIVE_PAGE_CLASS}`}>
    <MangmeePage eyebrow={W.report} title={title} description={W.descriptions[section]} actions={<div className="flex flex-wrap gap-2">{canExport(context) && !exportOpen && <Button variant={section === 'overview' ? 'secondary' : 'primary'} loading={loading} disabled={loading || !!failed || !!problem || !visibleData} onClick={() => { const next = new URLSearchParams(params); next.set('export', '1'); setExportNotice(''); navigateParams(next); }}>{W.export.action}</Button>}{section === 'overview' && !exportOpen ? <Button onClick={() => { rememberNavigation(); router.push(menuHref('companies', params)); }}>{W.allCompanies}</Button> : ((section === 'companies' && from) || section === 'detail') ? <Button variant="secondary" onClick={() => back(fallback)}>{W.back(backTitle ?? (section === 'detail' ? W.companies : W[origin]))}</Button> : undefined}</div>}>
      <div className="space-y-4">
        {exportNotice && <p role="status">{exportNotice}</p>}
        {exportDenied && context && !canExport(context) && <p role="status">{W.export.denied}</p>}
        {canExport(context) && !exportOpen && (loading || failed || problem || !visibleData) && <p role="status">{loading ? W.loading : problem ? W[problem] : failed?.text ?? W.noData}</p>}
        {exportOpen && context && visibleData && <ExecutiveExportPanel key={requestKey} section={section} params={params} context={context} data={visibleData} search={search} targetCompanyId={targetCompanyId} close={closeExport} reload={reloadExport} deny={denyExport} />}
        {context && !exportOpen && <>
          <div className="executive-time-row flex min-w-0 flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <div className="w-44"><label htmlFor="executive-month" className="text-sm">{W.month}</label><ThemedDate id="executive-month" aria-label={W.month} aria-invalid={!!fieldErrors.month} aria-describedby={fieldErrors.month ? 'executive-month-error' : undefined} mode="month" allowClear={false} value={normalizedMonth(params, context)} min={context.months?.first} max={context.months?.last ?? context.currentMonth} selectable={context.builtMonths} onChange={event => event.target.value && update({ month: event.target.value })} className="!min-h-11 !text-base" />{fieldErrors.month && <FieldError id="executive-month-error">{fieldErrors.month}</FieldError>}</div>
            {section !== 'compare' && section !== 'detail' && <ExecutiveFilters context={context} values={filterValues} errors={fieldErrors} apply={update} clear={clear} />}
            {visibleData && <><span className="text-sm">{W.through(reportDateTime(visibleData.dataThrough.oldest))}</span>{visibleData.period.isPartialMonth && <>{context.months && visibleData.period.month > context.months.first && <Button variant="secondary" onClick={() => { const date = new Date(`${visibleData.period.month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); update({ month: date.toISOString().slice(0, 7) }); }}>{W.previousMonth}</Button>}</>}{visibleData.build.monthRevisedAt && <MangmeeBadge>{W.revised(reportDateTime(visibleData.build.monthRevisedAt))}</MangmeeBadge>}</>}
          </div>
          {visibleData && <ReportStatus data={visibleData} />}
          {section === 'compare' || section === 'detail' ? <p className="text-sm">{section === 'compare' ? W.compareBase : W.detailBase}</p> : null}
          {section === 'companies' && <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2"><TextField id="executive-search" label={W.search} type="search" maxLength={120} value={term} hint={W.searchHint} error={fieldErrors.q} className="!min-h-11 !text-base" onChange={event => { setTerm(event.target.value); window.history.replaceState({ ...window.history.state, executiveSearch: event.target.value }, '', window.location.href); }} />
              <SelectField id="executive-sort" label={W.sort} value={String(reportQuery('companies', params, context).sortBy)} error={fieldErrors.sortBy ?? fieldErrors.sortDir} className="!min-h-11 !text-base" onChange={event => { const sort = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === event.target.value)!; update({ sortBy: sort.sortBy, sortDir: sort.sortDir }); }}>{context.sortOptions.map(option => <option key={option.sortBy} value={option.sortBy}>{sortLabel(option.sortBy, option.sortBy === reportQuery('companies', params, context).sortBy ? String(reportQuery('companies', params, context).sortDir) : option.sortDir)}</option>)}</SelectField>
            </div>
            <details className="rounded-xl border border-gray-200 bg-white p-3"><summary className="flex min-h-11 cursor-pointer items-center justify-between rounded-lg border border-gray-300 px-3 font-semibold text-brand-800 focus-visible:outline-brand-700">{W.companyFilters} · {DIRECTORY_FILTERS.filter(key => filterValue(key, params, context) !== 'ALL').length}</summary><div className="grid min-w-0 gap-3 py-3 sm:grid-cols-3">{DIRECTORY_FILTERS.map(filterControl)}</div></details>
            {from === 'compare' && <p>{W.compareList}</p>}
            {pickLabels.length > 0 && <div className="flex flex-wrap items-center gap-2"><span>{W.pick}</span>{pickLabels.map((label, i) => <MangmeeBadge key={i}>{label}</MangmeeBadge>)}<Button variant="secondary" onClick={() => update({ pick: '' })}>{W.removePick}</Button></div>}
            {selected.length === 2 && <ReportLink href={`${menuHref('compare', params)}&by=company&a=${encodeURIComponent(selected[0])}&b=${encodeURIComponent(selected[1])}`} remember={rememberNavigation}>{W.compareTwo}</ReportLink>}
          </>}
          {section !== 'compare' && section !== 'detail' && (filterCount > 0 || DIRECTORY_FILTERS.some(key => params.get(FILTER_URL[key]) && params.get(FILTER_URL[key]) !== 'ALL') || term || params.has('pick')) && <Button variant="secondary" onClick={clear}>{W.clear}</Button>}
          <div className="flex flex-wrap gap-2">{activeLabels.map((label, i) => <MangmeeBadge key={i}>{label}</MangmeeBadge>)}</div>
          {section === 'compare' && <ExecutiveSectionCard title={W.compare} className="executive-compare-controls min-w-0 space-y-4 p-4 sm:p-5">
            <div className="grid min-w-0 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)]"><SelectField label={W.dimension} value={['industry', 'discovery', 'referringSales', 'company'].includes(params.get('by') ?? '') ? params.get('by')! : 'industry'} error={fieldErrors.dimension} className="!min-h-11 !text-base" onChange={event => update({ by: event.target.value, a: '', b: '' })}>{[['industry', W.industry], ['discovery', W.discovery], ['referringSales', W.referring], ['company', W.company]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
            {params.get('by') === 'company' && <ReportLink href={menuHref('companies', params)} remember={rememberNavigation}>{W.chooseCompanies}</ReportLink>}
            <div className="contents">{(['a', 'b'] as const).map(side => <Fragment key={side}>{side === 'b' && <div>{!problem && <Button variant="secondary" onClick={() => navigateParams(swappedParams(params))}>{W.swap}</Button>}</div>}{params.get('by') === 'company' ? <div className="min-w-0"><p className="text-sm text-gray-600">{side === 'a' ? W.sideA : W.sideB}</p>{comparison && <p className="font-semibold">{thaiLabel(comparison[side === 'a' ? 'sideA' : 'sideB'].label, comparison[side === 'a' ? 'sideA' : 'sideB'].key)}</p>}</div> : <SelectField label={side === 'a' ? W.sideA : W.sideB} value={params.get(side) ?? ''} error={fieldErrors[side === 'a' ? 'sideA' : 'sideB']} searchable className="!min-h-11 !text-base" onChange={event => update({ [side]: event.target.value })}><option value="">{W.choose}</option>{context.filters[(params.get('by') === 'discovery' || params.get('by') === 'referringSales' ? params.get('by') : 'industry') as 'industry' | 'discovery' | 'referringSales'].filter(option => option.value !== 'ALL').map(option => <option key={option.value} value={option.value}>{thaiLabel(option.label, option.value)}</option>)}</SelectField>}</Fragment>)}</div></div>
          </ExecutiveSectionCard>}
        </>}
        {updated && <p role="status">{W.updated}</p>}
        {Math.max(retryWait, shared.retryWait) > 0 && <p role="status">{W.wait(Math.max(retryWait, shared.retryWait))}</p>}
        {failed?.kind === 'denied' ? <ForbiddenState title={failed.text} description="" helpText="" /> : failed?.kind === 'notFound' ? <EmptyState title={failed.text} description="" action={<Button variant="secondary" onClick={() => back(menuHref('companies', params))}>{W.back(W.companies)}</Button>} /> : failed?.kind === 'noData' ? <EmptyState title={failed.text} description="" action={<Button variant="secondary" onClick={shared.failure ? shared.retry : retry}>{W.retry}</Button>} /> : failed && !visibleData ? <ErrorState title={failed.text} onRetry={shared.failure ? shared.retry : retry} /> : null}
        {failed && visibleData && <ErrorState title={failed.text} description={W.staleAt(reportDateTime(visibleData.build.asOf))} onRetry={retry} />}
        {!context && !shared.failure && <ReportSkeleton />}
        {context && problem && <EmptyState title={W[problem]} description="" />}
        {context && !problem && !failed && !visibleData && <ReportSkeleton />}
        {!exportOpen && <><CoverLoader active={loading && !!visibleData} label={W.loading}>
          <div className="min-w-0 space-y-4" aria-busy={loading}>
            {visibleData && section === 'overview' && <OverviewContent data={visibleData as ExecutiveOverview} nav={nav} />}
            {visibleData && section === 'companies' && <CompaniesContent data={visibleData as ExecutiveCompanies} nav={nav} selected={selected} select={selectCompany} sortColumn={sortBy => update({ sortBy, sortDir: effectiveQuery.sortBy === sortBy ? effectiveQuery.sortDir === 'asc' ? 'desc' : 'asc' : sortBy === 'companyName' ? 'asc' : 'desc' })} />}
            {visibleData && section === 'detail' && <CompanyContent data={visibleData as ExecutiveCompanyDetail} tab={tab} history={history} admin={shared.admin} nav={nav} contactReadAt={contactReadAt} tabs={<ExecutiveTabs label={W.detail} tabs={DETAIL_TABS} value={tab} onChange={(view, keyboard) => { tabFocus.current = keyboard ? view : null; update({ view, tab: "" }); }} />} />}
            {visibleData && ['usage', 'revenue', 'customers', 'compare'].includes(section) && <AnalysisContent data={visibleData as ExecutiveAnalysis} nav={nav} seller={params.get('seller')} tabs={section !== 'compare' ? <><ExecutiveTabs label={W[section]} tabs={REPORT_VIEWS[section as 'usage' | 'revenue' | 'customers']} value={reportView(section as 'usage' | 'revenue' | 'customers', params)} onChange={(view, keyboard) => { tabFocus.current = keyboard ? view : null; update({ view }); }} />{section === 'customers' && reportView(section, params) === 'sales' && <SelectField label={W.sales} value={params.get('seller') === 'credited' ? 'credited' : 'referring'} className="!min-h-11 !text-base" onChange={event => update({ seller: event.target.value })}><option value="referring">{W.referring}</option><option value="credited">{W.credited}</option></SelectField>}</> : undefined} rankingControl={section === 'usage' && reportView(section, params) === 'ranking' ? <SelectField label={W.ranking} value={Object.hasOwn(RANK_LABELS, params.get('rank') ?? '') ? params.get('rank')! : 'expenseReceiptCount'} error={fieldErrors.metric} className="!min-h-11 !text-base" onChange={event => update({ rank: event.target.value })}>{Object.entries(RANK_LABELS).map(([value, words]) => <option key={value} value={value}>{words.label}</option>)}</SelectField> : undefined} />}
          </div>
        </CoverLoader>
        {pagination && pagination.totalPages > 0 && <Pagination page={pagination.page} totalPages={pagination.totalPages} disabled={loading} onPageChange={page => update({ page: String(page) })} />}</>}
      </div>
    </MangmeePage>
  </main></ReasonNotes.Provider>;
}
