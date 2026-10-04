'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  EXECUTIVE_SORT_OPTIONS, EXECUTIVE_PERIOD_WORDS as P,
  type ExecutiveContext, type ExecutiveCompanyHistory, type ExecutiveCompanyDetail, type ExecutiveCompanies, type ExecutiveOverview, type ExecutiveAnalysis,
} from '@watchdog-bms/contracts';
import { MangmeeBadge } from '@/common/components/mangmee';
import { Button } from '@/common/components/button';
import { SelectField, TextField } from '@/common/components/field/Field';
import { ExecutivePeriodControl } from './ExecutivePeriodControl';
import { Pagination } from '@/common/components/data-table/Pagination';
import { EmptyState, ErrorState, ForbiddenState, CoverLoader } from '@/common/components/state';
import { WorkspaceLocaleContext } from '@/common/i18n/locale-context';
import { getExecutiveContext, getExecutiveReport, getExecutiveHistory, type ReportData } from './executive-reports.api';
import {
  FILTER_URL, GLOBAL_FILTERS, DIRECTORY_FILTERS, reportQuery, reportView, filterValue, selectedPeriod, periodParams, periodText, changedParams, clearedParams,
  reportFailure, keepLoadedReport, queryFieldErrors, readCurrentBuild, drillFilters, drillLabels, menuHref, executiveHref, reportDateTime, pageNumber, reasonText,
  EXECUTIVE_ACCESS_DENIED_EVENT, sortLabel, retryDelaySeconds, reportHistoryState, ownHistoryState, backSection, type ReportSection,
} from './executive-reports.logic';
import { EXECUTIVE_PAGE_CLASS, ExecutivePage, ExecutiveTabs, ReasonNotes, ReportStatus } from './ExecutiveReportDesign';
import { ExecutiveFilters } from './ExecutiveFilters';
import { ExecutiveExportPanel } from './ExecutiveExportPanel';
import { canExport } from './executive-export.logic';
import { W, REPORT_VIEWS, DETAIL_TABS, RANK_LABELS } from './executive-reports.words';
import { OverviewContent, CompaniesContent, AnalysisContent, CompanyContent, ReportSkeleton } from './ExecutiveReportContent';

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
  const params = context ? periodParams(new URLSearchParams(paramsString), context) : new URLSearchParams(paramsString);
  const periodInvalid = !!context && !selectedPeriod(params, context);
  const exportOpen = params.get('export') === '1' && canExport(context);
  const [exportNotice, setExportNotice] = useState('');
  const [exportDenied, setExportDenied] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [history, setHistory] = useState<ExecutiveCompanyHistory | null>(null);
  const [dataKey, setDataKey] = useState('');
  const [dataParams, setDataParams] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [historyFailure, setHistoryFailure] = useState<Failure | null>(null);
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
  const queryKey = context && !periodInvalid ? JSON.stringify(reportQuery(section, params, context, search)) : null;
  const historyPage = section === 'detail' && tab === 'history' ? pageNumber(params.get('page')) : 1;
  const requestKey = `${section}:${targetCompanyId ?? ''}:${queryKey}`;

  function navigateParams(next: URLSearchParams, replace = false, searchValue = term) {
    const href = executiveHref(pathname, next);
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
        window.history.replaceState({ ...ownHistoryState(window.history.state), executiveSearch: term }, '', executiveHref(pathname, current));
        setSearch(next);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [term, search, pathname, section]);
  useEffect(() => {
    if (!context) return;
    const next = new URLSearchParams(paramsString);
    const normalized = periodParams(next, context);
    for (const key of ['month', 'from', 'to', 'origin', 'periodPreset']) { next.delete(key); if (normalized.has(key)) next.set(key, normalized.get(key)!); }
    for (const key of GLOBAL_FILTERS) next.set(FILTER_URL[key], filterValue(key, next, context));
    next.delete('q'); next.delete('search'); next.delete('buildId'); if (next.get('export') !== '1' || !canExport(context)) next.delete('export');
    // URL only (Next's own state keeps the router where it is): every read normalises the same way, so a router update would read twice.
    if (next.toString() !== paramsString) window.history.replaceState(window.history.state, '', executiveHref(pathname, next));
  }, [context, paramsString, pathname]);

  useEffect(() => {
    if (!context || periodInvalid) { setData(null); setHistory(null); setLoading(false); return; }
    const controller = new AbortController();
    const query = reportQuery(section, new URLSearchParams(paramsString), context, search);
    setLoading(true); setFailure(null); setFieldErrors({}); setUpdated(false); setRetryWait(0);
    // One response owns every card/table; nothing from an older request may overwrite it.
    readCurrentBuild(buildId => getExecutiveReport(section, { ...query, ...(buildId ? { buildId } : {}) }, controller.signal, targetCompanyId), shared.build.current, () => shared.refresh(controller.signal))
      .then(result => {
        if (controller.signal.aborted) return;
        shared.build.current = result.data.build.id;
        setData(result.data); setDataKey(requestKey); setDataParams(paramsString); setUpdated(result.changed); setContactReadAt(new Date().toISOString());
        const pagination = 'pagination' in result.data ? result.data.pagination : null;
        if (pagination && pageNumber(new URLSearchParams(paramsString).get('page')) !== pagination.page) {
          const next = new URLSearchParams(window.location.search); next.set('page', String(pagination.page));
          window.history.replaceState(window.history.state, '', executiveHref(pathname, next)); // URL only, as above
        }
      }).catch(error => {
        if (controller.signal.aborted) return;
        const failed = reportFailure(error);
        setFailure(failed); setFieldErrors(queryFieldErrors(error)); setRetryWait(retryDelaySeconds(error));
        if (!keepLoadedReport(error, false)) { setData(null); setHistory(null); }
        if (failed.kind === 'denied') shared.deny();
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Depend on the normalised query, not context identity: refreshing builtMonths must not read the report a third time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, section, targetCompanyId, attempt]);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyKey, setHistoryKey] = useState('');
  useEffect(() => {
    if (!context || section !== 'detail' || tab !== 'history' || dataKey !== requestKey) return;
    const key = `${requestKey}:${historyPage}:${attempt}`;
    if (historyKey === key && history) return;
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryFailure(null);
    void getExecutiveHistory(targetCompanyId!, historyPage, controller.signal, { ...reportQuery('detail', params, context), buildId: data!.build.id }).then(result => {
      if (controller.signal.aborted) return;
      setHistory(result); setHistoryKey(key);
      if (historyPage !== result.pagination.page) {
        const next = new URLSearchParams(window.location.search); next.set('page', String(result.pagination.page));
        window.history.replaceState(window.history.state, '', executiveHref(pathname, next));
      }
    }).catch(error => {
      if (controller.signal.aborted) return;
      const failed = reportFailure(error, false);
      setHistoryFailure(failed); setHistory(null); setRetryWait(retryDelaySeconds(error));
      if (!keepLoadedReport(error, true)) { setData(null); setHistory(null); }
      if (failed.kind === 'denied') shared.deny();
    }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => { controller.abort(); setHistoryLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, targetCompanyId, tab, historyPage, dataKey, requestKey, attempt]);

  const closeExport = useCallback(() => {
    const next = new URLSearchParams(window.location.search); next.delete('export');
    window.history.replaceState(ownHistoryState(window.history.state), '', executiveHref(window.location.pathname, next));
  }, []);
  const reloadExport = useCallback(() => { closeExport(); setExportNotice(W.export.expired); setAttempt(n => n + 1); }, [closeExport]);
  // API13 refuses a lost export or contacts right with the same code as a lost read right: re-read the rights first, so only a
  // reader who lost the report itself gets the report's denial (plain-language spec, E5 denial).
  const denyExport = useCallback(() => { setExportDenied(true); void shared.refresh(new AbortController().signal).catch(() => {}); }, [shared]);
  const retry = retryWait > 0 ? undefined : () => setAttempt(n => n + 1);
  const failed = shared.failure ?? failure ?? (tab === 'history' ? historyFailure : null);
  const samePeriod = data && context && selectedPeriod(params, context) && (data.period.from ?? data.period.month) === params.get('from') && (data.period.to ?? data.period.month) === params.get('to');
  const visibleData = !periodInvalid && samePeriod && context && !['denied', 'notFound', 'noData'].includes(failed?.kind ?? '') ? data : null;
  const reading = loading || historyLoading || (!!data && dataKey !== requestKey && !failed);
  const title = section === 'detail' && visibleData && 'company' in visibleData ? visibleData.company.displayName : W[section];
  const nav = { params: dataKey === requestKey ? params : context ? periodParams(new URLSearchParams(dataParams), context) : new URLSearchParams(dataParams), from: section, remember: rememberNavigation, navigate: (href: string) => router.push(href) };
  const from = params.get('origin');
  const origin = ['overview', 'usage', 'revenue', 'customers'].includes(from ?? '') ? from as Exclude<ReportSection, 'detail' | 'companies'> : 'overview';
  const fallback = section === 'detail' ? menuHref('companies', params) : menuHref(origin, params);
  const effectiveQuery = context ? reportQuery(section, params, context, search) : {};
  const filterValues = Object.fromEntries((section === 'companies' ? [...GLOBAL_FILTERS, ...DIRECTORY_FILTERS] : GLOBAL_FILTERS).map(key => [key, String(effectiveQuery[key] ?? 'ALL')]));
  const picked = drillFilters(params);
  const pickLabels = context && picked ? Object.entries(picked).flatMap(([key, value]) => {
    if (Object.hasOwn(FILTER_URL, key)) return [];
    const label = drillLabels(Object.fromEntries([[key, value]]), context)[0];
    return label ? [{ key, label }] : [];
  }) : [];
  const pagination = section === 'companies' && visibleData && 'pagination' in visibleData ? visibleData.pagination : tab === 'history' && section === 'detail' ? history?.pagination : null;
  const directoryControls = context && section === 'companies' && !exportOpen ? <div className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2 md:w-80"><TextField id="executive-search" label={W.search} aria-label={W.search} placeholder={W.search} frameClassName="min-w-0 !gap-0 [&>span:first-child]:sr-only" hintClassName="truncate text-gray-600" type="search" maxLength={120} value={term} hint={W.searchHint} error={fieldErrors.q} className="!min-h-11 !text-base placeholder:text-gray-600" onChange={event => { setTerm(event.target.value); window.history.replaceState({ ...window.history.state, executiveSearch: event.target.value }, '', window.location.href); }} />
              <SelectField id="executive-sort" label={W.sort} frameClassName="min-w-0 !gap-0 [&>span:first-child]:sr-only" value={String(reportQuery('companies', params, context).sortBy)} error={fieldErrors.sortBy ?? fieldErrors.sortDir} className="!min-h-11 !text-base" onChange={event => { const sort = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === event.target.value)!; update({ sortBy: sort.sortBy, sortDir: sort.sortDir }); }}>{context.sortOptions.map(option => <option key={option.sortBy} value={option.sortBy}>{sortLabel(option.sortBy, option.sortBy === reportQuery('companies', params, context).sortBy ? String(reportQuery('companies', params, context).sortDir) : option.sortDir)}</option>)}</SelectField>
            </div> : undefined;
  return <ReasonNotes.Provider value={!exportOpen}><main className={`executive-report mx-auto max-w-7xl px-3 py-2 text-base sm:px-6 ${EXECUTIVE_PAGE_CLASS}`}>
    <ExecutivePage compact controls={directoryControls} eyebrow={W.report} title={title} description={W.descriptions[section]} actions={failed?.kind === 'notFound' ? undefined : <div className="flex flex-wrap gap-2">{canExport(context) && !exportOpen && <Button variant={section === 'overview' ? 'secondary' : 'primary'} disabled={reading || !!failed || !visibleData} onClick={() => { const next = new URLSearchParams(params); next.set('export', '1'); setExportNotice(''); navigateParams(next); }}>{W.export.action}</Button>}{section === 'overview' && !exportOpen ? <Button onClick={() => { rememberNavigation(); router.push(menuHref('companies', params)); }}>{W.allCompanies}</Button> : !exportOpen && ((section === 'companies' && from) || section === 'detail') ? <Button variant="secondary" aria-label={W.back(backTitle ?? (section === 'detail' ? W.companies : W[origin]))} onClick={() => back(fallback)}><span className="hidden sm:inline">{W.back(backTitle ?? (section === 'detail' ? W.companies : W[origin]))}</span><span className="sm:hidden">{W.back('')}</span></Button> : undefined}</div>}>
      <div className="space-y-2">
        {exportNotice && <p role="status">{exportNotice}</p>}
        {exportDenied && context && !canExport(context) && <p role="status">{W.export.denied}</p>}
        {exportOpen && reading && visibleData && <ReportSkeleton />}
        {exportOpen && context && visibleData && dataKey === requestKey && !reading && <ExecutiveExportPanel key={requestKey} section={section} params={params} context={context} data={visibleData} search={search} targetCompanyId={targetCompanyId} close={closeExport} reload={reloadExport} deny={denyExport} />}
        {context && !exportOpen && failed?.kind !== 'notFound' && <>
          <ExecutivePeriodControl context={context} params={params} apply={update} />
          <div className="executive-time-row flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-gray-200 bg-white px-2 py-0">
            {selectedPeriod(params, context) && <span className="shrink-0 text-xs text-gray-700">{periodText(selectedPeriod(params, context)!)}</span>}
            {section !== 'detail' && <ExecutiveFilters directory={section === 'companies'} context={context} values={filterValues} errors={fieldErrors} apply={update} clear={clear} extra={pickLabels.map(({ key, label }) => ({ key, label, remove: () => { const next = new URLSearchParams(picked as Record<string, string>); next.delete(key); update({ pick: next.toString() }); } }))} />}
            {visibleData && <><span className="whitespace-nowrap text-xs sm:text-sm">{W.through(reportDateTime(visibleData.dataThrough.oldest))}</span>{visibleData.build.monthRevisedAt && <MangmeeBadge>{W.revised(reportDateTime(visibleData.build.monthRevisedAt))}</MangmeeBadge>}</>}
          </div>
          {visibleData && <ReportStatus periodOnly={section === 'revenue'} data={section === 'detail' && tab === 'history' && history?.sourceStatus && history.period ? { ...visibleData, sourceStatus: history.sourceStatus, period: history.period } : visibleData} sources={section === 'revenue' ? ['money'] : section === 'detail' && tab === 'usage' ? ['money', 'usage', 'aiCost'] : ['money', 'usage']} />}
          {section === 'detail' && <p className="text-sm">{P.selectedBase}</p>}
        </>}
        {updated && <p role="status">{W.updated}</p>}
        {Math.max(retryWait, shared.retryWait) > 0 && <p role="status">{W.wait(Math.max(retryWait, shared.retryWait))}</p>}
        {failed?.kind === 'denied' ? <ForbiddenState title={failed.text} description="" helpText="" /> : failed?.kind === 'notFound' ? <EmptyState title={failed.text} description="" action={<Button variant="secondary" onClick={() => back(menuHref('companies', params))}>{W.back(W.companies)}</Button>} /> : failed?.kind === 'noData' ? <EmptyState title={failed.text} description="" action={<Button variant="secondary" onClick={shared.failure ? shared.retry : retry}>{W.retry}</Button>} /> : failed && !visibleData ? <ErrorState description="" title={failed.text} onRetry={shared.failure ? shared.retry : retry} /> : null}
        {failed?.kind === 'error' && visibleData && <ErrorState title={failed.text} description={historyFailure && tab === 'history' ? '' : W.staleAt(reportDateTime(visibleData.build.asOf))} onRetry={retry} />}
        {!context && !shared.failure && <ReportSkeleton />}
        {periodInvalid && <p role="alert" className="text-sm text-red-700">{P.invalid}</p>}
        {context && !periodInvalid && !failed && !visibleData && <ReportSkeleton />}
        {!exportOpen && <><div className="relative min-h-32">
          <CoverLoader active={reading && !!visibleData} label={W.loading} />
          <div className={`min-w-0 space-y-4 ${reading ? "opacity-50" : ""}`} aria-busy={reading} aria-hidden={reading && !!visibleData ? true : undefined} inert={reading && !!visibleData}>
            {visibleData && section === 'overview' && <OverviewContent data={visibleData as ExecutiveOverview} nav={nav} />}
            {visibleData && section === 'companies' && <CompaniesContent data={visibleData as ExecutiveCompanies} nav={nav} sortColumn={sortBy => update({ sortBy, sortDir: effectiveQuery.sortBy === sortBy ? effectiveQuery.sortDir === 'asc' ? 'desc' : 'asc' : sortBy === 'companyName' ? 'asc' : 'desc' })} />}
            {visibleData && section === 'detail' && <CompanyContent data={visibleData as ExecutiveCompanyDetail} tab={tab} history={history} admin={shared.admin} nav={nav} contactReadAt={contactReadAt} tabs={<ExecutiveTabs label={W.detail} tabs={DETAIL_TABS} value={tab} onChange={(view, keyboard) => { tabFocus.current = keyboard ? view : null; update({ view, tab: "" }); }} />} />}
            {visibleData && ['usage', 'revenue', 'customers'].includes(section) && <AnalysisContent data={visibleData as ExecutiveAnalysis} nav={nav} seller={params.get('seller')} tabs={<><ExecutiveTabs label={W[section]} tabs={REPORT_VIEWS[section as 'usage' | 'revenue' | 'customers']} value={reportView(section as 'usage' | 'revenue' | 'customers', params)} onChange={(view, keyboard) => { tabFocus.current = keyboard ? view : null; update({ view }); }} />{section === 'customers' && reportView(section, params) === 'sales' && <SelectField label={W.sales} value={params.get('seller') === 'credited' ? 'credited' : 'referring'} className="!min-h-11 !text-base" onChange={event => update({ seller: event.target.value })}><option value="referring">{W.referring}</option><option value="credited">{W.credited}</option></SelectField>}</>} rankingControl={section === 'usage' && reportView(section, params) === 'ranking' ? <SelectField label={W.ranking} value={Object.hasOwn(RANK_LABELS, params.get('rank') ?? '') ? params.get('rank')! : 'expenseReceiptCount'} error={fieldErrors.metric} className="!min-h-11 !text-base" onChange={event => update({ rank: event.target.value })}>{Object.entries(RANK_LABELS).map(([value, words]) => <option key={value} value={value}>{words.label}</option>)}</SelectField> : undefined} />}
          </div>
        </div>
        {pagination && pagination.totalPages > 1 && <Pagination page={pagination.page} totalPages={pagination.totalPages} disabled={reading} onPageChange={page => update({ page: String(page) })} />}</>}
      </div>
    </ExecutivePage>
  </main></ReasonNotes.Provider>;
}
